#!/bin/bash
# Generate an SSH deploy key for CI/CD and print setup instructions.
#
# Usage:
#   bash scripts/setup-deploy-key.sh
#
# This script:
#   1. Generates an ed25519 SSH key pair (dustin-deploy / dustin-deploy.pub)
#   2. Prints the public key (add to VPS)
#   3. Prints the private key (add to GitHub secret)
#   4. Prints step-by-step instructions

set -euo pipefail

KEY_NAME="dustin-deploy"
KEY_PATH="$HOME/.ssh/$KEY_NAME"
VPS_USER="dustin"

# ---------- Colors ----------

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[*]${NC} $1"; }
success() { echo -e "${GREEN}[+]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
step()    { echo -e "\n${BOLD}--- $1 ---${NC}"; }

# ---------- Generate key ----------

step "Generate deploy key"

if [ -f "$KEY_PATH" ]; then
  warn "Key already exists at $KEY_PATH"
  warn "Using existing key. Delete it and re-run to generate a new one."
else
  ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "dustin-ci-deploy"
  success "Key pair generated at $KEY_PATH"
fi

# ---------- Instructions ----------

step "Step 1: Add public key to VPS"

echo ""
echo "Run this command to add the public key to the VPS:"
echo ""
echo -e "${BOLD}  ssh root@\$VPS_IP \"mkdir -p /home/$VPS_USER/.ssh && echo '$(cat "$KEY_PATH.pub")' >> /home/$VPS_USER/.ssh/authorized_keys && chown -R $VPS_USER:$VPS_USER /home/$VPS_USER/.ssh && chmod 700 /home/$VPS_USER/.ssh && chmod 600 /home/$VPS_USER/.ssh/authorized_keys\"${NC}"
echo ""

step "Step 2: Test SSH access"

echo ""
echo "Verify the key works:"
echo ""
echo -e "${BOLD}  ssh -i $KEY_PATH $VPS_USER@\$VPS_IP 'echo connected'${NC}"
echo ""

step "Step 3: Add private key to GitHub"

echo ""
echo "Go to: https://github.com/<owner>/<repo>/settings/secrets/actions"
echo ""
echo "Create these secrets:"
echo ""
echo -e "${BOLD}VPS_SSH_KEY${NC} — paste the private key below:"
echo ""
echo "────────────────────────────────────────"
cat "$KEY_PATH"
echo "────────────────────────────────────────"
echo ""
echo -e "${BOLD}VPS_HOST${NC} — paste the VPS IP address:"
echo ""
echo "  178.104.134.128"
echo ""

step "Step 4: Create GitHub PAT for VPS GHCR pull"

echo ""
echo "The VPS needs to pull private images from GHCR. Create a PAT:"
echo ""
echo "  1. Go to: https://github.com/settings/tokens?type=beta"
echo "  2. Generate new token (Fine-grained)"
echo "  3. Name: dustin-vps-pull"
echo "  4. Expiration: 90 days (or longer)"
echo "  5. Repository access: Only select repositories → pick the DUSTIN repo"
echo "  6. Permissions: Packages → Read"
echo "  7. Generate token and save it"
echo ""

step "Step 5: Run the migration"

echo ""
echo "Once secrets are set and PAT is created:"
echo ""
echo "  1. Merge the CI/CD changes to main"
echo "     → This triggers the deploy workflow, which builds + pushes the image"
echo "     → The deploy step will fail (Docker not on VPS yet) — that's expected"
echo ""
echo "  2. Copy files to VPS and run the migration:"
echo ""
echo -e "${BOLD}     scp docker-compose.user.yaml $VPS_USER@\$VPS_IP:/home/$VPS_USER/app/docker-compose.yaml"
echo "     scp scripts/migrate-to-docker.sh $VPS_USER@\$VPS_IP:/tmp/"
echo "     ssh root@\$VPS_IP 'GHCR_TOKEN=<your-pat> bash /tmp/migrate-to-docker.sh'${NC}"
echo ""
echo "  3. After migration, all future merges to main auto-deploy."
echo ""

success "Setup instructions complete. Follow steps 1-5 above."
echo ""
