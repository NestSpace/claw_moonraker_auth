#!/bin/bash
# Moonraker Auth - Uninstallation Script

set -e

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

function confirm_uninstall() {
    echo ""
    echo "============================================"
    echo "  Moonraker Auth Uninstaller"
    echo "============================================"
    echo ""
    log_warn "This will remove Moonraker Auth from your system"
    echo ""
    read -p "Are you sure you want to continue? [y/N]: " confirm

    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Uninstallation cancelled"
        exit 0
    fi
}

function stop_services() {
    log_info "Stopping services..."

    systemctl stop nginx-auth.service 2>/dev/null || true
    systemctl stop nginx-auth-db.service 2>/dev/null || true

    log_success "Services stopped"
}

function disable_services() {
    log_info "Disabling services..."

    systemctl disable nginx-auth.service 2>/dev/null || true
    systemctl disable nginx-auth-db.service 2>/dev/null || true

    log_success "Services disabled"
}

function remove_service_files() {
    log_info "Removing systemd service files..."

    rm -f "$SYSTEMD_DIR/nginx-auth.service"
    rm -f "$SYSTEMD_DIR/nginx-auth-db.service"

    systemctl daemon-reload

    log_success "Service files removed"
}

function remove_binaries() {
    log_info "Removing installed binaries..."

    rm -f "$BIN_DIR/nginx-auth-db-helper"
    rm -f "$BIN_DIR/moonraker-auth-ctl"

    log_success "Binaries removed"
}

function remove_libraries() {
    log_info "Removing library files..."

    rm -rf "$LIB_DIR"

    log_success "Library files removed"
}

function remove_config() {
    if [ -d "$CONFIG_DIR" ]; then
        echo ""
        log_warn "Configuration directory contains your settings and bootstrap keys"
        read -p "Remove configuration directory ($CONFIG_DIR)? [y/N]: " confirm

        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            rm -rf "$CONFIG_DIR"
            log_success "Configuration removed"
        else
            log_info "Configuration preserved at $CONFIG_DIR"
        fi
    fi
}

function remove_database() {
    if [ -d "$DB_DIR" ]; then
        echo ""
        log_warn "Database directory contains all your API keys and cards"
        read -p "Remove database directory ($DB_DIR)? [y/N]: " confirm

        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            rm -rf "$DB_DIR"
            log_success "Database removed"
        else
            log_info "Database preserved at $DB_DIR"
        fi
    fi
}

function remove_logs() {
    if [ -d "$LOG_DIR" ]; then
        echo ""
        read -p "Remove log directory ($LOG_DIR)? [y/N]: " confirm

        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            rm -rf "$LOG_DIR"
            log_success "Logs removed"
        else
            log_info "Logs preserved at $LOG_DIR"
        fi
    fi
}

function print_completion_message() {
    echo ""
    echo "============================================"
    echo -e "${GREEN}  Uninstallation Complete${NC}"
    echo "============================================"
    echo ""
    log_info "Moonraker Auth has been removed from your system"
    echo ""

    if [ -d "$CONFIG_DIR" ] || [ -d "$DB_DIR" ]; then
        echo "Preserved directories:"
        [ -d "$CONFIG_DIR" ] && echo "  - Configuration: $CONFIG_DIR"
        [ -d "$DB_DIR" ] && echo "  - Database: $DB_DIR"
        [ -d "$LOG_DIR" ] && echo "  - Logs: $LOG_DIR"
        echo ""
        echo "To completely remove all data, manually delete these directories"
    fi
}

# Main uninstall flow
main() {
    check_root
    confirm_uninstall
    stop_services
    disable_services
    remove_service_files
    remove_binaries
    remove_libraries
    remove_config
    remove_database
    remove_logs
    print_completion_message
}

main "$@"
