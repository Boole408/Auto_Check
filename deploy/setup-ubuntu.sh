#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

run_root apt-get update
run_root apt-get install -y curl ca-certificates gnupg lsb-release software-properties-common openssl ufw

if [[ "${EUID}" -eq 0 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
fi

run_root apt-get install -y nodejs nginx certbot python3-certbot-nginx
run_root npm install -g pm2

"${SCRIPT_DIR}/setup-swap.sh"

run_root mkdir -p /var/www/certbot
run_root ufw allow OpenSSH
run_root ufw allow 80/tcp
run_root ufw allow 443/tcp
run_root ufw --force enable

node -v
npm -v
pm2 -v
nginx -v
