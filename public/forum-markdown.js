import { embedVideoLinks, applyImageSizes, linkMentions } from "./markdown-embeds.js?v=20260919-03";

(function () {
  "use strict";

  // Must match the embed hosts the server generates (utils/common.js).
  var ALLOWED_FRAME_HOSTS = ["streamable.com", "www.youtube-nocookie.com", "player.vimeo.com"];
  var purifyConfigured = false;

  function configurePurify() {
    if (purifyConfigured || !window.DOMPurify) return;
    purifyConfigured = true;
    window.DOMPurify.addHook("uponSanitizeElement", function (node, data) {
      if (!data || data.tagName !== "iframe") return;
      var src = (node.getAttribute && node.getAttribute("src")) || "";
      var ok = false;
      try {
        var u = new URL(src, window.location.origin);
        ok = u.protocol === "https:" && ALLOWED_FRAME_HOSTS.indexOf(u.hostname) !== -1;
      } catch (_) {
        ok = false;
      }
      if (!ok && node.parentNode) node.parentNode.removeChild(node);
    });
  }

  function sanitize(html) {
    configurePurify();
    if (!window.DOMPurify) return html || "";
    return window.DOMPurify.sanitize(html || "", {
      ADD_TAGS: ["iframe"],
      ADD_ATTR: ["allowfullscreen", "loading", "allow", "frameborder"],
    });
  }

  // Raw markdown (composer previews): embeds are generated after markdown but
  // still pass through DOMPurify's host allow-list.
  function render(md) {
    if (!window.marked || !window.DOMPurify) return md || "";
    var html = window.marked.parse(md || "", { breaks: true, gfm: true });
    return linkMentions(applyImageSizes(sanitize(embedVideoLinks(html))));
  }

  // Server-rendered post HTML (already embeds + size classes).
  function sanitizePost(html) {
    return linkMentions(applyImageSizes(sanitize(html || "")));
  }

  window.ForumMarkdown = { render: render, sanitizePost: sanitizePost };
})();
