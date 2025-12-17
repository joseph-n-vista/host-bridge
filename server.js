// Cloud WebSocket Relay Server for MSFS Bridge
// This server relays data from the local bridge to GitHub Pages clients
// Deploy to Railway, Render, Heroku, or similar

const WebSocket = require('ws');
const http = require('http');
const url = require('url');

// Use PORT from environment (required by Railway, Render, Heroku)
const PORT = process.env.PORT || 3000;

// CORS configuration for WebSocket connections
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['*']; // Allow all origins by default

// Store active sessions: sessionId -> { bridge: ws, clients: Set<ws> }
const sessions = new Map();

// Store recent data per session (for reconnection)
const sessionData = new Map();

const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const query = url.parse(req.url, true).query;
  const role = query.role; // 'bridge' or 'client'
  const sessionId = query.sessionId || 'default';
  const token = query.token; // Optional authentication token

  console.log(`[${new Date().toISOString()}] Connection: role=${role}, session=${sessionId}`);

  if (role === 'bridge') {
    // This is the local bridge connecting
    handleBridgeConnection(ws, sessionId, token);
  } else {
    // This is a client (GitHub Pages) connecting
    handleClientConnection(ws, sessionId, token);
  }
});

function handleBridgeConnection(ws, sessionId, token) {
  // Validate token if needed (optional)
  // if (token !== process.env.BRIDGE_TOKEN) {
  //   ws.close(1008, 'Invalid token');
  //   return;
  // }

  // Initialize session if needed
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      bridge: null,
      clients: new Set(),
      lastData: null,
      createdAt: Date.now()
    });
  }

  const session = sessions.get(sessionId);
  session.bridge = ws;

  // Send any recent data to the bridge (acknowledgment)
  ws.send(JSON.stringify({ type: 'connected', sessionId }));

  // Forward data from bridge to all clients
  ws.on('message', (data) => {
    try {
      const payload = JSON.parse(data.toString());
      session.lastData = payload;
      sessionData.set(sessionId, payload);

      // Broadcast to all clients in this session
      session.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    } catch (error) {
      console.error('Error processing bridge message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`[${new Date().toISOString()}] Bridge disconnected: session=${sessionId}`);
    if (session.bridge === ws) {
      session.bridge = null;
      // Notify clients that bridge disconnected
      session.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'bridge_disconnected' }));
        }
      });
    }
  });

  ws.on('error', (error) => {
    console.error(`Bridge error (session=${sessionId}):`, error);
  });
}

function handleClientConnection(ws, sessionId, token) {
  // Initialize session if needed
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      bridge: null,
      clients: new Set(),
      lastData: null,
      createdAt: Date.now()
    });
  }

  const session = sessions.get(sessionId);
  session.clients.add(ws);

  // Send immediate connection status
  const status = {
    type: 'connected',
    sessionId,
    hasBridge: session.bridge !== null,
    lastData: session.lastData
  };
  ws.send(JSON.stringify(status));

  // If there's recent data, send it immediately
  if (session.lastData) {
    ws.send(JSON.stringify(session.lastData));
  }

  ws.on('close', () => {
    session.clients.delete(ws);
    // Clean up empty sessions after 5 minutes
    if (session.clients.size === 0 && !session.bridge) {
      setTimeout(() => {
        if (sessions.get(sessionId)?.clients.size === 0 && !sessions.get(sessionId)?.bridge) {
          sessions.delete(sessionId);
          sessionData.delete(sessionId);
          console.log(`Cleaned up session: ${sessionId}`);
        }
      }, 5 * 60 * 1000);
    }
  });

  ws.on('error', (error) => {
    console.error(`Client error (session=${sessionId}):`, error);
    session.clients.delete(ws);
  });
}

// Health check endpoint
server.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      activeSessions: sessions.size,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MSFS Bridge Cloud Relay Server\n\n' +
      `Active sessions: ${sessions.size}\n` +
      'Connect as bridge: ws://<server>/?role=bridge&sessionId=<id>\n' +
      'Connect as client: ws://<server>/?role=client&sessionId=<id>');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`MSFS Bridge Cloud Relay Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Cleanup on shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});

