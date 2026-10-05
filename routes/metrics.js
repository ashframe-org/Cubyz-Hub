import express from "express";
import { getPublicMetrics } from "../services/metrics.js";

const router = express.Router();

router.get("/api/metrics", async (req, res) => {
  try {
    const data = await getPublicMetrics();
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error("METRICS ERROR:", err);
    res.status(500).json({ ok: false, error: "Failed to load metrics." });
  }
});

export default router;
