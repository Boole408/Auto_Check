# Ubuntu 22.04 / 24.04 One-Click Deployment

This project is designed to run as a single Node.js process behind Nginx on one Ubuntu server.

## Layout

- App: `/opt/auto-cw/app`
- Data: `/opt/auto-cw/data/accounts.txt`
- Cache: `/opt/auto-cw/app/.cache`
- Logs: `/opt/auto-cw/logs`

## Prerequisites

- Ubuntu `22.04` or `24.04`
- A domain that already points to the server
- The full repository already present on the server
- Root or a user with `sudo` access

The helper enables UFW and opens `OpenSSH`, `80/tcp`, and `443/tcp`. If your server uses a custom SSH port, adjust `deploy/setup-ubuntu.sh` before the first run.

## One-Click Install

Run the installer from the repository root:

```bash
bash deploy/install-linux.sh
```

The installer will:

- verify the host OS and network access
- install Node.js, Nginx, PM2, Certbot, and swap helpers
- run `npm ci` and `npm run build` on the server
- publish the runtime bundle to `/opt/auto-cw/app`
- create or reuse `/opt/auto-cw/app/.env`
- create `/opt/auto-cw/data/accounts.txt` if it does not exist
- start and persist the PM2 process
- enable PM2 log rotation
- bootstrap Nginx, request the HTTPS certificate, and reload the final config
- run health and HTTPS verification checks

## Interactive Inputs

The installer prompts for:

- domain
- login username
- login password
- session secret
- `CAOWO_BASE_URL`
- `CAOWO_AUTO_CHECKIN_ENABLED`
- `CAOWO_AUTO_CHECKIN_TIME`
- `CAOWO_AUTO_CHECKIN_TZ`

If `/opt/auto-cw/app/.env` already exists, the installer lets you reuse it or regenerate it.

Certbot will prompt for the certificate contact email and Let's Encrypt terms on the first run.

## Rerun Behavior

- Existing `.env` can be reused without rewriting it.
- Existing `accounts.txt` is kept in place and only its ownership and permissions are fixed.
- Existing certificates are reused.
- Existing PM2 app is restarted with the latest published files.

## Manual Verification

```bash
curl http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/api/auth/session
curl -I https://your-domain/login
curl -I https://your-domain/quota-monitor

pm2 status
pm2 logs auto-cw --lines 50
```

## Storage Notes

- `accounts.txt` is rewritten in place when the dashboard import feature is used.
- `.cache/caowo-sessions.json` keeps only current-account, current-password, unexpired sessions.
- `.cache/caowo-auto-checkin.json` is overwritten in place.
- Check-in trend records are trimmed to the latest 7-day window in server memory before they are exposed to the dashboard.
