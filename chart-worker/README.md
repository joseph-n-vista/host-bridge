# chart-worker

FAA visual chart ZIP → GDAL warp (EPSG:3857) → XYZ PNG tiles → Supabase Storage. Intended to run on **Railway** (Docker) with the **Supabase service role key** (server-side only).

**ForeFlight-style map face (no legend strip):** Supply **your own** neat-line `.shp` sets (or a properly licensed dataset) and set **`CHART_CUTLINES_DIR`** to that directory (e.g. via Railway volume). Nothing is bundled in the image—see `cutlines/README.md`. If unset or a chart has no matching shapefile, that chart tiles the **full FAA sheet**.

**Quality (common GDAL practice):** The worker uses **`lanczos`** tile resampling (not GDAL’s default `average`, which softens text/linework), **`cubic`** for `gdalwarp`, **`--exclude`** for empty transparent tiles, and default **`MAX_ZOOM=12`**. Tune with env vars below; each zoom step above ~10 multiplies tile count roughly four times.

## Object layout

Tiles are uploaded as:

`visual/{cycleKey}/{category}/{chartId}/tiles/{z}/{x}/{y}.png`

Example: `visual/03-19-2026/vfrSectional/Seattle/tiles/0/0/0.png`

Match `cycleKey` and paths to your public `catalog/v1.json` `tileURLTemplate`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | yes | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role (bypasses RLS; keep secret) |
| `WORKER_SECRET` | yes | Shared secret for `POST /build` |
| `FAA_CYCLE_KEY` | optional* | FAA folder under `aeronav.faa.gov/visual/` (e.g. `03-19-2026`) |
| `STORAGE_BUCKET` | no | Default `aviation-charts` |
| `MIN_ZOOM` / `MAX_ZOOM` | no | Defaults `0` / `12` (raise to `13` only if you want more zoom; cost ~4× tiles per step) |
| `WARP_RESAMPLING` | no | `gdalwarp -r` (default **`cubic`**; try `lanczos` for max sharpness, slower) |
| `TILE_RESAMPLING` | no | `gdal2tiles --resampling` (default **`lanczos`**; `average` = GDAL default, softer) |
| `GDAL2TILES_EXCLUDE` | no | Default **`true`**: skip all-transparent tiles (`--exclude`) |
| `CHART_CUTLINES_DIR` | no | If set, `gdalwarp` uses `sectional/*.shp` / `terminal/*.shp` neat-line crops when present (BYO files; see `cutlines/README.md`) |
| `WORK_ROOT` | no | Temp dir; default `/tmp/chart-worker` |
| `CHART_JOBS_JSON` | no | JSON array of jobs (see defaults in `src/index.js`) |
| `PORT` | no | Railway sets this automatically |

\*Required unless you send `cycleKey` in every `POST /build` body.

## HTTP API

- **`GET /health`** — status, `busy`, last result/error.
- **`POST /build`** — starts an async build (responds **202**).

Auth: header `x-worker-secret: <WORKER_SECRET>` or JSON body `{ "secret": "..." }`.

Body (optional fields):

```json
{
  "secret": "your-worker-secret",
  "cycleKey": "03-19-2026",
  "jobs": [
    {
      "category": "vfrSectional",
      "chartId": "Seattle",
      "zipFileName": "Seattle.zip",
      "faaSubfolder": "sectional-files"
    }
  ]
}
```

### Trimmed / custom GeoTIFF (no FAA ZIP)

Upload your **single trimmed `.tif`** to the **same** Storage `STORAGE_BUCKET`, then pass **`rasterPathInBucket`** (object path). The worker downloads it with the **service role** (no public URL required).

Example object layout: `sources/03-19-2026/vfrSectional/Seattle_trimmed.tif`

```json
{
  "secret": "your-worker-secret",
  "cycleKey": "03-19-2026",
  "jobs": [
    {
      "category": "vfrSectional",
      "chartId": "Seattle",
      "rasterPathInBucket": "sources/03-19-2026/vfrSectional/Seattle_trimmed.tif"
    }
  ]
}
```

Alternatively use **`rasterUrl`** (public or **signed** HTTPS URL to a GeoTIFF). Do not set both `rasterPathInBucket` and `rasterUrl` on the same job.

When either is set, **`zipFileName`** / **`faaSubfolder`** are ignored for that job. Output tiles still go under `visual/{cycleKey}/{category}/{chartId}/tiles/...`.

Example after deploy (replace host and secrets):

```bash
curl -sS -X POST "https://YOUR_SERVICE.up.railway.app/build" \
  -H "Content-Type: application/json" \
  -H "x-worker-secret: YOUR_WORKER_SECRET" \
  -d '{"cycleKey":"03-19-2026"}'
```

Then poll `GET /health` until `busy` is false and check `lastResult` / `lastError`.

## Railway

1. In the **host-bridge** GitHub repo, add a service and set **root directory** to **`chart-worker`** (or set **Dockerfile path** to `chart-worker/Dockerfile`).
2. Add variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_SECRET`, `FAA_CYCLE_KEY` (or omit and pass `cycleKey` per request).
3. Ensure the Storage bucket exists and policies allow the service role to upload (or use bucket configured for your project).
4. Builds are CPU/memory heavy; choose an appropriate plan. Large charts at high zoom can take a long time and many objects.

## Local Docker

```bash
cd chart-worker
docker build -t chart-worker .
docker run --rm -p 8080:8080 \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e WORKER_SECRET=test \
  -e FAA_CYCLE_KEY=03-19-2026 \
  chart-worker
```

## Local Node (macOS)

Install GDAL first (e.g. `brew install gdal`), then `npm ci` and `npm start` with the same env vars.
