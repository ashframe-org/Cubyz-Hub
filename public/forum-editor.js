(function () {
  "use strict";

  var BUTTONS = [
    { md: "bold", html: "<strong>B</strong>", title: "Bold (Ctrl+B)" },
    { md: "italic", html: "<em>I</em>", title: "Italic (Ctrl+I)" },
    { md: "strike", html: "<s>S</s>", title: "Strikethrough" },
    { md: "heading", html: "H", title: "Heading" },
    { md: "link", html: "Link", title: "Link (Ctrl+K)" },
    { md: "ulist", html: "List", title: "Bulleted list" },
    { md: "olist", html: "1.", title: "Numbered list" },
    { md: "quote", html: "&quot;", title: "Quote" },
    { md: "code", html: "&lt;/&gt;", title: "Inline code" },
    { md: "codeblock", html: "{ }", title: "Code block" },
    { md: "addon", html: "Addon", title: "Link an addon (or type [[)" },
    { md: "image", html: "Image", title: "Upload an image" },
    { md: "hr", html: "&mdash;", title: "Divider" },
  ];

  function toolbarHtml() {
    return BUTTONS.map(function (b) {
      return '<button type="button" data-md="' + b.md + '" title="' + b.title + '">' + b.html + "</button>";
    }).join("");
  }

  function setCursor(field, position) {
    field.focus();
    try {
      field.setSelectionRange(position, position);
    } catch (err) {
      /* not a text field */
    }
  }

  function wrapSelection(field, before, after) {
    var start = field.selectionStart || 0;
    var end = field.selectionEnd || 0;
    var value = field.value;
    var selected = value.slice(start, end);
    // Only format highlighted text — no placeholder insertion.
    if (!selected) return;
    field.value = value.slice(0, start) + before + selected + after + value.slice(end);
    setCursor(field, start + before.length + selected.length + after.length);
  }

  function prefixLines(field, marker, numbered) {
    var start = field.selectionStart || 0;
    var end = field.selectionEnd || 0;
    var value = field.value;
    var lineStart = value.lastIndexOf("\n", start - 1) + 1;
    var lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = value.length;
    var lines = value.slice(lineStart, lineEnd).split("\n");
    var out = lines
      .map(function (line, i) {
        return (numbered ? i + 1 + ". " : marker) + line;
      })
      .join("\n");
    field.value = value.slice(0, lineStart) + out + value.slice(lineEnd);
    setCursor(field, lineStart + out.length);
  }

  function applyMarkdown(field, action) {
    if (!field) return;
    if (action === "bold") return wrapSelection(field, "**", "**", "bold text");
    if (action === "italic") return wrapSelection(field, "*", "*", "italic text");
    if (action === "strike") return wrapSelection(field, "~~", "~~", "strikethrough");
    if (action === "code") return wrapSelection(field, "`", "`", "code");
    if (action === "codeblock") return wrapSelection(field, "```\n", "\n```", "code block");
    if (action === "link") return wrapSelection(field, "[", "](https://)", "link text");
    if (action === "heading") return prefixLines(field, "## ");
    if (action === "quote") return prefixLines(field, "> ");
    if (action === "ulist") return prefixLines(field, "- ");
    if (action === "olist") return prefixLines(field, "", true);
    if (action === "hr") {
      var pos = field.selectionEnd || 0;
      field.value = field.value.slice(0, pos) + "\n\n---\n\n" + field.value.slice(pos);
      setCursor(field, pos + 7);
    }
  }

  function notifyError(opts, message) {
    if (opts && typeof opts.onError === "function") opts.onError(message);
    else if (window.toast && typeof window.toast.error === "function") window.toast.error(message);
  }

  async function sendImage(file, field, opts) {
    var token = "\u0000img" + Math.random().toString(36).slice(2) + "\u0000";
    var start = field.selectionStart || 0;
    var end = field.selectionEnd || 0;
    var alt = file.name ? file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[[\]]/g, "") : "image";
    var placeholder = "![" + alt + "](" + token + ")";
    field.value = field.value.slice(0, start) + placeholder + field.value.slice(end);
    setCursor(field, start + placeholder.length);

    var form = new FormData();
    form.append("image", file);
    try {
      var res = await fetch("/api/forum/upload-image", { method: "POST", credentials: "include", body: form });
      var json = await res.json();
      if (!json.ok) throw new Error(json.error || "Image upload failed.");
      field.value = field.value.replace(token, json.url);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (err) {
      field.value = field.value.replace(placeholder, "");
      notifyError(opts, err.message || "Image upload failed.");
    }
  }

  function pickImage(field, opts) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (file) sendImage(file, field, opts);
    });
    input.click();
  }

  function insertAddonTrigger(field) {
    var start = field.selectionStart || 0;
    var end = field.selectionEnd || 0;
    var value = field.value;
    field.value = value.slice(0, start) + "[[" + value.slice(end);
    setCursor(field, start + 2);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  function attachAutocomplete(field, cfg) {
    if (field[cfg.flag]) return;
    field[cfg.flag] = true;

    var menu = document.createElement("div");
    menu.className = "custom-select-list forum-addon-menu";
    menu.hidden = true;
    document.body.appendChild(menu);

    var state = { open: false, items: [], index: -1, start: 0, caret: 0, term: null, reqId: 0, timer: null, controller: null };

    function position() {
      var rect = field.getBoundingClientRect();
      var height = menu.offsetHeight || 0;
      var width = Math.min(Math.max(rect.width, 240), 380);
      var left = rect.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      var top = rect.bottom + 6;
      if (top + height > window.innerHeight - 8 && rect.top - height - 6 > 8) top = rect.top - height - 6;
      menu.style.position = "fixed";
      menu.style.left = left + "px";
      menu.style.top = top + "px";
      menu.style.width = width + "px";
      menu.style.maxWidth = "none";
      menu.style.zIndex = "1600";
    }

    function closeMenu() {
      state.open = false;
      state.items = [];
      state.index = -1;
      state.term = null;
      menu.hidden = true;
    }

    function choose(i) {
      var item = state.items[i];
      if (!item) return;
      var text = cfg.insertText(item);
      var value = field.value;
      field.value = value.slice(0, state.start) + text + value.slice(state.caret);
      setCursor(field, state.start + text.length);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      closeMenu();
    }

    function highlight(i) {
      state.index = i;
      var opts = menu.querySelectorAll(".forum-autocomplete-option");
      for (var k = 0; k < opts.length; k++) opts[k].classList.toggle("active", k === i);
      if (opts[i] && opts[i].scrollIntoView) opts[i].scrollIntoView({ block: "nearest" });
    }

    function render() {
      menu.innerHTML = "";
      if (!state.items.length) {
        var empty = document.createElement("div");
        empty.className = "forum-addon-empty";
        empty.textContent = cfg.emptyText(state.term);
        menu.appendChild(empty);
      } else {
        state.items.forEach(function (item, i) {
          var opt = document.createElement("div");
          opt.className = "custom-select-option forum-addon-option forum-autocomplete-option" + (i === state.index ? " active" : "");
          opt.setAttribute("role", "option");
          var content = cfg.renderItem(item);
          if (content) opt.appendChild(content);
          opt.addEventListener("mousedown", function (e) { e.preventDefault(); });
          opt.addEventListener("click", function () { choose(i); });
          menu.appendChild(opt);
        });
      }
      menu.hidden = false;
      state.open = true;
      position();
    }

    async function search(term) {
      state.controller && state.controller.abort();
      var controller = new AbortController();
      state.controller = controller;
      var reqId = ++state.reqId;
      try {
        var items = await cfg.fetchItems(term, controller.signal);
        if (reqId !== state.reqId) return;
        if (!cfg.match(field)) { closeMenu(); return; }
        state.items = items || [];
        state.index = state.items.length ? 0 : -1;
        render();
      } catch (err) {
        if (!err || err.name !== "AbortError") closeMenu();
      }
    }

    function update() {
      var match = cfg.match(field);
      if (!match || (!cfg.allowEmpty && match.term.length < (cfg.minTerm || 1))) {
        if (state.open) closeMenu();
        return;
      }
      if (match.term === state.term && state.open) return;
      state.start = match.start;
      state.caret = match.caret;
      state.term = match.term;
      clearTimeout(state.timer);
      state.timer = setTimeout(function () { search(match.term); }, 140);
    }

    field.addEventListener("input", update);
    field.addEventListener("keydown", function (e) {
      if (!state.open) return;
      if (e.key === "ArrowDown") { e.preventDefault(); highlight(Math.min(state.index + 1, state.items.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(state.index - 1, 0)); }
      else if (e.key === "Enter" || e.key === "Tab") {
        if (state.items.length) { e.preventDefault(); choose(state.index < 0 ? 0 : state.index); }
      } else if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
    });
    field.addEventListener("blur", function () { setTimeout(closeMenu, 120); });
    window.addEventListener("scroll", function () { if (state.open) position(); }, true);
    window.addEventListener("resize", function () { if (state.open) position(); });
  }

  function addonOptionContent(item) {
    var frag = document.createDocumentFragment();
    var img = document.createElement("img");
    img.className = "forum-addon-icon";
    img.alt = "";
    img.loading = "lazy";
    img.src = item.iconThumbUrl || item.iconUrl || "/assets/default_icon.png";
    img.addEventListener("error", function () { img.src = "/assets/default_icon.png"; });
    var name = document.createElement("span");
    name.className = "forum-addon-name";
    name.textContent = item.name;
    frag.appendChild(img);
    frag.appendChild(name);
    if (item.author) {
      var by = document.createElement("span");
      by.className = "forum-addon-by";
      by.textContent = "by " + item.author;
      frag.appendChild(by);
    }
    return frag;
  }

  function userOptionContent(item) {
    var frag = document.createDocumentFragment();
    if (item.avatarUrl) {
      var img = document.createElement("img");
      img.className = "forum-addon-icon";
      img.alt = "";
      img.loading = "lazy";
      img.src = item.avatarUrl;
      img.addEventListener("error", function () { img.style.display = "none"; });
      frag.appendChild(img);
    }
    var name = document.createElement("span");
    name.className = "forum-addon-name";
    name.textContent = item.username;
    frag.appendChild(name);
    return frag;
  }

  function attachAddonAutocomplete(field) {
    attachAutocomplete(field, {
      flag: "_addonAutocomplete",
      allowEmpty: true,
      minTerm: 0,
      match: function (field) {
        var caret = field.selectionStart || 0;
        var m = /\[\[([^\[\]\n]{0,40})$/.exec(field.value.slice(0, caret));
        return m ? { term: m[1], start: caret - m[1].length - 2, caret: caret } : null;
      },
      fetchItems: async function (term, signal) {
        var url = term
          ? "/api/search?type=addons&q=" + encodeURIComponent(term)
          : "/api/addons?pageSize=8&sort=downloads";
        var res = await fetch(url, { credentials: "include", signal: signal });
        var json = await res.json();
        return (json && json.addons) || [];
      },
      emptyText: function (term) { return term ? "No addons found" : "Start typing to search addons"; },
      renderItem: addonOptionContent,
      insertText: function (item) {
        var prefix = item.type === "mod" ? "mod" : "addon";
        return "[" + item.name + "](/" + prefix + "/" + item.id + "-" + slugify(item.name) + ")";
      },
    });
  }

  function attachMentionAutocomplete(field) {
    attachAutocomplete(field, {
      flag: "_mentionAutocomplete",
      allowEmpty: true,
      minTerm: 1,
      match: function (field) {
        var caret = field.selectionStart || 0;
        var m = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_.-]{0,20})$/.exec(field.value.slice(0, caret));
        if (!m) return null;
        var term = m[2];
        return { term: term, start: caret - term.length - 1, caret: caret };
      },
      fetchItems: async function (term, signal) {
        if (!term) {
          // Bare "@" shows top contributors (same list as the forum sidebar).
          var cres = await fetch("/api/forum/contributors", { credentials: "include", signal: signal });
          var cjson = await cres.json();
          return (cjson && cjson.contributors) || [];
        }
        var res = await fetch("/api/search?type=users&q=" + encodeURIComponent(term), { credentials: "include", signal: signal });
        var json = await res.json();
        return (json && json.users) || [];
      },
      emptyText: function (term) { return term ? "No users found" : "No suggestions"; },
      renderItem: userOptionContent,
      insertText: function (item) { return "@" + item.username + " "; },
    });
  }


  function attach(field, toolbarEl, opts) {
    if (!field || field._forumEditorAttached) return;
    opts = opts || {};

    if (toolbarEl) {
      toolbarEl.classList.add("md-toolbar");
      toolbarEl.innerHTML = toolbarHtml();
      // Keep the textarea selection when a toolbar button is pressed.
      toolbarEl.addEventListener("mousedown", function (e) {
        if (e.target.closest("button[data-md]")) e.preventDefault();
      });
      toolbarEl.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-md]");
        if (!btn) return;
        if (btn.dataset.md === "image") pickImage(field, opts);
        else if (btn.dataset.md === "addon") insertAddonTrigger(field);
        else applyMarkdown(field, btn.dataset.md);
      });
    }

    field.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var key = (e.key || "").toLowerCase();
      if (key === "b") { e.preventDefault(); applyMarkdown(field, "bold"); }
      else if (key === "i") { e.preventDefault(); applyMarkdown(field, "italic"); }
      else if (key === "k") { e.preventDefault(); applyMarkdown(field, "link"); }
    });

    field.addEventListener("paste", function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf("image/") === 0) {
          var file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            sendImage(file, field, opts);
            return;
          }
        }
      }
    });

    attachAddonAutocomplete(field);
    attachMentionAutocomplete(field);
    field._forumEditorAttached = true;
  }

  window.ForumEditor = { toolbarHtml: toolbarHtml, applyMarkdown: applyMarkdown, attach: attach };
})();
