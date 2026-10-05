import { db } from "../db/index.js";

// The FORUM_ADMIN account is the forum's full administrator; everyone else
// with forum powers lives in the forum_moderators table. Membership is cached
// in memory so isModerator() can stay synchronous (it's called from
// serializers and route guards); refreshModerators() rebuilds it at boot and
// whenever the admin adds/removes someone. Matching is by account id only
// (not username) so a deleted-and-recreated username can never inherit powers.
const ADMIN_USERNAME = process.env.FORUM_ADMIN || "iNiKKo";

export const FORUM_ADMIN_USERNAME = ADMIN_USERNAME;

let moderatorIds = new Set();

export function isForumAdmin(user) {
  return !!user && user.username === ADMIN_USERNAME;
}

export function getModeratorIds() {
  return Array.from(moderatorIds);
}

export async function refreshModerators() {
  try {
    const rows = await db.all("SELECT user_id FROM forum_moderators");
    moderatorIds = new Set(rows.map((r) => r.user_id));
  } catch (err) {
    console.error("Failed to load forum moderators:", err);
  }
}

export function isModerator(user) {
  if (!user) return false;
  return isForumAdmin(user) || moderatorIds.has(user.id);
}
