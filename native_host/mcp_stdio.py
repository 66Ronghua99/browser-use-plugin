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
            name="browser_get_ax_tree_compact",
            description=(
                "🚀 RECOMMENDED: Get a compact list of interactive elements from the browser. "
                "Returns flat array: [[refId, role, name], ...]. "
                "Uses ~85% fewer tokens than browser_get_ax_tree. "
                "Use refId to interact with elements via browser_execute_action."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        Tool(
            name="browser_get_ax_tree",
            description=(
                "Get the full accessibility tree from the current browser tab. "
                "Returns tree structure with refId, role, name, tagName, attributes. "
                "⚠️ Uses more tokens - prefer browser_get_ax_tree_compact for efficiency."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        Tool(
            name="browser_get_page_text",
            description=(
                "Extract readable text content from the current page. "
                "Useful for reading email body, article content, etc. "
                "Automatically finds main content areas (Gmail email body, articles, etc.)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "max_length": {
                        "type": "integer",
                        "description": "Maximum length of text to return (default: 8000)",
                        "default": 8000
                    },
                    "selector": {
                        "type": "string",
                        "description": "Optional CSS selector to limit text extraction scope"
                    }
                },
                "required": []
            }
        ),
        Tool(
            name="browser_execute_action",
            description=(
                "Execute an action on a browser element or page. "
                "Element actions (require ref_id): click, type, focus, scroll, hover, clear. "
                "Global actions (no ref_id needed): keypress, scroll_page. "
                "For 'type' action, provide the text parameter. "
                "For 'keypress', use text like 'enter', 'escape', 'arrowdown'. "
                "For 'scroll_page', use text like 'up', 'down', 'top', 'bottom'."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "action_type": {
                        "type": "string",
                        "enum": ["click", "type", "focus", "scroll", "hover", "clear", "keypress", "scroll_page"],
                        "description": "The action to perform"
                    },
                    "ref_id": {
                        "type": "integer",
                        "description": "The refId of the element (not required for keypress/scroll_page)"
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to type, key to press, or scroll direction"
                    }
                },
                "required": ["action_type"]
            }
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Handle MCP tool calls."""
    if name == "browser_get_ax_tree_compact":
        result = http_post("/tools/get_ax_tree_compact")
        return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]
    
    elif name == "browser_get_ax_tree":
        result = http_post("/tools/get_ax_tree")
        return [TextContent(type="text", text=json.dumps(result, indent=2, ensure_ascii=False))]
    
    elif name == "browser_get_page_text":
        max_length = arguments.get("max_length", 8000)
        selector = arguments.get("selector")
        
        result = http_post("/tools/get_page_text", {
            "max_length": max_length,
            "selector": selector
        })
        return [TextContent(type="text", text=json.dumps(result, indent=2, ensure_ascii=False))]
    
    elif name == "browser_execute_action":
        action_type = arguments.get("action_type")
        ref_id = arguments.get("ref_id")
        text = arguments.get("text")
        
        # Global actions don't require ref_id
        global_actions = ["keypress", "scroll_page"]
        
        if not action_type:
            return [TextContent(type="text", text=json.dumps({"error": "Missing action_type"}))]
        
        if action_type not in global_actions and ref_id is None:
            return [TextContent(type="text", text=json.dumps({"error": "Missing ref_id for this action_type"}))]
        
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
