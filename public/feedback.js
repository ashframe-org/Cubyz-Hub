import { enhanceSelect } from "./dist/custom-select.js?v=20260919-17";

(function () {
  "use strict";

  var TARGET_LABELS = {
    addon_creator: "Addon Creator",
    addons_mods: "Addons & Mods",
    forum: "Forum",
    models: "Models",
    website: "Website",
    other: "Other",
  };
  var TYPE_LABELS = { bug: "Bug", improvement: "Improvement", other: "Other" };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function loadAdminInbox() {
    var list = document.getElementById("feedbackList");
    if (!list) return false;
    try {
      var res = await fetch("/api/feedback", { credentials: "include" });
      if (!res.ok) return false;
      var json = await res.json();
      if (!json.ok) return false;
      if (!json.items.length) {
        list.appendChild(el("p", "muted", "No feedback yet."));
      } else {
        json.items.forEach(function (it) {
          var card = el("div", "feedback-item");
          var head = el("div", "feedback-item-head");
          head.appendChild(el("span", "feedback-badge", TYPE_LABELS[it.type] || it.type));
          head.appendChild(el("span", "feedback-badge feedback-badge-target", TARGET_LABELS[it.target] || it.target));
          head.appendChild(el("span", "feedback-item-meta", (it.username || "anon") + " \u00b7 " + (it.created_at || "")));
          card.appendChild(head);
          card.appendChild(el("p", "feedback-item-body", it.body));
          list.appendChild(card);
        });
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function init() {
    var guest = document.getElementById("feedbackGuest");
    var form = document.getElementById("feedbackForm");
    var adminBox = document.getElementById("feedbackAdmin");

    var user = null;
    try {
      var res = await fetch("/api/auth/status", { credentials: "include" });
      var json = await res.json();
      if (json.ok && json.user) user = json.user;
    } catch (_) {
      user = null;
    }

    if (user) {
      if (form) form.hidden = false;
      enhanceSelect(document.getElementById("feedbackTarget"));
      enhanceSelect(document.getElementById("feedbackType"));
    } else if (guest) {
      guest.hidden = false;
    }

    if (user && adminBox) {
      if (await loadAdminInbox()) adminBox.hidden = false;
    }

    if (!form) return;
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var errEl = document.getElementById("feedbackError");
      var okEl = document.getElementById("feedbackSuccess");
      var btn = document.getElementById("feedbackSubmit");
      errEl.hidden = true;
      okEl.hidden = true;

      var target = document.getElementById("feedbackTarget").value;
      var type = document.getElementById("feedbackType").value;
      var body = document.getElementById("feedbackBody").value.trim();
      if (body.length < 5) {
        errEl.textContent = "Please write a little more.";
        errEl.hidden = false;
        return;
      }

      btn.disabled = true;
      btn.textContent = "Sending\u2026";
      try {
        var res = await fetch("/api/feedback", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: target, type: type, body: body }),
        });
        var json = await res.json();
        if (!json.ok) throw new Error(json.error || "Failed to send feedback.");
        document.getElementById("feedbackBody").value = "";
        okEl.hidden = false;
        if (window.toast && typeof window.toast.success === "function") window.toast.success("Feedback sent");
      } catch (err) {
        errEl.textContent = err.message || "Failed to send feedback.";
        errEl.hidden = false;
      }
      btn.disabled = false;
      btn.textContent = "Send feedback";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
