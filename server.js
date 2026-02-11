
require('module-alias/register');

const DEBUG_DISABLE_LOCAL_IP_FILTER =
  !('DEBUG_DISABLE_LOCAL_IP_FILTER' in process.env) ||
  process.env.DEBUG_DISABLE_LOCAL_IP_FILTER === '' ||
  process.env.DEBUG_DISABLE_LOCAL_IP_FILTER === 'true';
const ENABLE_DEBUG_ENDPOINTS = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
require('utils/logger');
const { getClientIP, isLocalIP } = require('utils/ip-utils');
const { parseStatusPayload } = require('utils/status-utils');
const UserStats = require('utils/user-stats');

const PrinterDiscovery = require('utils/printer-discovery');
const SDCPClient = require('utils/sdcp-client');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MAX_FPS = 15;
const PORT = process.env.PORT || 3000;
const STATUS_POLL_INTERVAL = 2000;
const WS_UPDATE_INTERVAL = (() => {
  const value = Number.parseInt(process.env.WS_UPDATE_INTERVAL, 10);
  return Number.isFinite(value) && value > 0 ? value : 1000;
})();
const CAMERA_MAX_START_FAILURES = 3;
const CAMERA_ACK_ERRORS = {
  1: 'Exceeded maximum simultaneous streaming limit',
  2: 'Camera does not exist',
  3: 'Unknown error'
};

// Chat configuration - all limits controlled by environment variables
const CHAT_MESSAGE_MAX_LENGTH = Number(process.env.CHAT_MESSAGE_MAX_LENGTH) || 500;
const CHAT_NICKNAME_MAX_LENGTH = Number(process.env.CHAT_NICKNAME_MAX_LENGTH) || 24;
const CHAT_MESSAGE_COOLDOWN_MS = Number(process.env.CHAT_MESSAGE_COOLDOWN_MS) || 1000;
const CHAT_MATH_MIN = Number(process.env.CHAT_MATH_MIN) || 1;
const CHAT_MATH_MAX = Number(process.env.CHAT_MATH_MAX) || 10;

// Store printer data
let printerClient = null;
let defaultPrinterStatus = {
  connected: false,
  printerName: 'Unknown',
  state: 'Disconnected',
  progress: 0,
  layerProgress: 0,
  temperatures: {
    bed: { current: 0, target: 0 },
    nozzle: { current: 0, target: 0 },
    enclosure: { current: 0, target: 0 }
  },
  currentFile: '',
  printTime: 0,
  remainingTime: 0,
  calculatedTime: null,
  cameraAvailable: false,
  cameraError: null,
  lastUpdate: null,
  customState: 0,
  layers: {
    total: 0,
    finished: 0
  },
  // Status object containing machine and job states
  status: {
    consolidated: 'UNKNOWN',
    machine: { state: 'UNKNOWN', code: null },
    job: { state: 'UNKNOWN', code: null }
  },
  status_code: null,
  prev_status: null
};
let printerStatus = { ...defaultPrinterStatus };
let reconnectSetupInProgress = false;
let reconnectSetupNeeded = false;
/**
 * Set custom status codes based on printer info
 * @param {object} info - Raw printer info/status
 */
function setCustomState(info) {
  if (!info || !info.Status) {
    return;
  }
  const s = info.Status;
  let code = 0;
  // Example: Custom state 1: Printing but no file
  if (s.CurrentStatus && s.CurrentStatus[0] === 1) {
    if (!s.PrintInfo || !s.PrintInfo.Filename) {
      code = 1;
    }
  }
  // Add more custom state code logic here as needed
  printerStatus.customState = code;
}

// WebSocket clients
const webClients = new Set();

// Camera stream
let cameraStreamURL = null;
let printerStream = null;
const cameraSubscribers = new Set(); // Clients subscribed to camera stream
let latestFrame = null;
const cameraContentType = 'image/jpeg';
let cameraStartFailure = { lastError: null, count: 0 };

const userStats = new UserStats();

const resolveClientIP = (req, socket) =>
  getClientIP(req, socket, DEBUG_DISABLE_LOCAL_IP_FILTER);

/**
 * Generate a simple math challenge for anti-bot verification
 * Returns an object with the challenge question and answer
 */
function generateMathChallenge() {
  const min = CHAT_MATH_MIN;
  const max = CHAT_MATH_MAX;
  const a = Math.floor(Math.random() * (max - min + 1)) + min;
  const b = Math.floor(Math.random() * (max - min + 1)) + min;
  return {
    a,
    b,
    answer: a + b,
    question: `${a} + ${b} = ?`,
  };
}

function updateUserStatsAndBroadcast() {
  printerStatus.users = userStats.getSnapshot();
  // Notify connected web clients of updated stats
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
}

function resetCameraFailureTracker() {
  cameraStartFailure = { lastError: null, count: 0 };
}

function handleCameraStartFailure(errMessage) {
  const message = errMessage || 'Unknown camera error';
  if (cameraStartFailure.lastError === message) {
    cameraStartFailure.count += 1;
  } else {
    cameraStartFailure = { lastError: message, count: 1 };
  }

  if (cameraStartFailure.count >= CAMERA_MAX_START_FAILURES) {
    console.error(`Camera failed to start ${cameraStartFailure.count} times with the same error; exiting to restart. Error: ${message}`);
    broadcastToClients({ type: 'server_restarting', data: { reason: message } });
    // Give the broadcast a moment to flush before exiting so PM2 can restart us
    setTimeout(() => process.exit(1), 1000);
  }
}



// Set printer status to disconnected and broadcast
function setDisconnectedStatus() {
  if (
    printerStatus.connected === false &&
    printerStatus.printerName === 'Unknown' &&
    printerStatus.state === 'Disconnected'
  ) return;
  reconnectSetupNeeded = true;
  printerStatus = {
    ...defaultPrinterStatus,
    lastUpdate: new Date().toISOString()
  };
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
}

function buildStatusPayload() {
  printerStatus.users = printerStatus.users || userStats.getSnapshot();
  return {
    printer: printerStatus,
    users: userStats.getSnapshot()
  };
}

// Serve static files
app.use(express.static('public'));

// API endpoint to get current printer status
app.get('/api/status', (req, res) => {
  // Ensure latest user stats are present
  printerStatus.users = userStats.getSnapshot();
  res.json(buildStatusPayload());
});

// API endpoint to discover printers
app.get('/api/discover', async (req, res) => {
  try {
    const discovery = new PrinterDiscovery();
    const printers = await discovery.discover(3000);
    res.json({ success: true, printers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/camera', async (req, res) => {
  const boundary = 'frame';
  res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${boundary}`);
  res.write(`--${boundary}\r\n`);

  // Subscriber writes full frames
  const subscriber = (frameBuffer) => {
    try {
      res.write(`Content-Type: ${cameraContentType}\r\n`);
      res.write(`Content-Length: ${frameBuffer.length}\r\n\r\n`);
      res.write(frameBuffer);
      res.write(`\r\n--${boundary}\r\n`);
    } catch (err) {
      cameraSubscribers.delete(subscriber);
    }
  };

  cameraSubscribers.add(subscriber);

  // Send latest frame immediately if we have one
  if (latestFrame) {
    subscriber(latestFrame);
  }

  // Track IP and counters
  let cameraClientIP = 'unknown';
  try {
    cameraClientIP = resolveClientIP(req, req.socket);
    const userAgent = req.headers['user-agent'] || 'Unknown';
    userStats.addCameraClient(cameraClientIP, userAgent);
  } catch (_) {}
  updateUserStatsAndBroadcast();

  // Handle client disconnect
  const cleanup = () => {
    cameraSubscribers.delete(subscriber);
    userStats.removeCameraClient(cameraClientIP);
    updateUserStatsAndBroadcast();
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
});

// API endpoint to serve H.264 transcoded camera stream
// API endpoint to connect to a specific printer
app.post('/api/connect/:ip', express.json(), async (req, res) => {
  try {
    await connectToPrinter(req.params.ip);
    res.json({ success: true, message: 'Connected to printer' });
  } catch (err) {
    printerStatus.connected = false;
    res.status(500).json({ success: false, error: err.message });
  }
});

// Debug endpoint to trigger a controlled restart (local-only, flag-gated)
if (ENABLE_DEBUG_ENDPOINTS) {
  app.get('/api/debug/restart', (req, res) => {
    const clientIP = resolveClientIP(req, req.socket);
    if (!isLocalIP(clientIP)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const reason = 'Manual restart trigger via /api/debug/restart';
    broadcastToClients({ type: 'server_restarting', data: { reason } });
    res.json({ success: true, message: 'Restarting server now' });
    setTimeout(() => process.exit(1), 5000);
  });
}

// Admin endpoint - only accessible from local addresses
app.get('/api/admin', (req, res) => {
  const clientIP = resolveClientIP(req, req.socket);
  
  // Verify client is local
  if (!isLocalIP(clientIP) && clientIP !== '212.229.84.209') {
    console.warn(`Unauthorized admin access attempt from ${clientIP}`);
    return res.status(404).type('text/html').send('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET /api/admin</pre>\n</body>\n</html>\n');
  }

  const statsSnapshot = userStats.getSnapshot();
  const { webClients: webClientsList, cameraClients: cameraClientsList } = userStats.getClientLists();

  res.json({
    success: true,
    admin: {
      accessIP: clientIP,
      timestamp: new Date().toISOString(),
      webClients: {
        active: statsSnapshot.webClients,
        total: statsSnapshot.totalWebConnections,
        uniqueIPCount: webClientsList.length,
        clients: webClientsList
      },
      cameraClients: {
        active: statsSnapshot.cameraClients,
        total: statsSnapshot.totalCameraConnections,
        uniqueIPCount: cameraClientsList.length,
        clients: cameraClientsList
      },
      printer: {
        connected: printerStatus.connected,
        name: printerStatus.printerName,
        state: printerStatus.state,
        cameraAvailable: printerStatus.cameraAvailable,
        lastUpdate: printerStatus.lastUpdate
      }
    }
  });
});

// WebSocket connection handler for web clients
wss.on('connection', (ws, req) => {
  const ip = resolveClientIP(req, ws._socket);
  const userAgent = req.headers['user-agent'] || 'Unknown';
  console.log(`[WebSocket] Client connected: IP=${ip}`);
  webClients.add(ws);
  // Track IP and counters
  try {
    ws._clientIP = ip; // Store IP on WebSocket instance
    userStats.addWebClient(ip, userAgent);
  } catch (_) {}
  updateUserStatsAndBroadcast();

  // Initialize chat state for this connection (backwards compatible - no impact if not used)
  ws.chat = {
    nickname: null,
    verifiedHuman: false,
    challenge: null, // { a, b, answer, question }
    lastChatAt: 0,   // timestamp for rate limiting
  };

  // Send current status
  ws.send(JSON.stringify({ type: 'status', data: buildStatusPayload() }));

  // Handle incoming messages from client
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle chat-related messages (additive - existing clients won't send these)
      if (message.type === 'chat_init') {
        handleChatInit(ws, message);
      } else if (message.type === 'chat_verify') {
        handleChatVerify(ws, message);
      } else if (message.type === 'chat_message') {
        handleChatMessage(ws, message);
      }
      // Future: handle other message types here
      // Existing clients that don't send these types are unaffected
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  const cleanup = () => {
    console.log('Web client disconnected');
    webClients.delete(ws);
    userStats.removeWebClient(ip);
    updateUserStatsAndBroadcast();
  };

  ws.on('close', cleanup);
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    cleanup();
  });
});

/**
 * Handle chat_init message: user sets nickname and requests math challenge
 * Message format: { type: "chat_init", nickname: string }
 */
function handleChatInit(ws, message) {
  const nickname = (message.nickname || '').trim();
  
  // Validate nickname
  if (!nickname) {
    ws.send(JSON.stringify({
      type: 'chat_error',
      error: 'Nickname cannot be empty'
    }));
    return;
  }
  
  if (nickname.length > CHAT_NICKNAME_MAX_LENGTH) {
    ws.send(JSON.stringify({
      type: 'chat_error',
      error: `Nickname too long (max ${CHAT_NICKNAME_MAX_LENGTH} characters)`
    }));
    return;
  }
  
  // Store nickname and generate challenge
  ws.chat.nickname = nickname;
  ws.chat.challenge = generateMathChallenge();
  ws.chat.verifiedHuman = false;
  
  // Send challenge to client
  ws.send(JSON.stringify({
    type: 'chat_challenge',
    question: ws.chat.challenge.question
  }));
}

/**
 * Handle chat_verify message: user answers the math challenge
 * Message format: { type: "chat_verify", answer: number | string }
 */
function handleChatVerify(ws, message) {
  if (!ws.chat.challenge) {
    ws.send(JSON.stringify({
      type: 'chat_error',
      error: 'No active challenge. Please start chat first.'
    }));
    return;
  }
  
  const userAnswer = Number(message.answer);
  const correctAnswer = ws.chat.challenge.answer;
  
  if (userAnswer === correctAnswer) {
    // Verification successful
    ws.chat.verifiedHuman = true;
    ws.chat.challenge = null;
    ws.send(JSON.stringify({
      type: 'chat_verified',
      success: true
    }));
  } else {
    // Incorrect answer - generate new challenge
    ws.chat.challenge = generateMathChallenge();
    ws.send(JSON.stringify({
      type: 'chat_verified',
      success: false,
      error: 'Incorrect answer. Try again.'
    }));
    // Send new challenge
    ws.send(JSON.stringify({
      type: 'chat_challenge',
      question: ws.chat.challenge.question
    }));
  }
}

/**
 * Handle chat_message: user sends a chat message (after verification)
 * Message format: { type: "chat_message", text: string }
 */
function handleChatMessage(ws, message) {
  // Check if user is verified
  if (!ws.chat.verifiedHuman) {
    ws.send(JSON.stringify({
      type: 'chat_error',
      error: 'Please solve the challenge before chatting.'
    }));
    return;
  }
  
  // Rate limiting - check cooldown
  const now = Date.now();
  const timeSinceLastMessage = now - ws.chat.lastChatAt;
  if (timeSinceLastMessage < CHAT_MESSAGE_COOLDOWN_MS) {
    ws.send(JSON.stringify({
      type: 'chat_error',
      error: 'You are sending messages too quickly.'
    }));
    return;
  }
  
  // Validate and sanitize message text
  const text = (message.text || '').trim();
  if (!text) {
    return; // Silently ignore empty messages
  }
  
  // Enforce max length (reject if too long)
  if (text.length > CHAT_MESSAGE_MAX_LENGTH) {
    ws.send(JSON.stringify({
      type: 'chat_error',
      error: `Message too long (max ${CHAT_MESSAGE_MAX_LENGTH} characters)`
    }));
    return;
  }
  
  // Update last chat timestamp
  ws.chat.lastChatAt = now;
  
  // Construct chat message payload
  const chatPayload = {
    type: 'chat_message',
    nickname: ws.chat.nickname || 'Anon',
    text: text,
    timestamp: new Date().toISOString()
  };
  
  // Broadcast to all connected clients (no persistence - only in-memory)
  const data = JSON.stringify(chatPayload);
  webClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}



// --- Broadcast message to all connected web clients, throttled to once per second ---
let lastBroadcastTime = 0;
let pendingBroadcast = null;
function broadcastToClients(message) {
  const now = Date.now();
  const data = JSON.stringify(message);
  const minInterval = WS_UPDATE_INTERVAL; // milliseconds between broadcasts

  // High-priority messages bypass throttling
  if (message?.type === 'server_restarting') {
    webClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
    lastBroadcastTime = now;
    return;
  }

  if (now - lastBroadcastTime >= minInterval) {
    // Send immediately
    webClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
    lastBroadcastTime = now;
    pendingBroadcast = null;
  } else {
    // Schedule a broadcast if not already scheduled
    if (!pendingBroadcast) {
      const delay = minInterval - (now - lastBroadcastTime);
      pendingBroadcast = setTimeout(() => {
        webClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data);
          }
        });
        lastBroadcastTime = Date.now();
        pendingBroadcast = null;
      }, delay);
    }
  }
}

/**
 * Update printer status from SDCP data
 */
let isFirstUpdate = true;

function updatePrinterStatus(data) {
  if (!data) {
    // Printer is unreachable or offline
    reconnectSetupNeeded = true;
    printerStatus.connected = false;
    printerStatus.state = 'Disconnected';
    printerStatus.cameraAvailable = false;
    printerStatus.cameraError = 'Printer unreachable';
    printerStatus.lastUpdate = new Date().toISOString();
    printerStatus.customState = 0;
    printerStatus.machine_status = 'UNKNOWN';
    printerStatus.job_status = null;
    printerStatus.machine_status_code = null;
    printerStatus.job_status_code = null;
    broadcastToClients({ type: 'status', data: buildStatusPayload() });
    return;
  }

  // If we receive data after a disconnect, treat this as a reconnection
  if (!printerStatus.connected) {
    const reconnectName = data.Attributes?.Name || printerStatus.printerName;
    ensureReconnectSetup(reconnectName).catch((err) => {
      console.error('Failed to refresh printer state after reconnection:', err.message);
    });
  }

  // Log first status update for debugging
  if (isFirstUpdate) {
    console.log('\n=== First Status Update from Printer ===');
    console.log(JSON.stringify(data, null, 2));
    console.log('========================================\n');
    isFirstUpdate = false;
  }

  printerStatus.lastUpdate = new Date().toISOString();

  // Update based on available data
  if (data.Attributes) {
    printerStatus.printerName = data.Attributes.Name || printerStatus.printerName;
  }

  // Only update status fields if this is a real status payload (not a response/ack)
  if (data.Status) {
    // Parse and map separated states and consolidated status
    const { 
      status,
      status_code
    } = parseStatusPayload(data);

    // Update status object with new values
    const new_consolidated = status.consolidated;
    let use_new_status = new_consolidated;
    
    // Only update if new value is valid (not null/undefined/UNKNOWN)
    if (!new_consolidated || new_consolidated === 'UNKNOWN') {
      use_new_status = printerStatus.status.consolidated;
    }

    // Track transitions for logging/notifications
    if (printerStatus.status.consolidated !== use_new_status) {
      console.log(`[Status] Status changed: ${printerStatus.status.consolidated} -> ${use_new_status}`);
      printerStatus.prev_status = printerStatus.status.consolidated;
    }
    
    printerStatus.status = status;
    printerStatus.status_code = status_code;

    // For backward compatibility, keep .state as before
    printerStatus.state = status_code;
  }

  // Handle actual printer status structure
  if (data.Status) {
    const s = data.Status;
    // Print progress
    if (s.PrintInfo) {
      // Use printer-reported progress directly
      printerStatus.progress = s.PrintInfo.Progress || 0;
      printerStatus.currentFile = s.PrintInfo.Filename || '';
      // Convert ticks to seconds for time display
      printerStatus.printTime = Math.floor(s.PrintInfo.CurrentTicks || 0);
      const totalTicks = s.PrintInfo.TotalTicks || 0;
      printerStatus.remainingTime = Math.floor(totalTicks - printerStatus.printTime);
      // Use printer-reported layer info only
      printerStatus.layers = {
        total: s.PrintInfo.TotalLayer || 0,
        current: s.PrintInfo.CurrentLayer || 0
      };
      // Manual progress calculations removed; only using printer-reported progress and remainingTime
    }
    // Temperatures - using actual field names from printer
    if (s.TempOfHotbed !== undefined) {
      printerStatus.temperatures.bed.current = Math.round(s.TempOfHotbed);
    }
    if (s.TempTargetHotbed !== undefined) {
      printerStatus.temperatures.bed.target = Math.round(s.TempTargetHotbed);
    }
    if (s.TempOfNozzle !== undefined) {
      printerStatus.temperatures.nozzle.current = Math.round(s.TempOfNozzle);
    }
    if (s.TempTargetNozzle !== undefined) {
      printerStatus.temperatures.nozzle.target = Math.round(s.TempTargetNozzle);
    }
    if (s.TempOfBox !== undefined) {
      printerStatus.temperatures.enclosure.current = Math.round(s.TempOfBox);
    }
    if (s.TempTargetBox !== undefined) {
      printerStatus.temperatures.enclosure.target = Math.round(s.TempTargetBox);
    }
  }

  // Set custom state code
  setCustomState(data);

  // Broadcast update to all web clients
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
}

/**
 * Setup camera URL from printer response
 */
async function setupCameraURL() {
  if (!printerClient) return;

  try {
    const cameraResponse = await printerClient.requestCameraURL();
    const cameraData = cameraResponse?.Data?.Data;
    
    if (!cameraData) return;

    const { Ack: ack, VideoUrl: videoUrl } = cameraData;
    
    if (ack === 0 && videoUrl) {
      printerStatus.cameraAvailable = true;
      printerStatus.cameraError = null;
      // Store the URL locally for polling, but don't send to clients
      cameraStreamURL = `http://${videoUrl}`;
      console.log('Camera stream enabled');
    } else {
      const reason = CAMERA_ACK_ERRORS[ack] || `Unknown error code ${ack}`;
      console.warn('Camera not available:', reason);
      printerStatus.cameraAvailable = false;
      printerStatus.cameraError = reason;
      cameraStreamURL = null;
    }
  } catch (err) {
    console.warn('Failed to setup camera:', err.message);
    printerStatus.cameraAvailable = false;
    printerStatus.cameraError = err.message;
    cameraStreamURL = null;
  }
}

/**
 * Handle tasks that should run after a successful connection/reconnection:
 * - mark the printer as connected and update its name (if provided)
 * - refresh camera availability and restart streaming
 * - broadcast the latest status to all web clients
 */
async function onPrinterConnected(printerName = null) {
  printerStatus.connected = true;
  if (printerName) {
    printerStatus.printerName = printerName;
  }
  // Refresh camera availability on each (re)connect
  await setupCameraURL();
  await startCameraStreaming();
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
}

async function ensureReconnectSetup(printerName = null) {
  if (reconnectSetupInProgress) return;
  reconnectSetupInProgress = true;
  try {
    await onPrinterConnected(printerName);
    reconnectSetupNeeded = false;
  } catch (err) {
    reconnectSetupNeeded = true;
    throw err;
  } finally {
    reconnectSetupInProgress = false;
  }
}

/**
 * Connect to a printer at the given IP address
 */
async function connectToPrinter(printerIP, printerName = null) {
  // Disconnect existing connection
  if (printerClient) {
    printerClient.disconnect();
  }

  // Create new connection
  printerClient = new SDCPClient(printerIP);
  // Always re-attach status handler
  printerClient.onStatus(updatePrinterStatus);

  // Listen for disconnect/error events from SDCP client
  const handlePrinterLost = () => {
    setDisconnectedStatus();
  };
  printerClient.on('disconnect', handlePrinterLost);
  printerClient.on('error', handlePrinterLost);
  printerClient.on('reconnected', () => {
    if (!reconnectSetupNeeded) return;
    ensureReconnectSetup(printerName).catch((err) => {
      console.error('Failed to refresh printer state after reconnection:', err.message);
    });
  });

  // Try to connect and handle errors
  try {
    await printerClient.connect();
    printerClient.startStatusPolling(STATUS_POLL_INTERVAL);
    await ensureReconnectSetup(printerName);
  } catch (err) {
    // Printer is offline or unreachable: fully reset status and broadcast
    printerStatus = {
      ...defaultPrinterStatus,
      lastUpdate: new Date().toISOString()
    };
    broadcastToClients({ type: 'status', data: buildStatusPayload() });
    console.error('Failed to connect to printer:', err.message);
  }
}

/**
 * Start persistent camera stream from printer and relay to clients
 */
async function startCameraStreaming() {
  if (!cameraStreamURL) {
    printerStatus.cameraAvailable = false;
    printerStatus.cameraError = printerStatus.cameraError || 'Camera not available';
    broadcastToClients({ type: 'status', data: buildStatusPayload() });
    resetCameraFailureTracker();
    return;
  }

  try {
    const response = await fetch(cameraStreamURL);
    
    if (!response.ok) {
      throw new Error(`Camera error ${response.status}, ${response.statusText}`);
    }

    resetCameraFailureTracker();
    printerStatus.cameraError = null;

    // Extract boundary from multipart content-type header
    const contentType = response.headers.get('content-type');
    const boundaryMatch = contentType?.match(/boundary=([^\s;]+)/);
    const boundary = boundaryMatch ? boundaryMatch[1].replace(/^-+/, '') : 'frame';
    const boundaryBuffer = Buffer.from('--' + boundary);

    const reader = response.body.getReader();
    let buffer = Buffer.alloc(0);

    // Throttle frame delivery to respect MAX_FPS
    let lastFrameTime = 0;
    const minFrameInterval = 1000 / MAX_FPS;

    const processStream = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer = Buffer.concat([buffer, Buffer.from(value)]);

          // Look for boundary
          let boundaryIndex = buffer.indexOf(boundaryBuffer);
          while (boundaryIndex !== -1) {
            // Find the end of headers (double CRLF) after boundary
            const headersStart = boundaryIndex + boundaryBuffer.length;
            const headersEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headersStart);
            if (headersEnd === -1) break;

            const frameDataStart = headersEnd + 4; // Skip the \r\n\r\n

            // Find next boundary after this frame
            const nextBoundaryIndex = buffer.indexOf(boundaryBuffer, frameDataStart);
            if (nextBoundaryIndex === -1) break;

            // Extract frame data (trim trailing CRLF)
            let frameEnd = nextBoundaryIndex;
            if (buffer[frameEnd - 2] === 0x0D && buffer[frameEnd - 1] === 0x0A) {
              frameEnd -= 2;
            } else if (buffer[frameEnd - 1] === 0x0A) {
              frameEnd -= 1;
            }

            const frameBuffer = buffer.subarray(frameDataStart, frameEnd);

            if (frameBuffer.length > 0) {
              const now = Date.now();
              if (now - lastFrameTime >= minFrameInterval) {
                latestFrame = Buffer.from(frameBuffer);
                // Broadcast frame to all subscribers
                cameraSubscribers.forEach(subscriber => {
                  try {
                    subscriber(latestFrame);
                  } catch (err) {
                    // Subscriber cleanup handled in endpoint
                  }
                });
                lastFrameTime = now;
              }
            }

            // Remove processed part
            buffer = buffer.subarray(nextBoundaryIndex);
            boundaryIndex = buffer.indexOf(boundaryBuffer);
          }
        }
      } catch (err) {
        console.error('Camera stream error:', err.message);
        handleCameraStartFailure(err.message);
        // Retry after a delay
        setTimeout(() => {
          if (cameraStreamURL) {
            startCameraStreaming();
          }
        }, 5000);
      }
    };

    printerStream = processStream();
  } catch (err) {
    console.error('Failed to start camera stream:', err.message);
    printerStatus.cameraAvailable = false;
    printerStatus.cameraError = err.message;
    broadcastToClients({ type: 'status', data: buildStatusPayload() });
    handleCameraStartFailure(err.message);
    // Retry after a delay
    setTimeout(() => {
      if (cameraStreamURL) {
        startCameraStreaming();
      }
    }, 5000);
  }
}

/**
 * Stop camera streaming
 */
function stopCameraStreaming() {
  printerStream = null;
}


/**
 * Auto-discover and connect to printers, retrying each up to 3 times before moving to the next
 */
let autoConnectState = {
  printers: [],
  currentIdx: 0,
  failCount: 0
};

async function autoConnect() {
  try {
    // If no printers list or exhausted, rediscover
    if (!autoConnectState.printers.length || autoConnectState.currentIdx >= autoConnectState.printers.length) {
      console.log('Auto-discovering printers...');
      const discovery = new PrinterDiscovery();
      let printers = await discovery.discover(5000);
      // Filter out proxy servers
      printers = printers.filter(p => {
        // Proxy flag may be in Data.Attributes.Proxy or Attributes.Proxy
        const proxy = (p.Data && p.Data.Attributes && p.Data.Attributes.Proxy) || (p.Attributes && p.Attributes.Proxy);
        return !proxy;
      });
      if (printers.length === 0) {
        console.log('No eligible printers found on network. Retrying in 5 seconds...');
        autoConnectState = { printers: [], currentIdx: 0, failCount: 0 };
        setTimeout(autoConnect, 5000);
        return;
      }
      autoConnectState.printers = printers;
      autoConnectState.currentIdx = 0;
      autoConnectState.failCount = 0;
    }

    const printer = autoConnectState.printers[autoConnectState.currentIdx];
    console.log(`Trying to connect to printer ${autoConnectState.currentIdx + 1}/${autoConnectState.printers.length} at:`, printer.address);

    try {
      await connectToPrinter(
        printer.address,
        printer.Name || printer.Id || 'Elegoo Printer'
      );
      console.log('Connected to printer:', printerStatus.printerName);
      // Start camera streaming
      await startCameraStreaming();
      // Reset fail count on success
      autoConnectState.failCount = 0;
    } catch (err) {
      autoConnectState.failCount++;
      console.error(`Auto-connect failed (${autoConnectState.failCount}/3) for ${printer.address}:`, err.message);
      if (autoConnectState.failCount >= 3) {
        // Move to next printer
        autoConnectState.currentIdx++;
        autoConnectState.failCount = 0;
        if (autoConnectState.currentIdx >= autoConnectState.printers.length) {
          // All tried, rediscover after delay
          console.log('All printers failed, rediscovering in 5 seconds...');
          autoConnectState = { printers: [], currentIdx: 0, failCount: 0 };
          setTimeout(autoConnect, 5000);
          return;
        }
      }
      // Try again after delay (either retry or next printer)
      setTimeout(autoConnect, 5000);
      return;
    }
  } catch (err) {
    console.error('Auto-connect error:', err.message);
    setTimeout(autoConnect, 5000);
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`Elegoo Print Monitor server running on http://localhost:${PORT}`);
  
  // Auto-connect to printer on startup
  autoConnect();
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stopCameraStreaming();
  if (printerClient) {
    printerClient.disconnect();
  }
  server.close();
  process.exit(0);
});
