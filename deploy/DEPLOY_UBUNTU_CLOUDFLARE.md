# AutoCheck Ubuntu Deployment

This directory contains the production deployment assets for the AutoCheck panel hosted at `autocw.ccwu.cc`.

## Target topology

- Cloudflare proxy enabled
- Ubuntu 22.04 or 24.04
- Node.js 20
- Local build + server runtime install
- Nginx + systemd
- App listens on `127.0.0.1:3000`
- Public entrypoint is `https://autocw.ccwu.cc`

## Files

- `deploy/.env.production.example`: production env template
- `deploy/auto-cw.service`: `systemd` unit
- `deploy/autocw.ccwu.cc.nginx.conf`: final Nginx site config
- `deploy/setup-swap.sh`: swap helper for low-memory servers
- `deploy/install-ubuntu.sh`: Ubuntu runtime installer
- `scripts/prepare-release.js`: local release bundle generator

## Local release build

Build the frontend and prepare a release directory on your local machine:

```bash
npm ci
npm run build:release
```

The generated bundle will be placed at:

```text
.release/app
```

Upload that directory to the server so it becomes `/opt/auto-cw/app`.

Example with `scp`:

```bash
scp -r .release/app/. deployer@38.55.146.171:/opt/auto-cw/app/
```

If `/opt/auto-cw/app` already contains an older release, replace its contents with the new bundle before running the installer or restarting the service.

## Server preparation

1. In Cloudflare, create an `A` record for `autocw.ccwu.cc` that points to `38.55.146.171`.
2. Keep the record proxied.
3. Set Cloudflare SSL mode to `Full (strict)`.
4. Create `/opt/auto-cw/app` on the server and upload the local release bundle there.

## Install

Run the installer from the repository root on the server:

```bash
bash deploy/install-ubuntu.sh
```

The installer will:

- install Node.js 20, Nginx, Certbot, and Git
- create the `auto-cw` runtime user
- provision swap on low-memory hosts when needed
- create `/var/lib/auto-cw/accounts.txt`
- generate `/opt/auto-cw/app/.env`
- run `npm ci --omit=dev`
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
npm ci --omit=dev
sudo systemctl restart auto-cw.service
```

Before the commands above, upload the fresh `.release/app` contents from your local machine to `/opt/auto-cw/app`.

## Notes

- The app state cache is stored in `/opt/auto-cw/app/.cache/`.
- The account file is stored in `/var/lib/auto-cw/accounts.txt`.
- Open ports `80` and `443` on the server firewall before requesting certificates.
