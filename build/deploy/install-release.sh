#!/usr/bin/env bash
# Install an uploaded release on the host and switch the live site to it.
#
#   sudo bash install-release.sh <staging dir> <release name> [retained mount ...]
#
# The staging dir (uploaded by the maintainer, outside the webroot) holds:
#   release/   the assembled static tree with SHA256SUMS and release.json (assemble-site-release.cjs)
#   backend/   start-server.cjs, LICENSE and THIRD-PARTY-NOTICES.txt from the same export
#   deploy/    comfy-fight-z.service and comfy-fight-z.nginx.conf
# Every file is checked against SHA256SUMS first. A retained mount (a game folder of the live release that the new
# release does not carry, such as phone-photo-demo) is hard-linked from the live release into the new one. The previous
# static and backend releases stay in place for rollback; the last lines print how.
set -euo pipefail

STAGE="${1:?staging dir}"; NAME="${2:?release name}"; shift 2
WEB=/var/www/comfy-fight-z.dhaakon.com
APP=/opt/comfy-fight-z
SERVICE=comfy-fight-z
SITE_CONF=/etc/nginx/sites-available/comfy-fight-z.dhaakon.com
HOST=https://comfy-fight-z.dhaakon.com

[[ "$NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$ ]] || { echo "Release names use letters, digits, dots, dashes and underscores." >&2; exit 2; }
for required in "$STAGE/release/SHA256SUMS" "$STAGE/release/release.json" "$STAGE/backend/start-server.cjs" "$STAGE/deploy/$SERVICE.service" "$STAGE/deploy/comfy-fight-z.nginx.conf"; do
  [[ -s "$required" ]] || { echo "Missing $required" >&2; exit 2; }
done
[[ -e "$WEB/releases/$NAME" || -e "$APP/releases/$NAME" ]] && { echo "Release $NAME already exists on this host." >&2; exit 2; }

echo "== verifying checksums"
( cd "$STAGE/release" && sha256sum --quiet -c SHA256SUMS )
echo "   $(wc -l < "$STAGE/release/SHA256SUMS") files match"

PREVIOUS_WEB="$(readlink -f "$WEB/current" || true)"
PREVIOUS_APP="$(readlink -f "$APP/current" || true)"

echo "== placing the static release"
mv "$STAGE/release" "$WEB/releases/$NAME"
for mount in "$@"; do
  [[ "$mount" =~ ^[a-z0-9][a-z0-9-]{1,31}$ ]] || { echo "Bad retained mount: $mount" >&2; exit 2; }
  if [[ -e "$WEB/releases/$NAME/$mount" ]]; then echo "   $mount is in the new release; nothing retained"; continue; fi
  [[ -d "$PREVIOUS_WEB/$mount" ]] || { echo "Retained mount $mount is not in the live release." >&2; exit 2; }
  cp -al "$PREVIOUS_WEB/$mount" "$WEB/releases/$NAME/$mount"
  echo "   retained $mount from $(basename "$PREVIOUS_WEB")"
done
chown -R root:root "$WEB/releases/$NAME"
find "$WEB/releases/$NAME" -type d -exec chmod 755 {} +
find "$WEB/releases/$NAME" -type f -exec chmod 644 {} +

echo "== placing the backend"
install -d -m 755 "$APP/releases/$NAME"
install -m 644 "$STAGE/backend/start-server.cjs" "$APP/releases/$NAME/start-server.cjs"
for notice in LICENSE THIRD-PARTY-NOTICES.txt; do [[ -f "$STAGE/backend/$notice" ]] && install -m 644 "$STAGE/backend/$notice" "$APP/releases/$NAME/$notice"; done

echo "== installing the service and site configuration"
install -m 644 "$STAGE/deploy/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"
install -m 644 "$STAGE/deploy/comfy-fight-z.nginx.conf" "$SITE_CONF"
nginx -t

echo "== switching"
ln -sfn "$WEB/releases/$NAME" "$WEB/current.tmp" && mv -T "$WEB/current.tmp" "$WEB/current"
ln -sfn "$APP/releases/$NAME" "$APP/current.tmp" && mv -T "$APP/current.tmp" "$APP/current"
systemctl daemon-reload
systemctl restart "$SERVICE"
systemctl reload nginx
sleep 2
systemctl is-active --quiet "$SERVICE" || { echo "The backend did not stay up; see journalctl -u $SERVICE" >&2; exit 1; }

echo "== checking every mount"
mounts="$(node -e 'const r=require(process.argv[1]); console.log(r.mounts.map(m => m.mount).join(" "))' "$WEB/releases/$NAME/release.json") $(for m in "$@"; do echo "/$m/"; done)"
for mount in $mounts; do
  health="$(curl -fsS --max-time 10 "$HOST${mount}healthz")" || { echo "   $mount healthz failed" >&2; exit 1; }
  games="$(curl -fsS --max-time 10 "$HOST${mount}games.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).games.length))')"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HOST${mount}")"
  echo "   $mount index $code, health ${health:0:16}..., games.json lists $games"
done

echo "== live: $NAME (static $WEB/current, backend $APP/current)"
echo "Rollback: ln -sfn '$PREVIOUS_WEB' $WEB/current.tmp && mv -T $WEB/current.tmp $WEB/current; ln -sfn '$PREVIOUS_APP' $APP/current.tmp && mv -T $APP/current.tmp $APP/current; systemctl restart $SERVICE"
