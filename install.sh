#!/bin/bash
# Moonraker Auth - One-Click Installation Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_VERSION="1.0.0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Installation paths
CONFIG_DIR="/etc/moonraker-auth"
LIB_DIR="/usr/local/lib/moonraker-auth"
BIN_DIR="/usr/local/bin"
DB_DIR="/var/lib/nginx-auth"
LOG_DIR="/var/log/nginx-auth"
SYSTEMD_DIR="/etc/systemd/system"

function print_header() {
    echo ""
    echo "============================================"
    echo "  Moonraker Auth Installer v${INSTALL_VERSION}"
    echo "============================================"
    echo ""
}

function log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

function log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

function log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

function log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

function check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root"
        echo "Please run: sudo bash $0"
        exit 1
    fi
}

function check_prerequisites() {
    log_info "Checking prerequisites..."

    local missing_deps=()

    # Check nginx with njs
    if ! command -v nginx &> /dev/null; then
        missing_deps+=("nginx")
    else
    local has_njs=0
    # 檢查 1：是否為靜態編譯支援
    if nginx -V 2>&1 | grep -q "http_js_module"; then
        has_njs=1
    # 檢查 2：是否加載了動態模組（Debian/Ubuntu 格式）
    elif [ -f /usr/lib/nginx/modules/ngx_http_js_module.so ] || [ -f /etc/nginx/modules-enabled/50-mod-http-js.conf ]; then
        has_njs=1
    fi

    if [ "$has_njs" -eq 0 ]; then
        log_error "nginx is installed but does not have njs (http_js_module) support"
        log_info "Please install nginx with njs module"
        exit 1
    fi
    fi

    # Check Python 3
    if ! command -v python3 &> /dev/null; then
        missing_deps+=("python3")
    fi

    # Check SQLite3
    if ! command -v sqlite3 &> /dev/null; then
        missing_deps+=("sqlite3")
    fi

    # Check systemd
    if ! command -v systemctl &> /dev/null; then
        log_error "systemd is required but not found"
        exit 1
    fi

    # Check openssl (for bootstrap key generation)
    if ! command -v openssl &> /dev/null; then
        missing_deps+=("openssl")
    fi

    if [ ${#missing_deps[@]} -gt 0 ]; then
        log_error "Missing dependencies: ${missing_deps[*]}"
        log_info "Please install the missing packages and try again"
        exit 1
    fi

    log_success "All prerequisites satisfied"
}

function check_moonraker() {
    log_info "Checking Moonraker connectivity..."

    # Try to connect to Moonraker on default port
    if curl -s --connect-timeout 3 http://127.0.0.1:7126/printer/info > /dev/null 2>&1; then
        log_success "Moonraker is running and accessible on port 7126"
        return 0
    fi

    log_error "Cannot connect to Moonraker on http://127.0.0.1:7126"
    log_info "Moonraker must be running before installing the auth layer"
    log_info "Please start Moonraker and try again"
    exit 1
}

function check_existing_installation() {
    if [ -d "$CONFIG_DIR" ]; then
        log_warn "Existing installation detected at $CONFIG_DIR"
        echo ""
        echo "Options:"
        echo "  1) Upgrade (preserve configuration and database)"
        echo "  2) Reinstall (preserve database only)"
        echo "  3) Abort installation"
        echo ""
        read -p "Choose option [1/2/3]: " choice

        case "$choice" in
            1)
                log_info "Upgrading existing installation..."
                return 0
                ;;
            2)
                log_info "Reinstalling (preserving database)..."
                # Stop services
                systemctl stop nginx-auth.service 2>/dev/null || true
                systemctl stop nginx-auth-db.service 2>/dev/null || true
                # Remove config but keep DB
                rm -rf "$CONFIG_DIR"
                rm -rf "$LIB_DIR"
                return 0
                ;;
            3)
                log_info "Installation aborted by user"
                exit 0
                ;;
            *)
                log_error "Invalid option"
                exit 1
                ;;
        esac
    fi
}

function load_configuration() {
    log_info "Loading configuration..."

    local config_file="$CONFIG_DIR/moonraker-auth.conf"

    # If config exists, source it
    if [ -f "$config_file" ]; then
        source "$config_file"
        log_success "Loaded existing configuration"
    else
        # Copy default config
        mkdir -p "$CONFIG_DIR"
        cp "$SCRIPT_DIR/config/moonraker-auth.conf" "$config_file"
        source "$config_file"
        log_success "Created default configuration"
    fi

    # Validate required variables
    : ${MOONRAKER_HOST:=127.0.0.1}
    : ${MOONRAKER_PORT:=7126}
    : ${AUTH_PORT:=7125}
    : ${DB_HELPER_PORT:=9999}
    : ${LOG_DIR:=/var/log/nginx-auth}
    : ${DB_PATH:=/var/lib/nginx-auth/keys.db}
    : ${JS_PATH:=/usr/local/lib/moonraker-auth}

    # Prompt for service key if not set or using default
    if [ -z "$SERVICE_KEY" ] || [ "$SERVICE_KEY" = "a3c256d7562541a69a5c5a8bcd036ecd" ]; then
        log_warn "Using default service key"
        log_info "It's recommended to use the actual Moonraker service key"
        echo ""
        read -p "Enter Moonraker service key (or press Enter to use default): " input_key
        if [ -n "$input_key" ]; then
            SERVICE_KEY="$input_key"
            # Update config file
            sed -i "s/^SERVICE_KEY=.*/SERVICE_KEY=$SERVICE_KEY/" "$config_file"
        fi
    fi
}

function create_directories() {
    log_info "Creating directories..."

    mkdir -p "$CONFIG_DIR"
    mkdir -p "$LIB_DIR"
    mkdir -p "$DB_DIR"
    mkdir -p "$LOG_DIR"

    # Set ownership
    chown -R www-data:www-data "$DB_DIR"
    chown -R www-data:www-data "$LOG_DIR"

    log_success "Directories created"
}

function copy_files() {
    log_info "Copying files..."

    # Copy njs modules
    cp "$SCRIPT_DIR/src/nginx/"*.js "$LIB_DIR/"

    # Copy and make executable: Python DB helper
    cp "$SCRIPT_DIR/src/db/nginx-auth-db-helper.py" "$BIN_DIR/nginx-auth-db-helper"
    chmod +x "$BIN_DIR/nginx-auth-db-helper"

    # Copy and make executable: CLI tool
    cp "$SCRIPT_DIR/moonraker-auth-ctl" "$BIN_DIR/moonraker-auth-ctl"
    chmod +x "$BIN_DIR/moonraker-auth-ctl"

    log_success "Files copied"
}

function generate_nginx_config() {
    log_info "Generating nginx configuration..."

    local template="$SCRIPT_DIR/config/nginx-auth.conf.template"
    local output="$CONFIG_DIR/nginx-auth.conf"

    # Read template and replace variables
    sed -e "s|{{MOONRAKER_HOST}}|$MOONRAKER_HOST|g" \
        -e "s|{{MOONRAKER_PORT}}|$MOONRAKER_PORT|g" \
        -e "s|{{AUTH_PORT}}|$AUTH_PORT|g" \
        -e "s|{{SERVICE_KEY}}|$SERVICE_KEY|g" \
        -e "s|{{JS_PATH}}|$JS_PATH|g" \
        -e "s|{{DB_HELPER_PORT}}|$DB_HELPER_PORT|g" \
        -e "s|{{LOG_DIR}}|$LOG_DIR|g" \
        "$template" > "$output"

    # Test nginx config
    if nginx -t -c "$output" 2>&1 | grep -q "syntax is ok"; then
        log_success "nginx configuration generated and validated"
    else
        log_error "nginx configuration validation failed"
        nginx -t -c "$output"
        exit 1
    fi
}

function install_systemd_services() {
    log_info "Installing systemd services..."

    # Copy service files
    cp "$SCRIPT_DIR/config/nginx-auth-db.service" "$SYSTEMD_DIR/"
    cp "$SCRIPT_DIR/config/nginx-auth.service" "$SYSTEMD_DIR/"

    # Reload systemd
    systemctl daemon-reload

    log_success "systemd services installed"
}

function initialize_database() {
    log_info "Initializing database..."

    # Export environment variables for DB helper
    export DB_PATH="$DB_PATH"
    export PORT="$DB_HELPER_PORT"

    # Run DB helper briefly to initialize schema
    timeout 2 python3 "$BIN_DIR/nginx-auth-db-helper" > /dev/null 2>&1 || true

    # Wait for DB file to be created
    sleep 1

    if [ -f "$DB_PATH" ]; then
        # Ensure correct ownership
        chown www-data:www-data "$DB_PATH"
        log_success "Database initialized at $DB_PATH"
    else
        log_error "Database initialization failed"
        exit 1
    fi
}

function start_services() {
    log_info "Starting services..."

    # Enable services to start on boot
    systemctl enable nginx-auth-db.service
    systemctl enable nginx-auth.service

    # Start services
    systemctl start nginx-auth-db.service
    sleep 2
    systemctl start nginx-auth.service
    sleep 2

    log_success "Services started and enabled"
}

function verify_installation() {
    log_info "Verifying installation..."

    local errors=0

    # Check DB service
    if systemctl is-active --quiet nginx-auth-db.service; then
        log_success "Database helper service is running"
    else
        log_error "Database helper service failed to start"
        ((errors++))
    fi

    # Check nginx service
    if systemctl is-active --quiet nginx-auth.service; then
        log_success "nginx auth proxy is running"
    else
        log_error "nginx service failed to start"
        ((errors++))
    fi

    # Check port binding
    if netstat -tuln 2>/dev/null | grep -q ":$AUTH_PORT " || ss -tuln 2>/dev/null | grep -q ":$AUTH_PORT "; then
        log_success "Auth proxy listening on port $AUTH_PORT"
    else
        log_warn "Auth proxy may not be listening on port $AUTH_PORT"
    fi

    # Test database connection
    if curl -s --connect-timeout 2 http://127.0.0.1:$DB_HELPER_PORT/ > /dev/null 2>&1; then
        log_success "Database helper is accessible"
    else
        log_warn "Cannot connect to database helper"
    fi

    # Test nginx to Moonraker connectivity (without auth key - should get 401)
    if curl -s --connect-timeout 2 http://127.0.0.1:$AUTH_PORT/printer/info > /dev/null 2>&1; then
        log_success "nginx is proxying to Moonraker"
    else
        log_warn "nginx may not be proxying correctly to Moonraker"
    fi

    return $errors
}

function create_bootstrap_key() {
    log_info "Creating bootstrap admin key..."

    # Check if any admin keys already exist
    local key_count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM api_keys WHERE role='admin';" 2>/dev/null || echo "0")

    if [ "$key_count" -gt 0 ]; then
        log_info "Admin keys already exist, skipping bootstrap key creation"
        return 0
    fi

    # Generate bootstrap key
    local new_key=$(openssl rand -hex 16)
    local bootstrap_name="bootstrap_${new_key}"

    sqlite3 "$DB_PATH" <<EOF
INSERT INTO api_keys (key, role, name, created_at, created_by)
VALUES ('$bootstrap_name', 'admin', 'Bootstrap Admin Key', $(date +%s)000, 'system');
EOF

    # Save to file for user
    echo "$bootstrap_name" > "$CONFIG_DIR/bootstrap-key.txt"
    chmod 600 "$CONFIG_DIR/bootstrap-key.txt"

    log_success "Bootstrap admin key created"

    # Export for final message
    BOOTSTRAP_KEY="$bootstrap_name"
}

function print_success_message() {
    echo ""
    echo "============================================"
    echo -e "${GREEN}  Installation Complete!${NC}"
    echo "============================================"
    echo ""

    if [ -n "$BOOTSTRAP_KEY" ]; then
        echo "Bootstrap Admin Key:"
        echo "  $BOOTSTRAP_KEY"
        echo ""
        echo "This key has been saved to: $CONFIG_DIR/bootstrap-key.txt"
        echo ""
    fi

    echo "Services:"
    echo "  - Database Helper: nginx-auth-db.service"
    echo "  - Auth Proxy: nginx-auth.service"
    echo ""
    echo "Auth proxy listening on: http://localhost:$AUTH_PORT"
    echo ""
    echo "Management CLI:"
    echo "  moonraker-auth-ctl status    # Check service status"
    echo "  moonraker-auth-ctl logs       # View logs"
    echo "  moonraker-auth-ctl restart    # Restart services"
    echo "  moonraker-auth-ctl bootstrap  # Create new admin key"
    echo ""
    echo "Next steps:"
    echo "  1. Test the installation:"
    if [ -n "$BOOTSTRAP_KEY" ]; then
        echo "     curl -H \"X-Api-Key: $BOOTSTRAP_KEY\" http://localhost:$AUTH_PORT/printer/info"
    else
        echo "     curl -H \"X-Api-Key: <YOUR_KEY>\" http://localhost:$AUTH_PORT/printer/info"
    fi
    echo ""
    echo "  2. Create additional API keys:"
    echo "     curl -X POST http://localhost:$AUTH_PORT/auth/register \\"
    echo "       -H \"X-Api-Key: <ADMIN_KEY>\" \\"
    echo "       -H \"Content-Type: application/json\" \\"
    echo "       -d '{\"role\": \"manager\", \"name\": \"My Manager Key\"}'"
    echo ""
    echo "For more information, see the documentation in $SCRIPT_DIR/docs/"
    echo ""
}

# Main installation flow
main() {
    print_header

    check_root
    check_prerequisites
    check_moonraker
    check_existing_installation
    load_configuration
    create_directories
    copy_files
    generate_nginx_config
    install_systemd_services
    initialize_database
    start_services

    if verify_installation; then
        create_bootstrap_key
        print_success_message
    else
        log_error "Installation completed with warnings"
        log_info "Check service status with: moonraker-auth-ctl status"
        log_info "View logs with: moonraker-auth-ctl logs"
        exit 1
    fi
}

main "$@"
