#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
APP_NAME="auto-cw"
BASE_DIR="/opt/auto-cw"
APP_DIR="${BASE_DIR}/app"
DATA_DIR="${BASE_DIR}/data"
LOG_DIR="${BASE_DIR}/logs"
CACHE_DIR="${APP_DIR}/.cache"
ACCOUNTS_FILE="${DATA_DIR}/accounts.txt"
ENV_FILE="${APP_DIR}/.env"
ENV_TEMPLATE="${PROJECT_ROOT}/deploy/.env.production.example"
PM2_TEMPLATE="${PROJECT_ROOT}/deploy/pm2.ecosystem.config.cjs"
NGINX_TEMPLATE="${PROJECT_ROOT}/deploy/cw-ops.nginx.conf"
NGINX_SITE="/etc/nginx/sites-available/${APP_NAME}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}"
CERTBOT_WEBROOT="/var/www/certbot"
PASSWORD_PLACEHOLDER="change-this-login-password"
SECRET_PLACEHOLDER="change-this-session-secret"
DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT="3000"
DEFAULT_USERNAME="admin"
DEFAULT_BASE_URL="https://caowo.xin"
DEFAULT_AUTO_CHECKIN_ENABLED="1"
DEFAULT_AUTO_CHECKIN_TIME="00:01"
DEFAULT_AUTO_CHECKIN_TZ="Asia/Shanghai"

DOMAIN=""
LOGIN_USERNAME="$DEFAULT_USERNAME"
LOGIN_PASSWORD=""
SESSION_SECRET=""
CAOWO_BASE_URL="$DEFAULT_BASE_URL"
AUTO_CHECKIN_ENABLED="$DEFAULT_AUTO_CHECKIN_ENABLED"
AUTO_CHECKIN_TIME="$DEFAULT_AUTO_CHECKIN_TIME"
AUTO_CHECKIN_TZ="$DEFAULT_AUTO_CHECKIN_TZ"
REUSE_EXISTING_ENV=false

step() {
  echo
  echo "==> $1"
}

info() {
  echo "[INFO] $1"
}

warn() {
  echo "[WARN] $1" >&2
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

resolve_app_user() {
  if [[ "${EUID}" -eq 0 && -n "${SUDO_USER:-}" ]]; then
    printf "%s" "${SUDO_USER}"
    return
  fi

  printf "%s" "$(id -un)"
}

APP_USER="$(resolve_app_user)"
APP_GROUP="$(id -gn "${APP_USER}")"
APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"
CURRENT_USER="$(id -un)"

run_app_user_shell() {
  if [[ "${CURRENT_USER}" == "${APP_USER}" ]]; then
    bash -lc "$1"
  else
    sudo -u "${APP_USER}" -H bash -lc "$1"
  fi
}

require_repo_root() {
  if [[ "$(pwd -P)" != "${PROJECT_ROOT}" ]]; then
    fail "Please run this from the project root with: bash deploy/install-linux.sh"
  fi

  local required_paths=(
    "package.json"
    "package-lock.json"
    "server/index.js"
    "deploy/setup-ubuntu.sh"
    "deploy/configure-pm2-logrotate.sh"
    "deploy/.env.production.example"
    "deploy/cw-ops.nginx.conf"
    "deploy/pm2.ecosystem.config.cjs"
  )

  local relative_path
  for relative_path in "${required_paths[@]}"; do
    [[ -e "${PROJECT_ROOT}/${relative_path}" ]] || fail "Missing required file: ${relative_path}"
  done
}

require_supported_os() {
  [[ -f /etc/os-release ]] || fail "Cannot detect Linux distribution. /etc/os-release is missing."
  # shellcheck disable=SC1091
  source /etc/os-release

  [[ "${ID}" == "ubuntu" ]] || fail "Only Ubuntu 22.04 and 24.04 are supported."
  local major_version="${VERSION_ID%%.*}"
  [[ "${major_version}" == "22" || "${major_version}" == "24" ]] || fail "Only Ubuntu 22.04 and 24.04 are supported."
}

require_network() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/ >/dev/null || fail "Network check failed for deb.nodesource.com"
    curl -fsSL https://registry.npmjs.org/ >/dev/null || fail "Network check failed for registry.npmjs.org"
    return
  fi

  getent hosts deb.nodesource.com >/dev/null || fail "DNS lookup failed for deb.nodesource.com"
  getent hosts registry.npmjs.org >/dev/null || fail "DNS lookup failed for registry.npmjs.org"
}

require_sudo_if_needed() {
  if [[ "${EUID}" -eq 0 ]]; then
    return
  fi

  command -v sudo >/dev/null 2>&1 || fail "sudo is required for system setup"
  sudo -v || fail "sudo authentication failed"
}

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || fail "Missing required command after setup: ${command_name}"
}

get_env_value() {
  local file_path="$1"
  local key="$2"

  [[ -f "${file_path}" ]] || return 0

  awk -F= -v key="${key}" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "${file_path}"
}

extract_domain_from_origin() {
  local origin="$1"
  origin="${origin#http://}"
  origin="${origin#https://}"
  origin="${origin%%/*}"
  origin="${origin%%:*}"
  printf "%s" "${origin}"
}

validate_domain() {
  local value="$1"
  [[ -n "${value}" ]] || return 1
  [[ "${value}" =~ ^[A-Za-z0-9.-]+$ ]] || return 1
  [[ "${value}" == *.* ]] || return 1
  [[ "${value}" != .* ]] || return 1
  [[ "${value}" != *..* ]] || return 1
}

validate_toggle() {
  [[ "$1" == "0" || "$1" == "1" ]]
}

validate_time() {
  [[ "$1" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]
}

validate_timezone() {
  local value="$1"
  [[ -n "${value}" ]] || return 1

  if command -v timedatectl >/dev/null 2>&1; then
    timedatectl list-timezones | grep -Fxq "${value}"
    return
  fi

  return 0
}

prompt_with_default() {
  local label="$1"
  local default_value="$2"
  local value=""

  read -r -p "${label} [${default_value}]: " value
  value="$(trim "${value}")"
  if [[ -z "${value}" ]]; then
    value="${default_value}"
  fi

  printf "%s" "${value}"
}

prompt_yes_no() {
  local label="$1"
  local default_answer="$2"
  local value=""

  while true; do
    read -r -p "${label} [${default_answer}]: " value
    value="$(trim "${value}")"
    value="${value:-${default_answer}}"

    case "${value}" in
      y|Y|yes|YES)
        return 0
        ;;
      n|N|no|NO)
        return 1
        ;;
      *)
        warn "Please answer y or n."
        ;;
    esac
  done
}

prompt_domain() {
  local default_value="$1"
  local value=""

  while true; do
    if [[ -n "${default_value}" ]]; then
      read -r -p "Domain [${default_value}]: " value
      value="$(trim "${value}")"
      value="${value:-${default_value}}"
    else
      read -r -p "Domain: " value
      value="$(trim "${value}")"
    fi

    if validate_domain "${value}"; then
      printf "%s" "${value}"
      return
    fi

    warn "Please enter a valid domain such as example.com"
  done
}

prompt_password() {
  local existing_value="$1"
  local value=""
  local prompt_label="Login password"

  while true; do
    if [[ -n "${existing_value}" && "${existing_value}" != "${PASSWORD_PLACEHOLDER}" && "${existing_value}" != "yuqiaa" ]]; then
      read -r -s -p "${prompt_label} [leave blank to keep existing]: " value
      echo
      value="${value:-${existing_value}}"
    else
      read -r -s -p "${prompt_label}: " value
      echo
      value="$(trim "${value}")"
    fi

    if [[ -z "${value}" ]]; then
      warn "Login password is required."
      continue
    fi

    if [[ "${value}" == "${PASSWORD_PLACEHOLDER}" || "${value}" == "yuqiaa" ]]; then
      warn "Login password must not use the default placeholder value."
      continue
    fi

    printf "%s" "${value}"
    return
  done
}

generate_session_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

retry_until_success() {
  local description="$1"
  local attempts="$2"
  local sleep_seconds="$3"
  shift 3

  local attempt=1
  while (( attempt <= attempts )); do
    if "$@"; then
      return 0
    fi

    if (( attempt == attempts )); then
      fail "${description} failed after ${attempts} attempts."
    fi

    info "${description} not ready yet (attempt ${attempt}/${attempts}), retrying in ${sleep_seconds}s..."
    sleep "${sleep_seconds}"
    ((attempt++))
  done
}

prompt_session_secret() {
  local generated_secret="$1"
  local value=""

  while true; do
    read -r -s -p "Session secret [leave blank to use a generated value]: " value
    echo
    value="${value:-${generated_secret}}"
    value="$(trim "${value}")"

    if [[ -z "${value}" ]]; then
      warn "Session secret is required."
      continue
    fi

    if [[ "${value}" == "${SECRET_PLACEHOLDER}" || "${value}" == "auto-cw-session-secret" ]]; then
      warn "Session secret must not use the default placeholder value."
      continue
    fi

    printf "%s" "${value}"
    return
  done
}

prompt_toggle() {
  local label="$1"
  local default_value="$2"
  local value=""

  while true; do
    value="$(prompt_with_default "${label}" "${default_value}")"
    if validate_toggle "${value}"; then
      printf "%s" "${value}"
      return
    fi

    warn "Please enter 0 or 1."
  done
}

prompt_time_value() {
  local label="$1"
  local default_value="$2"
  local value=""

  while true; do
    value="$(prompt_with_default "${label}" "${default_value}")"
    if validate_time "${value}"; then
      printf "%s" "${value}"
      return
    fi

    warn "Please enter time in HH:mm format."
  done
}

prompt_timezone() {
  local label="$1"
  local default_value="$2"
  local value=""

  while true; do
    value="$(prompt_with_default "${label}" "${default_value}")"
    if validate_timezone "${value}"; then
      printf "%s" "${value}"
      return
    fi

    warn "Please enter a valid timezone such as Asia/Shanghai."
  done
}

ensure_existing_env_is_reusable() {
  local existing_domain="$1"
  local existing_password="$2"
  local existing_secret="$3"

  if ! validate_domain "${existing_domain}"; then
    warn "Existing .env cannot be reused because CORS_ORIGIN does not contain a valid domain."
    return 1
  fi

  if [[ -z "${existing_password}" || "${existing_password}" == "${PASSWORD_PLACEHOLDER}" || "${existing_password}" == "yuqiaa" ]]; then
    warn "Existing .env cannot be reused because APP_LOGIN_PASSWORD is still using a placeholder or default value."
    return 1
  fi

  if [[ -z "${existing_secret}" || "${existing_secret}" == "${SECRET_PLACEHOLDER}" || "${existing_secret}" == "auto-cw-session-secret" ]]; then
    warn "Existing .env cannot be reused because APP_LOGIN_SESSION_SECRET is still using a placeholder or default value."
    return 1
  fi

  return 0
}

collect_configuration() {
  local existing_domain=""
  local existing_username=""
  local existing_password=""
  local existing_secret=""
  local existing_base_url=""
  local existing_auto_enabled=""
  local existing_auto_time=""
  local existing_auto_tz=""

  if [[ -f "${ENV_FILE}" ]]; then
    step "Existing environment detected"
    info "Found ${ENV_FILE}"

    existing_domain="$(extract_domain_from_origin "$(get_env_value "${ENV_FILE}" "CORS_ORIGIN")")"
    existing_username="$(get_env_value "${ENV_FILE}" "APP_LOGIN_USERNAME")"
    existing_password="$(get_env_value "${ENV_FILE}" "APP_LOGIN_PASSWORD")"
    existing_secret="$(get_env_value "${ENV_FILE}" "APP_LOGIN_SESSION_SECRET")"
    existing_base_url="$(get_env_value "${ENV_FILE}" "CAOWO_BASE_URL")"
    existing_auto_enabled="$(get_env_value "${ENV_FILE}" "CAOWO_AUTO_CHECKIN_ENABLED")"
    existing_auto_time="$(get_env_value "${ENV_FILE}" "CAOWO_AUTO_CHECKIN_TIME")"
    existing_auto_tz="$(get_env_value "${ENV_FILE}" "CAOWO_AUTO_CHECKIN_TZ")"

    if prompt_yes_no "Reuse the existing .env configuration?" "y"; then
      if ensure_existing_env_is_reusable "${existing_domain}" "${existing_password}" "${existing_secret}"; then
        REUSE_EXISTING_ENV=true
        DOMAIN="${existing_domain}"
        LOGIN_USERNAME="${existing_username:-${DEFAULT_USERNAME}}"
        LOGIN_PASSWORD="${existing_password}"
        SESSION_SECRET="${existing_secret}"
        CAOWO_BASE_URL="${existing_base_url:-${DEFAULT_BASE_URL}}"
        AUTO_CHECKIN_ENABLED="${existing_auto_enabled:-${DEFAULT_AUTO_CHECKIN_ENABLED}}"
        AUTO_CHECKIN_TIME="${existing_auto_time:-${DEFAULT_AUTO_CHECKIN_TIME}}"
        AUTO_CHECKIN_TZ="${existing_auto_tz:-${DEFAULT_AUTO_CHECKIN_TZ}}"
        return
      fi
    fi

    info "Regenerating .env with interactive values."
  fi

  local domain_default="${existing_domain}"
  local username_default="${existing_username:-${DEFAULT_USERNAME}}"
  local base_url_default="${existing_base_url:-${DEFAULT_BASE_URL}}"
  local auto_enabled_default="${existing_auto_enabled:-${DEFAULT_AUTO_CHECKIN_ENABLED}}"
  local auto_time_default="${existing_auto_time:-${DEFAULT_AUTO_CHECKIN_TIME}}"
  local auto_tz_default="${existing_auto_tz:-${DEFAULT_AUTO_CHECKIN_TZ}}"
  local generated_secret=""

  step "Collect deployment configuration"
  DOMAIN="$(prompt_domain "${domain_default}")"
  LOGIN_USERNAME="$(prompt_with_default "Login username" "${username_default}")"
  LOGIN_PASSWORD="$(prompt_password "${existing_password}")"
  generated_secret="$(generate_session_secret)"
  SESSION_SECRET="$(prompt_session_secret "${generated_secret}")"
  CAOWO_BASE_URL="$(prompt_with_default "CAOWO base URL" "${base_url_default}")"
  AUTO_CHECKIN_ENABLED="$(prompt_toggle "Enable auto check-in (0 or 1)" "${auto_enabled_default}")"
  AUTO_CHECKIN_TIME="$(prompt_time_value "Auto check-in time" "${auto_time_default}")"
  AUTO_CHECKIN_TZ="$(prompt_timezone "Auto check-in timezone" "${auto_tz_default}")"
}

run_system_setup() {
  step "Installing system dependencies"
  bash "${PROJECT_ROOT}/deploy/setup-ubuntu.sh"

  require_command node
  require_command npm
  require_command pm2
  require_command nginx
  require_command certbot
}

build_application() {
  step "Installing project dependencies"
  npm ci

  step "Building production assets"
  npm run build
}

prepare_runtime_layout() {
  step "Preparing runtime directories"
  run_root install -d -m 755 -o "${APP_USER}" -g "${APP_GROUP}" "${APP_DIR}" "${DATA_DIR}" "${LOG_DIR}" "${CACHE_DIR}"
}

stop_existing_app() {
  run_app_user_shell "pm2 describe ${APP_NAME} >/dev/null 2>&1 && pm2 stop ${APP_NAME} >/dev/null 2>&1 || true"
}

sync_runtime_files() {
  step "Publishing runtime bundle"
  stop_existing_app

  run_root rm -rf "${APP_DIR}/dist" "${APP_DIR}/server" "${APP_DIR}/node_modules"
  run_root cp -R "${PROJECT_ROOT}/dist" "${APP_DIR}/dist"
  run_root cp -R "${PROJECT_ROOT}/server" "${APP_DIR}/server"
  run_root install -m 644 -o "${APP_USER}" -g "${APP_GROUP}" "${PROJECT_ROOT}/package.json" "${APP_DIR}/package.json"
  run_root install -m 644 -o "${APP_USER}" -g "${APP_GROUP}" "${PROJECT_ROOT}/package-lock.json" "${APP_DIR}/package-lock.json"
  run_root install -m 644 -o "${APP_USER}" -g "${APP_GROUP}" "${PM2_TEMPLATE}" "${APP_DIR}/pm2.ecosystem.config.cjs"
  run_root chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}/dist" "${APP_DIR}/server" "${CACHE_DIR}"
}

install_runtime_dependencies() {
  step "Installing runtime dependencies"
  run_app_user_shell "cd '${APP_DIR}' && npm ci --omit=dev"
}

set_env_value() {
  local file_path="$1"
  local key="$2"
  local value="$3"
  local temp_file=""

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

write_env_file() {
  local temp_env=""
  temp_env="$(mktemp)"
  cp "${ENV_TEMPLATE}" "${temp_env}"

  set_env_value "${temp_env}" "NODE_ENV" "production"
  set_env_value "${temp_env}" "HOST" "${DEFAULT_HOST}"
  set_env_value "${temp_env}" "PORT" "${DEFAULT_PORT}"
  set_env_value "${temp_env}" "CORS_ORIGIN" "https://${DOMAIN}"
  set_env_value "${temp_env}" "APP_LOGIN_USERNAME" "${LOGIN_USERNAME}"
  set_env_value "${temp_env}" "APP_LOGIN_PASSWORD" "${LOGIN_PASSWORD}"
  set_env_value "${temp_env}" "APP_LOGIN_SESSION_SECRET" "${SESSION_SECRET}"
  set_env_value "${temp_env}" "CAOWO_BASE_URL" "${CAOWO_BASE_URL}"
  set_env_value "${temp_env}" "CAOWO_ACCOUNTS_FILE" "${ACCOUNTS_FILE}"
  set_env_value "${temp_env}" "CAOWO_AUTO_CHECKIN_ENABLED" "${AUTO_CHECKIN_ENABLED}"
  set_env_value "${temp_env}" "CAOWO_AUTO_CHECKIN_TIME" "${AUTO_CHECKIN_TIME}"
  set_env_value "${temp_env}" "CAOWO_AUTO_CHECKIN_TZ" "${AUTO_CHECKIN_TZ}"

  run_root install -m 600 -o "${APP_USER}" -g "${APP_GROUP}" "${temp_env}" "${ENV_FILE}"
  rm -f "${temp_env}"
}

configure_environment() {
  step "Configuring application environment"

  if [[ "${REUSE_EXISTING_ENV}" == true ]]; then
    info "Reusing ${ENV_FILE}"
    run_root chown "${APP_USER}:${APP_GROUP}" "${ENV_FILE}"
    run_root chmod 600 "${ENV_FILE}"
    return
  fi

  write_env_file
  info "Generated ${ENV_FILE}"
}

configure_accounts_file() {
  step "Ensuring account file exists"

  if [[ -f "${ACCOUNTS_FILE}" ]]; then
    info "Keeping existing ${ACCOUNTS_FILE}"
    run_root chown "${APP_USER}:${APP_GROUP}" "${ACCOUNTS_FILE}"
    run_root chmod 600 "${ACCOUNTS_FILE}"
    return
  fi

  run_root install -m 600 -o "${APP_USER}" -g "${APP_GROUP}" /dev/null "${ACCOUNTS_FILE}"
}

setup_pm2() {
  step "Starting PM2 application"
  run_app_user_shell "cd '${APP_DIR}' && pm2 startOrRestart pm2.ecosystem.config.cjs --only ${APP_NAME}"
  run_app_user_shell "pm2 save"

  step "Registering PM2 startup service"
  run_root env PATH="${PATH}" "$(command -v pm2)" startup systemd -u "${APP_USER}" --hp "${APP_HOME}" >/dev/null

  step "Configuring PM2 log rotation"
  run_app_user_shell "cd '${PROJECT_ROOT}' && bash deploy/configure-pm2-logrotate.sh"
}

render_bootstrap_nginx_config() {
  local temp_config=""
  temp_config="$(mktemp)"

  cat > "${temp_config}" <<EOF
upstream auto_cw_app {
    server 127.0.0.1:${DEFAULT_PORT};
    keepalive 16;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    location / {
        proxy_pass http://auto_cw_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_connect_timeout 60s;
    }
}
EOF

  run_root install -m 644 "${temp_config}" "${NGINX_SITE}"
  rm -f "${temp_config}"
}

render_final_nginx_config() {
  local temp_config=""
  temp_config="$(mktemp)"
  sed "s/example.com/${DOMAIN}/g" "${NGINX_TEMPLATE}" > "${temp_config}"
  run_root install -m 644 "${temp_config}" "${NGINX_SITE}"
  rm -f "${temp_config}"
}

enable_nginx_site() {
  run_root ln -sfn "${NGINX_SITE}" "${NGINX_ENABLED}"
}

reload_nginx() {
  run_root nginx -t
  run_root systemctl reload nginx
}

ensure_certificate() {
  if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    info "Existing certificate detected for ${DOMAIN}"
    return
  fi

  step "Bootstrapping Nginx for certificate issuance"
  render_bootstrap_nginx_config
  enable_nginx_site
  reload_nginx

  step "Requesting HTTPS certificate with Certbot"
  if ! run_root certbot certonly --webroot -w "${CERTBOT_WEBROOT}" -d "${DOMAIN}"; then
    fail "Certbot failed. Check that DNS for ${DOMAIN} points to this server, then rerun the installer."
  fi
}

configure_nginx() {
  step "Configuring Nginx"
  ensure_certificate
  render_final_nginx_config
  enable_nginx_site
  reload_nginx
}

verify_deployment() {
  step "Running deployment verification"
  retry_until_success "Application health check" 15 2 curl -fsS "http://${DEFAULT_HOST}:${DEFAULT_PORT}/api/health" >/dev/null
  retry_until_success "HTTPS verification for /login" 10 3 curl -fsS -I "https://${DOMAIN}/login" >/dev/null
  retry_until_success "HTTPS verification for /quota-monitor" 10 3 curl -fsS -I "https://${DOMAIN}/quota-monitor" >/dev/null
  run_app_user_shell "pm2 describe ${APP_NAME} >/dev/null" || fail "PM2 application ${APP_NAME} is not online"
}

print_summary() {
  step "Deployment complete"
  cat <<EOF
Application: ${APP_NAME}
App directory: ${APP_DIR}
Data directory: ${DATA_DIR}
Logs directory: ${LOG_DIR}
Domain: ${DOMAIN}
Health check: http://${DEFAULT_HOST}:${DEFAULT_PORT}/api/health
Login page: https://${DOMAIN}/login
Dashboard: https://${DOMAIN}/quota-monitor

Next checks:
  pm2 status
  pm2 logs ${APP_NAME} --lines 50
  curl http://${DEFAULT_HOST}:${DEFAULT_PORT}/api/health
EOF
}

main() {
  step "Preflight checks"
  require_repo_root
  require_supported_os
  require_network
  require_sudo_if_needed
  info "Deploying as app user: ${APP_USER}"

  collect_configuration
  run_system_setup
  build_application
  prepare_runtime_layout
  sync_runtime_files
  install_runtime_dependencies
  configure_environment
  configure_accounts_file
  setup_pm2
  configure_nginx
  verify_deployment
  print_summary
}

main "$@"
