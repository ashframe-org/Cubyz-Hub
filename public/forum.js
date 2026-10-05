(function () {
  "use strict";

  var CATEGORIES = [
    { key: "all", name: "All" },
    { key: "Game", name: "Game" },
    { key: "Addons & Mods", name: "Addons" },
    { key: "Creation", name: "Creation" },
    { key: "Development", name: "Dev" },
    { key: "General", name: "General" },
  ];

  var TYPE_LABELS = {
    question: "Question",
    bug: "Bug",
    idea: "Idea",
    showcase: "Showcase",
    guide: "Guide",
    discussion: "Discussion",
  };

  var TYPE_HINTS = {
    question: "Describe what you're trying to do, what you already tried, and what happened.",
    bug: "Include your game version, OS, the exact steps, and a log or screenshot if you can.",
    idea: "Explain the idea and why it helps. Mockups or examples welcome.",
    showcase: "Share screenshots, a link or the config, and a bit about how you made it.",
    guide: "Walk through the steps clearly; code blocks and screenshots help.",
    discussion: "No special format. Just start the conversation.",
  };

  var state = {
    category: "all",
    tag: null,
    type: "all",
    status: "all",
    sort: "recent",
    view: "list",
    query: "",
    page: 1,
    github: false,
    loggedIn: false,
    user: null,
  };

  function promptLogin() {
    var trigger = document.getElementById("authBtn") || document.querySelector("[data-open-auth]");
    if (trigger) trigger.click();
  }

  function applyAuthState() {
    var newBtn = document.getElementById("newDiscussionBtn");
    if (!newBtn) return;
    if (state.loggedIn) newBtn.removeAttribute("data-open-auth");
    else newBtn.setAttribute("data-open-auth", "");
  }

  function renderSideProfile() {
    var userBox = document.getElementById("sideProfileUser");
    var guestBox = document.getElementById("sideProfileGuest");
    if (!userBox || !guestBox) return;
    if (state.loggedIn && state.user) {
      userBox.hidden = false;
      guestBox.hidden = true;
      var wrap = document.getElementById("spAvatarWrap");
      if (wrap) {
        wrap.innerHTML = "";
        wrap.appendChild(avatar(state.user.username, colorFor(state.user.username), state.user.avatarUrl));
      }
      var name = document.getElementById("spName");
      if (name) {
        name.textContent = state.user.username;
        name.href = "/profile/" + encodeURIComponent(state.user.username);
      }
    } else {
      userBox.hidden = true;
      guestBox.hidden = false;
    }
  }

  function goNewDiscussion(e) {
    if (!state.loggedIn) return;
    if (e) e.preventDefault();
    if (USE_DISCUSSION_PAGE) {
      window.location.href = "/forum/new";
      return;
    }
    openModal();
  }

  async function loadAuthState() {
    try {
      var res = await fetch("/api/auth/status", { credentials: "include" });
      var json = await res.json();
      state.loggedIn = !!(json && json.ok && json.user);
      state.user = (json && json.user) || null;
    } catch (err) {
      state.loggedIn = false;
      state.user = null;
    }
    applyAuthState();
    renderSideProfile();
  }

  var requestSeq = 0;
  var searchTimer = null;
  var currentModerators = [];
  // Experimental: route "New Discussion" to its own page instead of the modal.
  // Flip to false to go back to the modal (the modal code is kept intact).
  var USE_DISCUSSION_PAGE = true;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(message, error) {
    if (typeof window.toast === "function") {
      (error ? window.toast.error : window.toast.info)(message);
    }
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  function previewText(body) {
    var line = String(body || "").split("\n").filter(function (l) { return l.trim(); })[0] || "";
    return line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, function (m, alt) { return alt.replace(/\|[1-4]$/, ""); })
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_~`]+/g, "")
      .replace(/^[#>\-\s]+/, "")
      .trim()
      .slice(0, 160);
  }

  function stripInlineMarkdown(s) {
    return String(s || "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, function (m, alt) { return alt.replace(/\|[1-4]$/, ""); })
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_~`]+/g, "");
  }

  function snippetEl(snippet) {
    var p = el("p", "disc-preview");
    var text = stripInlineMarkdown(snippet);
    var re = /\u0001([\s\S]*?)\u0002/g;
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) p.appendChild(document.createTextNode(text.slice(last, m.index)));
      p.appendChild(el("mark", "", m[1]));
      last = re.lastIndex;
    }
    if (last < text.length) p.appendChild(document.createTextNode(text.slice(last)));
    return p;
  }

  function parseServerDate(value) {    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
      return new Date(value.replace(" ", "T") + "Z");
    }
    return new Date(value);
  }

  function relativeTime(value) {
    var then = parseServerDate(value);
    var diff = Date.now() - then.getTime();
    if (isNaN(diff)) return "";
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h ago";
    var days = Math.floor(hours / 24);
    if (days < 30) return days + "d ago";
    var months = Math.floor(days / 30);
    if (months < 12) return months + "mo ago";
    return Math.floor(months / 12) + "y ago";
  }

  function avatar(name, color, url) {
    if (url) {
      var img = el("img", "avatar");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      return img;
    }
    var span = el("span", "avatar", (name || "?").charAt(0).toUpperCase());
    if (color) span.style.setProperty("--av", color);
    return span;
  }

  var AVATAR_COLORS = ["#6ea8fe", "#f7b955", "#4dd4ac", "#c792ea", "#ff8fab", "#8fd08f", "#e0a458"];
  function colorFor(name) {
    var n = 0;
    for (var i = 0; i < (name || "").length; i++) n += name.charCodeAt(i);
    return AVATAR_COLORS[n % AVATAR_COLORS.length];
  }

  var SVG = {
    up: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>',
    reply: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>',
    check: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>',
  };

  function threadLink(t) {
    return "/forum/t/" + t.id + (t.title ? "-" + slugify(t.title) : "");
  }

  function renderCategories(counts) {
    var list = document.getElementById("catList");
    if (!list) return;
    list.innerHTML = "";
    CATEGORIES.forEach(function (c) {
      var btn = el("button", "filter-pill cat-pill" + (state.category === c.key ? " active" : ""));
      btn.type = "button";
      btn.setAttribute("data-category", c.key);
      btn.setAttribute("aria-pressed", state.category === c.key ? "true" : "false");
      btn.appendChild(document.createTextNode(c.name));
      btn.appendChild(el("span", "pill-count", String((counts && counts[c.key]) || 0)));
      list.appendChild(btn);
    });
  }

  function renderTags(topTags) {
    var cloud = document.getElementById("tagCloud");
    if (!cloud) return;
    cloud.innerHTML = "";
    var tags = topTags || [];
    tags.forEach(function (t, i) {
      var a = el("a", "tag-pill" + (i >= 8 ? " tag-extra" : "") + (state.tag === t.name ? " active-tag" : ""));
      a.href = "#";
      a.setAttribute("data-tag", t.name);
      a.appendChild(document.createTextNode("#" + t.name));
      a.appendChild(el("span", "tag-num", String(t.count)));
      cloud.appendChild(a);
    });
    if (!tags.length) cloud.appendChild(el("span", "reply-empty", "No tags yet."));
    var more = document.getElementById("moreTags");
    if (more) more.hidden = tags.length <= 8;
  }

  async function loadContributors() {
    var list = document.getElementById("contributorList");
    if (!list) return;
    try {
      var res = await fetch("/api/forum/contributors", { credentials: "include" });
      var json = await res.json();
      if (!json.ok) return;
      list.innerHTML = "";
      if (!json.contributors.length) {
        list.appendChild(el("li", "reply-empty", "No contributions yet."));
        return;
      }
      json.contributors.forEach(function (c) {
        var li = el("li", "contributor-item");
        li.appendChild(avatar(c.username, colorFor(c.username), c.avatarUrl));
        var info = el("div", "contributor-info");
        var a = el("a", "contributor-name", c.username);
        a.href = "/profile/" + encodeURIComponent(c.username);
        info.appendChild(a);
        var parts = [];
        if (c.threads) parts.push(c.threads + (c.threads === 1 ? " discussion" : " discussions"));
        if (c.replies) parts.push(c.replies + (c.replies === 1 ? " reply" : " replies"));
        var meta = el("span", "contributor-meta", parts.join(" \u00b7 ") || "No activity");
        meta.title = "Discussions weigh more than replies";
        info.appendChild(meta);
        li.appendChild(info);
        list.appendChild(li);
      });
    } catch (err) {
      /* leave as-is */
    }
  }

  async function loadActivity() {
    var list = document.getElementById("activityList");
    if (!list) return;
    try {
      var res = await fetch("/api/forum/activity?limit=8", { credentials: "include" });
      var json = await res.json();
      if (!json.ok) return;
      list.innerHTML = "";
      if (!json.items.length) {
        list.appendChild(el("li", "reply-empty", "No activity yet."));
        return;
      }
      json.items.forEach(function (it) {
        var li = el("li", "activity-item");
        li.appendChild(avatar(it.actor, colorFor(it.actor), it.avatarUrl));
        var text = el("div", "activity-text");
        var p = el("div");
        var href = it.threadId ? "/forum/t/" + it.threadId + (it.title ? "-" + slugify(it.title) : "") : "#";
        p.innerHTML =
          "<strong>" + esc(it.actor) + "</strong> " +
          (it.type === "reply" ? "replied to " : "posted ") +
          '<a href="' + esc(href) + '"><strong>' + esc(it.title || "") + "</strong></a>";
        text.appendChild(p);
        text.appendChild(el("span", "activity-time", relativeTime(it.createdAt)));
        li.appendChild(text);
        list.appendChild(li);
      });
    } catch (err) {
      /* leave the panel as-is */
    }
  }

  function discussCard(t) {
    var card = el("article", "disc-card");

    var vote = el("div", "disc-vote");
    vote.innerHTML = SVG.up;
    vote.appendChild(el("span", "", String(t.votes)));
    vote.setAttribute("title", t.votes + " votes");
    card.appendChild(vote);

    var body = el("div", "disc-body");

    var top = el("div", "disc-top");
    var title = el("a", "disc-title", t.title);
    title.href = threadLink(t);
    top.appendChild(title);
    if (t.type && t.type !== "discussion") {
      top.appendChild(el("span", "badge badge-type-" + t.type, TYPE_LABELS[t.type] || t.type));
    }
    if (t.pinned) top.appendChild(el("span", "badge badge-pinned", "Pinned"));
    if (t.solved) {
      var solved = el("span", "badge badge-solved");
      solved.innerHTML = SVG.check + " Solved";
      top.appendChild(solved);
    }
    if (t.locked) top.appendChild(el("span", "badge badge-locked", "Locked"));
    if (t.hidden) top.appendChild(el("span", "badge badge-hidden", "Hidden"));
    body.appendChild(top);

    if (t.snippet) {
      body.appendChild(snippetEl(t.snippet));
    } else {
      body.appendChild(el("p", "disc-preview", previewText(t.body)));
    }

    if (t.tags && t.tags.length) {
      var tags = el("div", "disc-tags");
      t.tags.forEach(function (tagName) {
        var tag = el("a", "tag-mini", "#" + tagName);
        tag.href = "#";
        tag.addEventListener("click", function (e) {
          e.preventDefault();
          setTag(tagName);
        });
        tags.appendChild(tag);
      });
      body.appendChild(tags);
    }

    var meta = el("div", "disc-meta");
    meta.appendChild(avatar(t.author, colorFor(t.author), t.avatarUrl));
    meta.appendChild(el("span", "", t.author));
    meta.appendChild(el("span", "", "\u00b7 " + relativeTime(t.createdAt)));
    meta.appendChild(el("span", "", "\u00b7 " + t.category));
    body.appendChild(meta);

    card.appendChild(body);

    if (!t.locked) {
      var stats = el("div", "disc-stats");
      var reply = el("span", "stat");
      reply.innerHTML = SVG.reply;
      reply.appendChild(el("span", "", String(t.replyCount)));
      reply.setAttribute("title", t.replyCount + " replies");
      stats.appendChild(reply);
      card.appendChild(stats);
    }

    return card;
  }

  function renderList(threads) {
    var listEl = document.getElementById("discList");
    var statusEl = document.getElementById("forumStatus");
    if (!listEl) return;

    listEl.className = "disc-list" + (state.view === "grid" ? " grid" : "");
    listEl.innerHTML = "";

    if (!threads.length) {
      var msg = state.query
        ? "No discussions match \u201c" + state.query + "\u201d."
        : anyFilterActive()
          ? "No discussions match these filters."
          : "No discussions yet. Start the first one!";
      listEl.appendChild(el("p", "reply-empty", msg));
    } else {
      threads.forEach(function (t) {
        listEl.appendChild(discussCard(t));
      });
    }

    // Hide the sort/view toolbar when there's nothing to sort.
    var toolbar = document.querySelector(".forum-toolbar");
    if (toolbar) toolbar.hidden = threads.length === 0;

    // Collapse the header blurb while searching to cut the stacked text.
    var subheading = document.getElementById("forumSubheading");
    if (subheading) subheading.hidden = !!state.query;

    if (statusEl) {
      if (threads.length && state.query) {
        statusEl.hidden = false;
        statusEl.textContent = threads.length + " result" + (threads.length === 1 ? "" : "s") + " for \u201c" + state.query + "\u201d";
      } else if (threads.length && anyFilterActive()) {
        statusEl.hidden = false;
        statusEl.textContent = threads.length + " discussion" + (threads.length === 1 ? "" : "s");
      } else {
        statusEl.hidden = true;
        statusEl.textContent = "";
      }
    }

    renderChips();
  }

  function anyFilterActive() {
    return state.category !== "all" || state.type !== "all" || state.status !== "all" || !!state.tag;
  }

  function makeChip(label, onClear) {
    var chip = el("span", "chip");
    chip.appendChild(document.createTextNode(label));
    var btn = el("button", "", "\u00d7");
    btn.type = "button";
    btn.setAttribute("aria-label", "Clear filter " + label);
    btn.addEventListener("click", onClear);
    chip.appendChild(btn);
    return chip;
  }

  function renderChips() {
    var chips = document.getElementById("filterChips");
    if (!chips) return;
    chips.innerHTML = "";
    var any = false;
    if (state.category !== "all") {
      any = true;
      var name = (CATEGORIES.filter(function (c) { return c.key === state.category; })[0] || {}).name || state.category;
      chips.appendChild(makeChip(name, function () { setFilter("category", "all"); }));
    }
    if (state.type !== "all") {
      any = true;
      chips.appendChild(makeChip(TYPE_LABELS[state.type] || state.type, function () { setFilter("type", "all"); }));
    }
    if (state.status !== "all") {
      any = true;
      chips.appendChild(makeChip(state.status === "solved" ? "Solved" : "Open", function () { setFilter("status", "all"); }));
    }
    if (state.tag) {
      any = true;
      chips.appendChild(makeChip("#" + state.tag, function () { setTag(null); }));
    }
    chips.hidden = !any;
  }

  function syncUrl() {
    var params = new URLSearchParams();
    if (state.category !== "all") params.set("category", state.category);
    if (state.type !== "all") params.set("type", state.type);
    if (state.status !== "all") params.set("status", state.status);
    if (state.tag) params.set("tag", state.tag);
    if (state.sort !== "recent") params.set("sort", state.sort);
    if (state.query) params.set("q", state.query);
    var qs = params.toString();
    history.replaceState(null, "", "/forum" + (qs ? "?" + qs : ""));
  }

  function githubQuery(q) {
    var box = document.getElementById("githubResults");
    var list = document.getElementById("githubResultsList");
    if (!box || !list) return;
    if (!state.github || !q) {
      box.hidden = true;
      list.innerHTML = "";
      return;
    }
    fetch("/api/github/issues?limit=8&q=" + encodeURIComponent(q), { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (!json || !json.ok || !json.items || !json.items.length) {
          box.hidden = true;
          list.innerHTML = "";
          return;
        }
        list.innerHTML = "";
        json.items.forEach(function (it) {
          var a = el("a", "github-item");
          a.href = it.html_url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          var head = el("div", "github-item-head");
          head.appendChild(el("span", "github-state github-state-" + (it.state === "open" ? "open" : "closed"), it.is_pr ? "PR" : (it.state === "open" ? "Open" : "Closed")));
          var title = el("span", "github-item-title");
          title.textContent = it.title;
          head.appendChild(title);
          a.appendChild(head);
          if (it.snippet) {
            var snip = el("div", "github-item-snippet");
            snip.textContent = it.snippet;
            a.appendChild(snip);
          }
          var meta = el("div", "github-item-meta");
          meta.textContent = it.repo + " #" + it.number + (it.comments ? " \u00b7 " + it.comments + " comments" : "");
          a.appendChild(meta);
          list.appendChild(a);
        });
        box.hidden = false;
      })
      .catch(function () {
        box.hidden = true;
      });
  }

  async function load(append) {
    syncUrl();
    var seq = ++requestSeq;
    try {
      var params = new URLSearchParams();
      if (state.category !== "all") params.set("category", state.category);
      if (state.type !== "all") params.set("type", state.type);
      if (state.status !== "all") params.set("status", state.status);
      if (state.tag) params.set("tag", state.tag);
      params.set("sort", state.sort);
      if (state.query) params.set("q", state.query);
      params.set("page", String(state.page));

      var endpoint = state.query ? "/api/forum/search" : "/api/forum/threads";
      var res = await fetch(endpoint + "?" + params.toString(), { credentials: "include" });
      var json = await res.json();
      if (seq !== requestSeq) return;
      if (!json.ok) throw new Error(json.error || "failed");

      renderCategories(json.categoryCounts);
      renderTags(json.topTags);
      if (append) appendThreads(json.threads);
      else renderList(json.threads);
      if (!append) githubQuery(state.query);
      updateLoadMore(json.totalPages);
    } catch (err) {
      if (seq !== requestSeq) return;
      console.error("Failed to load forum:", err);
      if (!append) renderList([]);
      toast("Couldn't load discussions right now.", true);
    }
  }

  function appendThreads(threads) {
    var listEl = document.getElementById("discList");
    if (!listEl) return;
    var empty = listEl.querySelector(".reply-empty");
    if (empty) empty.remove();
    threads.forEach(function (t) {
      listEl.appendChild(discussCard(t));
    });
  }

  function updateLoadMore(totalPages) {
    var btn = document.getElementById("loadMore");
    if (!btn) return;
    btn.hidden = !totalPages || state.page >= totalPages;
  }

  function setFilter(key, value) {
    state[key] = value;
    state.page = 1;
    syncPills();
    if (key === "category") renderCategories({});
    load();
  }

  function setCategory(key) {
    setFilter("category", key);
    if (window.innerWidth <= 860) {
      var right = document.getElementById("forumRight");
      if (right) right.classList.remove("mobile-open");
    }
  }

  function setTag(tag) {
    state.tag = state.tag === tag ? null : tag;
    state.page = 1;
    load();
  }

  function syncPills() {
    Array.prototype.forEach.call(document.querySelectorAll("#typePills .filter-pill"), function (btn) {
      btn.classList.toggle("active", btn.dataset.type === state.type);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#statusPills .filter-pill"), function (btn) {
      btn.classList.toggle("active", btn.dataset.status === state.status);
    });
  }

  function clearQuery() {
    state.query = "";
    state.page = 1;
    var input = document.getElementById("forumSearchInput");
    if (input) input.value = "";
    if (state.sort === "best") state.sort = "recent";
    updateClearBtn();
    updateBestTab();
    load();
  }

  function updateClearBtn() {
    var input = document.getElementById("forumSearchInput");
    var btn = document.getElementById("searchClear");
    if (btn) btn.hidden = !(input && input.value);
  }

  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll(".filter-tab"), function (t) {
      var on = t.dataset.filter === state.sort && !t.hidden;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function updateBestTab() {
    var bestTab = document.querySelector('.filter-tab[data-filter="best"]');
    if (!bestTab) return;
    var searching = !!state.query;
    bestTab.hidden = !searching;
    if (searching) {
      if (state.sort === "recent") state.sort = "best";
    } else if (state.sort === "best") {
      state.sort = "recent";
    }
    syncTabs();
  }

  function onSearchInput() {
    var input = document.getElementById("forumSearchInput");
    if (!input) return;
    state.query = input.value.trim();
    state.page = 1;
    updateClearBtn();
    updateBestTab();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { load(); }, 280);
  }

  /* Modal */
  var lastFocusedBeforeModal = null;
  var DEFAULT_TYPE = "question";

  var TYPE_PLACEHOLDERS = {
    question: "Describe what you're trying to do, what you already tried, and what happened.",
    bug: "Include your game version, OS, the exact steps, and a log or screenshot if you can.",
    idea: "Explain the idea and why it helps. Mockups or examples welcome.",
    showcase: "Share screenshots, a link or the config, and a bit about how you made it.",
    guide: "Write the steps clearly; code blocks and screenshots help.",
    discussion: "What would you like to talk about?",
  };

  function selectType(type) {
    if (!TYPE_LABELS[type]) type = DEFAULT_TYPE;
    var hidden = document.getElementById("ndType");
    if (hidden) hidden.value = type;
    Array.prototype.forEach.call(document.querySelectorAll(".nd-type"), function (btn) {
      var on = btn.dataset.type === type;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    var hint = document.getElementById("ndTypeHint");
    if (hint) hint.textContent = TYPE_HINTS[type] || "";
    var body = document.getElementById("ndBody");
    if (body) body.placeholder = TYPE_PLACEHOLDERS[type] || "";
  }

  function updateTitleCount() {
    var title = document.getElementById("ndTitle");
    var count = document.getElementById("ndTitleCount");
    if (title && count) count.textContent = String((title.value || "").length);
  }

  function showNdError(message) {
    var box = document.getElementById("ndError");
    if (!box) return;
    box.textContent = message || "";
    box.hidden = !message;
    if (message) {
      var scroll = document.getElementById("ndScroll");
      if (scroll) scroll.scrollTop = 0;
    }
  }

  function isNdDirty() {
    var title = document.getElementById("ndTitle");
    var body = document.getElementById("ndBody");
    var tags = document.getElementById("ndTags");
    return !!(
      (title && title.value.trim()) ||
      (body && body.value.trim()) ||
      (tags && tags.value.trim())
    );
  }

  function resetModal() {
    var form = document.getElementById("newDiscussionForm");
    if (form) form.reset();
    selectType(DEFAULT_TYPE);
    updateTitleCount();
    showNdError("");
    setPreview(false);
    var similar = document.getElementById("ndSimilar");
    if (similar) {
      similar.hidden = true;
      similar.innerHTML = "";
    }
    var draftNote = document.getElementById("ndDraft");
    if (draftNote) draftNote.hidden = true;
  }

  var DRAFT_KEY = "cubyz-forum-draft-v1";
  var draftTimer = null;

  function readDraft() {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    } catch (err) {
      return null;
    }
  }

  function saveDraft() {
    var title = document.getElementById("ndTitle");
    var body = document.getElementById("ndBody");
    var tags = document.getElementById("ndTags");
    var draft = {
      title: title ? title.value : "",
      body: body ? body.value : "",
      tags: tags ? tags.value : "",
      type: document.getElementById("ndType").value,
      category: document.getElementById("ndCategory").value,
    };
    try {
      if (draft.title || draft.body || draft.tags) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      else localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      /* storage unavailable */
    }
  }

  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 500);
  }

  function clearDraft() {
    clearTimeout(draftTimer);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      /* ignore */
    }
    var note = document.getElementById("ndDraft");
    if (note) note.hidden = true;
  }

  function restoreDraft() {
    var draft = readDraft();
    if (!draft) return false;
    var title = document.getElementById("ndTitle");
    if (title && (title.value || "").trim()) return false;
    if (title) title.value = draft.title || "";
    var body = document.getElementById("ndBody");
    if (body) body.value = draft.body || "";
    var tags = document.getElementById("ndTags");
    if (tags) tags.value = draft.tags || "";
    if (draft.type) selectType(draft.type);
    var cat = document.getElementById("ndCategory");
    if (cat && draft.category) cat.value = draft.category;
    updateTitleCount();
    var note = document.getElementById("ndDraft");
    if (note) note.hidden = false;
    return true;
  }

  function openModal() {
    var modal = document.getElementById("newDiscussionModal");
    if (!modal) return;
    lastFocusedBeforeModal = document.activeElement;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    loadTagSuggestions();
    selectType(document.getElementById("ndType").value || DEFAULT_TYPE);
    updateTitleCount();
    showNdError("");
    restoreDraft();
    var title = document.getElementById("ndTitle");
    if (title) setTimeout(function () { title.focus(); }, 0);
  }

  function doClose() {
    var modal = document.getElementById("newDiscussionModal");
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    resetModal();
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") {
      lastFocusedBeforeModal.focus();
    }
  }

  function requestClose() {
    if (isNdDirty()) {
      if (!window.confirm("Discard this discussion? Your draft will be removed.")) return;
      clearDraft();
    }
    doClose();
  }

  function trapFocus(e) {
    if (e.key !== "Tab") return;
    var modal = document.getElementById("newDiscussionModal");
    if (!modal || !modal.classList.contains("open")) return;
    var nodes = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    var list = Array.prototype.filter.call(nodes, function (node) {
      return !node.disabled && node.offsetParent !== null;
    });
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function loadTagSuggestions() {
    var list = document.getElementById("tagSuggestions");
    if (!list) return;
    fetch("/api/forum/tags", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (!json.ok) return;
        list.innerHTML = "";
        (json.tags || []).forEach(function (t) {
          var opt = document.createElement("option");
          opt.value = t.name;
          list.appendChild(opt);
        });
      })
      .catch(function () {});
  }

  var similarTimer = null;
  function renderSimilar() {
    var box = document.getElementById("ndSimilar");
    var title = document.getElementById("ndTitle");
    if (!box || !title) return;
    var q = title.value.trim();
    if (q.length < 4) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    clearTimeout(similarTimer);
    similarTimer = setTimeout(async function () {
      try {
        var res = await fetch("/api/forum/search?q=" + encodeURIComponent(q), { credentials: "include" });
        var json = await res.json();
        if (!json.ok || !json.threads.length) {
          box.hidden = true;
          box.innerHTML = "";
          return;
        }
        box.innerHTML = "";
        box.appendChild(el("p", "nd-similar-title", "Possible existing answers"));
        json.threads.slice(0, 5).forEach(function (t) {
          var a = el("a", "nd-similar-item");
          a.href = threadLink(t);
          a.textContent = t.title;
          box.appendChild(a);
        });
        box.hidden = false;
      } catch (err) {
        box.hidden = true;
      }
    }, 300);
  }

  function setPreview(show) {
    var body = document.getElementById("ndBody");
    var preview = document.getElementById("ndPreview");
    var toolbar = document.getElementById("ndToolbar");
    var toggle = document.getElementById("ndPreviewToggle");
    if (!body || !preview || !toggle) return;
    if (show) {
      if (window.ForumMarkdown) {
        preview.innerHTML = window.ForumMarkdown.render(body.value || "");
      } else if (window.marked && window.DOMPurify) {
        var html = window.marked.parse(body.value || "", { breaks: true, gfm: true });
        preview.innerHTML = window.DOMPurify.sanitize(html);
      } else {
        preview.textContent = body.value;
      }
      if (window.ForumGallery) window.ForumGallery.enhance(preview);
      preview.hidden = false;
      body.hidden = true;
      if (toolbar) toolbar.hidden = true;
      toggle.textContent = "Edit";
    } else {
      preview.hidden = true;
      body.hidden = false;
      if (toolbar) toolbar.hidden = false;
      toggle.textContent = "Preview";
    }
  }

  async function submitNewDiscussion(e) {
    e.preventDefault();
    showNdError("");

    var title = document.getElementById("ndTitle").value.trim();
    if (title.length < 5) {
      showNdError("Give your discussion a title of at least 5 characters.");
      document.getElementById("ndTitle").focus();
      return;
    }
    var bodyVal = document.getElementById("ndBody").value.trim();
    if (bodyVal.length < 120) {
      showNdError("Please write at least 120 characters so people have enough context.");
      document.getElementById("ndBody").focus();
      return;
    }

    var payload = {
      title: title,
      type: document.getElementById("ndType").value || DEFAULT_TYPE,
      category: document.getElementById("ndCategory").value || "General",
      tags: document.getElementById("ndTags").value || "",
      body: bodyVal,
    };

    var submitBtn = document.getElementById("ndSubmit");
    var cancelBtn = document.getElementById("ndCancel");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Posting\u2026"; }
    if (cancelBtn) cancelBtn.disabled = true;

    try {
      var res = await fetch("/api/forum/threads", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var json = await res.json();
      if (res.status === 401) {
        showNdError("Your session expired. Please log in again.");
        promptLogin();
        return;
      }
      if (!json.ok) {
        showNdError(json.error || "Couldn't create the discussion.");
        return;
      }

      clearDraft();
      doClose();
      state.category = "all";
      state.type = "all";
      state.status = "all";
      state.tag = null;
      state.query = "";
      state.sort = "recent";
      state.page = 1;
      var input = document.getElementById("forumSearchInput");
      if (input) input.value = "";
      syncPills();
      updateClearBtn();
      updateBestTab();
      toast("Discussion posted.");
      load();
      loadActivity();
      loadContributors();
      loadTagSuggestions();
    } catch (err) {
      console.error("Failed to create discussion:", err);
      showNdError("Couldn't create the discussion. Check your connection and try again.");
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Post Discussion"; }
      if (cancelBtn) cancelBtn.disabled = false;
    }
  }

  function readUrl() {
    var params = new URLSearchParams(location.search);
    if (params.get("category") && CATEGORIES.some(function (c) { return c.key === params.get("category"); })) {
      state.category = params.get("category");
    }
    var type = params.get("type");
    if (["question", "bug", "idea", "showcase", "guide", "discussion"].indexOf(type) !== -1) {
      state.type = type;
    }
    var status = params.get("status");
    if (status === "open" || status === "solved") state.status = status;
    if (params.get("tag")) state.tag = params.get("tag").toLowerCase();
    if (params.get("q")) {
      state.query = params.get("q");
      var input = document.getElementById("forumSearchInput");
      if (input) input.value = state.query;
    }
    if (["recent", "active", "replies", "votes", "unanswered", "best"].indexOf(params.get("sort")) !== -1) {
      state.sort = params.get("sort");
    }
    if (!state.query && state.sort === "best") state.sort = "recent";
  }

  function wire() {
    var catList = document.getElementById("catList");
    if (catList) {
      catList.addEventListener("click", function (e) {
        var item = e.target.closest("[data-category]");
        if (!item) return;
        e.preventDefault();
        setCategory(item.dataset.category);
      });
    }

    var cloud = document.getElementById("tagCloud");
    if (cloud) {
      cloud.addEventListener("click", function (e) {
        var tag = e.target.closest("[data-tag]");
        if (!tag) return;
        e.preventDefault();
        setTag(tag.dataset.tag);
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll(".filter-tab"), function (tab) {
      tab.addEventListener("click", function () {
        if (tab.hidden) return;
        state.sort = tab.dataset.filter;
        state.page = 1;
        syncTabs();
        load();
      });
    });

    var viewBtns = document.querySelectorAll(".view-btn");
    Array.prototype.forEach.call(viewBtns, function (btn) {
      btn.addEventListener("click", function () {
        state.view = btn.dataset.view;
        Array.prototype.forEach.call(viewBtns, function (b) {
          var on = b === btn;
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
        var listEl = document.getElementById("discList");
        if (listEl) listEl.className = "disc-list" + (state.view === "grid" ? " grid" : "");
      });
    });

    var form = document.getElementById("searchForm");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        clearTimeout(searchTimer);
        var input = document.getElementById("forumSearchInput");
        state.query = (input && input.value.trim()) || "";
        state.page = 1;
        updateClearBtn();
        updateBestTab();
        load();
        if (window.innerWidth < 1180) {
          var left = document.getElementById("forumLeft");
          if (left) left.classList.remove("mobile-open");
        }
        var listEl = document.getElementById("discList");
        if (listEl) listEl.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    var searchInput = document.getElementById("forumSearchInput");
    if (searchInput) searchInput.addEventListener("input", onSearchInput);

    var searchClear = document.getElementById("searchClear");
    if (searchClear) searchClear.addEventListener("click", clearQuery);

    var githubToggle = document.getElementById("githubSearchToggle");
    if (githubToggle) {
      try {
        var savedGithub = localStorage.getItem("cubyz-forum-github");
        state.github = savedGithub === null ? true : savedGithub === "1";
      } catch (_) {
        state.github = true;
      }
      githubToggle.checked = state.github;
      githubToggle.addEventListener("change", function () {
        state.github = githubToggle.checked;
        try { localStorage.setItem("cubyz-forum-github", state.github ? "1" : "0"); } catch (_) {}
        if (state.query) load(); else githubQuery("");
      });
    }

    var typePills = document.getElementById("typePills");
    if (typePills) {
      typePills.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-type]");
        if (btn) setFilter("type", btn.dataset.type);
      });
    }
    var statusPills = document.getElementById("statusPills");
    if (statusPills) {
      statusPills.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-status]");
        if (btn) setFilter("status", btn.dataset.status);
      });
    }

    document.querySelectorAll("[data-toggle-aside]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.dataset.toggleAside);
        if (!target) return;
        var open = target.classList.toggle("mobile-open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });

    var moreTags = document.getElementById("moreTags");
    if (moreTags) {
      moreTags.addEventListener("click", function () {
        var cloudEl = document.getElementById("tagCloud");
        var showAll = cloudEl.classList.toggle("show-all");
        moreTags.textContent = showAll ? "Show fewer tags" : "More tags";
      });
    }

    var newBtn = document.getElementById("newDiscussionBtn");
    if (newBtn) newBtn.addEventListener("click", goNewDiscussion);
    var sideNew = document.getElementById("sideNewDiscussion");
    if (sideNew) sideNew.addEventListener("click", goNewDiscussion);

    var loadMore = document.getElementById("loadMore");
    if (loadMore) {
      loadMore.addEventListener("click", function () {
        state.page += 1;
        load(true);
      });
    }

    var closeBtn = document.getElementById("ndClose");
    if (closeBtn) closeBtn.addEventListener("click", requestClose);

    var cancel = document.getElementById("ndCancel");
    if (cancel) cancel.addEventListener("click", requestClose);

    var modal = document.getElementById("newDiscussionModal");
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) requestClose();
      });
    }
    document.addEventListener("keydown", function (e) {
      var open = modal && modal.classList.contains("open");
      if (!open) return;
      if (e.key === "Escape") requestClose();
      else if (e.key === "Tab") trapFocus(e);
    });

    var ndForm = document.getElementById("newDiscussionForm");
    if (ndForm) ndForm.addEventListener("submit", submitNewDiscussion);

    var ndTypes = document.getElementById("ndTypes");
    if (ndTypes) {
      ndTypes.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-type]");
        if (!btn) return;
        selectType(btn.dataset.type);
        scheduleDraftSave();
      });
    }

    var ndTitle = document.getElementById("ndTitle");
    if (ndTitle) {
      ndTitle.addEventListener("input", function () {
        updateTitleCount();
        showNdError("");
        renderSimilar();
        scheduleDraftSave();
      });
    }

    var ndToolbar = document.getElementById("ndToolbar");
    var ndBody = document.getElementById("ndBody");
    if (ndBody && window.ForumEditor) {
      window.ForumEditor.attach(ndBody, ndToolbar, {
        onError: function (message) { showNdError(message); },
      });
      ndBody.addEventListener("input", function () {
        showNdError("");
        scheduleDraftSave();
      });
    }

    var ndTags = document.getElementById("ndTags");
    if (ndTags) ndTags.addEventListener("input", scheduleDraftSave);

    var ndCategory = document.getElementById("ndCategory");
    if (ndCategory) ndCategory.addEventListener("change", scheduleDraftSave);

    var draftDiscard = document.getElementById("ndDraftDiscard");
    if (draftDiscard) {
      draftDiscard.addEventListener("click", function () {
        clearDraft();
        resetModal();
      });
    }

    var previewToggle = document.getElementById("ndPreviewToggle");
    if (previewToggle) {
      previewToggle.addEventListener("click", function () {
        setPreview(previewToggle.textContent === "Preview");
      });
    }
  }

  async function loadReports() {
    var panel = document.getElementById("reportsPanel");
    var list = document.getElementById("reportsList");
    if (!panel || !list) return;
    try {
      var res = await fetch("/api/forum/reports", { credentials: "include" });
      var json = await res.json();
      if (!json.ok) {
        panel.hidden = true;
        return;
      }
      panel.hidden = false;
      list.innerHTML = "";
      if (!json.reports.length) {
        list.appendChild(el("li", "reply-empty", "No open reports."));
        return;
      }
      json.reports.forEach(function (r) {
        var li = el("li", "report-item");
        var a = el("a", "report-link", (r.title || "(deleted)") + " · " + r.targetType);
        if (r.threadId) a.href = "/forum/t/" + r.threadId;
        li.appendChild(a);
        if (r.reason) li.appendChild(el("div", "report-reason", r.reason));
        var btn = el("button", "link-btn", "Resolve");
        btn.type = "button";
        btn.addEventListener("click", async function () {
          try {
            var rr = await fetch("/api/forum/reports/" + r.id + "/resolve", { method: "POST", credentials: "include" });
            var jj = await rr.json();
            if (!jj.ok) { toast(jj.error || "Couldn't resolve.", true); return; }
            loadReports();
          } catch (err) {
            toast("Couldn't resolve.", true);
          }
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
    } catch (err) {
      panel.hidden = true;
    }
  }

  async function initModeration() {
    try {
      var res = await fetch("/api/forum/whoami", { credentials: "include" });
      var json = await res.json();
      if (!json.ok) return;
      if (json.isModerator) loadReports();
      if (json.isAdmin) loadModerators();
    } catch (err) {
      /* not a moderator / not logged in */
    }
  }

  async function loadModerators() {
    var panel = document.getElementById("moderatorsPanel");
    var list = document.getElementById("modList");
    if (!panel || !list) return;
    try {
      var res = await fetch("/api/forum/moderators", { credentials: "include" });
      var json = await res.json();
      if (!json.ok) { panel.hidden = true; return; }
      panel.hidden = false;
      currentModerators = json.moderators || [];
      list.innerHTML = "";
      if (!json.moderators.length) {
        list.appendChild(el("li", "reply-empty", "No moderators yet."));
        return;
      }
      json.moderators.forEach(function (m) {
        var li = el("li", "mod-item");
        li.appendChild(el("span", "mod-name", m.username));
        var btn = el("button", "link-btn", "Remove");
        btn.type = "button";
        btn.addEventListener("click", async function () {
          try {
            var rr = await fetch("/api/forum/moderators/" + m.id, { method: "DELETE", credentials: "include" });
            var jj = await rr.json();
            if (!jj.ok) { toast(jj.error || "Couldn't remove.", true); return; }
            toast("Moderator removed.");
            loadModerators();
          } catch (err) {
            toast("Couldn't remove.", true);
          }
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
    } catch (err) {
      panel.hidden = true;
    }
  }

  function wireModAdd() {
    var form = document.getElementById("modAddForm");
    var input = document.getElementById("modAddInput");
    var results = document.getElementById("modSearchResults");
    if (!form || !input || !results) return;

    var timer = null;
    var matches = [];

    function closeResults() {
      matches = [];
      results.hidden = true;
      results.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
    }

    function renderResults(users) {
      results.innerHTML = "";
      matches = users;
      if (!users.length) {
        results.appendChild(el("div", "mod-search-empty", "No matching users."));
      } else {
        users.forEach(function (name) {
          var btn = el("button", "mod-search-item", name);
          btn.type = "button";
          btn.setAttribute("role", "option");
          btn.addEventListener("click", function () { addModerator(name); });
          results.appendChild(btn);
        });
      }
      results.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    async function addModerator(username) {
      var name = String(username || "").trim();
      if (!name) return;
      try {
        var res = await fetch("/api/forum/moderators", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: name }),
        });
        var json = await res.json();
        if (!json.ok) { toast(json.error || "Couldn't add moderator.", true); return; }
        input.value = "";
        closeResults();
        toast("Moderator added.");
        loadModerators();
      } catch (err) {
        toast("Couldn't add moderator.", true);
      }
    }

    input.addEventListener("input", function () {
      var q = input.value.trim();
      clearTimeout(timer);
      if (!q) { closeResults(); return; }
      timer = setTimeout(async function () {
        try {
          var res = await fetch("/api/users/search?q=" + encodeURIComponent(q), { credentials: "include" });
          var json = await res.json();
          var taken = currentModerators.map(function (m) { return m.username; });
          var users = (json.users || []).filter(function (u) { return !taken.includes(u); });
          renderResults(users);
        } catch (err) {
          closeResults();
        }
      }, 250);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (matches.length) addModerator(matches[0]);
      else addModerator(input.value);
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeResults();
    });

    document.addEventListener("click", function (e) {
      if (!e.target.closest(".mod-search")) closeResults();
    });
  }

  function showNoticeOnce() {
    var KEY = "cubyz-forum-notice-v1";
    var overlay = document.getElementById("forumNotice");
    if (!overlay) return;
    var seen = false;
    try {
      seen = localStorage.getItem(KEY) === "1";
    } catch (_) {
      seen = false;
    }
    if (seen) return;
    overlay.hidden = false;
    function dismiss() {
      overlay.hidden = true;
      try {
        localStorage.setItem(KEY, "1");
      } catch (_) {
        /* ignore */
      }
    }
    var closeBtn = document.getElementById("forumNoticeClose");
    if (closeBtn) closeBtn.addEventListener("click", dismiss);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) dismiss();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) dismiss();
    });
  }

  function init() {
    readUrl();
    syncPills();
    updateClearBtn();
    updateBestTab();
    wire();
    wireModAdd();
    load();
    loadActivity();
    loadContributors();
    loadAuthState();
    initModeration();
    showNoticeOnce();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
