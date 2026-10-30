/// <reference path="../pb_data/types.d.ts" />
//
// Applies environment-driven configuration on every start, so server config
// lives in /etc/round-table-net/env and is never edited by hand in the dashboard.
//
// HOW THIS FILE WORKS
//   PocketBase runs every *.pb.js file in this folder at startup. onBootstrap
//   fires once, after the database is open and before the server takes requests.
//   We read environment variables (see .env.example for the full list) and copy
//   them into PocketBase's own settings (proxy header, rate limits), then save.
//   Because this runs on every start, changing the env file and restarting the
//   service is all it takes to change the config.
//
// NOTE: other hook files cannot share top-level variables with this one. Each
// handler loads shared helpers itself with require() (see lib/util.js).

onBootstrap((e) => {
  e.next(); // let PocketBase finish its own startup first, then adjust settings

  const u = require(`${__hooks}/lib/util.js`);
  const s = $app.settings();

  s.meta.appName = "Round Table Net";
  if (u.env("APP_URL")) s.meta.appURL = u.env("APP_URL").replace(/\/+$/, "");

  // Behind Nginx every request appears to come from 127.0.0.1. Nginx puts the
  // real visitor address in X-Real-IP, and this tells PocketBase to believe that
  // header. This matters for rate limiting, which is per client address.
  if (u.env("TRUST_PROXY_HEADER", "X-Real-IP")) {
    s.trustedProxy.headers = [u.env("TRUST_PROXY_HEADER", "X-Real-IP")];
    s.trustedProxy.useLeftmostIP = false;
  }

  // Rate limits, per client address per 60 seconds. The PIN sign-in is the main
  // target (a short PIN can only be guessed so fast); the public check-in is the
  // other route anyone on the internet can call.
  // PocketBase's own default limits stay on unless RATE_LIMIT_DEFAULTS=off, which
  // exists only so automated tests can run fast. We rebuild the rule list: keep
  // PocketBase's defaults, drop any old copy of our own two rules, add them fresh.
  // That keeps restarts from stacking duplicates.
  const pinLimit = parseInt(u.env("PIN_RATE_LIMIT", "10"), 10);
  const publicLimit = parseInt(u.env("PUBLIC_RATE_LIMIT", "30"), 10);
  const keep = [];
  const existing = u.env("RATE_LIMIT_DEFAULTS", "on") === "off" ? [] : (s.rateLimits.rules || []);
  for (let i = 0; i < existing.length; i++) {
    const label = existing[i].label;
    if (["/api/rt/auth/", "/api/rt/public/", "/api/rt/chat/", "/api/rt/slack/"].every((p) => label.indexOf(p) !== 0)) keep.push(existing[i]);
  }
  keep.push({ label: "/api/rt/auth/", maxRequests: pinLimit, duration: 60 });
  keep.push({ label: "/api/rt/public/", maxRequests: publicLimit, duration: 60 });
  // Team chat: operators sending messages, and Slack delivering events (all from Slack's own addresses).
  keep.push({ label: "/api/rt/chat/", maxRequests: 60, duration: 60 });
  keep.push({ label: "/api/rt/slack/", maxRequests: 600, duration: 60 });
  s.rateLimits.rules = keep;
  s.rateLimits.enabled = true;

  $app.save(s);

  // Safety net from before the roster was updated at close time: a session left "pending"
  // by an older version (closed, roster not yet updated) is finished here, once, at start.
  // Normally there is nothing to do. This must never stop the server from starting: on a
  // brand-new database the tables do not exist yet (the migrations run later), so any
  // failure just skips the sweep, and one failing session is logged and skipped.
  try {
    const roster = require(`${__hooks}/lib/roster.js`);
    const pending = u.find($app, "net_sessions", "status = 'pending'", "closed_at");
    for (let i = 0; i < pending.length; i++) {
      try {
        $app.runInTransaction((tx) => { roster.processSession(tx, tx.findRecordById("net_sessions", pending[i].id)); });
        console.log("Finished roster update for pending session " + pending[i].id);
      } catch (err) {
        console.log("Could not finish pending session " + pending[i].id + ": " + err);
      }
    }
  } catch (_) {
    // no net_sessions table yet: nothing to finish
  }
});
