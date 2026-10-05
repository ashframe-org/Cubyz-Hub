import express from "express";
import path from "path";
import fs from "fs";
import { db, withTransaction } from "../db/index.js";
import { AI_USAGE_VALUES, RELEASE_CHANNEL_VALUES } from "../utils/constants.js";
import { parseCreatorsJson, slugify, addonLink, downloadFilename } from "../utils/common.js";
import { RP_ORIGIN } from "../config.js";
import { getCubyzVersions, getGithubReleases, parseGithubRepoUrl } from "../services/github.js";
import { createNotification, notifyDownloadMilestones } from "../services/notifications.js";
import { deleteAddonCascade } from "../services/addons.js";
import { upload, verifyFiles, resolveLocalFile } from "../services/uploads.js";
import { shouldCountDownload } from "../utils/throttles.js";
import { recordMetric } from "../services/metrics.js";

const router = express.Router();

router.post(
  "/api/addons/upload",
  (req, res, next) => {
    upload.fields([
      { name: "icon", maxCount: 1 },
      { name: "banner", maxCount: 1 },
      { name: "iconThumb", maxCount: 1 },
      { name: "bannerThumb", maxCount: 1 },
      { name: "screenshots", maxCount: 12 },
      { name: "file", maxCount: 1 },
    ])(req, res, function (err) {
      if (err) {
        console.error("MULTER ERROR:", err);
        return res.status(400).json({ ok: false, error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.session.user) {
        return res.status(401).json({ ok: false, error: "Not logged in." });
      }

      const {
        name,
        identifier,
        version,
        description,
        longDescription,
        compatibility,
        tags,
        type,
        githubMode,
        githubUrl,
        license,
        aiUsage,
        releaseChannel,
      } = req.body;

      if (!name || !identifier)
        return res.json({ ok: false, error: "Missing name or identifier." });

      if (description && description.length > 60)
        return res.json({ ok: false, error: "Short description must be 60 characters or fewer." });

      if (version && String(version).length > 20)
        return res.json({ ok: false, error: "Version must be 20 characters or fewer." });

      if (String(name).trim().length > 80)
        return res.status(400).json({ ok: false, error: "Name must be 80 characters or fewer." });

      if (String(identifier).trim().length > 80)
        return res.status(400).json({ ok: false, error: "Identifier must be 80 characters or fewer." });

      if (longDescription && String(longDescription).length > 20000)
        return res.status(400).json({ ok: false, error: "Long description must be 20000 characters or fewer." });

      if (compatibility && String(compatibility).length > 40)
        return res.status(400).json({ ok: false, error: "Compatibility must be 40 characters or fewer." });

      const addonType = type === "mod" ? "mod" : "addon";
      let githubModeValue = "manual";
      let githubUrlValue = null;
      if (addonType === "mod") {
        if (req.files?.file?.[0]) {
          return res.status(400).json({ ok: false, error: "Mods aren't hosted here - remove the file and provide a GitHub repo link instead." });
        }

        githubModeValue = githubMode === "release" ? "release" : "manual";

        githubUrlValue = String(githubUrl || "").trim().slice(0, 300);
        if (!githubUrlValue || !parseGithubRepoUrl(githubUrlValue)) {
          return res.status(400).json({ ok: false, error: "A valid GitHub repo link (https://github.com/owner/repo) is required." });
        }
      }

      const existingAddon = await db.get("SELECT author FROM addons WHERE identifier = ?", identifier);
      if (existingAddon && existingAddon.author !== req.session.user.username) {
        return res.status(409).json({ ok: false, error: "That identifier is already taken by another addon." });
      }

      const finalAuthor = req.session.user.username;
      const folder = req._uploadFolder;

      try {
        if (req.files?.file?.[0]) verifyFiles(req.files.file, "zip");
        for (const field of ["icon", "banner", "iconThumb", "bannerThumb", "screenshots"]) {
          if (req.files?.[field]?.length) verifyFiles(req.files[field], "image");
        }
      } catch (err) {
        try {
          fs.rmSync(path.join(process.cwd(), "uploads", folder), { recursive: true, force: true });
        } catch {}
        return res.status(400).json({ ok: false, error: err.message });
      }

      const iconUrl = req.files?.icon?.[0] ? `/uploads/${folder}/${req.files.icon[0].filename}` : null;
      const bannerUrl = req.files?.banner?.[0] ? `/uploads/${folder}/${req.files.banner[0].filename}` : null;
      const iconThumbUrl = req.files?.iconThumb?.[0] ? `/uploads/${folder}/${req.files.iconThumb[0].filename}` : null;
      const bannerThumbUrl = req.files?.bannerThumb?.[0] ? `/uploads/${folder}/${req.files.bannerThumb[0].filename}` : null;
      const fileUrl = req.files?.file?.[0] ? `/uploads/${folder}/${req.files.file[0].filename}` : null;

      let screenshots = [];
      if (req.files?.screenshots?.length) {
        screenshots = req.files.screenshots.map((f) => `/uploads/${folder}/${f.filename}`);
      }

      let tagArray = [];
      try {
        tagArray = typeof tags === "string" ? JSON.parse(tags || "[]") : Array.isArray(tags) ? tags : [];
        if (!Array.isArray(tagArray)) tagArray = [];
      } catch {
        return res.status(400).json({ ok: false, error: "Invalid tags format." });
      }
      if (tagArray.length > 10 || tagArray.some((t) => String(t).length > 30)) {
        return res.status(400).json({ ok: false, error: "Use at most 10 tags of 30 characters each." });
      }
      const timestampIso = new Date().toISOString();
      const licenseValue = license ? String(license).trim().slice(0, 60) || null : null;
      const aiUsageValue = AI_USAGE_VALUES.includes(aiUsage) ? aiUsage : "none";
      const releaseChannelValue = RELEASE_CHANNEL_VALUES.includes(releaseChannel) ? releaseChannel : "release";

      const newAddon = await withTransaction(async () => {
        await db.run(
          `INSERT INTO addons
          (identifier, name, author, version, description, longDescription, tags, compatibility, iconUrl, bannerUrl, iconThumbUrl, bannerThumbUrl, creators, screenshots, fileUrl, created_at, updated_at, type, github_mode, githubUrl, license, ai_usage)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(identifier) DO UPDATE SET
            name = excluded.name,
            version = excluded.version,
            description = excluded.description,
            longDescription = excluded.longDescription,
            tags = excluded.tags,
            compatibility = excluded.compatibility,
            iconUrl = excluded.iconUrl,
            bannerUrl = excluded.bannerUrl,
            iconThumbUrl = excluded.iconThumbUrl,
            bannerThumbUrl = excluded.bannerThumbUrl,
            screenshots = excluded.screenshots,
            fileUrl = excluded.fileUrl,
            updated_at = excluded.updated_at,
            type = excluded.type,
            github_mode = excluded.github_mode,
            githubUrl = excluded.githubUrl,
            license = excluded.license,
            ai_usage = excluded.ai_usage`,
          [
            identifier,
            name,
            finalAuthor,
            version,
            description,
            longDescription,
            JSON.stringify(tagArray),
            compatibility,
            iconUrl,
            bannerUrl,
            iconThumbUrl,
            bannerThumbUrl,
            JSON.stringify([]),
            JSON.stringify(screenshots),
            fileUrl,
            timestampIso,
            timestampIso,
            addonType,
            githubModeValue,
            githubUrlValue,
            licenseValue,
            aiUsageValue
          ]
        );

        const targetAddon = await db.get("SELECT * FROM addons WHERE identifier = ?", [identifier]);

        if (fileUrl) {
          await db.run(
            "INSERT INTO versions (addon_id, version, fileUrl, compatibility, release_channel) VALUES (?, ?, ?, ?, ?)",
            [targetAddon.id, version || "", fileUrl, compatibility || null, releaseChannelValue]
          );
        }

        return targetAddon;
      });

      if (!existingAddon) {
        try {
          const followers = await db.all(
            "SELECT follower_id FROM follows WHERE followed_username = ?",
            [finalAuthor]
          );
          for (const f of followers) {
            await createNotification({
              userId: f.follower_id,
              type: "new_addon",
              message: `${finalAuthor} posted a new addon: ${newAddon.name}`,
              link: addonLink(newAddon),
              dedupeKey: `addon:${newAddon.id}:new_addon:${f.follower_id}`
            });
          }
        } catch (err) {
          console.error("Failed to create new-addon notifications:", err);
        }
      }

      if (!compatibility) {
        try {
          const author = await db.get("SELECT id FROM users WHERE username = ?", [finalAuthor]);
          if (author) {
            await createNotification({
              userId: author.id,
              type: "addon_outdated",
              message: `Your addon ${newAddon.name} is marked outdated: no game version was selected.`,
              link: addonLink(newAddon),
              dedupeKey: `addon:${newAddon.id}:outdated:no_version`
            });
          }
        } catch (err) {
          console.error("Failed to create no-version notification:", err);
        }
      }

      recordMetric("uploads");
      res.json({ ok: true, addon: newAddon });
    } catch (err) {
      console.error("Upload failed:", err);
      res.json({ ok: false, error: "Upload failed." });
    }
  }
);


router.delete("/api/addons/:id", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ ok: false, error: "Not logged in." });
    }

    const addonId = req.params.id;

    const addon = await db.get("SELECT * FROM addons WHERE id = ?", addonId);
    if (!addon) {
      return res.status(404).json({ ok: false, error: "Addon not found." });
    }

    if (addon.author !== req.session.user.username) {
      return res.status(403).json({ ok: false, error: "Not your addon." });
    }

    await deleteAddonCascade(addon);

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE ADDON ERROR:", err);
    return res.status(500).json({ ok: false, error: "Failed to delete addon." });
  }
});

router.get("/api/addons/:id/liked", async (req, res) => {
  if (!req.session.user) {
    return res.json({ ok: true, liked: false });
  }
  const userId = req.session.user.id;
  const addonId = req.params.id;
  try {
    const row = await db.get("SELECT 1 FROM likes WHERE user_id = ? AND addon_id = ?", [userId, addonId]);
    res.json({ ok: true, liked: !!row });
  } catch (err) {
    console.error("LIKED CHECK ERROR:", err);
    res.json({ ok: false, liked: false });
  }
});

router.get("/api/addons/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const addon = await db.get(
      `SELECT
      a.id, a.identifier, a.name, a.author, a.author_role, a.version, a.description,
      a.longDescription, a.tags, a.compatibility, a.iconUrl, a.bannerUrl,
      a.iconThumbUrl, a.bannerThumbUrl,
      a.creators, a.screenshots, a.fileUrl, a.created_at, a.updated_at,
      a.downloads, a.githubUrl, a.license, a.type, a.release_url, a.ai_usage,
      a.github_mode, a.github_release_cache, a.github_release_fetched_at,
      u.id AS author_id
      FROM addons a
      LEFT JOIN users u ON u.username = a.author
      WHERE a.id = ?`,
      [id]
    );

    if (!addon) {
      return res.status(404).json({ ok: false, error: "Addon not found." });
    }

    if (addon.type === "mod" && addon.github_mode === "release") {
      const { latest, releases } = await getGithubReleases(addon);
      addon.githubLatestRelease = latest;
      addon.githubReleases = releases;
    }
    delete addon.github_release_cache;
    delete addon.github_release_fetched_at;

    const likeCountRow = await db.get("SELECT COUNT(*) AS count FROM likes WHERE addon_id = ?", [id]);
    addon.likes = likeCountRow?.count || 0;

    const likedRows = await db.all("SELECT user_id FROM likes WHERE addon_id = ?", [id]);
    addon.likedBy = likedRows.map(r => r.user_id);
    addon.longDescription = addon.longDescription || "";

    if (req.session.user?.username === addon.author) {
      addon.pendingCreatorInvites = await db.all(
        "SELECT id, invited_username, role, created_at FROM creator_invites WHERE addon_id = ? AND status = 'pending' ORDER BY created_at ASC",
        [id]
      );
    }

    res.json({ ok: true, addon });
  } catch (err) {
    console.error("GET /api/addons/:id ERROR:", err);
    res.json({ ok: false, error: "Database error." });
  }
});
router.get(["/addon/:slugOrId", "/mod/:slugOrId"], async (req, res) => {
  try {
    const param = req.params.slugOrId;
    const prefix = (addon) => (addon.type === "mod" ? "/mod" : "/addon");
    let addon;

    if (/^\d+$/.test(param)) {
      addon = await db.get("SELECT id, name, description, iconUrl, type FROM addons WHERE id = ?", [param]);
      if (!addon) return res.status(404).send("Addon not found");
      const slug = slugify(addon.name);
      return res.redirect(301, `${prefix(addon)}/${addon.id}-${slug}`);
    }

    const id = param.split("-")[0];
    addon = await db.get("SELECT id, name, description, iconUrl, type FROM addons WHERE id = ?", [id]);
    if (!addon) return res.status(404).send("Addon not found");

    const esc = (s) => String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

    const slug = slugify(addon.name);
    const correctUrl = `${prefix(addon)}/${addon.id}-${slug}`;

    if (req.path !== correctUrl) {
      return res.redirect(301, correctUrl);
    }

    const title = addon.name || "CubyzHub Addon";
    const description = addon.description || "View this addon on CubyzHub";
    const isAbsolute = addon.iconUrl && addon.iconUrl.startsWith("http");
    const image = addon.iconUrl
    ? (isAbsolute ? addon.iconUrl : `${RP_ORIGIN}${addon.iconUrl}`)
    : `${RP_ORIGIN}/assets/default_icon.png`;

    const url = `${RP_ORIGIN}${correctUrl}`;

    res.send(`
    <!doctype html>
    <html>
    <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="dark">
    <style>html, body { background: #1A1F1C; margin: 0; }</style>
    <meta property="og:type" content="website">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:image" content="${esc(image)}">
    <meta property="og:url" content="${esc(url)}">
    <link rel="canonical" href="${esc(url)}">
    <meta name="twitter:card" content="summary_large_image">
    <title>${esc(title)}</title>
    </head>
    <body>
    <script>window.location.replace("/addon.html?id=${addon.id}");</script>
    </body>
    </html>
    `);
  } catch (err) {
    console.error("OG PREVIEW ERROR:", err);
    res.status(500).send("Error generating preview");
  }
});

// Shareable per-version link: Discord/social embeds show the addon name,
// version, target game version and the version changelog, then the page
// redirects into the addon with that version's changelog opened.
router.get("/version/:versionId", async (req, res) => {
  try {
    const vid = parseInt(req.params.versionId, 10);
    if (!Number.isInteger(vid)) return res.status(404).send("Version not found");
    const row = await db.get(
      `SELECT v.id, v.version, v.compatibility, v.changelog, v.og_image,
              a.id AS addon_id, a.name, a.type, a.iconUrl, a.bannerUrl
       FROM versions v JOIN addons a ON a.id = v.addon_id
       WHERE v.id = ?`,
      [vid]
    );
    if (!row) return res.status(404).send("Version not found");

    const esc = (s) => String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const url = `${RP_ORIGIN}/version/${row.id}`;
    const title = `${row.name}${row.version ? " " + row.version : ""}`;
    const gameLine = row.compatibility ? `Game version ${row.compatibility}` : "";
    const description = [gameLine, "New update on CubyzHub"].filter(Boolean).join(" · ")
      || `New version of ${row.name} on CubyzHub`;

    const rawImage = row.og_image || row.bannerUrl || row.iconUrl;
    const image = rawImage
      ? (/^https?:\/\//i.test(rawImage) ? rawImage : `${RP_ORIGIN}${rawImage}`)
      : `${RP_ORIGIN}/assets/default_icon.png`;

    res.send(`
    <!doctype html>
    <html>
    <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="dark">
    <style>html, body { background: #1A1F1C; margin: 0; }</style>
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="CubyzHub">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:image" content="${esc(image)}">
    <meta property="og:url" content="${esc(url)}">
    <link rel="canonical" href="${esc(url)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(description)}">
    <meta name="twitter:image" content="${esc(image)}">
    <title>${esc(title)}</title>
    </head>
    <body>
    <script>window.location.replace("/addon.html?id=${row.addon_id}&version=${row.id}");</script>
    </body>
    </html>
    `);
  } catch (err) {
    console.error("VERSION OG PREVIEW ERROR:", err);
    res.status(500).send("Error generating preview");
  }
});

const ADDONS_PAGE_SIZE = 24;
const ADDONS_SORT_COLUMNS = {
  newest: "a.created_at DESC",
  liked: "stars DESC, a.created_at DESC",
  downloads: "a.downloads DESC, a.created_at DESC",
  name: "a.name COLLATE NOCASE ASC",
};

router.get("/api/addons", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const requestedPageSize = parseInt(req.query.pageSize, 10);
    const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, ADDONS_PAGE_SIZE)
      : ADDONS_PAGE_SIZE;
    const search = String(req.query.search || "").trim();
    const compatibility = String(req.query.compatibility || "").trim();
    const typeFilter = ["addon", "mod"].includes(req.query.type) ? req.query.type : "";
    const aiUsageFilter = AI_USAGE_VALUES.includes(req.query.aiUsage) ? req.query.aiUsage : "";
    const sortKey = ADDONS_SORT_COLUMNS[req.query.sort] ? req.query.sort : "newest";
    let tags = [];
    try {
      tags = req.query.tags ? JSON.parse(req.query.tags) : [];
      if (!Array.isArray(tags)) tags = [];
      tags = tags.map(String).filter(Boolean);
    } catch {
      tags = [];
    }

    const whereClauses = [];
    const params = [];

    if (search) {
      const safeSearch = search.replace(/[%_]/g, "\\$&");
      const likeQuery = `%${safeSearch}%`;
      whereClauses.push(`(a.name LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\' OR a.tags LIKE ? ESCAPE '\\')`);
      params.push(likeQuery, likeQuery, likeQuery);
    }

    tags.forEach((tag) => {
      whereClauses.push(`a.tags LIKE ? ESCAPE '\\'`);
      params.push(`%"${tag.replace(/[%_"\\]/g, "\\$&")}"%`);
    });

    if (compatibility) {
      whereClauses.push(`EXISTS (SELECT 1 FROM versions v WHERE v.addon_id = a.id AND v.compatibility = ?)`);
      params.push(compatibility);
    }

    if (typeFilter) {
      whereClauses.push(`a.type = ?`);
      params.push(typeFilter);
    }

    if (aiUsageFilter) {
      whereClauses.push(`a.ai_usage = ?`);
      params.push(aiUsageFilter);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countRow = await db.get(
      `SELECT COUNT(*) AS total FROM addons a ${whereSql}`,
      params
    );
    const total = countRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const orderBy = ADDONS_SORT_COLUMNS[sortKey];
    const list = await db.all(
      `SELECT
      a.id,
      a.name,
      a.author,
      a.version,
      a.compatibility,
      a.description,
      a.iconUrl,
      a.bannerUrl,
      a.iconThumbUrl,
      a.bannerThumbUrl,
      a.tags,
      a.downloads,
      a.created_at,
      a.updated_at,
      a.type,
      a.release_url,
      a.ai_usage,
      u.id AS author_id,
      (SELECT COUNT(*) FROM likes l WHERE l.addon_id = a.id) AS stars
      FROM addons a
      LEFT JOIN users u ON u.username = a.author
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const { latest } = await getCubyzVersions();
    res.json({
      ok: true,
      addons: list,
      latestGameVersion: latest,
      page: safePage,
      totalPages,
      total,
      pageSize,
    });
  } catch (err) {
    console.error("LIST ADDONS ERROR:", err);
    res.json({ ok: false, error: "Failed to load addons." });
  }
});

router.get("/api/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const type = String(req.query.type || "all").toLowerCase();

    if (!query) {
      return res.json({ ok: true, addons: [], users: [] });
    }

    const safeQuery = query.replace(/[%_]/g, "\\$&");
    const likeQuery = `%${safeQuery}%`;
    const includeAddons = type === "all" || type === "addons";
    const includeUsers = type === "all" || type === "users" || type === "people";

    const [addons, users] = await Promise.all([
      includeAddons
      ? db.all(
        `SELECT id, name, type, author, description, iconUrl, bannerUrl, iconThumbUrl, bannerThumbUrl, downloads, stars, created_at, updated_at
        FROM addons
        WHERE name LIKE ? ESCAPE '\\'
        OR description LIKE ? ESCAPE '\\'
        OR author LIKE ? ESCAPE '\\'
        OR tags LIKE ? ESCAPE '\\'
        ORDER BY
        CASE WHEN name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
        created_at DESC
        LIMIT 8`,
        [likeQuery, likeQuery, likeQuery, likeQuery, `${safeQuery}%`]
      )
      : [],
      includeUsers
      ? db.all(
        `SELECT username, avatarUrl
        FROM users
        WHERE username LIKE ? ESCAPE '\\'
        ORDER BY
        CASE WHEN username LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
        username
        LIMIT 8`,
        [likeQuery, `${safeQuery}%`]
      )
      : []
    ]);

    res.json({ ok: true, addons, users });
  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.json({ ok: false, addons: [], users: [], error: "Failed to search." });
  }
});

router.get("/api/game/versions", async (req, res) => {
  try {
    const { versions, latest } = await getCubyzVersions();
    res.json({ ok: true, versions, latest });
  } catch (err) {
    console.error("Failed to load game versions:", err);
    res.json({ ok: false, versions: [], latest: null });
  }
});
router.post(
  "/api/addons/:id/update",
  async (req, res, next) => {
    try {
      const addon = await db.get("SELECT * FROM addons WHERE id = ?", req.params.id);
      if (addon) {
        const anyUrl = addon.fileUrl || addon.iconUrl || addon.bannerUrl || "";
        if (anyUrl) {
          const folder = path.basename(path.dirname(anyUrl));
          req._uploadFolder = folder;
        }
      }
    } catch (e) {
      console.warn("Failed to resolve upload folder:", e);
    }
    next();
  },
  (req, res, next) => {
    upload.fields([
      { name: "icon", maxCount: 1 },
      { name: "banner", maxCount: 1 },
      { name: "iconThumb", maxCount: 1 },
      { name: "bannerThumb", maxCount: 1 },
      { name: "file", maxCount: 1 },
      { name: "screenshots", maxCount: 12 },
    ])(req, res, function (err) {
      if (err) {
        console.error("MULTER ERROR:", err);
        return res.status(400).json({ ok: false, error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    const id = req.params.id;
    try {
      if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });

      const addon = await db.get("SELECT * FROM addons WHERE id = ?", id);
      if (!addon) return res.status(404).json({ ok: false, error: "Addon not found." });
      if (addon.author !== req.session.user.username) return res.status(403).json({ ok: false, error: "Not your addon." });

      try {
        if (req.files?.file?.[0]) verifyFiles(req.files.file, "zip");
        for (const field of ["icon", "banner", "iconThumb", "bannerThumb", "screenshots"]) {
          if (req.files?.[field]?.length) verifyFiles(req.files[field], "image");
        }
      } catch (err) {
        return res.status(400).json({ ok: false, error: err.message });
      }

      const {
        name,
        version,
        description,
        longDescription,
        compatibility,
        tags,
        creators,
        authorRole,
        githubUrl,
        githubMode,
        license,
        aiUsage,
        changelog,
        releaseChannel
      } = req.body;

      if (description !== undefined && description.length > 60)
        return res.json({ ok: false, error: "Short description must be 60 characters or fewer." });

      if (version !== undefined && String(version).length > 20)
        return res.json({ ok: false, error: "Version must be 20 characters or fewer." });

      if (name !== undefined && String(name).trim().length > 80)
        return res.status(400).json({ ok: false, error: "Name must be 80 characters or fewer." });

      if (longDescription !== undefined && String(longDescription).length > 20000)
        return res.status(400).json({ ok: false, error: "Long description must be 20000 characters or fewer." });

      if (compatibility !== undefined && String(compatibility).length > 40)
        return res.status(400).json({ ok: false, error: "Compatibility must be 40 characters or fewer." });

      if (changelog !== undefined && String(changelog).length > 5000)
        return res.status(400).json({ ok: false, error: "Changelog must be 5000 characters or fewer." });

      let updates = {};
      if (name !== undefined) updates.name = name;
      if (version !== undefined) updates.version = version;
      if (description !== undefined) updates.description = description;
      if (longDescription !== undefined) updates.longDescription = longDescription;
      if (compatibility !== undefined) updates.compatibility = compatibility;

      if (authorRole !== undefined) {
        const trimmed = String(authorRole).trim().slice(0, 60);
        updates.author_role = trimmed || null;
      }

      if (githubUrl !== undefined) {
        const trimmed = String(githubUrl).trim().slice(0, 300);
        if (trimmed && !/^https?:\/\//i.test(trimmed)) {
          return res.status(400).json({ ok: false, error: "GitHub link must start with http:// or https://." });
        }
        updates.githubUrl = trimmed || null;
      }

      if (license !== undefined) {
        const trimmed = String(license).trim().slice(0, 60);
        updates.license = trimmed || null;
      }

      if (aiUsage !== undefined) {
        if (!AI_USAGE_VALUES.includes(aiUsage)) {
          return res.status(400).json({ ok: false, error: "Invalid AI usage value." });
        }
        updates.ai_usage = aiUsage;
      }

      if (githubMode !== undefined) {
        if (addon.type !== "mod") {
          return res.status(400).json({ ok: false, error: "GitHub release mode only applies to mods." });
        }
        const newMode = githubMode === "release" ? "release" : "manual";
        const effectiveGithubUrl = updates.githubUrl !== undefined ? updates.githubUrl : addon.githubUrl;
        if (!effectiveGithubUrl || !parseGithubRepoUrl(effectiveGithubUrl)) {
          return res.status(400).json({ ok: false, error: "A valid GitHub repo link (https://github.com/owner/repo) is required." });
        }
        updates.github_mode = newMode;
        updates.github_release_cache = null;
        updates.github_release_fetched_at = null;
      } else if (updates.githubUrl !== undefined && addon.type === "mod" && addon.github_mode === "release") {
        updates.github_release_cache = null;
        updates.github_release_fetched_at = null;
      }

      if (tags !== undefined) {
        try {
          const parsed = typeof tags === "string" ? JSON.parse(tags) : tags;
          const parsedTags = Array.isArray(parsed) ? parsed : [];
          if (parsedTags.length > 10 || parsedTags.some((t) => String(t).length > 30)) {
            return res.status(400).json({ ok: false, error: "Use at most 10 tags of 30 characters each." });
          }
          updates.tags = JSON.stringify(parsedTags);
        } catch {
          updates.tags = JSON.stringify([]);
        }
      }

      if (creators !== undefined) {
        try {
          const parsed = typeof creators === "string" ? JSON.parse(creators) : creators;
          const list = Array.isArray(parsed) ? parsed : [];
          const acceptedUsernames = new Set(parseCreatorsJson(addon.creators).map((c) => c.username));
          const cleaned = list
            .map((entry) => {
              if (typeof entry === "string") return { username: entry.trim(), role: null };
              if (entry && typeof entry === "object" && entry.username) {
                return {
                  username: String(entry.username).trim(),
                  role: entry.role ? String(entry.role).trim().slice(0, 60) : null
                };
              }
              return null;
            })
            .filter((entry) => entry && entry.username && acceptedUsernames.has(entry.username));
          updates.creators = JSON.stringify(cleaned);
        } catch {
          updates.creators = JSON.stringify([]);
        }
      }

      const folder = req._uploadFolder;
      if (req.files?.icon?.[0]) updates.iconUrl = `/uploads/${folder}/${req.files.icon[0].filename}`;
      if (req.files?.banner?.[0]) updates.bannerUrl = `/uploads/${folder}/${req.files.banner[0].filename}`;
      if (req.files?.iconThumb?.[0]) updates.iconThumbUrl = `/uploads/${folder}/${req.files.iconThumb[0].filename}`;
      if (req.files?.bannerThumb?.[0]) updates.bannerThumbUrl = `/uploads/${folder}/${req.files.bannerThumb[0].filename}`;
      if (req.files?.file?.[0]) {
        const fileUrl = `/uploads/${folder}/${req.files.file[0].filename}`;
        updates.fileUrl = fileUrl;
        const releaseChannelValue = RELEASE_CHANNEL_VALUES.includes(releaseChannel) ? releaseChannel : "release";
        await db.run(
          "INSERT INTO versions (addon_id, version, fileUrl, compatibility, changelog, release_channel) VALUES (?, ?, ?, ?, ?, ?)",
                     [id, version || addon.version || "", fileUrl, compatibility || addon.compatibility || null, changelog || null, releaseChannelValue]
        );
      }

      if (req.body.removeScreenshots) {
        let currentScreenshots = [];
        if (addon.screenshots) {
          try {
            currentScreenshots = JSON.parse(addon.screenshots);
            if (!Array.isArray(currentScreenshots)) currentScreenshots = [];
          } catch (e) {
            currentScreenshots = [];
          }
        }

        const targetUrl = req.body.removeScreenshots;

        if (currentScreenshots.includes(targetUrl)) {
          const updatedScreenshots = currentScreenshots.filter((src) => src !== targetUrl);
          updates.screenshots = JSON.stringify(updatedScreenshots);

          try {
            const uploadsRoot = path.join(process.cwd(), "uploads");
            const cleanPath = targetUrl.replace(/^\/+/, "");
            const filePath = path.join(process.cwd(), cleanPath);
            if (filePath.startsWith(uploadsRoot + path.sep) && fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (err) {
            console.warn("Failed to delete physical screenshot file from storage:", err);
          }
        }
      }

      if (req.files?.screenshots?.length) {
        let currentScreenshots = [];
        if (addon.screenshots) {
          try {
            currentScreenshots = JSON.parse(addon.screenshots);
            if (!Array.isArray(currentScreenshots)) currentScreenshots = [];
          } catch (e) {
            currentScreenshots = [];
          }
        }

        const newPaths = req.files.screenshots.map((f) => `/uploads/${folder}/${f.filename}`);

        updates.screenshots = JSON.stringify([...currentScreenshots, ...newPaths]);
      }

      if (req.files?.file?.[0] || (addon.type === "mod" && updates.githubUrl !== undefined)) {
        updates.updated_at = new Date().toISOString();
      }


      if (req.files?.banner?.[0]) {
        updates.bannerUrl = `/uploads/${folder}/${req.files.banner[0].filename}`;
      }

      if (req.files?.icon?.[0]) {
        updates.iconUrl = `/uploads/${folder}/${req.files.icon[0].filename}`;
      }

      if (req.files?.bannerThumb?.[0]) {
        updates.bannerThumbUrl = `/uploads/${folder}/${req.files.bannerThumb[0].filename}`;
      }

      if (req.files?.iconThumb?.[0]) {
        updates.iconThumbUrl = `/uploads/${folder}/${req.files.iconThumb[0].filename}`;
      }

      const keys = Object.keys(updates);
      if (keys.length > 0) {
        const setClause = keys.map(k => `${k} = ?`).join(", ");
        const values = keys.map(k => updates[k]);
        values.push(id);

        await db.run(`UPDATE addons SET ${setClause} WHERE id = ?`, values);
      }

      const updatedAddon = await db.get("SELECT * FROM addons WHERE id = ?", id);

      if (updates.updated_at) {
        try {
          const likers = await db.all(
            "SELECT DISTINCT user_id FROM likes WHERE addon_id = ?",
            [id]
          );
          for (const l of likers) {
            await createNotification({
              userId: l.user_id,
              type: "addon_updated",
              message: `Addon ${updatedAddon.name} you liked was updated`,
              link: addonLink(updatedAddon),
              dedupeKey: `addon:${id}:updated:${updates.updated_at}:${l.user_id}`
            });
          }
        } catch (err) {
          console.error("Failed to create addon-updated notifications:", err);
        }
      }

      if (compatibility !== undefined && !compatibility) {
        try {
          const author = await db.get("SELECT id FROM users WHERE username = ?", [updatedAddon.author]);
          if (author) {
            await createNotification({
              userId: author.id,
              type: "addon_outdated",
              message: `Your addon ${updatedAddon.name} is marked outdated: no game version was selected.`,
              link: addonLink(updatedAddon),
              dedupeKey: `addon:${id}:outdated:no_version`
            });
          }
        } catch (err) {
          console.error("Failed to create no-version notification:", err);
        }
      }

      res.json({ ok: true, addon: updatedAddon });

    } catch (err) {
      console.error("Update failed:", err);
      res.status(500).json({ ok: false, error: "Failed to update addon." });
    }
  }
);

router.post("/api/addons/:id/like", async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ ok: false, error: "You must be logged in to like addons." });
    }

    const userId = req.session.user.id;
    const addonId = req.params.id;

    const addon = await db.get("SELECT * FROM addons WHERE id = ?", addonId);
    if (!addon) {
      return res.status(404).json({ ok: false, error: "Addon not found." });
    }

    const existingLike = await db.get(
      "SELECT id FROM likes WHERE user_id = ? AND addon_id = ?",
      [userId, addonId]
    );

    let liked = false;
    if (existingLike) {
      await db.run("DELETE FROM likes WHERE id = ?", existingLike.id);
      liked = false;
    } else {
      await db.run("INSERT OR IGNORE INTO likes (user_id, addon_id) VALUES (?, ?)", [userId, addonId]);
      liked = true;
    }

    const countRow = await db.get("SELECT COUNT(*) AS count FROM likes WHERE addon_id = ?", [addonId]);
    const totalStars = countRow?.count || 0;

    await db.run("UPDATE addons SET stars = ? WHERE id = ?", [totalStars, addonId]);

    if (liked) {
      recordMetric("likes");
      try {
        const author = await db.get("SELECT id FROM users WHERE username = ?", addon.author);
        if (author && author.id !== userId) {
          await createNotification({
            userId: author.id,
            type: "addon_liked",
            message: `${req.session.user.username} liked your addon ${addon.name}`,
            link: addonLink(addon)
          });
        }
      } catch (err) {
        console.error("Failed to create like notification:", err);
      }
    }

    return res.json({ ok: true, liked, stars: totalStars });

  } catch (err) {
    console.error("LIKE API ERROR:", err);
    return res.status(500).json({ ok: false, error: "Database error processing like state." });
  }
});

router.get("/api/addons/:id/download", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).send("You must be logged in to download addons.");
    }

    const addonId = req.params.id;

    const addon = await db.get("SELECT fileUrl, downloads, name, identifier, version, compatibility FROM addons WHERE id = ?", addonId);
    if (!addon || !addon.fileUrl) {
      return res.status(404).send("File not found.");
    }

    const activeVersion = await db.get(
      "SELECT id, compatibility FROM versions WHERE addon_id = ? ORDER BY created_at DESC LIMIT 1",
      addonId
    );

    if (shouldCountDownload(`addon:${addonId}:${req.session.user.id}`)) {
      const beforeRow = await db.get("SELECT COALESCE(downloads, 0) AS downloads FROM addons WHERE id = ?", addonId);
      const previousDownloads = beforeRow?.downloads || 0;
      await db.run("UPDATE addons SET downloads = COALESCE(downloads, 0) + 1 WHERE id = ?", [addonId]);
      if (activeVersion) {
        await db.run(
          "UPDATE versions SET downloads = COALESCE(downloads, 0) + 1 WHERE id = ?",
          [activeVersion.id]
        );
      }
      try {
        await notifyDownloadMilestones(addonId, previousDownloads, previousDownloads + 1);
      } catch (err) {
        console.error("Failed to create milestone notification:", err);
      }
      recordMetric("downloads");
    }

    const filePath = resolveLocalFile(addon.fileUrl);

    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`Download error: File missing on disk at ${addon.fileUrl}`);
      return res.status(404).send("The file is missing from the server storage.");
    }

    return res.download(filePath, downloadFilename(
      addon.name || addon.identifier,
      addon.version,
      activeVersion?.compatibility || addon.compatibility
    ));

  } catch (err) {
    console.error("DOWNLOAD ROUTE ERROR:", err);
    return res.status(500).send("Internal server error handling download.");
  }
});

export default router;

