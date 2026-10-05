import { db } from "../db/index.js";

// FTS5 row layout:
//   kind='thread' -> title = thread title, body = thread body, ref_id = thread id
//   kind='post'   -> title = '',            body = post body,   ref_id = post id
// thread_id links both back to the thread so a search can be grouped per thread.
const SNIPPET_BEFORE = "\u0001";
const SNIPPET_AFTER = "\u0002";

export async function indexThread(threadId) {
  const row = await db.get("SELECT id, title, body FROM forum_threads WHERE id = ?", [threadId]);
  await db.run("DELETE FROM forum_fts WHERE kind = 'thread' AND ref_id = ?", [threadId]);
  if (row) {
    await db.run(
      "INSERT INTO forum_fts (title, body, thread_id, kind, ref_id) VALUES (?, ?, ?, 'thread', ?)",
      [row.title, row.body, row.id, row.id]
    );
  }
}

export async function indexPost(postId) {
  const row = await db.get("SELECT id, thread_id, body FROM forum_posts WHERE id = ?", [postId]);
  await db.run("DELETE FROM forum_fts WHERE kind = 'post' AND ref_id = ?", [postId]);
  if (row) {
    await db.run(
      "INSERT INTO forum_fts (title, body, thread_id, kind, ref_id) VALUES ('', ?, ?, 'post', ?)",
      [row.body, row.thread_id, row.id]
    );
  }
}

export async function removeThreadIndex(threadId) {
  await db.run("DELETE FROM forum_fts WHERE thread_id = ?", [threadId]);
}

export async function removePostIndex(postId) {
  await db.run("DELETE FROM forum_fts WHERE kind = 'post' AND ref_id = ?", [postId]);
}

// Turn free text into a safe FTS5 MATCH expression (each term quoted as a phrase).
export function buildMatch(query) {
  const terms = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/["']/g, "").trim())
    .filter((t) => t.length >= 1)
    .slice(0, 8);
  if (!terms.length) return "";
  return terms.map((t) => `"${t}"`).join(" ");
}

// Returns thread ids best-match-first plus a highlighted snippet per thread.
export async function searchThreads(query, { limit = 200 } = {}) {
  const match = buildMatch(query);
  if (!match) return { ids: [], ranks: new Map(), snippets: new Map() };

  let rows = [];
  try {
    rows = await db.all(
      `SELECT thread_id, bm25(forum_fts) AS rank
       FROM forum_fts WHERE forum_fts MATCH ?
       ORDER BY rank ASC LIMIT ?`,
      [match, Math.min(limit * 8, 5000)]
    );
  } catch (err) {
    console.error("forum FTS query failed:", err);
    return { ids: [], ranks: new Map(), snippets: new Map() };
  }

  const ranks = new Map();
  const ids = [];
  for (const r of rows) {
    if (!ranks.has(r.thread_id)) {
      ranks.set(r.thread_id, r.rank);
      ids.push(r.thread_id);
    }
  }

  const snippets = new Map();
  for (const id of ids) {
    try {
      const s = await db.get(
        `SELECT snippet(forum_fts, -1, ?, ?, '…', 14) AS snip
         FROM forum_fts WHERE forum_fts MATCH ? AND thread_id = ?
         ORDER BY bm25(forum_fts) ASC LIMIT 1`,
        [SNIPPET_BEFORE, SNIPPET_AFTER, match, id]
      );
      snippets.set(id, s?.snip || null);
    } catch {
      snippets.set(id, null);
    }
  }

  return { ids, ranks, snippets };
}

export const SNIPPET_MARKERS = { before: SNIPPET_BEFORE, after: SNIPPET_AFTER };
