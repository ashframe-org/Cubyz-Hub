import fs from "fs";
import path from "path";
import { db } from "../db/index.js";
import { resolveLocalFile } from "./uploads.js";

function fileBytes(abs) {
  if (!abs) return 0;
  try {
    const stat = fs.statSync(abs);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function sumUnique(urls) {
  const seen = new Set();
  let total = 0;
  for (const url of urls) {
    const abs = resolveLocalFile(url);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    total += fileBytes(abs);
  }
  return total;
}

function parseScreenshots(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === "string") : [];
  } catch {
    return [];
  }
}

// Storage breakdown for a single user's own account, in bytes. Only reads
// rows/files owned by that user, so it is safe to expose to them.
export async function getUserUsage(userId, username) {
  const categories = [];

  const addons = await db.all(
    "SELECT id, iconUrl, bannerUrl, iconThumbUrl, bannerThumbUrl, fileUrl, screenshots FROM addons WHERE author = ?",
    [username]
  );
  const addonFiles = [];
  for (const a of addons) {
    addonFiles.push(a.iconUrl, a.bannerUrl, a.iconThumbUrl, a.bannerThumbUrl, a.fileUrl);
    addonFiles.push(...parseScreenshots(a.screenshots));
  }
  if (addons.length) {
    const placeholders = addons.map(() => "?").join(",");
    const versions = await db.all(
      `SELECT fileUrl FROM versions WHERE addon_id IN (${placeholders})`,
      addons.map((a) => a.id)
    );
    for (const v of versions) addonFiles.push(v.fileUrl);
  }
  categories.push({ key: "addons", label: "Addons & mods", items: addons.length, bytes: sumUnique(addonFiles) });

  const models = await db.all("SELECT glb_path, texture_path, thumbnail_path FROM models WHERE user_id = ?", [userId]);
  const modelFiles = [];
  for (const m of models) modelFiles.push(m.glb_path, m.texture_path, m.thumbnail_path);
  categories.push({ key: "models", label: "Skins & models", items: models.length, bytes: sumUnique(modelFiles) });

  const servers = await db.all("SELECT icon_url FROM servers WHERE owner_id = ?", [userId]);
  const serverFiles = servers.map((s) => s.icon_url);
  categories.push({ key: "servers", label: "Servers", items: servers.length, bytes: sumUnique(serverFiles) });

  // Forum image uploads live under uploads/forum/<userId>/ and aren't
  // referenced from a DB column (they're embedded in post bodies), so scan
  // the folder directly.
  let forumItems = 0;
  let forumBytes = 0;
  try {
    const forumDir = path.join(process.cwd(), "uploads", "forum", String(userId));
    if (fs.existsSync(forumDir)) {
      for (const entry of fs.readdirSync(forumDir)) {
        const stat = fs.statSync(path.join(forumDir, entry));
        if (stat.isFile()) {
          forumItems += 1;
          forumBytes += stat.size;
        }
      }
    }
  } catch (err) {
    console.warn("Usage: failed to scan forum uploads:", err);
  }
  categories.push({ key: "forum", label: "Forum images", items: forumItems, bytes: forumBytes });

  const projects = await db.get(
    "SELECT COUNT(*) AS items, COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS bytes FROM creator_projects WHERE user_id = ?",
    [userId]
  );
  categories.push({
    key: "creator",
    label: "Creator cloud saves",
    items: projects?.items || 0,
    bytes: projects?.bytes || 0,
  });

  const user = await db.get("SELECT avatarUrl, bannerUrl FROM users WHERE id = ?", [userId]);
  const profileFiles = user ? [user.avatarUrl, user.bannerUrl] : [];
  const profileItems = (user?.avatarUrl ? 1 : 0) + (user?.bannerUrl ? 1 : 0);
  categories.push({ key: "profile", label: "Profile & avatar", items: profileItems, bytes: sumUnique(profileFiles) });

  const changelogCount = await db.get(
    "SELECT COUNT(*) AS items FROM changelog_entries WHERE author_username = ?",
    [username]
  );
  if (changelogCount?.items) {
    const entries = await db.all(
      "SELECT screenshots FROM changelog_entries WHERE author_username = ?",
      [username]
    );
    const shots = [];
    for (const e of entries) shots.push(...parseScreenshots(e.screenshots));
    categories.push({ key: "changelog", label: "Changelog", items: changelogCount.items, bytes: sumUnique(shots) });
  }

  const visible = categories.filter((c) => c.bytes > 0 || c.items > 0);
  visible.sort((a, b) => b.bytes - a.bytes);

  return {
    totalBytes: visible.reduce((sum, c) => sum + c.bytes, 0),
    totalItems: visible.reduce((sum, c) => sum + c.items, 0),
    categories: visible,
  };
}
