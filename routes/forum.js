import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { db, withTransaction } from "../db/index.js";
import { FORUM_CATEGORIES, FORUM_TYPES } from "../utils/constants.js";
import { safeMarkdown } from "../utils/common.js";
import { createNotification } from "../services/notifications.js";
import { indexThread, indexPost, removeThreadIndex, removePostIndex, searchThreads } from "../services/forumSearch.js";
import { allowForumPost } from "../utils/throttles.js";
import { uploadForumImage, verifyFiles } from "../services/uploads.js";
import { isModerator, isForumAdmin, refreshModerators, getModeratorIds, FORUM_ADMIN_USERNAME } from "../services/forumMods.js";
import { recordMetric } from "../services/metrics.js";
import { searchGitHubIssues, maybeRefreshGitHubIssues } from "../services/githubIssues.js";

const router = express.Router();

const PAGE_SIZE = 20;
const MAX_TITLE = 67;
const MAX_BODY = 20000;
const MIN_BODY = 120;
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 30;

const SORTS = {
  recent: "t.last_activity_at DESC",
  active: "(t.reply_count * 2 + t.votes) DESC, t.last_activity_at DESC",
  replies: "t.reply_count DESC",
  votes: "t.votes DESC",
  unanswered: "t.created_at DESC",
  oldest: "t.created_at ASC",
};

function cmpDate(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

const SEARCH_SORTS = {
  recent: (a, b) => cmpDate(b.last_activity_at, a.last_activity_at),
  oldest: (a, b) => cmpDate(a.created_at, b.created_at),
  active: (a, b) => ((b.reply_count || 0) * 2 + (b.votes || 0)) - ((a.reply_count || 0) * 2 + (a.votes || 0)),
  replies: (a, b) => (b.reply_count || 0) - (a.reply_count || 0),
  votes: (a, b) => (b.votes || 0) - (a.votes || 0),
  unanswered: (a, b) => cmpDate(b.created_at, a.created_at),
};

function parseTags(value) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === "string") list = value.split(",");
  const cleaned = [];
  for (const raw of list) {
    const tag = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, MAX_TAG_LENGTH);
    if (tag && !cleaned.includes(tag)) cleaned.push(tag);
  }
  return cleaned.slice(0, MAX_TAGS);
}

function tagsToJson(tags) {
  return JSON.stringify(tags || []);
}

function parseTagsJson(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeThread(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    bodyHtml: safeMarkdown(row.body),
    category: row.category,
    type: row.type || "discussion",
    tags: parseTagsJson(row.tags),
    status: row.status,
    solved: row.status === "solved",
    acceptedPostId: row.accepted_post_id || null,
    pinned: !!row.pinned,
    locked: !!row.locked || row.status === "locked",
    hidden: !!row.hidden,
    views: row.views || 0,
    votes: row.votes || 0,
    replyCount: row.reply_count || 0,
    author: row.author,
    avatarUrl: row.avatarUrl || null,
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    lastActivityAt: row.last_activity_at,
    authorCreatedAt: row.author_created_at || null,
  };
}

function serializePost(row) {
  return {
    id: row.id,
    body: row.body,
    bodyHtml: safeMarkdown(row.body),
    author: row.author,
    avatarUrl: row.avatarUrl || null,
    votes: row.votes || 0,
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    hidden: !!row.hidden,
  };
}

function likeEscape(value) {
  return String(value).replace(/[%_]/g, "\\$&");
}

function validateThreadInput(body) {
  const title = String(body?.title || "").trim();
  const text = String(body?.body || "").trim();
  const category = FORUM_CATEGORIES.includes(body?.category) ? body.category : "General";
  const type = FORUM_TYPES.includes(body?.type) ? body.type : "discussion";
  const tags = parseTags(body?.tags);
  if (title.length < 5 || title.length > MAX_TITLE) {
    return { error: `Title must be between 5 and ${MAX_TITLE} characters.` };
  }
  if (text.length < MIN_BODY || text.length > MAX_BODY) {
    return { error: `Body must be between ${MIN_BODY} and ${MAX_BODY} characters.` };
  }
  return { title, text, category, type, tags };
}

function canModify(row, user) {
  if (!user) return false;
  return row.author_id === user.id || isForumAdmin(user);
}

// Stable-ish identity for view de-duplication: the account when logged in,
// otherwise a hash of IP + user-agent so refreshes don't inflate the count.
export function viewerKeyFor(req) {
  const user = req.session && req.session.user;
  if (user) return `u:${user.id}`;
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
  const ua = typeof req.get === "function" ? req.get("user-agent") || "" : "";
  return "a:" + crypto.createHash("sha1").update(`${ip}|${ua}`).digest("hex").slice(0, 16);
}

export const VIEW_WINDOW_HOURS = 24;

const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;

function containsLink(text) {
  return /https?:\/\//i.test(text) || /!\[[^\]]*\]\(/.test(text) || /\[[^\]]+\]\([^)]+\)/.test(text);
}

// A "new" account is one younger than 24h that also hasn't contributed yet.
// Posting an addon, or publishing a model/server, unlocks the forum instantly.
async function isNewAccount(userId, username) {
  const row = await db.get("SELECT created_at FROM users WHERE id = ?", [userId]);
  if (!row?.created_at) return false;
  const created = new Date(String(row.created_at).replace(" ", "T") + "Z").getTime();
  if (!Number.isFinite(created) || Date.now() - created >= NEW_ACCOUNT_MS) return false;

  const [addon, model, server] = await Promise.all([
    db.get("SELECT 1 FROM addons WHERE author = ? LIMIT 1", [username]),
    db.get("SELECT 1 FROM models WHERE user_id = ? AND status = 'published' LIMIT 1", [userId]),
    db.get("SELECT 1 FROM servers WHERE owner_id = ? AND status = 'published' LIMIT 1", [userId]),
  ]);
  return !addon && !model && !server;
}

function extractMentions(text) {
  const found = [];
  const re = /@([A-Za-z0-9_.-]{3,20})/g;
  let match;
  while ((match = re.exec(text || "")) !== null) {
    const name = match[1].replace(/\.+$/, "");
    if (name.length < 3) continue;
    if (!found.includes(name)) found.push(name);
    if (found.length >= 5) break;
  }
  return found;
}

// Notify users @mentioned in a brand-new thread (replies go through
// notifyForumReply, which also handles mentions).
async function notifyThreadMentions(thread, actor, text) {
  for (const name of extractMentions(text)) {
    if (name.toLowerCase() === actor.username.toLowerCase()) continue;
    const user = await db.get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [name]);
    if (!user || user.id === actor.id) continue;
    try {
      await createNotification({
        userId: user.id,
        type: "forum_mention",
        message: `${actor.username} mentioned you in "${thread.title}"`,
        link: `/forum/t/${thread.id}`,
        dedupeKey: `forum:mention:thread:${thread.id}:${user.id}`,
      });
    } catch (err) {
      console.error("Failed to create thread mention notification:", err);
    }
  }
}

async function notifyForumReply(thread, actor, postId, text) {
  if (!thread) return;
  const targets = new Map();
  if (thread.author_id && thread.author_id !== actor.id) targets.set(thread.author_id, false);
  for (const name of extractMentions(text)) {
    if (name.toLowerCase() === actor.username.toLowerCase()) continue;
    const user = await db.get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [name]);
    if (user && user.id !== actor.id) targets.set(user.id, true);
  }
  for (const [userId, isMention] of targets) {
    const type = isMention ? "forum_mention" : "forum_reply";
    const message = isMention
      ? `${actor.username} mentioned you in "${thread.title}"`
      : `${actor.username} replied to "${thread.title}"`;
    try {
      await createNotification({
        userId,
        type,
        message,
        link: `/forum/t/${thread.id}`,
        dedupeKey: `forum:${isMention ? "mention" : "reply"}:${postId}:${userId}`,
      });
    } catch (err) {
      console.error("Failed to create forum reply notification:", err);
    }
  }
}

async function getForumMeta() {
  const categoryCounts = { all: 0 };
  for (const c of FORUM_CATEGORIES) categoryCounts[c] = 0;
  const countRows = await db.all("SELECT category, COUNT(*) AS n FROM forum_threads GROUP BY category");
  for (const row of countRows) {
    categoryCounts.all += row.n;
    if (categoryCounts[row.category] !== undefined) categoryCounts[row.category] = row.n;
  }

  const tagRows = await db.all("SELECT tags FROM forum_threads LIMIT 2000");
  const tagTally = {};
  for (const row of tagRows) {
    for (const t of parseTagsJson(row.tags)) tagTally[t] = (tagTally[t] || 0) + 1;
  }
  const topTags = Object.keys(tagTally)
    .map((name) => ({ name, count: tagTally[name] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return { categoryCounts, topTags };
}

router.get("/api/forum/stats", async (req, res) => {
  try {
    const row = await db.get("SELECT COUNT(*) AS n FROM forum_threads WHERE hidden = 0");
    res.json({ ok: true, total: row?.n || 0 });
  } catch (err) {
    console.error("FORUM STATS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load forum stats." });
  }
});

router.get("/api/github/issues", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ ok: true, items: [], total: 0, page: 1, totalPages: 1 });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 30);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  try {
    maybeRefreshGitHubIssues().catch(() => {});
    const { items, total } = await searchGitHubIssues(q, limit, (page - 1) * limit);
    res.json({ ok: true, items, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    console.error("GITHUB ISSUES SEARCH ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to search GitHub issues." });
  }
});

router.get("/api/forum/threads", async (req, res) => {
  try {
    const category = String(req.query.category || "all");
    const tag = String(req.query.tag || "").trim().toLowerCase();
    const q = String(req.query.q || "").trim();
    const type = FORUM_TYPES.includes(req.query.type) ? req.query.type : "";
    const status = String(req.query.status || "all");
    const sort = SORTS[req.query.sort] ? req.query.sort : "recent";
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const where = isModerator(req.session.user || null) ? [] : ["t.hidden = 0"];
    const params = [];
    if (category !== "all" && FORUM_CATEGORIES.includes(category)) {
      where.push("t.category = ?");
      params.push(category);
    }
    if (type) {
      where.push("t.type = ?");
      params.push(type);
    }
    if (status === "solved") {
      where.push("t.status = 'solved'");
    } else if (status === "open") {
      where.push("t.status != 'solved'");
    }
    if (tag) {
      where.push("t.tags LIKE ? ESCAPE '\\'");
      params.push(`%"${likeEscape(tag)}"%`);
    }
    if (q) {
      where.push("(t.title LIKE ? ESCAPE '\\' OR t.body LIKE ? ESCAPE '\\')");
      params.push(`%${likeEscape(q)}%`, `%${likeEscape(q)}%`);
    }
    if (sort === "unanswered") {
      where.push("t.reply_count = 0");
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = await db.get(`SELECT COUNT(*) AS n FROM forum_threads t ${whereSql}`, params);
    const total = totalRow?.n || 0;

    const rows = await db.all(
      `SELECT t.*, u.username AS author, u.avatarUrl AS avatarUrl
       FROM forum_threads t JOIN users u ON u.id = t.author_id
       ${whereSql}
       ORDER BY t.pinned DESC, t.pinned_at ASC, ${SORTS[sort]}
       LIMIT ? OFFSET ?`,
      params.concat([PAGE_SIZE, (page - 1) * PAGE_SIZE])
    );

    const meta = await getForumMeta();

    res.json({
      ok: true,
      threads: rows.map(serializeThread),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      ...meta,
    });
  } catch (err) {
    console.error("FORUM LIST ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load discussions." });
  }
});

router.get("/api/forum/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const category = String(req.query.category || "all");
    const tag = String(req.query.tag || "").trim().toLowerCase();
    const type = FORUM_TYPES.includes(req.query.type) ? req.query.type : "";
    const status = String(req.query.status || "all");
    const requestedSort = String(req.query.sort || "best");
    const sort = requestedSort === "best" || !SEARCH_SORTS[requestedSort] ? "best" : requestedSort;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const meta = await getForumMeta();

    if (!q) {
      return res.json({ ok: true, threads: [], total: 0, page, pageSize: PAGE_SIZE, totalPages: 1, ...meta });
    }

    const { ids, ranks, snippets } = await searchThreads(q, { limit: 200 });
    if (!ids.length) {
      return res.json({ ok: true, threads: [], total: 0, page, pageSize: PAGE_SIZE, totalPages: 1, ...meta });
    }

    const placeholders = ids.map(() => "?").join(",");
    const rows = await db.all(
      `SELECT t.*, u.username AS author, u.avatarUrl AS avatarUrl
       FROM forum_threads t JOIN users u ON u.id = t.author_id
       WHERE t.id IN (${placeholders})`,
      ids
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    let ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    if (!isModerator(req.session.user || null)) ordered = ordered.filter((t) => !t.hidden);
    if (category !== "all" && FORUM_CATEGORIES.includes(category)) {
      ordered = ordered.filter((t) => t.category === category);
    }
    if (type) ordered = ordered.filter((t) => t.type === type);
    if (status === "solved") ordered = ordered.filter((t) => t.status === "solved");
    else if (status === "open") ordered = ordered.filter((t) => t.status !== "solved");
    if (tag) {
      ordered = ordered.filter((t) => parseTagsJson(t.tags).includes(tag));
    }
    if (sort === "unanswered") ordered = ordered.filter((t) => (t.reply_count || 0) === 0);
    if (sort === "best") {
      // Results are already relevance-filtered; within them put the most
      // discussed first, using relevance (BM25) only as the tie-breaker.
      ordered.sort((a, b) => {
        const byReplies = (b.reply_count || 0) - (a.reply_count || 0);
        if (byReplies) return byReplies;
        const byVotes = (b.votes || 0) - (a.votes || 0);
        if (byVotes) return byVotes;
        return (ranks.get(a.id) || 0) - (ranks.get(b.id) || 0);
      });
    } else if (SEARCH_SORTS[sort]) {
      ordered.sort(SEARCH_SORTS[sort]);
    }

    const total = ordered.length;
    const start = (page - 1) * PAGE_SIZE;
    const threads = ordered.slice(start, start + PAGE_SIZE).map((r) => ({
      ...serializeThread(r),
      snippet: snippets.get(r.id) || null,
    }));

    res.json({
      ok: true,
      threads,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      ...meta,
    });
  } catch (err) {
    console.error("FORUM SEARCH ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to search discussions." });
  }
});

router.get("/api/forum/tags", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const rows = await db.all("SELECT tags FROM forum_threads LIMIT 2000");
    const tally = {};
    for (const row of rows) {
      for (const t of parseTagsJson(row.tags)) tally[t] = (tally[t] || 0) + 1;
    }
    const tags = Object.keys(tally)
      .filter((name) => !q || name.includes(q))
      .map((name) => ({ name, count: tally[name] }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 10);
    res.json({ ok: true, tags });
  } catch (err) {
    console.error("FORUM TAGS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load tags." });
  }
});

router.post("/api/forum/upload-image", (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in to upload images." });
  uploadForumImage.single("image")(req, res, function (err) {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No image uploaded." });
    try {
      verifyFiles(req.file, "image");
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (await isNewAccount(req.session.user.id, req.session.user.username)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(403).json({ ok: false, error: "New accounts can't post images yet. You can post images once your account is 24 hours old, or right away after you publish an addon, server, or model." });
    }
    const rel = path.relative(process.cwd(), req.file.path).split(path.sep).join("/");
    res.json({ ok: true, url: "/" + rel });
  } catch (err) {
    console.error("FORUM IMAGE UPLOAD ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to upload image." });
  }
});

export async function getThreadPayload(id, user = null, { countView = false, viewerKey = null } = {}) {
  const thread = await db.get(
    `SELECT t.*, u.username AS author, u.avatarUrl AS avatarUrl, u.created_at AS author_created_at
     FROM forum_threads t JOIN users u ON u.id = t.author_id WHERE t.id = ?`,
    [id]
  );
  if (!thread) return null;

  const canModerate = isModerator(user);
  const isAuthor = !!user && thread.author_id === user.id;
  // Hidden threads are invisible to everyone except moderators and the author.
  if (thread.hidden && !canModerate && !isAuthor) return null;

  if (countView) {
    let count = true;
    if (viewerKey) {
      const result = await db.run(
        `INSERT INTO forum_thread_views (thread_id, viewer_key, viewed_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(thread_id, viewer_key) DO UPDATE SET viewed_at = CURRENT_TIMESTAMP
         WHERE viewed_at <= datetime('now', ?)`,
        [id, viewerKey, `-${VIEW_WINDOW_HOURS} hours`]
      );
      count = !result || result.changes > 0;
    }
    if (count) {
      await db.run("UPDATE forum_threads SET views = COALESCE(views, 0) + 1 WHERE id = ?", [id]);
    }
  }

  const posts = await db.all(
    `SELECT p.*, u.username AS author, u.avatarUrl AS avatarUrl
     FROM forum_posts p JOIN users u ON u.id = p.author_id
     WHERE p.thread_id = ? ORDER BY p.created_at ASC, p.id ASC`,
    [id]
  );

  let voted = false;
  let votedPosts = new Set();
  if (user) {
    const row = await db.get("SELECT 1 FROM forum_thread_votes WHERE thread_id = ? AND user_id = ?", [id, user.id]);
    voted = !!row;
    const ids = posts.map((p) => p.id);
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const vrows = await db.all(
        `SELECT post_id FROM forum_post_votes WHERE user_id = ? AND post_id IN (${placeholders})`,
        [user.id, ...ids]
      );
      votedPosts = new Set(vrows.map((r) => r.post_id));
    }
  }

  return {
    thread: serializeThread(thread),
    posts: posts.map((p) => {
      const maySee = !p.hidden || canModerate || (user && p.author_id === user.id);
      const base = serializePost(p);
      return {
        ...base,
        voted: votedPosts.has(p.id),
        canEdit: canModify(p, user),
        body: maySee ? base.body : "",
        bodyHtml: maySee ? base.bodyHtml : "",
      };
    }),
    voted,
    canEdit: canModify(thread, user),
    canModerate,
  };
}

router.get("/api/forum/threads/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid thread id." });
    const payload = await getThreadPayload(id, req.session.user || null, { countView: true, viewerKey: viewerKeyFor(req) });
    if (!payload) return res.status(404).json({ ok: false, error: "Discussion not found." });
    res.json({ ok: true, ...payload });
  } catch (err) {
    console.error("FORUM THREAD ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load discussion." });
  }
});

router.post("/api/forum/threads", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in to post." });
    if (!allowForumPost(req.session.user.id)) {
      return res.status(429).json({ ok: false, error: "You're posting too quickly. Try again in a few minutes." });
    }
    const parsed = validateThreadInput(req.body);
    if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
    if ((await isNewAccount(req.session.user.id, req.session.user.username)) && containsLink(parsed.text)) {
      return res.status(403).json({ ok: false, error: "New accounts can't post links yet. Links unlock once your account is 24 hours old, or right away after you publish an addon, server, or model." });
    }

    const id = await withTransaction(async () => {
      const result = await db.run(
        `INSERT INTO forum_threads (author_id, category, title, body, tags, type) VALUES (?, ?, ?, ?, ?, ?)`,
        [req.session.user.id, parsed.category, parsed.title, parsed.text, tagsToJson(parsed.tags), parsed.type]
      );
      return result.lastID;
    });

    await indexThread(id);
    recordMetric("forum_threads");
    await notifyThreadMentions({ id, title: parsed.title }, req.session.user, parsed.text);
    res.json({ ok: true, id, category: parsed.category, type: parsed.type, tags: parsed.tags });
  } catch (err) {
    console.error("FORUM CREATE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to create discussion." });
  }
});

router.put("/api/forum/threads/:id", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid thread id." });

    const thread = await db.get("SELECT id, author_id FROM forum_threads WHERE id = ?", [id]);
    if (!thread) return res.status(404).json({ ok: false, error: "Discussion not found." });
    if (!canModify(thread, req.session.user)) {
      return res.status(403).json({ ok: false, error: "You can only edit your own discussions." });
    }

    const parsed = validateThreadInput(req.body);
    if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
    if ((await isNewAccount(req.session.user.id, req.session.user.username)) && containsLink(parsed.text)) {
      return res.status(403).json({ ok: false, error: "New accounts can't post links yet. Links unlock once your account is 24 hours old, or right away after you publish an addon, server, or model." });
    }

    await db.run(
      `UPDATE forum_threads
       SET title = ?, body = ?, category = ?, tags = ?, type = ?, edited_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [parsed.title, parsed.text, parsed.category, tagsToJson(parsed.tags), parsed.type, id]
    );

    await indexThread(id);
    res.json({ ok: true });
  } catch (err) {
    console.error("FORUM EDIT ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to update discussion." });
  }
});

router.delete("/api/forum/threads/:id", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid thread id." });

    const thread = await db.get("SELECT id, author_id FROM forum_threads WHERE id = ?", [id]);
    if (!thread) return res.status(404).json({ ok: false, error: "Discussion not found." });
    if (!canModify(thread, req.session.user)) {
      return res.status(403).json({ ok: false, error: "You can only delete your own discussions." });
    }

    await withTransaction(async () => {
      await db.run("DELETE FROM forum_thread_votes WHERE thread_id = ?", [id]);
      await db.run("DELETE FROM forum_posts WHERE thread_id = ?", [id]);
      await db.run("DELETE FROM forum_threads WHERE id = ?", [id]);
    });

    await removeThreadIndex(id);
    res.json({ ok: true });
  } catch (err) {
    console.error("FORUM DELETE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to delete discussion." });
  }
});

router.post("/api/forum/threads/:id/posts", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in to reply." });
    if (!allowForumPost(req.session.user.id)) {
      return res.status(429).json({ ok: false, error: "You're posting too quickly. Try again in a few minutes." });
    }

    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid thread id." });

    const text = String(req.body?.body || "").trim();
    if (!text || text.length > MAX_BODY) {
      return res.status(400).json({ ok: false, error: "Reply must be between 1 and 20000 characters." });
    }
    if ((await isNewAccount(req.session.user.id, req.session.user.username)) && containsLink(text)) {
      return res.status(403).json({ ok: false, error: "New accounts can't post links yet. Links unlock once your account is 24 hours old, or right away after you publish an addon, server, or model." });
    }

    const thread = await db.get("SELECT id, status, locked, title, author_id FROM forum_threads WHERE id = ?", [id]);
    if (!thread) return res.status(404).json({ ok: false, error: "Discussion not found." });
    if (thread.locked || thread.status === "locked") {
      return res.status(403).json({ ok: false, error: "This discussion is locked." });
    }

    const postId = await withTransaction(async () => {
      const result = await db.run(
        `INSERT INTO forum_posts (thread_id, author_id, body) VALUES (?, ?, ?)`,
        [id, req.session.user.id, text]
      );
      await db.run(
        `UPDATE forum_threads
         SET reply_count = COALESCE(reply_count, 0) + 1, last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [id]
      );
      return result.lastID;
    });

    const post = await db.get(
      `SELECT p.*, u.username AS author, u.avatarUrl AS avatarUrl
       FROM forum_posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`,
      [postId]
    );

    await notifyForumReply(thread, req.session.user, postId, text);
    await indexPost(postId);
    recordMetric("forum_replies");

    res.json({ ok: true, post: serializePost(post) });
  } catch (err) {
    console.error("FORUM REPLY ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to post reply." });
  }
});

router.put("/api/forum/posts/:id", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid post id." });

    const post = await db.get("SELECT id, author_id FROM forum_posts WHERE id = ?", [id]);
    if (!post) return res.status(404).json({ ok: false, error: "Reply not found." });
    if (!canModify(post, req.session.user)) {
      return res.status(403).json({ ok: false, error: "You can only edit your own replies." });
    }

    const text = String(req.body?.body || "").trim();
    if (!text || text.length > MAX_BODY) {
      return res.status(400).json({ ok: false, error: "Reply must be between 1 and 20000 characters." });
    }
    if ((await isNewAccount(req.session.user.id, req.session.user.username)) && containsLink(text)) {
      return res.status(403).json({ ok: false, error: "New accounts can't post links yet. Links unlock once your account is 24 hours old, or right away after you publish an addon, server, or model." });
    }

    await db.run("UPDATE forum_posts SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?", [text, id]);
    await indexPost(id);
    res.json({ ok: true });
  } catch (err) {
    console.error("FORUM POST EDIT ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to update reply." });
  }
});

router.delete("/api/forum/posts/:id", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid post id." });

    const post = await db.get("SELECT id, thread_id, author_id FROM forum_posts WHERE id = ?", [id]);
    if (!post) return res.status(404).json({ ok: false, error: "Reply not found." });
    if (!canModify(post, req.session.user)) {
      return res.status(403).json({ ok: false, error: "You can only delete your own replies." });
    }

    await withTransaction(async () => {
      await db.run("DELETE FROM forum_posts WHERE id = ?", [id]);
      await db.run(
        "UPDATE forum_threads SET reply_count = MAX(0, COALESCE(reply_count, 0) - 1) WHERE id = ?",
        [post.thread_id]
      );
    });

    await removePostIndex(id);
    res.json({ ok: true });
  } catch (err) {
    console.error("FORUM POST DELETE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to delete reply." });
  }
});

router.post("/api/forum/threads/:id/vote", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in to vote." });

    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid thread id." });

    const thread = await db.get("SELECT id, author_id, title FROM forum_threads WHERE id = ?", [id]);
    if (!thread) return res.status(404).json({ ok: false, error: "Discussion not found." });

    const userId = req.session.user.id;
    const result = await withTransaction(async () => {
      const existing = await db.get("SELECT 1 FROM forum_thread_votes WHERE thread_id = ? AND user_id = ?", [id, userId]);
      if (existing) {
        await db.run("DELETE FROM forum_thread_votes WHERE thread_id = ? AND user_id = ?", [id, userId]);
        await db.run("UPDATE forum_threads SET votes = MAX(0, COALESCE(votes, 0) - 1) WHERE id = ?", [id]);
        return { voted: false };
      }
      await db.run("INSERT OR IGNORE INTO forum_thread_votes (thread_id, user_id) VALUES (?, ?)", [id, userId]);
      await db.run("UPDATE forum_threads SET votes = COALESCE(votes, 0) + 1 WHERE id = ?", [id]);
      return { voted: true };
    });

    if (result.voted && thread.author_id !== userId) {
      try {
        await createNotification({
          userId: thread.author_id,
          type: "forum_vote",
          message: `${req.session.user.username} upvoted your discussion "${thread.title}"`,
          link: `/forum/t/${id}`,
          dedupeKey: `forum:vote:thread:${id}:${userId}`,
        });
      } catch (err) {
        console.error("Failed to create thread vote notification:", err);
      }
    }

    const row = await db.get("SELECT votes FROM forum_threads WHERE id = ?", [id]);
    res.json({ ok: true, voted: result.voted, votes: row?.votes || 0 });
  } catch (err) {
    console.error("FORUM VOTE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to vote." });
  }
});

router.post("/api/forum/threads/:id/accept", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid thread id." });

    const thread = await db.get("SELECT id, author_id, title, accepted_post_id FROM forum_threads WHERE id = ?", [id]);
    if (!thread) return res.status(404).json({ ok: false, error: "Discussion not found." });
    if (!canModify(thread, req.session.user)) {
      return res.status(403).json({ ok: false, error: "Only the author can accept an answer." });
    }

    const raw = req.body?.postId;
    if (raw === null || raw === undefined || raw === 0 || raw === "0") {
      await db.run("UPDATE forum_threads SET accepted_post_id = NULL, status = 'open' WHERE id = ?", [id]);
      return res.json({ ok: true, acceptedPostId: null, solved: false });
    }

    const pid = parseInt(raw, 10);
    if (!Number.isInteger(pid)) return res.status(400).json({ ok: false, error: "Invalid reply id." });

    const post = await db.get("SELECT id, author_id FROM forum_posts WHERE id = ? AND thread_id = ?", [pid, id]);
    if (!post) return res.status(404).json({ ok: false, error: "That reply isn't part of this discussion." });

    await db.run("UPDATE forum_threads SET accepted_post_id = ?, status = 'solved' WHERE id = ?", [pid, id]);

    if (post.author_id !== req.session.user.id) {
      try {
        await createNotification({
          userId: post.author_id,
          type: "forum_accepted",
          message: `Your answer was accepted on "${thread.title}"`,
          link: `/forum/t/${id}`,
          dedupeKey: `forum:accepted:${id}:${pid}`,
        });
      } catch (err) {
        console.error("Failed to create accepted-answer notification:", err);
      }
    }

    res.json({ ok: true, acceptedPostId: pid, solved: true });
  } catch (err) {
    console.error("FORUM ACCEPT ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to accept the answer." });
  }
});

router.post("/api/forum/posts/:id/vote", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in to vote." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid post id." });

    const post = await db.get(
      `SELECT p.id, p.author_id, p.thread_id, t.title
       FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id
       WHERE p.id = ?`,
      [id]
    );
    if (!post) return res.status(404).json({ ok: false, error: "Reply not found." });

    const userId = req.session.user.id;
    const result = await withTransaction(async () => {
      const existing = await db.get("SELECT 1 FROM forum_post_votes WHERE post_id = ? AND user_id = ?", [id, userId]);
      if (existing) {
        await db.run("DELETE FROM forum_post_votes WHERE post_id = ? AND user_id = ?", [id, userId]);
        await db.run("UPDATE forum_posts SET votes = MAX(0, COALESCE(votes, 0) - 1) WHERE id = ?", [id]);
        return { voted: false };
      }
      await db.run("INSERT OR IGNORE INTO forum_post_votes (post_id, user_id) VALUES (?, ?)", [id, userId]);
      await db.run("UPDATE forum_posts SET votes = COALESCE(votes, 0) + 1 WHERE id = ?", [id]);
      return { voted: true };
    });

    if (result.voted && post.author_id !== userId) {
      try {
        await createNotification({
          userId: post.author_id,
          type: "forum_vote",
          message: `${req.session.user.username} upvoted your reply in "${post.title}"`,
          link: `/forum/t/${post.thread_id}`,
          dedupeKey: `forum:vote:post:${id}:${userId}`,
        });
      } catch (err) {
        console.error("Failed to create post vote notification:", err);
      }
    }

    const row = await db.get("SELECT votes FROM forum_posts WHERE id = ?", [id]);
    res.json({ ok: true, voted: result.voted, votes: row?.votes || 0 });
  } catch (err) {
    console.error("FORUM POST VOTE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to vote." });
  }
});

router.post("/api/forum/threads/:id/pin", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in." });
    if (!isModerator(req.session.user)) return res.status(403).json({ ok: false, error: "Moderators only." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid thread id." });

    const thread = await db.get("SELECT id, pinned FROM forum_threads WHERE id = ?", [id]);
    if (!thread) return res.status(404).json({ ok: false, error: "Discussion not found." });

    const pinned = thread.pinned ? 0 : 1;
    if (pinned) {
      await db.run("UPDATE forum_threads SET pinned = 1, pinned_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    } else {
      await db.run("UPDATE forum_threads SET pinned = 0, pinned_at = NULL WHERE id = ?", [id]);
    }
    res.json({ ok: true, pinned: !!pinned });
  } catch (err) {
    console.error("FORUM PIN ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to update pin." });
  }
});

router.post("/api/forum/threads/:id/lock", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in." });
    if (!isModerator(req.session.user)) return res.status(403).json({ ok: false, error: "Moderators only." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid thread id." });

    const thread = await db.get("SELECT id, locked FROM forum_threads WHERE id = ?", [id]);
    if (!thread) return res.status(404).json({ ok: false, error: "Discussion not found." });

    const locked = thread.locked ? 0 : 1;
    await db.run("UPDATE forum_threads SET locked = ? WHERE id = ?", [locked, id]);
    res.json({ ok: true, locked: !!locked });
  } catch (err) {
    console.error("FORUM LOCK ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to update lock." });
  }
});

router.get("/api/forum/whoami", (req, res) => {
  const user = req.session.user || null;
  res.json({ ok: true, isModerator: isModerator(user), isAdmin: isForumAdmin(user) });
});

router.post("/api/forum/threads/:id/hide", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in." });
    if (!isModerator(req.session.user)) return res.status(403).json({ ok: false, error: "Moderators only." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid thread id." });
    const row = await db.get("SELECT id, hidden FROM forum_threads WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ ok: false, error: "Discussion not found." });
    const hidden = row.hidden ? 0 : 1;
    await db.run("UPDATE forum_threads SET hidden = ? WHERE id = ?", [hidden, id]);
    res.json({ ok: true, hidden: !!hidden });
  } catch (err) {
    console.error("FORUM HIDE THREAD ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to update visibility." });
  }
});

router.post("/api/forum/posts/:id/hide", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in." });
    if (!isModerator(req.session.user)) return res.status(403).json({ ok: false, error: "Moderators only." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid reply id." });
    const row = await db.get("SELECT id, hidden FROM forum_posts WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ ok: false, error: "Reply not found." });
    const hidden = row.hidden ? 0 : 1;
    await db.run("UPDATE forum_posts SET hidden = ? WHERE id = ?", [hidden, id]);
    res.json({ ok: true, hidden: !!hidden });
  } catch (err) {
    console.error("FORUM HIDE POST ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to update visibility." });
  }
});

// The forum admin can grant/revoke limited moderator powers. Moderators can
// view the list; only the admin can change it.
router.get("/api/forum/moderators", async (req, res) => {
  try {
    if (!isModerator(req.session.user || null)) return res.status(403).json({ ok: false, error: "Moderators only." });
    const moderators = await db.all(
      `SELECT m.user_id AS id, u.username, m.created_at AS createdAt
       FROM forum_moderators m JOIN users u ON u.id = m.user_id
       ORDER BY u.username COLLATE NOCASE ASC`
    );
    res.json({ ok: true, moderators });
  } catch (err) {
    console.error("FORUM MODERATORS LIST ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load moderators." });
  }
});

router.post("/api/forum/moderators", async (req, res) => {
  try {
    if (!isForumAdmin(req.session.user || null)) return res.status(403).json({ ok: false, error: "Admins only." });
    const username = String(req.body?.username || "").trim();
    if (!username) return res.status(400).json({ ok: false, error: "Enter a username." });
    const user = await db.get("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE", [username]);
    if (!user) return res.status(404).json({ ok: false, error: "No account with that username." });
    if (isForumAdmin(user)) return res.status(400).json({ ok: false, error: "That account is the forum admin." });
    const already = await db.get("SELECT 1 FROM forum_moderators WHERE user_id = ?", [user.id]);
    await db.run("INSERT OR IGNORE INTO forum_moderators (user_id, added_by) VALUES (?, ?)", [user.id, req.session.user.id]);
    await refreshModerators();
    if (!already) {
      try {
        await createNotification({
          userId: user.id,
          type: "forum_moderator",
          message: "You've been given forum moderator powers.",
          link: "/forum",
        });
      } catch (err) {
        console.error("Failed to notify new moderator:", err);
      }
    }
    res.json({ ok: true, id: user.id, username: user.username });
  } catch (err) {
    console.error("FORUM MODERATOR ADD ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to add moderator." });
  }
});

router.delete("/api/forum/moderators/:userId", async (req, res) => {
  try {
    if (!isForumAdmin(req.session.user || null)) return res.status(403).json({ ok: false, error: "Admins only." });
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId)) return res.status(400).json({ ok: false, error: "Invalid user id." });
    const target = await db.get("SELECT id FROM users WHERE id = ?", [userId]);
    const removed = await db.run("DELETE FROM forum_moderators WHERE user_id = ?", [userId]);
    await refreshModerators();
    if (target && removed && removed.changes > 0) {
      try {
        await createNotification({
          userId: target.id,
          type: "forum_moderator",
          message: "Your forum moderator access was removed.",
          link: "/forum",
        });
      } catch (err) {
        console.error("Failed to notify removed moderator:", err);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("FORUM MODERATOR REMOVE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to remove moderator." });
  }
});

async function createReport(targetType, targetId, req, res) {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "You must be logged in to report." });
    const table = targetType === "thread" ? "forum_threads" : "forum_posts";
    const target = await db.get(`SELECT id FROM ${table} WHERE id = ?`, [targetId]);
    if (!target) return res.status(404).json({ ok: false, error: "That content no longer exists." });
    const reason = String(req.body?.reason || "").trim().slice(0, 500) || null;
    await db.run(
      "INSERT INTO forum_reports (target_type, target_id, reporter_id, reason) VALUES (?, ?, ?, ?)",
      [targetType, targetId, req.session.user.id, reason]
    );

    // Notify moderators + the admin (in-app) so reports don't sit unseen.
    try {
      let threadId = targetId;
      if (targetType === "post") {
        const p = await db.get("SELECT thread_id FROM forum_posts WHERE id = ?", [targetId]);
        threadId = p?.thread_id || null;
      }
      const recipients = new Set(getModeratorIds());
      const adminRow = await db.get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [FORUM_ADMIN_USERNAME]);
      if (adminRow) recipients.add(adminRow.id);
      recipients.delete(req.session.user.id);
      for (const userId of recipients) {
        try {
          await createNotification({
            userId,
            type: "forum_report",
            message: "A forum post was reported.",
            link: threadId ? `/forum/t/${threadId}` : "/forum",
          });
        } catch (err) {
          console.error("Failed to notify moderator of report:", err);
        }
      }
    } catch (err) {
      console.error("Failed to dispatch report notifications:", err);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("FORUM REPORT ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to submit report." });
  }
}

router.post("/api/forum/threads/:id/report", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid thread id." });
  return createReport("thread", id, req, res);
});

router.post("/api/forum/posts/:id/report", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid post id." });
  return createReport("post", id, req, res);
});

router.get("/api/forum/reports", async (req, res) => {
  try {
    if (!isModerator(req.session.user)) return res.status(403).json({ ok: false, error: "Moderators only." });
    const rows = await db.all("SELECT * FROM forum_reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 50");
    const reports = [];
    for (const r of rows) {
      let title = null;
      let threadId = null;
      if (r.target_type === "thread") {
        const t = await db.get("SELECT id, title FROM forum_threads WHERE id = ?", [r.target_id]);
        if (t) { title = t.title; threadId = t.id; }
      } else {
        const p = await db.get("SELECT thread_id FROM forum_posts WHERE id = ?", [r.target_id]);
        if (p) {
          threadId = p.thread_id;
          const t = await db.get("SELECT title FROM forum_threads WHERE id = ?", [p.thread_id]);
          title = t?.title || null;
        }
      }
      reports.push({ id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, createdAt: r.created_at, title, threadId });
    }
    res.json({ ok: true, reports });
  } catch (err) {
    console.error("FORUM REPORTS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load reports." });
  }
});

router.post("/api/forum/reports/:id/resolve", async (req, res) => {
  try {
    if (!isModerator(req.session.user)) return res.status(403).json({ ok: false, error: "Moderators only." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid report id." });
    await db.run(
      "UPDATE forum_reports SET status = 'resolved', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
      [req.session.user.id, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("FORUM REPORT RESOLVE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to resolve report." });
  }
});

router.get("/api/forum/activity", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);
    const threads = await db.all(
      `SELECT t.id AS thread_id, t.title, t.created_at, u.username AS actor, u.avatarUrl AS avatarUrl
       FROM forum_threads t JOIN users u ON u.id = t.author_id
       ORDER BY t.created_at DESC LIMIT ?`,
      [limit]
    );
    const posts = await db.all(
      `SELECT p.thread_id, p.created_at, u.username AS actor, u.avatarUrl AS avatarUrl, t.title
       FROM forum_posts p JOIN users u ON u.id = p.author_id JOIN forum_threads t ON t.id = p.thread_id
       ORDER BY p.created_at DESC LIMIT ?`,
      [limit]
    );
    const items = [];
    for (const t of threads) items.push({ type: "thread", actor: t.actor, avatarUrl: t.avatarUrl || null, title: t.title, threadId: t.thread_id, createdAt: t.created_at });
    for (const p of posts) items.push({ type: "reply", actor: p.actor, avatarUrl: p.avatarUrl || null, title: p.title, threadId: p.thread_id, createdAt: p.created_at });
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ ok: true, items: items.slice(0, limit) });
  } catch (err) {
    console.error("FORUM ACTIVITY ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load activity." });
  }
});

router.get("/api/forum/contributors", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT u.id, u.username, u.avatarUrl AS avatarUrl,
              (SELECT COUNT(*) FROM forum_threads t WHERE t.author_id = u.id AND t.hidden = 0) AS threads,
              (SELECT COUNT(*) FROM forum_posts p WHERE p.author_id = u.id AND p.hidden = 0) AS replies
       FROM users u
       WHERE (SELECT COUNT(*) FROM forum_threads t WHERE t.author_id = u.id AND t.hidden = 0)
           + (SELECT COUNT(*) FROM forum_posts p WHERE p.author_id = u.id AND p.hidden = 0) > 0
       ORDER BY (threads * 2 + replies) DESC, threads DESC, replies DESC, u.username COLLATE NOCASE ASC
       LIMIT 5`
    );
    res.json({
      ok: true,
      contributors: rows.map((r) => ({
        id: r.id,
        username: r.username,
        avatarUrl: r.avatarUrl || null,
        threads: r.threads || 0,
        replies: r.replies || 0,
        posts: (r.threads || 0) + (r.replies || 0),
      })),
    });
  } catch (err) {
    console.error("FORUM CONTRIBUTORS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load contributors." });
  }
});

export default router;
