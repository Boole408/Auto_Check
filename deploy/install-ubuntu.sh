#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
APP_DIR="/opt/auto-cw/app"
APP_USER="auto-cw"
APP_GROUP="auto-cw"
DATA_DIR="/var/lib/auto-cw"
ACCOUNTS_FILE="${DATA_DIR}/accounts.txt"
XEM8K5_ACCOUNTS_FILE="${DATA_DIR}/accounts.xem8k5.txt"
DGBMC_ACCOUNTS_FILE="${DATA_DIR}/accounts.dgbmc.txt"
JIUUIJ_ACCOUNTS_FILE="${DATA_DIR}/accounts.jiuuij.txt"
ANYROUTER_ACCOUNTS_FILE="${DATA_DIR}/accounts.anyrouter.txt"
ENV_FILE="${APP_DIR}/.env"
ENV_TEMPLATE="${PROJECT_ROOT}/deploy/.env.production.example"
SYSTEMD_TEMPLATE="${PROJECT_ROOT}/deploy/auto-cw.service"
NGINX_TEMPLATE="${PROJECT_ROOT}/deploy/autocw.ccwu.cc.nginx.conf"
NGINX_SITE="/etc/nginx/sites-available/auto-cw"
NGINX_ENABLED="/etc/nginx/sites-enabled/auto-cw"
CERTBOT_WEBROOT="/var/www/certbot"
DOMAIN="autocw.ccwu.cc"
DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT="3000"

step() {
  echo
  echo "==> $1"
}

info() {
  echo "[INFO] $1"
}

fail() {
  echo "[ERROR] $1" >&2
  exit 1
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf "%s" "$value"
}

run_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

require_repo_root() {
  local required_paths=(
    "package.json"
    "package-lock.json"
    "server/index.js"
    "dist/index.html"
    "deploy/.env.production.example"
    "deploy/auto-cw.service"
    "deploy/autocw.ccwu.cc.nginx.conf"
    "deploy/setup-swap.sh"
  )

  if [[ "$(pwd -P)" != "${PROJECT_ROOT}" ]]; then
    fail "Run this from the project root: bash deploy/install-ubuntu.sh"
  fi

  local relative_path
  for relative_path in "${required_paths[@]}"; do
    [[ -e "${PROJECT_ROOT}/${relative_path}" ]] || fail "Missing required file: ${relative_path}"
  done

  [[ "${PROJECT_ROOT}" == "${APP_DIR}" ]] || fail "Clone this repository to ${APP_DIR} and rerun the installer there."
}

require_supported_os() {
  [[ -f /etc/os-release ]] || fail "Cannot detect Linux distribution."
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID}" == "ubuntu" ]] || fail "Only Ubuntu is supported."
  local major_version="${VERSION_ID%%.*}"
  [[ "${major_version}" == "22" || "${major_version}" == "24" ]] || fail "Only Ubuntu 22.04 and 24.04 are supported."
}

ensure_user() {
  if id -u "${APP_USER}" >/dev/null 2>&1; then
    return
  fi

  if [[ -d /opt/auto-cw ]]; then
    run_root useradd --system --user-group --home-dir /opt/auto-cw --shell /bin/bash "${APP_USER}"
    return
  fi

  run_root useradd --system --user-group --create-home --home-dir /opt/auto-cw --shell /bin/bash "${APP_USER}"
}

run_as_app_user() {
  if [[ "$(id -un)" == "${APP_USER}" ]]; then
    bash -lc "$1"
  else
    sudo -u "${APP_USER}" -H bash -lc "$1"
  fi
}

prompt_value() {
  local label="$1"
  local default_value="$2"
  local value=""
  read -r -p "${label} [${default_value}]: " value
  value="$(trim "${value}")"
  printf "%s" "${value:-${default_value}}"
}

prompt_secret() {
  local label="$1"
  local value=""
  while true; do
    read -r -s -p "${label}: " value
    echo
    value="$(trim "${value}")"
    [[ -n "${value}" ]] && break
    echo "Value cannot be empty."
  done
  printf "%s" "${value}"
}

set_env_value() {
  local file_path="$1"
  local key="$2"
  local value="$3"
  local temp_file

  temp_file="$(mktemp)"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) {
        print key "=" value
      }
    }
  ' "${file_path}" > "${temp_file}"
  mv "${temp_file}" "${file_path}"
}

install_system_packages() {
  step "Installing system packages"
  run_root apt-get update
  run_root apt-get install -y curl ca-certificates gnupg git nginx certbot python3-certbot-nginx

  if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v20\.'; then
    step "Installing Node.js 20"
    curl -fsSL https://deb.nodesource.com/setup_20.x | run_root bash -
    run_root apt-get install -y nodejs
  fi
}

prepare_directories() {
  step "Preparing runtime directories"
  ensure_user
  run_root install -d -m 755 -o "${APP_USER}" -g "${APP_GROUP}" "${APP_DIR}" "${DATA_DIR}" "${CERTBOT_WEBROOT}"
  run_root install -d -m 755 -o "${APP_USER}" -g "${APP_GROUP}" "${APP_DIR}/.cache"
  local account_file
  for account_file in "${ACCOUNTS_FILE}" "${XEM8K5_ACCOUNTS_FILE}" "${DGBMC_ACCOUNTS_FILE}" "${JIUUIJ_ACCOUNTS_FILE}" "${ANYROUTER_ACCOUNTS_FILE}"; do
    if [[ -f "${account_file}" ]]; then
      run_root chown "${APP_USER}:${APP_GROUP}" "${account_file}"
      run_root chmod 600 "${account_file}"
    else
      run_root install -m 600 -o "${APP_USER}" -g "${APP_GROUP}" /dev/null "${account_file}"
    fi
  done
  run_root chown -R "${APP_USER}:${APP_GROUP}" /opt/auto-cw "${DATA_DIR}"
}

configure_environment() {
  step "Configuring environment"

  local login_username login_password session_secret
  login_username="$(prompt_value "APP_LOGIN_USERNAME" "admin")"
  login_password="$(prompt_secret "APP_LOGIN_PASSWORD")"
  session_secret="$(prompt_secret "APP_LOGIN_SESSION_SECRET")"

  local temp_env
  temp_env="$(mktemp)"
  cp "${ENV_TEMPLATE}" "${temp_env}"
  set_env_value "${temp_env}" "HOST" "${DEFAULT_HOST}"
  set_env_value "${temp_env}" "PORT" "${DEFAULT_PORT}"
  set_env_value "${temp_env}" "CORS_ORIGIN" "https://${DOMAIN}"
  set_env_value "${temp_env}" "APP_LOGIN_USERNAME" "${login_username}"
  set_env_value "${temp_env}" "APP_LOGIN_PASSWORD" "${login_password}"
  set_env_value "${temp_env}" "APP_LOGIN_SESSION_SECRET" "${session_secret}"
  set_env_value "${temp_env}" "MUYUAN_ACCOUNTS_FILE" "${ACCOUNTS_FILE}"
  set_env_value "${temp_env}" "XEM8K5_ACCOUNTS_FILE" "${XEM8K5_ACCOUNTS_FILE}"
  set_env_value "${temp_env}" "DGBMC_ACCOUNTS_FILE" "${DGBMC_ACCOUNTS_FILE}"
  set_env_value "${temp_env}" "JIUUIJ_ACCOUNTS_FILE" "${JIUUIJ_ACCOUNTS_FILE}"
  set_env_value "${temp_env}" "ANYROUTER_ACCOUNTS_FILE" "${ANYROUTER_ACCOUNTS_FILE}"
  run_root install -m 600 -o "${APP_USER}" -g "${APP_GROUP}" "${temp_env}" "${ENV_FILE}"
  rm -f "${temp_env}"
}

install_runtime_dependencies() {
  step "Installing runtime dependencies"
  run_as_app_user "cd '${APP_DIR}' && npm ci --omit=dev"
}

install_systemd_service() {
  step "Installing systemd service"
  run_root install -m 644 "${SYSTEMD_TEMPLATE}" /etc/systemd/system/auto-cw.service
  run_root systemctl daemon-reload
  run_root systemctl enable --now auto-cw.service
}

write_bootstrap_nginx_config() {
  local temp_config
  temp_config="$(mktemp)"

  cat > "${temp_config}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    location / {
        proxy_pass http://${DEFAULT_HOST}:${DEFAULT_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

  run_root install -m 644 "${temp_config}" "${NGINX_SITE}"
  rm -f "${temp_config}"
}

install_nginx_config() {
  step "Configuring nginx"
  write_bootstrap_nginx_config
  run_root rm -f /etc/nginx/sites-enabled/default
  run_root ln -sfn "${NGINX_SITE}" "${NGINX_ENABLED}"
  run_root nginx -t
  run_root systemctl reload nginx

  if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    local certbot_email
    certbot_email="$(prompt_value "Certbot email" "")"
    [[ -n "${certbot_email}" ]] || fail "Certbot email is required."

    step "Requesting HTTPS certificate"
    run_root certbot certonly --webroot -w "${CERTBOT_WEBROOT}" -d "${DOMAIN}" --email "${certbot_email}" --agree-tos --non-interactive
  fi

  run_root install -m 644 "${NGINX_TEMPLATE}" "${NGINX_SITE}"
  run_root nginx -t
  run_root systemctl reload nginx
}

verify_deployment() {
  step "Running verification"
  curl -fsS "http://${DEFAULT_HOST}:${DEFAULT_PORT}/api/health" >/dev/null || fail "Local health check failed."
  run_root systemctl is-active --quiet auto-cw.service || fail "auto-cw.service is not active."
}

print_summary() {
  step "Deployment complete"
  cat <<EOF
Domain: https://${DOMAIN}
Health check: http://${DEFAULT_HOST}:${DEFAULT_PORT}/api/health
Service: auto-cw.service

Next checks:
  sudo systemctl status auto-cw.service
  sudo journalctl -u auto-cw.service -n 100 --no-pager
  curl http://${DEFAULT_HOST}:${DEFAULT_PORT}/api/health
  curl -I https://${DOMAIN}/login
EOF
}

main() {
  require_repo_root
  require_supported_os
  install_system_packages
  bash "${PROJECT_ROOT}/deploy/setup-swap.sh"
  prepare_directories
  configure_environment
  install_runtime_dependencies
  install_systemd_service
  install_nginx_config
  verify_deployment
  print_summary
}

main "$@"
