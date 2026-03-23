# MSFS Bridge Cloud Relay Server

Cloud WebSocket relay server that connects local MSFS Bridge clients to web dashboards.

This repo also contains **`chart-worker/`** — a separate Node + GDAL service that builds FAA chart tiles and uploads them to Supabase Storage. Deploy it as a **second Railway service** from the same repo with root directory **`chart-worker`** (see `chart-worker/README.md`).

## What This Does

This server acts as a relay between:
- **MSFS Bridge clients** (running on users' PCs with Microsoft Flight Simulator)
- **Web dashboards** (React app hosted on GitHub Pages)

It enables real-time flight data streaming from local simulators to cloud-hosted dashboards.

## Quick Deploy

### Railway (Recommended)

1. Fork or clone this repository
2. Go to [railway.app](https://railway.app)
3. Click "New Project" → "Deploy from GitHub repo"
4. Select this repository
5. Railway will auto-detect and deploy
6. Get your URL (e.g., `https://msfs-relay-production.up.railway.app`)
7. Use `wss://` instead of `https://` for WebSocket connections

### Render

1. Go to [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect this GitHub repository
4. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. Deploy and get your URL

## Configuration

### Environment Variables (Optional)

- `PORT` - Server port (default: 3000, auto-set by hosting platforms)
- `NODE_ENV` - Environment (production/development)
- `ALLOWED_ORIGINS` - Comma-separated list of allowed origins (default: all)

### Testing

Once deployed, test the health endpoint:
```
https://your-server-url.com/health
```

Should return:
```json
{
  "status": "ok",
  "activeSessions": 0,
  "timestamp": "..."
}
```

## How It Works

1. **Bridge connects:** Local MSFS Bridge connects with `?role=bridge&sessionId=user_xxx`
2. **Client connects:** Web dashboard connects with `?role=client&sessionId=user_xxx`
3. **Data relay:** Server forwards telemetry from bridge to client(s) in the same session
4. **Session isolation:** Each user's session ID keeps their data private

## Architecture

```
MSFS (PC) → Bridge Client → Cloud Relay Server → Web Dashboard
```

- Bridge sends flight telemetry to server
- Server relays to all connected clients in that session
- Multiple clients can view the same session (e.g., instructor + student)

## Requirements

- Node.js 16+ 
- `ws` package (WebSocket library)

## License

MIT

