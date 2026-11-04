# Public demo hosting

The playable demo is **https://comfy-fight-z.dhaakon.com/**. It uses the existing AWS EC2 web server for `dhaakon.com`, with a separate Nginx site and a Let's Encrypt HTTPS certificate. Route 53 maps `comfy-fight-z.dhaakon.com` to `dhaakon.com` with a CNAME. HTTP redirects to HTTPS.

The site keeps two separate fictional asset sets: the included game at `/` and the newer phone-photo game at `/phone-photo-demo/`. Each contains six fighters, The Yard, 162 poses and 22 audio clips. The GITHUB navigation link opens the source repository. Generation stays in the user's own ComfyUI workspace.

Single-player combat runs in the browser. **Online Versus** and **Phone Controllers** use a Node server behind Nginx: it owns the match state, rooms and pairing codes. Static hosting alone still supports the CPU game. See [Multiplayer and phone setup](../docs/multiplayer.md) for player instructions.

## Prepare an update

From the repository root, choose fresh output paths:

```sh
npm ci
npm run example -- --out output/deploy/my-update/export --no-install
node build/tools/prepare-static-site.cjs --game output/deploy/my-update/export/game --out output/deploy/my-update
```

`npm run example` builds and tests the included assets without model calls. The packaging command writes `site/` with only runtime HTML, CSS, JavaScript, license notices and manifest-mapped media. Its adjacent `deployment.json` records every filename, size and SHA-256 hash. Source bundles, builder tools, server scripts, reports, dotfiles and credentials are excluded.

Upload **only the contents of `site/`** into a new release directory on the host. Verify every file against `deployment.json` before switching the `current` symlink. Keep the previous release for rollback. Reusing this process for a newly generated game requires a complete export with a passing `build-test.json` beside its `game/` directory.

For this site's two-game layout, package each verified export separately. Put the included game's runtime files at the release root and the phone-photo game's runtime files under `phone-photo-demo/`. Keep both media sets and verify both packaging reports. A runtime refresh should rebuild each accepted source bundle; it should not replace the phone-photo cast with the included example.

The export also contains **`start-server.cjs`**, which bundles the Node backend and its dependencies. Upload this file separately under `/opt/comfy-fight-z/releases/<release>/`, outside the public webroot, and point `/opt/comfy-fight-z/current` at that backend release. It needs Node.js 22 or newer, but no server-side `npm install`. The backend reads each game's `assets/manifest.json` and `engine.js` from the configured game root.

The browser builder receives its server bundle from `npm run bundle:server`; `npm run example` and `npm run build:bundle` create that bundle automatically. Do not copy the repository's unbundled `build/server/start.cjs` in place of the exported `start-server.cjs`.

## Server layout

| Path | Purpose |
| --- | --- |
| `/var/www/comfy-fight-z.dhaakon.com/releases/<release>/` | Independently uploaded, verified static releases |
| `/var/www/comfy-fight-z.dhaakon.com/current` | Symlink to the live release |
| `/var/www/comfy-fight-z.dhaakon.com/acme/` | Certificate validation webroot, separate from releases |
| `/opt/comfy-fight-z/releases/<release>/start-server.cjs` | Bundled Node backend, outside the public webroot |
| `/opt/comfy-fight-z/current` | Symlink to the active backend release |
| `/etc/systemd/system/comfy-fight-z.service` | Installed copy of [comfy-fight-z.service](comfy-fight-z.service) |
| `/etc/nginx/sites-available/comfy-fight-z.dhaakon.com` | Installed copy of [comfy-fight-z.nginx.conf](comfy-fight-z.nginx.conf) |

## Run the multiplayer service

The supplied systemd unit runs the bundled backend as `www-data`, bound only to **`127.0.0.1:8095`**. Adapt its paths and domain for your own host before installing it.

| Setting | Purpose in this deployment |
| --- | --- |
| `GAME_ROOT=/var/www/comfy-fight-z.dhaakon.com/current` | Reads the active static release's game manifests and engine. |
| `GAME_MOUNTS={"/":".","/phone-photo-demo/":"phone-photo-demo"}` | Loads separate game definitions and room pools for the two URLs. |
| `PUBLIC_URL=https://comfy-fight-z.dhaakon.com/` | Produces public invitation and QR addresses. |
| `PUBLIC_ORIGINS=https://comfy-fight-z.dhaakon.com` | Allows browser connections from the game's own origin. |
| `SERVE_STATIC=0` | Leaves media and other static files to Nginx. |
| `TRUST_PROXY=1` | Uses the expected local proxy deployment. |

Make the backend file and public release readable by `www-data`. Install the service and the Nginx site, then use the host's service manager:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now comfy-fight-z
sudo systemctl status comfy-fight-z --no-pager
sudo nginx -t
sudo systemctl reload nginx
```

After updating the backend bundle or switching game releases, restart `comfy-fight-z` so it loads the new manifests. Room state is in memory, so restarting ends active matches. Keep the matching previous backend and static releases together for rollback.

## Proxy HTTPS and WebSockets

Nginx serves artwork directly and forwards these routes to the local Node service:

| Included demo | Phone-photo demo | Purpose |
| --- | --- | --- |
| `/ws` | `/phone-photo-demo/ws` | WebSocket transport for matches and phone pairing. |
| `/runtime-config.js` | `/phone-photo-demo/runtime-config.js` | Browser paths and public URL settings. |
| `/healthz` | `/phone-photo-demo/healthz` | Backend health endpoint for the mounted game. |

Keep the supplied HTTP/1.1 WebSocket upgrade headers and timeouts. The browser uses `wss://` when the game is loaded over HTTPS. A static-file fallback for `/ws`, or an HTTP-only socket on an HTTPS page, cannot establish multiplayer.

Both URL mounts use one backend process. Sessions are not shared between separate Node processes, so a multi-worker deployment would require additional shared-state and routing work.

## Check an update

Run `sudo nginx -t` before a graceful reload when changing configuration. Certbot's existing timer renews the certificate using the persistent ACME webroot and reloads Nginx afterward. Renewal was verified with `sudo certbot renew --cert-name comfy-fight-z.dhaakon.com --dry-run --no-random-sleep-on-renew`.

After deploying, check both demo URLs. Confirm HTTPS, the repository link, character selection, intro skipping, arrow/ASDF controls, touch controls and audio. Check both health endpoints and verify that `/runtime-config.js` returns the intended public base URL for each mount.

Then use separate browser sessions to create and join an online room, choose fighters, ready up and play. Start a shared display with one phone against the CPU and with two phones; check QR URLs, movement, attacks and reconnect pause/resume. Confirm that an invite from one game mount cannot join a room in the other. These are deployment checks to perform, not a claim that an untested host is ready.

Keep deployment receipts and browser captures under ignored `output/deploy/`. Local AWS credentials and private keys stay out of Git and the uploaded site. Never upload the whole working folder or private source bundles as the public site.
