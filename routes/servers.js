import express from "express";
import path from "path";
import fs from "fs";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { db, withTransaction } from "../db/index.js";
import { uploadServerIcon, verifyFiles, resolveLocalFile } from "../services/uploads.js";
import { isSafeUrl } from "../utils/common.js";
import { relayThrottleKey, isRelayLocked, recordRelayFailure, clearRelayFailures } from "../utils/throttles.js";
import { recordMetric } from "../services/metrics.js";

const router = express.Router();

const SERVER_NAME_MAX_LENGTH = 60;
const SERVER_DESCRIPTION_MAX_LENGTH = 300;
const SERVER_LONG_DESCRIPTION_MAX_LENGTH = 5000;
const SERVER_IP_MAX_LENGTH = 255;
const SERVER_VERSION_MAX_LENGTH = 52;
const SERVER_GAMEMODES_MAX_LENGTH = 200;
const SERVER_LANGUAGES_MAX_LENGTH = 200;
const SERVER_CONNECTION_METHOD_MAX_LENGTH = 60;
const SERVER_NAME_PATTERN = /^[\p{L}\p{N} .,'"!?()&:+-]+$/u;

function isValidServerName(name) {
  return SERVER_NAME_PATTERN.test(name);
}

function isValidServerStatus(status) {
  return status === "draft" || status === "published";
}

const SERVER_SORT_COLUMNS = {
  newest: "servers.created_at DESC, servers.id DESC",
  players: "servers.player_count DESC, servers.id DESC",
  name: "servers.name COLLATE NOCASE ASC",
  liked: "likes DESC, servers.id DESC",
};

function parseServerTimestamp(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(" ", "T") + "Z");
  }
  return new Date(value);
}

const RELAY_STALE_MS = 5 * 60 * 1000;

function applyRelayStaleness(row) {
  if (!row) return row;
  parsePlayerNames(row);
  if (!row.online || !row.last_relay_update) return row;
  const lastUpdateMs = parseServerTimestamp(row.last_relay_update).getTime();
  if (Number.isNaN(lastUpdateMs) || Date.now() - lastUpdateMs > RELAY_STALE_MS) {
    row.online = 0;
    row.player_count = 0;
    row.player_names = null;
  }
  return row;
}

function parsePlayerNames(row) {
  if (!row.player_names) {
    row.player_names = null;
    return;
  }
  try {
    const parsed = JSON.parse(row.player_names);
    row.player_names = Array.isArray(parsed) ? parsed : null;
  } catch {
    row.player_names = null;
  }
}

router.get("/api/servers", async (req, res) => {
  try {
    const whereClauses = ["servers.status = 'published'"];
    const params = [];

    const search = String(req.query.search || "").trim();
    if (search) {
      const safeSearch = search.replace(/[%_]/g, "\\$&");
      whereClauses.push("(servers.name LIKE ? ESCAPE '\\' OR servers.description LIKE ? ESCAPE '\\')");
      params.push(`%${safeSearch}%`, `%${safeSearch}%`);
    }

    const version = String(req.query.version || "").trim();
    if (version) {
      whereClauses.push("servers.version = ?");
      params.push(version);
    }

    const minPlayers = parseInt(req.query.minPlayers, 10);
    if (Number.isInteger(minPlayers) && minPlayers >= 0) {
      whereClauses.push("servers.player_count >= ?");
      params.push(minPlayers);
    }

    const maxPlayers = parseInt(req.query.maxPlayers, 10);
    if (Number.isInteger(maxPlayers) && maxPlayers >= 0) {
      whereClauses.push("servers.player_count <= ?");
      params.push(maxPlayers);
    }

    const gamemodes = String(req.query.gamemodes || "").trim();
    if (gamemodes) {
      const safeGamemodes = gamemodes.replace(/[%_]/g, "\\$&");
      whereClauses.push("servers.gamemodes LIKE ? ESCAPE '\\'");
      params.push(`%${safeGamemodes}%`);
    }

    if (req.query.requiresMods === "true") {
      whereClauses.push("servers.requires_mods = 1");
    } else if (req.query.requiresMods === "false") {
      whereClauses.push("servers.requires_mods = 0");
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const sortKey = SERVER_SORT_COLUMNS[req.query.sort] ? req.query.sort : "newest";
    const orderBy = SERVER_SORT_COLUMNS[sortKey];

    const countRow = await db.get(
      `SELECT COUNT(*) AS total FROM servers ${whereSql}`,
      params
    );
    const total = countRow?.total || 0;

    const viewerId = req.session.user?.id || null;
    const rows = await db.all(
      `SELECT servers.*, users.username AS owner_username,
        (SELECT COUNT(*) FROM server_likes sl WHERE sl.server_id = servers.id) AS likes,
        EXISTS(SELECT 1 FROM server_likes sl2 WHERE sl2.server_id = servers.id AND sl2.user_id = ?) AS liked_by_viewer
       FROM servers
       JOIN users ON servers.owner_id = users.id
       ${whereSql}
       ORDER BY ${orderBy}`,
      [viewerId, ...params]
    );
    rows.forEach(applyRelayStaleness);
    res.json({ ok: true, servers: rows, total });
  } catch (err) {
    console.error("GET SERVERS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load servers." });
  }
});

router.get("/api/servers/:id", async (req, res) => {
  try {
    const row = await db.get(
      `SELECT servers.*, users.username AS owner_username,
        (SELECT COUNT(*) FROM server_likes sl WHERE sl.server_id = servers.id) AS likes
       FROM servers
       JOIN users ON servers.owner_id = users.id
       WHERE servers.id = ?`,
      req.params.id
    );
    if (!row) return res.status(404).json({ ok: false, error: "Server not found." });
    if (row.status === "draft" && row.owner_id !== req.session.user?.id) {
      return res.status(404).json({ ok: false, error: "Server not found." });
    }
    row.required_mods = await getServerRequiredMods(row.id);
    if (req.session.user) {
      const likedRow = await db.get(
        "SELECT id FROM server_likes WHERE user_id = ? AND server_id = ?",
        [req.session.user.id, row.id]
      );
      row.liked_by_viewer = !!likedRow;
    } else {
      row.liked_by_viewer = false;
    }
    applyRelayStaleness(row);
    res.json({ ok: true, server: row });
  } catch (err) {
    console.error("GET SERVER ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load server." });
  }
});

router.get("/api/user/servers", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const rows = await db.all(
      "SELECT * FROM servers WHERE owner_id = ? ORDER BY created_at DESC",
      req.session.user.id
    );
    res.json({ ok: true, servers: rows });
  } catch (err) {
    console.error("Failed to load user servers:", err);
    res.json({ ok: false, error: "Failed to load user servers." });
  }
});

function validateServerFields(body, { requireName }) {
  const { name, description, long_description, website_url, chat_url, ip, version, gamemodes, languages, connection_method } = body;

  if (requireName || name !== undefined) {
    const trimmedName = String(name || "").trim();
    if (!trimmedName) return "Server name is required.";
    if (trimmedName.length > SERVER_NAME_MAX_LENGTH) return `Name must be ${SERVER_NAME_MAX_LENGTH} characters or fewer.`;
    if (!isValidServerName(trimmedName)) return "Name can only contain letters, numbers, spaces, and basic punctuation.";
  }
  if (description !== undefined && String(description).length > SERVER_DESCRIPTION_MAX_LENGTH) {
    return `Description must be ${SERVER_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }
  if (long_description !== undefined && String(long_description).length > SERVER_LONG_DESCRIPTION_MAX_LENGTH) {
    return `Long description must be ${SERVER_LONG_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }
  if (website_url !== undefined && String(website_url).trim() && !isSafeUrl(String(website_url).trim())) {
    return "Website URL must be a valid http(s) link.";
  }
  if (chat_url !== undefined && String(chat_url).trim() && !isSafeUrl(String(chat_url).trim())) {
    return "Chat URL must be a valid http(s) link.";
  }
  if (requireName || ip !== undefined) {
    const trimmedIp = String(ip || "").trim();
    if (!trimmedIp) return "IP / connect address is required.";
    if (trimmedIp.length > SERVER_IP_MAX_LENGTH) return `IP/connect address must be ${SERVER_IP_MAX_LENGTH} characters or fewer.`;
  }
  if (version !== undefined && String(version).length > SERVER_VERSION_MAX_LENGTH) {
    return `Version must be ${SERVER_VERSION_MAX_LENGTH} characters or fewer.`;
  }
  if (gamemodes !== undefined && String(gamemodes).length > SERVER_GAMEMODES_MAX_LENGTH) {
    return `Gamemodes must be ${SERVER_GAMEMODES_MAX_LENGTH} characters or fewer.`;
  }
  if (languages !== undefined && String(languages).length > SERVER_LANGUAGES_MAX_LENGTH) {
    return `Languages must be ${SERVER_LANGUAGES_MAX_LENGTH} characters or fewer.`;
  }
  if (connection_method !== undefined && String(connection_method).length > SERVER_CONNECTION_METHOD_MAX_LENGTH) {
    return `Connection method must be ${SERVER_CONNECTION_METHOD_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

async function parseRequiredModIds(raw) {
  if (raw === undefined) return { ids: undefined };
  let ids;
  try {
    ids = JSON.parse(raw);
  } catch (_) {
    return { error: "Invalid required mods payload." };
  }
  if (!Array.isArray(ids)) return { error: "Invalid required mods payload." };
  ids = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return { ids: [] };
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.all(`SELECT id FROM addons WHERE type = 'mod' AND id IN (${placeholders})`, ids);
  if (rows.length !== ids.length) return { error: "One or more selected mods could not be found." };
  return { ids };
}

async function setServerRequiredMods(serverId, ids) {
  await db.run("DELETE FROM server_required_mods WHERE server_id = ?", serverId);
  for (const addonId of ids) {
    await db.run("INSERT INTO server_required_mods (server_id, addon_id) VALUES (?, ?)", [serverId, addonId]);
  }
}

async function getServerRequiredMods(serverId) {
  return db.all(
    `SELECT addons.id, addons.name FROM server_required_mods
     JOIN addons ON addons.id = server_required_mods.addon_id
     WHERE server_required_mods.server_id = ?`,
    serverId
  );
}

router.post(
  "/api/servers",
  (req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) return next();
    uploadServerIcon.fields([{ name: "icon", maxCount: 1 }])(req, res, function (err) {
      if (err) {
        console.error("SERVER ICON MULTER ERROR:", err);
        return res.status(400).json({ ok: false, error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });

      const validationError = validateServerFields(req.body, { requireName: true });
      if (validationError) return res.status(400).json({ ok: false, error: validationError });

      const requiredMods = await parseRequiredModIds(req.body.required_mod_ids);
      if (requiredMods.error) return res.status(400).json({ ok: false, error: requiredMods.error });

      const { name, description, long_description, website_url, chat_url, ip, version, gamemodes, languages, connection_method, status } = req.body;
      const trimmedName = String(name).trim();
      const resolvedStatus = isValidServerStatus(status) ? status : "draft";
      const requiresModsValue = req.body.requires_mods === "true" || req.body.requires_mods === true ? 1 : 0;

      const iconFile = req.files?.icon?.[0];
      const folder = req._serverUploadFolder;
      if (iconFile) {
        try {
          verifyFiles(iconFile, "image");
        } catch (err) {
          try {
            fs.rmSync(path.join(process.cwd(), "uploads", "servers", folder), { recursive: true, force: true });
          } catch {}
          return res.status(400).json({ ok: false, error: err.message });
        }
      }
      const icon_url = iconFile ? `/uploads/servers/${folder}/${iconFile.filename}` : null;

      const result = await withTransaction(async () => {
        const inserted = await db.run(
          `INSERT INTO servers (owner_id, name, description, long_description, website_url, chat_url, icon_url, ip, version, gamemodes, languages, requires_mods, connection_method, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.session.user.id,
            trimmedName,
            String(description || "").trim() || null,
            String(long_description || "").trim() || null,
            String(website_url || "").trim() || null,
            String(chat_url || "").trim() || null,
            icon_url,
            String(ip || "").trim() || null,
            String(version || "").trim() || null,
            String(gamemodes || "").trim() || null,
            String(languages || "").trim() || null,
            requiresModsValue,
            String(connection_method || "").trim() || null,
            resolvedStatus,
          ]
        );

        if (requiredMods.ids) await setServerRequiredMods(inserted.lastID, requiredMods.ids);
        return inserted;
      });

      const server = await db.get(
        `SELECT servers.*, users.username AS owner_username FROM servers JOIN users ON servers.owner_id = users.id WHERE servers.id = ?`,
        result.lastID
      );
      server.required_mods = await getServerRequiredMods(result.lastID);
      recordMetric("new_servers");
      res.json({ ok: true, server });
    } catch (err) {
      console.error("CREATE SERVER ERROR:", err);
      res.status(500).json({ ok: false, error: "Failed to create server." });
    }
  }
);

router.post(
  "/api/servers/:id/update",
  (req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) return next();
    uploadServerIcon.fields([{ name: "icon", maxCount: 1 }])(req, res, function (err) {
      if (err) {
        console.error("SERVER UPDATE MULTER ERROR:", err);
        return res.status(400).json({ ok: false, error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
      const server = await db.get("SELECT * FROM servers WHERE id = ?", req.params.id);
      if (!server) return res.status(404).json({ ok: false, error: "Server not found." });
      if (server.owner_id !== req.session.user.id) return res.status(403).json({ ok: false, error: "Not your server." });

      const validationError = validateServerFields(req.body, { requireName: false });
      if (validationError) return res.status(400).json({ ok: false, error: validationError });

      const requiredMods = await parseRequiredModIds(req.body.required_mod_ids);
      if (requiredMods.error) return res.status(400).json({ ok: false, error: requiredMods.error });

      const { name, description, long_description, website_url, chat_url, ip, version, gamemodes, languages, connection_method, status, requires_mods } = req.body;
      const updates = [];
      const params = [];

      if (name !== undefined) { updates.push("name = ?"); params.push(String(name).trim()); }
      if (description !== undefined) { updates.push("description = ?"); params.push(String(description).trim() || null); }
      if (long_description !== undefined) { updates.push("long_description = ?"); params.push(String(long_description).trim() || null); }
      if (website_url !== undefined) { updates.push("website_url = ?"); params.push(String(website_url).trim() || null); }
      if (chat_url !== undefined) { updates.push("chat_url = ?"); params.push(String(chat_url).trim() || null); }
      if (ip !== undefined) { updates.push("ip = ?"); params.push(String(ip).trim() || null); }
      if (version !== undefined) { updates.push("version = ?"); params.push(String(version).trim() || null); }
      if (gamemodes !== undefined) { updates.push("gamemodes = ?"); params.push(String(gamemodes).trim() || null); }
      if (languages !== undefined) { updates.push("languages = ?"); params.push(String(languages).trim() || null); }
      if (connection_method !== undefined) { updates.push("connection_method = ?"); params.push(String(connection_method).trim() || null); }
      if (requires_mods !== undefined) { updates.push("requires_mods = ?"); params.push(requires_mods === "true" || requires_mods === true ? 1 : 0); }
      if (status !== undefined) {
        if (!isValidServerStatus(status)) return res.status(400).json({ ok: false, error: "Invalid status." });
        updates.push("status = ?"); params.push(status);
      }

      const iconFile = req.files?.icon?.[0];
      if (iconFile) {
        try {
          verifyFiles(iconFile, "image");
        } catch (err) {
          return res.status(400).json({ ok: false, error: err.message });
        }
        const folder = req._serverUploadFolder;
        updates.push("icon_url = ?");
        params.push(`/uploads/servers/${folder}/${iconFile.filename}`);
      }

      if (updates.length) {
        params.push(server.id);
        await db.run(`UPDATE servers SET ${updates.join(", ")} WHERE id = ?`, params);
      }

      if (requiredMods.ids) await setServerRequiredMods(server.id, requiredMods.ids);

      const updated = await db.get(
        `SELECT servers.*, users.username AS owner_username FROM servers JOIN users ON servers.owner_id = users.id WHERE servers.id = ?`,
        server.id
      );
      updated.required_mods = await getServerRequiredMods(server.id);
      res.json({ ok: true, server: updated });
    } catch (err) {
      console.error("UPDATE SERVER ERROR:", err);
      res.status(500).json({ ok: false, error: "Failed to update server." });
    }
  }
);

router.delete("/api/servers/:id", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const server = await db.get("SELECT * FROM servers WHERE id = ?", req.params.id);
    if (!server) return res.status(404).json({ ok: false, error: "Server not found." });
    if (server.owner_id !== req.session.user.id) return res.status(403).json({ ok: false, error: "Not your server." });

    await withTransaction(async () => {
      await db.run("DELETE FROM server_likes WHERE server_id = ?", server.id);
      await db.run("DELETE FROM server_api_tokens WHERE server_id = ?", server.id);
      await db.run("DELETE FROM server_required_mods WHERE server_id = ?", server.id);
      await db.run("DELETE FROM servers WHERE id = ?", server.id);
    });

    if (server.icon_url) {
      const probe = resolveLocalFile(server.icon_url);
      const folderPath = probe ? path.dirname(probe) : null;
      if (!folderPath) {
        console.warn("Refusing to delete server icon folder for out-of-root path.");
      } else {
        try {
          if (fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true, force: true });
        } catch (e) {
          console.warn("Failed to delete server icon files:", folderPath, e);
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE SERVER ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to delete server." });
  }
});

router.post("/api/servers/:id/like", async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ ok: false, error: "You must be logged in to like servers." });
    }

    const userId = req.session.user.id;
    const serverId = req.params.id;

    const server = await db.get("SELECT id FROM servers WHERE id = ?", serverId);
    if (!server) return res.status(404).json({ ok: false, error: "Server not found." });

    const existingLike = await db.get(
      "SELECT id FROM server_likes WHERE user_id = ? AND server_id = ?",
      [userId, serverId]
    );

    let liked = false;
    if (existingLike) {
      await db.run("DELETE FROM server_likes WHERE id = ?", existingLike.id);
      liked = false;
    } else {
      await db.run("INSERT OR IGNORE INTO server_likes (user_id, server_id) VALUES (?, ?)", [userId, serverId]);
      liked = true;
    }

    const countRow = await db.get("SELECT COUNT(*) AS count FROM server_likes WHERE server_id = ?", [serverId]);
    if (liked) recordMetric("likes");
    res.json({ ok: true, liked, likes: countRow?.count || 0 });
  } catch (err) {
    console.error("SERVER LIKE ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to update like." });
  }
});

const SERVER_TOKEN_BYTES = 32;
function generateServerToken() {
  return `chs_${crypto.randomBytes(SERVER_TOKEN_BYTES).toString("hex")}`;
}

router.get("/api/servers/:id/tokens", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const server = await db.get("SELECT owner_id FROM servers WHERE id = ?", req.params.id);
    if (!server) return res.status(404).json({ ok: false, error: "Server not found." });
    if (server.owner_id !== req.session.user.id) return res.status(403).json({ ok: false, error: "Not your server." });

    const rows = await db.all(
      "SELECT id, created_at, last_used_at FROM server_api_tokens WHERE server_id = ? ORDER BY created_at DESC",
      req.params.id
    );
    res.json({ ok: true, tokens: rows });
  } catch (err) {
    console.error("LIST SERVER TOKENS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load tokens." });
  }
});

router.post("/api/servers/:id/tokens", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const server = await db.get("SELECT owner_id FROM servers WHERE id = ?", req.params.id);
    if (!server) return res.status(404).json({ ok: false, error: "Server not found." });
    if (server.owner_id !== req.session.user.id) return res.status(403).json({ ok: false, error: "Not your server." });

    const plaintextToken = generateServerToken();
    const tokenHash = await bcrypt.hash(plaintextToken, 10);

    const result = await db.run(
      "INSERT INTO server_api_tokens (server_id, owner_id, token_hash, token_prefix) VALUES (?, ?, ?, ?)",
      [req.params.id, req.session.user.id, tokenHash, plaintextToken.slice(0, 16)]
    );

    res.json({
      ok: true,
      token: plaintextToken,
      tokenId: result.lastID,
    });
  } catch (err) {
    console.error("CREATE SERVER TOKEN ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to create token." });
  }
});

router.delete("/api/servers/:id/tokens/:tokenId", async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ ok: false, error: "Not logged in." });
    const server = await db.get("SELECT owner_id FROM servers WHERE id = ?", req.params.id);
    if (!server) return res.status(404).json({ ok: false, error: "Server not found." });
    if (server.owner_id !== req.session.user.id) return res.status(403).json({ ok: false, error: "Not your server." });

    const token = await db.get("SELECT id FROM server_api_tokens WHERE id = ? AND server_id = ?", [req.params.tokenId, req.params.id]);
    if (!token) return res.status(404).json({ ok: false, error: "Token not found." });

    await db.run("DELETE FROM server_api_tokens WHERE id = ?", token.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE SERVER TOKEN ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to delete token." });
  }
});

router.post("/api/servers/relay", async (req, res) => {
  try {
    const authHeader = String(req.headers["authorization"] || "").trim();
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "Missing relay authorization." });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return res.status(401).json({ ok: false, error: "Missing relay authorization." });

    const relayKey = relayThrottleKey(req);
    if (isRelayLocked(relayKey)) {
      return res.status(401).json({ ok: false, error: "Too many failed attempts. Try again later." });
    }

    const { online, playerCount, version, gamemode, playerNames } = req.body || {};

    if (typeof online !== "boolean") {
      return res.status(400).json({ ok: false, error: "Invalid relay update: online must be a boolean." });
    }
    if (playerCount !== undefined && (typeof playerCount !== "number" || !Number.isFinite(playerCount) || playerCount < 0)) {
      return res.status(400).json({ ok: false, error: "Invalid relay update: playerCount must be a non-negative number." });
    }
    if (playerCount !== undefined && playerCount > 10000) {
      return res.status(400).json({ ok: false, error: "Relay update exceeds allowed limits." });
    }
    if (version !== undefined && (typeof version !== "string" || version.length > 52)) {
      return res.status(400).json({ ok: false, error: "Relay update exceeds allowed limits." });
    }
    if (gamemode !== undefined && (typeof gamemode !== "string" || gamemode.length > 123)) {
      return res.status(400).json({ ok: false, error: "Relay update exceeds allowed limits." });
    }
    let sanitizedPlayerNames;
    if (playerNames !== undefined) {
      if (!Array.isArray(playerNames) || playerNames.length > 200 || playerNames.some((n) => typeof n !== "string" || n.length > 64)) {
        return res.status(400).json({ ok: false, error: "Relay update exceeds allowed limits." });
      }
      sanitizedPlayerNames = playerNames.map((n) => n.trim()).filter(Boolean);
    }

    const candidates = await db.all(
      "SELECT id, server_id, owner_id, token_hash FROM server_api_tokens WHERE token_prefix = ? OR token_prefix IS NULL",
      [token.slice(0, 16)]
    );
    let matchedToken = null;
    for (const candidate of candidates) {
      if (await bcrypt.compare(token, candidate.token_hash)) {
        matchedToken = candidate;
        break;
      }
    }
    if (!matchedToken) {
      recordRelayFailure(relayKey);
      return res.status(401).json({ ok: false, error: "Invalid relay authorization." });
    }
    clearRelayFailures(relayKey);


    const server = await db.get("SELECT id, status FROM servers WHERE id = ?", matchedToken.server_id);
    if (!server) {
      return res.status(401).json({ ok: false, error: "Invalid relay authorization." });
    }

    await db.run(
      `UPDATE servers SET
         online = ?,
         player_count = COALESCE(?, player_count),
         version = COALESCE(?, version),
         gamemodes = COALESCE(?, gamemodes),
         player_names = CASE WHEN ? = 0 THEN NULL ELSE COALESCE(?, player_names) END,
         last_relay_update = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        online ? 1 : 0,
        playerCount !== undefined ? playerCount : null,
        version !== undefined ? version.trim() : null,
        gamemode !== undefined ? gamemode.trim() : null,
        online ? 1 : 0,
        sanitizedPlayerNames !== undefined ? JSON.stringify(sanitizedPlayerNames) : null,
        server.id,
      ]
    );
    await db.run("UPDATE server_api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?", matchedToken.id);

    res.json({ ok: true });
  } catch (err) {
    console.error("SERVER RELAY ERROR:", err);
    res.status(500).json({ ok: false, error: "Unable to update server state." });
  }
});

const CUBBIE_VERSION = "1.2.0";

router.get("/api/cubbie/version", (req, res) => {
  res.json({ ok: true, version: CUBBIE_VERSION, downloadUrl: "https://addons.ashframe.net/downloads/cubbie/" });
});

export default router;
