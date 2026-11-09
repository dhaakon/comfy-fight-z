# Public demo hosting

The playable demo is **https://comfy-fight-z.dhaakon.com/**. It uses the existing AWS EC2 web server for `dhaakon.com`, with a separate Nginx site and a Let's Encrypt HTTPS certificate. Route 53 maps `comfy-fight-z.dhaakon.com` to `dhaakon.com` with a CNAME. HTTP redirects to HTTPS.

The site serves the two fictional games from one static release: the original game at `/` (seven fictional parent heroes, three arenas, clips and living scenery) and Rogue Protocol at `/rogue-ai/` (six fictional rogue AI agents). The satire casts (Midterm Mayhem 2026, Billionaires Brawl) and the Ultra crossover that includes them stay local, so no public figure appears on the public site; the earlier phone-photo demo is retired. Each title screen lists the other under GAME SELECT with its generated title card. The GITHUB navigation link opens the source repository. Generation stays in the user's own ComfyUI workspace.

Single-player combat runs in the browser. **Online Versus** and **Phone Controllers** use a Node server behind Nginx: it owns the match state, rooms and pairing codes. Static hosting alone still supports the CPU game. See [Multiplayer and phone setup](../docs/multiplayer.md) for player instructions.

## Prepare an update

From the repository root, choose a fresh `output/deploy/<release>/` folder. Package each game that ships (a verified export's `game/` directory, or an installed crossover slot such as `output/games/ultra`, which the packer re-verifies through the crossover tool), then assemble them into one release:

```sh
npm ci
npm run example -- --out output/deploy/my-update/export --no-install
D=output/deploy/my-update
node build/tools/prepare-static-site.cjs --game $D/export/game --out $D/root
node build/tools/prepare-static-site.cjs --game output/exports/<rogue export>/game --out $D/rogue-ai   # one per mounted game; a crossover slot (output/games/<id>) works too
node build/tools/assemble-site-release.cjs --out $D/release --root $D/root --mount rogue-ai=$D/rogue-ai
```

`npm run example` builds and tests the included assets without model calls. Each packaging command writes `site/` with only runtime HTML, CSS, JavaScript, license notices and manifest-mapped media; its adjacent `deployment.json` records every filename, size and SHA-256 hash. Source bundles, builder tools, server scripts, reports, dotfiles and credentials are excluded. The assembler puts the root game at the top of `release/` and every other game under its mount folder, hard-links files that repeat across games (a crossover shares most of its media with its sources: the 2026-11-09 release maps 2.3 GB but holds 1.4 GB), and writes `SHA256SUMS` plus `release.json`.

Upload the release tree, the export's **`start-server.cjs`** (with its `LICENSE` and `THIRD-PARTY-NOTICES.txt`) and this folder's service, nginx and install files into a staging folder on the host, outside the webroot. A `tar` stream keeps the hard links (`tar -C $D/release -cf - . | ssh host 'tar -xf - -C ~/staging/<release>/release'`). Then run the installer there:

```sh
sudo bash ~/staging/<release>/deploy/install-release.sh ~/staging/<release> <release>
```

It checks every file against `SHA256SUMS`, moves the tree into `releases/<release>`, hard-links any retained mount named after the release (none now) from the live release, installs the backend under `/opt/comfy-fight-z/releases/<release>/`, installs the service and site files, tests nginx, switches both `current` symlinks, restarts the backend and curls every mount's index, `healthz` and `games.json`. The previous releases stay for rollback and the script prints the rollback commands. A new mount needs its folder in the service's `GAME_MOUNTS` and its name in the nginx proxy pattern before the install.

`start-server.cjs` bundles the Node backend and its dependencies. It needs Node.js 22 or newer, but no server-side `npm install`. The backend reads each game's `assets/manifest.json` and `engine.js` from the configured game root. Reusing this process for a newly generated game requires a complete export with a passing `build-test.json` beside its `game/` directory, or a crossover slot built by `crossover.cjs`.

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
| `GAME_MOUNTS={"/":".","/phone-photo-demo/":"phone-photo-demo","/billionaires-brawl/":"billionaires-brawl",…}` | Loads separate game definitions and room pools for every mounted URL; `games.json` lists them all for GAME SELECT. |
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

Nginx serves artwork, clips and sounds directly (with byte ranges, so the 1080p clips seek) and forwards these routes of every mount to the local Node service:

| Route under each mount | Purpose |
| --- | --- |
| `ws` | WebSocket transport for matches and phone pairing. |
| `runtime-config.js` | Browser paths and public URL settings. |
| `healthz` | Backend health endpoint for the mounted game. |
| `games.json` | The list every title screen's GAME SELECT shows. |

Keep the supplied HTTP/1.1 WebSocket upgrade headers and timeouts. The browser uses `wss://` when the game is loaded over HTTPS. A static-file fallback for `/ws`, or an HTTP-only socket on an HTTPS page, cannot establish multiplayer.

Every mount uses one backend process. Sessions are not shared between separate Node processes, so a multi-worker deployment would require additional shared-state and routing work. Intro and idle clips are 1080p MP4s; on a slow connection the game falls back to its sprite entrance when a clip has not buffered in time.

## Check an update

Run `sudo nginx -t` before a graceful reload when changing configuration. Certbot's existing timer renews the certificate using the persistent ACME webroot and reloads Nginx afterward. Renewal was verified with `sudo certbot renew --cert-name comfy-fight-z.dhaakon.com --dry-run --no-random-sleep-on-renew`.

After deploying, check every mount (the installer curls each one's index, `healthz` and `games.json`). Confirm HTTPS, the repository link, GAME SELECT with every title card, character selection with its idle loops, intro clips and skipping, arrow/ASDF controls, touch controls and audio. On a phone held upright, the title and select screens should play the portrait cuts (`assets/video/title-portrait.mp4`, `select-portrait.mp4`, 720 wide) after the ENTER THE GAME tap, pinching must not zoom the page, and a fight should hold a steady frame rate (the game drops to 30 drawn frames a second on a phone that cannot hold 60). Verify that `/runtime-config.js` returns the intended public base URL for each mount.

Then use separate browser sessions to create and join an online room, choose fighters, ready up and play. Start a shared display with one phone against the CPU and with two phones; check QR URLs, movement, attacks and reconnect pause/resume. Confirm that an invite from one game mount cannot join a room in the other. These are deployment checks to perform, not a claim that an untested host is ready.

Keep deployment receipts and browser captures under ignored `output/deploy/`. Local AWS credentials and private keys stay out of Git and the uploaded site. Never upload the whole working folder or private source bundles as the public site.
