
const NATIVE_HOST_NAME = 'com.browser_use.mcp_host';

let nativePort: chrome.runtime.Port | null = null;

// Connect to Native Host
function connectNativeHost() {
    try {
        nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
        console.log('Connected to native host:', NATIVE_HOST_NAME);

        nativePort.onMessage.addListener((message) => {
            console.log('Received from native host:', message);
            handleNativeMessage(message);
        });

        nativePort.onDisconnect.addListener(() => {
            console.log('Disconnected from native host');
            if (chrome.runtime.lastError) {
                console.error('Native host error:', chrome.runtime.lastError.message);
            }
            nativePort = null;
            // Attempt reconnection after a delay
            setTimeout(connectNativeHost, 5000);
        });
    } catch (e) {
        console.error('Failed to connect to native host:', e);
        setTimeout(connectNativeHost, 5000);
    }
}

// Handle messages from Native Host
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
        console.error('Error handling native message:', e);
        sendToNativeHost({ id, error: String(e) });
    }
}

// Send message to Native Host
function sendToNativeHost(message: any) {
    if (nativePort) {
        console.log('Sending to native host:', message);
        nativePort.postMessage(message);
    } else {
        console.error('Native port not connected, cannot send:', message);
    }
}

// Handle extension action click (toggle sidebar)
chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_SIDEBAR" }).catch(err => {
            console.warn("Could not send message to tab (content script might not be loaded):", err);
        });
    }
});

// Connect to native host on extension load
connectNativeHost();
