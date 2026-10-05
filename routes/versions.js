import express from "express";
import path from "path";
import fs from "fs";
import { db } from "../db/index.js";
import { RELEASE_CHANNEL_VALUES } from "../utils/constants.js";
import { downloadFilename } from "../utils/common.js";
import { resolveLocalFile } from "../services/uploads.js";
import { shouldCountDownload } from "../utils/throttles.js";
import { recordMetric } from "../services/metrics.js";
import { notifyDownloadMilestones } from "../services/notifications.js";

const router = express.Router();

router.get("/api/versions/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const versions = await db.all("SELECT * FROM versions WHERE addon_id = ? ORDER BY created_at DESC", id);
    res.json({ ok: true, versions });
  } catch (err) {
    console.error("GET VERSIONS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load versions." });
  }
});

router.post("/api/versions/:id/update", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const { id } = req.params;
    const { compatibility, version: newVersionNumber, releaseChannel, changelog } = req.body;

    const version = await db.get("SELECT * FROM versions WHERE id = ?", id);
    if (!version) return res.status(404).json({ ok: false, error: "Version not found." });

    const addon = await db.get("SELECT * FROM addons WHERE id = ?", version.addon_id);
    if (!addon) return res.status(404).json({ ok: false, error: "Addon not found." });
    if (addon.author !== req.session.user.username) return res.status(403).json({ ok: false, error: "Not your addon." });

    if (compatibility !== undefined) {
      await db.run("UPDATE versions SET compatibility = ? WHERE id = ?", [compatibility || null, id]);
    }

    if (releaseChannel !== undefined) {
      if (!RELEASE_CHANNEL_VALUES.includes(releaseChannel)) {
        return res.status(400).json({ ok: false, error: "Invalid release channel." });
      }
      await db.run("UPDATE versions SET release_channel = ? WHERE id = ?", [releaseChannel, id]);
    }

    if (changelog !== undefined) {
      const trimmedChangelog = String(changelog).trim();
      if (trimmedChangelog.length > 5000)
        return res.status(400).json({ ok: false, error: "Changelog must be 5000 characters or fewer." });
      await db.run("UPDATE versions SET changelog = ? WHERE id = ?", [trimmedChangelog || null, id]);
    }

    if (newVersionNumber !== undefined) {
      const trimmed = String(newVersionNumber).trim();
      if (!trimmed) return res.status(400).json({ ok: false, error: "Version number can't be empty." });
      if (trimmed.length > 20) return res.status(400).json({ ok: false, error: "Version must be 20 characters or fewer." });
      await db.run("UPDATE versions SET version = ? WHERE id = ?", [trimmed, id]);
      const activeVersion = await db.get(
        "SELECT id FROM versions WHERE addon_id = ? ORDER BY created_at DESC LIMIT 1",
        [addon.id]
      );
      if (activeVersion?.id === version.id) {
        await db.run("UPDATE addons SET version = ? WHERE id = ?", [trimmed, addon.id]);
      }
    }

    const updated = await db.get("SELECT * FROM versions WHERE id = ?", id);
    res.json({ ok: true, version: updated });
  } catch (err) {
    console.error("UPDATE VERSION ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to update version." });
  }
});

router.get("/api/version-poster/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid version id." });
    const row = await db.get(
      `SELECT v.version, v.compatibility, v.changelog, a.name
       FROM versions v JOIN addons a ON a.id = v.addon_id WHERE v.id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ ok: false, error: "Version not found." });
    res.json({
      ok: true,
      name: row.name || "Addon",
      version: row.version || "",
      compatibility: row.compatibility || "",
      changelog: String(row.changelog || "").replace(/\s+/g, " ").trim().slice(0, 480),
    });
  } catch (err) {
    console.error("VERSION POSTER DATA ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load version." });
  }
});

router.post("/api/versions/:id/og-image", express.text({ type: "*/*", limit: "8mb" }), async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid version id." });

    const version = await db.get("SELECT id, addon_id FROM versions WHERE id = ?", [id]);
    if (!version) return res.status(404).json({ ok: false, error: "Version not found." });
    const addon = await db.get("SELECT id, author FROM addons WHERE id = ?", [version.addon_id]);
    if (!addon) return res.status(404).json({ ok: false, error: "Addon not found." });
    if (addon.author !== req.session.user.username) {
      return res.status(403).json({ ok: false, error: "Not your addon." });
    }

    const dataUrl = typeof req.body === "string" ? req.body.trim() : "";
    const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ ok: false, error: "Expected a PNG data URL." });
    const buf = Buffer.from(match[1], "base64");
    if (buf.length > 8 * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: "Image too large." });
    }

    const dir = path.join(process.cwd(), "uploads", "versions", String(id));
    await fs.promises.mkdir(dir, { recursive: true });
    const filename = `preview-${Date.now()}.png`;
    await fs.promises.writeFile(path.join(dir, filename), buf);
    const url = `/uploads/versions/${id}/${filename}`;

    const previous = await db.get("SELECT og_image FROM versions WHERE id = ?", [id]);
    await db.run("UPDATE versions SET og_image = ? WHERE id = ?", [url, id]);
    if (previous?.og_image && previous.og_image !== url) {
      const oldPath = resolveLocalFile(previous.og_image);
      if (oldPath) fs.promises.unlink(oldPath).catch(() => {});
    }

    res.json({ ok: true, og_image: url });
  } catch (err) {
    console.error("SET VERSION OG IMAGE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to save preview image." });
  }
});

router.post("/api/versions/delete", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const { versionIds } = req.body;
    if (!Array.isArray(versionIds) || versionIds.length === 0) return res.status(400).json({ ok: false, error: "No versions specified." });

    for (const vid of versionIds) {
      const version = await db.get("SELECT * FROM versions WHERE id = ?", vid);
      if (!version) continue;
      const addon = await db.get("SELECT * FROM addons WHERE id = ?", version.addon_id);
      if (!addon) continue;
      if (addon.author !== req.session.user.username) return res.status(403).json({ ok: false, error: "Not your addon." });

      const activeVersion = await db.get(
        "SELECT id FROM versions WHERE addon_id = ? ORDER BY created_at DESC LIMIT 1",
        [version.addon_id]
      );
      const wasActive = activeVersion?.id === version.id;
      await db.run("DELETE FROM versions WHERE id = ?", vid);

      if (version.fileUrl) {
        const filePath = resolveLocalFile(version.fileUrl);
        if (!filePath) {
          console.warn("Refusing to delete version file for out-of-root path.");
        } else {
          try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch (e) {
            console.warn("Failed to delete version file:", filePath, e);
          }
        }
      }

      if (wasActive) {
        const latest = await db.get(`SELECT * FROM versions WHERE addon_id = ? ORDER BY created_at DESC LIMIT 1`, [version.addon_id]);
        if (latest) {
          await db.run(
            "UPDATE addons SET fileUrl = ?, version = ?, release_url = ? WHERE id = ?",
            [latest.fileUrl, latest.version, latest.release_url, version.addon_id]
          );
        } else {
          await db.run("UPDATE addons SET fileUrl = NULL, version = NULL, release_url = NULL WHERE id = ?", [version.addon_id]);
        }
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE VERSION ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to delete version." });
  }
});

router.post("/api/versions/delete-all/:addonId", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const { addonId } = req.params;
    const addon = await db.get("SELECT * FROM addons WHERE id = ?", addonId);
    if (!addon) return res.status(404).json({ ok: false, error: "Addon not found." });
    if (addon.author !== req.session.user.username) return res.status(403).json({ ok: false, error: "Not your addon." });

    const activeVersion = await db.get(
      "SELECT id FROM versions WHERE addon_id = ? ORDER BY created_at DESC LIMIT 1",
      [addonId]
    );
    const versions = await db.all("SELECT * FROM versions WHERE addon_id = ?", addonId);
    for (const v of versions) {
      if (activeVersion?.id === v.id) continue;
      await db.run("DELETE FROM versions WHERE id = ?", v.id);
      if (v.fileUrl) {
        const filePath = resolveLocalFile(v.fileUrl);
        if (!filePath) {
          console.warn("Refusing to delete version file for out-of-root path.");
        } else {
          try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch (e) {
            console.warn("Failed to delete version file:", filePath, e);
          }
        }
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE ALL VERSIONS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to delete versions." });
  }
});
router.get("/api/versions/download/:versionId", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).send("You must be logged in to download addons.");
    }

    const versionId = req.params.versionId;

    const versionRecord = await db.get(
      `SELECT v.addon_id, v.fileUrl, v.version, v.compatibility, a.name AS addon_name, a.identifier AS addon_identifier
       FROM versions v JOIN addons a ON a.id = v.addon_id WHERE v.id = ?`,
      versionId
    );
    if (!versionRecord || !versionRecord.fileUrl) {
      return res.status(404).send("Version file not found.");
    }

    if (shouldCountDownload(`version:${versionId}:${req.session.user.id}`)) {
      const beforeRow = await db.get("SELECT COALESCE(downloads, 0) AS downloads FROM addons WHERE id = ?", versionRecord.addon_id);
      const previousDownloads = beforeRow?.downloads || 0;
      await db.run(
        "UPDATE addons SET downloads = COALESCE(downloads, 0) + 1 WHERE id = ?",
                   versionRecord.addon_id
      );
      await db.run(
        "UPDATE versions SET downloads = COALESCE(downloads, 0) + 1 WHERE id = ?",
                   versionId
      );
      try {
        await notifyDownloadMilestones(versionRecord.addon_id, previousDownloads, previousDownloads + 1);
      } catch (err) {
        console.error("Failed to create milestone notification:", err);
      }
      recordMetric("downloads");
    }

    const filePath = resolveLocalFile(versionRecord.fileUrl);

    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`Version download error: File missing at ${versionRecord.fileUrl}`);
      return res.status(404).send("The file is missing from the server storage.");
    }

    return res.download(filePath, downloadFilename(versionRecord.addon_name || versionRecord.addon_identifier, versionRecord.version, versionRecord.compatibility));

  } catch (err) {
    console.error("VERSION DOWNLOAD ROUTE ERROR:", err);
    return res.status(500).send("Internal server error handling version download.");
  }
});

export default router;
