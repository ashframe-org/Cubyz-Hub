import { db } from "../db/index.js";
import { ACTIVITY_ONLINE_WINDOW_MS } from "../utils/constants.js";
import { recordActive } from "../services/metrics.js";

const ACTIVITY_UPDATE_THROTTLE_MS = 15 * 1000;
const lastSeenUpdateThrottle = new Map();
export function activityTracker(req, res, next) {
  const userId = req.session?.user?.id;
  if (userId) {
    const now = Date.now();
    const last = lastSeenUpdateThrottle.get(userId);
    if (!last || now - last >= ACTIVITY_UPDATE_THROTTLE_MS) {
      lastSeenUpdateThrottle.set(userId, now);
      db.run("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?", [userId]).catch(() => {});
      recordActive(userId);
    }
  }
  next();
}

export function clearActivityState(userId) {
  lastSeenUpdateThrottle.delete(userId);
}
