(function () {
  "use strict";

  var TYPE_LABELS = { question: "Question", bug: "Bug", idea: "Idea", showcase: "Showcase", guide: "Guide", discussion: "Discussion" };
  var CATEGORIES = ["Game", "Addons & Mods", "Creation", "Development", "General"];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  var ICONS = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
    delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>',
    hide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><path d="M6.61 6.61A13.5 13.5 0 0 0 1 13s4 8 11 8a10.4 10.4 0 0 0 5.39-1.61"></path><line x1="2" y1="2" x2="22" y2="22"></line></svg>',
    unhide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 14 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H9a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z"></path></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
    unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>',
  };

  function setIconButton(btn, icon, label) {
    if (!btn) return;
    btn.innerHTML = icon;
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function iconBtn(icon, label, onClick) {
    var btn = el("button", "icon-btn");
    btn.type = "button";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = icon;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function toast(message, error) {
    if (typeof window.toast === "function") {
      (error ? window.toast.error : window.toast.info)(message);
    }
  }

  function sanitize(html) {
    if (window.DOMPurify) return window.DOMPurify.sanitize(html || "");
    return html || "";
  }

  function parseServerDate(value) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
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
    return months < 12 ? months + "mo ago" : Math.floor(months / 12) + "y ago";
  }

  function monthYear(value) {
    var d = parseServerDate(value);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", { month: "short", year: "numeric" });
  }

  var AVATAR_COLORS = ["#6ea8fe", "#f7b955", "#4dd4ac", "#c792ea", "#ff8fab", "#8fd08f", "#e0a458"];
  function colorFor(name) {
    var n = 0;
    for (var i = 0; i < (name || "").length; i++) n += name.charCodeAt(i);
    return AVATAR_COLORS[n % AVATAR_COLORS.length];
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
    span.style.setProperty("--av", color || colorFor(name));
    return span;
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  function threadLink(t) {
    return "/forum/t/" + t.id + (t.title ? "-" + slugify(t.title) : "");
  }

  function renderSide(data) {
    var thread = data.thread;
    var side = document.getElementById("threadSide");
    if (!side) return;

    var author = document.getElementById("sideAuthor");
    if (author) {
      author.innerHTML = "";
      var av = avatar(thread.author, null, thread.avatarUrl);
      av.classList.add("side-avatar");
      author.appendChild(av);
      var info = el("div", "side-author-info");
      var name = el("a", "side-author-name", thread.author);
      name.href = "/profile/" + encodeURIComponent(thread.author);
      info.appendChild(name);
      var sub = thread.authorCreatedAt ? "Member since " + monthYear(thread.authorCreatedAt) : "started this discussion";
      info.appendChild(el("span", "side-author-sub", sub));
      author.appendChild(info);
    }

    var stats = document.getElementById("sideStats");
    if (stats) {
      stats.innerHTML = "";
      [
        ["Votes", String(thread.votes || 0)],
        ["Replies", String(thread.replyCount || 0)],
        ["Views", String(thread.views || 0)],
        ["Created", relativeTime(thread.createdAt)],
        ["Last activity", relativeTime(thread.lastActivityAt || thread.createdAt)],
      ].forEach(function (row) {
        var li = el("li");
        li.appendChild(el("span", "", row[0]));
        li.appendChild(el("strong", "", row[1]));
        stats.appendChild(li);
      });
    }

    var tagsPanel = document.getElementById("sideTags");
    var tagCloud = document.getElementById("sideTagCloud");
    if (tagsPanel && tagCloud) {
      tagCloud.innerHTML = "";
      var tags = thread.tags || [];
      tagsPanel.hidden = tags.length === 0;
      tags.forEach(function (tag) {
        var a = el("a", "tag-pill", "#" + tag);
        a.href = "/forum?tag=" + encodeURIComponent(tag);
        tagCloud.appendChild(a);
      });
    }

    var catEl = document.getElementById("sideRelatedCat");
    if (catEl) catEl.textContent = thread.category;
    loadRelated(thread);

    side.hidden = false;
  }

  async function loadRelated(thread) {
    var list = document.getElementById("sideRelated");
    if (!list) return;
    list.innerHTML = "";
    try {
      var res = await fetch("/api/forum/threads?category=" + encodeURIComponent(thread.category) + "&sort=active", { credentials: "include" });
      var json = await res.json();
      if (!json.ok) throw new Error("failed");
      var others = (json.threads || []).filter(function (t) { return t.id !== thread.id; }).slice(0, 5);
      if (!others.length) {
        list.appendChild(el("li", "reply-empty", "No other discussions here yet."));
        return;
      }
      others.forEach(function (t) {
        var li = el("li", "side-related-item");
        var a = el("a", "side-related-link", t.title);
        a.href = threadLink(t);
        li.appendChild(a);
        li.appendChild(el("span", "side-related-meta", (t.replyCount || 0) + " replies \u00b7 " + relativeTime(t.lastActivityAt || t.createdAt)));
        list.appendChild(li);
      });
    } catch (err) {
      list.appendChild(el("li", "reply-empty", "Couldn't load related discussions."));
    }
  }

  var SVG_REPLY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';
  var SVG_UP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>';
  var SVG_CHECK = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';

  var threadId = parseInt((location.pathname.split("/").pop() || "").split("-")[0], 10);
  var thread = null;
  var threadCanEdit = false;
  var threadCanModerate = false;
  var replySort = "oldest";
  var currentPosts = [];
  var isLoggedIn = false;

  function promptLogin() {
    var trigger = document.getElementById("authBtn") || document.querySelector("[data-open-auth]");
    if (trigger) trigger.click();
  }

  function applyReplyAuth() {
    var form = document.getElementById("replyForm");
    var loginNote = document.getElementById("replyLogin");
    var lockedNote = document.getElementById("lockedNote");
    var locked = !!(thread && thread.locked);
    if (form) form.hidden = locked || !isLoggedIn;
    if (loginNote) loginNote.hidden = locked || isLoggedIn;
    if (lockedNote) lockedNote.hidden = !locked;
  }

  async function loadAuthState() {
    try {
      var res = await fetch("/api/auth/status", { credentials: "include" });
      var json = await res.json();
      isLoggedIn = !!(json && json.ok && json.user);
    } catch (err) {
      isLoggedIn = false;
    }
    applyReplyAuth();
  }

  function editorNode(value, rows) {
    var wrap = el("div", "md-editor");
    var toolbar = el("div", "md-toolbar");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Formatting");
    var ta = el("textarea");
    ta.rows = rows || 5;
    ta.value = value || "";
    if (window.ForumEditor) {
      window.ForumEditor.attach(ta, toolbar, { onError: function (message) { toast(message, true); } });
    }
    wrap.appendChild(toolbar);
    wrap.appendChild(ta);
    wrap._textarea = ta;
    return wrap;
  }

  function mdNode(html) {
    var div = el("div", "md-content");
    div.innerHTML = window.ForumMarkdown ? window.ForumMarkdown.sanitizePost(html) : sanitize(html);
    if (window.ForumGallery) window.ForumGallery.enhance(div);
    return div;
  }

  function replyVoteButton(p) {
    var btn = el("button", "reply-vote" + (p.voted ? " voted" : ""));
    btn.type = "button";
    btn.title = "Vote for this reply";
    btn.setAttribute("aria-label", "Vote for this reply");
    btn.innerHTML = SVG_UP + '<span class="reply-vote-count">' + p.votes + "</span>";
    btn.addEventListener("click", async function () {
      try {
        var res = await fetch("/api/forum/posts/" + p.id + "/vote", { method: "POST", credentials: "include" });
        var json = await res.json();
        if (res.status === 401) { promptLogin(); return; }
        if (!json.ok) { toast(json.error || "Couldn't vote.", true); return; }
        btn.classList.toggle("voted", json.voted);
        btn.querySelector(".reply-vote-count").textContent = String(json.votes);
      } catch (err) {
        console.error("Post vote failed:", err);
        toast("Couldn't vote.", true);
      }
    });
    return btn;
  }

  function acceptControl(p) {
    if (!threadCanEdit) return null;
    var accepted = thread.acceptedPostId === p.id;
    var btn = el("button", "link-btn", accepted ? "Unmark answer" : "Mark as answer");
    btn.type = "button";
    btn.addEventListener("click", async function () {
      try {
        var res = await fetch("/api/forum/threads/" + thread.id + "/accept", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId: accepted ? 0 : p.id }),
        });
        var json = await res.json();
        if (res.status === 401) { promptLogin(); return; }
        if (!json.ok) { toast(json.error || "Couldn't update.", true); return; }
        toast(accepted ? "Answer unmarked." : "Answer accepted.");
        await loadThread();
      } catch (err) {
        console.error("Accept failed:", err);
        toast("Couldn't update.", true);
      }
    });
    return btn;
  }

  function reportTarget(type, id) {
    var reason = window.prompt("Why are you reporting this?");
    if (reason === null) return;
    var url = "/api/forum/" + (type === "thread" ? "threads/" : "posts/") + id + "/report";
    fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason }),
    })
      .then(function (r) {
        if (r.status === 401) {
          promptLogin();
          return null;
        }
        return r.json();
      })
      .then(function (json) {
        if (!json) return;
        if (json.ok) toast("Thanks — a moderator will review it.");
        else toast(json.error || "Couldn't submit report.", true);
      })
      .catch(function () { toast("Couldn't submit report.", true); });
  }

  function quoteReply(p) {
    if (!isLoggedIn) {
      promptLogin();
      return;
    }
    var input = document.getElementById("replyInput");
    if (!input) return;
    var quoted = String(p.body || "")
      .split("\n")
      .map(function (line) { return "> " + line; })
      .join("\n");
    var block = "> **" + p.author + "** wrote:\n" + quoted + "\n\n";
    var existing = input.value;
    input.value = existing.trim() ? existing.replace(/\s*$/, "") + "\n\n" + block : block;
    input.focus();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function replyNode(p) {
    var accepted = thread && thread.acceptedPostId === p.id;
    var li = el("li", "reply-item" + (accepted ? " accepted" : ""));
    li.dataset.postId = String(p.id);
    li.id = "reply-" + p.id;
    li.appendChild(replyVoteButton(p));
    li.appendChild(avatar(p.author, null, p.avatarUrl));

    var body = el("div", "reply-body");
    var head = el("div", "reply-head");
    head.appendChild(el("strong", "", p.author));
    var timeLink = el("a", "reply-time", relativeTime(p.createdAt));
    timeLink.href = "#reply-" + p.id;
    timeLink.title = "Link to this reply";
    head.appendChild(timeLink);
    if (p.editedAt) head.appendChild(el("span", "reply-edited", "edited"));
    if (accepted) {
      var badge = el("span", "badge badge-solved");
      badge.innerHTML = SVG_CHECK + " Accepted answer";
      head.appendChild(badge);
    }
    if (p.hidden) head.appendChild(el("span", "badge badge-hidden", "Hidden"));

    var controls = el("div", "post-owner-actions");
    var accept = acceptControl(p);
    if (accept) controls.appendChild(accept);
    var quoteBtn = el("button", "link-btn", "Quote");
    quoteBtn.type = "button";
    quoteBtn.addEventListener("click", function () { quoteReply(p); });
    controls.appendChild(quoteBtn);
    if (p.canEdit) {
      controls.appendChild(iconBtn(ICONS.edit, "Edit", function () { startReplyEdit(p, li); }));
      controls.appendChild(iconBtn(ICONS.delete, "Delete", function () { deleteReply(p); }));
    }
    if (threadCanModerate) {
      controls.appendChild(iconBtn(p.hidden ? ICONS.unhide : ICONS.hide, p.hidden ? "Unhide" : "Hide", function () { togglePostHidden(p); }));
    }
    var divider = el("span", "post-action-divider");
    divider.setAttribute("aria-hidden", "true");
    controls.appendChild(divider);
    controls.appendChild(iconBtn(ICONS.report, "Report", function () { reportTarget("post", p.id); }));
    head.appendChild(controls);
    body.appendChild(head);

    if (p.hidden && !threadCanModerate && !p.canEdit) {
      var note = el("div", "reply-text hidden-note", "Hidden by a moderator.");
      body.appendChild(note);
    } else {
      var text = mdNode(p.bodyHtml);
      text.classList.add("reply-text");
      body.appendChild(text);
    }
    li.appendChild(body);
    return li;
  }

  async function togglePostHidden(p) {
    try {
      var res = await fetch("/api/forum/posts/" + p.id + "/hide", { method: "POST", credentials: "include" });
      var json = await res.json();
      if (!json.ok) { toast(json.error || "Couldn't update visibility.", true); return; }
      toast(json.hidden ? "Reply hidden." : "Reply visible again.");
      await loadThread();
    } catch (err) {
      console.error("Hide reply failed:", err);
      toast("Couldn't update visibility.", true);
    }
  }

  function orderedReplies(posts) {
    var acceptedId = thread && thread.acceptedPostId;
    var rest = posts.filter(function (p) { return !acceptedId || p.id !== acceptedId; });
    if (replySort === "newest") rest.reverse();
    else if (replySort === "votes") {
      rest.sort(function (a, b) { return (b.votes || 0) - (a.votes || 0); });
    }
    if (!acceptedId) return rest;
    var accepted = posts.filter(function (p) { return p.id === acceptedId; });
    return accepted.concat(rest);
  }

  function renderReplies(posts) {
    var list = document.getElementById("replyList");
    if (!list) return;
    list.innerHTML = "";
    if (!posts.length) {
      // A locked thread with no replies just shows the "locked" note.
      if (!(thread && thread.locked)) {
        list.appendChild(el("li", "reply-empty", "No replies yet — be the first to help."));
      }
      return;
    }
    orderedReplies(posts).forEach(function (p) { list.appendChild(replyNode(p)); });
    highlightHashReply();
  }

  function highlightHashReply() {
    var match = /^#reply-(\d+)$/.exec(location.hash || "");
    if (!match) return;
    var node = document.getElementById("reply-" + match[1]);
    if (!node) return;
    setTimeout(function () {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.classList.add("reply-highlight");
      setTimeout(function () { node.classList.remove("reply-highlight"); }, 2200);
    }, 60);
  }

  function renderThread(data) {
    thread = data.thread;
    threadCanEdit = !!data.canEdit;
    threadCanModerate = !!data.canModerate;
    document.title = thread.title + " · Cubyz Hub";

    var crumbCat = document.getElementById("crumbCategory");
    if (crumbCat) {
      crumbCat.textContent = thread.category;
      crumbCat.href = "/forum?category=" + encodeURIComponent(thread.category);
    }
    var crumbTitle = document.getElementById("crumbTitle");
    if (crumbTitle) crumbTitle.textContent = thread.title;
    renderSide(data);

    var catWrap = document.getElementById("threadCategoryWrap");
    catWrap.innerHTML = "";
    catWrap.appendChild(el("span", "badge badge-type", thread.category));
    if (thread.type && thread.type !== "discussion") {
      catWrap.appendChild(el("span", "badge badge-type-" + thread.type, TYPE_LABELS[thread.type] || thread.type));
    }
    if (thread.pinned) catWrap.appendChild(el("span", "badge badge-pinned", "Pinned"));
    if (thread.locked) catWrap.appendChild(el("span", "badge badge-locked", "Locked"));
    if (thread.hidden) catWrap.appendChild(el("span", "badge badge-hidden", "Hidden"));

    document.getElementById("threadTitle").textContent = thread.title;

    var meta = document.getElementById("threadMeta");
    meta.innerHTML = "";
    meta.appendChild(avatar(thread.author, null, thread.avatarUrl));
    meta.appendChild(el("span", "", thread.author));
    meta.appendChild(el("span", "", "\u00b7 " + relativeTime(thread.createdAt)));
    meta.appendChild(el("span", "", "\u00b7 " + thread.views + " views"));
    if (thread.editedAt) meta.appendChild(el("span", "reply-edited", "edited"));

    var tags = document.getElementById("threadTags");
    tags.innerHTML = "";
    (thread.tags || []).forEach(function (t) {
      var tag = el("a", "tag-mini", "#" + t);
      tag.href = "/forum?tag=" + encodeURIComponent(t);
      tags.appendChild(tag);
    });

    var body = document.getElementById("threadBody");
    body.innerHTML = "";
    body.appendChild(mdNode(thread.bodyHtml));

    document.getElementById("threadVotes").textContent = String(thread.votes);
    document.getElementById("threadRepliesStat").innerHTML = SVG_REPLY + " " + thread.replyCount + " replies";
    document.getElementById("threadSolved").hidden = !thread.solved;
    var repliesTitle = document.getElementById("threadRepliesTitle");
    repliesTitle.textContent = "Replies (" + thread.replyCount + ")";
    repliesTitle.hidden = !!thread.locked && (thread.replyCount || 0) === 0;

    var replySortEl = document.getElementById("replySort");
    if (replySortEl) {
      var sortWrap = replySortEl.closest(".reply-sort");
      if (sortWrap) sortWrap.hidden = !!thread.locked;
    }

    document.getElementById("threadVoteBtn").classList.toggle("voted", !!data.voted);
    document.getElementById("threadOwnerActions").hidden = !data.canEdit;

    var modActions = document.getElementById("threadModActions");
    if (modActions) {
      modActions.hidden = !threadCanModerate;
      if (threadCanModerate) {
        setIconButton(document.getElementById("threadPinBtn"), ICONS.pin, thread.pinned ? "Unpin" : "Pin");
        setIconButton(document.getElementById("threadLockBtn"), thread.locked ? ICONS.unlock : ICONS.lock, thread.locked ? "Unlock" : "Lock");
        setIconButton(document.getElementById("threadHideBtn"), thread.hidden ? ICONS.unhide : ICONS.hide, thread.hidden ? "Unhide" : "Hide");
      }
    }

    applyReplyAuth();

    currentPosts = data.posts || [];
    renderReplies(currentPosts);

    document.getElementById("threadLoading").hidden = true;
    document.getElementById("threadView").hidden = false;
  }

  function showError(message) {
    var loading = document.getElementById("threadLoading");
    if (loading) {
      loading.textContent = message;
      loading.hidden = false;
    }
  }

  async function loadThread() {
    if (!Number.isInteger(threadId)) {
      showError("This discussion link looks invalid.");
      return;
    }
    if (window.__FORUM_INITIAL__ && window.__FORUM_INITIAL__.thread && window.__FORUM_INITIAL__.thread.id === threadId) {
      var initial = window.__FORUM_INITIAL__;
      window.__FORUM_INITIAL__ = null;
      renderThread(initial);
      return;
    }
    try {
      var res = await fetch("/api/forum/threads/" + threadId, { credentials: "include" });
      var json = await res.json();
      if (!json.ok) {
        showError(json.error || "Discussion not found.");
        return;
      }
      renderThread(json);
    } catch (err) {
      console.error("Failed to load thread:", err);
      showError("Couldn't load this discussion right now.");
    }
  }

  /* Thread editing */
  function endThreadEdit() {
    var overlay = document.getElementById("threadEditOverlay");
    if (overlay) overlay.remove();
    document.body.classList.remove("thread-edit-open");
  }

  function startThreadEdit() {
    if (!thread) return;
    if (document.getElementById("threadEditOverlay")) return;

    var overlay = el("div", "thread-edit-overlay");
    overlay.id = "threadEditOverlay";

    var form = el("form", "compose-card thread-edit-modal");
    form.setAttribute("data-view", "split");
    form.noValidate = true;

    var topbar = el("div", "thread-edit-topbar");
    topbar.appendChild(el("h2", "thread-edit-title", "Edit discussion"));
    var topbarActions = el("div", "thread-edit-topbar-actions");
    var cancelBtn = el("button", "btn btn-ghost", "Cancel");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", endThreadEdit);
    var saveBtn = el("button", "btn btn-primary", "Save changes");
    saveBtn.type = "submit";
    topbarActions.appendChild(cancelBtn);
    topbarActions.appendChild(saveBtn);
    topbar.appendChild(topbarActions);
    form.appendChild(topbar);

    var titleField = el("div", "field");
    titleField.appendChild(el("label", "", "Title"));
    var titleInput = el("input");
    titleInput.type = "text";
    titleInput.maxLength = 67;
    titleInput.value = thread.title || "";
    titleField.appendChild(titleInput);
    var titleCount = el("p", "field-hint nd-title-hint");
    var titleCountNum = el("span", "", String(titleInput.value.length));
    titleCount.appendChild(titleCountNum);
    titleCount.appendChild(document.createTextNode("/67 \u00b7 at least 5 characters"));
    titleField.appendChild(titleCount);
    form.appendChild(titleField);

    var row = el("div", "nd-row");
    var typeField = el("div", "field");
    typeField.appendChild(el("label", "", "Type"));
    var typeSel = el("select");
    Object.keys(TYPE_LABELS).forEach(function (k) {
      var o = el("option", "", TYPE_LABELS[k]);
      o.value = k;
      if (k === thread.type) o.selected = true;
      typeSel.appendChild(o);
    });
    typeField.appendChild(typeSel);
    row.appendChild(typeField);

    var catField = el("div", "field");
    catField.appendChild(el("label", "", "Category"));
    var catSel = el("select");
    CATEGORIES.forEach(function (c) {
      var o = el("option", "", c);
      o.value = c;
      if (c === thread.category) o.selected = true;
      catSel.appendChild(o);
    });
    catField.appendChild(catSel);
    row.appendChild(catField);
    form.appendChild(row);

    var tagsField = el("div", "field");
    tagsField.appendChild(el("label", "", "Tags (comma separated)"));
    var tagsInput = el("input");
    tagsInput.type = "text";
    tagsInput.value = (thread.tags || []).join(", ");
    tagsField.appendChild(tagsInput);
    form.appendChild(tagsField);

    var bodyField = el("div", "field");
    var bodyHead = el("div", "nd-body-head");
    var bodyLabel = el("label");
    bodyLabel.appendChild(document.createTextNode("Body "));
    bodyLabel.appendChild(el("span", "muted", "(Markdown supported, min 120 characters)"));
    bodyHead.appendChild(bodyLabel);
    var toggle = el("div", "compose-view-toggle");
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", "Editor view");
    ["write", "split", "preview"].forEach(function (v) {
      var b = el("button", "", v.charAt(0).toUpperCase() + v.slice(1));
      b.type = "button";
      b.dataset.view = v;
      if (v === "split") b.classList.add("active");
      toggle.appendChild(b);
    });
    bodyHead.appendChild(toggle);
    bodyField.appendChild(bodyHead);

    var toolbar = el("div", "md-toolbar");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Formatting");
    bodyField.appendChild(toolbar);

    var split = el("div", "compose-editor-split");
    var ta = el("textarea");
    ta.rows = 16;
    ta.value = thread.body || "";
    var preview = el("div", "md-preview compose-live-preview");
    split.appendChild(ta);
    split.appendChild(preview);
    bodyField.appendChild(split);
    form.appendChild(bodyField);

    overlay.appendChild(form);
    document.body.appendChild(overlay);
    document.body.classList.add("thread-edit-open");

    if (window.ForumEditor) {
      window.ForumEditor.attach(ta, toolbar, { onError: function (message) { toast(message, true); } });
    }

    titleInput.addEventListener("input", function () {
      titleCountNum.textContent = String(titleInput.value.length);
    });

    var previewTimer = null;
    function renderEditPreview() {
      if (window.ForumMarkdown) {
        preview.innerHTML = window.ForumMarkdown.render(ta.value || "");
      } else if (window.marked && window.DOMPurify) {
        var html = window.marked.parse(ta.value || "", { breaks: true, gfm: true });
        preview.innerHTML = window.DOMPurify.sanitize(html);
      } else {
        preview.textContent = ta.value;
      }
      if (window.ForumGallery) window.ForumGallery.enhance(preview);
    }
    ta.addEventListener("input", function () {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(renderEditPreview, 150);
    });
    renderEditPreview();

    toggle.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-view]");
      if (!btn) return;
      form.setAttribute("data-view", btn.dataset.view);
      Array.prototype.forEach.call(toggle.querySelectorAll("button"), function (b) {
        b.classList.toggle("active", b === btn);
      });
      if (btn.dataset.view !== "write") renderEditPreview();
      ta.focus();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      saveThreadEdit({ titleInput, typeSel, catSel, tagsInput, ta, saveBtn, renderEditPreview });
    });

    document.addEventListener("keydown", function onKey(e) {
      if (!document.getElementById("threadEditOverlay")) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      if (e.key === "Escape") endThreadEdit();
      else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        saveThreadEdit({ titleInput, typeSel, catSel, tagsInput, ta, saveBtn, renderEditPreview });
      }
    });

    titleInput.focus();
  }

  async function saveThreadEdit(ctx) {
    var title = ctx.titleInput.value.trim();
    var body = ctx.ta.value.trim();
    if (title.length < 5) { toast("Title must be at least 5 characters.", true); return; }
    if (body.length < 120) { toast("Please write at least 120 characters so people have enough context.", true); return; }
    ctx.saveBtn.disabled = true;
    try {
      var res = await fetch("/api/forum/threads/" + thread.id, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title,
          body: body,
          type: ctx.typeSel.value,
          category: ctx.catSel.value,
          tags: ctx.tagsInput.value,
        }),
      });
      var json = await res.json();
      if (!json.ok) { toast(json.error || "Couldn't save changes.", true); return; }
      toast("Discussion updated.");
      endThreadEdit();
      await loadThread();
    } catch (err) {
      console.error("Edit failed:", err);
      toast("Couldn't save changes.", true);
    } finally {
      ctx.saveBtn.disabled = false;
    }
  }

  async function deleteThread() {
    if (!thread) return;
    if (!window.confirm("Delete this discussion and all its replies?")) return;
    try {
      var res = await fetch("/api/forum/threads/" + thread.id, { method: "DELETE", credentials: "include" });
      var json = await res.json();
      if (res.status === 401) { promptLogin(); return; }
      if (!json.ok) { toast(json.error || "Couldn't delete.", true); return; }
      window.location.href = "/forum";
    } catch (err) {
      console.error("Delete failed:", err);
      toast("Couldn't delete.", true);
    }
  }

  function startReplyEdit(p, li) {
    var text = li.querySelector(".reply-text");
    if (!text || li.querySelector(".md-editor")) return;
    var editor = editorNode(p.body, 4);
    text.hidden = true;
    text.parentNode.insertBefore(editor, text.nextSibling);

    var buttons = el("div", "inline-actions");
    var cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", function () {
      editor.remove();
      buttons.remove();
      text.hidden = false;
    });
    var save = el("button", "btn btn-primary btn-sm", "Save");
    save.type = "button";
    save.addEventListener("click", function () { saveReplyEdit(p, editor, save, cancel); });
    buttons.appendChild(cancel);
    buttons.appendChild(save);
    editor.parentNode.insertBefore(buttons, editor.nextSibling);
    editor._textarea.focus();
  }

  async function saveReplyEdit(p, editor, save, cancel) {
    var value = editor._textarea.value.trim();
    if (!value) { toast("Reply can't be empty.", true); return; }
    save.disabled = true;
    try {
      var res = await fetch("/api/forum/posts/" + p.id, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: value }),
      });
      var json = await res.json();
      if (!json.ok) { toast(json.error || "Couldn't save reply.", true); return; }
      toast("Reply updated.");
      await loadThread();
    } catch (err) {
      console.error("Reply edit failed:", err);
      toast("Couldn't save reply.", true);
    } finally {
      save.disabled = false;
    }
  }

  async function deleteReply(p) {
    if (!window.confirm("Delete this reply?")) return;
    try {
      var res = await fetch("/api/forum/posts/" + p.id, { method: "DELETE", credentials: "include" });
      var json = await res.json();
      if (res.status === 401) { promptLogin(); return; }
      if (!json.ok) { toast(json.error || "Couldn't delete reply.", true); return; }
      toast("Reply deleted.");
      await loadThread();
    } catch (err) {
      console.error("Reply delete failed:", err);
      toast("Couldn't delete reply.", true);
    }
  }

  function wire() {
    var replySortEl = document.getElementById("replySort");
    if (replySortEl) {
      replySortEl.value = replySort;
      replySortEl.addEventListener("change", function () {
        replySort = replySortEl.value;
        renderReplies(currentPosts);
      });
    }

    var shareBtn = document.getElementById("sideShare");
    if (shareBtn) {
      shareBtn.addEventListener("click", function () {
        var url = location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(
            function () { toast("Link copied to clipboard."); },
            function () { toast("Couldn't copy link.", true); }
          );
        } else {
          window.prompt("Copy this link:", url);
        }
      });
    }

    var editBtn = document.getElementById("threadEditBtn");
    if (editBtn) editBtn.addEventListener("click", startThreadEdit);
    var deleteBtn = document.getElementById("threadDeleteBtn");
    if (deleteBtn) deleteBtn.addEventListener("click", deleteThread);

    var reportBtn = document.getElementById("threadReportBtn");
    if (reportBtn) {
      reportBtn.addEventListener("click", function () {
        if (thread) reportTarget("thread", thread.id);
      });
    }

    var pinBtn = document.getElementById("threadPinBtn");
    if (pinBtn) {
      pinBtn.addEventListener("click", async function () {
        try {
          var res = await fetch("/api/forum/threads/" + thread.id + "/pin", { method: "POST", credentials: "include" });
          var json = await res.json();
          if (!json.ok) { toast(json.error || "Couldn't update.", true); return; }
          toast(json.pinned ? "Pinned." : "Unpinned.");
          await loadThread();
        } catch (err) {
          console.error("Pin failed:", err);
          toast("Couldn't update.", true);
        }
      });
    }

    var lockBtn = document.getElementById("threadLockBtn");
    if (lockBtn) {
      lockBtn.addEventListener("click", async function () {
        try {
          var res = await fetch("/api/forum/threads/" + thread.id + "/lock", { method: "POST", credentials: "include" });
          var json = await res.json();
          if (!json.ok) { toast(json.error || "Couldn't update.", true); return; }
          toast(json.locked ? "Locked." : "Unlocked.");
          await loadThread();
        } catch (err) {
          console.error("Lock failed:", err);
          toast("Couldn't update.", true);
        }
      });
    }

    var threadHideBtn = document.getElementById("threadHideBtn");
    if (threadHideBtn) {
      threadHideBtn.addEventListener("click", async function () {
        try {
          var res = await fetch("/api/forum/threads/" + thread.id + "/hide", { method: "POST", credentials: "include" });
          var json = await res.json();
          if (!json.ok) { toast(json.error || "Couldn't update visibility.", true); return; }
          toast(json.hidden ? "Hidden from public view." : "Visible again.");
          await loadThread();
        } catch (err) {
          console.error("Hide failed:", err);
          toast("Couldn't update visibility.", true);
        }
      });
    }

    var voteBtn = document.getElementById("threadVoteBtn");
    if (voteBtn) {
      voteBtn.addEventListener("click", async function () {
        if (!thread) return;
        try {
          var res = await fetch("/api/forum/threads/" + thread.id + "/vote", { method: "POST", credentials: "include" });
          var json = await res.json();
          if (res.status === 401) { promptLogin(); return; }
          if (!json.ok) { toast(json.error || "Couldn't register that vote.", true); return; }
          thread.votes = json.votes;
          voteBtn.classList.toggle("voted", json.voted);
          document.getElementById("threadVotes").textContent = String(json.votes);
        } catch (err) {
          console.error("Vote failed:", err);
          toast("Couldn't register that vote.", true);
        }
      });
    }

    var toolbar = document.getElementById("replyToolbar");
    var replyInput = document.getElementById("replyInput");
    if (toolbar && replyInput && window.ForumEditor) {
      window.ForumEditor.attach(replyInput, toolbar, { onError: function (message) { toast(message, true); } });
    }

    var form = document.getElementById("replyForm");
    if (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!thread) return;
        var input = document.getElementById("replyInput");
        var text = (input && input.value.trim()) || "";
        if (!text) return;
        try {
          var res = await fetch("/api/forum/threads/" + thread.id + "/posts", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: text }),
          });
          var json = await res.json();
          if (res.status === 401) { promptLogin(); return; }
          if (!json.ok) { toast(json.error || "Couldn't post your reply.", true); return; }
          input.value = "";
          toast("Reply posted.");
          await loadThread();
        } catch (err) {
          console.error("Reply failed:", err);
          toast("Couldn't post your reply.", true);
        }
      });
    }
  }

  function init() {
    wire();
    loadAuthState();
    loadThread();
    window.addEventListener("hashchange", highlightHashReply);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
