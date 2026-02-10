#!/bin/bash
#
# Wrapper script for Native Messaging Host.
# Chrome launches this with minimal PATH, so we need to specify uv location explicitly.
#

LOG="/tmp/browser_use_host_debug.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# uv is installed via anaconda or pip
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

echo "=== Native Host Started ===" >> "$LOG"
echo "Time: $(date)" >> "$LOG"
echo "Using uv: $UV_BIN" >> "$LOG"

cd "$SCRIPT_DIR"

if [ ! -x "$UV_BIN" ]; then
    echo "ERROR: uv not found at $UV_BIN" >> "$LOG"
    exit 1
fi

echo "Running: $UV_BIN run python mcp_server.py" >> "$LOG"
exec "$UV_BIN" run python mcp_server.py 2>> "$LOG"
