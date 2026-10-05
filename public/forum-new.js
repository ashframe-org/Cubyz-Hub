(function () {
  "use strict";

  var TYPE_LABELS = { question: "Question", bug: "Bug", idea: "Idea", showcase: "Showcase", guide: "Guide", discussion: "Discussion" };
  var TYPE_HINTS = {
    question: "Describe what you're trying to do, what you already tried, and what happened.",
    bug: "Include your game version, OS, the exact steps, and a log or screenshot if you can.",
    idea: "Explain the idea and why it helps. Mockups or examples welcome.",
    showcase: "Share screenshots, a link or the config, and a bit about how you made it.",
    guide: "Walk through the steps clearly; code blocks and screenshots help.",
    discussion: "No special format. Just start the conversation.",
  };
  var TYPE_PLACEHOLDERS = {
    question: "Describe what you're trying to do, what you already tried, and what happened.",
    bug: "Include your game version, OS, the exact steps, and a log or screenshot if you can.",
    idea: "Explain the idea and why it helps. Mockups or examples welcome.",
    showcase: "Share screenshots, a link or the config, and a bit about how you made it.",
    guide: "Write the steps clearly; code blocks and screenshots help.",
    discussion: "What would you like to talk about?",
  };
  var DEFAULT_TYPE = "question";
  var DRAFT_KEY = "cubyz-forum-draft-v1";
  var draftTimer = null;
  var previewTimer = null;
  var similarTimer = null;
  var view = "write";

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  function draftStatus(text) {
    var node = document.getElementById("ndDraftStatus");
    if (node) node.textContent = text || "";
  }

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

  function showError(message) {
    var box = document.getElementById("ndError");
    if (!box) return;
    box.textContent = message || "";
    box.hidden = !message;
    if (message) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* Drafts */
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
      if (draft.title || draft.body || draft.tags) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        draftStatus("Draft saved");
      } else {
        localStorage.removeItem(DRAFT_KEY);
        draftStatus("");
      }
    } catch (err) {
      /* storage unavailable */
    }
  }

  function scheduleDraftSave() {
    draftStatus("Unsaved changes");
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
    draftStatus("");
  }

  function restoreDraft() {
    var draft = null;
    try {
      draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    } catch (err) {
      draft = null;
    }
    if (!draft) return;
    var title = document.getElementById("ndTitle");
    if (title && (title.value || "").trim()) return;
    if (title) title.value = draft.title || "";
    document.getElementById("ndBody").value = draft.body || "";
    document.getElementById("ndTags").value = draft.tags || "";
    if (draft.type) selectType(draft.type);
    var cat = document.getElementById("ndCategory");
    if (cat && draft.category) cat.value = draft.category;
    updateTitleCount();
    var note = document.getElementById("ndDraft");
    if (note) note.hidden = false;
    draftStatus("Draft restored");
  }

  /* Live preview */
  function renderLivePreview() {
    var body = document.getElementById("ndBody");
    var preview = document.getElementById("ndPreview");
    if (!body || !preview) return;
    var value = body.value.trim();
    if (value && window.ForumMarkdown) {
      preview.innerHTML = window.ForumMarkdown.render(value);
    } else if (window.marked && window.DOMPurify) {
      preview.innerHTML = value
        ? window.DOMPurify.sanitize(window.marked.parse(value, { breaks: true, gfm: true }))
        : '<p class="md-empty">Nothing to preview yet.</p>';
    } else {
      preview.textContent = value;
    }
    if (window.ForumGallery) window.ForumGallery.enhance(preview);
  }

  function scheduleLivePreview() {
    if (view === "write") return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderLivePreview, 150);
  }

  function setView(next) {
    view = ["write", "split", "preview"].indexOf(next) !== -1 ? next : "write";
    var card = document.getElementById("newDiscussionForm");
    if (card) card.dataset.view = view;
    Array.prototype.forEach.call(document.querySelectorAll(".compose-view-toggle button"), function (b) {
      b.classList.toggle("active", b.dataset.view === view);
    });
    if (view !== "write") renderLivePreview();
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

  function renderSimilar() {
    var box = document.getElementById("ndSimilar");
    var empty = document.getElementById("ndSimilarEmpty");
    var title = document.getElementById("ndTitle");
    if (!box || !title) return;
    var q = title.value.trim();
    if (q.length < 4) {
      box.innerHTML = "";
      if (empty) { empty.hidden = false; empty.textContent = "Type a title to check for duplicates."; }
      return;
    }
    clearTimeout(similarTimer);
    similarTimer = setTimeout(function () {
      fetch("/api/forum/search?q=" + encodeURIComponent(q), { credentials: "include" })
        .then(function (r) { return r.json(); })
        .then(function (json) {
          box.innerHTML = "";
          if (!json.ok || !json.threads.length) {
            if (empty) { empty.hidden = false; empty.textContent = "No similar discussions. Nice."; }
            return;
          }
          if (empty) empty.hidden = true;
          json.threads.slice(0, 6).forEach(function (t) {
            var a = el("a", "nd-similar-item", t.title);
            a.href = "/forum/t/" + t.id + (t.title ? "-" + slugify(t.title) : "");
            box.appendChild(a);
          });
        })
        .catch(function () {});
    }, 300);
  }

  async function submit(e) {
    e.preventDefault();
    showError("");

    var title = document.getElementById("ndTitle").value.trim();
    if (title.length < 5) {
      showError("Give your discussion a title of at least 5 characters.");
      document.getElementById("ndTitle").focus();
      return;
    }
    var bodyVal = document.getElementById("ndBody").value.trim();
    if (bodyVal.length < 120) {
      showError("Please write at least 120 characters so people have enough context.");
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
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Posting\u2026"; }

    try {
      var res = await fetch("/api/forum/threads", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var json = await res.json();
      if (res.status === 401) {
        showError("Please log in to start a discussion.");
        return;
      }
      if (!json.ok) {
        showError(json.error || "Couldn't create the discussion.");
        return;
      }
      clearDraft();
      window.location.href = "/forum/t/" + json.id + (title ? "-" + slugify(title) : "");
    } catch (err) {
      console.error("Failed to create discussion:", err);
      showError("Couldn't create the discussion. Check your connection and try again.");
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Post Discussion"; }
    }
  }

  function wire() {
    var form = document.getElementById("newDiscussionForm");
    if (form) form.addEventListener("submit", submit);

    var types = document.getElementById("ndTypes");
    if (types) {
      types.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-type]");
        if (!btn) return;
        selectType(btn.dataset.type);
        scheduleDraftSave();
      });
    }

    var title = document.getElementById("ndTitle");
    if (title) {
      title.addEventListener("input", function () {
        updateTitleCount();
        showError("");
        renderSimilar();
        scheduleDraftSave();
      });
    }

    var toolbar = document.getElementById("ndToolbar");
    var body = document.getElementById("ndBody");
    if (body && window.ForumEditor) {
      window.ForumEditor.attach(body, toolbar, { onError: function (m) { showError(m); } });
      body.addEventListener("input", function () {
        showError("");
        scheduleDraftSave();
        scheduleLivePreview();
      });
      body.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          if (form && form.requestSubmit) form.requestSubmit();
          else if (form) form.dispatchEvent(new Event("submit", { cancelable: true }));
        }
      });
    }

    var tags = document.getElementById("ndTags");
    if (tags) tags.addEventListener("input", scheduleDraftSave);

    var category = document.getElementById("ndCategory");
    if (category) category.addEventListener("change", scheduleDraftSave);

    var discard = document.getElementById("ndDraftDiscard");
    if (discard) {
      discard.addEventListener("click", function () {
        clearDraft();
        document.getElementById("newDiscussionForm").reset();
        document.getElementById("ndDraft").hidden = true;
        selectType(DEFAULT_TYPE);
        updateTitleCount();
        renderLivePreview();
      });
    }

    var toggle = document.querySelector(".compose-view-toggle");
    if (toggle) {
      toggle.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-view]");
        if (btn) setView(btn.dataset.view);
      });
    }
  }

  async function init() {
    wire();
    selectType(DEFAULT_TYPE);
    updateTitleCount();
    loadTagSuggestions();

    try {
      var res = await fetch("/api/auth/status", { credentials: "include" });
      var json = await res.json();
      if (!(json && json.ok && json.user)) {
        var login = document.getElementById("composeLogin");
        if (login) login.hidden = false;
        return;
      }
    } catch (err) {
      var loginErr = document.getElementById("composeLogin");
      if (loginErr) loginErr.hidden = false;
      return;
    }

    var card = document.getElementById("newDiscussionForm");
    if (card) card.hidden = false;
    restoreDraft();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
