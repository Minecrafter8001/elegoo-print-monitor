// WebSocket connection to the server
let ws = null;
let reconnectInterval = null;
let cameraInitialized = false;
let snapshotTaken = false;
let lastPrinterState = null;
let frozenETA = null;
let frozenETAState = null;
let lastPayload = null;
let toastIdCounter = 0;

// Settings object
const defaultSettings = {
    pauseOnIdle: true
};

let settings = loadSettings();

// ---------------- TIME HELPERS ----------------

// Format duration in seconds to HH:MM:SS
function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '-';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Format Date to clock time
function formatClockTime(date) {
    if (!(date instanceof Date) || isNaN(date)) return '-';
    return date.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

// ---------------- SETTINGS ----------------

function loadSettings() {
    try {
        const stored = localStorage.getItem('Settings');
        if (stored) {
            return { ...defaultSettings, ...JSON.parse(stored) };
        }
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
    return { ...defaultSettings };
}

function saveSettings() {
    try {
        localStorage.setItem('Settings', JSON.stringify(settings));
    } catch (err) {
        console.error('Failed to save settings:', err);
    }
}

// ---------------- WEBSOCKET ----------------

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to server');
        clearReconnectInterval();
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'status') {
                lastPayload = message.data;
                updateUI(message.data);
            } else if (message.type === 'server_restarting') {
                showToast({
                    title: 'Server restarting…',
                    body: message.data?.reason || 'Server restarting',
                    hint: 'The page will reconnect automatically.',
                    duration: 5000
                });
            }
        } catch (err) {
            console.error('Failed to parse message:', err);
        }
    };

    ws.onclose = () => {
        console.log('Disconnected from server');
        scheduleReconnect();
    };
}

function scheduleReconnect() {
    if (reconnectInterval) return;
    reconnectInterval = setInterval(connectWebSocket, 5000);
}

function clearReconnectInterval() {
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }
}

// ---------------- UI UPDATE ----------------

function updateUI(payload) {
    const printer = payload?.printer || {};
    const users = payload?.users || {};
    const now = new Date();

    // Connection status
    const statusIndicator = document.getElementById('connectionStatus');
    const connectionText = document.getElementById('connectionText');
    const userCountText = document.getElementById('userCount');

    // Current time
    document.getElementById('currentTime').textContent = formatClockTime(now);

    if (printer.connected) {
        statusIndicator.classList.add('connected');
        connectionText.textContent = 'Connected';
    } else {
        statusIndicator.classList.remove('connected');
        connectionText.textContent = 'Disconnected';
    }

    const uniqueUsers = users.activeUniqueWebIPs || 0;
    userCountText.textContent = `${uniqueUsers} user${uniqueUsers === 1 ? '' : 's'} online`;

    // Printer info
    document.getElementById('printerName').textContent = printer.printerName || '-';



    // --- Status background color map ---
    const STATUS_BG = {
        IDLE: '#444',
        PRINTING: '#3498db',
        FILE_TRANSFERRING: '#888',
        LEVELING: '#20b2aa',
        STOPPING: '#e67e22',
        STOPPED: '#e74c3c',
        HOMING: '#3498db',
        RECOVERY: '#f39c12',
        PREHEATING: '#ff9800',
        PAUSED: '#e67e22',
        PAUSING: '#e67e22',
        COMPLETE: '#27ae60',
        ERROR: '#e74c3c',
        DROPPING: '#888',
        LIFTING: '#888',
        LOADING: '#888',
        FILE_CHECKING: '#888',
        UNKNOWN: '#888',
    };
    function getStatusBg(status) {
        return STATUS_BG[status] || STATUS_BG.UNKNOWN;
    }

    // --- Display machine state ---
    const machineState = printer.status?.machine?.state || 'UNKNOWN';
    const machineStateElement = document.getElementById('machineState');
    machineStateElement.textContent = machineState;
    machineStateElement.className = 'value state';
    machineStateElement.style.background = getStatusBg(machineState);
    machineStateElement.style.color = '#fff';

    // --- Display job state ---
    const jobState = printer.status?.job?.state || 'UNKNOWN';
    const jobStateElement = document.getElementById('jobState');
    jobStateElement.textContent = jobState;
    jobStateElement.className = 'value state';
    jobStateElement.style.background = getStatusBg(jobState);
    jobStateElement.style.color = '#fff';



    document.getElementById('currentFile').textContent = printer.currentFile || '-';

    // Last update (absolute clock time)
    document.getElementById('lastUpdate').textContent =
        printer.lastUpdate ? formatClockTime(new Date(printer.lastUpdate)) : '-';

    // Progress

    // Use new progress field if available, fallback to old
    const progress = printer.progress || printer.Progress || 0;
    
    document.getElementById('progressFill').style.width = `${progress.toFixed(0)}%`;
    document.getElementById('progressText').textContent = `${progress.toFixed(0)}%`;

    // Durations
    document.getElementById('printTime').textContent =
        formatDuration(printer.printTime);

    document.getElementById('remainingTime').textContent =
        formatDuration(printer.remainingTime);

    // ETA freeze logic based on job and machine state
    // Freeze ETA when progress is 100 and neither is PRINTING; unfreeze when either is PRINTING
    const etaElem = document.getElementById('ReportedETA');
    const machineStateUpper = (machineState || '').toUpperCase();
    const jobStateUpper = (jobState || '').toUpperCase();

    // Helper to get stable ETA based on last update time
    const getStableETA = () => {
        if (printer.remainingTime && Number.isFinite(printer.remainingTime)) {
            const baseTime = printer.lastUpdate ? new Date(printer.lastUpdate).getTime() : Date.now();
            return formatClockTime(new Date(baseTime + printer.remainingTime * 1000));
        }
        return '-';
    };

    if (machineStateUpper === 'PRINTING' || jobStateUpper === 'PRINTING') {
        // Unfreeze ETA when either is printing
        etaElem.textContent = getStableETA();
        frozenETA = null;
        frozenETAState = null;
    } else if (progress >= 100) {
        if (!frozenETA) {
            // Only freeze if not already frozen
            frozenETA = getStableETA();
            frozenETAState = jobStateUpper || machineStateUpper;
        }
        etaElem.textContent = frozenETA;
    } else if (frozenETA) {
        // Stay frozen while not printing and after 100%
        etaElem.textContent = frozenETA;
    } else {
        // Default ETA logic
        etaElem.textContent = getStableETA();
        frozenETA = null;
        frozenETAState = null;
    }

    // Layer info
    const layers = printer.layers || { current: 0, total: 0 };
    const completedLayers = layers.current || 0;
    const totalLayers = layers.total || 0;
    const remainingLayers = totalLayers > 0 ? Math.max(0, totalLayers - completedLayers) : 0;

    const completedLayersElem = document.getElementById('completedLayers');
    if (completedLayersElem) completedLayersElem.textContent = completedLayers;

    const totalLayersElem = document.getElementById('totalLayers');
    if (totalLayersElem) totalLayersElem.textContent = totalLayers;

    const remainingLayersElem = document.getElementById('remainingLayers');
    if (remainingLayersElem) remainingLayersElem.textContent = remainingLayers;

    // Temperatures
    const temps = printer.temperatures || { bed: {}, nozzle: {}, enclosure: {} };
    document.getElementById('nozzleTemp').textContent = Math.round(temps.nozzle.current || 0);
    document.getElementById('nozzleTarget').textContent = Math.round(temps.nozzle.target || 0);
    document.getElementById('bedTemp').textContent = Math.round(temps.bed.current || 0);
    document.getElementById('bedTarget').textContent = Math.round(temps.bed.target || 0);
    document.getElementById('enclosureTemp').textContent = Math.round(temps.enclosure.current || 0);
    document.getElementById('enclosureTarget').textContent = Math.round(temps.enclosure.target || 0);

    // ---------------- CAMERA LOGIC (UNCHANGED) ----------------

    const cameraFeed = document.getElementById('cameraFeed');
    const cameraPlaceholder = document.getElementById('cameraPlaceholder');
    const cameraOverlay = document.getElementById('cameraOverlay');
    const cameraPlaceholderLabel = cameraPlaceholder.querySelector('span') || cameraPlaceholder;

    // Use job state for camera idle detection - check if either machine or job is idle
    lastPrinterState = jobState;

    if (printer.cameraAvailable) {
        const isIdle = jobState === "IDLE" || machineState === "IDLE";
        if (!cameraInitialized) {
            cameraFeed.src = '/api/camera';
            cameraInitialized = true;

            cameraFeed.onload = function () {
                if (!snapshotTaken && isIdle && settings.pauseOnIdle) {
                    const canvas = document.createElement('canvas');
                    canvas.width = cameraFeed.naturalWidth;
                    canvas.height = cameraFeed.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(cameraFeed, 0, 0);
                    cameraFeed.src = canvas.toDataURL('image/jpeg');
                    snapshotTaken = true;
                    cameraFeed.onload = null;
                }
            };
        }
        if (isIdle && settings.pauseOnIdle) {
            cameraOverlay.style.display = 'flex';
        } else {
            // Only reset src if we have a snapshot taken or if it's not set to the stream
            if (snapshotTaken || !cameraFeed.src.includes('/api/camera')) {
                snapshotTaken = false;
                cameraFeed.src = '/api/camera';
            }
            cameraOverlay.style.display = 'none';
        }
        cameraFeed.style.display = 'block';
        cameraPlaceholder.style.display = 'none';
    } else {
        cameraFeed.style.display = 'none';
        cameraPlaceholder.style.display = 'flex';
        cameraOverlay.style.display = 'none';
        cameraInitialized = false;
        const message = printer.cameraError || 'No camera feed available';
        if (cameraPlaceholderLabel) {
            cameraPlaceholderLabel.textContent = message;
        }
    }
}

// ---------------- CAMERA TOGGLE ----------------

function toggleCameraStream() {
    const cameraFeed = document.getElementById('cameraFeed');
    const cameraOverlay = document.getElementById('cameraOverlay');
    const isIdle = (lastPrinterState || '').toLowerCase() === 'idle';

    if (!isIdle) return;

    if (settings.pauseOnIdle) {
        if (cameraFeed.style.display === 'block') {
            if (!snapshotTaken) {
                const canvas = document.createElement('canvas');
                canvas.width = cameraFeed.naturalWidth;
                canvas.height = cameraFeed.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(cameraFeed, 0, 0);
                cameraFeed.src = canvas.toDataURL('image/jpeg');
                snapshotTaken = true;
            }
        }
        cameraOverlay.style.display = 'flex';
    } else {
        snapshotTaken = false;
        if (cameraFeed.style.display === 'block') {
            cameraFeed.src = '/api/camera';
        }
        cameraOverlay.style.display = 'none';
    }
}

// ---------------- INIT ----------------

function initPauseOnIdleButton() {
    const btn = document.getElementById('pauseOnIdleBtn');

    if (settings.pauseOnIdle) {
        btn.classList.add('active');
    }

    btn.addEventListener('click', () => {
        settings.pauseOnIdle = !settings.pauseOnIdle;
        saveSettings();

        btn.classList.toggle('active', settings.pauseOnIdle);
        toggleCameraStream();
    });
}

function showToast({ title, body, hint, duration = 15000 }) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toastId = `toast-${++toastIdCounter}`;
    const card = document.createElement('div');
    card.className = 'toast-card';
    card.id = toastId;

    const close = document.createElement('div');
    close.className = 'toast-close';
    close.textContent = '×';
    close.onclick = () => dismissToast(card, container);

    const titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    titleEl.textContent = title || 'Notice';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'toast-body';
    bodyEl.textContent = body || '';

    const hintEl = document.createElement('div');
    hintEl.className = 'toast-hint';
    hintEl.textContent = hint || '';

    card.appendChild(close);
    card.appendChild(titleEl);
    if (body) card.appendChild(bodyEl);
    if (hint) card.appendChild(hintEl);

    container.appendChild(card);

    if (duration > 0) {
        setTimeout(() => dismissToast(card, container), duration);
    }
}

function dismissToast(card, container) {
    if (!card || !container || card.parentNode !== container) return;
    card.style.animation = 'toast-out 220ms ease-in forwards';
    setTimeout(() => {
        if (card.parentNode === container) {
            container.removeChild(card);
        }
    }, 220);
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Elegoo Print Monitor starting...');
    initPauseOnIdleButton();
    connectWebSocket();

    // Update UI every second to keep clock and other elements fresh
    setInterval(() => {
        updateUI(lastPayload);
    }, 1000);
});
