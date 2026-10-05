import express from "express";
import sanitizeHtml from "sanitize-html";
import { db } from "../db/index.js";
import { createNotification } from "../services/notifications.js";
import { addonLink } from "../utils/common.js";
import { recordMetric } from "../services/metrics.js";

const router = express.Router();

const COMMENTS_PAGE_SIZE = 15;

router.get("/api/comments/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const countRow = await db.get("SELECT COUNT(*) AS total FROM comments WHERE addon_id = ? AND parent_id IS NULL", id);
    const total = countRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / COMMENTS_PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * COMMENTS_PAGE_SIZE;

    const comments = await db.all(
      `SELECT c.*, u.avatarUrl
       FROM comments c
       LEFT JOIN users u ON u.username = c.username
       WHERE c.addon_id = ? AND c.parent_id IS NULL
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [id, COMMENTS_PAGE_SIZE, offset]
    );

    if (comments.length) {
      const parentIds = comments.map((c) => c.id);
      const placeholders = parentIds.map(() => "?").join(",");
      const replies = await db.all(
        `SELECT c.*, u.avatarUrl
         FROM comments c
         LEFT JOIN users u ON u.username = c.username
         WHERE c.parent_id IN (${placeholders})
         ORDER BY c.created_at ASC`,
        parentIds
      );
      replies.forEach((r) => { r.content = sanitizeHtml(r.content || ""); });
      const repliesByParent = new Map();
      for (const r of replies) {
        if (!repliesByParent.has(r.parent_id)) repliesByParent.set(r.parent_id, []);
        repliesByParent.get(r.parent_id).push(r);
      }
      comments.forEach((c) => { c.replies = repliesByParent.get(c.id) || []; });
    }

    comments.forEach(c => { c.content = sanitizeHtml(c.content || ""); });
    res.json({ ok: true, comments, page: safePage, totalPages, total, pageSize: COMMENTS_PAGE_SIZE });
  } catch (err) {
    console.error("GET COMMENTS ERROR:", err);
    res.json({ ok: false, error: "Failed to load comments." });
  }
});

router.post("/api/comments/:id", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, error: "You must be logged in to comment." });
  }
  const { id } = req.params;
  const username = req.session.user.username;
  let { content, replyTo } = req.body;

  if (!content) return res.json({ ok: false, error: "Empty comment." });
  content = String(content).trim();
  if (content.length === 0) return res.json({ ok: false, error: "Empty comment." });
  if (content.length > 200) return res.json({ ok: false, error: "Comment too long (200 character limit)." });

  let parentId = null;
  if (replyTo !== undefined && replyTo !== null && replyTo !== "") {
    const parsedParentId = parseInt(replyTo, 10);
    if (!Number.isInteger(parsedParentId)) {
      return res.json({ ok: false, error: "Invalid comment to reply to." });
    }
    const parentComment = await db.get("SELECT id, addon_id, parent_id, username FROM comments WHERE id = ?", parsedParentId);
    if (!parentComment || String(parentComment.addon_id) !== String(id)) {
      return res.json({ ok: false, error: "That comment no longer exists." });
    }
    parentId = parentComment.parent_id ?? parentComment.id;
  }

  try {
    const safeContent = sanitizeHtml(content);
    const result = await db.run(
      "INSERT INTO comments (addon_id, username, content, parent_id) VALUES (?, ?, ?, ?)",
      [id, username, safeContent, parentId]
    );
    recordMetric("comments");
    res.json({ ok: true, commentId: result.lastID, parentId });

    try {
      const addon = await db.get("SELECT * FROM addons WHERE id = ?", id);
      if (addon) {
        const author = await db.get("SELECT id FROM users WHERE username = ?", addon.author);
        if (author && addon.author !== username) {
          await createNotification({
            userId: author.id,
            type: "addon_commented",
            message: `${username} commented on your addon ${addon.name}`,
            link: addonLink(addon, "#comments")
          });
        }

        if (parentId !== null) {
          const parentComment = await db.get("SELECT username FROM comments WHERE id = ?", parentId);
          if (parentComment && parentComment.username && parentComment.username !== username && parentComment.username !== addon.author) {
            const parentAuthor = await db.get("SELECT id FROM users WHERE username = ?", parentComment.username);
            if (parentAuthor) {
              await createNotification({
                userId: parentAuthor.id,
                type: "comment_reply",
                message: `${username} replied to your comment on ${addon.name}`,
                link: addonLink(addon, "#comments")
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to create comment notification:", err);
    }
  } catch (err) {
    console.error("Failed to insert comment:", err);
    res.json({ ok: false, error: "Failed to post comment." });
  }
});

router.delete("/api/comments/:id", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const commentId = req.params.id;
    const comment = await db.get("SELECT * FROM comments WHERE id = ?", commentId);
    if (!comment) return res.status(404).json({ ok: false, error: "Comment not found." });

    const addon = await db.get("SELECT * FROM addons WHERE id = ?", comment.addon_id);
    if (!addon) return res.status(404).json({ ok: false, error: "Addon not found." });

    const isAddonOwner = addon.author === req.session.user.username;
    const isCommentAuthor = comment.username === req.session.user.username;
    if (!isAddonOwner && !isCommentAuthor) {
      return res.status(403).json({ ok: false, error: "You can only delete your own comments." });
    }

    await db.run("DELETE FROM comments WHERE id = ? OR parent_id = ?", [commentId, commentId]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE COMMENT ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to delete comment." });
  }
});

export default router;
