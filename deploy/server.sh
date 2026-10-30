#!/usr/bin/env bash
# Runs ON THE SERVER. Started by <name>-update (deploy/update.sh), which stages the files first.
#
#   NAME=<name> server.sh ...   instance name (default round-table-net); update.sh passes it on.
#   server.sh setup --domain net.example.org --email you@example.org [--port 8090] [--superuser-email you@example.org] [--pin <club PIN>]
#   server.sh setup --domain net.example.org --mode proxy --listen 10.0.0.9 --proxy-ip 10.0.0.5 [--port 8090]
#       One-time (and safe to re-run) server preparation + first release.
#       --mode local (default): Nginx and a TLS certificate are installed on this server.
#       --mode proxy: an external reverse proxy handles TLS. No Nginx or certbot here; the app listens on
#                     --listen (an IPv4 address, default this server's main address) and the firewall lets
#                     --proxy-ip through (address, range, comma separated list, or "none" to skip the rule).
#       --port is the port the app listens on (default: the current one, else 8090).
#       The settings live in the env file (RT_PORT, RT_LISTEN, RT_MODE, RT_PROXY_IPS); to change them later,
#       re-run setup with the new options.
#   server.sh release
#       Install the code staged next to this script, restart, health check, roll back on failure.
#
# Layout: code in /opt/<name>, data in /var/lib/<name>, secrets in /etc/<name>/env, unit <name>.service,
# user rtnet (or <name> for any other name), backups in /var/backups/<name>.
set -euo pipefail
# su (without -) and some ssh setups omit the sbin folders that useradd, ufw, nginx, sshd and runuser live in.
export PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"

NAME=${NAME:-round-table-net}
[[ "$NAME" =~ ^[a-z][a-z0-9-]{0,23}$ ]] || { echo "ERROR: invalid instance name '$NAME' (1 to 24 lowercase letters, digits or dashes, starting with a letter)" >&2; exit 1; }
APP=${APP:-/opt/$NAME}
DATA=${DATA:-/var/lib/$NAME}
ENV_FILE=${ENV_FILE:-/etc/$NAME/env}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/$NAME}
UNIT_DIR=${UNIT_DIR:-/etc/systemd/system}
CRON_DIR=${CRON_DIR:-/etc/cron.d}
# The first instance keeps its original service user name; others get a user named after the instance.
if [ "$NAME" = round-table-net ]; then SVC_USER=${SVC_USER:-rtnet}; else SVC_USER=${SVC_USER:-$NAME}; fi
PB_VERSION=${PB_VERSION:-0.36.0}
DEFAULT_PORT=8090
DEFAULT_LISTEN=127.0.0.1
HEALTH_URL=${HEALTH_URL:-}    # default is built from RT_PORT once the env file is known
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-30}
STAGE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)   # parent of deploy/

say()  { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Port handling. RT_PORT in the env file is the single source of truth: the systemd unit reads it,
# and setup writes it into the Nginx config.
valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1024 ] && [ "$1" -le 65535 ]; }
current_port() { [ -f "$ENV_FILE" ] && sed -n 's/^RT_PORT=//p' "$ENV_FILE" | head -1 || true; }
set_env_value() {   # name value
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '\n%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
}
env_get() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | head -1 || true; }
current_listen() { env_get RT_LISTEN; }
is_ipv4() {
  local IFS=. o; local -a parts=($1)
  [ "${#parts[@]}" -eq 4 ] || return 1
  for o in "${parts[@]}"; do [[ "$o" =~ ^[0-9]{1,3}$ ]] && [ "$o" -le 255 ] || return 1; done
}
is_ip_or_range() {
  local addr=${1%%/*} mask=
  if [[ "$1" == */* ]]; then mask=${1#*/}; [ -n "$mask" ] || return 1; fi
  if is_ipv4 "$addr"; then
    [ -z "$mask" ] || { [[ "$mask" =~ ^[0-9]{1,2}$ ]] && [ "$mask" -le 32 ]; }
  elif [[ "$addr" == *:* && "$addr" =~ ^[0-9A-Fa-f:]+$ ]]; then
    [ -z "$mask" ] || { [[ "$mask" =~ ^[0-9]{1,3}$ ]] && [ "$mask" -le 128 ]; }
  else
    return 1
  fi
}
primary_ip() {
  local addr
  addr=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
  [ -n "$addr" ] || addr=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo "$addr"
}
# Installs made before these settings existed run on 127.0.0.1:8090, so record that.
ensure_port_setting() {
  [ -f "$ENV_FILE" ] || return 0
  [ -n "$(current_port)" ] || set_env_value RT_PORT "$DEFAULT_PORT"
  [ -n "$(current_listen)" ] || set_env_value RT_LISTEN "$DEFAULT_LISTEN"
}
# The health check runs on this machine. An app listening on 0.0.0.0 is reached through localhost;
# one bound to a single address has to be asked on that address.
resolve_health_url() {
  [ -z "$HEALTH_URL" ] || return 0
  local port=${PORT:-$(current_port)} host=${LISTEN:-$(current_listen)}
  case "$host" in ""|0.0.0.0) host=127.0.0.1 ;; esac
  HEALTH_URL="http://$host:${port:-$DEFAULT_PORT}/api/health"
}
# Where the web server should send traffic: the address the app listens on.
backend_address() {
  local host=${LISTEN:-$(current_listen)}; host=${host:-$DEFAULT_LISTEN}
  [ "$host" != 0.0.0.0 ] || host=$(primary_ip)
  echo "$host:${PORT:-$(current_port)}"
}

need_root() { [ "$(id -u)" = 0 ] || exec sudo -E bash "${BASH_SOURCE[0]}" "$@"; }

install_packages() {
  say "Installing packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  local pkgs=(sqlite3 unzip curl ca-certificates ufw fail2ban unattended-upgrades cron)
  [ "$MODE" = proxy ] || pkgs+=(nginx certbot python3-certbot-nginx)   # in proxy mode the web server lives elsewhere
  apt-get install -y -qq "${pkgs[@]}" >/dev/null
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
}

create_user_and_dirs() {
  say "Creating service user and directories"
  id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin "$SVC_USER"
  install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$DATA" "$DATA/pb_data" "$BACKUP_DIR"
  install -d -m 755 "$APP"
  install -d -m 750 -g "$SVC_USER" "$(dirname "$ENV_FILE")"
}

install_pocketbase() {
  if [ -x "$APP/pocketbase" ] && "$APP/pocketbase" --version 2>/dev/null | grep -q " $PB_VERSION\$"; then
    say "PocketBase $PB_VERSION already installed"; return
  fi
  say "Installing PocketBase $PB_VERSION"
  local arch; arch=$(dpkg --print-architecture)
  case "$arch" in amd64|arm64) ;; armhf) arch=armv7 ;; *) die "unsupported architecture: $arch" ;; esac
  local zip="pocketbase_${PB_VERSION}_linux_${arch}.zip"
  local base="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}"
  local tmp; tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/$zip" "$base/$zip"
  curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt"
  (cd "$tmp" && grep " $zip\$" checksums.txt | sha256sum -c -) || die "PocketBase checksum mismatch"
  unzip -q -o "$tmp/$zip" pocketbase -d "$tmp"
  install -m 755 -o root -g root "$tmp/pocketbase" "$APP/pocketbase"
  rm -rf "$tmp"
}

# A release can add settings to .env.example (for example the Slack keys). The env file on an existing
# server was copied at install time and is never replaced, so add any key it lacks, with its comment, as
# an empty value. Only keys that are empty in .env.example (secrets and optional settings) are added; keys
# with a default (port, time zone, URL) are left to the installer. Existing values are never touched, and a
# key that is present, even commented out like #PIN_RATE_LIMIT=, is left alone.
add_missing_env_keys() {
  [ -f "$ENV_FILE" ] && [ -f "$STAGE/.env.example" ] || return 0
  local added; added=$(awk -v envfile="$ENV_FILE" '
    BEGIN { while ((getline line < envfile) > 0) { k = line; sub(/^#/, "", k); sub(/=.*/, "", k); if (line ~ /^#?[A-Z][A-Z0-9_]*=/) have[k] = 1 } }
    /^#/ { block = block $0 "\n"; next }
    /^[A-Z][A-Z0-9_]*=/ { k = $0; sub(/=.*/, "", k); if (!(k in have) && $0 ~ /=$/) { printf "\n%s%s=\n", block, k; n++ } block = ""; next }
    { block = "" }
  ' "$STAGE/.env.example")
  [ -n "$added" ] || return 0
  printf '%s' "$added" >> "$ENV_FILE"
  say "Added new settings to $ENV_FILE (empty until you fill them in): $(printf '%s' "$added" | sed -n 's/^\([A-Z][A-Z0-9_]*\)=$/\1/p' | tr '\n' ' ')"
}

write_env_file() {
  if [ -f "$ENV_FILE" ]; then say "Keeping existing $ENV_FILE"; return; fi
  say "Creating $ENV_FILE"
  cp "$STAGE/.env.example" "$ENV_FILE"
  sed -i "s|^APP_URL=.*|APP_URL=https://$DOMAIN|" "$ENV_FILE"
  # The club PIN: the one given with --pin, else a random 8-digit number (shown once at the end).
  local pin=${PIN:-}
  if [ -z "$pin" ]; then pin=$(od -An -N4 -tu4 /dev/urandom | tr -d ' '); pin=$(printf '%08d' $((pin % 100000000))); GENERATED_PIN=yes; fi
  [ "${#pin}" -ge 6 ] || warn "The club PIN is shorter than 6 characters. The server limits attempts, but a short PIN is easy to guess."
  sed -i "s|^NCO_PIN=.*|NCO_PIN=$pin|" "$ENV_FILE"
  chown root:"$SVC_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
  NEW_PIN=$pin
}

install_service() {
  say "Installing systemd service"
  sed -e "s|__NAME__|$NAME|g" -e "s|__USER__|$SVC_USER|g" -e "s|__APP__|$APP|g" -e "s|__DATA__|$DATA|g" -e "s|__ENV_FILE__|$ENV_FILE|g" \
    "$STAGE/deploy/round-table-net.service" > "$UNIT_DIR/$NAME.service"
  chmod 644 "$UNIT_DIR/$NAME.service"
  systemctl daemon-reload
  systemctl enable "$NAME" >/dev/null
}

install_nginx() {
  say "Configuring Nginx for $DOMAIN (app on 127.0.0.1:$PORT)"
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__BACKEND__|127.0.0.1:$PORT|g" "$STAGE/deploy/nginx.conf" > "/etc/nginx/sites-available/$NAME"
  ln -sf "/etc/nginx/sites-available/$NAME" "/etc/nginx/sites-enabled/$NAME"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  say "Requesting a TLS certificate (DNS for $DOMAIN must already point at this server)"
  if certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email -n --redirect; then
    TLS=yes
  else
    TLS=no
    warn "certbot failed. The site works over plain HTTP for now. Fix DNS, then re-run:  server.sh setup --domain $DOMAIN --email $EMAIL"
  fi
}

configure_firewall() {
  say "Configuring firewall"
  local ssh_port; ssh_port=$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}'); ssh_port=${ssh_port:-22}
  ufw allow "$ssh_port"/tcp >/dev/null
  if [ "$MODE" = proxy ]; then
    # Only the proxy may reach the app. Nothing is opened on 80 or 443 because Nginx is not installed here.
    if [ "$PROXY_IPS" = none ]; then
      warn "No firewall rule added for the proxy. Make sure $LISTEN:$PORT is reachable only from it."
    else
      local item list; IFS=, read -ra list <<< "$PROXY_IPS"
      for item in "${list[@]}"; do
        item=${item// /}
        ufw allow from "$item" to any port "$PORT" proto tcp >/dev/null
      done
    fi
  else
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  fi
  ufw --force enable >/dev/null
  systemctl enable --now fail2ban >/dev/null 2>&1 || true
}

install_backup() {
  install -m 755 "$STAGE/deploy/backup.sh" "$APP/backup.sh"
  cat > "$CRON_DIR/$NAME" <<CRON
# Hourly consistent backup of the PocketBase database (kept 14 days). Output goes to the journal.
0 * * * * $SVC_USER DATA=$DATA/pb_data OUT=$BACKUP_DIR $APP/backup.sh 2>&1 | logger -t $NAME-backup
CRON
  chmod 644 "$CRON_DIR/$NAME"
}

healthy() {
  local i; for ((i = 0; i < HEALTH_TIMEOUT; i++)); do
    curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

do_release() {
  say "Releasing"
  ensure_port_setting
  add_missing_env_keys
  resolve_health_url
  [ -x "$APP/pocketbase" ] || die "PocketBase is not installed. Run:  server.sh setup ..."
  for d in dist pb_hooks pb_migrations; do [ -d "$STAGE/$d" ] || die "missing $STAGE/$d in the staged release"; done

  [ -x "$APP/backup.sh" ] && runuser -u "$SVC_USER" -- env DATA="$DATA/pb_data" OUT="$BACKUP_DIR" "$APP/backup.sh" || warn "skipping pre-release backup"

  rm -rf "$APP/.prev"; mkdir -p "$APP/.prev"
  for d in dist pb_hooks pb_migrations; do
    [ -d "$APP/$d" ] && mv "$APP/$d" "$APP/.prev/$d"
    cp -a "$STAGE/$d" "$APP/$d"
  done
  chown -R root:root "$APP/dist" "$APP/pb_hooks" "$APP/pb_migrations"

  systemctl restart "$NAME"
  if healthy; then
    say "Release is up ($(date -u +%FT%TZ))"
    return 0
  fi

  warn "New release did not become healthy. Rolling back."
  journalctl -u "$NAME" -n 30 --no-pager || true
  for d in dist pb_hooks pb_migrations; do
    if [ -d "$APP/.prev/$d" ]; then rm -rf "${APP:?}/$d"; mv "$APP/.prev/$d" "$APP/$d"; fi
  done
  systemctl restart "$NAME"
  healthy && warn "Rolled back to the previous code. Database migrations that already ran were NOT undone; restore a backup if the schema changed." || warn "Still unhealthy after rollback. Check: journalctl -u $NAME"
  return 1
}

create_superuser() {
  [ -n "${SUPERUSER_EMAIL:-}" ] || return 0
  say "Creating PocketBase superuser $SUPERUSER_EMAIL"
  local pw; pw=$(openssl rand -base64 18 | tr -d '/+=')
  runuser -u "$SVC_USER" -- "$APP/pocketbase" superuser upsert "$SUPERUSER_EMAIL" "$pw" \
    --dir "$DATA/pb_data" --migrationsDir "$APP/pb_migrations" >/dev/null
  SUPERUSER_PW=$pw
}

cmd_setup() {
  DOMAIN=; EMAIL=; SUPERUSER_EMAIL=; NEW_PIN=; PIN=; GENERATED_PIN=no; SUPERUSER_PW=; TLS=no; PORT=; MODE=; LISTEN=; PROXY_IPS=
  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) DOMAIN=$2; shift 2 ;;
      --email) EMAIL=$2; shift 2 ;;
      --superuser-email) SUPERUSER_EMAIL=$2; shift 2 ;;
      --pin) PIN=$2; shift 2 ;;
      --port) PORT=$2; shift 2 ;;
      --mode) MODE=$2; shift 2 ;;
      --listen) LISTEN=$2; shift 2 ;;
      --proxy-ip) PROXY_IPS=$2; shift 2 ;;
      *) die "unknown option: $1" ;;
    esac
  done
  MODE=${MODE:-$(env_get RT_MODE)}; MODE=${MODE:-local}
  [ -r /etc/debian_version ] || die "this script is for Debian/Ubuntu"
  [ -n "$DOMAIN" ] || die "usage: server.sh setup --domain <host> --email <certbot email> [--port <n>] [--superuser-email <email>]  (or --mode proxy ...)"
  case "$MODE" in
    local)
      [ -n "$EMAIL" ] || die "local mode needs --email (used for the TLS certificate)"
      LISTEN=$DEFAULT_LISTEN; PROXY_IPS=
      ;;
    proxy)
      LISTEN=${LISTEN:-$(current_listen)}
      case "${LISTEN:-}" in ""|127.*) LISTEN=$(primary_ip) ;; esac
      is_ipv4 "$LISTEN" || die "--listen must be an IPv4 address (got '$LISTEN')"
      PROXY_IPS=${PROXY_IPS:-$(env_get RT_PROXY_IPS)}
      [ -n "$PROXY_IPS" ] || die "proxy mode needs --proxy-ip (the proxy's address or range, or 'none' if you manage the firewall elsewhere)"
      if [ "$PROXY_IPS" != none ]; then
        local item list; IFS=, read -ra list <<< "$PROXY_IPS"
        for item in "${list[@]}"; do is_ip_or_range "${item// /}" || die "--proxy-ip: '$item' is not an IP address or range"; done
      fi
      TLS=yes   # assumed: the proxy terminates TLS
      ;;
    *) die "--mode must be 'local' or 'proxy'" ;;
  esac

  install_packages
  create_user_and_dirs
  install_pocketbase
  write_env_file
  # Port: --port, else keep the one already in use, else the default.
  PORT=${PORT:-$(current_port)}; PORT=${PORT:-$DEFAULT_PORT}
  valid_port "$PORT" || die "invalid port '$PORT' (use a number from 1024 to 65535)"
  set_env_value RT_PORT "$PORT"
  set_env_value RT_LISTEN "$LISTEN"
  set_env_value RT_MODE "$MODE"
  set_env_value RT_PROXY_IPS "$PROXY_IPS"
  install_service
  install_backup
  do_release || die "first release failed"
  create_superuser
  [ "$MODE" = proxy ] || install_nginx
  configure_firewall

  say "Done"
  echo "Site:            http$([ "$TLS" = yes ] && echo s)://$DOMAIN   (app listens on $LISTEN:$PORT)"
  echo "Admin UI:        http$([ "$TLS" = yes ] && echo s)://$DOMAIN/_/"
  [ -n "$SUPERUSER_PW" ] && echo "Superuser login: $SUPERUSER_EMAIL / $SUPERUSER_PW   (shown once; change it in the admin UI)"
  [ -n "$NEW_PIN" ] && echo "Club PIN:        $NEW_PIN   (saved in $ENV_FILE as NCO_PIN$([ "$GENERATED_PIN" = yes ] && echo '; it was generated, tell the net control operators'). To change it, edit that line and run: systemctl restart $NAME)"
  if [ "$MODE" = proxy ]; then
    local conf; conf="$(dirname "$ENV_FILE")/nginx-proxy.conf"
    sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__BACKEND__|$(backend_address)|g" "$STAGE/deploy/nginx.conf" > "$conf"
    cat <<PROXY

On the reverse proxy server:
  1. Save the config below (also kept at $conf on this server) as an Nginx site, enable it and reload Nginx.
  2. Get a certificate there, for example:  certbot --nginx -d $DOMAIN
  Keep the proxy_set_header lines: the app uses X-Real-IP for rate limiting, so only the proxy should be able
  to reach port $PORT on this server.
--------------------------------------------------------------------------
$(cat "$conf")
--------------------------------------------------------------------------
PROXY
  fi
  cat <<NEXT

Next:
  1. Edit $ENV_FILE (WordPress password, Anthropic key; both optional), then:  systemctl restart $NAME
  2. Sign in at https://$DOMAIN with the club PIN, then fill in the WordPress details under Settings (optional).
     To bring in the previous app's data:  node scripts/import-base44.mjs <export-folder> --dry-run
  3. Harden SSH once your key login works: PasswordAuthentication no, PermitRootLogin no in /etc/ssh/sshd_config.d/
  4. Copy $BACKUP_DIR off this machine regularly.
NEXT
}

main() {
  local cmd=${1:-}; shift || true
  case "$cmd" in
    setup)   need_root "$cmd" "$@"; cmd_setup "$@" ;;
    release) need_root "$cmd" "$@"; do_release ;;
    *) die "usage: server.sh {setup|release} ..." ;;
  esac
}

[ "${SERVER_SH_SOURCE_ONLY:-}" = 1 ] || main "$@"
