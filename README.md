# Browser Use Plugin (AXTree Inspector)

A general browser control plugin designed to expose a semantic Accessibility Tree (AXTree) to Large Language Models (LLMs) and enable browser automation on your **mostly used local browser**.

## Function

This tool bridges the gap between LLMs and web browsers by:

1. **Simplifying the DOM**: Converts complex HTML into a "dense" Accessibility Tree (AXTree) focused on interactive elements and semantic content. (similar to agent-browser)
2. **Exposing an API**: Provides an HTTP/MCP interface for LLMs to query the page state (`get_ax_tree`) and perform actions (`click`, `type`, `scroll`, etc.).
3. **Bypassing Security Restrictions**: Uses Chrome Native Messaging to allow external processes (like an MCP client or Python script) to communicate securely with the browser extension.

## Architecture & Logic

The system consists of three main components:

1. **Browser Extension** (`src/`, `manifest.json`):

   - Injects content scripts to analyze the DOM.
   - Generates the AXTree using logic in `src/axtree.ts`.
   - Communicates with the Native Host.
2. **Native Host** (`native_host/mcp_server.py`):

   - A Python script registered as a Native Messaging Host in Chrome/Edge.
   - It is launched automatically by the browser when the extension connects.
   - Handles the bi-directional communication with the browser extension via standard input/output (stdio).
3. **MCP / HTTP Server**:

   - The Native Host script *also* starts a local HTTP server (default port `8765`).
   - This server accepts HTTP requests from external tools (like an AI agent).
   - It relays these requests to the browser extension and returns the response.

**Data Flow:**
`Agent Client/User` -> `HTTP Request (localhost:8765)/MCP` -> `Native Host (Python)` -> `Native Messaging (stdio)` -> `Browser Extension` -> `Web Page`

## Installation

### Prerequisites

- Node.js & npm (for building the extension)
- Python 3 (for the native host)
- Google Chrome or Microsoft Edge

### 1. Build the Extension

```bash
# Install dependencies
npm install

# Build the extension (creates the 'dist' folder)
npm run build
```

### 2. Install the Native Host

Run the installation script to register the native messaging host with your browser.

```bash
cd native_host
chmod +x install_host.sh
./install_host.sh
```

*Creates a manifest file in your browser's `NativeMessagingHosts` directory pointing to `native_host/run_host.sh`.*

### 3. Load into Browser

1. Open Chrome/Edge and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in top-right).
3. Click **Load unpacked**.
4. Select the `root` directory
5. **Reload the extension** if you make changes. Note the ID of the extension might change if you remove/add it, but the native host relies on the allowed origins in `native_host/com.browser_use.mcp_host.json`.

## Usage

Once installed and the browser is open:

1. The Native Host (and HTTP server) starts automatically when the extension initializes (or when a connection is made, usually on browser startup or extension reload).
2. The HTTP server listens on `http://127.0.0.1:8765`.

### API Endpoints

- **Check Status**:
  `GET /health` - Returns server status and native connection state.
- **Get Accessibility Tree**:
  `POST /tools/get_ax_tree`
  Returns the full semantic tree of the current active tab.
- **Get Compact Tree** (Recommended for LLMs):
  `POST /tools/get_ax_tree_compact`
  Returns a flatten list of interactive elements (saves tokens).
- **Execute Action**:
  `POST /tools/execute_action`
  Body:

  ```json
  {
    "action_type": "click",
    "ref_id": 123
  }
  ```
  *`ref_id` corresponds to the ID returned in the AXTree.*
- **Wait for Element**:
  `POST /tools/wait_for_element`
  Body: `{"role": "button", "name": "Submit"}`

## TODO

- [ ] Add support for other browser control tools, such as tab operations, etc.
- [ ] Test support for other browsers (Firefox, Safari, etc.)
- [ ] Add support for other OS (Windows, Linux, etc.)


