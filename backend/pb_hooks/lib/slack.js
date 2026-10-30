// Slack helpers for the team chat (slack.pb.js, sessions.pb.js). Load inside handlers with:
//   const slack = require(`${__hooks}/lib/slack.js`)
//
// The Slack app itself is shared by the whole server: SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET live
// in /etc/round-table-net/env. Which nets use it, and which channel each one talks in, is set per net
// (nets.slack_enabled and nets.slack_channel). Every call here is best effort: a Slack outage must
// never stop a net from opening, closing or checking people in.

// True when the server has both Slack secrets.
function configured(u) {
  return !!(u.env("SLACK_BOT_TOKEN") && u.env("SLACK_SIGNING_SECRET"));
}

// Call one Slack Web API method. Never throws: returns { ok: true, data } or { ok: false, error }
// where error is Slack's own code ("not_in_channel", "channel_not_found", ...) or one of ours
// ("not_configured", "rate_limited", "unreachable").
function call(u, method, payload, httpMethod) {
  const token = u.env("SLACK_BOT_TOKEN");
  if (!token) return { ok: false, error: "not_configured" };
  const verb = httpMethod || "POST";
  let url = u.env("SLACK_API_URL", "https://slack.com/api") + "/" + method;
  const headers = { authorization: "Bearer " + token };
  let body;
  if (verb === "GET") {
    url += "?" + Object.keys(payload).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(payload[k])).join("&");
  } else {
    headers["content-type"] = "application/json; charset=utf-8";
    body = JSON.stringify(payload);
  }
  try {
    const res = $http.send({ url: url, method: verb, headers: headers, body: body, timeout: 4 });
    if (res.statusCode === 429) return { ok: false, error: "rate_limited" };
    const j = res.json || {};
    return j.ok ? { ok: true, data: j } : { ok: false, error: j.error || ("http_" + res.statusCode) };
  } catch (_) {
    return { ok: false, error: "unreachable" };
  }
}

// A plain-words reason for an error code, for the screen.
function friendly(code) {
  switch (code) {
    case "not_configured": return "Slack is not set up on this server (the bot token and signing secret are missing).";
    case "not_in_channel": return "The Slack app is not in that channel. In Slack, open the channel and type /invite followed by the app's name.";
    case "channel_not_found": return "Slack cannot find that channel. Check the channel ID.";
    case "is_archived": return "That Slack channel is archived.";
    case "invalid_auth": case "not_authed": case "account_inactive": case "token_revoked": case "token_expired":
      return "The Slack bot token is not valid. Check SLACK_BOT_TOKEN on the server.";
    case "missing_scope": return "The Slack app is missing a permission. Add chat:write to the app and install it again.";
    case "rate_limited": return "Slack is asking us to slow down. Try again in a moment.";
    case "unreachable": return "Slack could not be reached.";
    default: return "Slack refused the message (" + code + ").";
  }
}

// Text we send to Slack: &, < and > are escaped so a typed <!channel> or <@U123> can never ping people.
function escapeForSlack(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Text that came from Slack, made readable: links keep their label, mentions become @name,
// and the three escapes are undone.
function cleanSlackText(text) {
  return String(text || "")
    .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (m, id, name) => "@" + (name || "someone"))
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/<#[A-Z0-9]+>/g, "#channel")
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, "@$1")
    .replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]*))?>/g, (m, name) => name || "@group")
    .replace(/<(?:https?:|mailto:)[^>|]+\|([^>]*)>/g, "$1")
    .replace(/<((?:https?:|mailto:)[^>|]+)>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();
}

// A person's name for a Slack user id, or the id if Slack will not say.
function userName(u, userId) {
  const r = call(u, "users.info", { user: userId }, "GET");
  if (!r.ok || !r.data.user) return userId;
  const p = r.data.user.profile || {};
  return p.display_name || p.real_name || r.data.user.real_name || r.data.user.name || userId;
}

// Is chat usable for this net right now? Returns the channel ID, or "" when not.
function channelFor(u, net) {
  if (!net || !configured(u) || !net.getBool("slack_enabled")) return "";
  return net.getString("slack_channel");
}

// Start the session's Slack thread (its first message tells the team how to reply). Safe to call
// again: if the session already has a thread, that one is returned. Returns { ok, channel, ts } or
// { ok: false, error }.
function ensureThread(app, u, net, session) {
  const fresh = app.findRecordById("net_sessions", session.id);
  if (fresh.getString("slack_thread_ts")) {
    return { ok: true, channel: fresh.getString("slack_channel"), ts: fresh.getString("slack_thread_ts") };
  }
  const channel = channelFor(u, net);
  if (!channel) return { ok: false, error: "not_configured" };
  const topic = fresh.getString("topic");
  const text = ":radio: *" + escapeForSlack(net.getString("name")) + "*: net opened by *" + escapeForSlack(fresh.getString("nco_callsign")) + "*" +
    (topic ? " (topic: " + escapeForSlack(topic) + ")" : "") +
    "\nReply in this thread to talk with the net control operator on the Round Table Net screen.";
  const r = call(u, "chat.postMessage", { channel: channel, text: text, unfurl_links: false, unfurl_media: false });
  if (!r.ok) return r;
  fresh.set("slack_thread_ts", r.data.ts);
  fresh.set("slack_channel", r.data.channel || channel);
  app.save(fresh);
  return { ok: true, channel: r.data.channel || channel, ts: r.data.ts };
}

// Say something in a session's thread. Returns the call result ({ ok, data } or { ok: false, error }).
function replyInThread(u, channel, threadTs, text) {
  return call(u, "chat.postMessage", { channel: channel, thread_ts: threadTs, text: text, unfurl_links: false, unfurl_media: false });
}

// When a session closes: one line in its thread. Best effort; nothing here can fail the close.
function notifyClosed(app, u, sessionId, checkinCount) {
  try {
    const session = app.findRecordById("net_sessions", sessionId);
    const ts = session.getString("slack_thread_ts");
    if (!ts) return;
    const net = app.findRecordById("nets", session.getString("net_id"));
    if (!channelFor(u, net)) return;
    replyInThread(u, session.getString("slack_channel"), ts,
      ":white_check_mark: Net closed: " + checkinCount + " check-in" + (checkinCount === 1 ? "" : "s") + ". Thanks, " + escapeForSlack(session.getString("nco_callsign")) + ".");
  } catch (_) {}
}

module.exports = { configured, call, friendly, escapeForSlack, cleanSlackText, userName, channelFor, ensureThread, replyInThread, notifyClosed };
