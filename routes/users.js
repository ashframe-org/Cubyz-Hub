import express from "express";
import { db } from "../db/index.js";
import { createNotification, getNotificationPrefs, NOTIFICATION_PREF_KEYS } from "../services/notifications.js";
import { shouldNotifyFollowChange } from "../utils/throttles.js";
import { isSafeUrl } from "../utils/common.js";
import { ACTIVITY_ONLINE_WINDOW_MS } from "../utils/constants.js";
import { getUserUsage } from "../services/usage.js";
import { isModerator, isForumAdmin } from "../services/forumMods.js";

const router = express.Router();

async function canViewFollowList(profileOwner, viewerUserId, visibilitySetting) {
  const setting = visibilitySetting || "public";
  if (setting === "public") return true;
  if (!viewerUserId) return false;

  const viewer = await db.get("SELECT username FROM users WHERE id = ?", viewerUserId);
  if (!viewer) return false;
  if (viewer.username === profileOwner) return true;

  if (setting === "private") return false;

  const viewerFollowsOwner = await db.get(
    "SELECT 1 FROM follows WHERE follower_id = ? AND followed_username = ?",
    [viewerUserId, profileOwner]
  );
  if (!viewerFollowsOwner) return false;

  const ownerFollowsViewer = await db.get(
    "SELECT 1 FROM follows f JOIN users u ON u.id = f.follower_id WHERE u.username = ? AND f.followed_username = ?",
    [profileOwner, viewer.username]
  );
  return !!ownerFollowsViewer;
}
router.get("/api/users/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (!query) return res.json({ ok: true, users: [] });

    const safeQuery = query.replace(/[%_]/g, "\\$&");
    const users = await db.all(
      "SELECT username FROM users WHERE username LIKE ? ESCAPE '\\' ORDER BY username LIMIT 20",
      [`%${safeQuery}%`]
    );
    res.json({ ok: true, users: users.map((u) => u.username) });
  } catch (err) {
    console.error("USER SEARCH ERROR:", err);
    res.json({ ok: false, users: [] });
  }
});

router.get("/api/users/notification-prefs", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  try {
    const stored = await getNotificationPrefs(req.session.user.id);
    const prefs = {};
    for (const key of NOTIFICATION_PREF_KEYS) prefs[key] = stored[key] !== false;
    res.json({ ok: true, prefs });
  } catch (err) {
    console.error("GET NOTIFICATION PREFS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load notification settings." });
  }
});

router.get("/api/users/privacy-settings", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  try {
    const user = await db.get(
      "SELECT followers_visibility, following_visibility, activity_visible, forum_visible FROM users WHERE id = ?",
      req.session.user.id
    );
    res.json({
      ok: true,
      followersVisibility: user?.followers_visibility || "public",
      followingVisibility: user?.following_visibility || "public",
      activityVisible: user?.activity_visible !== 0,
      forumVisible: user?.forum_visible !== 0,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to load privacy settings." });
  }
});

router.get("/api/users/:username", async (req, res) => {
  const username = req.params.username;
  try {
    const user = await db.get(
      "SELECT id, username, about, avatarUrl, bannerUrl, created_at, social_links, last_seen, activity_visible, forum_visible FROM users WHERE username = ?",
      [username]
    );

    if (!user) return res.status(404).json({ ok: false, error: "User not found." });

    const isOwner = req.session?.user?.id === user.id;
    const showForum = isOwner || user.forum_visible !== 0;

    const addons = await db.all(
      `SELECT
      a.id, a.identifier, a.name, a.author, a.version, a.description,
      a.tags, a.iconUrl, a.bannerUrl, a.iconThumbUrl, a.bannerThumbUrl, a.compatibility, a.downloads,
      a.created_at, a.updated_at, a.type,
      (SELECT COUNT(*) FROM likes l WHERE l.addon_id = a.id) AS stars
      FROM addons a
      WHERE a.author = ?
      ORDER BY a.created_at DESC`,
      [username]
    );

    const models = await db.all(
      `SELECT id, title, description, asset_type, associated_model, glb_path, texture_path, votes, created_at
       FROM models
       WHERE user_id = ? AND status = 'published' AND parent_model_id IS NULL
       ORDER BY created_at DESC`,
      [user.id]
    );

    const downloadsRow = await db.get("SELECT COALESCE(SUM(downloads), 0) AS downloads FROM addons WHERE author = ?", [username]);

    const followerCountRow = await db.get("SELECT COUNT(*) AS count FROM follows WHERE followed_username = ?", [username]);
    const followingCountRow = await db.get("SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?", [user.id]);

    let isFollowing = false;
    if (req.session?.user && req.session.user.username !== username) {
      const followRow = await db.get(
        "SELECT 1 FROM follows WHERE follower_id = ? AND followed_username = ?",
        [req.session.user.id, username]
      );
      isFollowing = !!followRow;
    }

    let socialLinks = [];
    try {
      socialLinks = user.social_links ? JSON.parse(user.social_links) : [];
      if (!Array.isArray(socialLinks)) socialLinks = [];
    } catch {
      socialLinks = [];
    }

    let activity = { visible: user.activity_visible !== 0, isOnline: false, lastSeen: null };
    if (activity.visible && user.last_seen) {
      const isoLastSeen = user.last_seen.replace(" ", "T") + "Z";
      const lastSeenMs = new Date(isoLastSeen).getTime();
      activity.isOnline = !Number.isNaN(lastSeenMs) && Date.now() - lastSeenMs < ACTIVITY_ONLINE_WINDOW_MS;
      activity.lastSeen = user.last_seen;
    }

    let forumThreads = [];
    let forumThreadCountRow = { count: 0 };
    let forumReplyCountRow = { count: 0 };
    if (showForum) {
      forumThreads = (
        await db.all(
          `SELECT id, title, category, type, status, pinned, votes, reply_count, created_at, last_activity_at
           FROM forum_threads
           WHERE author_id = ? AND hidden = 0
           ORDER BY COALESCE(last_activity_at, created_at) DESC
           LIMIT 12`,
          [user.id]
        )
      ).map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        type: t.type || "discussion",
        solved: t.status === "solved",
        pinned: !!t.pinned,
        votes: t.votes || 0,
        replyCount: t.reply_count || 0,
        createdAt: t.created_at,
        lastActivityAt: t.last_activity_at,
      }));
      forumThreadCountRow = await db.get(
        "SELECT COUNT(*) AS count FROM forum_threads WHERE author_id = ? AND hidden = 0",
        [user.id]
      );
      forumReplyCountRow = await db.get(
        "SELECT COUNT(*) AS count FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id WHERE p.author_id = ? AND p.hidden = 0 AND t.hidden = 0",
        [user.id]
      );
    }

    const servers = await db.all(
      `SELECT id, name, description, icon_url, online, player_count, version, created_at
       FROM servers WHERE owner_id = ? AND status = 'published'
       ORDER BY created_at DESC LIMIT 24`,
      [user.id]
    );

    const likesRow = await db.get(
      "SELECT COUNT(*) AS count FROM likes l JOIN addons a ON a.id = l.addon_id WHERE a.author = ?",
      [username]
    );
    const modCount = addons.filter((a) => a.type === "mod").length;
    const addonCount = addons.length - modCount;

    res.json({
      ok: true,
      user,
      about: user.about || "",
      avatarUrl: user.avatarUrl || null,
      bannerUrl: user.bannerUrl || null,
      socialLinks,
      activity,
      addons,
      models,
      servers,
      forumThreads,
      forumHidden: !showForum,
      isForumModerator: isModerator({ id: user.id, username: user.username }),
      isForumAdmin: isForumAdmin({ username: user.username }),
      stats: {
        totalAddons: addonCount,
        totalMods: modCount,
        totalModels: models.length,
        totalServers: servers.length,
        totalLikes: likesRow?.count || 0,
        totalDownloads: downloadsRow?.downloads || 0,
        totalForumThreads: forumThreadCountRow?.count || 0,
        totalForumReplies: forumReplyCountRow?.count || 0,
        location: "Earth"
      },
      followerCount: followerCountRow?.count || 0,
      followingCount: followingCountRow?.count || 0,
      isFollowing
    });
  } catch (err) {
    console.error("GET /api/users/:username ERROR:", err);
    res.json({ ok: false, error: "Failed to load user profile." });
  }
});

const COMMUNITY_LIST_PAGE_SIZE = 20;

router.get("/api/users/:username/followers", async (req, res) => {
  try {
    const owner = await db.get("SELECT followers_visibility FROM users WHERE username = ?", [req.params.username]);
    if (!owner) return res.status(404).json({ ok: false, error: "User not found." });

    const allowed = await canViewFollowList(req.params.username, req.session?.user?.id || null, owner.followers_visibility);
    if (!allowed) return res.json({ ok: true, users: [], hasMore: false, hidden: true });

    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const rows = await db.all(
      `SELECT u.username, u.avatarUrl
       FROM follows f
       JOIN users u ON u.id = f.follower_id
       WHERE f.followed_username = ?
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.params.username, COMMUNITY_LIST_PAGE_SIZE + 1, offset]
    );
    const hasMore = rows.length > COMMUNITY_LIST_PAGE_SIZE;
    res.json({ ok: true, users: rows.slice(0, COMMUNITY_LIST_PAGE_SIZE), hasMore });
  } catch (err) {
    console.error("GET FOLLOWERS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load followers." });
  }
});

router.get("/api/users/:username/following", async (req, res) => {
  try {
    const user = await db.get("SELECT id, following_visibility FROM users WHERE username = ?", [req.params.username]);
    if (!user) return res.status(404).json({ ok: false, error: "User not found." });

    const allowed = await canViewFollowList(req.params.username, req.session?.user?.id || null, user.following_visibility);
    if (!allowed) return res.json({ ok: true, users: [], hasMore: false, hidden: true });

    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const rows = await db.all(
      `SELECT u.username, u.avatarUrl
       FROM follows f
       JOIN users u ON u.username = f.followed_username
       WHERE f.follower_id = ?
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
      [user.id, COMMUNITY_LIST_PAGE_SIZE + 1, offset]
    );
    const hasMore = rows.length > COMMUNITY_LIST_PAGE_SIZE;
    res.json({ ok: true, users: rows.slice(0, COMMUNITY_LIST_PAGE_SIZE), hasMore });
  } catch (err) {
    console.error("GET FOLLOWING ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load following." });
  }
});

router.get("/api/users/:username/follow-status", async (req, res) => {
  const username = req.params.username;
  if (!req.session?.user) {
    return res.json({ ok: true, isFollowing: false });
  }
  try {
    const followRow = await db.get(
      "SELECT 1 FROM follows WHERE follower_id = ? AND followed_username = ?",
      [req.session.user.id, username]
    );
    res.json({ ok: true, isFollowing: !!followRow });
  } catch (err) {
    console.error("FOLLOW STATUS ERROR:", err);
    res.json({ ok: false, isFollowing: false });
  }
});

router.post("/api/users/:username/follow", async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ ok: false, error: "Not logged in." });
  }
  const username = req.params.username;
  const follower = req.session.user;

  if (username === follower.username) {
    return res.json({ ok: false, error: "You can't follow yourself." });
  }

  try {
    const targetUser = await db.get("SELECT id, username FROM users WHERE username = ?", [username]);
    if (!targetUser) return res.status(404).json({ ok: false, error: "User not found." });

    const existing = await db.get(
      "SELECT id FROM follows WHERE follower_id = ? AND followed_username = ?",
      [follower.id, username]
    );
    if (existing) {
      return res.json({ ok: true, isFollowing: true });
    }

    await db.run(
      "INSERT INTO follows (follower_id, followed_username) VALUES (?, ?)",
      [follower.id, username]
    );

    if (shouldNotifyFollowChange(`follow:${follower.id}:${targetUser.id}`)) {
      try {
        await createNotification({
          userId: targetUser.id,
          type: "new_follower",
          message: `${follower.username} started following you`,
          link: `/profile/${encodeURIComponent(follower.username)}`
        });
      } catch (err) {
        console.error("Failed to create follow notification:", err);
      }
    }

    res.json({ ok: true, isFollowing: true });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.json({ ok: true, isFollowing: true });
    }
    console.error("FOLLOW ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to follow user." });
  }
});

router.post("/api/users/:username/unfollow", async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ ok: false, error: "Not logged in." });
  }
  const username = req.params.username;
  const follower = req.session.user;
  try {
    const result = await db.run(
      "DELETE FROM follows WHERE follower_id = ? AND followed_username = ?",
      [follower.id, username]
    );

    if (result.changes > 0) {
      const targetUser = await db.get("SELECT id FROM users WHERE username = ?", [username]);
      if (targetUser && shouldNotifyFollowChange(`follow:${follower.id}:${targetUser.id}`)) {
        try {
          await createNotification({
            userId: targetUser.id,
            type: "unfollowed",
            message: `${follower.username} unfollowed you`,
            link: `/profile/${encodeURIComponent(follower.username)}`
          });
        } catch (err) {
          console.error("Failed to create unfollow notification:", err);
        }
      }
    }

    res.json({ ok: true, isFollowing: false });
  } catch (err) {
    console.error("UNFOLLOW ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to unfollow user." });
  }
});

router.post("/api/users/about", express.json(), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in" });
  const about = typeof req.body.about === "string" ? req.body.about.trim() : "";
  if (about.length > 500) {
    return res.json({ ok: false, error: "About text must be 500 characters or fewer." });
  }
  const userId = req.session.user.id;
  try {
    await db.run("UPDATE users SET about = ? WHERE id = ?", [about, userId]);
    res.json({ ok: true, about });
  } catch (err) {
    console.error("UPDATE PROFILE ABOUT ERROR:", err);
    res.status(500).json({ ok: false, error: "Unable to update profile." });
  }
});

const SOCIAL_SERVICES = ["discord", "github", "youtube", "twitter", "website"];

router.post("/api/users/social-links", express.json(), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  const { links } = req.body;
  if (!Array.isArray(links)) return res.status(400).json({ ok: false, error: "Invalid links." });

  const cleaned = [];
  const seen = new Set();
  for (const entry of links.slice(0, SOCIAL_SERVICES.length)) {
    const service = String(entry?.service || "").toLowerCase();
    const url = String(entry?.url || "").trim();
    if (!SOCIAL_SERVICES.includes(service) || !url) continue;
    if (seen.has(service)) continue;
    if (!isSafeUrl(url)) continue;
    seen.add(service);
    cleaned.push({ service, url });
  }

  try {
    await db.run("UPDATE users SET social_links = ? WHERE id = ?", [JSON.stringify(cleaned), req.session.user.id]);
    res.json({ ok: true, links: cleaned });
  } catch (err) {
    console.error("UPDATE SOCIAL LINKS ERROR:", err);
    res.status(500).json({ ok: false, error: "Unable to update social links." });
  }
});

router.post("/api/users/notification-prefs", express.json(), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  const { prefs } = req.body;
  if (!prefs || typeof prefs !== "object") return res.status(400).json({ ok: false, error: "Invalid preferences." });

  try {
    const existing = await getNotificationPrefs(req.session.user.id);
    const merged = { ...existing };
    for (const key of NOTIFICATION_PREF_KEYS) {
      if (key in prefs) merged[key] = prefs[key] !== false;
    }

    await db.run("UPDATE users SET notification_prefs = ? WHERE id = ?", [JSON.stringify(merged), req.session.user.id]);
    res.json({ ok: true, prefs: merged });
  } catch (err) {
    console.error("UPDATE NOTIFICATION PREFS ERROR:", err);
    res.status(500).json({ ok: false, error: "Unable to update notification settings." });
  }
});

const FOLLOW_VISIBILITY_VALUES = ["public", "mutual", "private"];

router.post("/api/users/privacy-settings", express.json(), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  const { followersVisibility, followingVisibility, activityVisible, forumVisible } = req.body;

  const updates = {};
  if (followersVisibility !== undefined) {
    if (!FOLLOW_VISIBILITY_VALUES.includes(followersVisibility)) {
      return res.status(400).json({ ok: false, error: "Invalid followers visibility." });
    }
    updates.followers_visibility = followersVisibility;
  }
  if (followingVisibility !== undefined) {
    if (!FOLLOW_VISIBILITY_VALUES.includes(followingVisibility)) {
      return res.status(400).json({ ok: false, error: "Invalid following visibility." });
    }
    updates.following_visibility = followingVisibility;
  }
  if (activityVisible !== undefined) {
    if (typeof activityVisible !== "boolean") {
      return res.status(400).json({ ok: false, error: "Invalid activity visibility." });
    }
    updates.activity_visible = activityVisible ? 1 : 0;
  }
  if (forumVisible !== undefined) {
    if (typeof forumVisible !== "boolean") {
      return res.status(400).json({ ok: false, error: "Invalid forum visibility." });
    }
    updates.forum_visible = forumVisible ? 1 : 0;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ ok: false, error: "No settings provided." });

  try {
    const setClause = Object.keys(updates).map((col) => `${col} = ?`).join(", ");
    await db.run(`UPDATE users SET ${setClause} WHERE id = ?`, [...Object.values(updates), req.session.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("UPDATE PRIVACY SETTINGS ERROR:", err);
    res.status(500).json({ ok: false, error: "Unable to update privacy settings." });
  }
});

router.post("/api/users/theme-preference", express.json(), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  const { theme } = req.body;
  if (theme !== "ashframe" && theme !== "default") {
    return res.status(400).json({ ok: false, error: "Invalid theme." });
  }

  try {
    await db.run("UPDATE users SET theme_preference = ? WHERE id = ?", [theme, req.session.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("UPDATE THEME PREFERENCE ERROR:", err);
    res.status(500).json({ ok: false, error: "Unable to save theme preference." });
  }
});
router.get("/api/user/addons", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const username = req.session.user.username;
    const rows = await db.all(
      "SELECT id, identifier, name, version, description, tags, screenshots, iconUrl, bannerUrl, iconThumbUrl, bannerThumbUrl, compatibility, created_at, updated_at FROM addons WHERE author = ? ORDER BY created_at DESC",
      username
    );
    res.json({ ok: true, addons: rows });
  } catch (err) {
    console.error("Failed to load user addons:", err);
    res.json({ ok: false, error: "Failed to load user addons." });
  }
});

router.get("/api/user/models", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const rows = await db.all(
      "SELECT id, title, description, asset_type, associated_model, glb_path, texture_path, votes, status, parent_model_id, created_at FROM models WHERE user_id = ? ORDER BY created_at DESC",
      req.session.user.id
    );
    res.json({ ok: true, models: rows });
  } catch (err) {
    console.error("Failed to load user models:", err);
    res.json({ ok: false, error: "Failed to load user models." })
  }
});

router.get("/api/user/forum", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const rows = await db.all(
      `SELECT id, title, category, type, status, pinned, hidden, votes, reply_count, created_at, last_activity_at
       FROM forum_threads WHERE author_id = ? ORDER BY COALESCE(last_activity_at, created_at) DESC`,
      [req.session.user.id]
    );
    const replyCountRow = await db.get("SELECT COUNT(*) AS count FROM forum_posts WHERE author_id = ?", [req.session.user.id]);
    const threads = rows.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      type: t.type || "discussion",
      solved: t.status === "solved",
      pinned: !!t.pinned,
      hidden: !!t.hidden,
      votes: t.votes || 0,
      replyCount: t.reply_count || 0,
      createdAt: t.created_at,
      lastActivityAt: t.last_activity_at,
    }));
    res.json({ ok: true, threads, replyCount: replyCountRow?.count || 0 });
  } catch (err) {
    console.error("Failed to load user forum:", err);
    res.json({ ok: false, error: "Failed to load your forum posts." });
  }
});

router.get("/api/user/usage", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const usage = await getUserUsage(req.session.user.id, req.session.user.username);
    res.json({ ok: true, ...usage });
  } catch (err) {
    console.error("USAGE STATS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load usage." });
  }
});

export default router;
