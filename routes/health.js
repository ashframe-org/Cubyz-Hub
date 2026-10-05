import express from "express";
import { db, dbReady } from "../db/index.js";

const router = express.Router();
const startedAt = Date.now();

router.get("/health", async (req, res) => {
  if (!dbReady) {
    return res.status(503).json({ ok: false, error: "Database initialising." });
  }
  try {
    await db.get("SELECT 1 AS ok");
    res.json({ ok: true, uptime: Math.floor((Date.now() - startedAt) / 1000) });
  } catch (err) {
    console.error("Health check failed:", err);
    res.status(503).json({ ok: false, error: "Database unreachable." });
  }
});

export default router;
