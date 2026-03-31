#!/bin/bash
# Migrate DUSTIN from systemd (bare Bun process) to Docker.
#
# This script runs ON THE VPS as root. It:
#   1. Installs Docker (if needed)
#   2. Stops and disables the systemd DUSTIN service
#   3. Sets up the Docker deployment directory
#   4. Copies the existing .env into the Docker directory
#   5. Pulls the Docker image and starts the container
#   6. Verifies health
#
# Usage:
#   # Copy this script and docker-compose.user.yaml to the VPS, then:
#   sudo bash migrate-to-docker.sh
#
# Prerequisites:
#   - Root SSH access to the VPS
#   - docker-compose.yaml in the same directory (copy docker-compose.user.yaml)
#   - .env file with DUSTIN's secrets already on the VPS
#   - ghcr.io/icatel15/dustin:latest image published to GHCR
#   - GHCR_TOKEN environment variable set (GitHub PAT with read:packages scope)

set -euo pipefail

DEPLOY_DIR="/home/dustin/app"
SYSTEMD_SERVICE="dustin"
HEALTH_PORT="${PORT:-3100}"
HEALTH_TIMEOUT=90

# ---------- Colors ----------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[*]${NC} $1"; }
success() { echo -e "${GREEN}[+]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[x]${NC} $1" >&2; }
step()    { echo -e "\n${BOLD}--- $1 ---${NC}"; }

# ---------- Pre-flight ----------

step "Pre-flight checks"

if [ "$(id -u)" -ne 0 ]; then
  error "This script must be run as root (or with sudo)."
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/.env" ]; then
  error "No .env file found at $DEPLOY_DIR/.env"
  error "Copy your existing .env file there before running this script."
  exit 1
fi

# ---------- Step 1: Install Docker ----------

step "1/6 — Docker"

if ! command -v docker &> /dev/null; then
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | bash > /dev/null 2>&1
  systemctl enable docker
  systemctl start docker
  success "Docker installed: $(docker --version)"
elif ! systemctl is-active --quiet docker 2>/dev/null; then
  warn "Docker installed but not running. Starting..."
  systemctl start docker
  systemctl enable docker
  success "Docker started"
else
  success "Docker already installed: $(docker --version)"
fi

# Ensure docker compose plugin
if ! docker compose version &> /dev/null; then
  info "Installing Docker Compose plugin..."
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin > /dev/null 2>&1
  success "Docker Compose plugin installed"
fi

# Add dustin user to docker group
if id dustin &>/dev/null; then
  if ! id -nG dustin | grep -qw docker; then
    usermod -aG docker dustin
    success "Added dustin user to docker group"
  else
    success "dustin user already in docker group"
  fi
fi

# ---------- Step 2: Stop systemd service ----------

step "2/6 — Stop systemd service"

if systemctl is-active --quiet "$SYSTEMD_SERVICE" 2>/dev/null; then
  info "Stopping $SYSTEMD_SERVICE service..."
  systemctl stop "$SYSTEMD_SERVICE"
  success "Service stopped"
else
  info "Service not running"
fi

if systemctl is-enabled --quiet "$SYSTEMD_SERVICE" 2>/dev/null; then
  systemctl disable "$SYSTEMD_SERVICE"
  success "Service disabled"
fi

# Kill any remaining bun processes running DUSTIN
if pgrep -f "bun.*src/index.ts" > /dev/null 2>&1; then
  warn "Found orphan bun process. Killing..."
  pkill -f "bun.*src/index.ts" || true
  sleep 2
  success "Orphan process killed"
fi

# ---------- Step 3: Verify port is free ----------

step "3/6 — Verify port $HEALTH_PORT is free"

if ss -tlnp | grep -q ":${HEALTH_PORT} "; then
  error "Port $HEALTH_PORT is still in use:"
  ss -tlnp | grep ":${HEALTH_PORT} "
  error "Stop the process using this port and re-run the script."
  exit 1
fi
success "Port $HEALTH_PORT is free"

# ---------- Step 4: Set up Docker deployment directory ----------

step "4/6 — Set up deployment directory"

mkdir -p "$DEPLOY_DIR"

# Copy docker-compose.yaml if not present
if [ ! -f "$DEPLOY_DIR/docker-compose.yaml" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  if [ -f "$SCRIPT_DIR/docker-compose.yaml" ]; then
    cp "$SCRIPT_DIR/docker-compose.yaml" "$DEPLOY_DIR/docker-compose.yaml"
    success "docker-compose.yaml copied from script directory"
  elif [ -f "$SCRIPT_DIR/../docker-compose.user.yaml" ]; then
    cp "$SCRIPT_DIR/../docker-compose.user.yaml" "$DEPLOY_DIR/docker-compose.yaml"
    success "docker-compose.yaml copied from repo (docker-compose.user.yaml)"
  else
    error "No docker-compose.yaml found. Copy docker-compose.user.yaml to $DEPLOY_DIR/docker-compose.yaml"
    exit 1
  fi
else
  success "docker-compose.yaml already exists"
fi

# Fix ownership
chown -R dustin:dustin "$DEPLOY_DIR"
success "Directory ready: $DEPLOY_DIR"

# ---------- Step 5: Pull image and start ----------

step "5/6 — Pull image and start container"

cd "$DEPLOY_DIR"

# Authenticate with GHCR (private registry)
GHCR_TOKEN="${GHCR_TOKEN:-}"
if [ -z "$GHCR_TOKEN" ]; then
  # Try reading from .env
  GHCR_TOKEN=$(grep -s '^GHCR_TOKEN=' "$DEPLOY_DIR/.env" | cut -d= -f2- || true)
fi
if [ -n "$GHCR_TOKEN" ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u icatel15 --password-stdin
  success "Authenticated with GHCR"
else
  error "GHCR_TOKEN not set. Create a GitHub PAT with read:packages scope and either:"
  error "  export GHCR_TOKEN=ghp_... before running this script, or"
  error "  add GHCR_TOKEN=ghp_... to $DEPLOY_DIR/.env"
  exit 1
fi

info "Pulling ghcr.io/icatel15/dustin:latest..."
docker compose pull dustin
success "Image pulled"

info "Starting container..."
docker compose up -d dustin
success "Container started"

# ---------- Step 6: Health check ----------

step "6/6 — Health check"

info "Waiting up to ${HEALTH_TIMEOUT}s for health..."
ELAPSED=0
while [ $ELAPSED -lt $HEALTH_TIMEOUT ]; do
  HEALTH=$(curl -sf "http://localhost:${HEALTH_PORT}/health" 2>/dev/null || true)
  if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo ""
    success "DUSTIN is healthy!"
    echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
    echo ""
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  printf "."
done

if [ $ELAPSED -ge $HEALTH_TIMEOUT ]; then
  echo ""
  warn "Health check did not pass within ${HEALTH_TIMEOUT}s"
  warn "Check logs: docker logs dustin"
  warn "Container status: docker ps -a"
  exit 1
fi

# ---------- Summary ----------

step "Migration Complete"

echo ""
success "DUSTIN is now running via Docker"
echo ""
info "Useful commands:"
echo "  docker logs -f dustin                    # Follow logs"
echo "  docker compose -f $DEPLOY_DIR/docker-compose.yaml restart dustin  # Restart"
echo "  docker ps                                # Container status"
echo "  curl localhost:${HEALTH_PORT}/health     # Health check"
echo ""
info "The old systemd service has been stopped and disabled."
info "To remove it completely:"
echo "  rm /etc/systemd/system/${SYSTEMD_SERVICE}.service && systemctl daemon-reload"
echo ""
info "CI/CD will now auto-deploy on merge to main."
echo ""
