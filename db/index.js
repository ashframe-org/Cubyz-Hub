import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { AsyncLocalStorage } from "async_hooks";

export let db;
// Flips true only after every table/index/migration in initDb() has run.
// Routes gate on this so a request arriving mid-migration gets a 503
// instead of a half-initialised schema or a TypeError on an undefined db.
export let dbReady = false;

export async function initDb() {
  db = await open({
    filename: process.env.DB_PATH || "./cubyzhub.db",
    driver: sqlite3.Database,
  });

  await db.exec(`PRAGMA journal_mode = WAL;`);
  await db.exec(`PRAGMA busy_timeout = 5000;`);
  // Enforce the FOREIGN KEY ... ON DELETE CASCADE clauses declared in the
  // schema. The app also deletes children explicitly, but this guarantees
  // no orphaned rows slip through any path that forgets to. It only affects
  // writes from here on - pre-existing orphan rows are reported below and
  // are otherwise left untouched.
  await db.exec(`PRAGMA foreign_keys = ON;`);

  setInterval(() => {
    db.exec(`PRAGMA wal_checkpoint(PASSIVE);`).catch((err) => {
      console.error("Periodic WAL checkpoint failed:", err);
    });
  }, 3 * 60 * 1000).unref();

  await db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    about TEXT,
    security_question TEXT,
    security_answer_hash TEXT,
    recovery_code_hash TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS addons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT UNIQUE,
    name TEXT,
    author TEXT,
    version TEXT,
    description TEXT,
    longDescription TEXT,
    tags TEXT,
    compatibility TEXT,
    iconUrl TEXT,
    bannerUrl TEXT,
    creators TEXT,
    screenshots TEXT,
    fileUrl TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP, -- Added for Ribbon Calculations
    stars INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    addon_id INTEGER,
    username TEXT,
    content TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    addon_id INTEGER,
    version TEXT,
    fileUrl TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS passkeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    device_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    addon_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER,
    followed_username TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    message TEXT,
    link TEXT,
    read INTEGER DEFAULT 0,
    dedupe_key TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS changelog_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author_username TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  `);

  const changelogColumns = await db.all(`PRAGMA table_info(changelog_entries);`);
  if (!changelogColumns.some((col) => col.name === "is_test")) {
    await db.exec(`ALTER TABLE changelog_entries ADD COLUMN is_test INTEGER DEFAULT 0;`);
  }
  if (!changelogColumns.some((col) => col.name === "is_draft")) {
    await db.exec(`ALTER TABLE changelog_entries ADD COLUMN is_draft INTEGER DEFAULT 0;`);
  }
  if (!changelogColumns.some((col) => col.name === "tag")) {
    await db.exec(`ALTER TABLE changelog_entries ADD COLUMN tag TEXT;`);
  }
  if (!changelogColumns.some((col) => col.name === "screenshots")) {
    await db.exec(`ALTER TABLE changelog_entries ADD COLUMN screenshots TEXT;`);
  }
  if (!changelogColumns.some((col) => col.name === "sort_order")) {
    await db.exec(`ALTER TABLE changelog_entries ADD COLUMN sort_order INTEGER;`);
    await db.exec(`UPDATE changelog_entries SET sort_order = id WHERE sort_order IS NULL;`);
  }
  if (!changelogColumns.some((col) => col.name === "og_image")) {
    await db.exec(`ALTER TABLE changelog_entries ADD COLUMN og_image TEXT;`);
  }

  await db.exec(`
  CREATE TABLE IF NOT EXISTS github_issues (
    id INTEGER PRIMARY KEY,
    repo TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    state TEXT,
    labels TEXT,
    author TEXT,
    html_url TEXT,
    comments INTEGER DEFAULT 0,
    is_pr INTEGER DEFAULT 0,
    github_created_at TEXT,
    github_updated_at TEXT,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_github_issues_repo_number ON github_issues(repo, number);
  CREATE INDEX IF NOT EXISTS idx_github_issues_updated ON github_issues(github_updated_at);
  CREATE VIRTUAL TABLE IF NOT EXISTS github_issues_fts USING fts5(title, body, id UNINDEXED, repo UNINDEXED, number UNINDEXED);
  `);

  await db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    target TEXT NOT NULL,
    type TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
  `);

  const userColumns = await db.all(`PRAGMA table_info(users);`);
  if (!userColumns.some((col) => col.name === "about")) {
    await db.exec(`ALTER TABLE users ADD COLUMN about TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "avatarUrl")) {
    await db.exec(`ALTER TABLE users ADD COLUMN avatarUrl TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "bannerUrl")) {
    await db.exec(`ALTER TABLE users ADD COLUMN bannerUrl TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "security_question")) {
    await db.exec(`ALTER TABLE users ADD COLUMN security_question TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "security_answer_hash")) {
    await db.exec(`ALTER TABLE users ADD COLUMN security_answer_hash TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "recovery_code_hash")) {
    await db.exec(`ALTER TABLE users ADD COLUMN recovery_code_hash TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "social_links")) {
    await db.exec(`ALTER TABLE users ADD COLUMN social_links TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "notification_prefs")) {
    await db.exec(`ALTER TABLE users ADD COLUMN notification_prefs TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "followers_visibility")) {
    await db.exec(`ALTER TABLE users ADD COLUMN followers_visibility TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "following_visibility")) {
    await db.exec(`ALTER TABLE users ADD COLUMN following_visibility TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "theme_preference")) {
    await db.exec(`ALTER TABLE users ADD COLUMN theme_preference TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "last_seen")) {
    await db.exec(`ALTER TABLE users ADD COLUMN last_seen TEXT;`);
  }
  if (!userColumns.some((col) => col.name === "activity_visible")) {
    await db.exec(`ALTER TABLE users ADD COLUMN activity_visible INTEGER;`);
  }
  if (!userColumns.some((col) => col.name === "forum_visible")) {
    await db.exec(`ALTER TABLE users ADD COLUMN forum_visible INTEGER DEFAULT 1;`);
  }

  const addonColumns = await db.all(`PRAGMA table_info(addons);`);
  if (!addonColumns.some((col) => col.name === "creators")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN creators TEXT;`);
  }

  if (!addonColumns.some((col) => col.name === "updated_at")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN updated_at TEXT;`);
    await db.exec(`UPDATE addons SET updated_at = created_at WHERE updated_at IS NULL;`);
  }

  if (!addonColumns.some((col) => col.name === "iconThumbUrl")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN iconThumbUrl TEXT;`);
  }
  if (!addonColumns.some((col) => col.name === "bannerThumbUrl")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN bannerThumbUrl TEXT;`);
  }
  if (!addonColumns.some((col) => col.name === "author_role")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN author_role TEXT;`);
  }
  if (!addonColumns.some((col) => col.name === "githubUrl")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN githubUrl TEXT;`);
  }
  if (!addonColumns.some((col) => col.name === "license")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN license TEXT;`);
  }
  if (!addonColumns.some((col) => col.name === "type")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN type TEXT NOT NULL DEFAULT 'addon';`);
  }
  if (!addonColumns.some((col) => col.name === "release_url")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN release_url TEXT;`);
  }
  if (!addonColumns.some((col) => col.name === "github_mode")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN github_mode TEXT NOT NULL DEFAULT 'manual';`);
  }
  if (!addonColumns.some((col) => col.name === "github_release_cache")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN github_release_cache TEXT;`);
  }
  if (!addonColumns.some((col) => col.name === "github_release_fetched_at")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN github_release_fetched_at TEXT;`);
  }
  if (!addonColumns.some((col) => col.name === "ai_usage")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN ai_usage TEXT NOT NULL DEFAULT 'none';`);
  }
  await db.exec(`UPDATE addons SET ai_usage = 'full' WHERE ai_usage = 'partial';`);
  if (!addonColumns.some((col) => col.name === "downloads")) {
    await db.exec(`ALTER TABLE addons ADD COLUMN downloads INTEGER DEFAULT 0;`);
  }

  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_user_addon ON likes(user_id, addon_id);`);

  const commentColumns = await db.all(`PRAGMA table_info(comments);`);
  if (!commentColumns.some((col) => col.name === "parent_id")) {
    await db.exec(`ALTER TABLE comments ADD COLUMN parent_id INTEGER;`);
  }

  const followColumns = await db.all(`PRAGMA table_info(follows);`);
  if (!followColumns.some((col) => col.name === "created_at")) {
    await db.exec(`ALTER TABLE follows ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP;`);
  }

  const notificationColumns = await db.all(`PRAGMA table_info(notifications);`);
  if (!notificationColumns.some((col) => col.name === "dedupe_key")) {
    await db.exec(`ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;`);
  }
  if (!notificationColumns.some((col) => col.name === "data")) {
    await db.exec(`ALTER TABLE notifications ADD COLUMN data TEXT;`);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS creator_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      addon_id INTEGER NOT NULL,
      invited_username TEXT NOT NULL,
      role TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      responded_at TEXT
    );
  `);
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_invites_pending
    ON creator_invites(addon_id, invited_username)
    WHERE status = 'pending';
  `);

  const versionColumns = await db.all(`PRAGMA table_info(versions);`);
  if (!versionColumns.some((col) => col.name === "compatibility")) {
    await db.exec(`ALTER TABLE versions ADD COLUMN compatibility TEXT;`);
    await db.exec(`
      UPDATE versions
      SET compatibility = (SELECT compatibility FROM addons WHERE addons.id = versions.addon_id)
      WHERE compatibility IS NULL;
    `);
  }
  if (!versionColumns.some((col) => col.name === "downloads")) {
    await db.exec(`ALTER TABLE versions ADD COLUMN downloads INTEGER DEFAULT 0;`);
  }
  if (!versionColumns.some((col) => col.name === "changelog")) {
    await db.exec(`ALTER TABLE versions ADD COLUMN changelog TEXT;`);
  }
  if (!versionColumns.some((col) => col.name === "release_url")) {
    await db.exec(`ALTER TABLE versions ADD COLUMN release_url TEXT;`);
  }
  if (!versionColumns.some((col) => col.name === "release_channel")) {
    await db.exec(`ALTER TABLE versions ADD COLUMN release_channel TEXT NOT NULL DEFAULT 'release';`);
  }
  if (!versionColumns.some((col) => col.name === "og_image")) {
    await db.exec(`ALTER TABLE versions ADD COLUMN og_image TEXT;`);
  }
  await db.exec(`UPDATE addons SET compatibility = 'UPSTREAM' WHERE compatibility = 'BLEEDING-EDGE';`);
  await db.exec(`UPDATE versions SET compatibility = 'UPSTREAM' WHERE compatibility = 'BLEEDING-EDGE';`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      asset_type TEXT CHECK(asset_type IN ('full_model', 'skin_only')) NOT NULL,
      associated_model TEXT,
      glb_path TEXT,
      texture_path TEXT,
      thumbnail_path TEXT,
      votes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS model_votes (
      model_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (model_id, user_id),
      FOREIGN KEY(model_id) REFERENCES models(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_models_user ON models(user_id);`);

  const modelColumns = await db.all(`PRAGMA table_info(models);`);
  if (!modelColumns.some((col) => col.name === "status")) {
    await db.exec(`ALTER TABLE models ADD COLUMN status TEXT NOT NULL DEFAULT 'published';`);
  }
  if (!modelColumns.some((col) => col.name === "parent_model_id")) {
    await db.exec(`ALTER TABLE models ADD COLUMN parent_model_id INTEGER REFERENCES models(id);`);
  }
  if (!modelColumns.some((col) => col.name === "coordinate_system")) {
    await db.exec(`ALTER TABLE models ADD COLUMN coordinate_system TEXT;`);
    // Backfill from the associated official base: cubert is right-handed Z-up,
    // the rest are left-handed Y-up. Custom models default to Z-up.
    await db.exec(`UPDATE models SET coordinate_system = CASE
      WHEN associated_model = 'cubyz:cubert' THEN 'right_handed_z_up'
      WHEN associated_model IN ('cubyz:snale','cubyz:snela','cubyz:snail','cubyz:moffalo') THEN 'left_handed_y_up'
      ELSE 'right_handed_z_up'
    END WHERE coordinate_system IS NULL;`);
  }
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_models_parent ON models(parent_model_id);`);

  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_follows_follower_username ON follows(follower_id, followed_username);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);`);
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      long_description TEXT,
      website_url TEXT,
      chat_url TEXT,
      icon_url TEXT,
      ip TEXT,
      version TEXT,
      gamemodes TEXT,
      languages TEXT,
      requires_mods INTEGER NOT NULL DEFAULT 0,
      connection_method TEXT,
      player_count INTEGER NOT NULL DEFAULT 0,
      online INTEGER NOT NULL DEFAULT 0,
      last_relay_update TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_servers_owner ON servers(owner_id);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);`);

  const serversColumns = await db.all(`PRAGMA table_info(servers)`);
  if (!serversColumns.some((col) => col.name === "player_names")) {
    await db.exec(`ALTER TABLE servers ADD COLUMN player_names TEXT;`);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS server_api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      owner_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT,
      FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_server_tokens_server ON server_api_tokens(server_id);`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS server_required_mods (
      server_id INTEGER NOT NULL,
      addon_id INTEGER NOT NULL,
      PRIMARY KEY (server_id, addon_id),
      FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY(addon_id) REFERENCES addons(id) ON DELETE CASCADE
    );
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_server_required_mods_addon ON server_required_mods(addon_id);`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS server_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      server_id INTEGER
    );
  `);
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_server_likes_user_server ON server_likes(user_id, server_id);`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS creator_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      game_version TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_creator_projects_user ON creator_projects(user_id);`);

  // Long-term trend tracking. One tiny row per UTC day for the lifetime of
  // the site (365 rows/year), plus a per-user-per-day hit table used only to
  // count unique active users; the latter is pruned old and the unique count
  // is persisted in metrics_daily.active_users.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS metrics_daily (
      day TEXT PRIMARY KEY,
      new_users INTEGER NOT NULL DEFAULT 0,
      logins INTEGER NOT NULL DEFAULT 0,
      active_users INTEGER NOT NULL DEFAULT 0,
      downloads INTEGER NOT NULL DEFAULT 0,
      uploads INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      new_servers INTEGER NOT NULL DEFAULT 0,
      creator_saves INTEGER NOT NULL DEFAULT 0,
      peak_online INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS metrics_active (
      day TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (day, user_id)
    );
  `);
  const metricCols = await db.all(`PRAGMA table_info(metrics_daily);`);
  if (!metricCols.some((col) => col.name === "forum_threads")) {
    await db.exec(`ALTER TABLE metrics_daily ADD COLUMN forum_threads INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!metricCols.some((col) => col.name === "forum_replies")) {
    await db.exec(`ALTER TABLE metrics_daily ADD COLUMN forum_replies INTEGER NOT NULL DEFAULT 0;`);
  }
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_metrics_active_day ON metrics_active(day);`);
  // metrics_active only needs to exist long enough to compute the unique
  // daily count (already stored in metrics_daily.active_users); keep ~120
  // days so 30/90-day unique queries stay accurate, then drop the rows.
  await db.exec(`DELETE FROM metrics_active WHERE day < date('now', '-120 days');`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS forum_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      pinned INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      votes INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS forum_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
      FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_forum_threads_category ON forum_threads(category, last_activity_at);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_forum_threads_author ON forum_threads(author_id);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_forum_posts_thread ON forum_posts(thread_id, created_at);`);
  const forumThreadCols = await db.all(`PRAGMA table_info(forum_threads);`);
  if (!forumThreadCols.some((col) => col.name === "type")) {
    await db.exec(`ALTER TABLE forum_threads ADD COLUMN type TEXT NOT NULL DEFAULT 'discussion';`);
  }
  if (!forumThreadCols.some((col) => col.name === "edited_at")) {
    await db.exec(`ALTER TABLE forum_threads ADD COLUMN edited_at TEXT;`);
  }
  if (!forumThreadCols.some((col) => col.name === "accepted_post_id")) {
    await db.exec(`ALTER TABLE forum_threads ADD COLUMN accepted_post_id INTEGER;`);
  }
  if (!forumThreadCols.some((col) => col.name === "locked")) {
    await db.exec(`ALTER TABLE forum_threads ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!forumThreadCols.some((col) => col.name === "hidden")) {
    await db.exec(`ALTER TABLE forum_threads ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!forumThreadCols.some((col) => col.name === "pinned_at")) {
    await db.exec(`ALTER TABLE forum_threads ADD COLUMN pinned_at TEXT;`);
    // Existing pinned threads keep their place by creation time.
    await db.exec(`UPDATE forum_threads SET pinned_at = created_at WHERE pinned = 1 AND pinned_at IS NULL;`);
  }
  const forumPostCols = await db.all(`PRAGMA table_info(forum_posts);`);
  if (!forumPostCols.some((col) => col.name === "edited_at")) {
    await db.exec(`ALTER TABLE forum_posts ADD COLUMN edited_at TEXT;`);
  }
  if (!forumPostCols.some((col) => col.name === "votes")) {
    await db.exec(`ALTER TABLE forum_posts ADD COLUMN votes INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!forumPostCols.some((col) => col.name === "hidden")) {
    await db.exec(`ALTER TABLE forum_posts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`);
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS forum_post_votes (
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY(post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  // Limited forum moderators (in addition to the FORUM_ADMIN account). Kept
  // in a table rather than a users column so the admin can add/remove them at
  // runtime. Cached in memory by services/forumMods.js for sync checks.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS forum_moderators (
      user_id INTEGER PRIMARY KEY,
      added_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_moderators_user ON forum_moderators(user_id);`);
  // Full-text search index over thread titles/bodies and post bodies.
  await db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS forum_fts USING fts5(title, body, thread_id UNINDEXED, kind UNINDEXED, ref_id UNINDEXED);`
  );
  await db.exec(`
    CREATE TABLE IF NOT EXISTS forum_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      reporter_id INTEGER,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolved_by INTEGER,
      resolved_at TEXT
    );
  `);
  const ftsCount = await db.get("SELECT COUNT(*) AS n FROM forum_fts");
  const threadCount = await db.get("SELECT COUNT(*) AS n FROM forum_threads");
  if ((ftsCount?.n || 0) === 0 && (threadCount?.n || 0) > 0) {
    await db.exec(
      `INSERT INTO forum_fts (title, body, thread_id, kind, ref_id) SELECT title, body, id, 'thread', id FROM forum_threads`
    );
    await db.exec(
      `INSERT INTO forum_fts (title, body, thread_id, kind, ref_id) SELECT '', body, thread_id, 'post', id FROM forum_posts`
    );
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS forum_thread_votes (
      thread_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (thread_id, user_id),
      FOREIGN KEY(thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS forum_thread_views (
      thread_id INTEGER NOT NULL,
      viewer_key TEXT NOT NULL,
      viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (thread_id, viewer_key),
      FOREIGN KEY(thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE
    );
  `);

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_addons_author ON addons(author);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_versions_addon ON versions(addon_id);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_addon ON comments(addon_id, parent_id);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_username);`);
  const tokenColumns = await db.all(`PRAGMA table_info(server_api_tokens);`);
  if (!tokenColumns.some((col) => col.name === "token_prefix")) {
    await db.exec(`ALTER TABLE server_api_tokens ADD COLUMN token_prefix TEXT;`);
  }
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_server_tokens_prefix ON server_api_tokens(token_prefix);`);

  try {
    const fkViolations = await db.all(`PRAGMA foreign_key_check;`);
    if (fkViolations.length) {
      console.warn(`[db] ${fkViolations.length} pre-existing foreign-key violation(s) present; not fatal, but worth cleaning up.`);
    }
  } catch (err) {
    console.warn("[db] foreign_key_check failed:", err);
  }

  dbReady = true;
}

// SQLite transactions are issued as explicit BEGIN/COMMIT on a single shared
// connection, so two overlapping calls would throw "cannot start a
// transaction within a transaction" (and non-transaction statements could
// leak into an open transaction). Serialise them through a promise queue.
// AsyncLocalStorage lets a withTransaction() nested inside another join the
// outer transaction instead of deadlocking on the queue.
const txContext = new AsyncLocalStorage();
let txQueue = Promise.resolve();

export function withTransaction(fn) {
  if (txContext.getStore()) {
    return Promise.resolve().then(fn);
  }
  const run = async () => {
    await db.exec("BEGIN IMMEDIATE;");
    try {
      const result = await txContext.run(true, fn);
      await db.exec("COMMIT;");
      return result;
    } catch (err) {
      try {
        await db.exec("ROLLBACK;");
      } catch (rollbackErr) {
        console.error("Transaction rollback failed:", rollbackErr);
      }
      throw err;
    }
  };
  const result = txQueue.then(run, run);
  txQueue = result.then(
    () => {},
    () => {}
  );
  return result;
}
