# Round Table Net

Net control logging for the SWCRS Round Table GMRS nets. A net control operator (NCO) opens a session, logs who checks in (by pileup or roll call), closes the session, and the roster updates itself: stations that miss three nets in a row drop off, guests are added for review. Stations can also check themselves in from a phone. The report can be posted to the club's WordPress site.

It replaces the Base44 app of the same name and runs on one small Debian server that you own.

- Operators sign in with a shared **club PIN**. No individual accounts.
- The public check-in page needs no sign-in and shows only callsigns and status.
- Built on PocketBase (one Go program with a SQLite database), React and Tailwind.

## What you need

- A Debian or Ubuntu server you can reach over SSH as root, 2 GB of RAM or more (the front-end build needs it; add a swap file on a smaller machine).
- A hostname pointing at the server, for example `net.example.org`, if you want Nginx and a free TLS certificate installed for you. If you already run a reverse proxy elsewhere you can skip this (see "Reverse proxy mode" in [docs/deployment.md](docs/deployment.md)).
- Nothing to set up for repository access: the repository is public and the installer clones it over HTTPS. (Only for a private fork: pass `--repo git@github.com:you/your-fork.git` and the installer creates a read-only deploy key and shows it to you to paste into GitHub, Settings, Deploy keys, "Allow write access" unchecked.)
- Optional, can be added later: a WordPress application password to post reports, an Anthropic API key for the one-paragraph summary in those posts.

## Install

> **Not yet run on a real server.** The installer scripts are tested with the system commands stubbed, not on a live Debian machine. Try it first on a spare machine or a snapshot, and start with `bash bootstrap.sh --dry-run`, which only shows the plan. Details: [docs/deployment.md](docs/deployment.md).

On your own computer, copy the installer to the server and run it:

```bash
scp deploy/bootstrap.sh root@your-server:
ssh root@your-server
bash bootstrap.sh
```

It asks a few questions (hostname, whether Nginx runs here or on another machine, certificate email, an admin email, the **club PIN**, a port, the git branch), shows a plan and waits for a yes. Afterwards you have PocketBase, the app, systemd, Nginx with TLS, a firewall and hourly backups.

At the end it prints, once, the PocketBase admin login (the database admin, separate from the club PIN) and, if you let it generate one, the club PIN. **Use a PIN of 6 or more characters**: the server limits attempts to 10 a minute per address, but a short PIN can still be guessed.

Then:

1. Open your hostname and sign in with the club PIN.
2. **Settings**: club name, and, to post reports to WordPress, the site address, username and category. The WordPress password and the AI key go in `/etc/round-table-net/env` on the server (listed in `.env.example`); run `systemctl restart round-table-net` afterwards.
3. **Manage Nets** to add your nets and their opening and closing scripts, **Roster Manager** to add stations (or bulk-paste them from a spreadsheet), **Announcements** for the opening.
4. Coming from the Base44 app? See "Moving the old data" below.

Running the installer without questions, with another port or name: [docs/deployment.md](docs/deployment.md).

## Running a net

Open **Net Control**, enter your callsign (and a topic), **Open Session**. The tabs are Opening (the script and announcements to read), Pileup Logger (fast logging when many stations come in at once), Standard Roll (the roll call) and Close Session. The in-app **NCO Guide** walks through each.

Stations check in themselves at `/check-in?net_id=<id>` (the old `/PublicCheckin?net_id=...` links keep working). The list on that page and on every operator's screen updates live.

When a session is closed, the roster is updated within 15 minutes by a background job: attending stations reset their absences, missing ones gain one, three in a row makes a station inactive. Permanent-attendance stations and guests under review are never dropped, and a session closed with "Technical Difficulty" skips the update.

## Update

On the server:

```bash
round-table-net-update
```

It pulls the branch, builds, backs up the database, swaps the new version in, checks it is healthy and rolls back if not.

## Backups

Hourly, kept 14 days, in `/var/backups/round-table-net`. Copy that folder off the machine regularly.

## Moving the old data

Use the app's "Export all data" button, which downloads one JSON file, or export the five tables from Base44 as CSV (Net, Station, NetSession, CheckIn, Announcement) into one folder. Then, from any computer with Node 22:

```bash
node scripts/import-base44.mjs ./export.json --dry-run          # or a CSV folder; reads and checks the file, changes nothing
PB_URL=https://net.example.org PB_SUPERUSER_EMAIL=you@example.org PB_SUPERUSER_PASSWORD='...' \
  node scripts/import-base44.mjs ./export.json
PB_URL=... PB_SUPERUSER_EMAIL=... PB_SUPERUSER_PASSWORD=... node scripts/verify-import.mjs
```

It imports into an empty install only, keeps the old ids in a `legacy_id` field, skips rows left behind by deleted nets, and writes `restore-dates.sql` to restore the original timestamps (optional; the script prints how).

Orphaned data is skipped by default, and the dry run says how many rows each rule affects: rows that belong to a net the old app deleted, and check-ins that name a roster station that is not in the export (usually test entries). Two options change that:

- `--recreate-missing-nets`: makes a net for each deleted net, named from its sessions, so its stations, sessions and check-ins are kept. Its weekday is a guess and its time is unknown, so edit it afterwards. It shows in the net list like any other net, and deleting it also deletes its history.
- `--keep-dangling-checkins`: imports the check-ins that name a missing roster station, with no station link.

The export file holds callsigns, names and user emails: keep it out of git (`*-export-*.json` is ignored).

## Example data

`example-data/` holds an export of the club's nets as received: 3 nets, 120 stations, 12 sessions, 174 check-ins, 2 announcements after the importer skips rows of a deleted net. To try the app with it, on a development copy:

```bash
node scripts/import-base44.mjs example-data
```

**This is real club data** (callsigns, names, cities, comments). Do not leave it in a public repository unless the people in it are fine with that.

## Developing

You need Node 22 and the PocketBase 0.36 binary (download from the PocketBase releases page).

```bash
# 1. backend (the first line makes a database admin for the admin UI at /_/)
./pocketbase superuser upsert you@example.org 'a-long-password' --dir ./pb_dev --migrationsDir backend/pb_migrations
NCO_PIN=dev-pin-123 TZ=America/Phoenix ./pocketbase serve --dir ./pb_dev \
  --migrationsDir backend/pb_migrations --hooksDir backend/pb_hooks --http 127.0.0.1:8090

# 2. front end, in another terminal (proxies /api to port 8090)
cd web && npm ci && npm run dev        # http://localhost:5173
```

Checks: `npm run lint && npm run typecheck && npm run build` in `web/`; `node --test backend/test/api.test.mjs` (backend, see `backend/test/README.md`); `bash deploy/test/install.test.sh` (installer); `node --test scripts/import-base44.test.mjs` (importer). CI runs all of them on every pull request.

Where things are: [docs/code-map.md](docs/code-map.md). Server routes: [docs/endpoints.md](docs/endpoints.md).

## Known limits

- One shared PIN: everyone with it has the same access, and there is no record of who did what beyond the NCO callsign typed on each session.
- The map and the station coordinate lookup use outside services (CARTO tiles, OpenStreetMap Nominatim) from the browser.
- WordPress posting, the AI summary and the real installer have only been exercised against fakes or stubs (see the test notes in the pull requests).

## Licence

GPL-3.0. See `LICENSE`.
