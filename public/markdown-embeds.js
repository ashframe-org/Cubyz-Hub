// Shared markdown post-processing for forum posts. Pure string transforms with
// no DOM/browser APIs so the server (utils/common.js) and the browser
// (forum-markdown.js) can both import this same file and stay in sync.

const VIDEO_EMBED_HOSTS = ["streamable.com", "www.youtube-nocookie.com", "player.vimeo.com"];

// Returns a canonical embed URL for a supported video link, or null.
export function parseVideoUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");

  if (host === "streamable.com") {
    const m = path.match(/^\/(?:e|o)?\/?([A-Za-z0-9]+)$/);
    return m ? "https://streamable.com/e/" + m[1] : null;
  }

  if (host === "youtu.be") {
    const id = path.slice(1);
    return /^[A-Za-z0-9_-]{6,}$/.test(id) ? "https://www.youtube-nocookie.com/embed/" + id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (path === "/watch") {
      const v = u.searchParams.get("v") || "";
      return /^[A-Za-z0-9_-]{6,}$/.test(v) ? "https://www.youtube-nocookie.com/embed/" + v : null;
    }
    const m = path.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})$/);
    return m ? "https://www.youtube-nocookie.com/embed/" + m[1] : null;
  }

  if (host === "vimeo.com") {
    const m = path.match(/^\/(\d+)$/);
    return m ? "https://player.vimeo.com/video/" + m[1] : null;
  }

  if (host === "player.vimeo.com") {
    const m = path.match(/^\/video\/(\d+)$/);
    return m ? "https://player.vimeo.com/video/" + m[1] : null;
  }

  return null;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Turns a bare, autolinked video URL (link text === URL) into a responsive
// iframe embed. Titled links like [watch](url) are left alone.
export function embedVideoLinks(html) {
  if (!html || html.indexOf("<a ") === -1) return html || "";
  return html.replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (match, href, inner) => {
    const linkText = decodeEntities(inner.replace(/<[^>]*>/g, "")).trim();
    // A trailing |1..|4 on the URL sets the embed width (marked encodes it as %7C).
    const normalizedHref = decodeEntities(href).replace(/%7C/gi, "|");
    let url = normalizedHref;
    let size = "";
    const sizeMatch = /\|([1-4])$/.exec(normalizedHref);
    if (sizeMatch) {
      size = sizeMatch[1];
      url = normalizedHref.slice(0, -sizeMatch[0].length);
    }
    if (linkText !== normalizedHref && linkText !== url && linkText !== url.replace(/\/$/, "")) return match;
    const embed = parseVideoUrl(url);
    if (!embed) return match;
    const src = embed.replace(/"/g, "&quot;");
    const cls = "video-embed" + (size ? " video-s" + size : "");
    return (
      `<div class="${cls}"><div class="video-frame">` +
      `<iframe src="${src}" title="Video player" loading="lazy" ` +
      'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>' +
      "</div></div>"
    );
  });
}

// Turns @username into a profile link, but only in text nodes (never inside
// tags, existing links, code or pre blocks). Mirrors extractMentions' charset.
export function linkMentions(html) {
  if (!html || html.indexOf("@") === -1) return html || "";
  const parts = String(html).split(/(<[^>]+>)/g);
  let skip = 0;
  return parts
    .map((part) => {
      if (part.charAt(0) === "<") {
        const name = (/^<\s*\/?\s*([a-zA-Z0-9]+)/.exec(part) || [])[1];
        if (name) {
          const tag = name.toLowerCase();
          if (tag === "a" || tag === "code" || tag === "pre") {
            skip += /^<\s*\//.test(part) ? -1 : 1;
            if (skip < 0) skip = 0;
          }
        }
        return part;
      }
      if (skip > 0) return part;
      return part.replace(/(^|[^A-Za-z0-9_.-])@([A-Za-z0-9_.-]{3,20})/g, (m, prefix, raw) => {
        const name = raw.replace(/\.+$/, "");
        if (name.length < 3) return m;
        const tail = raw.slice(name.length);
        return (
          prefix +
          '<a class="forum-mention" href="/profile/' +
          encodeURIComponent(name) +
          '">@' +
          name +
          "</a>" +
          tail
        );
      });
    })
    .join("");
}

// Moves a trailing size marker from an image's alt text into a class:
// ![caption|2](url) -> <img class="img-s2" alt="caption" src="url">
export function applyImageSizes(html) {
  if (!html || html.indexOf("<img") === -1) return html || "";
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const altMatch = /alt="([^"]*)"/i.exec(tag);
    if (!altMatch) return tag;
    const alt = altMatch[1];
    const sizeMatch = /\|([1-4])$/.exec(alt);
    if (!sizeMatch) return tag;
    const cls = "img-s" + sizeMatch[1];
    const newAlt = alt.slice(0, -sizeMatch[0].length);
    let out = tag.replace(/alt="[^"]*"/i, `alt="${newAlt}"`);
    if (/\bclass="/i.test(out)) {
      out = out.replace(/\bclass="([^"]*)"/i, (m, c) => `class="${c} ${cls}"`);
    } else {
      out = out.replace(/<img/i, `<img class="${cls}"`);
    }
    return out;
  });
}

export { VIDEO_EMBED_HOSTS };
