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
| `POST /api/rt/session/close` | `{ session_id, technical_difficulty }` | Drops "not heard" rows, adds guests to the roster flagged for review, records the attendance count, updates the roster (skipped with technical difficulty) and sets the session `closed`, all in one transaction. Returns `{ status, checkin_count, guests_added, stations_updated }`. `409` if it is not open. |
| `POST /api/rt/session/publish` | `{ session_id }` | Posts the report to WordPress (optional AI summary). `4xx/5xx` with the reason when WordPress or the settings are missing. |

## Team chat (Slack)

Per net, in Manage Nets: a switch and the Slack channel ID. The Slack app and its two secrets are shared by the server (see `slack-chat.md`).

| Route | Body | What it does |
|---|---|---|
| `GET /api/rt/slack/status` | | `200 { configured }`: the server has `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`. |
| `POST /api/rt/slack/test` | `{ channel }` | Posts a test message. `400` with Slack's reason in plain words (app not in the channel, unknown channel, name instead of ID). |
| `POST /api/rt/chat/send` | `{ session_id, text }` | Posts `*CALL (NCO):* text` in the session's Slack thread (starting it if needed) and stores the message. `409` if the session is closed or chat is off for the net; `502` with Slack's reason. |
| `POST /api/rt/slack/events` | Slack's event JSON | **Slack only, no sign-in.** Refused unless `X-Slack-Signature` is valid and `X-Slack-Request-Timestamp` is under five minutes old. Stores people's replies in a session's thread; ignores everything else. |

Opening a session on a chat-enabled net posts the thread's first message; closing it posts "Net closed". Messages live in `chat_messages` (operators read, only the server writes, deleted with their session).
Limits: `/api/rt/chat/` 60 and `/api/rt/slack/` 600 requests a minute.

## Roster update

The close route updates the roster itself. There is no scheduled job. At server start, any session an older version left `pending` is finished once (`bootstrap.pb.js`).
Roster rules: attended (checked in, short time, early) resets absences; a miss adds one; reaching the net's `max_absences` in a row makes the station inactive (set per net, default 3; `0` turns the rule off: absences are not counted and no one is dropped);
`permanent_attendance` and `needs_review` stations are never dropped; technical difficulty skips the update.
Times use the server's time zone (`TZ` in the env file, default in `.env.example` is `America/Phoenix`).

## Live updates

The signed-in front end subscribes to PocketBase realtime (`/api/realtime`) for `stations` and `check_ins`.
Nginx must not buffer that path (the shipped `deploy/nginx.conf` already handles it).
