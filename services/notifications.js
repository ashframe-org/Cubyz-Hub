import { db } from "../db/index.js";
import { addonLink } from "../utils/common.js";

const DOWNLOAD_MILESTONES = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000];

const NOTIFICATION_CATEGORIES = {
  new_addon: "newAddonFromFollowed",
  addon_updated: "addonUpdatedLiked",
  addon_liked: "addonLiked",
  addon_commented: "addonCommented",
  comment_reply: "commentReplies",
  new_follower: "followChanges",
  unfollowed: "followChanges",
  download_milestone: "downloadMilestones",
  addon_outdated: "addonOutdated",
  new_cubyz_version: "newCubyzVersion",
  changelog_entry: "changelogUpdates",
  model_voted: "modelVoted",
  model_remixed: "modelRemixed",
  forum_reply: "forumReplies",
  forum_mention: "forumMentions",
  forum_accepted: "forumAccepted",
  forum_vote: "forumVotes",
};

export const NOTIFICATION_PREF_KEYS = [
  "newAddonFromFollowed",
  "addonUpdatedLiked",
  "addonLiked",
  "addonCommented",
  "commentReplies",
  "followChanges",
  "downloadMilestones",
  "addonOutdated",
  "newCubyzVersion",
  "changelogUpdates",
  "modelVoted",
  "modelRemixed",
  "forumReplies",
  "forumMentions",
  "forumAccepted",
  "forumVotes",
];

export async function getNotificationPrefs(userId) {
  const user = await db.get("SELECT notification_prefs FROM users WHERE id = ?", userId);
  if (!user?.notification_prefs) return {};
  try {
    const parsed = JSON.parse(user.notification_prefs);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function createNotification({ userId, type, message, link = null, dedupeKey = null, data = null }) {
  const category = NOTIFICATION_CATEGORIES[type];
  if (category) {
    const prefs = await getNotificationPrefs(userId);
    if (prefs[category] === false) return;
  }

  const result = await db.run(
    `INSERT OR IGNORE INTO notifications (user_id, type, message, link, dedupe_key, data) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, type, message, link, dedupeKey, data ? JSON.stringify(data) : null]
  );
  return result;
}

export async function notifyDownloadMilestones(addonId, previousDownloads, newDownloads) {
  const crossed = DOWNLOAD_MILESTONES.filter((m) => previousDownloads < m && newDownloads >= m);
  if (!crossed.length) return;

  const addon = await db.get("SELECT id, name, author, type FROM addons WHERE id = ?", addonId);
  if (!addon) return;

  const author = await db.get("SELECT id FROM users WHERE username = ?", addon.author);
  if (!author) return;

  for (const milestone of crossed) {
    try {
      await createNotification({
        userId: author.id,
        type: "download_milestone",
        message: `Your addon ${addon.name} reached ${milestone.toLocaleString()} downloads!`,
        link: addonLink(addon),
        dedupeKey: `addon:${addon.id}:milestone:${milestone}`
      });
    } catch (err) {
      console.error("Failed to create milestone notification:", err);
    }
  }
}
