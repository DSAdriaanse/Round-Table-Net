#!/usr/bin/env bash
# Guided installer for a fresh Debian server. Copy this single file to the server and run it as root:
#
#   scp deploy/bootstrap.sh root@your-server:
#   ssh root@your-server
#   bash bootstrap.sh
#
# Run with no options and it asks what it needs: the public hostname, how people reach the app
# (Nginx on this server, or an external reverse proxy), a local port (it suggests the first free one
# from 8090), contact emails and the Git branch. It shows a summary and waits for a yes before
# changing anything. Every question has an option, so it also runs unattended:
#
#   bash bootstrap.sh --yes --domain net.apps.swcrs.org --email you@example.org --superuser-email you@example.org
#   bash bootstrap.sh --yes --domain net.apps.swcrs.org --mode proxy --listen 10.0.0.9 --proxy-ip 10.0.0.5
#
# Options:
#   --domain <host>          public hostname people will visit
#   --mode local|proxy       local: Nginx and a TLS certificate on this server (default)
#                            proxy: an external reverse proxy handles TLS; this server only runs the app
#   --email <addr>           contact address for the TLS certificate (local mode)
#   --superuser-email <addr> PocketBase admin login to create (optional)
#   --pin <value>            the club PIN net control operators type to sign in (default: a random 8-digit number,
#                            shown at the end). Use 6 or more characters; a short PIN is easy to guess.
#   --port <n>               local port the app listens on (default: first free port from 8090)
#   --listen <ipv4>          proxy mode: address the app listens on (default: this server's main address)
#   --proxy-ip <ip[,ip...]>  proxy mode: address or range of the proxy allowed through the firewall,
#                            or "none" if you manage the firewall elsewhere
#   --name <name>            instance name (default round-table-net). Everything is named after it: the service, the
#                            folders /opt/<name> and /var/lib/<name>, /etc/<name>, the Nginx site, the service user, the
#                            backup job, and the update command <name>-update. Use it to run a second copy
#                            (or another app built the same way) on one server.
#   --branch <name>          Git branch to install (default main)
#   --repo <url>             Git repository (default the Round-Table-Net repo over SSH)
#   --yes                    do not ask anything; use defaults for what is not given, fail if a required value is missing
#   --dry-run                ask the questions, show the plan, and change nothing
#
# It installs Node, gets the code from your private GitHub repo using a read-only deploy key, builds it,
# and sets up PocketBase, systemd, the firewall and backups (plus Nginx and TLS in local mode).
# Re-running is safe. Afterwards, update with:  round-table-net-update   (or <name>-update)
set -euo pipefail
export PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"

REPO=${REPO:-git@github.com:DSAdriaanse/Round-Table-Net.git}
BRANCH=${BRANCH:-}
NAME=${NAME:-round-table-net}
# Every path is named after the instance. SRC, ENV_FILE and CONF can still be overridden from the environment.
_SRC=${SRC:-}; _ENV_FILE=${ENV_FILE:-}; _CONF=${CONF:-}
derive_paths() {
  SRC=${_SRC:-/opt/$NAME-src}
  KEY=/root/.ssh/$NAME-deploy
  ENV_FILE=${_ENV_FILE:-/etc/$NAME/env}
  CONF=${_CONF:-/etc/$NAME/update.conf}
}
derive_paths
DOMAIN=; EMAIL=; SU_EMAIL=; PIN=; PORT=; MODE=; LISTEN=; PROXY_IPS=
YES=0; DRY_RUN=0

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- reading what is already installed
env_value() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | head -1 || true; }
saved_branch() { [ -f "$CONF" ] && sed -n 's/^BRANCH=//p' "$CONF" | head -1 || true; }
existing_port() { env_value RT_PORT; }

# ---------------------------------------------------------------- network helpers
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
primary_ip() {
  local addr
  addr=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
  [ -n "$addr" ] || addr=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo "$addr"
}
# Suggested listen address for proxy mode: the one already saved (if it is not localhost), else this server's main address.
suggest_listen() {
  local saved; saved=$(env_value RT_LISTEN)
  case "$saved" in ""|127.*) primary_ip ;; *) echo "$saved" ;; esac
}
# Suggested port: the one this install already uses, else the first free port from 8090 up.
suggest_port() {
  local p; p=$(existing_port)
  if [ -n "$p" ]; then echo "$p"; return; fi
  p=8090
  while port_in_use "$p"; do p=$((p + 1)); done
  echo "$p"
}

# ---------------------------------------------------------------- validators
# Each prints a reason and returns 1 when the value is not acceptable.
is_ipv4() {
  local IFS=. o; local -a parts=($1)
  [ "${#parts[@]}" -eq 4 ] || return 1
  for o in "${parts[@]}"; do [[ "$o" =~ ^[0-9]{1,3}$ ]] && [ "$o" -le 255 ] || return 1; done
}
is_ip_or_range() {   # IPv4 or IPv6 address, with an optional /prefix
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
v_name() { [[ "$1" =~ ^[a-z][a-z0-9-]{0,23}$ ]] || { echo "'$1' is not a valid name. Use 1 to 24 characters: lowercase letters, digits and dashes, starting with a letter."; return 1; }; }
v_nonempty() { [ -n "$1" ] || { echo "A value is required."; return 1; }; }
v_any() { return 0; }
v_domain() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || { echo "'$1' does not look like a hostname or IP address."; return 1; }; }
v_email() { [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { echo "'$1' does not look like an email address."; return 1; }; }
v_optional_email() { [ -z "$1" ] || v_email "$1"; }
# Empty is fine (one is generated). A short PIN is accepted but warned about by the installer.
v_pin() { [[ "$1" != *[[:space:]]* ]] || { echo "The PIN cannot contain spaces."; return 1; }; }
v_listen() { is_ipv4 "$1" || { echo "'$1' is not an IPv4 address (use 0.0.0.0 to listen on all addresses)."; return 1; }; }
v_proxy_ips() {
  [ -n "$1" ] || { echo "A value is required. Use an address like 10.0.0.5, a range like 10.0.0.0/24, or 'none'."; return 1; }
  [ "$1" = none ] && return 0
  local item; local IFS=,
  for item in $1; do
    item=${item// /}
    is_ip_or_range "$item" || { echo "'$item' is not an IP address or range (example: 10.0.0.5 or 10.0.0.0/24)."; return 1; }
  done
}
v_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1024 ] && [ "$1" -le 65535 ] || { echo "'$1' is not a valid port. Use a number from 1024 to 65535."; return 1; }
  [ "$1" = "$(existing_port)" ] || ! port_in_use "$1" || { echo "Port $1 is already in use on this server."; return 1; }
}
valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1024 ] && [ "$1" -le 65535 ]; }

# ---------------------------------------------------------------- asking
prompting() { [ "$YES" != 1 ] && [ -t 0 ]; }

# ask VAR "Question" "default" validator
# Uses the value already in VAR (from an option) if there is one. Otherwise asks, when run from a terminal
# without --yes, and falls back to the default. A value that fails the check is asked for again, or
# stops the script when there is nobody to ask.
ask() {
  local var=$1 question=$2 def=$3 check=$4 val msg
  while true; do
    val=${!var}
    if [ -z "$val" ]; then
      if prompting; then
        if [ -n "$def" ]; then read -r -p "$question [$def]: " val </dev/tty; val=${val:-$def}
        else read -r -p "$question: " val </dev/tty; fi
      else
        val=$def
      fi
    fi
    if msg=$("$check" "$val"); then printf -v "$var" '%s' "$val"; return 0; fi
    prompting || die "$question: $msg (pass it as an option, or run without --yes to be asked)"
    printf '%s\n' "$msg" >&2
    printf -v "$var" '%s' ''
  done
}

ask_mode() {
  case "$MODE" in 1) MODE=local ;; 2) MODE=proxy ;; local|proxy|"") ;; *) die "--mode must be 'local' or 'proxy'" ;; esac
  [ -z "$MODE" ] || return 0
  local saved a def=1; saved=$(env_value RT_MODE); [ "$saved" = proxy ] && def=2
  if prompting; then
    cat >&2 <<'TXT'

How will people reach the app?
  1) Nginx on this server. Installs Nginx and a free TLS certificate here.
  2) An external reverse proxy (Nginx on another machine). It handles TLS; this server only runs the app.
TXT
    while true; do
      read -r -p "Choose 1 or 2 [$def]: " a </dev/tty; a=${a:-$def}
      case "$a" in 1) MODE=local; return 0 ;; 2) MODE=proxy; return 0 ;; *) echo "Please enter 1 or 2." >&2 ;; esac
    done
  fi
  MODE=${saved:-local}
}

choose_port() {
  ask PORT "Local port for the app$([ "$MODE" = proxy ] && echo ' (the proxy connects to it)' || echo ' (Nginx forwards to it; not opened to the internet)')" "$(suggest_port)" v_port
}

# Lets tests load the functions above without running the installer.
[ "${BOOTSTRAP_SOURCE_ONLY:-}" = 1 ] && return 0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN=$2; shift 2 ;;
    --mode) MODE=$2; shift 2 ;;
    --email) EMAIL=$2; shift 2 ;;
    --superuser-email) SU_EMAIL=$2; shift 2 ;;
    --pin) PIN=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --listen) LISTEN=$2; shift 2 ;;
    --proxy-ip) PROXY_IPS=$2; shift 2 ;;
    --name) NAME=$2; shift 2 ;;
    --branch) BRANCH=$2; shift 2 ;;
    --repo) REPO=$2; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
msg=$(v_name "$NAME") || die "--name: $msg"
derive_paths
if [ "$DRY_RUN" != 1 ]; then
  [ "$(id -u)" = 0 ] || die "run as root"
  [ -r /etc/debian_version ] || die "this script is for Debian/Ubuntu"
fi

# ---------------------------------------------------------------- questions
if prompting; then printf '\nRound Table Net installer. Press Enter to accept the value in [brackets].\n\n' >&2; fi
saved_host=$(env_value APP_URL); saved_host=${saved_host#http://}; saved_host=${saved_host#https://}; saved_host=${saved_host%%/*}
ask DOMAIN "Public hostname people will visit (for example net.apps.swcrs.org)" "$saved_host" v_domain
ask_mode
if [ "$MODE" = local ]; then
  ask EMAIL "Email for TLS certificate notices (Let's Encrypt)" "" v_email
  LISTEN=127.0.0.1
  PROXY_IPS=
else
  EMAIL=
fi
ask SU_EMAIL "Email for the PocketBase admin login (optional, Enter to skip)" "" v_optional_email
ask PIN "Club PIN for net control sign-in (6 or more characters; Enter to generate one)" "" v_pin
choose_port
if [ "$MODE" = proxy ]; then
  ask LISTEN "Address this server listens on for the proxy (0.0.0.0 = all addresses)" "$(suggest_listen)" v_listen
  ask PROXY_IPS "IP address or range of the proxy allowed to connect (10.0.0.5, 10.0.0.0/24, comma separated, or 'none')" "$(env_value RT_PROXY_IPS)" v_proxy_ips
fi
ask BRANCH "Git branch to install" "$(saved_branch || true)" v_any
BRANCH=${BRANCH:-main}

args=(--branch "$BRANCH" --setup --domain "$DOMAIN" --mode "$MODE" --port "$PORT")
[ "$MODE" = local ] && args+=(--email "$EMAIL")
[ -n "$SU_EMAIL" ] && args+=(--superuser-email "$SU_EMAIL")
[ -n "$PIN" ] && args+=(--pin "$PIN")
[ "$MODE" = proxy ] && args+=(--listen "$LISTEN" --proxy-ip "$PROXY_IPS")

{
  printf '\nInstallation plan\n'
  if [ -f "$ENV_FILE" ]; then printf '  Instance name     %s (already installed here: this updates it in place; to add another copy, use --name)\n' "$NAME"
  else printf '  Instance name     %s\n' "$NAME"; fi
  printf '  Public hostname   %s\n' "$DOMAIN"
  if [ "$MODE" = local ]; then
    printf '  Web access        Nginx on this server, TLS certificate for %s via Let'"'"'s Encrypt\n' "$EMAIL"
  else
    printf '  Web access        external reverse proxy (it handles TLS and Nginx is not installed here)\n'
    printf '  App listens on    %s:%s\n' "$LISTEN" "$PORT"
    if [ "$PROXY_IPS" = none ]; then printf '  Firewall          no rule added for the proxy (you manage it)\n'
    else printf '  Firewall          allow %s to reach port %s\n' "$PROXY_IPS" "$PORT"; fi
  fi
  [ "$MODE" = local ] && printf '  App port          %s (local only)\n' "$PORT"
  printf '  Git branch        %s\n' "$BRANCH"
  printf '  PocketBase admin  %s\n' "${SU_EMAIL:-(not created)}"
  if [ -n "$PIN" ]; then printf '  Club PIN          as given%s\n' "$([ "${#PIN}" -lt 6 ] && echo ' (SHORT: under 6 characters, easy to guess)')"; else printf '  Club PIN          a random 8-digit number will be generated\n'; fi
  printf '\n'
} >&2

if [ "$DRY_RUN" = 1 ]; then
  printf 'Dry run, nothing was changed. The install would run:\n  %s' "$NAME-update" >&2
  shown=(); skip=0
  for a in "${args[@]}"; do if [ "$skip" = 1 ]; then shown+=("(hidden)"); skip=0; else shown+=("$a"); [ "$a" = --pin ] && skip=1; fi; done
  printf ' %q' "${shown[@]}" >&2; printf '\n' >&2
  exit 0
fi
if prompting; then
  read -r -p "Continue? [Y/n] " a </dev/tty
  case "${a:-y}" in n|N|no|NO) die "Cancelled. Nothing was changed." ;; esac
fi

say "Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssh-client xz-utils openssl >/dev/null

ensure_node() {
  if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then
    say "Node $(node -v) already installed"; return
  fi
  say "Installing Node 22 (latest v22 from nodejs.org, checksum verified)"
  local arch; case "$(dpkg --print-architecture)" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) die "unsupported architecture" ;; esac
  local base=https://nodejs.org/dist/latest-v22.x tmp; tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
  local file; file=$(awk -v a="linux-$arch.tar.xz" '$2 ~ a"$" {print $2}' "$tmp/SHASUMS256.txt")
  [ -n "$file" ] || die "could not find a Node 22 build for $arch"
  curl -fsSL -o "$tmp/$file" "$base/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -) || die "Node checksum mismatch"
  rm -rf /opt/node && mkdir -p /opt/node
  tar -xJf "$tmp/$file" -C /opt/node --strip-components=1
  ln -sf /opt/node/bin/node /usr/local/bin/node
  ln -sf /opt/node/bin/npm /usr/local/bin/npm
  ln -sf /opt/node/bin/npx /usr/local/bin/npx
  rm -rf "$tmp"
  node -v
}
ensure_node

# --- repository access (private repo -> read-only deploy key)
if [[ "$REPO" == git@* ]]; then
  mkdir -p /root/.ssh; chmod 700 /root/.ssh
  if [ ! -f "$KEY" ]; then
    ssh-keygen -t ed25519 -N "" -C "$NAME-server-$(hostname)" -f "$KEY" >/dev/null
  fi
  touch /root/.ssh/config; chmod 600 /root/.ssh/config
  # The first install uses the plain github.com host. Another instance gets its own host alias, so it can
  # use its own deploy key (GitHub accepts a deploy key on one repository only).
  GH_HOST=github.com
  if [ "$NAME" != round-table-net ] && [[ "$REPO" == git@github.com:* ]]; then
    GH_HOST=github-$NAME
    REPO="git@$GH_HOST:${REPO#git@github.com:}"
  fi
  if ! grep -q "$NAME-deploy" /root/.ssh/config; then
    cat >> /root/.ssh/config <<CFG

Host $GH_HOST
  HostName github.com
  IdentityFile $KEY
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
CFG
  fi
  until git ls-remote "$REPO" >/dev/null 2>&1; do
    cat <<MSG

------------------------------------------------------------------
Give this server READ-ONLY access to the repo:
  GitHub -> Round-Table-Net -> Settings -> Deploy keys -> Add deploy key
  Title: this server    Key (leave "Allow write access" UNCHECKED):

$(cat "$KEY.pub")
------------------------------------------------------------------
MSG
    read -r -p "Press Enter once the key is added (Ctrl-C to abort)... " _ </dev/tty
  done
fi

say "Getting the code ($BRANCH)"
if [ -d "$SRC/.git" ]; then git -C "$SRC" remote set-url origin "$REPO"; else git clone --quiet "$REPO" "$SRC"; fi
git -C "$SRC" fetch --quiet origin
git -C "$SRC" rev-parse --verify --quiet "origin/$BRANCH" >/dev/null || die "branch '$BRANCH' not found in the repo. Merge the pull requests, or pass --branch <name>."

git -C "$SRC" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
install -m 755 "$SRC/deploy/update.sh" "/usr/local/bin/$NAME-update"
exec env NAME="$NAME" "/usr/local/bin/$NAME-update" "${args[@]}"
