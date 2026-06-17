# Moonraker Auth

A production-ready authentication and authorization layer for Moonraker (Klipper's API server). Provides API key management, role-based access control, and a card-based token system for instant access.

## Features

- 🔐 **API Key Authentication** - Secure API key-based authentication for all Moonraker endpoints
- 👥 **Role-Based Access Control** - Admin and manager roles with fine-grained permissions
- 🎫 **Card System** - NFC/barcode card support for instant access (auth cards and token cards)
- 🗄️ **Database-Backed** - SQLite database for reliable key and card storage
- ⚡ **High Performance** - nginx with njs for minimal latency
- 🔄 **Service Account Pattern** - Single static Moonraker key for all backend communication
- 🚀 **One-Click Installation** - Automated setup with systemd service management

## Quick Start

### Prerequisites

- nginx with njs module (`ngx_http_js_module`)
- Python 3
- SQLite3
- systemd
- Moonraker running and accessible

### Moonraker Configuration

Before installing the auth layer, you need to configure Moonraker to:

1. **Disable Moonraker's built-in authorization** (auth layer handles this)
2. **Enable trusted clients** (so the auth layer can proxy requests)
3. **Set up CORS domains** (for web clients)

Edit your Moonraker configuration file (usually `~/printer_data/config/moonraker.conf`):

```ini
[server]
host: 0.0.0.0
port: 7125
# ... other settings ...

[authorization]
# Disable force_logins - auth layer handles authentication
force_logins: False

# Trust localhost connections (from auth layer)
trusted_clients:
    127.0.0.1
    localhost

# Add CORS domains for your web interfaces
cors_domains:
    http://127.0.0.1:8080
    http://localhost:8080
    http://127.0.0.1:7125
    http://localhost:7125
    http://127.0.0.1
    http://localhost
    # Add your specific domains as needed
```

**Important Notes:**
- The auth layer runs on port **7125** (default) and proxies to Moonraker on port **7126**
- Clients connect to port **7125** (auth layer), not directly to Moonraker
- The auth layer uses a static "service key" to communicate with Moonraker
- Moonraker's `force_logins: False` allows the auth layer to proxy without additional authentication

**For Docker Users:**

If running Moonraker in Docker (like `virtual-klipper-printer`):
1. Edit the config inside the container: `docker exec -it <container> nano /home/printer/printer_data/config/moonraker.conf`
2. Restart Moonraker: `docker exec <container> supervisorctl restart moonraker`
3. Verify Moonraker is accessible: `curl http://localhost:7126/printer/info`

After configuring Moonraker, proceed with installation.

### Installation

```bash
git clone https://github.com/yourusername/moonraker-auth.git
cd moonraker-auth
sudo bash install.sh
```

That's it! The installer will:
1. Check prerequisites
2. Install all components
3. Configure services for auto-start
4. Initialize the database
5. Create a bootstrap admin key

### First Steps

After installation, test the setup:

```bash
# Use the bootstrap key from installation output
export ADMIN_KEY="bootstrap_xxxxx"

# Test authentication
curl -H "X-Api-Key: $ADMIN_KEY" http://localhost:7125/printer/info

# Create a new admin key
curl -X POST http://localhost:7125/auth/register \
  -H "X-Api-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin", "name": "My Admin Key"}'

# Create a manager key
curl -X POST http://localhost:7125/auth/register \
  -H "X-Api-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"role": "manager", "name": "My Manager Key"}'
```

## Management CLI

The `moonraker-auth-ctl` command provides easy service management:

```bash
# Service control
moonraker-auth-ctl start      # Start services
moonraker-auth-ctl stop       # Stop services
moonraker-auth-ctl restart    # Restart services
moonraker-auth-ctl status     # Show status

# Diagnostics
moonraker-auth-ctl logs       # View logs
moonraker-auth-ctl logs nginx # View nginx logs only
moonraker-auth-ctl logs db    # View database logs only

# Configuration
moonraker-auth-ctl config     # Show current config
moonraker-auth-ctl test       # Test nginx config syntax
moonraker-auth-ctl reload     # Reload nginx config

# Key management
moonraker-auth-ctl bootstrap  # Create new bootstrap admin key
```

## Configuration

Edit `/etc/moonraker-auth/moonraker-auth.conf`:

```bash
# Moonraker Backend
MOONRAKER_HOST=127.0.0.1
MOONRAKER_PORT=7126

# Auth Proxy
AUTH_PORT=7125

# Moonraker Service Key (NEVER ROTATE THIS)
SERVICE_KEY=a3c256d7562541a69a5c5a8bcd036ecd

# Database Helper
DB_HELPER_PORT=9999

# Paths
LOG_DIR=/var/log/nginx-auth
DB_PATH=/var/lib/nginx-auth/keys.db
JS_PATH=/usr/local/lib/moonraker-auth
```

After changing configuration, regenerate nginx config and restart:

```bash
sudo moonraker-auth-ctl restart
```

## Architecture

```
Client Request
    ↓
nginx (port 7125) - Authentication Layer
    ↓
API Key Validation (SQLite via HTTP helper on port 9999)
    ↓
Role-Based Access Control
    ↓
Proxy to Moonraker (port 7126) with Service Key
    ↓
Response to Client
```

### Port Configuration

```
┌─────────────────────────────────────────────────────────┐
│                                                           │
│  Client (Mainsail/Fluidd/API)                            │
│                                                           │
└────────────────────┬──────────────────────────────────────┘
                     │
                     │ HTTP Request + API Key
                     ↓
        ┌────────────────────────────┐
        │  Auth Layer (nginx + njs)  │
        │  Port: 7125 (external)     │
        │                            │
        │  - Validates API key       │◄──────┐
        │  - Checks role permissions │       │
        │  - Proxies to Moonraker    │       │
        └────────────┬───────────────┘       │
                     │                       │
                     │ Authorized request    │
                     │ + Service Key         │
                     ↓                       │
        ┌────────────────────────────┐      │
        │  Moonraker                 │      │
        │  Port: 7126 (internal)     │      │ Subrequest
        │                            │      │
        │  force_logins: False       │      │
        │  trusted_clients: 127.0.0.1│      │
        └────────────────────────────┘      │
                                            │
                    ┌───────────────────────┘
                    │
        ┌───────────────────────────┐
        │  SQLite Database Helper   │
        │  Port: 9999 (localhost)   │
        │                           │
        │  - Stores API keys/cards  │
        │  - HTTP API for nginx     │
        └───────────────────────────┘
```

**Key Points:**
- **Port 7125**: External clients connect here (auth layer)
- **Port 7126**: Internal Moonraker port (not directly accessible)
- **Port 9999**: Internal database helper (localhost only)
- Moonraker trusts localhost connections from auth layer
- Auth layer uses static service key for all Moonraker communication

### Components

- **nginx + njs** - High-performance request handling and authentication
- **SQLite Database** - Stores API keys and cards
- **Python HTTP Server** - Provides database API to nginx via subrequests
- **systemd Services** - Auto-start and process management

## API Endpoints

### Authentication

All requests require an API key via:
- Header: `X-Api-Key: your-key-here`
- Query parameter: `?token=your-key-here`
- Bearer token: `Authorization: Bearer your-key-here`

### Admin Endpoints

**Register API Key** (Admin only)
```bash
POST /auth/register
Content-Type: application/json

{
  "role": "admin",  # or "manager"
  "name": "Key Name"
}
```

**List API Keys** (Admin only)
```bash
GET /auth/list
```

**Delete API Key** (Admin only)
```bash
DELETE /auth/delete?key=key-to-delete
```

### Card Endpoints

**Register Card** (Admin can create any; Manager can only create token cards)
```bash
POST /access/card/register
Content-Type: application/json

# Auth card (returns API key when scanned)
{
  "card_id": "nfc-tag-id",
  "role": "admin",
  "name": "My Admin Card"
}

# Token card (executes request when scanned)
{
  "card_id": "barcode-123",
  "role": "token",
  "name": "Start Print",
  "request_path": "/printer/gcode/script",
  "request_body": {"script": "START_PRINT"}
}
```

**Get Card** (Returns API key or executes request)
```bash
GET /access/card?card_id=nfc-tag-id
```

**Delete Card** (Owner or admin only)
```bash
DELETE /access/card/delete?card_id=card-to-delete
```

## Roles

### Admin
- Full access to all endpoints
- Can create API keys and cards
- Can manage all resources

### Manager
- Limited access to Moonraker endpoints
- Can only create token cards
- Cannot access `/auth/*` or card management endpoints
- Blocked from sensitive operations (firmware updates, system commands)

## Security

- **Service Key**: The static key for Moonraker communication should NEVER be rotated
- **API Keys**: 32-character hexadecimal keys, generated internally
- **Card IDs**: Case-insensitive, normalized to lowercase
- **Database**: Owned by `www-data`, proper file permissions
- **Logs**: Stored in `/var/log/nginx-auth/` with appropriate permissions

## Troubleshooting

### Services won't start

```bash
# Check service status
moonraker-auth-ctl status

# View detailed logs
moonraker-auth-ctl logs
journalctl -u nginx-auth.service -n 50
journalctl -u nginx-auth-db.service -n 50

# Test nginx configuration
moonraker-auth-ctl test
```

### Authentication fails

```bash
# Check if services are running
moonraker-auth-ctl status

# Verify database exists
ls -la /var/lib/nginx-auth/keys.db

# Check if API key exists
sudo sqlite3 /var/lib/nginx-auth/keys.db "SELECT * FROM api_keys;"
```

### Can't connect to Moonraker

```bash
# Test direct Moonraker connection
curl http://127.0.0.1:7126/printer/info

# Check service key in config
moonraker-auth-ctl config | grep SERVICE_KEY

# View nginx error logs
tail -f /var/log/nginx-auth/error.log
```

### Moonraker returns "Unauthorized"

If you get 401 Unauthorized errors when the auth layer tries to connect to Moonraker:

```bash
# Check Moonraker config - force_logins should be False
docker exec <container> cat /home/printer/printer_data/config/moonraker.conf | grep -A5 authorization

# Check trusted_clients includes localhost
# Should see: trusted_clients: 127.0.0.1, localhost

# Restart Moonraker after config changes
docker exec <container> supervisorctl restart moonraker

# Or for non-Docker: sudo systemctl restart moonraker
```

The auth layer needs `force_logins: False` and `127.0.0.1` in `trusted_clients` to proxy requests to Moonraker.

## Documentation

- [Installation Guide](docs/INSTALLATION.md)
- [Configuration Reference](docs/CONFIGURATION.md)
- [API Documentation](docs/API.md)
- [Architecture Overview](docs/ARCHITECTURE.md)

## Uninstallation

```bash
cd moonraker-auth
sudo bash uninstall.sh
```

The uninstaller will prompt before removing database and configuration files.

## License

MIT License - see LICENSE file for details

## Contributing

Contributions welcome! Please open an issue or pull request.

## Support

- GitHub Issues: https://github.com/yourusername/moonraker-auth/issues
- Documentation: See `docs/` directory
