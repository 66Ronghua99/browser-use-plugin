#!/usr/bin/env python3
"""
Browser Use MCP Server with Native Messaging Bridge.

Architecture:
- HTTP/SSE interface for MCP clients (Claude Code)
- Native Messaging stdio for Chrome Extension communication

The Chrome Extension connects via connectNative(), this script is launched as Native Host.
When running as Native Host, it also starts an HTTP server for MCP clients.

Stability Features:
- Heartbeat support for connection health monitoring
- Graceful port conflict handling
- Detailed logging with timestamps
"""

import sys
import json
import struct
import threading
import asyncio
import logging
import socket
import os
import signal
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional, Callable
import time
from datetime import datetime

# Configure logging with more detail
LOG_FILE = '/tmp/browser_use_mcp.log'
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(funcName)s:%(lineno)d] %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stderr)
    ]
)
logger = logging.getLogger('browser_use_mcp')

# Track server state
SERVER_START_TIME = datetime.now().isoformat()
HEARTBEAT_COUNT = 0
LAST_HEARTBEAT_TIME = None


def is_port_in_use(port: int) -> bool:
    """Check if a port is in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('127.0.0.1', port))
            return False
        except socket.error:
            return True


def kill_process_on_port(port: int) -> bool:
    """Attempt to kill any process using the specified port."""
    try:
        import subprocess
        result = subprocess.run(
            ['lsof', '-ti', f':{port}'],
            capture_output=True,
            text=True
        )
        if result.stdout.strip():
            pids = result.stdout.strip().split('\n')
            for pid in pids:
                if pid and pid != str(os.getpid()):
                    logger.info(f"Killing process {pid} on port {port}")
                    os.kill(int(pid), signal.SIGTERM)
            time.sleep(0.5)
            return True
    except Exception as e:
        logger.warning(f"Could not kill process on port {port}: {e}")
    return False


class NativeMessaging:
    """Handles Chrome Native Messaging protocol."""
    
    def __init__(self):
        self.lock = threading.Lock()
        self.pending_requests = {}
        self.request_counter = 0
        self.running = False
        self.reader_thread = None
        self.on_extension_message: Optional[Callable] = None
        self.connection_state = 'disconnected'
        self.last_message_time = None
        self.message_count = 0
    
    def read_message(self):
        """Read a message from stdin using Native Messaging protocol."""
        try:
            # Read 4-byte length prefix (little-endian unsigned int)
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
            self.last_message_time = datetime.now().isoformat()
            self.message_count += 1
            logger.info(f"Received from extension (msg #{self.message_count}): {message}")
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
        global HEARTBEAT_COUNT, LAST_HEARTBEAT_TIME
        
        logger.info("Reader loop started, waiting for messages from extension...")
        self.connection_state = 'connected'
        
        while self.running:
            message = self.read_message()
            if message is None:
                # stdin closed means Chrome terminated the connection
                logger.warning("Connection to extension lost, stopping reader")
                self.connection_state = 'disconnected'
                self.running = False
                break
            
            logger.debug(f"Processing message: {message}")
            
            # Handle heartbeat (PING) messages
            action = message.get('action')
            if action == 'PING':
                HEARTBEAT_COUNT += 1
                LAST_HEARTBEAT_TIME = datetime.now().isoformat()
                self.write_message({
                    'action': 'PONG',
                    'timestamp': message.get('timestamp'),
                    'server_time': LAST_HEARTBEAT_TIME,
                    'heartbeat_count': HEARTBEAT_COUNT
                })
                logger.debug(f"Heartbeat #{HEARTBEAT_COUNT} acknowledged")
                continue
            
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
        self.connection_state = 'connecting'
        self.reader_thread = threading.Thread(target=self.reader_loop, daemon=True)
        self.reader_thread.start()
        logger.info("Native Messaging reader started")
    
    def stop(self):
        """Stop the reader thread."""
        self.running = False
        self.connection_state = 'stopped'
    
    def send_command(self, action: str, params: dict = None, timeout: float = 30.0):
        """Send command to extension and wait for response."""
        if not self.running:
            return {'error': 'Native messaging not connected'}
        
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
    
    def get_status(self):
        """Get detailed connection status."""
        return {
            'state': self.connection_state,
            'running': self.running,
            'last_message_time': self.last_message_time,
            'message_count': self.message_count,
            'pending_requests': len(self.pending_requests)
        }


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
            self.send_json({
                'status': 'ok',
                'native_connected': native.running,
                'server_start_time': SERVER_START_TIME,
                'heartbeat_count': HEARTBEAT_COUNT,
                'last_heartbeat_time': LAST_HEARTBEAT_TIME
            })
        elif self.path == '/status':
            # Detailed status endpoint for debugging
            self.send_json({
                'server': {
                    'start_time': SERVER_START_TIME,
                    'pid': os.getpid(),
                    'uptime_seconds': (datetime.now() - datetime.fromisoformat(SERVER_START_TIME)).total_seconds()
                },
                'native_messaging': native.get_status(),
                'heartbeat': {
                    'count': HEARTBEAT_COUNT,
                    'last_time': LAST_HEARTBEAT_TIME
                }
            })
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
        
        elif self.path == '/tools/get_ax_tree_compact':
            # Compact format saves ~85% tokens
            response = native.send_command('GET_AX_TREE_COMPACT')
            self.send_json(response)
        
        elif self.path == '/tools/get_page_text':
            max_length = data.get('max_length', 8000)
            selector = data.get('selector')
            
            response = native.send_command('GET_PAGE_TEXT', {
                'maxLength': max_length,
                'selector': selector
            })
            self.send_json(response)
        
        elif self.path == '/tools/execute_action':
            action_type = data.get('action_type')
            ref_id = data.get('ref_id')  # Can be None for keypress/scroll_page
            text = data.get('text')
            
            # Global actions that don't require ref_id
            global_actions = ['keypress', 'scroll_page']
            
            if not action_type:
                self.send_json({'error': 'Missing action_type'}, 400)
                return
            
            if action_type not in global_actions and ref_id is None:
                self.send_json({'error': 'Missing ref_id for this action_type'}, 400)
                return
            
            response = native.send_command('EXECUTE_ACTION', {
                'type': action_type,
                'refId': ref_id,
                'text': text
            })
            self.send_json(response)
        
        else:
            self.send_json({'error': 'Unknown endpoint'}, 404)


def run_http_server(port=8765, max_retries=3):
    """Run HTTP server in background thread with port conflict handling."""
    
    class ReusableHTTPServer(HTTPServer):
        allow_reuse_address = True
    
    for attempt in range(max_retries):
        if is_port_in_use(port):
            logger.warning(f"Port {port} is in use (attempt {attempt + 1}/{max_retries})")
            if attempt < max_retries - 1:
                kill_process_on_port(port)
                time.sleep(1)
                continue
            else:
                logger.error(f"Could not acquire port {port} after {max_retries} attempts")
                return
        
        try:
            server = ReusableHTTPServer(('127.0.0.1', port), MCPHandler)
            logger.info(f"HTTP MCP server listening on http://127.0.0.1:{port}")
            server.serve_forever()
            return
        except socket.error as e:
            logger.error(f"Socket error: {e}")
            if attempt < max_retries - 1:
                time.sleep(1)
    
    logger.error("Failed to start HTTP server")


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765, help='HTTP server port')
    parser.add_argument('--http-only', action='store_true', help='Run HTTP server only (no Native Messaging)')
    args = parser.parse_args()
    
    logger.info("=" * 60)
    logger.info(f"Starting Browser Use MCP Server")
    logger.info(f"  PID: {os.getpid()}")
    logger.info(f"  Port: {args.port}")
    logger.info(f"  Mode: {'HTTP-only' if args.http_only else 'Native Messaging + HTTP'}")
    logger.info(f"  Log file: {LOG_FILE}")
    logger.info("=" * 60)
    
    # Start HTTP server in background
    http_thread = threading.Thread(target=run_http_server, args=(args.port,), daemon=True)
    http_thread.start()
    
    # Give HTTP server time to start
    time.sleep(0.5)
    
    if args.http_only:
        logger.info("Running in HTTP-only mode (no Native Messaging)")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Received keyboard interrupt")
    else:
        # Start Native Messaging reader
        native.start()
        
        # Keep main thread alive waiting for stdin (Native Messaging)
        try:
            while native.running:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Received keyboard interrupt")
        finally:
            native.stop()
    
    logger.info("Server shutting down")


if __name__ == "__main__":
    main()
