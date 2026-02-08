/**
 * Background Service Worker for Browser Use Plugin
 * 
 * Handles Native Messaging communication with the MCP server.
 * Includes heartbeat mechanism and robust reconnection logic.
 */

const NATIVE_HOST_NAME = 'com.browser_use.mcp_host';

// Connection state
let nativePort: chrome.runtime.Port | null = null;
let connectionAttempts = 0;
let isConnecting = false;
let lastHeartbeatTime = 0;

// Configuration
const CONFIG = {
    INITIAL_RETRY_DELAY: 1000,      // 1 second
    MAX_RETRY_DELAY: 30000,         // 30 seconds max
    HEARTBEAT_INTERVAL: 25000,      // 25 seconds (before 30s Service Worker timeout)
    MAX_CONNECTION_ATTEMPTS: 10,
};

/**
 * Log with timestamp for debugging
 */
function log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;

    if (data) {
        console[level.toLowerCase() as 'info' | 'warn' | 'error' | 'debug'](`${prefix} ${message}`, data);
    } else {
        console[level.toLowerCase() as 'info' | 'warn' | 'error' | 'debug'](`${prefix} ${message}`);
    }
}

/**
 * Calculate retry delay with exponential backoff
 */
function getRetryDelay(): number {
    const delay = Math.min(
        CONFIG.INITIAL_RETRY_DELAY * Math.pow(2, connectionAttempts),
        CONFIG.MAX_RETRY_DELAY
    );
    return delay;
}

/**
 * Connect to Native Host with robust error handling
 */
function connectNativeHost() {
    if (isConnecting) {
        log('DEBUG', 'Connection already in progress, skipping');
        return;
    }

    if (nativePort) {
        log('DEBUG', 'Already connected, skipping');
        return;
    }

    isConnecting = true;
    connectionAttempts++;

    log('INFO', `Attempting to connect to native host (attempt ${connectionAttempts}/${CONFIG.MAX_CONNECTION_ATTEMPTS})`);

    try {
        nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

        nativePort.onMessage.addListener((message) => {
            log('DEBUG', 'Received from native host:', message);

            // Handle heartbeat response
            if (message.action === 'PONG') {
                lastHeartbeatTime = Date.now();
                log('DEBUG', 'Heartbeat acknowledged');
                return;
            }

            handleNativeMessage(message);
        });

        nativePort.onDisconnect.addListener(() => {
            const error = chrome.runtime.lastError?.message || 'Unknown error';
            log('WARN', `Disconnected from native host: ${error}`);

            nativePort = null;
            isConnecting = false;

            // Schedule reconnection with backoff
            if (connectionAttempts < CONFIG.MAX_CONNECTION_ATTEMPTS) {
                const delay = getRetryDelay();
                log('INFO', `Scheduling reconnection in ${delay}ms`);
                setTimeout(connectNativeHost, delay);
            } else {
                log('ERROR', `Max connection attempts (${CONFIG.MAX_CONNECTION_ATTEMPTS}) reached. Use chrome.runtime.reload() to retry.`);
            }
        });

        // Connection successful
        log('INFO', 'Successfully connected to native host');
        connectionAttempts = 0; // Reset on successful connection
        isConnecting = false;
        lastHeartbeatTime = Date.now();

        // Start heartbeat
        startHeartbeat();

    } catch (e) {
        log('ERROR', 'Failed to connect to native host:', e);
        nativePort = null;
        isConnecting = false;

        const delay = getRetryDelay();
        if (connectionAttempts < CONFIG.MAX_CONNECTION_ATTEMPTS) {
            log('INFO', `Scheduling reconnection in ${delay}ms`);
            setTimeout(connectNativeHost, delay);
        }
    }
}

/**
 * Send heartbeat to keep connection alive and Worker active
 */
function sendHeartbeat() {
    if (nativePort) {
        try {
            nativePort.postMessage({ action: 'PING', timestamp: Date.now() });
            log('DEBUG', 'Heartbeat sent');
        } catch (e) {
            log('WARN', 'Failed to send heartbeat:', e);
        }
    } else {
        log('DEBUG', 'No connection for heartbeat, attempting reconnect');
        connectNativeHost();
    }
}

/**
 * Start heartbeat interval using chrome.alarms for reliability
 */
function startHeartbeat() {
    // Use setInterval as fallback - will work while Service Worker is active
    setInterval(() => {
        if (nativePort) {
            sendHeartbeat();
        }
    }, CONFIG.HEARTBEAT_INTERVAL);

    // Also register an alarm to wake up the Service Worker periodically
    chrome.alarms.create('heartbeat', {
        periodInMinutes: 0.5 // Every 30 seconds
    });

    log('INFO', 'Heartbeat mechanism started');
}

// Handle alarm for Service Worker wake-up
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'heartbeat') {
        log('DEBUG', 'Alarm triggered, checking connection');
        if (!nativePort) {
            connectionAttempts = 0; // Reset for fresh alarm-triggered reconnect
            connectNativeHost();
        } else {
            sendHeartbeat();
        }
    }
});

/**
 * Handle messages from Native Host
 */
async function handleNativeMessage(message: { id: string; action: string; params?: any }) {
    const { id, action, params } = message;

    try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
            sendToNativeHost({ id, error: 'No active tab found' });
            return;
        }

        if (action === 'GET_AX_TREE') {
            // Request AXTree from content script
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_AX_TREE' });
            sendToNativeHost({ id, result: response });
        } else if (action === 'EXECUTE_ACTION') {
            // Forward action to content script
            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'EXECUTE_ACTION',
                params: params
            });
            sendToNativeHost({ id, result: response });
        } else {
            sendToNativeHost({ id, error: `Unknown action: ${action}` });
        }
    } catch (e) {
        log('ERROR', 'Error handling native message:', e);
        sendToNativeHost({ id, error: String(e) });
    }
}

/**
 * Send message to Native Host with error handling
 */
function sendToNativeHost(message: any) {
    if (nativePort) {
        try {
            log('DEBUG', 'Sending to native host:', message);
            nativePort.postMessage(message);
        } catch (e) {
            log('ERROR', 'Failed to send to native host:', e);
        }
    } else {
        log('ERROR', 'Native port not connected, cannot send message');
    }
}

// Handle extension action click (toggle sidebar)
chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_SIDEBAR" }).catch(err => {
            log('WARN', 'Could not send message to tab:', err);
        });
    }
});

// Expose connection status for debugging
(globalThis as any).getNativeHostStatus = () => ({
    connected: !!nativePort,
    connectionAttempts,
    lastHeartbeatTime: lastHeartbeatTime ? new Date(lastHeartbeatTime).toISOString() : null,
    isConnecting
});

// Connect to native host on extension load
log('INFO', 'Background script loaded, initiating connection');
connectNativeHost();
