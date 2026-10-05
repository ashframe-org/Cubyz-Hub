import sanitizeHtml from "sanitize-html";
import { marked } from "marked";
import { embedVideoLinks, applyImageSizes, linkMentions } from "../public/markdown-embeds.js";

export function parseCreatorsJson(value) {
  let list = [];
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    list = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
  return list
    .map((entry) => {
      if (typeof entry === "string") return entry ? { username: entry, role: null } : null;
      if (entry && typeof entry === "object" && entry.username) {
        return { username: entry.username, role: entry.role || null };
      }
      return null;
    })
    .filter(Boolean);
}

export function safeMarkdown(md) {
  const rawHtml = marked.parse(md || "", { breaks: true, gfm: true });
  const clean = sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "del"]),
                      allowedAttributes: {
                        ...sanitizeHtml.defaults.allowedAttributes,
                        img: ["src", "alt", "title"]
                      },
                      allowedSchemes: ["http", "https", "data"],
                      allowedSchemesByTag: { img: ["http", "https", "data"] }
  });
  // Video embeds are generated from an allow-list of providers *after*
  // sanitizing, so user-supplied iframes can never get through.
  return linkMentions(applyImageSizes(embedVideoLinks(clean)));
}

export function isSafeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function slugify(name) {
  return String(name || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .replace(/--+/g, "-")
  .slice(0, 60);
}

export function addonLink(addon, suffix = "") {
  return `${addon.type === "mod" ? "/mod" : "/addon"}/${addon.id}-${slugify(addon.name)}${suffix}`;
}

export function downloadFilename(name, version, gameVersion) {
  const cleanName = String(name || "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cleanVersion = String(version || "")
    .replace(/[^A-Za-z0-9.]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "");
  const cleanGame = String(gameVersion || "")
    .replace(/[^A-Za-z0-9.]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
  const base = [cleanName || "addon", cleanVersion, cleanGame && `cubyz-${cleanGame}`]
    .filter(Boolean)
    .join("-");
  return `${base.slice(0, 120) || "addon"}.zip`;
}
