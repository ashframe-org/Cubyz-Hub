import express from "express";
import { db } from "../db/index.js";
import { createNotification } from "../services/notifications.js";
import { parseCreatorsJson, addonLink } from "../utils/common.js";
import { recordMetric } from "../services/metrics.js";

const router = express.Router();


router.post("/api/addons/:id/creator-invites", express.json(), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });

  const addonId = parseInt(req.params.id, 10);
  if (!Number.isInteger(addonId)) return res.status(400).json({ ok: false, error: "Invalid addon id." });

  try {
    const addon = await db.get("SELECT id, name, author, creators, type FROM addons WHERE id = ?", [addonId]);
    if (!addon) return res.status(404).json({ ok: false, error: "Addon not found." });
    if (addon.author !== req.session.user.username) {
      return res.status(403).json({ ok: false, error: "Not your addon." });
    }

    const username = String(req.body?.username || "").trim();
    const role = req.body?.role ? String(req.body.role).trim().slice(0, 60) : null;
    if (!username) return res.status(400).json({ ok: false, error: "Username is required." });
    if (username === addon.author) {
      return res.status(400).json({ ok: false, error: "The author is already credited on this addon." });
    }

    const invitedUser = await db.get("SELECT id, username FROM users WHERE username = ?", [username]);
    if (!invitedUser) return res.status(404).json({ ok: false, error: "No user with that username." });

    const alreadyAccepted = parseCreatorsJson(addon.creators).some((c) => c.username === invitedUser.username);
    if (alreadyAccepted) {
      return res.status(400).json({ ok: false, error: "That person is already credited on this addon." });
    }

    const existingPending = await db.get(
      "SELECT id FROM creator_invites WHERE addon_id = ? AND invited_username = ? AND status = 'pending'",
      [addonId, invitedUser.username]
    );
    let inviteId;
    if (existingPending) {
      await db.run("UPDATE creator_invites SET role = ? WHERE id = ?", [role, existingPending.id]);
      inviteId = existingPending.id;
    } else {
      const result = await db.run(
        "INSERT INTO creator_invites (addon_id, invited_username, role, invited_by) VALUES (?, ?, ?, ?)",
        [addonId, invitedUser.username, role, addon.author]
      );
      inviteId = result.lastID;
    }

    const roleText = role ? ` (${role})` : "";
    await createNotification({
      userId: invitedUser.id,
      type: "creator_invite",
      message: `${addon.author} invited you as co-creator on "${addon.name}"${roleText}`,
      link: addonLink(addon),
      dedupeKey: `creator_invite:${inviteId}`,
      data: { inviteId, addonId, addonName: addon.name, role, invitedBy: addon.author }
    });

    res.json({ ok: true, inviteId });
  } catch (err) {
    console.error("CREATE CREATOR INVITE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to send invite." });
  }
});

router.post("/api/creator-invites/:id/respond", express.json(), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });

  const inviteId = parseInt(req.params.id, 10);
  if (!Number.isInteger(inviteId)) return res.status(400).json({ ok: false, error: "Invalid invite id." });

  const accept = req.body?.accept;
  if (typeof accept !== "boolean") {
    return res.status(400).json({ ok: false, error: "accept must be true or false." });
  }

  try {
    const invite = await db.get("SELECT * FROM creator_invites WHERE id = ?", [inviteId]);
    if (!invite) return res.status(404).json({ ok: false, error: "Invite not found." });
    if (invite.invited_username !== req.session.user.username) {
      return res.status(403).json({ ok: false, error: "Not your invite to respond to." });
    }
    if (invite.status !== "pending") {
      return res.status(400).json({ ok: false, error: "This invite has already been responded to." });
    }

    const updated = await db.run(
      "UPDATE creator_invites SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
      [accept ? "accepted" : "declined", inviteId]
    );
    if (updated.changes === 0) {
      return res.status(400).json({ ok: false, error: "This invite has already been responded to." });
    }

    const addon = await db.get("SELECT id, name, creators, type FROM addons WHERE id = ?", [invite.addon_id]);
    if (accept && addon) {
      const current = parseCreatorsJson(addon.creators);
      if (!current.some((c) => c.username === invite.invited_username)) {
        current.push({ username: invite.invited_username, role: invite.role || null });
        await db.run("UPDATE addons SET creators = ? WHERE id = ?", [JSON.stringify(current), addon.id]);
      }
    }

    if (invite.invited_by && addon) {
      const owner = await db.get("SELECT id FROM users WHERE username = ?", [invite.invited_by]);
      if (owner) {
        await createNotification({
          userId: owner.id,
          type: "creator_invite_response",
          message: accept
            ? `${invite.invited_username} accepted your co-creator invite on "${addon.name}"`
            : `${invite.invited_username} declined your co-creator invite on "${addon.name}"`,
          link: addonLink(addon),
          dedupeKey: `creator_invite_response:${inviteId}`
        });
      }
    }

    try {
      const notif = await db.get(
        "SELECT id FROM notifications WHERE dedupe_key = ?",
        [`creator_invite:${inviteId}`]
      );
      if (notif) {
        await db.run(
          "UPDATE notifications SET data = json_set(COALESCE(data, '{}'), '$.resolved', ?, '$.status', ?) WHERE id = ?",
          [1, accept ? "accepted" : "declined", notif.id]
        );
      }
    } catch (err) {
      console.warn("Failed to mark creator invite notification resolved:", err);
    }

    res.json({ ok: true, status: accept ? "accepted" : "declined" });
  } catch (err) {
    console.error("RESPOND CREATOR INVITE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to respond to invite." });
  }
});

router.delete("/api/creator-invites/:id", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });

  const inviteId = parseInt(req.params.id, 10);
  if (!Number.isInteger(inviteId)) return res.status(400).json({ ok: false, error: "Invalid invite id." });

  try {
    const invite = await db.get(
      "SELECT ci.*, a.author FROM creator_invites ci JOIN addons a ON a.id = ci.addon_id WHERE ci.id = ?",
      [inviteId]
    );
    if (!invite) return res.status(404).json({ ok: false, error: "Invite not found." });
    if (invite.author !== req.session.user.username) {
      return res.status(403).json({ ok: false, error: "Not your addon." });
    }

    await db.run("DELETE FROM creator_invites WHERE id = ?", [inviteId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("CANCEL CREATOR INVITE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to cancel invite." });
  }
});
router.get("/api/creator-projects", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  try {
    const rows = await db.all(
      `SELECT id, name, game_version, created_at, updated_at FROM creator_projects WHERE user_id = ? ORDER BY updated_at DESC`,
      [req.session.user.id]
    );
    res.json({ ok: true, projects: rows });
  } catch (err) {
    console.error("GET CREATOR PROJECTS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load saved projects." });
  }
});

router.get("/api/creator-projects/:id", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  try {
    const row = await db.get(`SELECT * FROM creator_projects WHERE id = ?`, [req.params.id]);
    if (!row || row.user_id !== req.session.user.id) {
      return res.status(404).json({ ok: false, error: "Project not found." });
    }
    res.json({ ok: true, project: { id: row.id, name: row.name, game_version: row.game_version, data: JSON.parse(row.data), created_at: row.created_at, updated_at: row.updated_at } });
  } catch (err) {
    console.error("GET CREATOR PROJECT ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load project." });
  }
});

router.post("/api/creator-projects", express.json({ limit: "5mb" }), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  try {
    const name = String(req.body?.name || "").trim().slice(0, 80);
    const gameVersion = String(req.body?.gameVersion || "").trim().slice(0, 20);
    if (!name) return res.status(400).json({ ok: false, error: "Project name is required." });
    if (!gameVersion) return res.status(400).json({ ok: false, error: "Missing game version." });
    if (typeof req.body?.data !== "object" || req.body.data === null) {
      return res.status(400).json({ ok: false, error: "Missing project data." });
    }

    const projectCount = await db.get("SELECT COUNT(*) AS n FROM creator_projects WHERE user_id = ?", [req.session.user.id]);
    if (projectCount.n >= 200) {
      return res.status(400).json({ ok: false, error: "Project limit reached (200)." });
    }

    const result = await db.run(
      `INSERT INTO creator_projects (user_id, name, game_version, data) VALUES (?, ?, ?, ?)`,
      [req.session.user.id, name, gameVersion, JSON.stringify(req.body.data)]
    );
    recordMetric("creator_saves");
    res.json({ ok: true, id: result.lastID });
  } catch (err) {
    console.error("CREATE CREATOR PROJECT ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to save project." });
  }
});

router.put("/api/creator-projects/:id", express.json({ limit: "5mb" }), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  try {
    const existing = await db.get(`SELECT user_id FROM creator_projects WHERE id = ?`, [req.params.id]);
    if (!existing || existing.user_id !== req.session.user.id) {
      return res.status(404).json({ ok: false, error: "Project not found." });
    }

    const name = String(req.body?.name || "").trim().slice(0, 80);
    const gameVersion = String(req.body?.gameVersion || "").trim().slice(0, 20);
    if (!name) return res.status(400).json({ ok: false, error: "Project name is required." });
    if (!gameVersion) return res.status(400).json({ ok: false, error: "Missing game version." });
    if (typeof req.body?.data !== "object" || req.body.data === null) {
      return res.status(400).json({ ok: false, error: "Missing project data." });
    }

    await db.run(
      `UPDATE creator_projects SET name = ?, game_version = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [name, gameVersion, JSON.stringify(req.body.data), req.params.id]
    );
    recordMetric("creator_saves");
    res.json({ ok: true });
  } catch (err) {
    console.error("UPDATE CREATOR PROJECT ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to update project." });
  }
});

router.delete("/api/creator-projects/:id", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  try {
    const existing = await db.get(`SELECT user_id FROM creator_projects WHERE id = ?`, [req.params.id]);
    if (!existing || existing.user_id !== req.session.user.id) {
      return res.status(404).json({ ok: false, error: "Project not found." });
    }
    await db.run(`DELETE FROM creator_projects WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE CREATOR PROJECT ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to delete project." });
  }
});

export default router;
