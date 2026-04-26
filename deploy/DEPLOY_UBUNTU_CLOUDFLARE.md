# Auto_CW Ubuntu Deployment

This directory contains the production deployment assets for `autocw.ccwu.cc`.

## Target topology

- Cloudflare proxy enabled
- Ubuntu 22.04 or 24.04
- Node.js 20
- Nginx + systemd
- App listens on `127.0.0.1:3000`
- Public entrypoint is `https://autocw.ccwu.cc`

## Files

- `deploy/.env.production.example`: production env template
- `deploy/auto-cw.service`: `systemd` unit
- `deploy/autocw.ccwu.cc.nginx.conf`: final Nginx site config
- `deploy/setup-swap.sh`: swap helper for low-memory servers
- `deploy/install-ubuntu.sh`: end-to-end Ubuntu installer

## Server preparation

1. In Cloudflare, create an `A` record for `autocw.ccwu.cc` that points to `38.55.146.171`.
2. Keep the record proxied.
3. Set Cloudflare SSL mode to `Full (strict)`.
4. Clone the repository on the server to `/opt/auto-cw/app`.

Example:

```bash
sudo mkdir -p /opt/auto-cw
sudo chown "$USER":"$USER" /opt/auto-cw
git clone <your-private-repo-url> /opt/auto-cw/app
cd /opt/auto-cw/app
```

If the repository is private, configure an SSH deploy key or a GitHub token before cloning.

## Install

Run the installer from the repository root on the server:

```bash
bash deploy/install-ubuntu.sh
```

The installer will:

- install Node.js 20, Nginx, Certbot, Git, and build prerequisites
- create the `auto-cw` runtime user
- provision swap on low-memory hosts when needed
- create `/var/lib/auto-cw/accounts.txt`
- generate `/opt/auto-cw/app/.env`
- run `npm ci` and `npm run build`
- install `auto-cw.service`
- request an HTTPS certificate for `autocw.ccwu.cc`
- install and reload the Nginx site

## Post-deploy checks

```bash
curl http://127.0.0.1:3000/api/health
curl -I https://autocw.ccwu.cc/login
sudo systemctl status auto-cw.service
sudo journalctl -u auto-cw.service -n 100 --no-pager
```

## Release flow

```bash
cd /opt/auto-cw/app
git pull --ff-only
npm ci
npm run build
sudo systemctl restart auto-cw.service
```

## Notes

- The app state cache is stored in `/opt/auto-cw/app/.cache/`.
- The account file is stored in `/var/lib/auto-cw/accounts.txt`.
- Open ports `80` and `443` on the server firewall before requesting certificates.
