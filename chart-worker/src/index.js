import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { buildAndUploadChart } from "./pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8080);
const WORKER_SECRET = process.env.WORKER_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "aviation-charts";
const MIN_ZOOM = Number(process.env.MIN_ZOOM ?? 0);
const MAX_ZOOM = Number(process.env.MAX_ZOOM ?? 10);
const WORK_ROOT = process.env.WORK_ROOT || "/tmp/chart-worker";

/**
 * Default job: Seattle sectional + Seattle TAC (matches sample catalog).
 * Override with POST /build body or CHART_JOBS_JSON env (array).
 */
const DEFAULT_JOBS = [
  {
    category: "vfrSectional",
    chartId: "Seattle",
    zipFileName: "Seattle.zip",
    faaSubfolder: "sectional-files",
  },
  {
    category: "vfrTac",
    chartId: "Seattle_TAC",
    zipFileName: "Seattle_TAC.zip",
    faaSubfolder: "tac-files",
  },
];

function requireEnv() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!WORKER_SECRET) missing.push("WORKER_SECRET");
  return missing;
}

function parseJobs(body) {
  if (body && Array.isArray(body.jobs) && body.jobs.length > 0) return body.jobs;
  const raw = process.env.CHART_JOBS_JSON;
  if (raw && raw.trim()) {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j;
  }
  return DEFAULT_JOBS;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

let busy = false;
let lastResult = null;
let lastError = null;

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    busy,
    bucket: STORAGE_BUCKET,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    lastError: lastError ? String(lastError) : null,
    lastResult,
  });
});

app.post("/build", async (req, res) => {
  const missing = requireEnv();
  if (missing.length) {
    return res.status(500).json({ ok: false, error: `Missing env: ${missing.join(", ")}` });
  }
  const token = req.get("x-worker-secret") || req.body?.secret;
  if (token !== WORKER_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (busy) {
    return res.status(409).json({ ok: false, error: "Already running" });
  }

  const cycleKey = req.body?.cycleKey || process.env.FAA_CYCLE_KEY;
  if (!cycleKey || String(cycleKey).trim() === "") {
    return res.status(400).json({ ok: false, error: "cycleKey required (body or FAA_CYCLE_KEY)" });
  }

  const jobs = parseJobs(req.body);
  busy = true;
  lastError = null;
  lastResult = null;

  res.status(202).json({ ok: true, accepted: true, jobs: jobs.length, cycleKey });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    fs.mkdirSync(WORK_ROOT, { recursive: true });
    const results = [];
    for (const job of jobs) {
      const { category, chartId, zipFileName, faaSubfolder } = job;
      if (!category || !chartId || !zipFileName || !faaSubfolder) {
        throw new Error(`Invalid job: ${JSON.stringify(job)}`);
      }
      const storagePrefix = `visual/${cycleKey}/${category}/${chartId}/tiles`;
      const r = await buildAndUploadChart({
        cycleKey,
        category,
        chartId,
        zipFileName,
        faaSubfolder,
        bucket: STORAGE_BUCKET,
        storagePrefix,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        supabase,
        workRoot: WORK_ROOT,
      });
      results.push({ chartId, category, ...r });
    }
    lastResult = { cycleKey, results, at: new Date().toISOString() };
    console.log("BUILD OK", JSON.stringify(lastResult, null, 2));
  } catch (e) {
    lastError = e;
    console.error("BUILD FAILED", e);
    if (e.stderr) console.error(e.stderr);
    if (e.stdout) console.error(e.stdout);
  } finally {
    busy = false;
  }
});

const missingStart = requireEnv();
if (missingStart.length) {
  console.warn(`Warning: missing env (needed for /build): ${missingStart.join(", ")}`);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`chart-worker listening on ${PORT}`);
});
