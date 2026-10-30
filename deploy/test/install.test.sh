#!/usr/bin/env bash
# Tests for the guided installer (deploy/bootstrap.sh) and proxy mode (deploy/server.sh).
# They load the functions and stub the system commands, so nothing is installed:  bash deploy/test/install.test.sh
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d); LISTEN_PIDS=()
cleanup() { for p in "${LISTEN_PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT
FAILS=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (expected '$3', got '$2')"; FAILS=$((FAILS + 1)); fi; }
ok()   { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS + 1)); fi; }

listen() { python3 -c "import socket,time,sys; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(('127.0.0.1',$1)); s.listen(); time.sleep(120)" & LISTEN_PIDS+=($!); sleep 0.4; }

# Pick a block of free ports so the tests do not depend on what is running here.
BASE=18090; while (exec 3<>/dev/tcp/127.0.0.1/$BASE) 2>/dev/null || (exec 3<>/dev/tcp/127.0.0.1/$((BASE+1))) 2>/dev/null || (exec 3<>/dev/tcp/127.0.0.1/$((BASE+2))) 2>/dev/null; do BASE=$((BASE+10)); done

# bootstrap's defaults start at 8090; these tests shift that start by overriding the function inputs
boot() { ( export ENV_FILE="$TMP/env" BOOTSTRAP_SOURCE_ONLY=1; source "$HERE/bootstrap.sh"; "$@" ); }

echo "--- validation"
for v in 1024 8090 65535; do ok "valid_port accepts $v" "boot valid_port $v"; done
for v in 0 80 1023 65536 abc '' 80.5 -1; do ok "valid_port rejects '$v'" "! boot valid_port '$v'"; done

echo "--- suggestion (bootstrap.sh)"
rm -f "$TMP/env"
check "no env file, 8090 free or taken: a number is suggested" "$(boot suggest_port | grep -c -E '^[0-9]+$')" "1"
echo "RT_PORT=8123" > "$TMP/env"
check "existing install keeps its own port" "$(boot suggest_port)" "8123"
rm -f "$TMP/env"
# Move the search window to a known-free block by temporarily defining the start via a wrapper
suggest_from() { ( export ENV_FILE="$TMP/env" BOOTSTRAP_SOURCE_ONLY=1; source "$HERE/bootstrap.sh"
  suggest_port() { local p=$1; while port_in_use "$p"; do p=$((p + 1)); done; echo "$p"; }; suggest_port "$1" ); }
check "free start port is suggested as is" "$(suggest_from $BASE)" "$BASE"
listen $BASE
check "taken port is skipped" "$(suggest_from $BASE)" "$((BASE+1))"
listen $((BASE+1))
check "two taken ports are skipped" "$(suggest_from $BASE)" "$((BASE+2))"
ok "port_in_use sees the listener" "boot port_in_use $BASE"
ok "port_in_use is false for a free port" "! boot port_in_use $((BASE+5))"

# The real suggest_port starts at 8090. Compare it with an independent search so this holds whatever is running here.
first_free=8090; while (exec 3<>/dev/tcp/127.0.0.1/$first_free) 2>/dev/null; do first_free=$((first_free + 1)); done
rm -f "$TMP/env"
check "real suggest_port returns the first free port from 8090" "$(boot suggest_port)" "$first_free"

echo "--- bootstrap.sh refuses a bad port before changing anything"
if [ "$(id -u)" = 0 ] && [ -r /etc/debian_version ]; then
  out=$(cd "$TMP" && timeout 20 bash "$HERE/bootstrap.sh" --domain d.example --email e@example.org --port abc </dev/null 2>&1); rc=$?
  check "bootstrap with --port abc exits 1" "$rc" "1"
  ok "bootstrap with --port abc explains why" "echo \"$out\" | grep -q 'not a valid port'"
  out=$(cd "$TMP" && timeout 20 bash "$HERE/bootstrap.sh" --domain d.example --email e@example.org --port $BASE </dev/null 2>&1); rc=$?
  check "bootstrap with a port in use exits 1" "$rc" "1"
  ok "bootstrap names the port in use" "echo \"$out\" | grep -q 'already in use'"
else
  echo "SKIP bootstrap end-to-end refusal (needs root on Debian)"
fi

echo "--- choose_port without a terminal"
choose() { ( export ENV_FILE="$TMP/env" BOOTSTRAP_SOURCE_ONLY=1; source "$HERE/bootstrap.sh"; PORT=$1; choose_port </dev/null; echo "$PORT" ) 2>"$TMP/err"; }
check "valid --port is used" "$(choose $((BASE+7)) | tail -1)" "$((BASE+7))"
choose "abc" >/dev/null; check "invalid --port is refused" "$?" "1"
ok "invalid --port says why" "grep -q 'not a valid port' $TMP/err"
choose $BASE >/dev/null; check "port already in use is refused" "$?" "1"
ok "in-use message names the port" "grep -q 'Port $BASE is already in use' $TMP/err"
echo "RT_PORT=$BASE" > "$TMP/env"
check "re-running on the same port is allowed (it is our own)" "$(choose $BASE | tail -1)" "$BASE"
rm -f "$TMP/env"

# ptyrun "<answers separated by |>" "<bash command>"  -> runs the command on a pseudo-terminal, answering each prompt in turn.
# Prints the terminal text (CR removed), then EXIT=<code>.
ptyrun() {
  python3 - "$1" "$2" <<'PY'
import os, pty, sys, time, select, re
answers, cmd = sys.argv[1].split("|") if sys.argv[1] != "" else [""], sys.argv[2]
if sys.argv[1] == "": answers = [""] * 20
pid, fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash", "-c", cmd])
out = b""; sent = 0; mark = 0
deadline = time.time() + 20; code = None
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.3)
    if r:
        try: d = os.read(fd, 4096)
        except OSError: break
        if not d: break
        out += d
        if len(out) > mark and out.endswith((b": ", b"]: ", b"] ")) and sent < len(answers):
            os.write(fd, (answers[sent] + "\n").encode()); sent += 1; mark = len(out) + len(answers[sent-1]) + 2
    else:
        done, status = os.waitpid(pid, os.WNOHANG)
        if done: code = os.waitstatus_to_exitcode(status); break
if code is None:
    try:
        done, status = os.waitpid(pid, os.WNOHANG)
        if not done:
            time.sleep(0.5); done, status = os.waitpid(pid, os.WNOHANG)
        if done: code = os.waitstatus_to_exitcode(status)
    except ChildProcessError: pass
if code is None:
    # still waiting for input after the deadline: stop it so the test fails instead of hanging
    import signal
    try:
        os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)
    except (ProcessLookupError, ChildProcessError): pass
    code = 124
sys.stdout.write(out.decode(errors="replace").replace("\r", ""))
print("EXIT=%d" % code)
PY
}
PRE="export ENV_FILE=$TMP/env CONF=$TMP/conf BOOTSTRAP_SOURCE_ONLY=1; source $HERE/bootstrap.sh;"

echo "--- choose_port at a terminal"
rm -f "$TMP/env"
r=$(ptyrun "$((BASE+8))" "$PRE choose_port; echo RESULT=\$PORT"); ok "typed port is accepted" "echo \"\$r\" | grep -q 'RESULT=$((BASE+8))'"
r=$(ptyrun "" "$PRE choose_port; echo RESULT=\$PORT"); ok "empty answer takes the suggestion" "echo \"\$r\" | grep -qE 'RESULT=[0-9]+'"
r=$(ptyrun "70000|$((BASE+9))" "$PRE choose_port; echo RESULT=\$PORT"); ok "bad port re-asks, then accepts" "echo \"\$r\" | grep -q 'RESULT=$((BASE+9))' && echo \"\$r\" | grep -q 'not a valid port'"
r=$(ptyrun "$BASE|$((BASE+6))" "$PRE choose_port; echo RESULT=\$PORT"); ok "port in use re-asks, then accepts" "echo \"\$r\" | grep -q 'RESULT=$((BASE+6))' && echo \"\$r\" | grep -q 'already in use'"

echo "--- validators"
for v in 10.0.0.5 0.0.0.0 255.255.255.255; do ok "is_ipv4 accepts $v" "boot is_ipv4 $v"; done
for v in 256.1.1.1 1.2.3 1.2.3.4.5 a.b.c.d ""; do ok "is_ipv4 rejects '$v'" "! boot is_ipv4 '$v'"; done
for v in 10.0.0.5 10.0.0.0/24 10.0.0.5/32 fd00::1 fd00::/8; do ok "is_ip_or_range accepts $v" "boot is_ip_or_range $v"; done
for v in 10.0.0.0/33 10.0.0.5/ 300.0.0.1 hello fd00::1/129; do ok "is_ip_or_range rejects $v" "! boot is_ip_or_range $v"; done
for v in none 10.0.0.5 "10.0.0.5,10.1.0.0/24" "10.0.0.5, 10.1.0.0/24"; do ok "proxy list accepts '$v'" "boot v_proxy_ips '$v'"; done
for v in "" "10.0.0.5,bad" "999.0.0.1"; do ok "proxy list rejects '$v'" "! boot v_proxy_ips '$v' >/dev/null"; done
ok "domain accepts a hostname" "boot v_domain net.apps.swcrs.org"
ok "domain accepts an IP address" "boot v_domain 192.168.88.133"
ok "domain rejects spaces" "! boot v_domain 'a b' >/dev/null"
ok "domain rejects a leading dash" "! boot v_domain '-a.com' >/dev/null"
ok "email accepts a normal address" "boot v_email you@example.org"
ok "email rejects a missing domain" "! boot v_email you@ >/dev/null"
ok "optional email accepts empty" "boot v_optional_email ''"
ok "listen rejects a name" "! boot v_listen localhost >/dev/null"

echo "--- guided questions (bootstrap.sh --dry-run on a terminal)"
DRY="ENV_FILE=$TMP/env CONF=$TMP/conf bash $HERE/bootstrap.sh --dry-run"
rm -f "$TMP/env" "$TMP/conf"
r=$(ptyrun "net.example.org|1|me@example.org|||$((BASE+11))|" "$DRY")
ok "local flow: finishes cleanly and changes nothing" "echo \"\$r\" | grep -q 'EXIT=0' && echo \"\$r\" | grep -q 'Dry run, nothing was changed'"
ok "local flow: plan says Nginx here" "echo \"\$r\" | grep -q 'Nginx on this server'"
ok "local flow: asked each question" "echo \"\$r\" | grep -q 'Public hostname' && echo \"\$r\" | grep -q 'How will people reach' && echo \"\$r\" | grep -q 'TLS certificate notices' && echo \"\$r\" | grep -q 'PocketBase admin' && echo \"\$r\" | grep -q 'Club PIN' && echo \"\$r\" | grep -q 'Local port' && echo \"\$r\" | grep -q 'Git branch'"
ok "local flow: command carries the answers" "echo \"\$r\" | grep -q -- '--branch main --setup --domain net.example.org --mode local --port $((BASE+11)) --email me@example.org'"
ok "local flow: no proxy questions" "! echo \"\$r\" | grep -q 'allowed to connect'"
r=$(ptyrun "net.example.org|2|admin@example.org||$((BASE+12))|abc|10.0.0.9|10.0.0.5,10.1.0.0/24|dev" "$DRY")
ok "proxy flow: finishes cleanly" "echo \"\$r\" | grep -q 'EXIT=0'"
ok "proxy flow: no certificate question" "! echo \"\$r\" | grep -q 'TLS certificate notices'"
ok "proxy flow: bad listen address is refused and asked again" "echo \"\$r\" | grep -q \"'abc' is not an IPv4 address\""
ok "proxy flow: plan shows address, firewall and branch" "echo \"\$r\" | grep -q 'App listens on    10.0.0.9:$((BASE+12))' && echo \"\$r\" | grep -q 'allow 10.0.0.5,10.1.0.0/24 to reach port $((BASE+12))' && echo \"\$r\" | grep -q 'Git branch        dev'"
ok "proxy flow: command carries the proxy options" "echo \"\$r\" | grep -q -- '--mode proxy --port $((BASE+12)) --superuser-email admin@example.org --listen 10.0.0.9 --proxy-ip'"
r=$(ptyrun "n" "ENV_FILE=$TMP/env CONF=$TMP/conf bash $HERE/bootstrap.sh --domain a.example --email a@example.org --port $((BASE+13)) --branch main --superuser-email a@example.org --dry-run")
ok "options given up front are not asked again" "! echo \"\$r\" | grep -q 'Public hostname' && ! echo \"\$r\" | grep -q 'Local port'"

echo "--- bootstrap.sh without a terminal"
nb() { ( cd "$TMP"; ENV_FILE="$TMP/env" CONF="$TMP/conf" timeout 20 bash "$HERE/bootstrap.sh" "$@" </dev/null 2>&1; echo "EXIT=$?" ); }
r=$(nb --yes --dry-run --domain a.example --email a@example.org --port $((BASE+14)))
ok "all required options given: works and uses defaults" "echo \"\$r\" | grep -q 'EXIT=0' && echo \"\$r\" | grep -q -- '--branch main'"
r=$(nb --yes --dry-run --email a@example.org); ok "missing domain is an error" "echo \"\$r\" | grep -q 'EXIT=1' && echo \"\$r\" | grep -q 'Public hostname'"
r=$(nb --yes --dry-run --domain a.example); ok "local mode without --email is an error" "echo \"\$r\" | grep -q 'EXIT=1' && echo \"\$r\" | grep -q 'TLS certificate notices'"
r=$(nb --yes --dry-run --domain a.example --mode proxy --listen 10.0.0.9); ok "proxy mode without --proxy-ip is an error" "echo \"\$r\" | grep -q 'EXIT=1' && echo \"\$r\" | grep -q 'proxy allowed to connect'"
r=$(nb --yes --dry-run --domain a.example --mode proxy --listen 10.0.0.9 --proxy-ip none --port $((BASE+15))); ok "proxy mode with --proxy-ip none works and says no firewall rule" "echo \"\$r\" | grep -q 'EXIT=0' && echo \"\$r\" | grep -q 'you manage it'"
r=$(nb --yes --dry-run --domain a.example --mode weird); ok "unknown mode is refused" "echo \"\$r\" | grep -q 'EXIT=1' && echo \"\$r\" | grep -q \"must be 'local' or 'proxy'\""
r=$(nb --yes --dry-run --domain 'bad host' --email a@example.org); ok "bad hostname is refused" "echo \"\$r\" | grep -q 'EXIT=1'"
r=$(nb --yes --dry-run --domain a.example --email a@example.org --port 80); ok "privileged port is refused" "echo \"\$r\" | grep -q 'EXIT=1' && echo \"\$r\" | grep -q 'not a valid port'"
r=$(nb --help); ok "--help lists the options" "echo \"\$r\" | grep -q -- '--proxy-ip' && echo \"\$r\" | grep -q -- '--dry-run' && echo \"\$r\" | grep -q 'EXIT=0'"
r=$(nb --bogus); ok "unknown option exits 2" "echo \"\$r\" | grep -q 'EXIT=2'"

r=$(nb --yes --dry-run --domain a.example --email a@example.org --port $((BASE+16)) --pin 'correct-horse')
ok "club PIN is accepted, shown as given, and never printed" "echo \"\$r\" | grep -q 'EXIT=0' && echo \"\$r\" | grep -q 'Club PIN          as given' && ! echo \"\$r\" | grep -q 'correct-horse'"
r=$(nb --yes --dry-run --domain a.example --email a@example.org --port $((BASE+16)) --pin 1234)
ok "a short club PIN is allowed but flagged in the plan" "echo \"\$r\" | grep -q 'EXIT=0' && echo \"\$r\" | grep -q 'SHORT'"
r=$(nb --yes --dry-run --domain a.example --email a@example.org --port $((BASE+16)))
ok "no PIN given: the plan says one is generated" "echo \"\$r\" | grep -q 'random 8-digit'"
r=$(nb --yes --dry-run --domain a.example --email a@example.org --port $((BASE+16)) --pin 'a b')
ok "a PIN with a space is refused" "echo \"\$r\" | grep -q 'EXIT=1'"

echo "--- server.sh"
srv() { ( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; "$@" ); }
rm -f "$TMP/senv"
check "no env file: no port recorded" "$(srv current_port)" ""
printf 'APP_URL=https://x\nRT_PORT=8100\n' > "$TMP/senv"
check "current_port reads the env file" "$(srv current_port)" "8100"
srv set_env_value RT_PORT 8200; check "set_env_value replaces the line" "$(grep -c '^RT_PORT=' "$TMP/senv"):$(srv current_port)" "1:8200"
printf 'APP_URL=https://x\n' > "$TMP/senv"
srv set_env_value RT_PORT 8300; check "set_env_value adds the line when missing" "$(srv current_port)" "8300"
check "set_env_value keeps other lines" "$(grep -c '^APP_URL=' "$TMP/senv")" "1"
printf 'APP_URL=https://x\n' > "$TMP/senv"
srv ensure_port_setting; check "older install without RT_PORT gets 8090 (what it already runs on)" "$(srv current_port)" "8090"
printf 'RT_PORT=8111\n' > "$TMP/senv"
srv ensure_port_setting; check "ensure_port_setting leaves an existing port alone" "$(srv current_port)" "8111"
check "health check follows RT_PORT" "$( ( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; resolve_health_url; echo "$HEALTH_URL" ) )" "http://127.0.0.1:8111/api/health"
check "HEALTH_URL override still wins" "$( ( export HEALTH_URL=http://h/x ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; resolve_health_url; echo "$HEALTH_URL" ) )" "http://h/x"

# An existing env file gets keys that a newer .env.example added, and nothing else changes.
mkdir -p "$TMP/stage"
printf '# the pin\nNCO_PIN=\n\n# Team chat\n# Setup: docs\nSLACK_BOT_TOKEN=\nSLACK_SIGNING_SECRET=\n#PIN_RATE_LIMIT=10\nTZ=America/Phoenix\nAPP_URL=https://x.example\n' > "$TMP/stage/.env.example"
printf 'NCO_PIN=secret1234\nTZ=America/New_York\n' > "$TMP/senv"
( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; STAGE="$TMP/stage"; add_missing_env_keys >/dev/null )
check "env update: Slack keys added, empty" "$(grep -c '^SLACK_BOT_TOKEN=$' "$TMP/senv"):$(grep -c '^SLACK_SIGNING_SECRET=$' "$TMP/senv")" "1:1"
check "env update: their comment came with them" "$(grep -c '^# Team chat$' "$TMP/senv")" "1"
check "env update: existing values untouched" "$(grep '^NCO_PIN=' "$TMP/senv"):$(grep '^TZ=' "$TMP/senv")" "NCO_PIN=secret1234:TZ=America/New_York"
check "env update: keys with a default are left to the installer" "$(grep -c '^APP_URL=' "$TMP/senv")" "0"
check "env update: commented-out keys are not added" "$(grep -c 'PIN_RATE_LIMIT' "$TMP/senv")" "0"
cp "$TMP/senv" "$TMP/senv.after"
( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; STAGE="$TMP/stage"; add_missing_env_keys >/dev/null )
check "env update: a second run changes nothing" "$(cmp -s "$TMP/senv" "$TMP/senv.after" && echo same || echo changed)" "same"
printf 'NCO_PIN=x\n#SLACK_BOT_TOKEN=\nSLACK_SIGNING_SECRET=keep\n' > "$TMP/senv"
( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; STAGE="$TMP/stage"; add_missing_env_keys >/dev/null )
check "env update: a key present, even commented out, is left alone" "$(grep -c 'SLACK_BOT_TOKEN' "$TMP/senv"):$(grep '^SLACK_SIGNING_SECRET=' "$TMP/senv")" "1:SLACK_SIGNING_SECRET=keep"
ok "server valid_port rejects 80" "! srv valid_port 80"

echo "--- server.sh: listen address, health check, firewall"
printf 'APP_URL=https://x\n' > "$TMP/senv"
srv ensure_port_setting
check "older install gets RT_LISTEN=127.0.0.1" "$(srv current_listen)" "127.0.0.1"
hurl() { ( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; LISTEN=$1; PORT=8111; resolve_health_url; echo "$HEALTH_URL" ); }
check "health check: 0.0.0.0 is checked through localhost" "$(hurl 0.0.0.0)" "http://127.0.0.1:8111/api/health"
check "health check: a single address is asked on that address" "$(hurl 10.0.0.9)" "http://10.0.0.9:8111/api/health"
check "health check: localhost stays localhost" "$(hurl 127.0.0.1)" "http://127.0.0.1:8111/api/health"
baddr() { ( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; primary_ip() { echo 192.0.2.7; }; LISTEN=$1; PORT=$2; backend_address ); }
check "backend address: a single listen address" "$(baddr 10.0.0.9 8091)" "10.0.0.9:8091"
check "backend address: 0.0.0.0 becomes this server's main address" "$(baddr 0.0.0.0 8091)" "192.0.2.7:8091"
fw() {  # fw <mode> <port> <proxy ips> -> the ufw commands that setup would run
  ( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"
    ufw() { echo "ufw $*" >> "$TMP/ufw.log"; }; rm -f "$TMP/ufw.log"; sshd() { echo "port 22"; }; systemctl() { :; }; warn() { echo "WARN $*"; }
    MODE=$1; PORT=$2; PROXY_IPS=$3; LISTEN=10.0.0.9; configure_firewall; cat "$TMP/ufw.log" )
}
out=$(fw local 8090 "")
ok "firewall, local mode: ssh, 80 and 443" "echo \"\$out\" | grep -q 'allow 22/tcp' && echo \"\$out\" | grep -q 'allow 80/tcp' && echo \"\$out\" | grep -q 'allow 443/tcp'"
ok "firewall, local mode: the app port is not opened" "! echo \"\$out\" | grep -q 'port 8090'"
out=$(fw proxy 8091 "10.0.0.5,10.1.0.0/24")
ok "firewall, proxy mode: ssh still allowed" "echo \"\$out\" | grep -q 'allow 22/tcp'"
ok "firewall, proxy mode: one rule per proxy address, for the app port only" "echo \"\$out\" | grep -q 'allow from 10.0.0.5 to any port 8091 proto tcp' && echo \"\$out\" | grep -q 'allow from 10.1.0.0/24 to any port 8091 proto tcp'"
ok "firewall, proxy mode: 80 and 443 stay closed" "! echo \"\$out\" | grep -q 'allow 80/tcp' && ! echo \"\$out\" | grep -q 'allow 443/tcp'"
out=$(fw proxy 8091 "none")
ok "firewall, proxy mode with 'none': no rule, with a warning" "! echo \"\$out\" | grep -q 'allow from' && echo \"\$out\" | grep -q 'WARN No firewall rule'"
out=$(fw proxy 8091 "10.0.0.5, 10.1.0.0/24")
ok "firewall: spaces in the list are ignored" "echo \"\$out\" | grep -q 'allow from 10.1.0.0/24 to any port 8091'"

echo "--- server.sh: full setup run with the system steps stubbed"
sim() {  # sim <setup options...> -> output, plus what was called
  ( export ENV_FILE="$TMP/simenv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"
    rm -f "$ENV_FILE"
    for f in install_packages create_user_and_dirs install_pocketbase install_service install_backup do_release create_superuser; do eval "$f() { echo CALLED:$f; }"; done
    write_env_file() { echo CALLED:write_env_file; printf 'APP_URL=https://x\n' > "$ENV_FILE"; }
    install_nginx() { echo CALLED:install_nginx; }
    configure_firewall() { echo "CALLED:configure_firewall mode=$MODE listen=$LISTEN ips=$PROXY_IPS port=$PORT"; }
    primary_ip() { echo 192.0.2.7; }
    cmd_setup "$@"; echo "ENVFILE:"; cat "$ENV_FILE" )
}
out=$(sim --domain a.example --email a@example.org --port 8123 2>&1)
ok "setup, local: installs Nginx and sets up the firewall" "echo \"\$out\" | grep -q 'CALLED:install_nginx' && echo \"\$out\" | grep -q 'CALLED:configure_firewall mode=local listen=127.0.0.1'"
ok "setup, local: env file records the settings" "echo \"\$out\" | grep -q '^RT_PORT=8123' && echo \"\$out\" | grep -q '^RT_LISTEN=127.0.0.1' && echo \"\$out\" | grep -q '^RT_MODE=local'"
ok "setup, local: no proxy instructions" "! echo \"\$out\" | grep -q 'On the reverse proxy server'"
out=$(sim --domain a.example --mode proxy --listen 10.0.0.9 --proxy-ip 10.0.0.5 --port 8124 2>&1)
ok "setup, proxy: Nginx is not installed" "! echo \"\$out\" | grep -q 'CALLED:install_nginx'"
ok "setup, proxy: firewall gets mode, listen address, proxy and port" "echo \"\$out\" | grep -q 'CALLED:configure_firewall mode=proxy listen=10.0.0.9 ips=10.0.0.5 port=8124'"
ok "setup, proxy: env file records the settings" "echo \"\$out\" | grep -q '^RT_LISTEN=10.0.0.9' && echo \"\$out\" | grep -q '^RT_MODE=proxy' && echo \"\$out\" | grep -q '^RT_PROXY_IPS=10.0.0.5' && echo \"\$out\" | grep -q '^RT_PORT=8124'"
ok "setup, proxy: prints a ready-to-paste proxy config" "echo \"\$out\" | grep -q 'On the reverse proxy server' && echo \"\$out\" | grep -q 'server_name a.example;' && echo \"\$out\" | grep -q 'proxy_pass http://10.0.0.9:8124;'"
ok "setup, proxy: the config keeps realtime unbuffered and sets X-Real-IP" "echo \"\$out\" | grep -q 'proxy_buffering off' && echo \"\$out\" | grep -q 'X-Real-IP'"
ok "setup, proxy: no placeholders left in the printed config" "! echo \"\$out\" | sed -n '/On the reverse proxy server/,/CALLED:\\|Next:/p' | grep -q '__'"
ok "setup, proxy: a certificate email is not needed" "! echo \"\$out\" | grep -q 'needs --email'"
out=$(sim --domain a.example --mode proxy --proxy-ip 10.0.0.5 --port 8124 2>&1)
ok "setup, proxy: default listen address is this server's main address" "echo \"\$out\" | grep -q '^RT_LISTEN=192.0.2.7'"
for bad in "--domain a.example --mode proxy --listen 10.0.0.9" "--domain a.example --mode proxy --listen abc --proxy-ip 10.0.0.5" "--domain a.example --mode proxy --listen 10.0.0.9 --proxy-ip 999.1.1.1" "--domain a.example --email a@x.org --mode weird" "--email a@x.org" "--domain a.example"; do
  out=$(sim $bad 2>&1); ok "setup refuses: $bad" "echo \"\$out\" | grep -q 'ERROR' && ! echo \"\$out\" | grep -q 'CALLED:install_packages'"
done
out=$(sim --domain a.example --email a@example.org --port 80 2>&1); ok "setup refuses a privileged port" "echo \"\$out\" | grep -q 'invalid port'"

echo "--- server.sh: write_env_file (club PIN)"
mkdir -p "$TMP/stage"; cp "$HERE/../.env.example" "$TMP/stage/.env.example"
wenv() { # PIN value (may be empty) -> prints the NCO_PIN line and the warning text
  rm -f "$TMP/penv"
  ( export ENV_FILE="$TMP/penv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; STAGE="$TMP/stage"; DOMAIN=net.example.org; SVC_USER=root
    chown() { :; }; PIN=$1; NEW_PIN=; GENERATED_PIN=no; write_env_file >/dev/null 2>"$TMP/werr"; sed -n 's/^NCO_PIN=//p' "$ENV_FILE"; echo "GEN=$GENERATED_PIN" ); }
r=$(wenv ""); ok "no PIN given: an 8-digit PIN is generated and saved" "echo \"\$r\" | head -1 | grep -qE '^[0-9]{8}\$' && echo \"\$r\" | grep -q 'GEN=yes'"
r=$(wenv "correct-horse"); ok "a given PIN is saved as is, no warning" "echo \"\$r\" | head -1 | grep -q '^correct-horse\$' && echo \"\$r\" | grep -q 'GEN=no' && ! grep -q 'shorter than 6' \"$TMP/werr\""
r=$(wenv "1234"); ok "a short PIN is saved but warned about" "echo \"\$r\" | head -1 | grep -q '^1234\$' && grep -q 'shorter than 6' \"$TMP/werr\""
ok "env file gets the public URL" "grep -q '^APP_URL=https://net.example.org' \"$TMP/penv\""
ok ".env.example sets the club time zone" "grep -q '^TZ=America/Phoenix' '$HERE/../.env.example'"

echo "--- instances (--name)"
vn() { boot v_name "$1" >/dev/null; }
for v in blog round-table-net a b2 my-app-2; do ok "name accepts '$v'" "vn '$v'"; done
for v in "" Blog 1blog -blog "my app" "a/b" "a.b" abcdefghijklmnopqrstuvwxy; do ok "name rejects '$v'" "! vn '$v'"; done
bp() { ( unset ENV_FILE CONF SRC; export NAME=$1 BOOTSTRAP_SOURCE_ONLY=1; source "$HERE/bootstrap.sh"; echo "$SRC $KEY $ENV_FILE $CONF" ); }
check "bootstrap paths, default instance" "$(bp round-table-net)" "/opt/round-table-net-src /root/.ssh/round-table-net-deploy /etc/round-table-net/env /etc/round-table-net/update.conf"
check "bootstrap paths, named instance" "$(bp blog)" "/opt/blog-src /root/.ssh/blog-deploy /etc/blog/env /etc/blog/update.conf"
sp() { ( unset ENV_FILE APP DATA SVC_USER BACKUP_DIR; export NAME=$1 SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; echo "$APP $DATA $ENV_FILE $SVC_USER $BACKUP_DIR" ); }
check "server paths, default instance (unchanged from before)" "$(sp round-table-net)" "/opt/round-table-net /var/lib/round-table-net /etc/round-table-net/env rtnet /var/backups/round-table-net"
check "server paths, named instance" "$(sp blog)" "/opt/blog /var/lib/blog /etc/blog/env blog /var/backups/blog"
out=$(NAME='Bad Name' SERVER_SH_SOURCE_ONLY=1 bash "$HERE/server.sh" 2>&1); check "server.sh refuses a bad name" "$?" "1"
ok "server.sh says why" "echo \"\$out\" | grep -q 'invalid instance name'"
out=$(cd "$TMP" && timeout 20 bash "$HERE/bootstrap.sh" --dry-run --yes --name 'Bad Name' --domain a.example --email a@x.org --port $((BASE+20)) 2>&1); rc=$?
check "bootstrap refuses a bad --name" "$rc" "1"
ok "bootstrap explains the name rule" "echo \"\$out\" | grep -q 'not a valid name'"
out=$(cd "$TMP" && ENV_FILE="$TMP/none" CONF="$TMP/none" timeout 20 bash "$HERE/bootstrap.sh" --dry-run --yes --name blog --domain blog.example --email a@x.org --port $((BASE+20)) 2>&1); rc=$?
check "bootstrap --name dry run succeeds" "$rc" "0"
ok "plan shows the instance name" "echo \"\$out\" | grep -q 'Instance name     blog'"
ok "plan shows the instance's update command" "echo \"\$out\" | grep -q 'blog-update --branch main --setup'"
# unit file and cron line for two instances
inst() {  # inst <name> -> renders the unit and cron line into $TMP/<name>/
  ( unset ENV_FILE APP DATA SVC_USER BACKUP_DIR; export NAME=$1 SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"
    mkdir -p "$TMP/$1/units" "$TMP/$1/cron" "$TMP/$1/app"
    UNIT_DIR="$TMP/$1/units"; CRON_DIR="$TMP/$1/cron"; APP="$TMP/$1/app"
    systemctl() { :; }
    install_service >/dev/null; install_backup ) >/dev/null 2>&1
}
inst round-table-net; inst blog
ok "default unit: user, paths and env file as before" "grep -q '^User=rtnet' $TMP/round-table-net/units/round-table-net.service && grep -q '^EnvironmentFile=/etc/round-table-net/env' $TMP/round-table-net/units/round-table-net.service && grep -q -- '--dir /var/lib/round-table-net/pb_data' $TMP/round-table-net/units/round-table-net.service"
ok "named unit: own file, user, env file and data folder" "grep -q '^User=blog' $TMP/blog/units/blog.service && grep -q '^EnvironmentFile=/etc/blog/env' $TMP/blog/units/blog.service && grep -q -- '--dir /var/lib/blog/pb_data' $TMP/blog/units/blog.service && grep -q '^ReadWritePaths=/var/lib/blog' $TMP/blog/units/blog.service"
ok "named unit: nothing of the default instance left" "! grep -q 'round-table-net\|rtnet' $TMP/blog/units/blog.service"
ok "units keep the port settings from the env file" "grep -q -- '--http \${RT_LISTEN}:\${RT_PORT}' $TMP/blog/units/blog.service"
ok "no placeholders left in a unit" "! grep -q '__[A-Z]*__' $TMP/blog/units/blog.service"
ok "named cron: own file, user, data and backup folder" "grep -q ' blog DATA=/var/lib/blog/pb_data OUT=/var/backups/blog ' $TMP/blog/cron/blog && grep -q 'logger -t blog-backup' $TMP/blog/cron/blog"
ok "default cron: backs up the default data" "grep -q ' rtnet DATA=/var/lib/round-table-net/pb_data OUT=/var/backups/round-table-net ' $TMP/round-table-net/cron/round-table-net"
# update.sh learns the name from its own file name
cp "$HERE/update.sh" "$TMP/blog-update"; cp "$HERE/update.sh" "$TMP/update.sh"
if [ "$(id -u)" = 0 ]; then
  out=$(bash "$TMP/blog-update" 2>&1); ok "update command named blog-update looks in /opt/blog-src" "echo \"\$out\" | grep -q '/opt/blog-src'"
  out=$(bash "$TMP/update.sh" 2>&1); ok "update.sh run directly uses the default instance" "echo \"\$out\" | grep -q '/opt/round-table-net-src'"
  out=$(NAME=other bash "$TMP/update.sh" 2>&1); ok "NAME in the environment overrides" "echo \"\$out\" | grep -q '/opt/other-src'"
else
  echo "SKIP update.sh name tests (need root)"
fi

echo "--- generated config"
sed -e "s|__DOMAIN__|net.example.org|g" -e "s|__BACKEND__|127.0.0.1:8123|g" "$HERE/nginx.conf" > "$TMP/site.conf"
check "nginx: no placeholders left" "$(grep -c '__' "$TMP/site.conf")" "0"
check "nginx: every proxy_pass uses the chosen port" "$(grep -c 'proxy_pass http://127.0.0.1:8123;' "$TMP/site.conf")" "3"
check "nginx: old fixed port is gone" "$(grep -c '8090' "$TMP/site.conf")" "0"
ok "systemd unit reads address and port from the env file" "grep -q -- '--http \${RT_LISTEN}:\${RT_PORT}' '$HERE/round-table-net.service'"
ok "systemd unit loads the instance's env file" "grep -q '^EnvironmentFile=__ENV_FILE__' '$HERE/round-table-net.service'"
ok ".env.example documents the settings" "grep -q '^RT_PORT=8090' '$HERE/../.env.example' && grep -q '^RT_LISTEN=127.0.0.1' '$HERE/../.env.example' && grep -q '^RT_MODE=local' '$HERE/../.env.example'"

echo
[ "$FAILS" = 0 ] && echo "ALL PASSED" || echo "$FAILS FAILED"
exit $((FAILS > 0))
