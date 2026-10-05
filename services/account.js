import path from "path";
import fs from "fs";
import { db, withTransaction } from "../db/index.js";
import { refreshModerators } from "./forumMods.js";
import { deleteAddonCascade } from "./addons.js";
import { resolveLocalFile } from "./uploads.js";
import { parseCreatorsJson } from "../utils/common.js";

function removeItemFolder(fileUrl, label) {
  if (!fileUrl) return;
  const probe = resolveLocalFile(fileUrl);
  const folderPath = probe ? path.dirname(probe) : null;
  if (!folderPath) {
    console.warn(`Refusing to delete ${label} folder for out-of-root path:`, fileUrl);
    return;
  }
  try {
    if (fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true, force: true });
  } catch (e) {
    console.warn(`Failed to delete ${label} files:`, folderPath, e);
  }
}

export async function deleteUserAccountData(username, userId) {
  const ownedAddons = await db.all("SELECT * FROM addons WHERE author = ?", [username]);
  for (const addon of ownedAddons) {
    await deleteAddonCascade(addon);
  }

  const models = await db.all("SELECT * FROM models WHERE user_id = ?", [userId]);
  const modelFiles = models.map((m) => m.glb_path || m.texture_path).filter(Boolean);
  await withTransaction(async () => {
    for (const m of models) {
      await db.run("DELETE FROM model_votes WHERE model_id = ?", [m.id]);
    }
    await db.run("DELETE FROM model_votes WHERE user_id = ?", [userId]);
    if (models.length) {
      const placeholders = models.map(() => "?").join(",");
      await db.run(
        `UPDATE models SET parent_model_id = NULL WHERE parent_model_id IN (${placeholders})`,
        models.map((m) => m.id)
      );
    }
    await db.run("DELETE FROM models WHERE user_id = ?", [userId]);
  });
  for (const fileUrl of modelFiles) removeItemFolder(fileUrl, "model");

  const servers = await db.all("SELECT * FROM servers WHERE owner_id = ?", [userId]);
  const serverIcons = servers.map((s) => s.icon_url).filter(Boolean);
  await withTransaction(async () => {
    for (const s of servers) {
      await db.run("DELETE FROM server_required_mods WHERE server_id = ?", [s.id]);
      await db.run("DELETE FROM server_api_tokens WHERE server_id = ?", [s.id]);
      await db.run("DELETE FROM server_likes WHERE server_id = ?", [s.id]);
    }
    await db.run("DELETE FROM server_likes WHERE user_id = ?", [userId]);
    await db.run("DELETE FROM server_api_tokens WHERE owner_id = ?", [userId]);
    await db.run("DELETE FROM servers WHERE owner_id = ?", [userId]);
  });
  for (const icon of serverIcons) removeItemFolder(icon, "server icon");

  await withTransaction(async () => {
    await db.run("DELETE FROM passkeys WHERE user_id = ?", [userId]);
    await db.run("DELETE FROM creator_projects WHERE user_id = ?", [userId]);
    await db.run("DELETE FROM creator_invites WHERE invited_username = ? OR invited_by = ?", [username, username]);
    await db.run("DELETE FROM comments WHERE username = ?", [username]);
    await db.run("DELETE FROM likes WHERE user_id = ?", [userId]);
    await db.run("DELETE FROM follows WHERE follower_id = ? OR followed_username = ?", [userId, username]);
    await db.run("DELETE FROM notifications WHERE user_id = ?", [userId]);
    await db.run("DELETE FROM users WHERE id = ?", [userId]);
  });

  await withTransaction(async () => {
    const credited = await db.all("SELECT id, creators FROM addons WHERE creators LIKE ?", [`%${username}%`]);
    for (const row of credited) {
      const current = parseCreatorsJson(row.creators);
      const filtered = current.filter((c) => c.username !== username);
      if (filtered.length !== current.length) {
        await db.run("UPDATE addons SET creators = ? WHERE id = ?", [JSON.stringify(filtered), row.id]);
      }
    }
  });

  for (const dir of ["avatars", "banners"]) {
    const abs = path.join(process.cwd(), dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs)) {
      if (!entry.startsWith(`${userId}.`)) continue;
      try {
        fs.unlinkSync(path.join(abs, entry));
      } catch {
      }
    }
  }

  // Forum image uploads live under uploads/forum/<userId>/ and aren't
  // referenced from a DB column (they're embedded in post bodies), so remove
  // the user's folder outright.
  const forumUploadDir = path.join(process.cwd(), "uploads", "forum", String(userId));
  try {
    if (fs.existsSync(forumUploadDir)) fs.rmSync(forumUploadDir, { recursive: true, force: true });
  } catch (err) {
    console.warn("Failed to delete forum uploads:", forumUploadDir, err);
  }

  // Drop them from the in-memory moderator cache (the row cascaded away).
  await refreshModerators();
}
