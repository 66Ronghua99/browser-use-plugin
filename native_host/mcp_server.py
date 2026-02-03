#!/usr/bin/env python3
"""
Browser Use MCP Server with Native Messaging Bridge.

Architecture:
- HTTP/SSE interface for MCP clients (Claude Code)
- Native Messaging stdio for Chrome Extension communication

The Chrome Extension connects via connectNative(), this script is launched as Native Host.
When running as Native Host, it also starts an HTTP server for MCP clients.
"""

import sys
import json
import struct
import threading
import asyncio
import logging
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional, Callable
import time

# Configure logging
LOG_FILE = '/tmp/browser_use_mcp.log'
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stderr)
    ]
)
logger = logging.getLogger(__name__)


class NativeMessaging:
    """Handles Chrome Native Messaging protocol."""
    
    def __init__(self):
        self.lock = threading.Lock()
        self.pending_requests = {}
        self.request_counter = 0
        self.running = False
        self.reader_thread = None
        self.on_extension_message: Optional[Callable] = None
    
    def read_message(self):
        """Read a message from stdin using Native Messaging protocol."""
        try:
            # Read 4-byte length prefix (little-endian unsigned int)
            # This should block until data is available
            length_bytes = sys.stdin.buffer.read(4)
            if not length_bytes:
                logger.debug("stdin closed (read returned empty)")
                return None
            if len(length_bytes) < 4:
                logger.warning(f"Short read on length: got {len(length_bytes)} bytes")
                return None
            
            length = struct.unpack('<I', length_bytes)[0]
            logger.debug(f"Reading message of {length} bytes")
            
            if length > 1024 * 1024:
                logger.error(f"Message too large: {length}")
                return None
            
            if length == 0:
                return {}
            
            # Read the JSON message
            message_bytes = sys.stdin.buffer.read(length)
            if len(message_bytes) < length:
                logger.warning(f"Short read: expected {length}, got {len(message_bytes)}")
                return None
            
            message = json.loads(message_bytes.decode('utf-8'))
            logger.info(f"Received from extension: {message}")
            return message
        except Exception as e:
            logger.exception(f"Error reading message: {e}")
            return None
    
    def write_message(self, message):
        """Write a message to stdout using Native Messaging protocol."""
        with self.lock:
            try:
                message_bytes = json.dumps(message).encode('utf-8')
                sys.stdout.buffer.write(struct.pack('<I', len(message_bytes)))
                sys.stdout.buffer.write(message_bytes)
                sys.stdout.buffer.flush()
                logger.debug(f"Sent to extension: {message}")
            except Exception as e:
                logger.exception(f"Error writing: {e}")
    
    def reader_loop(self):
        """Background thread reading from extension."""
        logger.info("Reader loop started, waiting for messages from extension...")
        while self.running:
            message = self.read_message()
            if message is None:
                # stdin closed means Chrome terminated the connection
                logger.warning("Connection to extension lost, stopping reader")
                self.running = False
                break
            
            logger.debug(f"Processing message: {message}")
            
            # Check if this is a response to a pending request
            msg_id = message.get('id')
            if msg_id and msg_id in self.pending_requests:
                self.pending_requests[msg_id]['response'] = message
                self.pending_requests[msg_id]['event'].set()
            elif self.on_extension_message:
                self.on_extension_message(message)
    
    def start(self):
        """Start the reader thread."""
        self.running = True
        self.reader_thread = threading.Thread(target=self.reader_loop, daemon=True)
        self.reader_thread.start()
        logger.info("Native Messaging reader started")
    
    def stop(self):
        """Stop the reader thread."""
        self.running = False
    
    def send_command(self, action: str, params: dict = None, timeout: float = 30.0):
        """Send command to extension and wait for response."""
        with self.lock:
            self.request_counter += 1
            msg_id = str(self.request_counter)
        
        event = threading.Event()
        self.pending_requests[msg_id] = {'event': event, 'response': None}
        
        try:
            self.write_message({
                'id': msg_id,
                'action': action,
                'params': params or {}
            })
            
            if event.wait(timeout):
                return self.pending_requests[msg_id]['response']
            else:
                return {'error': 'Timeout waiting for extension response'}
        finally:
            del self.pending_requests[msg_id]


# Global native messaging instance
native = NativeMessaging()


class MCPHandler(BaseHTTPRequestHandler):
    """HTTP handler for MCP requests."""
    
    def log_message(self, format, *args):
        logger.info(f"HTTP: {format % args}")
    
    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
    
    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_GET(self):
        """List available tools."""
        if self.path == '/tools':
            self.send_json({
                'tools': [
                    {
                        'name': 'get_ax_tree',
                        'description': 'Get accessibility tree from current browser tab',
                        'parameters': {}
                    },
                    {
                        'name': 'execute_action', 
                        'description': 'Execute action on element by refId',
                        'parameters': {
                            'action_type': 'click|type|focus|scroll|hover|clear',
                            'ref_id': 'integer',
                            'text': 'string (for type action)'
                        }
                    }
                ]
            })
        elif self.path == '/health':
            self.send_json({'status': 'ok', 'native_connected': native.running})
        else:
            self.send_json({'error': 'Not found'}, 404)
    
    def do_POST(self):
        """Execute tool calls."""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_json({'error': 'Invalid JSON'}, 400)
            return
        
        if self.path == '/tools/get_ax_tree':
            response = native.send_command('GET_AX_TREE')
            self.send_json(response)
        
        elif self.path == '/tools/execute_action':
            action_type = data.get('action_type')
            ref_id = data.get('ref_id')
            text = data.get('text')
            
            if not action_type or ref_id is None:
                self.send_json({'error': 'Missing action_type or ref_id'}, 400)
                return
            
            response = native.send_command('EXECUTE_ACTION', {
                'type': action_type,
                'refId': ref_id,
                'text': text
            })
            self.send_json(response)
        
        else:
            self.send_json({'error': 'Unknown endpoint'}, 404)


def run_http_server(port=8765):
    """Run HTTP server in background thread."""
    class ReusableHTTPServer(HTTPServer):
        allow_reuse_address = True
    
    server = ReusableHTTPServer(('127.0.0.1', port), MCPHandler)
    logger.info(f"HTTP MCP server listening on http://127.0.0.1:{port}")
    server.serve_forever()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765, help='HTTP server port')
    parser.add_argument('--http-only', action='store_true', help='Run HTTP server only (no Native Messaging)')
    args = parser.parse_args()
    
    logger.info(f"Starting Browser Use MCP Server (port={args.port})")
    
    # Start HTTP server in background
    http_thread = threading.Thread(target=run_http_server, args=(args.port,), daemon=True)
    http_thread.start()
    
    if args.http_only:
        logger.info("Running in HTTP-only mode (no Native Messaging)")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    else:
        # Start Native Messaging reader
        native.start()
        
        # Keep main thread alive waiting for stdin (Native Messaging)
        try:
            while native.running:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            native.stop()
    
    logger.info("Server shutting down")


if __name__ == "__main__":
    main()
