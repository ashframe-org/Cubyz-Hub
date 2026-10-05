import "./config.js";
import express from "express";
import path from "path";
import cors from "cors";
import session from "express-session";
import SQLiteStoreFactory from "connect-sqlite3";
import { initDb, db, dbReady } from "./db/index.js";
import { securityHeaders } from "./middleware/security.js";
import { refreshModerators } from "./services/forumMods.js";
import { activityTracker } from "./middleware/activity.js";
import modelsRouter from "./routes/models.js";
import serversRouter from "./routes/servers.js";
import authRouter from "./routes/auth.js";
import addonsRouter from "./routes/addons.js";
import usersRouter from "./routes/users.js";
import changelogRouter from "./routes/changelog.js";
import pagesRouter from "./routes/pages.js";
import creatorRouter from "./routes/creator.js";
import commentsRouter from "./routes/comments.js";
import versionsRouter from "./routes/versions.js";
import notificationsRouter from "./routes/notifications.js";
import healthRouter from "./routes/health.js";
import metricsRouter from "./routes/metrics.js";
import forumRouter from "./routes/forum.js";
import feedbackRouter from "./routes/feedback.js";
import { refreshOnlinePeak } from "./services/metrics.js";
import { maybeRefreshGitHubIssues } from "./services/githubIssues.js";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: process.env.DOMAIN || false, credentials: true }));

const STATIC_ASSET_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function setStaticCacheHeaders(res, filePath) {
  if (/\.html?$/i.test(filePath)) {
    res.setHeader("Cache-Control", "public, max-age=60");
  } else {
    res.setHeader("Cache-Control", `public, max-age=${STATIC_ASSET_MAX_AGE_MS / 1000}, immutable`);
  }
}

app.get("/dashboard.html", (req, res) => res.redirect(301, "/dashboard"));

app.use(express.static("public", { setHeaders: setStaticCacheHeaders }));
app.use("/uploads", express.static("uploads", { maxAge: STATIC_ASSET_MAX_AGE_MS, immutable: true }));
app.use("/avatars", express.static("avatars", { maxAge: 5 * 60 * 1000 }));
app.use("/banners", express.static("banners", { maxAge: 5 * 60 * 1000 }));

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production - refusing to start with a hardcoded fallback.");
}

const SQLiteStore = SQLiteStoreFactory(session);
app.use(
  session({
    store: new SQLiteStore({ dir: path.join(process.cwd(), "data"), db: "sessions.sqlite" }),
    secret: process.env.SESSION_SECRET || "cubyz-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(activityTracker);

// Reject API traffic until initDb() has finished every table/index/
// migration, so nothing runs against a half-built schema. /health is
// exempt (it reports its own 503) as are static assets.
app.use((req, res, next) => {
  if (!dbReady && req.path.startsWith("/api/")) {
    return res.status(503).json({ ok: false, error: "Server starting up, try again shortly." });
  }
  next();
});

app.use(modelsRouter);
app.use(serversRouter);
app.use(authRouter);
app.use(addonsRouter);
app.use(usersRouter);
app.use(changelogRouter);
app.use(pagesRouter);
app.use(creatorRouter);
app.use(commentsRouter);
app.use(versionsRouter);
app.use(notificationsRouter);
app.use(metricsRouter);
app.use(forumRouter);
app.use(feedbackRouter);
app.use(healthRouter);

initDb()
  .then(() => {
    refreshModerators().catch(() => {});
    refreshOnlinePeak().catch(() => {});
    setInterval(() => refreshOnlinePeak().catch(() => {}), 2 * 60 * 1000).unref();
    maybeRefreshGitHubIssues().catch(() => {});
    setInterval(() => maybeRefreshGitHubIssues().catch(() => {}), 30 * 60 * 1000).unref();
  })
  .catch((err) => {
    console.error("FATAL: database initialisation failed:", err);
  });

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running smoothly on port ${PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} received, checkpointing DB before exit...`);
  try {
    if (db) await db.exec(`PRAGMA wal_checkpoint(TRUNCATE);`);
  } catch (err) {
    console.error("Failed to checkpoint DB on shutdown:", err);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app, server };
