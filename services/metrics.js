import { db, withTransaction } from "../db/index.js";

// Columns are whitelisted because they're interpolated into the UPSERT.
const METRIC_COLUMNS = new Set([
  "new_users",
  "logins",
  "active_users",
  "downloads",
  "uploads",
  "comments",
  "likes",
  "new_servers",
  "creator_saves",
  "peak_online",
  "forum_threads",
  "forum_replies",
]);

const ONLINE_WINDOW = "-5 minutes";

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

// Increment today's counter for `column`. Never throws into request paths.
export async function recordMetric(column, delta = 1) {
  if (!METRIC_COLUMNS.has(column)) {
    console.error("recordMetric: unknown metric", column);
    return;
  }
  try {
    const day = utcDay();
    await db.run(
      `INSERT INTO metrics_daily (day, ${column}) VALUES (?, ?)
       ON CONFLICT(day) DO UPDATE SET ${column} = ${column} + excluded.${column}, updated_at = CURRENT_TIMESTAMP`,
      [day, delta]
    );
  } catch (err) {
    console.error("recordMetric failed:", column, err);
  }
}

// Cache of users already counted active today, so a request every 15s
// doesn't open a write transaction every 15s.
const countedActive = new Map();

// Count this user as active once per UTC day (idempotent).
export async function recordActive(userId) {
  if (!userId) return;
  const day = utcDay();
  if (countedActive.get(userId) === day) return;
  try {
    await withTransaction(async () => {
      const inserted = await db.run(
        "INSERT OR IGNORE INTO metrics_active (day, user_id) VALUES (?, ?)",
        [day, userId]
      );
      if (inserted.changes > 0) {
        await db.run(
          `INSERT INTO metrics_daily (day, active_users) VALUES (?, 1)
           ON CONFLICT(day) DO UPDATE SET active_users = active_users + 1, updated_at = CURRENT_TIMESTAMP`,
          [day]
        );
      }
    });
    countedActive.set(userId, day);
  } catch (err) {
    console.error("recordActive failed:", err);
  }
}

export async function getOnlineNow() {
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM users WHERE last_seen > datetime('now', '${ONLINE_WINDOW}')`
  );
  return row?.n || 0;
}

// Store the highest concurrent-online figure seen today (sampled periodically).
export async function refreshOnlinePeak() {
  const day = utcDay();
  const online = await getOnlineNow();
  await db.run(
    `INSERT INTO metrics_daily (day, peak_online) VALUES (?, ?)
     ON CONFLICT(day) DO UPDATE SET peak_online = MAX(peak_online, excluded.peak_online), updated_at = CURRENT_TIMESTAMP`,
    [day, online]
  );
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

function dayKey(offsetDays) {
  return new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
}

export async function getPublicMetrics() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const totals = {
    users: (await db.get("SELECT COUNT(*) AS n FROM users"))?.n || 0,
    addons: (await db.get("SELECT COUNT(*) AS n FROM addons WHERE type <> 'mod'"))?.n || 0,
    mods: (await db.get("SELECT COUNT(*) AS n FROM addons WHERE type = 'mod'"))?.n || 0,
    models: (await db.get("SELECT COUNT(*) AS n FROM models WHERE status = 'published'"))?.n || 0,
    servers: (await db.get("SELECT COUNT(*) AS n FROM servers WHERE status = 'published'"))?.n || 0,
    downloads: (await db.get("SELECT COALESCE(SUM(downloads), 0) AS n FROM addons"))?.n || 0,
    comments: (await db.get("SELECT COUNT(*) AS n FROM comments"))?.n || 0,
    forumThreads: (await db.get("SELECT COUNT(*) AS n FROM forum_threads WHERE hidden = 0"))?.n || 0,
    forumReplies: (await db.get("SELECT COUNT(*) AS n FROM forum_posts WHERE hidden = 0"))?.n || 0,
  };

  const trackingSince = (await db.get("SELECT MIN(day) AS d FROM metrics_daily"))?.d || null;

  const rows = await db.all("SELECT * FROM metrics_daily WHERE day >= ? ORDER BY day ASC", [dayKey(89)]);
  const byDay = new Map(rows.map((r) => [r.day, r]));

  const series = [];
  for (let i = 89; i >= 0; i--) {
    const day = dayKey(i);
    const r = byDay.get(day) || {};
    series.push({
      day,
      newUsers: r.new_users || 0,
      logins: r.logins || 0,
      activeUsers: r.active_users || 0,
      downloads: r.downloads || 0,
      uploads: r.uploads || 0,
      comments: r.comments || 0,
      likes: r.likes || 0,
      newServers: r.new_servers || 0,
      creatorSaves: r.creator_saves || 0,
      peakOnline: r.peak_online || 0,
      forumThreads: r.forum_threads || 0,
      forumReplies: r.forum_replies || 0,
    });
  }

  const monthly = await db.all(
    `SELECT substr(day, 1, 7) AS month,
            SUM(new_users) AS newUsers, SUM(logins) AS logins, SUM(active_users) AS activeUsers,
            SUM(downloads) AS downloads, SUM(uploads) AS uploads, SUM(comments) AS comments,
            SUM(likes) AS likes, SUM(new_servers) AS newServers, SUM(creator_saves) AS creatorSaves,
            MAX(peak_online) AS peakOnline,
            SUM(forum_threads) AS forumThreads, SUM(forum_replies) AS forumReplies
     FROM metrics_daily GROUP BY month ORDER BY month ASC`  );

  const data = {
    trackingSince,
    generatedAt: new Date().toISOString(),
    online: await getOnlineNow(),
    totals,
    series,
    monthly,
  };
  cache = { at: Date.now(), data };
  return data;
}
