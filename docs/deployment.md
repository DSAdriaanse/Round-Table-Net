# Deploying on Debian

Layout on the server (with the default name `round-table-net`; `--name` changes every path and the service name):

| Path | Contents |
|---|---|
| `/opt/round-table-net/pocketbase` | PocketBase binary (v0.36.x, checksum verified on install) |
| `/opt/round-table-net/pb_migrations`, `pb_hooks`, `dist` | copied from `backend/` and the built `web/` |
| `/var/lib/round-table-net/pb_data` | the database (back this up) |
| `/etc/round-table-net/env` | settings and secrets (see `.env.example`) |
| `/var/backups/round-table-net` | hourly backups, kept 14 days |

## Install

Prerequisites: a Debian server you can ssh into as root; DNS for your hostname already pointing at it (the certificate needs it); the pull requests merged to `main` (or pass `--branch`).

```bash
scp deploy/bootstrap.sh root@your-server:
ssh root@your-server
bash bootstrap.sh --domain net.apps.swcrs.org --email you@example.org --superuser-email you@example.org
```

With no options it asks (hostname, how people reach the app, certificate email, admin email, **club PIN**, port, branch), shows a plan and waits for a yes. Useful options:
`--domain --mode local|proxy --email --superuser-email --pin --port --listen --proxy-ip --name --branch --repo --yes --dry-run`.
`--dry-run` shows the plan and changes nothing; `--yes` never asks.

It installs Node 22, clones the public repo over HTTPS (no key; a private fork passed with an SSH `--repo` address gets a read-only deploy key to add on GitHub), builds, and sets up PocketBase, systemd, the firewall and backups (plus Nginx and a Let's Encrypt certificate in local mode).
At the end it prints the PocketBase admin login (shown once; change it in the admin UI) and, if you did not pass `--pin`, the generated **club PIN** (also kept as the `NCO_PIN` line in the env file).

**Choose a PIN of 6 or more characters.** The server allows 10 attempts per minute per address and the installer warns about short PINs, but a short PIN can still be guessed.
Passing `--pin` on the command line leaves it in the shell history and process list for a moment; prefer the prompt or the generated one.

## Settings

- **In the app** (Settings screen): club name, WordPress address, username and category, and whether to post the report when a session closes.
- **In `/etc/round-table-net/env`** (then `systemctl restart round-table-net`): `NCO_PIN`, `WORDPRESS_APP_PASSWORD`, `ANTHROPIC_API_KEY` (optional, adds a summary paragraph), `TZ` (the club's time zone; session dates and post times follow it).

## Update

```bash
ssh root@your-server
round-table-net-update            # pull, build, back up, release, health check, roll back on failure
round-table-net-update --branch dev
```

A rollback restores the previous code only. If a release changed the schema, restore a backup from `/var/backups/round-table-net`.

## Reverse proxy mode

`--mode proxy --listen <this server's address> --proxy-ip <proxy address or range>`: the app listens on that address, the firewall admits only the proxy, and the script prints an Nginx site to paste on the proxy (also saved as `/etc/round-table-net/nginx-proxy.conf`). Keep its `proxy_set_header` lines and its `/api/realtime` block (no buffering, 3 h read timeout) or live updates stall.

## Backups

Hourly consistent SQLite backups via cron (`/etc/cron.d/round-table-net`), 14 days kept. Copy `/var/backups/round-table-net` off the machine regularly. To restore: stop the service, unpack a `pb-*.tar.gz` into `/var/lib/round-table-net/pb_data`, fix ownership, start.

## Moving the old app's data

`node scripts/import-base44.mjs <export.json or csv-folder> --dry-run` first, then without `--dry-run` (see the README, including the two options for data left behind by deleted nets).

## What was and was not tested

Tested here: the shell scripts' parsing, validation, plan output, generated files (systemd unit, Nginx site, cron line, env file, PIN handling) and instance naming, with the system commands stubbed (`deploy/test/install.test.sh`, also run in CI); the app itself against a real PocketBase.
**Not tested:** a real install on a Debian server. `apt`, `useradd`, systemd, `ufw`, Nginx, certbot, the deploy-key and `git clone` steps, and the PocketBase and Node downloads have not been run by the author. Run `bash bootstrap.sh --dry-run` first on the server, and try the first install on a spare machine or a snapshot. The scripts are adapted from a working installer for a sister app (Priority-Watch), which lowers but does not remove that risk.
