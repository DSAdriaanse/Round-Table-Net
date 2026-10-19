# Server routes

Everything else the front end does goes straight to PocketBase collections under the rules in
`backend/pb_migrations/1760000000_schema.js`. These custom routes live in `backend/pb_hooks/`.
Errors come back as JSON `{ "message": "..." }` with the status shown.

## No sign-in needed (rate limited per client address)

| Route | Body / query | Answers |
|---|---|---|
| `GET /api/rt/public/nets` | | `200` list of `{ id, name, day_of_week, time, frequency, is_live }` |
| `GET /api/rt/public/session?net=<id>` | | `200 { net, session \| null, check_ins: [{ callsign, status }] }` (no names or comments); `404` unknown net |
| `POST /api/rt/public/checkin` | `{ net_id, callsign, name, location, comment }` | `200` checked in; `409 { result: "already" }`; `404 { result: "no_session" }`; `400` bad callsign |
| `POST /api/rt/auth/pin` | `{ pin }` | `200` normal PocketBase sign-in (`token`, `record`) for the club account; `401` wrong PIN; `503` `NCO_PIN` not set |

Limits: `PUBLIC_RATE_LIMIT` (default 30) and `PIN_RATE_LIMIT` (default 10) requests per minute per client address.
Behind Nginx the address comes from `X-Real-IP` (`TRUST_PROXY_HEADER`), so keep the app reachable only through the proxy.

## Signed in (club account)

| Route | Body | What it does |
|---|---|---|
| `POST /api/rt/session/close` | `{ session_id, technical_difficulty }` | Drops "not heard" rows, adds guests to the roster flagged for review, records the attendance count, sets the session `pending` (or `closed` at once with technical difficulty). `409` if it is not open. |
| `POST /api/rt/session/process` | `{ session_id? }` | Updates the roster for one pending session now (no id: the oldest pending one). `409` if not pending. |
| `POST /api/rt/session/publish` | `{ session_id }` | Posts the report to WordPress (optional AI summary). `4xx/5xx` with the reason when WordPress or the settings are missing. |

## Scheduled

`processPendingSessions` runs every 15 minutes and processes every `pending` session; one failure does not block the others.
Roster rules: attended (checked in, short time, early) resets absences; a miss adds one; three in a row makes the station inactive;
`permanent_attendance` and `needs_review` stations are never dropped; technical difficulty skips the update.
Times use the server's time zone (`TZ` in the env file, default in `.env.example` is `America/Phoenix`).

## Live updates

The signed-in front end subscribes to PocketBase realtime (`/api/realtime`) for `stations` and `check_ins`.
Nginx must not buffer that path (the shipped `deploy/nginx.conf` already handles it).
