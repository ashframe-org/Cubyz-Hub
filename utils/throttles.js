
export const DOWNLOAD_THROTTLE_MS = 60 * 1000;
const recentDownloads = new Map();
export function shouldCountDownload(key) {
  const now = Date.now();
  const last = recentDownloads.get(key);
  if (last && now - last < DOWNLOAD_THROTTLE_MS) return false;
  recentDownloads.set(key, now);
  if (recentDownloads.size > 5000) {
    for (const [k, ts] of recentDownloads) {
      if (now - ts > DOWNLOAD_THROTTLE_MS) recentDownloads.delete(k);
    }
  }
  return true;
}

export const FOLLOW_NOTIFY_THROTTLE_MS = 30 * 1000;
const recentFollowNotifications = new Map();
export function shouldNotifyFollowChange(key) {
  const now = Date.now();
  const last = recentFollowNotifications.get(key);
  if (last && now - last < FOLLOW_NOTIFY_THROTTLE_MS) return false;
  recentFollowNotifications.set(key, now);
  if (recentFollowNotifications.size > 5000) {
    for (const [k, ts] of recentFollowNotifications) {
      if (now - ts > FOLLOW_NOTIFY_THROTTLE_MS) recentFollowNotifications.delete(k);
    }
  }
  return true;
}

export const RECOVERY_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const RECOVERY_ATTEMPT_LIMIT = 5;
const recoveryAttempts = new Map();
export function isRecoveryLocked(username) {
  const entry = recoveryAttempts.get(username);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    recoveryAttempts.delete(username);
    return false;
  }
  return entry.count >= RECOVERY_ATTEMPT_LIMIT;
}
export function recordRecoveryFailure(username) {
  const now = Date.now();
  let entry = recoveryAttempts.get(username);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RECOVERY_ATTEMPT_WINDOW_MS };
  }
  entry.count += 1;
  recoveryAttempts.set(username, entry);
  if (recoveryAttempts.size > 5000) {
    for (const [k, v] of recoveryAttempts) {
      if (now > v.resetAt) recoveryAttempts.delete(k);
    }
  }
}
export function clearRecoveryFailures(username) {
  recoveryAttempts.delete(username);
}

export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_ATTEMPT_LIMIT = 10;
const loginAttempts = new Map();
export function loginThrottleKey(req, username) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  return `${ip}:${String(username || "").toLowerCase() || "unknown"}`;
}
export function isLoginLocked(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= LOGIN_ATTEMPT_LIMIT;
}
export function recordLoginFailure(key) {
  const now = Date.now();
  let entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + LOGIN_ATTEMPT_WINDOW_MS };
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
  if (loginAttempts.size > 5000) {
    for (const [k, v] of loginAttempts) {
      if (now > v.resetAt) loginAttempts.delete(k);
    }
  }
}
export function clearLoginFailures(key) {
  loginAttempts.delete(key);
}

export const RELAY_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const RELAY_ATTEMPT_LIMIT = 10;
const relayAttempts = new Map();
export function relayThrottleKey(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}
export function isRelayLocked(key) {
  const entry = relayAttempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    relayAttempts.delete(key);
    return false;
  }
  return entry.count >= RELAY_ATTEMPT_LIMIT;
}
export function recordRelayFailure(key) {
  const now = Date.now();
  let entry = relayAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RELAY_ATTEMPT_WINDOW_MS };
  }
  entry.count += 1;
  relayAttempts.set(key, entry);
  if (relayAttempts.size > 5000) {
    for (const [k, v] of relayAttempts) {
      if (now > v.resetAt) relayAttempts.delete(k);
    }
  }
}
export function clearRelayFailures(key) {
  relayAttempts.delete(key);
}

export const SENSITIVE_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const SENSITIVE_ATTEMPT_LIMIT = 10;
const sensitiveAttempts = new Map();
export function sensitiveKey(userId) {
  return `user:${userId}`;
}
export function isSensitiveLocked(key) {
  const entry = sensitiveAttempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    sensitiveAttempts.delete(key);
    return false;
  }
  return entry.count >= SENSITIVE_ATTEMPT_LIMIT;
}
export function recordSensitiveFailure(key) {
  const now = Date.now();
  let entry = sensitiveAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + SENSITIVE_ATTEMPT_WINDOW_MS };
  }
  entry.count += 1;
  sensitiveAttempts.set(key, entry);
  if (sensitiveAttempts.size > 5000) {
    for (const [k, v] of sensitiveAttempts) {
      if (now > v.resetAt) sensitiveAttempts.delete(k);
    }
  }
}
export function clearSensitiveFailures(key) {
  sensitiveAttempts.delete(key);
}

// Forum posting rate limit: sliding window per user.
const FORUM_POST_WINDOW_MS = 5 * 60 * 1000;
const FORUM_POST_MAX = 10;
const recentForumPosts = new Map();
export function allowForumPost(userId) {
  const now = Date.now();
  const stamps = (recentForumPosts.get(userId) || []).filter((t) => now - t < FORUM_POST_WINDOW_MS);
  if (stamps.length >= FORUM_POST_MAX) {
    recentForumPosts.set(userId, stamps);
    return false;
  }
  stamps.push(now);
  recentForumPosts.set(userId, stamps);
  if (recentForumPosts.size > 5000) {
    for (const [key, list] of recentForumPosts) {
      if (!list.length || now - list[list.length - 1] > FORUM_POST_WINDOW_MS) recentForumPosts.delete(key);
    }
  }
  return true;
}
