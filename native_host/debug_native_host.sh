#!/bin/bash
#
# Debug script for Browser Use Native Host
# Run this to diagnose connection issues
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Browser Use Native Host Debugger${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Configuration
NATIVE_HOST_NAME="com.browser_use.mcp_host"
HTTP_PORT=8765
LOG_FILE="/tmp/browser_use_mcp.log"
DEBUG_LOG="/tmp/browser_use_host_debug.log"

# 1. Check Chrome Native Messaging Host manifest
echo -e "${YELLOW}[1] Checking Native Messaging Host manifest...${NC}"

CHROME_MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$NATIVE_HOST_NAME.json"
EDGE_MANIFEST="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/$NATIVE_HOST_NAME.json"

if [ -f "$CHROME_MANIFEST" ]; then
    echo -e "${GREEN}✓ Chrome manifest found${NC}"
    echo "  Path: $CHROME_MANIFEST"
    
    # Validate JSON and show path
    if python3 -c "import json; data=json.load(open('$CHROME_MANIFEST')); print(f\"  Host path: {data.get('path', 'NOT SET')}\")" 2>/dev/null; then
        # Check if path exists
        HOST_PATH=$(python3 -c "import json; print(json.load(open('$CHROME_MANIFEST'))['path'])")
        if [ -f "$HOST_PATH" ]; then
            echo -e "${GREEN}  ✓ Host script exists${NC}"
        else
            echo -e "${RED}  ✗ Host script not found: $HOST_PATH${NC}"
        fi
    else
        echo -e "${RED}  ✗ Invalid JSON in manifest${NC}"
    fi
else
    echo -e "${RED}✗ Chrome manifest not found${NC}"
    echo "  Run ./install_host.sh to install"
fi

echo ""

# 2. Check if HTTP server is running
echo -e "${YELLOW}[2] Checking HTTP server status...${NC}"

if curl -s "http://127.0.0.1:$HTTP_PORT/health" > /dev/null 2>&1; then
    HEALTH=$(curl -s "http://127.0.0.1:$HTTP_PORT/health")
    echo -e "${GREEN}✓ HTTP server is running on port $HTTP_PORT${NC}"
    echo "  Response: $HEALTH"
    
    # Get detailed status
    if curl -s "http://127.0.0.1:$HTTP_PORT/status" > /dev/null 2>&1; then
        echo ""
        echo -e "  ${BLUE}Detailed status:${NC}"
        curl -s "http://127.0.0.1:$HTTP_PORT/status" | python3 -m json.tool 2>/dev/null || curl -s "http://127.0.0.1:$HTTP_PORT/status"
    fi
else
    echo -e "${RED}✗ HTTP server not responding on port $HTTP_PORT${NC}"
fi

echo ""

# 3. Check port usage
echo -e "${YELLOW}[3] Checking port $HTTP_PORT usage...${NC}"

PORT_CHECK=$(lsof -i :$HTTP_PORT 2>/dev/null || true)
if [ -n "$PORT_CHECK" ]; then
    echo "$PORT_CHECK"
else
    echo "  No process using port $HTTP_PORT"
fi

echo ""

# 4. Check for running native host processes
echo -e "${YELLOW}[4] Checking for native host processes...${NC}"

MCP_PROCS=$(ps aux | grep -E "mcp_server|run_host" | grep -v grep || true)
if [ -n "$MCP_PROCS" ]; then
    echo "$MCP_PROCS"
else
    echo "  No native host processes found"
fi

echo ""

# 5. Show recent logs
echo -e "${YELLOW}[5] Recent MCP server logs...${NC}"

if [ -f "$LOG_FILE" ]; then
    echo -e "  ${BLUE}Last 15 lines from $LOG_FILE:${NC}"
    tail -n 15 "$LOG_FILE"
else
    echo "  Log file not found: $LOG_FILE"
fi

echo ""

if [ -f "$DEBUG_LOG" ]; then
    echo -e "  ${BLUE}Last 10 lines from $DEBUG_LOG:${NC}"
    tail -n 10 "$DEBUG_LOG"
fi

echo ""

# 6. Test AXTree retrieval
echo -e "${YELLOW}[6] Testing AXTree retrieval...${NC}"

if curl -s "http://127.0.0.1:$HTTP_PORT/health" > /dev/null 2>&1; then
    echo "  Sending GET_AX_TREE request..."
    RESULT=$(curl -s -X POST "http://127.0.0.1:$HTTP_PORT/tools/get_ax_tree" --max-time 5 2>&1 || echo "Request failed or timed out")
    
    if echo "$RESULT" | grep -q "success"; then
        echo -e "${GREEN}  ✓ AXTree retrieval working${NC}"
        # Show truncated result
        echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"  Got {len(str(d))} bytes of data\")" 2>/dev/null || echo "  $RESULT"
    elif echo "$RESULT" | grep -q "error"; then
        echo -e "${RED}  ✗ AXTree retrieval failed${NC}"
        echo "  $RESULT"
    else
        echo -e "${YELLOW}  ? Unexpected response${NC}"
        echo "  $RESULT"
    fi
else
    echo -e "${RED}  ✗ Cannot test - HTTP server not running${NC}"
fi

echo ""

# 7. Summary and suggestions
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Troubleshooting Tips${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "1. If HTTP server not responding:"
echo "   - Reload the Chrome extension"
echo "   - Check if Chrome is running"
echo "   - Run: ./install_host.sh"
echo ""
echo "2. If Native Messaging not connected:"
echo "   - Check extension ID in manifest matches loaded extension"
echo "   - Look at Chrome DevTools > Extensions > Service Worker console"
echo "   - Check logs: tail -f $LOG_FILE"
echo ""
echo "3. To manually start HTTP server (for testing):"
echo "   cd native_host && uv run python mcp_server.py --http-only"
echo ""
echo "4. To watch logs in real-time:"
echo "   tail -f $LOG_FILE"
echo ""
