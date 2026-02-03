#!/usr/bin/env python3
"""
MCP stdio interface for Claude Code integration.

This script exposes browser control tools via standard MCP stdio protocol.
It forwards requests to the HTTP server running on port 8765.
"""

import json
import urllib.request
import urllib.error
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# HTTP server base URL
HTTP_BASE = "http://127.0.0.1:8765"

server = Server("browser-use")


def http_get(path: str) -> dict:
    """Make HTTP GET request."""
    try:
        with urllib.request.urlopen(f"{HTTP_BASE}{path}", timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.URLError as e:
        return {"error": f"HTTP request failed: {e}"}


def http_post(path: str, data: dict = None) -> dict:
    """Make HTTP POST request."""
    try:
        body = json.dumps(data or {}).encode()
        req = urllib.request.Request(
            f"{HTTP_BASE}{path}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.URLError as e:
        return {"error": f"HTTP request failed: {e}"}


@server.list_tools()
async def list_tools():
    """List available browser control tools."""
    return [
        Tool(
            name="browser_get_ax_tree",
            description=(
                "Get the accessibility tree (AXTree) from the current browser tab. "
                "Returns a flat list of interactive elements with refId, role, name, and attributes. "
                "Use the refId to interact with elements using browser_execute_action."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        Tool(
            name="browser_execute_action",
            description=(
                "Execute an action on a browser element by its reference ID (refId from browser_get_ax_tree). "
                "Supported actions: click, type, focus, scroll, hover, clear. "
                "For 'type' action, provide the text parameter."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "action_type": {
                        "type": "string",
                        "enum": ["click", "type", "focus", "scroll", "hover", "clear"],
                        "description": "The action to perform"
                    },
                    "ref_id": {
                        "type": "integer",
                        "description": "The refId of the element from browser_get_ax_tree"
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to type (required for 'type' action)"
                    }
                },
                "required": ["action_type", "ref_id"]
            }
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Handle MCP tool calls."""
    if name == "browser_get_ax_tree":
        result = http_post("/tools/get_ax_tree")
        return [TextContent(type="text", text=json.dumps(result, indent=2, ensure_ascii=False))]
    
    elif name == "browser_execute_action":
        action_type = arguments.get("action_type")
        ref_id = arguments.get("ref_id")
        text = arguments.get("text")
        
        if not action_type or ref_id is None:
            return [TextContent(type="text", text=json.dumps({"error": "Missing action_type or ref_id"}))]
        
        result = http_post("/tools/execute_action", {
            "action_type": action_type,
            "ref_id": ref_id,
            "text": text
        })
        return [TextContent(type="text", text=json.dumps(result))]
    
    else:
        return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
