/// <reference path="../pb_data/types.d.ts" />
//
// Team chat between the net control screen and a Slack channel. Each net chooses whether to use it
// and which channel (Manage Nets); the Slack app and its secrets are shared (SLACK_BOT_TOKEN and
// SLACK_SIGNING_SECRET in the env file). Every session gets its own Slack thread, so replies find
// their way back by thread and two nets can share one channel.
//
//   GET  /api/rt/slack/status    operators:  is Slack set up on this server?
//   POST /api/rt/slack/test      operators:  { channel }  post a test message to a channel
//   POST /api/rt/chat/send       operators:  { session_id, text }  say something in the session's thread
//   POST /api/rt/slack/events    Slack only: new messages in threads (checked with Slack's signature)
// and a hook that starts the session's thread when a session is opened.
//
// Messages are stored in chat_messages (readable by operators, written only here), which the
// screen watches live. Not handled yet: edited and deleted Slack messages, and files.

routerAdd("GET", "/api/rt/slack/status", (e) => {
  const u = require(`${__hooks}/lib/util.js`);
  const slack = require(`${__hooks}/lib/slack.js`);
  u.requireNco(e);
  return e.json(200, { configured: slack.configured(u) });
});

routerAdd("POST", "/api/rt/slack/test", (e) => {
  const u = require(`${__hooks}/lib/util.js`);
  const slack = require(`${__hooks}/lib/slack.js`);
  u.requireNco(e);
  if (!slack.configured(u)) throw new ApiError(409, slack.friendly("not_configured"), {});
  const channel = u.trunc((e.requestInfo().body || {}).channel, 40).trim();
  if (!/^[CG][A-Z0-9]{6,}$/.test(channel)) throw new BadRequestError("Enter the channel ID (it starts with C or G, such as C0123ABCD), not the channel name.");
  const r = slack.call(u, "chat.postMessage", { channel: channel, text: ":white_check_mark: Round Table Net is connected to this channel. (Test message from Manage Nets.)" });
  if (!r.ok) throw new BadRequestError(slack.friendly(r.error));
  return e.json(200, { ok: true });
});

routerAdd("POST", "/api/rt/chat/send", (e) => {
  const u = require(`${__hooks}/lib/util.js`);
  const slack = require(`${__hooks}/lib/slack.js`);
  u.requireNco(e);
  const body = e.requestInfo().body || {};

  const text = u.trunc(body.text, 2000).trim();
  if (!text) throw new BadRequestError("Type a message first.");

  let session = null;
  try { session = $app.findRecordById("net_sessions", u.trunc(body.session_id, 40)); } catch (_) {}
  if (!session) throw new NotFoundError("No such session.");
  if (session.getString("status") !== "open") throw new ApiError(409, "This session is closed, so its chat is closed too.", {});

  let net = null;
  try { net = $app.findRecordById("nets", session.getString("net_id")); } catch (_) {}
  if (!slack.channelFor(u, net)) throw new ApiError(409, "Team chat is not turned on for this net.", {});

  const thread = slack.ensureThread($app, u, net, session);
  if (!thread.ok) throw new ApiError(502, slack.friendly(thread.error), {});

  // The sender is the session's NCO. Everyone shares one sign-in, so the callsign is the only identity there is.
  const author = session.getString("nco_callsign") + " (NCO)";
  const r = slack.replyInThread(u, thread.channel, thread.ts, "*" + slack.escapeForSlack(author) + ":* " + slack.escapeForSlack(text));
  if (!r.ok) throw new ApiError(502, slack.friendly(r.error), {});

  const rec = new Record($app.findCollectionByNameOrId("chat_messages"));
  rec.set("session_id", session.id);
  rec.set("net_id", net.id);
  rec.set("source", "nco");
  rec.set("author", author);
  rec.set("text", text);
  rec.set("slack_ts", r.data.ts || "");
  $app.save(rec);
  return e.json(200, { ok: true, id: rec.id });
});

// Slack calls this for every message in a channel the app is in. We answer 200 quickly and keep only
// replies that belong to a session's thread.
routerAdd("POST", "/api/rt/slack/events", (e) => {
  const u = require(`${__hooks}/lib/util.js`);
  const slack = require(`${__hooks}/lib/slack.js`);
  const secret = u.env("SLACK_SIGNING_SECRET");
  if (!secret) throw new NotFoundError("Not found.");

  // Is this really Slack? Its signature is an HMAC of "v0:<timestamp>:<exact body>" with our signing secret,
  // and a timestamp more than five minutes old is refused so a captured request cannot be replayed.
  const raw = toString(e.request.body, 1048576);
  const stamp = e.request.header.get("X-Slack-Request-Timestamp") || "";
  const signature = e.request.header.get("X-Slack-Signature") || "";
  if (!(Math.abs(Date.now() / 1000 - Number(stamp)) < 300)) throw new BadRequestError("Stale or missing timestamp.");
  if (!$security.equal("v0=" + $security.hs256("v0:" + stamp + ":" + raw, secret), signature)) throw new UnauthorizedError("Bad signature.");

  let payload = null;
  try { payload = JSON.parse(raw); } catch (_) { throw new BadRequestError("Not JSON."); }

  // The one-time handshake when the address is first saved in the Slack app settings.
  if (payload.type === "url_verification") return e.json(200, { challenge: String(payload.challenge || "") });
  if (payload.type !== "event_callback" || !payload.event) return e.json(200, {});

  // Only a person's reply inside a thread. Our own posts, other bots, edits, files and top-level chatter are ignored.
  const ev = payload.event;
  if (ev.type !== "message" || ev.bot_id || ev.subtype || !ev.user || !ev.ts || !ev.thread_ts || ev.thread_ts === ev.ts) return e.json(200, {});

  const sessions = u.find($app, "net_sessions", "slack_thread_ts = {:t} && slack_channel = {:c}", "", { t: u.trunc(ev.thread_ts, 40), c: u.trunc(ev.channel, 40) });
  if (!sessions.length) return e.json(200, {});
  const session = sessions[0];

  let net = null;
  try { net = $app.findRecordById("nets", session.getString("net_id")); } catch (_) {}
  if (!net || !net.getBool("slack_enabled")) return e.json(200, {});

  const text = slack.cleanSlackText(u.trunc(ev.text, 4000));
  if (!text) return e.json(200, {});

  // Slack re-sends an event it thinks we missed; the same message is stored once.
  const seen = u.find($app, "chat_messages", "session_id = {:s} && slack_ts = {:t}", "", { s: session.id, t: ev.ts });
  if (seen.length) return e.json(200, {});

  const rec = new Record($app.findCollectionByNameOrId("chat_messages"));
  rec.set("session_id", session.id);
  rec.set("net_id", net.id);
  rec.set("source", "slack");
  rec.set("author", u.trunc(slack.userName(u, ev.user), 100));
  rec.set("text", text);
  rec.set("slack_ts", ev.ts);
  try { $app.save(rec); } catch (_) {} // a simultaneous retry hit the unique index: already stored
  return e.json(200, {});
});

// A new session starts its Slack thread, so the team sees the net is live. Failure is logged and ignored:
// the thread is also started when the first chat message is sent.
onRecordAfterCreateSuccess((e) => {
  e.next();
  try {
    const u = require(`${__hooks}/lib/util.js`);
    const slack = require(`${__hooks}/lib/slack.js`);
    if (e.record.getString("status") !== "open") return;
    const net = $app.findRecordById("nets", e.record.getString("net_id"));
    if (!slack.channelFor(u, net)) return;
    const r = slack.ensureThread($app, u, net, e.record);
    if (!r.ok) console.log("Slack: could not start the thread for session " + e.record.id + ": " + r.error);
  } catch (err) {
    console.log("Slack: thread start failed: " + err);
  }
}, "net_sessions");
