#!/bin/bash
#
# Install Browser Use Native Messaging Host for Chrome/Edge on macOS
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_NAME="com.browser_use.mcp_host"
TEMPLATE_MANIFEST="$SCRIPT_DIR/$HOST_NAME.json.template"
TEMPLATE_RUN="$SCRIPT_DIR/run_host_template.sh"

TARGET_MANIFEST="$SCRIPT_DIR/$HOST_NAME.json"
TARGET_RUN="$SCRIPT_DIR/run_host.sh"

echo "Installing Browser Use Native Messaging Host..."

# 1. Detect uv path
UV_BIN=$(which uv || echo "")
if [ -z "$UV_BIN" ]; then
    # Fallback to check common locations if not in PATH
    if [ -f "$HOME/.cargo/bin/uv" ]; then
        UV_BIN="$HOME/.cargo/bin/uv"
    elif [ -f "$HOME/anaconda3/bin/uv" ]; then
        UV_BIN="$HOME/anaconda3/bin/uv"
    elif [ -f "/opt/homebrew/bin/uv" ]; then
        UV_BIN="/opt/homebrew/bin/uv"
    else
        echo "Error: 'uv' not found. Please install uv first."
        exit 1
    fi
fi
echo "✓ Found uv at: $UV_BIN"

# 2. Generate run_host.sh from template
sed "s|{{UV_BIN_PLACEHOLDER}}|$UV_BIN|g" "$TEMPLATE_RUN" > "$TARGET_RUN"
chmod +x "$TARGET_RUN"
chmod +x "$SCRIPT_DIR/mcp_server.py"
echo "✓ Generated run_host.sh"

# 3. Detect Extension ID (Optional - default to the one in template or ask user)
# For now we'll use a hardcoded default but in future we could parse it from somewhere
EXTENSION_ID="ljajelogmlifllgeaikflpmkfonlgaba" 

# 4. Generate manifest from template
sed "s|{{HOST_PATH_PLACEHOLDER}}|$TARGET_RUN|g" "$TEMPLATE_MANIFEST" | \
sed "s|{{EXTENSION_ID_PLACEHOLDER}}|$EXTENSION_ID|g" > "$TARGET_MANIFEST"
echo "✓ Generated manifest"

# 5. Install Manifest to Browser Locations
install_manifest() {
    local browser_name=$1
    local dest_dir=$2
    
    if [ -d "$(dirname "$dest_dir")" ]; then
        mkdir -p "$dest_dir"
        cp "$TARGET_MANIFEST" "$dest_dir/$HOST_NAME.json"
        echo "✓ Installed for $browser_name"
    fi
}

# Chrome
install_manifest "Chrome" "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

# Edge
install_manifest "Edge" "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"

# Brave (optional, common for devs)
install_manifest "Brave" "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"


echo ""
echo "Done! Now reload the extension in your browser and check the console."
echo ""
echo "HTTP MCP server will be available at: http://127.0.0.1:8765"
