#!/usr/bin/env python3
"""
SQLite database helper for nginx auth layer.
Provides HTTP API for key-to-role mappings.

Version: 1.0.0
"""

import sqlite3
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
import time
import os

VERSION = "1.0.0"

# Configuration from environment variables
DB_PATH = os.environ.get('DB_PATH', '/var/lib/nginx-auth/keys.db')
PORT = int(os.environ.get('PORT', 9999))

def init_db():
    """Initialize database schema if it doesn't exist."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS api_keys (
            key TEXT PRIMARY KEY NOT NULL,
            role TEXT NOT NULL,
            name TEXT,
            created_at INTEGER NOT NULL,
            created_by TEXT,
            last_used INTEGER
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_role ON api_keys(role)')

    # Cards table for card-based access control
    conn.execute('''
        CREATE TABLE IF NOT EXISTS cards (
            card_id TEXT PRIMARY KEY NOT NULL,
            is_token INTEGER NOT NULL,
            name TEXT,
            api_key TEXT,
            request_path TEXT,
            request_body TEXT,
            owner TEXT NOT NULL,
            once INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            last_used INTEGER
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_card_is_token ON cards(is_token)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_card_owner ON cards(owner)')

    conn.commit()
    conn.close()
    print(f"Database initialized at {DB_PATH}")

class DBHandler(BaseHTTPRequestHandler):
    """HTTP handler for database operations."""

    def do_POST(self):
        """Handle POST requests with JSON body."""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            request = json.loads(body)

            action = request.get('action')
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row

            try:
                result = self._handle_action(conn, action, request)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode('utf-8'))

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            finally:
                conn.close()

        except Exception as e:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def _handle_action(self, conn, action, request):
        """Route action to appropriate handler."""
        if action == 'get_role':
            key = request['key']
            cursor = conn.execute('SELECT role FROM api_keys WHERE key = ?', (key,))
            row = cursor.fetchone()
            return {'role': row['role']} if row else None

        elif action == 'register_key':
            conn.execute(
                'INSERT OR REPLACE INTO api_keys (key, role, name, created_at, created_by) VALUES (?, ?, ?, ?, ?)',
                (request['key'], request['role'], request.get('name'), int(time.time() * 1000), request.get('created_by'))
            )
            conn.commit()
            return {'success': True}

        elif action == 'touch_key':
            conn.execute('UPDATE api_keys SET last_used = ? WHERE key = ?', (int(time.time() * 1000), request['key']))
            conn.commit()
            return {'success': True}

        elif action == 'list_keys':
            cursor = conn.execute('SELECT key, role, name, created_at, created_by, last_used FROM api_keys ORDER BY created_at DESC')
            return {'keys': [dict(row) for row in cursor.fetchall()]}

        elif action == 'delete_key':
            conn.execute('DELETE FROM api_keys WHERE key = ?', (request['key'],))
            conn.commit()
            return {'success': True}

        # Card management actions
        elif action == 'register_card':
            # Normalize card_id to lowercase
            card_id = request['card_id'].lower().strip() if request.get('card_id') else None

            # Accept both role (legacy) and is_token
            is_token = request.get('is_token')
            if is_token is None:
                # Fallback: derive from role if provided
                role = request.get('role')
                is_token = 1 if role == 'token' else 0

            conn.execute(
                'INSERT INTO cards (card_id, is_token, name, api_key, request_path, request_body, owner, once, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (card_id, is_token, request.get('name'), request.get('api_key'),
                 request.get('request_path'), request.get('request_body'), request['owner'],
                 request.get('once', 0), int(time.time() * 1000))
            )
            conn.commit()
            return {'success': True}

        elif action == 'get_card':
            # Normalize card_id to lowercase
            card_id = request['card_id'].lower().strip() if request.get('card_id') else None
            cursor = conn.execute('SELECT card_id, is_token, name, api_key, request_path, request_body, owner, once, created_at, last_used FROM cards WHERE card_id = ?', (card_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

        elif action == 'touch_card':
            # Normalize card_id to lowercase
            card_id = request['card_id'].lower().strip() if request.get('card_id') else None
            conn.execute('UPDATE cards SET last_used = ? WHERE card_id = ?', (int(time.time() * 1000), card_id))
            conn.commit()
            return {'success': True}

        elif action == 'delete_card':
            # Normalize card_id to lowercase
            card_id = request['card_id'].lower().strip() if request.get('card_id') else None
            conn.execute('DELETE FROM cards WHERE card_id = ?', (card_id,))
            conn.commit()
            return {'success': True}

        elif action == 'list_cards':
            # Use LEFT JOIN to get role for auth cards from api_keys table
            # Return minimal fields to avoid "too big subrequest response" in njs
            cursor = conn.execute('''
                SELECT
                    c.card_id,
                    c.is_token,
                    CASE
                        WHEN c.is_token = 1 THEN 'token'
                        ELSE COALESCE(k.role, 'unknown')
                    END as role,
                    c.name,
                    SUBSTR(c.api_key, 1, 8) as api_key_preview,
                    c.owner,
                    c.created_at
                FROM cards c
                LEFT JOIN api_keys k ON c.api_key = k.key
                ORDER BY c.created_at DESC
            ''')
            return {'cards': [dict(row) for row in cursor.fetchall()]}

        elif action == 'check_card_owner':
            # Normalize card_id to lowercase
            card_id = request['card_id'].lower().strip() if request.get('card_id') else None
            cursor = conn.execute('SELECT owner FROM cards WHERE card_id = ?', (card_id,))
            row = cursor.fetchone()
            return {'owner': row['owner']} if row else None

        elif action == 'get_roles_bulk':
            # Bulk fetch roles for multiple API keys (for efficient list_cards)
            keys = request.get('keys', [])
            if not keys:
                return {}
            placeholders = ','.join(['?'] * len(keys))
            cursor = conn.execute(f'SELECT key, role FROM api_keys WHERE key IN ({placeholders})', keys)
            return {row['key']: row['role'] for row in cursor.fetchall()}

        else:
            return {'error': 'Unknown action'}

    def log_message(self, format, *args):
        """Silence request logs."""
        pass

if __name__ == '__main__':
    init_db()
    server = HTTPServer(('127.0.0.1', PORT), DBHandler)
    print(f'nginx Auth Database Helper v{VERSION}')
    print(f'Listening on 127.0.0.1:{PORT}')
    print('Database: ' + DB_PATH)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down...')
        server.shutdown()
