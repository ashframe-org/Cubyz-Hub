import express from "express";
import path from "path";
import fs from "fs";
import { db, withTransaction } from "../db/index.js";
import { uploadModel, verifyFiles, resolveLocalFile } from "../services/uploads.js";
import { createNotification } from "../services/notifications.js";
import { recordMetric } from "../services/metrics.js";
import { checkGlbStructure } from "../utils/glbStructure.js";

const router = express.Router();

const MODEL_ASSET_TYPES = ["full_model", "skin_only"];
const MODEL_TITLE_MAX_LENGTH = 80;
const MODEL_DESCRIPTION_MAX_LENGTH = 500;
const MODEL_TITLE_PATTERN = /^[\p{L}\p{N} .,'"!?()&:-]+$/u;

function isValidModelTitle(title) {
  return MODEL_TITLE_PATTERN.test(title);
}
const MODEL_ASSOCIATED_MODELS = ["cubyz:snale", "cubyz:snela", "cubyz:snail", "cubyz:moffalo", "cubyz:cubert"];

// Axis convention, informational only (for importing the skin into the game).
const MODEL_COORDINATE_SYSTEMS = ["left_handed_y_up", "right_handed_y_up", "right_handed_z_up"];
// Which convention each official base uses in-game (assets/cubyz/entity_models/*.zig.zon).
// Skins/remixes inherit it.
const BASE_COORDINATE_SYSTEMS = {
  "cubyz:snale": "left_handed_y_up",
  "cubyz:snela": "left_handed_y_up",
  "cubyz:snail": "right_handed_y_up",
  "cubyz:moffalo": "right_handed_y_up",
  "cubyz:cubert": "left_handed_y_up",
};
// Cap community models per page: the models page mounts a live WebGL preview
// per card, and browsers only allow a handful of contexts, so we keep the page
// to 5 official + MODEL_PAGE_SIZE community previews.
const MODEL_PAGE_SIZE = 8;

router.get("/api/models", async (req, res) => {
  try {
    const sortKey = ["newest", "oldest", "votes"].includes(req.query.sort) ? req.query.sort : "newest";
    const orderBy = sortKey === "oldest" ? "models.id ASC"
      : sortKey === "votes" ? "models.votes DESC, models.id DESC"
      : "models.id DESC";

    const typeFilter = MODEL_ASSET_TYPES.includes(req.query.type) ? req.query.type : "";
    const whereClauses = ["models.status = 'published'", "models.parent_model_id IS NULL"];
    const params = [];
    if (typeFilter) {
      whereClauses.push("models.asset_type = ?");
      params.push(typeFilter);
    }
    const search = String(req.query.search || "").trim();
    if (search) {
      const safeSearch = search.replace(/[%_]/g, "\\$&");
      whereClauses.push("models.title LIKE ? ESCAPE '\\'");
      params.push(`%${safeSearch}%`);
    }
    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const requestedPageSize = parseInt(req.query.pageSize, 10);
    const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, MODEL_PAGE_SIZE)
      : MODEL_PAGE_SIZE;

    const countRow = await db.get(
      `SELECT COUNT(*) AS total FROM models ${whereSql}`,
      params
    );
    const total = countRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await db.all(
      `SELECT models.*, users.username
       FROM models
       JOIN users ON models.user_id = users.id
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    res.json({ ok: true, models: rows, total, page: safePage, pageSize, totalPages });
  } catch (err) {
    console.error("GET MODELS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load models." });
  }
});

router.get("/api/models/:id", async (req, res) => {
  try {
    const row = await db.get(
      `SELECT models.*, users.username
       FROM models
       JOIN users ON models.user_id = users.id
       WHERE models.id = ?`,
      req.params.id
    );
    if (!row) return res.status(404).json({ ok: false, error: "Model not found." });
    if (row.status === "draft" && row.user_id !== req.session.user?.id) {
      return res.status(404).json({ ok: false, error: "Model not found." });
    }
    res.json({ ok: true, model: row });
  } catch (err) {
    console.error("GET MODEL ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load model." });
  }
});

router.get("/api/models/:id/remixes", async (req, res) => {
  try {
    const parent = await db.get("SELECT id, user_id, status FROM models WHERE id = ?", req.params.id);
    if (!parent) return res.status(404).json({ ok: false, error: "Model not found." });
    if (parent.status === "draft" && parent.user_id !== req.session.user?.id) {
      return res.status(404).json({ ok: false, error: "Model not found." });
    }

    const rows = await db.all(
      `SELECT models.*, users.username
       FROM models
       JOIN users ON models.user_id = users.id
       WHERE models.parent_model_id = ? AND models.status = 'published'
       ORDER BY models.id DESC`,
      parent.id
    );
    res.json({ ok: true, models: rows });
  } catch (err) {
    console.error("GET MODEL REMIXES ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load remixes." });
  }
});

router.post(
  "/api/models/upload",
  (req, res, next) => {
    uploadModel.fields([{ name: 'glb', maxCount: 1 }, { name: 'texture', maxCount: 1 }])(req, res, function (err) {
      if (err) {
        console.error("MODEL MULTER ERROR:", err);
        return res.status(400).json({ ok: false, error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });

      const { title, description, asset_type, associated_model, status, parent_model_id, coordinate_system } = req.body;
      const trimmedTitle = String(title || "").trim();
      if (!trimmedTitle) return res.status(400).json({ ok: false, error: "Model title is required." });
      if (trimmedTitle.length > MODEL_TITLE_MAX_LENGTH) {
        return res.status(400).json({ ok: false, error: `Title must be ${MODEL_TITLE_MAX_LENGTH} characters or fewer.` });
      }
      if (!isValidModelTitle(trimmedTitle)) {
        return res.status(400).json({ ok: false, error: "Title can only contain letters, numbers, spaces, and basic punctuation." });
      }
      if (!MODEL_ASSET_TYPES.includes(asset_type)) return res.status(400).json({ ok: false, error: "Invalid asset type." });

      const trimmedDescription = String(description || "").trim();
      if (trimmedDescription.length > MODEL_DESCRIPTION_MAX_LENGTH) {
        return res.status(400).json({ ok: false, error: `Description must be ${MODEL_DESCRIPTION_MAX_LENGTH} characters or fewer.` });
      }

      const resolvedAssociatedModel = MODEL_ASSOCIATED_MODELS.includes(associated_model) ? associated_model : "cubyz:snale";

      // Skins/remixes inherit the base's convention; only custom full models
      // are asked and must supply one.
      let resolvedCoordinateSystem;
      if (asset_type === "skin_only") {
        resolvedCoordinateSystem = BASE_COORDINATE_SYSTEMS[resolvedAssociatedModel] || "left_handed_y_up";
      } else {
        if (!MODEL_COORDINATE_SYSTEMS.includes(coordinate_system)) {
          return res.status(400).json({ ok: false, error: "Select the model's coordinate system (Y-up or Z-up)." });
        }
        resolvedCoordinateSystem = coordinate_system;
      }

      const glbFile = req.files?.glb?.[0];
      const textureFile = req.files?.texture?.[0];
      if (!textureFile) {
        return res.status(400).json({ ok: false, error: "A texture file (.png) is required." });
      }

      // Resolve the parent (remix) first: a full-model remix reuses the
      // parent's .glb when the client doesn't upload one.
      let resolvedParentId = null;
      let parentGlbPath = null;
      if (parent_model_id !== undefined && parent_model_id !== null && String(parent_model_id).trim() !== "") {
        const parentIdNum = Number(parent_model_id);
        if (!Number.isInteger(parentIdNum)) {
          return res.status(400).json({ ok: false, error: "Invalid parent model." });
        }
        const parentModel = await db.get("SELECT id, user_id, title, status, parent_model_id, glb_path FROM models WHERE id = ?", parentIdNum);
        if (!parentModel) {
          return res.status(400).json({ ok: false, error: "Parent model not found." });
        }
        if (parentModel.status === "draft" && parentModel.user_id !== req.session.user.id) {
          return res.status(400).json({ ok: false, error: "Cannot remix that model." });
        }
        if (parentModel.parent_model_id) {
          return res.status(400).json({ ok: false, error: "Cannot remix a remix - only one level deep is supported." });
        }
        resolvedParentId = parentModel.id;
        parentGlbPath = parentModel.glb_path || null;
      }

      if (asset_type === "full_model" && !glbFile && !(resolvedParentId && parentGlbPath)) {
        return res.status(400).json({ ok: false, error: "A .glb model file is required for Full Custom Model uploads." });
      }

      try {
        if (glbFile) {
          verifyFiles(glbFile, "glb");
          checkGlbStructure(glbFile.path);
        }
        verifyFiles(textureFile, "png");
      } catch (err) {
        try {
          fs.rmSync(path.join(process.cwd(), "uploads", "models", req._modelUploadFolder), { recursive: true, force: true });
        } catch {}
        return res.status(400).json({ ok: false, error: err.message });
      }

      const folder = req._modelUploadFolder;
      const glb_path = glbFile
        ? `/uploads/models/${folder}/${glbFile.filename}`
        : (asset_type === "full_model" && parentGlbPath ? parentGlbPath : null);
      const texture_path = `/uploads/models/${folder}/${textureFile.filename}`;

      const resolvedStatus = status === "draft" ? "draft" : "published";

      const result = await db.run(
        `INSERT INTO models (user_id, title, description, asset_type, associated_model, glb_path, texture_path, status, parent_model_id, coordinate_system)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.session.user.id, trimmedTitle, trimmedDescription || null, asset_type, resolvedAssociatedModel, glb_path, texture_path, resolvedStatus, resolvedParentId, resolvedCoordinateSystem]
      );

      if (resolvedParentId && resolvedStatus === "published") {
        try {
          const parentModel = await db.get("SELECT user_id, title FROM models WHERE id = ?", resolvedParentId);
          if (parentModel && parentModel.user_id !== req.session.user.id) {
            await createNotification({
              userId: parentModel.user_id,
              type: "model_remixed",
              message: `${req.session.user.username} remixed your model ${parentModel.title}`,
              link: `/models?model=${resolvedParentId}`,
            });
          }
        } catch (err) {
          console.error("Failed to create model remix notification:", err);
        }
      }

      const model = await db.get(`SELECT models.*, users.username FROM models JOIN users ON models.user_id = users.id WHERE models.id = ?`, result.lastID);
      recordMetric("uploads");
      res.json({ ok: true, model });
    } catch (err) {
      console.error("MODEL UPLOAD ERROR:", err);
      res.status(500).json({ ok: false, error: "Upload failed." });
    }
  }
);

router.post(
  "/api/models/:id/update",
  (req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) return next();
    uploadModel.fields([{ name: "texture", maxCount: 1 }])(req, res, function (err) {
      if (err) {
        console.error("MODEL UPDATE MULTER ERROR:", err);
        return res.status(400).json({ ok: false, error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
      const model = await db.get("SELECT * FROM models WHERE id = ?", req.params.id);
      if (!model) return res.status(404).json({ ok: false, error: "Model not found." });
      if (model.user_id !== req.session.user.id) return res.status(403).json({ ok: false, error: "Not your model." });

      const { title, description, associated_model, status, coordinate_system } = req.body;
      if (title !== undefined) {
        const trimmedTitle = String(title).trim();
        if (!trimmedTitle) return res.status(400).json({ ok: false, error: "Title can't be empty." });
        if (trimmedTitle.length > MODEL_TITLE_MAX_LENGTH) {
          return res.status(400).json({ ok: false, error: `Title must be ${MODEL_TITLE_MAX_LENGTH} characters or fewer.` });
        }
        if (!isValidModelTitle(trimmedTitle)) {
          return res.status(400).json({ ok: false, error: "Title can only contain letters, numbers, spaces, and basic punctuation." });
        }
        await db.run("UPDATE models SET title = ? WHERE id = ?", [trimmedTitle, model.id]);
      }
      if (description !== undefined) {
        const trimmedDescription = String(description).trim();
        if (trimmedDescription.length > MODEL_DESCRIPTION_MAX_LENGTH) {
          return res.status(400).json({ ok: false, error: `Description must be ${MODEL_DESCRIPTION_MAX_LENGTH} characters or fewer.` });
        }
        await db.run("UPDATE models SET description = ? WHERE id = ?", [trimmedDescription || null, model.id]);
      }
      if (associated_model !== undefined) {
        if (!MODEL_ASSOCIATED_MODELS.includes(associated_model)) {
          return res.status(400).json({ ok: false, error: "Invalid target model." });
        }
        await db.run("UPDATE models SET associated_model = ? WHERE id = ?", [associated_model, model.id]);
        // Skins always follow their base's convention.
        if (model.asset_type === "skin_only") {
          await db.run("UPDATE models SET coordinate_system = ? WHERE id = ?", [BASE_COORDINATE_SYSTEMS[associated_model] || "left_handed_y_up", model.id]);
        }
      }
      // Only custom full models expose an editable coordinate system.
      if (coordinate_system !== undefined && model.asset_type === "full_model") {
        if (!MODEL_COORDINATE_SYSTEMS.includes(coordinate_system)) {
          return res.status(400).json({ ok: false, error: "Invalid coordinate system." });
        }
        await db.run("UPDATE models SET coordinate_system = ? WHERE id = ?", [coordinate_system, model.id]);
      }
      if (status !== undefined) {
        if (status !== "draft" && status !== "published") {
          return res.status(400).json({ ok: false, error: "Invalid status." });
        }
        await db.run("UPDATE models SET status = ? WHERE id = ?", [status, model.id]);
      }

      const textureFile = req.files?.texture?.[0];
      if (textureFile) {
        try {
          verifyFiles(textureFile, "png");
        } catch (err) {
          return res.status(400).json({ ok: false, error: err.message });
        }
        const folder = req._modelUploadFolder;
        const texture_path = `/uploads/models/${folder}/${textureFile.filename}`;
        await db.run("UPDATE models SET texture_path = ? WHERE id = ?", [texture_path, model.id]);
      }

      const updated = await db.get(`SELECT models.*, users.username FROM models JOIN users ON models.user_id = users.id WHERE models.id = ?`, model.id);
      res.json({ ok: true, model: updated });
    } catch (err) {
      console.error("UPDATE MODEL ERROR:", err);
      res.status(500).json({ ok: false, error: "Failed to update model." });
    }
  }
);

router.delete("/api/models/:id", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const model = await db.get("SELECT * FROM models WHERE id = ?", req.params.id);
    if (!model) return res.status(404).json({ ok: false, error: "Model not found." });
    if (model.user_id !== req.session.user.id) return res.status(403).json({ ok: false, error: "Not your model." });

    await withTransaction(async () => {
      await db.run("UPDATE models SET parent_model_id = NULL WHERE parent_model_id = ?", [model.id]);
      await db.run("DELETE FROM model_votes WHERE model_id = ?", [model.id]);
      await db.run("DELETE FROM models WHERE id = ?", [model.id]);
    });

    if (model.glb_path || model.texture_path) {
      const probe = resolveLocalFile(model.glb_path || model.texture_path);
      const folderPath = probe ? path.dirname(probe) : null;
      if (!folderPath) {
        console.warn("Refusing to delete model folder for out-of-root path.");
      } else {
        try {
          if (fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true, force: true });
        } catch (e) {
          console.warn("Failed to delete model files:", folderPath, e);
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE MODEL ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to delete model." });
  }
});

router.post("/api/models/:id/vote", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const modelId = Number(req.params.id);
    const userId = req.session.user.id;

    const model = await db.get("SELECT id, title, user_id FROM models WHERE id = ?", modelId);
    if (!model) return res.status(404).json({ ok: false, error: "Model not found." });

    const alreadyVoted = await db.get("SELECT 1 FROM model_votes WHERE model_id = ? AND user_id = ?", [modelId, userId]);
    if (alreadyVoted) return res.status(400).json({ ok: false, error: "You have already voted for this model." });

    const vote = await withTransaction(async () => {
      const inserted = await db.run("INSERT OR IGNORE INTO model_votes (model_id, user_id) VALUES (?, ?)", [modelId, userId]);
      if (inserted.changes > 0) await db.run("UPDATE models SET votes = votes + 1 WHERE id = ?", modelId);
      return inserted;
    });
    if (vote.changes === 0) return res.status(400).json({ ok: false, error: "You have already voted for this model." });
    recordMetric("likes");

    if (model.user_id !== userId) {
      try {
        await createNotification({
          userId: model.user_id,
          type: "model_voted",
          message: `${req.session.user.username} voted for your model ${model.title}`,
          link: `/models?model=${model.id}`,
        });
      } catch (err) {
        console.error("Failed to create model vote notification:", err);
      }
    }

    const updated = await db.get("SELECT votes FROM models WHERE id = ?", modelId);
    res.json({ ok: true, votes: updated.votes });
  } catch (err) {
    console.error("VOTE MODEL ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to record vote." });
  }
});

export default router;
