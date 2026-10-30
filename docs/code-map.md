# Code map

Where things are and where to look when you want to change something.

## Back end (`backend/`)

| File | What it does |
|---|---|
| `pb_migrations/1760000000_schema.js` | The tables, fields, indexes and **access rules**. Change the schema with a new, later-dated migration file; never edit this one on a live database. |
| `pb_hooks/bootstrap.pb.js` | App name and URL, trusted proxy header, rate limits, and a one-time sweep of any session left `pending` by an older version. |
| `pb_hooks/auth.pb.js` | PIN sign-in. |
| `pb_hooks/normalize.pb.js` | Upper-cases and trims callsigns; refuses a duplicate check-in. |
| `pb_hooks/public.pb.js` | The three no-sign-in routes. |
| `pb_hooks/sessions.pb.js` | Close (including the roster update) and publish routes. |
| `pb_hooks/slack.pb.js` | Team chat routes (status, test, send, Slack events) and the hook that starts a session's Slack thread. |
| `pb_hooks/lib/slack.js` | Slack calls, text escaping and clean-up, thread start and close notice. |
| `pb_hooks/lib/roster.js` | The roster update rules (absences, going inactive). |
| `pb_hooks/lib/report.js` | The WordPress post and AI summary. |
| `pb_hooks/lib/util.js` | Small shared helpers. |
| `test/` | End-to-end tests with fake Anthropic and WordPress. See `test/README.md`. |

## Front end (`web/src/`)

| Folder | What it holds |
|---|---|
| `api/` | The only door to the server: one typed file per feature, `types.ts` (matches the schema) and `records.ts` (small helpers). Screens import from `@/api` only. |
| `features/<name>/` | One folder per area: `auth`, `nco` (net control), `checkin` (public), `roster`, `nets`, `history`, `announcements`, `dashboard`, `guide`, `settings`. |
| `components/` | Layout and menu (`Layout.tsx`), net choice (`NetContext`, `NetSelectionGate`), shared pieces (`RichTextEditor`, `StationMap`), `ui/` (shadcn). |
| `hooks/useNetData.ts` | Live roster and check-in caches fed by realtime. |
| `utils/shortcodes.ts` | `[/TOPIC]` and `[/ANNOUNCEMENTS]` in net scripts. |
| `App.tsx` | The map of addresses to screens, including the old-address redirects. |

To add a screen: a file in `features/`, a `Route` in `App.tsx`, an entry in `navGroups` in `Layout.tsx`.
To add a field: the migration, `api/types.ts`, then the screens the compiler points at.

## Deployment (`deploy/`)

| File | What it does |
|---|---|
| `bootstrap.sh` | Guided first install on a fresh Debian server. |
| `update.sh` | Installed as `<name>-update`: pull, build, release. |
| `server.sh` | Runs on the server: packages, user, PocketBase, env file, service, Nginx, firewall, backups, release with rollback. |
| `round-table-net.service`, `nginx.conf`, `backup.sh` | Templates the scripts fill in. |
| `test/install.test.sh` | Tests of the scripts with the system commands stubbed. |
