# Server Deployment — joebox

**Date:** 2026-04-03
**Server:** Ubuntu 25.10 (Questing Quokka) LXC container

---

## Server Overview

The personal website runs on a Linux server accessible via Tailscale at `100.80.140.57`. It serves the static production build via nginx and runs the converter service (FreeCAD-backed) via Node.js managed by pm2.

| Component | Version | Purpose |
|-----------|---------|---------|
| Ubuntu | 25.10 | OS |
| Node.js | 22.22.2 | Converter service runtime |
| npm | 10.9.7 | Package management |
| nginx | (apt default) | Static file server + reverse proxy |
| FreeCAD | 1.0.0 | Headless CAD engine for conversions |
| Python | 3.13.7 | FreeCAD scripting runtime |
| pm2 | (npm global) | Process manager for converter service |
| git | 2.51.0 | Repo management |

### Python Packages (system-wide via `--break-system-packages`)
- `trimesh` — mesh analysis for parametric STEP
- `pyransac3d` — RANSAC surface fitting
- `rtree` — spatial indexing

---

## Architecture

```
Browser → http://100.80.140.57
            │
            ├─ / (static)  → nginx serves ~/PersonalWebsite/dist/
            │
            └─ /api/*       → nginx proxies to http://127.0.0.1:8090
                                → converter-server.js (pm2 managed)
                                    → freecadcmd (headless, via FREECAD_CMD env)
```

### nginx Configuration

**File:** `/etc/nginx/sites-available/default`

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    root /home/joe/PersonalWebsite/dist;
    index index.html;

    server_name _;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8090/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
        client_max_body_size 120M;
    }
}
```

**Key settings:**
- `proxy_read_timeout 300s` — parametric STEP conversion can take up to 240s
- `client_max_body_size 120M` — matches converter's `MAX_UPLOAD_BYTES` (120 MB)
- `try_files $uri $uri/ /index.html` — SPA fallback for client-side routing

### Converter Service (pm2)

**Process name:** `converter`
**Port:** 8090 (localhost only — nginx proxies external requests)
**Environment variable:** `FREECAD_CMD=/usr/bin/freecadcmd`

The env var is set in `~/.bashrc` and was active when pm2 first started the process. pm2 saves the environment at start time.

---

## File Locations

| What | Path |
|------|------|
| Website repo | `/home/joe/PersonalWebsite/` |
| Production build | `/home/joe/PersonalWebsite/dist/` |
| nginx config | `/etc/nginx/sites-available/default` |
| nginx error log | `/var/log/nginx/error.log` |
| nginx access log | `/var/log/nginx/access.log` |
| pm2 logs | `~/.pm2/logs/converter-out.log`, `converter-error.log` |
| FreeCAD binary | `/usr/bin/freecadcmd` |
| Python | `/usr/bin/python3` |

---

## Common Operations

### Deploy new code

```bash
cd ~/PersonalWebsite
git pull
npm run build
```

Then hard-refresh the browser (`Ctrl+Shift+R`) to bypass cache. No nginx or pm2 restart needed for static changes. If `converter-server.js` changed:

```bash
pm2 restart converter
```

### Check service status

```bash
# Converter service
pm2 status
pm2 logs converter --lines 20

# nginx
sudo systemctl status nginx --no-pager

# Health check
curl http://127.0.0.1:8090/api/health
```

### Restart services

```bash
# Converter
pm2 restart converter

# nginx
sudo systemctl reload nginx    # reload config (no downtime)
sudo systemctl restart nginx   # full restart
```

### View logs

```bash
# Converter output
pm2 logs converter --lines 50

# nginx errors
sudo tail -50 /var/log/nginx/error.log

# nginx access
sudo tail -50 /var/log/nginx/access.log
```

### Stop/start converter

```bash
pm2 stop converter
pm2 start converter
pm2 save    # persist the current state for reboot
```

---

## Troubleshooting

### "Permission denied" on dist files
nginx runs as `www-data` and needs execute permission on `/home/joe`:
```bash
chmod 755 /home/joe
```

### Converter 502 errors
The converter service isn't running or crashed:
```bash
pm2 status              # check if online
pm2 logs converter      # check for errors
pm2 restart converter   # restart it
```

### FreeCAD "could not connect to display"
FreeCAD needs `freecadcmd` (not `freecad`) for headless operation. The `FREECAD_CMD` env var must point to `/usr/bin/freecadcmd`. Verify:
```bash
echo $FREECAD_CMD
QT_QPA_PLATFORM=offscreen freecadcmd --version
```

### Stale browser cache
After deploying, the browser may serve cached JS/CSS. Hard-refresh with `Ctrl+Shift+R` or open incognito. For production, consider adding content hashes to webpack output filenames.

### pip "externally-managed-environment"
Ubuntu 25.10 blocks system-wide pip installs (PEP 668). Use `--break-system-packages`:
```bash
pip3 install --break-system-packages <package>
```
Safe for scientific libraries (trimesh, pyransac3d, rtree) that don't conflict with system packages.

---

## Boot Persistence

pm2 is configured to auto-start on boot via systemd:
```bash
pm2 startup    # generates the systemd command
pm2 save       # saves current process list
```

The systemd unit was created with:
```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u joe --hp /home/joe
```

---

## Security Notes

- **SSH credentials** are in `joebox_info.txt` (local only, gitignored)
- **No HTTPS yet** — traffic is unencrypted over HTTP
- **No firewall (UFW)** — the LXC host manages network rules
- **Converter listens on localhost:8090 only** — not directly exposed to the network
- The server is accessible via Tailscale IP (`100.80.140.57`), not the public internet (unless the host forwards ports)

---

## What's NOT Set Up Yet

- **Domain name** — currently accessed by IP only
- **HTTPS / TLS** — needs a domain first, then Let's Encrypt / certbot
- **Firewall (UFW)** — may not be needed if LXC host handles it
- **Automated deployment** — currently manual `git pull && npm run build`
- **Log rotation** — pm2 logs will grow indefinitely; consider `pm2 install pm2-logrotate`
- **Backup** — no automated backup of the server or repo
