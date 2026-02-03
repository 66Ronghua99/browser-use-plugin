#!/bin/bash
#
# Install Browser Use Native Messaging Host for Chrome/Edge on macOS
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_NAME="com.browser_use.mcp_host"
MANIFEST_FILE="$SCRIPT_DIR/$HOST_NAME.json"
RUN_SCRIPT="$SCRIPT_DIR/run_host.sh"

echo "Installing Browser Use Native Messaging Host..."

# Make scripts executable
chmod +x "$RUN_SCRIPT"
chmod +x "$SCRIPT_DIR/mcp_server.py"

# Update path in manifest
TEMP_MANIFEST=$(mktemp)
sed "s|\"path\":.*|\"path\": \"$RUN_SCRIPT\",|" "$MANIFEST_FILE" > "$TEMP_MANIFEST"

# Install for Chrome
CHROME_NATIVE_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
if [ -d "$HOME/Library/Application Support/Google/Chrome" ]; then
    mkdir -p "$CHROME_NATIVE_DIR"
    cp "$TEMP_MANIFEST" "$CHROME_NATIVE_DIR/$HOST_NAME.json"
    echo "✓ Installed for Chrome"
fi

# Install for Edge
EDGE_NATIVE_DIR="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
if [ -d "$HOME/Library/Application Support/Microsoft Edge" ]; then
    mkdir -p "$EDGE_NATIVE_DIR"
    cp "$TEMP_MANIFEST" "$EDGE_NATIVE_DIR/$HOST_NAME.json"
    echo "✓ Installed for Edge"
fi

rm "$TEMP_MANIFEST"

echo ""
echo "Done! Now reload the extension in Chrome and check the console for connection status."
echo ""
echo "HTTP MCP server will be available at: http://127.0.0.1:8765"
echo "  GET  /health - Check server status"
echo "  GET  /tools  - List available tools"  
echo "  POST /tools/get_ax_tree - Get AXTree from current tab"
echo "  POST /tools/execute_action - Execute action on element"
