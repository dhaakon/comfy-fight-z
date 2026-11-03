# Public demo hosting

The playable demo is **https://comfy-fight-z.dhaakon.com/**. It uses the existing AWS EC2 web server for `dhaakon.com`, with a separate Nginx site and a Let's Encrypt HTTPS certificate. Route 53 maps `comfy-fight-z.dhaakon.com` to `dhaakon.com` with a CNAME. HTTP redirects to HTTPS.

The public site contains six fighters, The Yard, 162 poses and 22 audio clips. The game runs in the visitor's browser, including its CPU opponent. The GITHUB navigation link opens the source repository.

## Prepare an update

From the repository root, choose fresh output paths:

```sh
npm ci
npm run example -- --out output/deploy/my-update/export --no-install
node build/tools/prepare-static-site.cjs --game output/deploy/my-update/export/game --out output/deploy/my-update
```

`npm run example` builds and tests the included assets without model calls. The packaging command writes `site/` with only runtime HTML, CSS, JavaScript, the MIT license and manifest-mapped media. Its adjacent `deployment.json` records every filename, size and SHA-256 hash. Source bundles, builder tools, server scripts, reports, dotfiles and credentials are excluded.

Upload **only the contents of `site/`** into a new release directory on the host. Verify every file against `deployment.json` before switching the `current` symlink. Keep the previous release for rollback. Reusing this process for a newly generated game requires a complete export with a passing `build-test.json` beside its `game/` directory.

## Server layout

| Path | Purpose |
| --- | --- |
| `/var/www/comfy-fight-z.dhaakon.com/releases/<release>/` | Independently uploaded, verified static releases |
| `/var/www/comfy-fight-z.dhaakon.com/current` | Symlink to the live release |
| `/var/www/comfy-fight-z.dhaakon.com/acme/` | Certificate validation webroot, separate from releases |
| `/etc/nginx/sites-available/comfy-fight-z.dhaakon.com` | Installed copy of [comfy-fight-z.nginx.conf](comfy-fight-z.nginx.conf) |

Run `sudo nginx -t` before a graceful reload when changing configuration. Certbot's existing timer renews the certificate using the persistent ACME webroot and reloads Nginx afterward. Renewal was verified with `sudo certbot renew --cert-name comfy-fight-z.dhaakon.com --dry-run --no-random-sleep-on-renew`.

After deploying, check HTTPS, the repository link, character selection, intro skipping, arrow/ASDF controls, touch controls and audio. Keep deployment receipts and browser captures under ignored `output/deploy/`. Local AWS credentials and private keys stay out of Git and the uploaded site.
