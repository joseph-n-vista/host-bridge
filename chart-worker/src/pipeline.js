import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (r.status !== 0) {
    const err = new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
    err.stdout = r.stdout;
    err.stderr = r.stderr;
    throw err;
  }
  return r;
}

function findGeoTiffs(rootDir) {
  const out = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const name of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, name.name);
      if (name.isDirectory()) walk(p);
      else if (/\.(tif|tiff)$/i.test(name.name)) out.push(p);
    }
  }
  walk(rootDir);
  return out.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
}

/**
 * @param {object} opts
 * @param {string} opts.cycleKey - FAA visual folder e.g. 03-19-2026
 * @param {string} opts.category - ChartCategory raw e.g. vfrSectional
 * @param {string} opts.chartId - e.g. Seattle
 * @param {string} opts.zipFileName - e.g. Seattle.zip
 * @param {"sectional-files"|"tac-files"} opts.faaSubfolder
 * @param {string} opts.bucket - Supabase bucket
 * @param {string} opts.storagePrefix - e.g. visual/03-19-2026/vfrSectional/Seattle/tiles
 * @param {number} opts.minZoom
 * @param {number} opts.maxZoom
 * @param {import('@supabase/supabase-js').SupabaseClient} opts.supabase
 * @param {string} opts.workRoot - temp directory
 */
export async function buildAndUploadChart(opts) {
  const {
    cycleKey,
    category,
    chartId,
    zipFileName,
    faaSubfolder,
    bucket,
    storagePrefix,
    minZoom,
    maxZoom,
    supabase,
    workRoot,
  } = opts;

  const slug = `${category}__${chartId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const base = path.join(workRoot, slug);
  fs.mkdirSync(base, { recursive: true });

  const zipPath = path.join(base, "source.zip");
  const extractDir = path.join(base, "extract");
  const warpedPath = path.join(base, "warped_3857.tif");
  const tilesDir = path.join(base, "tiles_out");

  const zipUrl = `https://aeronav.faa.gov/visual/${cycleKey}/${faaSubfolder}/${zipFileName}`;
  console.log(`[${slug}] Download ${zipUrl}`);

  const res = await fetch(zipUrl);
  if (!res.ok) {
    throw new Error(`FAA download failed ${res.status}: ${zipUrl}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(zipPath, buf);

  fs.mkdirSync(extractDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractDir, true);

  const tiffs = findGeoTiffs(extractDir);
  if (tiffs.length === 0) {
    throw new Error(`No GeoTIFF found in ${zipFileName}`);
  }
  const inputTif = tiffs[0];
  console.log(`[${slug}] Using raster: ${inputTif}`);

  console.log(`[${slug}] gdalwarp → EPSG:3857`);
  run("gdalwarp", [
    "-overwrite",
    "-t_srs",
    "EPSG:3857",
    "-r",
    "bilinear",
    "-co",
    "TILED=YES",
    "-co",
    "COMPRESS=LZW",
    inputTif,
    warpedPath,
  ]);

  if (fs.existsSync(tilesDir)) {
    fs.rmSync(tilesDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tilesDir, { recursive: true });

  const zoomArg = `${minZoom}-${maxZoom}`;
  console.log(`[${slug}] gdal2tiles.py z=${zoomArg} (XYZ)`);
  // --xyz: slippy map / Mapbox-style Y
  const g2t = spawnSync(
    "gdal2tiles.py",
    [
      "--xyz",
      "--zoom",
      zoomArg,
      "--processes",
      "2",
      "--webviewer",
      "none",
      warpedPath,
      tilesDir,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  if (g2t.status !== 0) {
    const err = new Error(`gdal2tiles.py failed (${g2t.status})`);
    err.stdout = g2t.stdout;
    err.stderr = g2t.stderr;
    throw err;
  }

  const files = [];
  function walkTiles(d, rel = "") {
    for (const name of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, name.name);
      const r = rel ? `${rel}/${name.name}` : name.name;
      if (name.isDirectory()) walkTiles(p, r);
      else if (/\.png$/i.test(name.name)) files.push({ abs: p, rel: r });
    }
  }
  walkTiles(tilesDir);
  console.log(`[${slug}] Upload ${files.length} PNG tiles → ${bucket}/${storagePrefix}/`);

  const concurrency = 6;
  for (let start = 0; start < files.length; start += concurrency) {
    const slice = files.slice(start, start + concurrency);
    await Promise.all(
      slice.map(async ({ abs, rel }, j) => {
        const objectPath = `${storagePrefix}/${rel}`.replace(/\\/g, "/");
        const body = fs.readFileSync(abs);
        const { error } = await supabase.storage.from(bucket).upload(objectPath, body, {
          contentType: "image/png",
          upsert: true,
        });
        if (error) {
          throw new Error(`Upload failed ${objectPath}: ${error.message}`);
        }
        const done = start + j + 1;
        if (done % 200 === 0 || done === files.length) {
          console.log(`[${slug}] Uploaded ${done}/${files.length}`);
        }
      })
    );
  }

  console.log(`[${slug}] Done.`);
  return { tileCount: files.length, storagePrefix };
}
