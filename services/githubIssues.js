import { db } from "../db/index.js";

// GitHub issues bridge: mirror open issues from configured repos into SQLite so
// they can be searched alongside forum threads. Optional GITHUB_TOKEN raises the
// API rate limit; without it the repo issues endpoint (60/hr) is used, so
// refreshes are kept infrequent.
const TOKEN = process.env.GITHUB_TOKEN || "";
const REPOS = (process.env.GITHUB_REPOS || "PixelGuys/Cubyz")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_PAGES = 5;

async function ghFetch(url) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "cubyz-hub" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${url}`);
  return res.json();
}

function labelNames(labels) {
  return (labels || [])
    .map((l) => (typeof l === "string" ? l : l && l.name))
    .filter(Boolean);
}

async function upsertIssue(issue, repo) {
  if (!issue || !issue.id) return;
  await db.run(
    `INSERT INTO github_issues
       (id, repo, number, title, body, state, labels, author, html_url, comments, is_pr, github_created_at, github_updated_at, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       body = excluded.body,
       state = excluded.state,
       labels = excluded.labels,
       author = excluded.author,
       html_url = excluded.html_url,
       comments = excluded.comments,
       is_pr = excluded.is_pr,
       github_updated_at = excluded.github_updated_at,
       fetched_at = CURRENT_TIMESTAMP`,
    [
      issue.id,
      repo,
      issue.number,
      issue.title || "",
      issue.body || "",
      issue.state || "open",
      JSON.stringify(labelNames(issue.labels)),
      (issue.user && issue.user.login) || "",
      issue.html_url || "",
      issue.comments || 0,
      issue.pull_request ? 1 : 0,
      issue.created_at || null,
      issue.updated_at || null,
    ]
  );
}

export async function refreshGitHubIssues() {
  // Open issues first (the bulk), then the most recently updated closed ones so
  // resolved problems are searchable too.
  const passes = [
    { state: "open", pages: 6 },
    { state: "closed", pages: 4 },
  ];
  for (const repo of REPOS) {
    for (const pass of passes) {
      for (let page = 1; page <= pass.pages; page++) {
        let items;
        try {
          items = await ghFetch(`https://api.github.com/repos/${repo}/issues?state=${pass.state}&sort=updated&direction=desc&per_page=100&page=${page}`);
        } catch (err) {
          console.error(`GitHub refresh failed for ${repo} (${pass.state}):`, err.message);
          break;
        }
        if (!Array.isArray(items) || items.length === 0) break;
        for (const issue of items) await upsertIssue(issue, repo);
        if (items.length < 100) break;
      }
    }
  }
  await rebuildFts().catch((err) => console.error("GitHub FTS rebuild failed:", err.message));
}

async function rebuildFts() {
  await db.run("DELETE FROM github_issues_fts");
  await db.run(
    "INSERT INTO github_issues_fts (title, body, id, repo, number) SELECT title, body, id, repo, number FROM github_issues"
  );
}

async function ensureFts() {
  const total = (await db.get("SELECT COUNT(*) AS n FROM github_issues"))?.n || 0;
  const indexed = (await db.get("SELECT COUNT(*) AS n FROM github_issues_fts"))?.n || 0;
  if (total !== indexed) await rebuildFts();
}

export async function maybeRefreshGitHubIssues() {
  try {
    const row = await db.get("SELECT MAX(fetched_at) AS t FROM github_issues");
    const last = row && row.t ? new Date(String(row.t).replace(" ", "T") + "Z").getTime() : 0;
    if (Date.now() - last > REFRESH_MS) await refreshGitHubIssues();
    else await ensureFts();
  } catch (err) {
    console.error("GitHub maybe-refresh error:", err.message);
  }
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "are", "was", "were", "be", "been",
  "it", "this", "that", "with", "how", "do", "does", "did", "can", "cant", "not", "no", "yes", "i", "my",
  "me", "we", "you", "your", "they", "he", "she", "at", "as", "by", "from", "but", "if", "then", "so", "just",
  "get", "got", "have", "has", "had", "will", "would", "should", "could", "about", "when", "where", "which",
  "who", "why", "what", "there", "here", "up", "down", "out", "isnt", "dont", "wont",
]);

// Drop stopwords and short tokens.
function githubTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .slice(0, 8);
}

// Build a relevance-friendly FTS5 MATCH (prefix terms, OR'd).
export function buildGithubMatch(query) {
  const terms = githubTerms(query);
  if (!terms.length) return "";
  return terms.map((t) => `${t}*`).join(" OR ");
}

function safeLabels(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function ftsSearch(match, limit, offset) {
  const rows = await db.all(
    `SELECT id, bm25(github_issues_fts, 10.0, 1.0) AS rank,
            snippet(github_issues_fts, -1, '', '', '…', 12) AS snippet
     FROM github_issues_fts
     WHERE github_issues_fts MATCH ?
     ORDER BY rank ASC
     LIMIT ? OFFSET ?`,
    [match, limit, offset]
  );
  const totalRow = await db.get("SELECT COUNT(*) AS n FROM github_issues_fts WHERE github_issues_fts MATCH ?", [match]);
  return { rows, total: (totalRow && totalRow.n) || 0 };
}

export async function searchGitHubIssues(query, limit = 15, offset = 0) {
  const terms = githubTerms(query);
  if (!terms.length) return { items: [], total: 0 };

  // Precision first (all terms), then fall back to recall (any term).
  const strict = terms.map((t) => `${t}*`).join(" AND ");
  const loose = terms.map((t) => `${t}*`).join(" OR ");
  const CANDIDATES = 200;
  let res;
  try {
    res = await ftsSearch(strict, CANDIDATES, 0);
    if (res.total < 3 && terms.length > 1) {
      res = await ftsSearch(loose, CANDIDATES, 0);
    }
  } catch (err) {
    console.error("GitHub FTS search failed:", err.message);
    return { items: [], total: 0 };
  }
  if (!res.rows.length) return { items: [], total: 0 };

  const ids = res.rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const issues = await db.all(`SELECT * FROM github_issues WHERE id IN (${placeholders})`, ids);
  const byId = new Map(issues.map((i) => [i.id, i]));
  // Matches are relevance-filtered; order them by most comments (GitHub
  // engagement), keeping BM25 relevance as the tie-breaker.
  const items = res.rows
    .map((r) => {
      const it = byId.get(r.id);
      return it ? { ...it, labels: safeLabels(it.labels), snippet: r.snippet, _rank: r.rank } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.comments || 0) - (a.comments || 0) || a._rank - b._rank)
    .slice(offset, offset + limit)
    .map(({ _rank, ...it }) => it);

  return { items, total: res.total };
}

export async function githubIssueCount() {
  const row = await db.get("SELECT COUNT(*) AS n FROM github_issues");
  return (row && row.n) || 0;
}
