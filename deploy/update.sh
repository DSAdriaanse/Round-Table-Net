#!/usr/bin/env bash
# Runs ON THE SERVER. Builds the app from the git clone and releases it.
# Installed as /usr/local/bin/<name>-update by bootstrap.sh (round-table-net-update for the default instance).
# The instance name is taken from the command's own name, so a second instance installed with
# --name blog gets /usr/local/bin/blog-update and its own folders. NAME=... in the environment overrides it.
#
#   round-table-net-update                 pull the branch, build, release (backup, health check, rollback)
#   round-table-net-update --branch main   switch branch first
#   round-table-net-update --setup --domain ... --email ... [--port N] [--superuser-email ...]   (used by bootstrap.sh)
set -euo pipefail
export PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"

if [ -z "${NAME:-}" ]; then
  NAME=$(basename "$0"); NAME=${NAME%-update}
  [ "$NAME" != "$(basename "$0")" ] || NAME=round-table-net     # run as update.sh, not through the installed command
fi
export NAME
SRC=${SRC:-/opt/$NAME-src}
CONF=${CONF:-/etc/$NAME/update.conf}      # holds BRANCH
[ -f "$CONF" ] && . "$CONF"
BRANCH=${BRANCH:-main}
MODE=release; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH=$2; shift 2 ;;
    --setup) MODE=setup; shift; ARGS=("$@"); break ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "run as root (or with sudo)" >&2; exit 1; }
[ -d "$SRC/.git" ] || { echo "no git clone at $SRC (run bootstrap.sh first)" >&2; exit 1; }
export PATH=/usr/local/bin:$PATH

echo "==> Fetching $BRANCH"
git -C "$SRC" fetch --quiet origin
git -C "$SRC" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
echo "    now at $(git -C "$SRC" log -1 --format='%h %s')"
# keep the installed command current (install replaces the file, so the running copy is unaffected)
[ -f "$SRC/deploy/update.sh" ] && [ "${NO_SELF_UPDATE:-}" != 1 ] && install -m 755 "$SRC/deploy/update.sh" "/usr/local/bin/$NAME-update"
mkdir -p "$(dirname "$CONF")"; echo "BRANCH=$BRANCH" > "$CONF"

echo "==> Building front end"
( cd "$SRC/web" && npm ci --no-audit --no-fund && npm run build )

STAGE=/var/tmp/$NAME-stage
rm -rf "$STAGE"; mkdir -p "$STAGE/deploy"
cp -a "$SRC/web/dist" "$STAGE/dist"
cp -a "$SRC/backend/pb_hooks" "$SRC/backend/pb_migrations" "$STAGE/"
cp "$SRC/deploy/server.sh" "$SRC/deploy/backup.sh" "$SRC/deploy/round-table-net.service" "$SRC/deploy/nginx.conf" "$STAGE/deploy/"
cp "$SRC/.env.example" "$STAGE/.env.example"

exec bash "$STAGE/deploy/server.sh" "$MODE" "${ARGS[@]+"${ARGS[@]}"}"
