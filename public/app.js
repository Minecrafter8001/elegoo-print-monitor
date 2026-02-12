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

// Chat state
let chatVerified = false;
let chatNickname = "";
let selectedPrintId = "current"; // Track which print we're viewing
let currentPrintId = null; // Track the actual current print ID from server

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

// Helper function to get camera URL with cache busting
function getCameraUrl() {
    return '/api/camera?' + Date.now();
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
                
                // Update current print ID and load print history when it changes
                if (message.data.currentPrint) {
                    if (currentPrintId !== message.data.currentPrint.id) {
                        currentPrintId = message.data.currentPrint.id;
                        loadPrintHistory();
                    }
                    // Update comments if viewing current print
                    if (selectedPrintId === "current") {
                        displayComments(message.data.currentPrint.comments || []);
                    }
                }
            } else if (message.type === 'server_restarting') {
                showToast({
                    title: 'Server restarting…',
                    body: message.data?.reason || 'Server restarting',
                    hint: 'The page will reconnect automatically.',
                    duration: 5000
                });
            } else if (message.type === 'chat_challenge') {
                handleChatChallenge(message);
            } else if (message.type === 'chat_password_required') {
                handleChatPasswordRequired(message);
            } else if (message.type === 'chat_verified') {
                handleChatVerified(message);
            } else if (message.type === 'chat_message') {
                handleChatMessage(message);
            } else if (message.type === 'chat_error') {
                handleChatError(message);
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

    // ---------------- CAMERA LOGIC ----------------

    const cameraFeed = document.getElementById('cameraFeed');
    const cameraPlaceholder = document.getElementById('cameraPlaceholder');
    const cameraOverlay = document.getElementById('cameraOverlay');
    const cameraPlaceholderLabel = cameraPlaceholder.querySelector('span') || cameraPlaceholder;

    // Use job state for camera idle detection - check if either machine or job is idle
    lastPrinterState = jobState;

    if (printer.cameraAvailable) {
        const isIdle = jobState === "IDLE" || machineState === "IDLE";
        if (!cameraInitialized) {
            cameraFeed.src = getCameraUrl();
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
            
            // Add error handler to recover from broken streams
            cameraFeed.onerror = function() {
                console.warn('Camera feed error, attempting to reconnect...');
                if (!snapshotTaken && cameraInitialized) {
                    setTimeout(() => {
                        cameraFeed.src = getCameraUrl();
                    }, 1000);
                }
            };
        }
        if (isIdle && settings.pauseOnIdle) {
            cameraOverlay.style.display = 'flex';
        } else {
            // Only reset src if we have a snapshot taken or if it's not set to the stream
            if (snapshotTaken || !cameraFeed.src.includes('/api/camera')) {
                snapshotTaken = false;
                cameraFeed.src = getCameraUrl();
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

// ---------------- CHAT HANDLERS ----------------

function handleChatChallenge(message) {
    const chatSetup = document.getElementById('chat-setup');
    const chatChallenge = document.getElementById('chat-challenge');
    const chatPassword = document.getElementById('chat-password');
    const chatQuestion = document.getElementById('chat-question');
    const chatAnswer = document.getElementById('chat-answer');
    
    chatSetup.style.display = 'none';
    chatPassword.style.display = 'none';
    chatChallenge.style.display = 'flex';
    chatQuestion.textContent = message.question;
    chatAnswer.value = '';
    chatAnswer.focus();
}

function handleChatPasswordRequired(message) {
    const chatSetup = document.getElementById('chat-setup');
    const chatChallenge = document.getElementById('chat-challenge');
    const chatPassword = document.getElementById('chat-password');
    const chatPasswordInput = document.getElementById('chat-password-input');
    
    chatSetup.style.display = 'none';
    chatChallenge.style.display = 'none';
    chatPassword.style.display = 'flex';
    chatPasswordInput.value = '';
    chatPasswordInput.focus();
    
    // Show message if provided
    if (message.message) {
        showToast({
            title: 'Reserved Nickname',
            body: message.message,
            duration: 5000
        });
    }
}

function handleChatVerified(message) {
    if (message.success) {
        chatVerified = true;
        const chatChallenge = document.getElementById('chat-challenge');
        const chatPassword = document.getElementById('chat-password');
        const chatSetup = document.getElementById('chat-setup');
        const chatLoginSection = document.getElementById('chat-login-section');
        const chatInputArea = document.getElementById('chat-input-area');
        const chatInput = document.getElementById('chat-input');
        
        chatChallenge.style.display = 'none';
        chatPassword.style.display = 'none';
        chatSetup.style.display = 'none';
        chatLoginSection.style.display = 'none';
        chatInputArea.style.display = 'flex';
        chatInput.focus();
        
        // Show welcome message if provided
        if (message.message) {
            showToast({
                title: 'Verified!',
                body: message.message,
                duration: 3000
            });
        }
    } else {
        // Show error as a brief message, then restore the question
        const chatQuestion = document.getElementById('chat-question');
        const originalText = chatQuestion.textContent;
        chatQuestion.textContent = message.error || 'Incorrect answer';
        chatQuestion.style.color = '#e74c3c';
        setTimeout(() => {
            chatQuestion.textContent = originalText;
            chatQuestion.style.color = '#00d4ff';
        }, 2000);
    }
}

function handleChatMessage(message) {
    // Only update if it's for the print we're currently viewing
    if (selectedPrintId === "current") {
        // For current print, check if message is for the current print
        if (message.printId && message.printId !== currentPrintId) {
            return;
        }
    } else {
        // For historical prints, only show if it matches the selected print
        if (message.printId !== selectedPrintId) {
            return;
        }
    }
    
    // Add the new comment to the display
    if (message.comment) {
        addCommentToDisplay(message.comment);
    }
}

function addCommentToDisplay(comment) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    
    const header = document.createElement('div');
    header.className = 'chat-message-header';
    
    const nickname = document.createElement('span');
    nickname.className = 'chat-nickname';
    nickname.textContent = comment.nickname || 'Anonymous';
    
    const timestamp = document.createElement('span');
    timestamp.className = 'chat-timestamp';
    const time = new Date(comment.timestamp);
    timestamp.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    header.appendChild(nickname);
    header.appendChild(timestamp);
    
    const text = document.createElement('div');
    text.className = 'chat-text';
    text.textContent = comment.text;
    
    messageDiv.appendChild(header);
    messageDiv.appendChild(text);
    chatMessages.appendChild(messageDiv);
    
    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function displayComments(comments) {
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML = ''; // Clear existing
    
    if (!comments || comments.length === 0) {
        const placeholder = document.createElement('div');
        placeholder.className = 'chat-placeholder';
        placeholder.textContent = 'No comments yet. Be the first to comment!';
        chatMessages.appendChild(placeholder);
        return;
    }
    
    comments.forEach(comment => {
        addCommentToDisplay(comment);
    });
}

function handleChatError(message) {
    showToast({
        title: 'Chat Error',
        body: message.error || 'An error occurred',
        duration: 3000
    });
}

// Load print history from server
async function loadPrintHistory() {
    try {
        const response = await fetch('/api/prints?limit=10');
        const data = await response.json();
        
        if (data.success) {
            const printSelect = document.getElementById('print-select');
            
            // Clear existing options except "current"
            printSelect.innerHTML = '<option value="current">Current Print</option>';
            
            // Add historical prints
            data.prints.forEach(print => {
                const option = document.createElement('option');
                option.value = print.id;
                const date = new Date(print.startTime).toLocaleDateString();
                const status = print.status === 'completed' ? '✓' : '✗';
                option.textContent = `${status} ${print.filename} (${date})`;
                printSelect.appendChild(option);
            });
        }
    } catch (err) {
        console.error('Failed to load print history:', err);
    }
}

// Handle print selection change
async function handlePrintSelection(printId) {
    selectedPrintId = printId;
    
    if (printId === "current") {
        // Show current print comments from the latest status
        if (lastPayload && lastPayload.currentPrint) {
            displayComments(lastPayload.currentPrint.comments || []);
        } else {
            displayComments([]);
        }
    } else {
        // Load historical print comments
        try {
            const response = await fetch(`/api/prints/${printId}`);
            const data = await response.json();
            
            if (data.success && data.print) {
                displayComments(data.print.comments || []);
            }
        } catch (err) {
            console.error('Failed to load print comments:', err);
        }
    }
}

function initChatHandlers() {
    const chatStartBtn = document.getElementById('chat-start');
    const chatNicknameInput = document.getElementById('chat-nickname');
    const chatVerifyBtn = document.getElementById('chat-verify');
    const chatAnswerInput = document.getElementById('chat-answer');
    const chatPasswordVerifyBtn = document.getElementById('chat-password-verify');
    const chatPasswordInput = document.getElementById('chat-password-input');
    const chatSendBtn = document.getElementById('chat-send');
    const chatInputField = document.getElementById('chat-input');
    
    // Start chat button
    chatStartBtn.addEventListener('click', () => {
        const nickname = chatNicknameInput.value.trim();
        if (!nickname) {
            alert('Please enter a nickname');
            return;
        }
        chatNickname = nickname;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'chat_init', nickname }));
        }
    });
    
    // Enter key for nickname
    chatNicknameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            chatStartBtn.click();
        }
    });
    
    // Verify button (math challenge)
    chatVerifyBtn.addEventListener('click', () => {
        const answer = chatAnswerInput.value;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'chat_verify', answer }));
        }
    });
    
    // Enter key for answer
    chatAnswerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            chatVerifyBtn.click();
        }
    });
    
    // Password verify button
    chatPasswordVerifyBtn.addEventListener('click', () => {
        const password = chatPasswordInput.value;
        if (!password) {
            alert('Please enter a password');
            return;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'chat_verify', password }));
        }
    });
    
    // Enter key for password
    chatPasswordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            chatPasswordVerifyBtn.click();
        }
    });
    
    // Send message button
    chatSendBtn.addEventListener('click', () => {
        const text = chatInputField.value.trim();
        if (!text) return;
        if (!chatVerified) {
            alert('Please complete verification first');
            return;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            const payload = { type: 'chat_message', text };
            
            // Only add printId if we're viewing a specific historical print
            if (selectedPrintId !== "current") {
                payload.printId = selectedPrintId;
            }
            
            ws.send(JSON.stringify(payload));
            chatInputField.value = '';
        }
    });
    
    // Enter key to send message
    chatInputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            chatSendBtn.click();
        }
    });
    
    // Print selector change handler
    const printSelect = document.getElementById('print-select');
    printSelect.addEventListener('change', (e) => {
        handlePrintSelection(e.target.value);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Elegoo Print Monitor starting...');
    initPauseOnIdleButton();
    initChatHandlers();
    connectWebSocket();

    // Update UI every second to keep clock and other elements fresh
    setInterval(() => {
        updateUI(lastPayload);
    }, 1000);
    
    // Handle page visibility changes to recover camera feed when page wakes up
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && cameraInitialized && !snapshotTaken) {
            console.log('Page visible again, refreshing camera feed...');
            const cameraFeed = document.getElementById('cameraFeed');
            if (cameraFeed && cameraFeed.style.display !== 'none') {
                // Force reconnect camera stream
                cameraFeed.src = getCameraUrl();
            }
        }
    });
});
