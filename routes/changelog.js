import express from "express";
import path from "path";
import fs from "fs";
import { db, withTransaction } from "../db/index.js";
import { uploadChangelogScreenshots, verifyFiles } from "../services/uploads.js";
import { createNotification } from "../services/notifications.js";

const router = express.Router();

const CHANGELOG_ADMIN_USERNAME = "iNiKKo";


async function broadcastChangelogEntry(entryId, title) {
  const users = await db.all("SELECT id FROM users");
  for (const { id: userId } of users) {
    try {
      await createNotification({
        userId,
        type: "changelog_entry",
        message: `Update: ${title}`,
        link: `/changelog`,
        dedupeKey: `changelog_entry:${entryId}:${userId}`
      });
    } catch (err) {
      console.error("Failed to notify user of changelog entry:", err);
    }
  }
}

router.get("/api/changelog", async (req, res) => {
  try {
    const viewerUsername = req.session.user?.username;
    const rows =
      viewerUsername === CHANGELOG_ADMIN_USERNAME
        ? await db.all(
            "SELECT id, title, body, author_username, created_at, is_draft, tag, screenshots, og_image, sort_order FROM changelog_entries ORDER BY created_at DESC, sort_order DESC LIMIT 50"
          )
        : await db.all(
            "SELECT id, title, body, author_username, created_at, is_draft, tag, screenshots, og_image, sort_order FROM changelog_entries WHERE is_draft = 0 ORDER BY created_at DESC, sort_order DESC LIMIT 50"
          );
    const entries = rows.map((row) => {
      let screenshots = [];
      try {
        screenshots = row.screenshots ? JSON.parse(row.screenshots) : [];
        if (!Array.isArray(screenshots)) screenshots = [];
      } catch {
        screenshots = [];
      }
      return { ...row, screenshots };
    });
    res.json({ ok: true, entries });
  } catch (err) {
    console.error("GET CHANGELOG ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load changelog." });
  }
});

function parseChangelogDateInput(value) {
  if (!value || typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `${value} 00:00:00`;
}

const CHANGELOG_TAGS = ["major", "minor"];

router.post("/api/admin/changelog", express.json(), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  if (req.session.user.username !== CHANGELOG_ADMIN_USERNAME) {
    return res.status(403).json({ ok: false, error: "Not allowed." });
  }

  const { title, body, isDraft, date, notify, tag } = req.body;
  if (!title || !title.trim() || !body || !body.trim()) {
    return res.status(400).json({ ok: false, error: "Title and body are required." });
  }
  if (title.length > 120) {
    return res.status(400).json({ ok: false, error: "Title must be 120 characters or fewer." });
  }
  if (body.length > 4000) {
    return res.status(400).json({ ok: false, error: "Body must be 4000 characters or fewer." });
  }
  if (tag !== undefined && tag !== null && tag !== "" && !CHANGELOG_TAGS.includes(tag)) {
    return res.status(400).json({ ok: false, error: "Invalid tag." });
  }

  let createdAt = null;
  if (date !== undefined && date !== "") {
    createdAt = parseChangelogDateInput(date);
    if (!createdAt) return res.status(400).json({ ok: false, error: "Invalid date." });
  }

  const tagValue = tag || null;

  try {
    const result = createdAt
      ? await db.run(
          "INSERT INTO changelog_entries (title, body, author_username, is_draft, created_at, tag) VALUES (?, ?, ?, ?, ?, ?)",
          [title.trim(), body.trim(), req.session.user.username, isDraft ? 1 : 0, createdAt, tagValue]
        )
      : await db.run(
          "INSERT INTO changelog_entries (title, body, author_username, is_draft, tag) VALUES (?, ?, ?, ?, ?)",
          [title.trim(), body.trim(), req.session.user.username, isDraft ? 1 : 0, tagValue]
        );
    const entryId = result.lastID;
    await db.run("UPDATE changelog_entries SET sort_order = id WHERE id = ?", [entryId]);

    if (!isDraft && notify !== false) {
      await broadcastChangelogEntry(entryId, title.trim());
    }

    res.json({ ok: true, id: entryId });
  } catch (err) {
    console.error("POST CHANGELOG ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to post changelog entry." });
  }
});

router.post("/api/admin/changelog/:id", express.json(), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  if (req.session.user.username !== CHANGELOG_ADMIN_USERNAME) {
    return res.status(403).json({ ok: false, error: "Not allowed." });
  }

  const entryId = parseInt(req.params.id, 10);
  if (!Number.isInteger(entryId)) {
    return res.status(400).json({ ok: false, error: "Invalid entry id." });
  }

  const { title, body, date, tag } = req.body;
  if (!title || !title.trim() || !body || !body.trim()) {
    return res.status(400).json({ ok: false, error: "Title and body are required." });
  }
  if (title.length > 120) {
    return res.status(400).json({ ok: false, error: "Title must be 120 characters or fewer." });
  }
  if (body.length > 4000) {
    return res.status(400).json({ ok: false, error: "Body must be 4000 characters or fewer." });
  }
  if (tag !== undefined && tag !== null && tag !== "" && !CHANGELOG_TAGS.includes(tag)) {
    return res.status(400).json({ ok: false, error: "Invalid tag." });
  }

  let createdAt = null;
  if (date !== undefined && date !== "") {
    createdAt = parseChangelogDateInput(date);
    if (!createdAt) return res.status(400).json({ ok: false, error: "Invalid date." });
  }
  const tagValue = tag || null;

  try {
    const result = createdAt
      ? await db.run(
          "UPDATE changelog_entries SET title = ?, body = ?, created_at = ?, tag = ? WHERE id = ?",
          [title.trim(), body.trim(), createdAt, tagValue, entryId]
        )
      : await db.run(
          "UPDATE changelog_entries SET title = ?, body = ?, tag = ? WHERE id = ?",
          [title.trim(), body.trim(), tagValue, entryId]
        );
    if (result.changes === 0) {
      return res.status(404).json({ ok: false, error: "Entry not found." });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("EDIT CHANGELOG ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to update changelog entry." });
  }
});

router.post(
  "/api/admin/changelog/:id/screenshots",
  (req, res, next) => {
    if (!req.session.user || req.session.user.username !== CHANGELOG_ADMIN_USERNAME) {
      return res.status(403).json({ ok: false, error: "Not allowed." });
    }
    next();
  },
  (req, res, next) => {
    uploadChangelogScreenshots.array("screenshots", 12)(req, res, function (err) {
      if (err) {
        console.error("MULTER ERROR:", err);
        return res.status(400).json({ ok: false, error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    const entryId = parseInt(req.params.id, 10);
    if (!Number.isInteger(entryId)) {
      return res.status(400).json({ ok: false, error: "Invalid entry id." });
    }

    try {
      verifyFiles(req.files || [], "image");
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }

    try {
      const entry = await db.get("SELECT id, screenshots FROM changelog_entries WHERE id = ?", [entryId]);
      if (!entry) return res.status(404).json({ ok: false, error: "Entry not found." });

      let current = [];
      try {
        current = entry.screenshots ? JSON.parse(entry.screenshots) : [];
        if (!Array.isArray(current)) current = [];
      } catch {
        current = [];
      }

      const newPaths = (req.files || []).map((f) => `/uploads/changelog/${entryId}/${f.filename}`);
      const updated = [...current, ...newPaths];
      await db.run("UPDATE changelog_entries SET screenshots = ? WHERE id = ?", [JSON.stringify(updated), entryId]);
      res.json({ ok: true, screenshots: updated });
    } catch (err) {
      console.error("UPLOAD CHANGELOG SCREENSHOTS ERROR:", err);
      res.status(500).json({ ok: false, error: "Failed to upload screenshots." });
    }
  }
);

router.post("/api/admin/changelog/:id/og-image", express.text({ type: "*/*", limit: "8mb" }), async (req, res) => {
  if (!req.session.user || req.session.user.username !== CHANGELOG_ADMIN_USERNAME) {
    return res.status(403).json({ ok: false, error: "Not allowed." });
  }
  const entryId = parseInt(req.params.id, 10);
  if (!Number.isInteger(entryId)) {
    return res.status(400).json({ ok: false, error: "Invalid entry id." });
  }
  const dataUrl = typeof req.body === "string" ? req.body.trim() : "";
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(400).json({ ok: false, error: "Expected a PNG data URL." });
  const buf = Buffer.from(match[1], "base64");
  if (buf.length > 8 * 1024 * 1024) {
    return res.status(400).json({ ok: false, error: "Image too large." });
  }
  try {
    const entry = await db.get("SELECT id FROM changelog_entries WHERE id = ?", [entryId]);
    if (!entry) return res.status(404).json({ ok: false, error: "Entry not found." });
    const dir = path.join(process.cwd(), "uploads", "changelog", String(entryId));
    await fs.promises.mkdir(dir, { recursive: true });
    const filename = `preview-${Date.now()}.png`;
    await fs.promises.writeFile(path.join(dir, filename), buf);
    const url = `/uploads/changelog/${entryId}/${filename}`;
    await db.run("UPDATE changelog_entries SET og_image = ? WHERE id = ?", [url, entryId]);
    res.json({ ok: true, og_image: url });
  } catch (err) {
    console.error("SET CHANGELOG OG IMAGE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to save preview image." });
  }
});

router.post("/api/admin/changelog/:id/screenshots/remove", express.json(), async (req, res) => {
  if (!req.session.user || req.session.user.username !== CHANGELOG_ADMIN_USERNAME) {
    return res.status(403).json({ ok: false, error: "Not allowed." });
  }

  const entryId = parseInt(req.params.id, 10);
  if (!Number.isInteger(entryId)) {
    return res.status(400).json({ ok: false, error: "Invalid entry id." });
  }

  const targetUrl = req.body?.url;
  if (!targetUrl) return res.status(400).json({ ok: false, error: "Missing url." });

  try {
    const entry = await db.get("SELECT id, screenshots FROM changelog_entries WHERE id = ?", [entryId]);
    if (!entry) return res.status(404).json({ ok: false, error: "Entry not found." });

    let current = [];
    try {
      current = entry.screenshots ? JSON.parse(entry.screenshots) : [];
      if (!Array.isArray(current)) current = [];
    } catch {
      current = [];
    }

    if (!current.includes(targetUrl)) {
      return res.status(404).json({ ok: false, error: "Screenshot not found on this entry." });
    }

    const updated = current.filter((src) => src !== targetUrl);
    await db.run("UPDATE changelog_entries SET screenshots = ? WHERE id = ?", [JSON.stringify(updated), entryId]);

    try {
      const uploadsRoot = path.join(process.cwd(), "uploads");
      const cleanPath = targetUrl.replace(/^\/+/, "");
      const filePath = path.join(process.cwd(), cleanPath);
      if (filePath.startsWith(uploadsRoot + path.sep) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn("Failed to delete physical changelog screenshot file:", err);
    }

    res.json({ ok: true, screenshots: updated });
  } catch (err) {
    console.error("REMOVE CHANGELOG SCREENSHOT ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to remove screenshot." });
  }
});

router.post("/api/admin/changelog/:id/publish", express.json(), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  if (req.session.user.username !== CHANGELOG_ADMIN_USERNAME) {
    return res.status(403).json({ ok: false, error: "Not allowed." });
  }

  const entryId = parseInt(req.params.id, 10);
  if (!Number.isInteger(entryId)) {
    return res.status(400).json({ ok: false, error: "Invalid entry id." });
  }

  const notify = req.body?.notify !== false;

  try {
    const entry = await db.get("SELECT id, title, is_draft FROM changelog_entries WHERE id = ?", [entryId]);
    if (!entry) return res.status(404).json({ ok: false, error: "Entry not found." });
    if (!entry.is_draft) return res.status(400).json({ ok: false, error: "Entry is already published." });

    await db.run("UPDATE changelog_entries SET is_draft = 0 WHERE id = ?", [entryId]);
    if (notify) {
      await broadcastChangelogEntry(entryId, entry.title);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("PUBLISH CHANGELOG ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to publish changelog entry." });
  }
});

router.post("/api/admin/changelog/:id/reorder", express.json(), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  if (req.session.user.username !== CHANGELOG_ADMIN_USERNAME) {
    return res.status(403).json({ ok: false, error: "Not allowed." });
  }

  const entryId = parseInt(req.params.id, 10);
  if (!Number.isInteger(entryId)) {
    return res.status(400).json({ ok: false, error: "Invalid entry id." });
  }

  const direction = req.body?.direction;
  if (direction !== "up" && direction !== "down") {
    return res.status(400).json({ ok: false, error: "Direction must be 'up' or 'down'." });
  }

  try {
    const entry = await db.get(
      "SELECT id, created_at, sort_order FROM changelog_entries WHERE id = ?",
      [entryId]
    );
    if (!entry) return res.status(404).json({ ok: false, error: "Entry not found." });

    const neighbor =
      direction === "up"
        ? await db.get(
            "SELECT id, sort_order FROM changelog_entries WHERE created_at = ? AND sort_order > ? ORDER BY sort_order ASC LIMIT 1",
            [entry.created_at, entry.sort_order]
          )
        : await db.get(
            "SELECT id, sort_order FROM changelog_entries WHERE created_at = ? AND sort_order < ? ORDER BY sort_order DESC LIMIT 1",
            [entry.created_at, entry.sort_order]
          );

    if (!neighbor) {
      return res.status(400).json({ ok: false, error: `Already at the ${direction === "up" ? "top" : "bottom"} for this date.` });
    }

    await withTransaction(async () => {
      await db.run("UPDATE changelog_entries SET sort_order = ? WHERE id = ?", [neighbor.sort_order, entryId]);
      await db.run("UPDATE changelog_entries SET sort_order = ? WHERE id = ?", [entry.sort_order, neighbor.id]);
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("REORDER CHANGELOG ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to reorder changelog entry." });
  }
});

router.delete("/api/admin/changelog/:id", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
  if (req.session.user.username !== CHANGELOG_ADMIN_USERNAME) {
    return res.status(403).json({ ok: false, error: "Not allowed." });
  }

  const entryId = parseInt(req.params.id, 10);
  if (!Number.isInteger(entryId)) {
    return res.status(400).json({ ok: false, error: "Invalid entry id." });
  }

  try {
    const result = await db.run("DELETE FROM changelog_entries WHERE id = ?", [entryId]);
    if (result.changes === 0) {
      return res.status(404).json({ ok: false, error: "Entry not found." });
    }

    try {
      const dir = path.join(process.cwd(), "uploads", "changelog", String(entryId));
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn("Failed to clean up changelog screenshot folder:", err);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE CHANGELOG ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to delete changelog entry." });
  }
});

export default router;
