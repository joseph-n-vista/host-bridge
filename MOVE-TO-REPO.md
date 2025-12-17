# Moving to Public Repository

## Files Ready to Move

All necessary files are in the `host-bridge/` folder:

- ✅ `server.js` - Main relay server (renamed from cloud-relay-server.js)
- ✅ `package.json` - Dependencies and scripts
- ✅ `README.md` - Documentation for the repo
- ✅ `.gitignore` - Git ignore file

## Steps to Move

1. **Create the new public repository:**
   - Go to GitHub
   - Create new repo named `host-bridge` (or whatever you want)
   - Make it **public**

2. **Copy files from `host-bridge/` folder:**
   ```bash
   # In your new repo, copy these files:
   - server.js
   - package.json
   - README.md
   - .gitignore
   ```

3. **Commit and push:**
   ```bash
   git add .
   git commit -m "Initial commit - MSFS Bridge Cloud Relay Server"
   git push origin main
   ```

4. **Deploy to Railway:**
   - Go to railway.app
   - New Project → Deploy from GitHub repo
   - Select your new `host-bridge` repository
   - Railway will auto-detect and deploy
   - Get your URL (e.g., `https://host-bridge-production.up.railway.app`)

5. **Update your bridge code:**
   - In `msfs-bridge-unified.py`, update:
     ```python
     CLOUD_WS_URL = "wss://your-actual-url.railway.app"
     ```
   - In `ReactRoot/.env`, update:
     ```
     VITE_CLOUD_WS_URL=wss://your-actual-url.railway.app
     ```

## What Each File Does

- **server.js** - The WebSocket relay server that connects bridges to dashboards
- **package.json** - Defines dependencies (just `ws` for WebSockets)
- **README.md** - Explains what the server does and how to deploy
- **.gitignore** - Excludes node_modules and other unnecessary files

## That's It!

Once you push to the public repo and deploy to Railway, you'll have your cloud server running! 🚀

