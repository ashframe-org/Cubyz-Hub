import express from "express";
import fs from "fs";
import path from "path";
import { db } from "../db/index.js";
import { slugify, safeMarkdown } from "../utils/common.js";
import { RP_ORIGIN } from "../config.js";
import { getThreadPayload, viewerKeyFor } from "./forum.js";
import { threadSeo, indexSeo, escHtml, threadPath, stripMarkdown, isoDate } from "../services/forumSeo.js";

const router = express.Router();

const templateCache = new Map();
async function loadTemplate(relative) {
  if (!templateCache.has(relative)) {
    templateCache.set(relative, await fs.promises.readFile(path.join(process.cwd(), "public", relative), "utf8"));
  }
  return templateCache.get(relative);
}

function injectSeo(html, { title, description, head, noscript }) {
  let out = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escHtml(title)}</title>`);
  if (description) {
    out = out.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escHtml(description)}">`);
  }
  out = out.replace("</head>", `  ${head}\n</head>`);
  if (noscript) out = out.replace("</body>", `  ${noscript}\n</body>`);
  return out;
}

router.get("/profile/:username", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "profile.html"));
});

const CHANGELOG_BODY_SELECT = "SELECT id, title, body, created_at, tag, screenshots, og_image FROM changelog_entries";

function changelogSeo(entry) {
  const url = entry ? `${RP_ORIGIN}/changelog/${entry.id}` : `${RP_ORIGIN}/changelog`;
  const title = entry ? entry.title : "Changelog";
  let image = "";
  if (entry) {
    let shots = [];
    try { shots = entry.screenshots ? JSON.parse(entry.screenshots) : []; } catch { shots = []; }
    const raw = entry.og_image || (Array.isArray(shots) ? shots[0] : "");
    if (raw) {
      image = /^https?:\/\//i.test(raw) ? raw : `${RP_ORIGIN}${String(raw).startsWith("/") ? "" : "/"}${raw}`;
    }
  }
  // When there's a preview image it already contains everything, so keep the
  // description to just the update type. Otherwise fall back to the body text.
  let description;
  if (!entry) {
    description = "Updates and changes to Cubyz Hub.";
  } else if (image) {
    description = entry.tag === "major" ? "Major update" : entry.tag === "minor" ? "Minor update" : "Update";
  } else {
    description = stripMarkdown(String(entry.body || "").replace(/<[^>]*>/g, " "), 300);
  }
  const head = [
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="CubyzHub">`,
    `<meta property="og:title" content="${escHtml(title)}">`,
    `<meta property="og:description" content="${escHtml(description)}">`,
    `<meta property="og:url" content="${escHtml(url)}">`,
    image ? `<meta property="og:image" content="${escHtml(image)}">` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escHtml(title)}">`,
    `<meta name="twitter:description" content="${escHtml(description)}">`,
    image ? `<meta name="twitter:image" content="${escHtml(image)}">` : "",
  ].filter(Boolean).join("\n  ");
  return { title: `${title} — CubyzHub`, description, head };
}

async function serveChangelog(req, res, id) {
  try {
    const entry = id
      ? await db.get(`${CHANGELOG_BODY_SELECT} WHERE id = ? AND is_draft = 0`, [id])
      : await db.get(`${CHANGELOG_BODY_SELECT} WHERE is_draft = 0 ORDER BY created_at DESC, sort_order DESC LIMIT 1`);
    const html = await loadTemplate("changelog.html");
    res.type("html").send(injectSeo(html, changelogSeo(entry)));
  } catch (err) {
    console.error("CHANGELOG PAGE ERROR:", err);
    res.sendFile(path.join(process.cwd(), "public", "changelog.html"));
  }
}

router.get("/changelog", (req, res) => serveChangelog(req, res, null));

router.get("/changelog/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.redirect(301, "/changelog");
  serveChangelog(req, res, id);
});

router.get("/addons", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "addons.html"));
});

router.get("/models", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "models.html"));
});

router.get("/servers", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "servers.html"));
});

router.get("/creator", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "creator", "index.html"));
});

router.get("/metrics", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "metrics.html"));
});

router.get("/feedback", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "feedback.html"));
});

router.get("/dashboard", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "dashboard.html"));
});

router.get("/forum", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT t.id, t.title, t.created_at, t.last_activity_at, u.username AS author
       FROM forum_threads t JOIN users u ON u.id = t.author_id
       WHERE t.hidden = 0
       ORDER BY COALESCE(t.pinned, 0) DESC, COALESCE(t.last_activity_at, t.created_at) DESC
       LIMIT 25`
    );
    const html = await loadTemplate("forum.html");
    res.type("html").send(injectSeo(html, indexSeo(rows, RP_ORIGIN)));
  } catch (err) {
    console.error("FORUM PAGE ERROR:", err);
    res.sendFile(path.join(process.cwd(), "public", "forum.html"));
  }
});

router.get("/forum/new", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "forum-new.html"));
});

router.get("/forum/t/:threadId", async (req, res) => {
  const id = parseInt(String(req.params.threadId).split("-")[0], 10);
  if (!Number.isInteger(id)) {
    return res.status(404).type("html").send("<!doctype html><title>Not found</title><h1>404 &mdash; not found</h1>");
  }
  try {
    const html = await loadTemplate("forum-thread.html");
    const payload = await getThreadPayload(id, req.session.user || null, { countView: true, viewerKey: viewerKeyFor(req) });
    if (!payload) return res.status(404).type("html").send(html);
    const seo = threadSeo(payload.thread, payload.posts, RP_ORIGIN);
    const initial = JSON.stringify(payload).replace(/</g, "\\u003c");
    seo.head = `${seo.head}\n  <script>window.__FORUM_INITIAL__=${initial};</script>`;
    res.type("html").send(injectSeo(html, seo));
  } catch (err) {
    console.error("FORUM THREAD PAGE ERROR:", err);
    res.sendFile(path.join(process.cwd(), "public", "forum-thread.html"));
  }
});

router.get("/forum/feed.xml", async (req, res) => {
  try {
    const origin = RP_ORIGIN;
    const threads = await db.all(
      `SELECT t.id, t.title, t.body, t.created_at, t.last_activity_at, u.username AS author
       FROM forum_threads t JOIN users u ON u.id = t.author_id
       WHERE t.hidden = 0
       ORDER BY COALESCE(t.last_activity_at, t.created_at) DESC LIMIT 30`
    );
    const updated = (threads[0] && (threads[0].last_activity_at || threads[0].created_at)) || new Date().toISOString();
    const entries = threads
      .map((t) => {
        const url = `${origin}${threadPath(t)}`;
        return `  <entry>
    <title>${escHtml(t.title)}</title>
    <link href="${escHtml(url)}"/>
    <id>${escHtml(url)}</id>
    <updated>${escHtml(isoDate(t.last_activity_at || t.created_at))}</updated>
    <author><name>${escHtml(t.author)}</name></author>
    <summary type="html">${escHtml(stripMarkdown(t.body, 300))}</summary>
    <content type="html">${escHtml(safeMarkdown(t.body))}</content>
  </entry>`;
      })
      .join("\n");
    res.type("application/atom+xml").send(`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>CubyzHub Forum</title>
  <link href="${origin}/forum/feed.xml" rel="self"/>
  <link href="${origin}/forum"/>
  <id>${origin}/forum</id>
  <updated>${escHtml(isoDate(updated))}</updated>
${entries}
</feed>`);
  } catch (err) {
    console.error("FORUM FEED ERROR:", err);
    res.status(500).send("Failed to generate feed.");
  }
});

router.get("/sitemap.xml", async (req, res) => {
  try {
    const origin = RP_ORIGIN;
    const esc = (s) => String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const statics = ["/", "/addons", "/models", "/servers", "/changelog", "/creator", "/metrics", "/forum"]
      .map((p) => `  <url><loc>${origin}${p}</loc><changefreq>daily</changefreq></url>`)
      .join("\n");
    const addons = await db.all("SELECT id, name, type, updated_at, created_at FROM addons ORDER BY id DESC");
    const urls = addons.map((a) => {
      const prefix = a.type === "mod" ? "/mod" : "/addon";
      const lastmod = (a.updated_at || a.created_at || "").slice(0, 10);
      return `  <url><loc>${origin}${prefix}/${a.id}-${esc(slugify(a.name))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>weekly</changefreq></url>`;
    }).join("\n");
    const threads = await db.all(
      "SELECT id, title, created_at, last_activity_at FROM forum_threads WHERE hidden = 0 ORDER BY id DESC LIMIT 5000"
    );
    const threadUrls = threads.map((t) => {
      const lastmod = (t.last_activity_at || t.created_at || "").slice(0, 10);
      return `  <url><loc>${origin}/forum/t/${t.id}-${esc(slugify(t.title))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>weekly</changefreq></url>`;
    }).join("\n");
    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${statics}\n${urls}\n${threadUrls}\n</urlset>`
    );
  } catch (err) {
    console.error("SITEMAP ERROR:", err);
    res.status(500).send("Failed to generate sitemap.");
  }
});

export default router;
