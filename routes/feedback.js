import express from "express";
import { db } from "../db/index.js";
import { createNotification } from "../services/notifications.js";
import { allowForumPost } from "../utils/throttles.js";
import { FORUM_ADMIN_USERNAME } from "../services/forumMods.js";

const router = express.Router();

export const FEEDBACK_TARGETS = ["addon_creator", "addons_mods", "forum", "models", "website", "other"];
export const FEEDBACK_TYPES = ["bug", "improvement", "other"];

router.post("/api/feedback", express.json(), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, error: "Log in to send feedback." });
  }
  const target = String(req.body?.target || "").trim();
  const type = String(req.body?.type || "").trim();
  const body = String(req.body?.body || "").trim();

  if (!FEEDBACK_TARGETS.includes(target)) {
    return res.status(400).json({ ok: false, error: "Pick what your feedback is about." });
  }
  if (!FEEDBACK_TYPES.includes(type)) {
    return res.status(400).json({ ok: false, error: "Pick a feedback type." });
  }
  if (body.length < 5) {
    return res.status(400).json({ ok: false, error: "Please write a little more." });
  }
  if (body.length > 4000) {
    return res.status(400).json({ ok: false, error: "Please keep it under 4000 characters." });
  }
  if (!allowForumPost(req.session.user.id)) {
    return res.status(429).json({ ok: false, error: "You're sending feedback too quickly. Try again in a few minutes." });
  }

  const user = req.session.user;
  try {
    await db.run(
      "INSERT INTO feedback (user_id, username, target, type, body) VALUES (?, ?, ?, ?, ?)",
      [user.id, user.username, target, type, body]
    );
    const admins = await db.all("SELECT id FROM users WHERE username = ?", [FORUM_ADMIN_USERNAME]);
    for (const admin of admins) {
      try {
        await createNotification({
          userId: admin.id,
          type: "feedback",
          message: `New feedback from ${user.username}`,
          link: "/feedback",
        });
      } catch (err) {
        console.warn("Failed to notify admin of feedback:", err);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("POST FEEDBACK ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to send feedback." });
  }
});

router.get("/api/feedback", async (req, res) => {
  if (!req.session.user || req.session.user.username !== FORUM_ADMIN_USERNAME) {
    return res.status(403).json({ ok: false, error: "Not allowed." });
  }
  try {
    const rows = await db.all(
      "SELECT id, username, target, type, body, status, created_at FROM feedback ORDER BY id DESC LIMIT 200"
    );
    res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("GET FEEDBACK ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load feedback." });
  }
});

export default router;
