// End-to-end checks against a running PocketBase with the hooks and migrations loaded.
//
//   PB_URL=http://127.0.0.1:8090 PB_SU_EMAIL=... PB_SU_PASS=... MOCK_URL=http://127.0.0.1:9100 \
//   NCO_PIN=test-pin-1234 node --test backend/test/api.test.mjs
//
// The server under test must be started with the mock service URLs (see README in this folder).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const PB = process.env.PB_URL || "http://127.0.0.1:8090";
const MOCK = process.env.MOCK_URL || "http://127.0.0.1:9100";
const PIN = process.env.NCO_PIN || "test-pin-1234";
const run = Date.now().toString(36).toUpperCase();

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(PB + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const mockCalls = async () => (await fetch(MOCK + "/_calls")).json();
const mockReset = () => fetch(MOCK + "/_reset");
const S = {}; // shared state

// Helpers that act as the net control operator (club account) or as the superuser.
const nco = (path, o = {}) => api(path, { ...o, token: S.nco });
const su = (path, o = {}) => api(path, { ...o, token: S.su });
const list = async (col, filter, token = S.su) => {
  const r = await api(`/api/collections/${col}/records?perPage=200&filter=${encodeURIComponent(filter)}`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.items;
};

async function makeNet(name, fields = {}) {
  const r = await nco("/api/collections/nets/records", {
    method: "POST",
    body: { name: `${name} ${run}`, day_of_week: "Sunday", time: "5:00 PM", frequency: "462.600", preamble: "<p>Secret script</p>", closing: "<p>Bye</p>", ...fields },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}
async function makeStation(net, callsign, fields = {}) {
  const r = await nco("/api/collections/stations/records", {
    method: "POST",
    body: { callsign, name: `Op ${callsign}`, city: "Tucson", state: "AZ", net_id: net.id, active: true, consecutive_absences: 0, ...fields },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}
async function openSession(net, extra = {}) {
  const r = await nco("/api/collections/net_sessions/records", {
    method: "POST",
    body: { net_id: net.id, net_name: net.name, date: "2026-10-18", status: "open", nco_callsign: "W1NCO", topic: "Test topic", opened_at: new Date().toISOString(), ...extra },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}
async function addCheckIn(session, net, callsign, status, fields = {}) {
  const r = await nco("/api/collections/check_ins/records", {
    method: "POST", body: { session_id: session.id, net_id: net.id, callsign, status, ...fields },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

before(async () => {
  const s = await api("/api/collections/_superusers/auth-with-password", {
    method: "POST", body: { identity: process.env.PB_SU_EMAIL || "admin@test.local", password: process.env.PB_SU_PASS || "testpass1234" },
  });
  assert.equal(s.status, 200, "superuser login failed");
  S.su = s.json.token;

  const p = await api("/api/rt/auth/pin", { method: "POST", body: { pin: PIN } });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  S.nco = p.json.token;
});

// ------------------------------------------------------------------ sign-in

test("PIN sign-in: wrong and empty PINs are refused, no password sign-in exists", async () => {
  assert.equal((await api("/api/rt/auth/pin", { method: "POST", body: { pin: "nope" } })).status, 401);
  assert.equal((await api("/api/rt/auth/pin", { method: "POST", body: {} })).status, 401);
  const pw = await api("/api/collections/users/auth-with-password", {
    method: "POST", body: { identity: "nco@round-table-net.local", password: "anything" },
  });
  assert.equal(pw.status, 403);
});

test("PIN sign-in: correct PIN returns a usable token for the nco account", async () => {
  const r = await api("/api/rt/auth/pin", { method: "POST", body: { pin: PIN } });
  assert.equal(r.status, 200);
  assert.equal(r.json.record.role, "nco");
  assert.ok(r.json.token);
  const me = await api("/api/collections/users/records/" + r.json.record.id, { token: r.json.token });
  assert.equal(me.status, 200);
});

// ------------------------------------------------------------- access rules

test("signed-out visitors can read and write no collection", async () => {
  const net = await makeNet("Rules Net");
  for (const col of ["nets", "stations", "net_sessions", "check_ins", "announcements", "settings"]) {
    const l = await api(`/api/collections/${col}/records`);
    assert.ok(l.status >= 400 || l.json.items.length === 0, `${col} list leaked`);
  }
  const v = await api(`/api/collections/nets/records/${net.id}`);
  assert.ok(v.status >= 400);
  const c = await api("/api/collections/nets/records", { method: "POST", body: { name: "x", day_of_week: "Sunday", time: "1" } });
  assert.ok(c.status >= 400);
  const d = await api(`/api/collections/nets/records/${net.id}`, { method: "DELETE" });
  assert.ok(d.status >= 400);
  const u = await api("/api/collections/users/records");
  assert.ok(u.status >= 400 || u.json.items.length === 0);
});

test("operator routes need a sign-in", async () => {
  for (const path of ["/api/rt/session/close", "/api/rt/session/publish"]) {
    const r = await api(path, { method: "POST", body: { session_id: "x" } });
    assert.equal(r.status, 401, path);
  }
});

test("callsigns are trimmed and upper-cased on every save", async () => {
  const net = await makeNet("Normalize Net");
  const st = await makeStation(net, "  w1abc/2 ");
  assert.equal(st.callsign, "W1ABC/2");
  const dup = await nco("/api/collections/stations/records", {
    method: "POST", body: { callsign: "W1ABC/2", name: "Again", net_id: net.id, active: true },
  });
  assert.ok(dup.status >= 400, "same callsign on the same net must be refused");
});

test("deleting a session deletes its check-ins; deleting a station keeps them", async () => {
  const net = await makeNet("Cascade Net");
  const st = await makeStation(net, "K1CAS");
  const ses = await openSession(net);
  const ci = await addCheckIn(ses, net, "K1CAS", "checked_in", { station_id: st.id });
  assert.equal((await nco(`/api/collections/stations/records/${st.id}`, { method: "DELETE" })).status, 204);
  const kept = await nco(`/api/collections/check_ins/records/${ci.id}`);
  assert.equal(kept.status, 200);
  assert.equal(kept.json.station_id, "");
  assert.equal((await nco(`/api/collections/net_sessions/records/${ses.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await nco(`/api/collections/check_ins/records/${ci.id}`)).status, 404);
});

// ------------------------------------------------------------ duplicate rule

test("operators cannot add a second check-in for a callsign; the superuser (importer) can", async () => {
  const net = await makeNet("Dup Net");
  const ses = await openSession(net);
  await addCheckIn(ses, net, "K1DUP", "checked_in");
  const again = await nco("/api/collections/check_ins/records", {
    method: "POST", body: { session_id: ses.id, net_id: net.id, callsign: "k1dup ", status: "early" },
  });
  assert.equal(again.status, 409);
  const forced = await su("/api/collections/check_ins/records", {
    method: "POST", body: { session_id: ses.id, net_id: net.id, callsign: "K1DUP", status: "early" },
  });
  assert.equal(forced.status, 200);
});

// ------------------------------------------------------------ public routes

test("public: net list shows only safe fields and whether a net is live", async () => {
  const net = await makeNet("Public Net");
  const r = await api("/api/rt/public/nets");
  assert.equal(r.status, 200);
  const mine = r.json.find((n) => n.id === net.id);
  assert.ok(mine);
  assert.equal(mine.is_live, false);
  assert.deepEqual(Object.keys(mine).sort(), ["day_of_week", "frequency", "id", "is_live", "name", "time"]);
  assert.ok(!JSON.stringify(r.json).includes("Secret script"));
  await openSession(net);
  const live = (await api("/api/rt/public/nets")).json.find((n) => n.id === net.id);
  assert.equal(live.is_live, true);
});

test("public: check-in with no open session says so", async () => {
  const net = await makeNet("Closed Net");
  const r = await api("/api/rt/public/checkin", { method: "POST", body: { net_id: net.id, callsign: "W1AW" } });
  assert.equal(r.status, 404);
  assert.equal(r.json.result, "no_session");
  const s = await api(`/api/rt/public/session?net=${net.id}`);
  assert.equal(s.status, 200);
  assert.equal(s.json.session, null);
});

test("public: unknown net, bad callsigns and oversized input", async () => {
  const net = await makeNet("Validate Net");
  await openSession(net);
  assert.equal((await api("/api/rt/public/checkin", { method: "POST", body: { net_id: "nonexistent", callsign: "W1AW" } })).status, 404);
  assert.equal((await api(`/api/rt/public/session?net=nonexistent`)).status, 404);
  for (const bad of ["", "ab", "has space", "<script>", "WAYTOOLONGCALLSIGN1"]) {
    const r = await api("/api/rt/public/checkin", { method: "POST", body: { net_id: net.id, callsign: bad } });
    assert.equal(r.status, 400, `callsign ${JSON.stringify(bad)}`);
  }
  const big = await api("/api/rt/public/checkin", {
    method: "POST", body: { net_id: net.id, callsign: "W1BIG", name: "n".repeat(5000), location: "l".repeat(5000), comment: "c".repeat(5000) },
  });
  assert.equal(big.status, 200);
  const row = (await list("check_ins", `callsign = "W1BIG"`))[0];
  assert.equal(row.name.length, 200);
  assert.equal(row.comment.length, 300);
});

test("public: check-in works, repeats are refused, and the list shows no names or comments", async () => {
  const net = await makeNet("Checkin Net");
  const ses = await openSession(net);
  const ok = await api("/api/rt/public/checkin", {
    method: "POST", body: { net_id: net.id, callsign: " w1pub ", name: "Pat", location: "Marana, AZ", comment: "hello" },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.callsign, "W1PUB");
  const again = await api("/api/rt/public/checkin", { method: "POST", body: { net_id: net.id, callsign: "W1PUB" } });
  assert.equal(again.status, 409);
  assert.equal(again.json.result, "already");

  const rows = await list("check_ins", `session_id = "${ses.id}"`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "checked_in");
  assert.equal(rows[0].name, "Pat");

  const pub = await api(`/api/rt/public/session?net=${net.id}`);
  assert.equal(pub.json.session.id, ses.id);
  assert.deepEqual(pub.json.check_ins, [{ callsign: "W1PUB", status: "checked_in" }]);
  assert.ok(!JSON.stringify(pub.json).includes("Pat"));
});

test("public: a roster station is linked, and an inactive one is brought back", async () => {
  const net = await makeNet("Roster Net");
  const st = await makeStation(net, "K1ROS", { active: false, consecutive_absences: 3 });
  await openSession(net);
  const r = await api("/api/rt/public/checkin", { method: "POST", body: { net_id: net.id, callsign: "K1ROS" } });
  assert.equal(r.status, 200);
  const row = (await list("check_ins", `callsign = "K1ROS"`))[0];
  assert.equal(row.station_id, st.id);
  const after = (await nco(`/api/collections/stations/records/${st.id}`)).json;
  assert.equal(after.active, true);
  assert.equal(after.consecutive_absences, 0);
});

test("public: simultaneous check-ins for one callsign leave exactly one row", async () => {
  const net = await makeNet("Race Net");
  const ses = await openSession(net);
  const results = await Promise.all(
    Array.from({ length: 8 }, () => api("/api/rt/public/checkin", { method: "POST", body: { net_id: net.id, callsign: "W1RACE" } })),
  );
  const rows = await list("check_ins", `session_id = "${ses.id}" && callsign = "W1RACE"`);
  assert.equal(rows.length, 1, `statuses: ${results.map((r) => r.status)}`);
  assert.ok(results.filter((r) => r.status === 200).length >= 1);
});

// ------------------------------------------------------------- close session

test("close: not_heard rows go, guests join the roster for review, count is recorded", async () => {
  const net = await makeNet("Close Net");
  await makeStation(net, "K1ROST");
  const ses = await openSession(net);
  await addCheckIn(ses, net, "K1ROST", "checked_in");
  await addCheckIn(ses, net, "K1GONE", "not_heard");
  await addCheckIn(ses, net, "K1NEW", "guest", { name: "Gus", location: "Oro Valley, AZ" });
  await addCheckIn(ses, net, "K1ROST2", "guest"); // guest who is not on the roster either
  await makeStation(net, "K1KNOWN");
  await addCheckIn(ses, net, "K1KNOWN", "guest"); // guest already on the roster: not duplicated

  const r = await nco("/api/rt/session/close", { method: "POST", body: { session_id: ses.id } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "closed");
  assert.equal(r.json.checkin_count, 4);
  assert.equal(r.json.guests_added, 2);

  const after = (await nco(`/api/collections/net_sessions/records/${ses.id}`)).json;
  assert.equal(after.status, "closed");
  assert.equal(after.roster_updated, true);
  assert.ok(after.closed_at);
  assert.equal(after.checkin_count, 4);
  assert.equal((await list("check_ins", `session_id = "${ses.id}" && status = "not_heard"`)).length, 0);

  const gus = (await list("stations", `net_id = "${net.id}" && callsign = "K1NEW"`))[0];
  assert.equal(gus.name, "Gus");
  assert.equal(gus.city, "Oro Valley, AZ");
  assert.equal(gus.needs_review, true);
  assert.equal(gus.active, true);
  assert.equal((await list("stations", `net_id = "${net.id}" && callsign = "K1KNOWN"`)).length, 1);

  const twice = await nco("/api/rt/session/close", { method: "POST", body: { session_id: ses.id } });
  assert.equal(twice.status, 409);
});

test("close with technical difficulty goes straight to closed and counts no absences", async () => {
  const net = await makeNet("Tech Net");
  const st = await makeStation(net, "K1TECH");
  const ses = await openSession(net);
  const r = await nco("/api/rt/session/close", { method: "POST", body: { session_id: ses.id, technical_difficulty: true } });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "closed");
  const after = (await nco(`/api/collections/net_sessions/records/${ses.id}`)).json;
  assert.equal(after.technical_difficulty, true);
  assert.equal(after.roster_updated, true);
  assert.equal((await nco(`/api/collections/stations/records/${st.id}`)).json.consecutive_absences, 0);
});

test("close: unknown session is 404", async () => {
  assert.equal((await nco("/api/rt/session/close", { method: "POST", body: { session_id: "nonexistent" } })).status, 404);
});

// ------------------------------------------------------------ roster update
// The roster is updated by the close route itself, in the same transaction.

async function closedNet(label) {
  const net = await makeNet(label);
  const here = await makeStation(net, "K1HERE", { consecutive_absences: 2 });
  const gone = await makeStation(net, "K1GONE");
  const last = await makeStation(net, "K1LAST", { consecutive_absences: 2 });
  const perm = await makeStation(net, "K1PERM", { consecutive_absences: 2, permanent_attendance: true });
  const review = await makeStation(net, "K1REVW", { needs_review: true });
  const off = await makeStation(net, "K1OFF", { active: false, consecutive_absences: 3 });
  const short = await makeStation(net, "K1SHORT", { consecutive_absences: 1 });
  const early = await makeStation(net, "K1EARLY", { consecutive_absences: 1 });
  const guest = await makeStation(net, "K1GUEST", { consecutive_absences: 1 });
  const ses = await openSession(net);
  await addCheckIn(ses, net, "K1HERE", "checked_in", { station_id: here.id });
  await addCheckIn(ses, net, "K1SHORT", "short_time");
  await addCheckIn(ses, net, "K1EARLY", "early");
  await addCheckIn(ses, net, "K1GUEST", "guest"); // a guest check-in is not attendance for the roster
  const close = await nco("/api/rt/session/close", { method: "POST", body: { session_id: ses.id } });
  return { net, ses, close, st: { here, gone, last, perm, review, off, short, early, guest } };
}
const station = async (id) => (await nco(`/api/collections/stations/records/${id}`)).json;

test("close updates the roster: absences, the 3-strike rule, permanent and review exemptions", async () => {
  const { ses, st, close } = await closedNet("Process Net");
  assert.equal(close.status, 200, JSON.stringify(close.json));
  assert.equal(close.json.status, "closed");
  assert.equal(close.json.checkin_count, 4);
  assert.ok(close.json.stations_updated > 0);

  assert.equal((await station(st.here.id)).consecutive_absences, 0);
  const gone = await station(st.gone.id);
  assert.equal(gone.consecutive_absences, 1);
  assert.equal(gone.active, true);
  const last = await station(st.last.id);
  assert.equal(last.consecutive_absences, 3);
  assert.equal(last.active, false);
  assert.equal((await station(st.perm.id)).consecutive_absences, 2);
  assert.equal((await station(st.perm.id)).active, true);
  assert.equal((await station(st.review.id)).consecutive_absences, 0);
  const off = await station(st.off.id);
  assert.equal(off.consecutive_absences, 3);
  assert.equal(off.active, false);
  assert.equal((await station(st.short.id)).consecutive_absences, 0);
  assert.equal((await station(st.early.id)).consecutive_absences, 0);
  assert.equal((await station(st.guest.id)).consecutive_absences, 2);

  const done = (await nco(`/api/collections/net_sessions/records/${ses.id}`)).json;
  assert.equal(done.status, "closed");
  assert.equal(done.roster_updated, true);

  const again = await nco("/api/rt/session/close", { method: "POST", body: { session_id: ses.id } });
  assert.equal(again.status, 409, "a closed session is not closed (or counted) twice");
});

test("close: a guest added at close is left alone by the absence count", async () => {
  const net = await makeNet("Guest Net");
  const ses = await openSession(net);
  await addCheckIn(ses, net, "K1VISIT", "guest", { name: "Visitor" });
  const r = await nco("/api/rt/session/close", { method: "POST", body: { session_id: ses.id } });
  assert.equal(r.json.guests_added, 1);
  const visitor = (await list("stations", `net_id = "${net.id}" && callsign = "K1VISIT"`))[0];
  assert.equal(visitor.needs_review, true);
  assert.equal(visitor.consecutive_absences, 0);
  assert.equal(visitor.active, true);
});

test("close: overlapping closes count a session only once", async () => {
  const net = await makeNet("Overlap Net");
  const gone = await makeStation(net, "K1GONE");
  const ses = await openSession(net);
  const results = await Promise.all([1, 2, 3].map(() =>
    nco("/api/rt/session/close", { method: "POST", body: { session_id: ses.id } })));
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal((await station(gone.id)).consecutive_absences, 1);
});

// ------------------------------------------------- absence limit, set per net

// Opens a session with nobody checked in except `attendees`, closes it, and returns the stations.
async function closeWith(net, stations, attendees = []) {
  const ses = await openSession(net);
  for (const cs of attendees) await addCheckIn(ses, net, cs, "checked_in");
  const close = await nco("/api/rt/session/close", { method: "POST", body: { session_id: ses.id } });
  assert.equal(close.status, 200, JSON.stringify(close.json));
  const out = {};
  for (const [k, st] of Object.entries(stations)) out[k] = await station(st.id);
  return { close: close.json, st: out };
}

test("a net made without a limit gets 3; a chosen limit is kept; out-of-range is refused", async () => {
  assert.equal((await makeNet("Default Limit Net")).max_absences, 3);
  assert.equal((await makeNet("Five Limit Net", { max_absences: 5 })).max_absences, 5);
  assert.equal((await makeNet("Zero Limit Net", { max_absences: 0 })).max_absences, 0, "0 is a real choice, not 'unset'");
  for (const bad of [-1, 53, 2.5]) {
    const r = await nco("/api/collections/nets/records", {
      method: "POST", body: { name: `Bad Limit ${run}`, day_of_week: "Sunday", time: "5:00 PM", max_absences: bad },
    });
    assert.equal(r.status, 400, `max_absences ${bad} should be refused`);
  }
});

test("absence limit 2: a second miss makes a station inactive", async () => {
  const net = await makeNet("Limit Two Net", { max_absences: 2 });
  const one = await makeStation(net, "K1ONE", { consecutive_absences: 1 });
  const zero = await makeStation(net, "K1ZERO");
  const { st } = await closeWith(net, { one, zero });
  assert.equal(st.one.consecutive_absences, 2);
  assert.equal(st.one.active, false);
  assert.equal(st.zero.consecutive_absences, 1);
  assert.equal(st.zero.active, true);
});

test("absence limit 5: a station with 3 misses is still active after a 4th", async () => {
  const net = await makeNet("Limit Five Net", { max_absences: 5 });
  const three = await makeStation(net, "K1THREE", { consecutive_absences: 3 });
  const { st } = await closeWith(net, { three });
  assert.equal(st.three.consecutive_absences, 4);
  assert.equal(st.three.active, true);
});

test("absence limit 0: nobody is dropped, absences are not counted, stations are left alone", async () => {
  const net = await makeNet("Limit Zero Net", { max_absences: 0 });
  const gone = await makeStation(net, "K1GONE", { consecutive_absences: 2 });
  const here = await makeStation(net, "K1HERE", { consecutive_absences: 2 });
  const fresh = await makeStation(net, "K1FRESH");
  for (let i = 0; i < 5; i++) {
    const { close, st } = await closeWith(net, { gone, here, fresh }, ["K1HERE"]);
    assert.equal(close.status, "closed");
    assert.equal(close.stations_updated, 0);
    assert.equal(st.gone.active, true);
    assert.equal(st.gone.consecutive_absences, 2);
    assert.equal(st.here.consecutive_absences, 2);
    assert.equal(st.fresh.consecutive_absences, 0);
    assert.equal(st.fresh.active, true);
  }
  const done = (await list("net_sessions", `net_id = "${net.id}"`));
  assert.equal(done.length, 5);
  assert.ok(done.every((x) => x.status === "closed" && x.roster_updated === true));
});

test("changing a net's limit applies from the next session", async () => {
  const net = await makeNet("Limit Change Net", { max_absences: 0 });
  const st0 = await makeStation(net, "K1CHG", { consecutive_absences: 1 });
  assert.equal((await closeWith(net, { st0 })).st.st0.active, true);
  const up = await nco(`/api/collections/nets/records/${net.id}`, { method: "PATCH", body: { max_absences: 2 } });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  const after = await closeWith(net, { st0 });
  assert.equal(after.st.st0.consecutive_absences, 2);
  assert.equal(after.st.st0.active, false);
});

test("the manual process route and the 15-minute job are gone", async () => {
  // Sessions an older version left pending are finished at server start (bootstrap.pb.js);
  // that needs a restart, so it is checked by hand, not here.
  const r = await nco("/api/rt/session/process", { method: "POST", body: {} });
  assert.equal(r.status, 404, "the manual process route is gone");
  const cron = await su("/api/crons/processPendingSessions", { method: "POST" });
  assert.equal(cron.status, 404, "the 15-minute job is gone");
});

// ------------------------------------------------------------ Slack team chat

const SLACK_SECRET = process.env.SLACK_SIGNING_SECRET || "test-signing-secret";
const CHAN = "CTESTCHAN1";

// A request the way Slack sends it: the exact body, signed with the signing secret.
async function slackEvent(payload, { secret = SLACK_SECRET, ts = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(payload);
  const sig = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
  const res = await fetch(PB + "/api/rt/slack/events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-slack-request-timestamp": String(ts), "x-slack-signature": sig },
    body: raw,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const slackCalls = async (method) => (await mockCalls()).filter((c) => c.path === `/slack/${method}`);
const chatNet = (label, fields = {}) => makeNet(label, { slack_enabled: true, slack_channel: CHAN, ...fields });
const messages = (sessionId) => list("chat_messages", `session_id = "${sessionId}"`);
const reply = (thread_ts, ts, text, extra = {}) => ({
  type: "event_callback",
  event: { type: "message", channel: CHAN, user: "U111", text, ts, thread_ts, ...extra },
});

test("slack: status and the test message need a sign-in; the test reports Slack's errors in plain words", async () => {
  assert.equal((await api("/api/rt/slack/status")).status, 401);
  assert.equal((await api("/api/rt/slack/test", { method: "POST", body: { channel: CHAN } })).status, 401);
  assert.deepEqual((await nco("/api/rt/slack/status")).json, { configured: true });

  await mockReset();
  const ok = await nco("/api/rt/slack/test", { method: "POST", body: { channel: CHAN } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const posted = (await slackCalls("chat.postMessage"))[0];
  assert.equal(posted.body.channel, CHAN);
  assert.equal(posted.headers.authorization, "Bearer xoxb-test");

  const notIn = await nco("/api/rt/slack/test", { method: "POST", body: { channel: "CNOTIN0000" } });
  assert.equal(notIn.status, 400);
  assert.match(notIn.json.message, /\/invite/);
  assert.match((await nco("/api/rt/slack/test", { method: "POST", body: { channel: "CMISSING00" } })).json.message, /channel ID/);
  const named = await nco("/api/rt/slack/test", { method: "POST", body: { channel: "#general" } });
  assert.equal(named.status, 400);
  assert.match(named.json.message, /channel ID/);
});

test("slack: a net starts with chat off and opening its session posts nothing", async () => {
  const net = await makeNet("Chat Off Net");
  assert.equal(net.slack_enabled, false);
  assert.equal(net.slack_channel, "");
  await mockReset();
  const ses = await openSession(net);
  assert.equal((await slackCalls("chat.postMessage")).length, 0);
  const sent = await nco("/api/rt/chat/send", { method: "POST", body: { session_id: ses.id, text: "hello" } });
  assert.equal(sent.status, 409);
  assert.match(sent.json.message, /not turned on/);
});

test("slack: opening a session on a chat net starts its thread, once", async () => {
  const net = await chatNet("Chat Thread Net");
  await mockReset();
  const ses = await openSession(net, { topic: "Antenna <b>tips</b>" });
  const posts = await slackCalls("chat.postMessage");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.channel, CHAN);
  assert.equal(posts[0].body.thread_ts, undefined, "the first message starts the thread");
  assert.match(posts[0].body.text, /Chat Thread Net/);
  assert.match(posts[0].body.text, /W1NCO/);
  assert.match(posts[0].body.text, /Antenna &lt;b&gt;tips&lt;\/b&gt;/, "the topic is escaped");

  const after = (await nco(`/api/collections/net_sessions/records/${ses.id}`)).json;
  assert.ok(after.slack_thread_ts);
  assert.equal(after.slack_channel, CHAN);

  await nco("/api/rt/chat/send", { method: "POST", body: { session_id: ses.id, text: "one" } });
  await nco("/api/rt/chat/send", { method: "POST", body: { session_id: ses.id, text: "two" } });
  const all = await slackCalls("chat.postMessage");
  assert.equal(all.length, 3, "one thread start and two replies, no second thread");
  assert.equal(all[1].body.thread_ts, after.slack_thread_ts);
});

test("slack: sending posts into the thread as the NCO, escapes mentions, and stores the message", async () => {
  const net = await chatNet("Chat Send Net");
  const ses = await openSession(net);
  const thread = (await nco(`/api/collections/net_sessions/records/${ses.id}`)).json.slack_thread_ts;
  await mockReset();

  const r = await nco("/api/rt/chat/send", { method: "POST", body: { session_id: ses.id, text: "  Hi <!channel> & <@U123>  " } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const posted = (await slackCalls("chat.postMessage"))[0].body;
  assert.equal(posted.channel, CHAN);
  assert.equal(posted.thread_ts, thread);
  assert.equal(posted.text, "*W1NCO (NCO):* Hi &lt;!channel&gt; &amp; &lt;@U123&gt;", "typed mentions cannot ping anyone");

  const [m] = await messages(ses.id);
  assert.equal(m.source, "nco");
  assert.equal(m.author, "W1NCO (NCO)");
  assert.equal(m.text, "Hi <!channel> & <@U123>", "stored as typed, trimmed");
  assert.ok(m.slack_ts);

  assert.equal((await nco("/api/rt/chat/send", { method: "POST", body: { session_id: ses.id, text: "   " } })).status, 400);
  assert.equal((await api("/api/rt/chat/send", { method: "POST", body: { session_id: ses.id, text: "x" } })).status, 401);
  assert.equal((await nco("/api/rt/chat/send", { method: "POST", body: { session_id: "nonexistent", text: "x" } })).status, 404);
});

test("slack: Slack's refusal reaches the operator as a plain message and nothing is stored", async () => {
  const net = await chatNet("Chat Fail Net", { slack_channel: "CNOTIN0000" });
  const ses = await openSession(net); // the thread cannot start; that is logged, the session still opens
  assert.equal((await nco(`/api/collections/net_sessions/records/${ses.id}`)).json.slack_thread_ts, "");
  const r = await nco("/api/rt/chat/send", { method: "POST", body: { session_id: ses.id, text: "hello" } });
  assert.equal(r.status, 502);
  assert.match(r.json.message, /not in that channel/);
  assert.equal((await messages(ses.id)).length, 0);
});

test("slack: events are refused without Slack's signature, or when the request is old", async () => {
  const body = { type: "url_verification", challenge: "abc123" };
  assert.equal((await slackEvent(body, { secret: "wrong-secret" })).status, 401);
  assert.equal((await slackEvent(body, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 400);
  const ok = await slackEvent(body);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.challenge, "abc123");
  const unsigned = await fetch(PB + "/api/rt/slack/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(unsigned.status, 400);
});

test("slack: a reply in the session's thread is stored with the sender's name and readable text", async () => {
  const net = await chatNet("Chat Inbound Net");
  const ses = await openSession(net);
  const thread = (await nco(`/api/collections/net_sessions/records/${ses.id}`)).json.slack_thread_ts;
  const text = "See <https://example.org/x|the page> and <https://example.org/y> with <@U9|bob> in <#C1|ops> &amp; &lt;ok&gt;";
  const r = await slackEvent(reply(thread, "1800000001.000100", text));
  assert.equal(r.status, 200);
  const [m] = await messages(ses.id);
  assert.equal(m.source, "slack");
  assert.equal(m.author, "Todd");
  assert.equal(m.text, "See the page and https://example.org/y with @bob in #ops & <ok>");
  assert.equal(m.slack_ts, "1800000001.000100");

  // Slack sends the same event again when it thinks we were slow: stored once.
  await slackEvent(reply(thread, "1800000001.000100", text), { ts: Math.floor(Date.now() / 1000) });
  assert.equal((await messages(ses.id)).length, 1);
});

test("slack: events that are not a person's reply in a session thread are ignored", async () => {
  const net = await chatNet("Chat Ignore Net");
  const ses = await openSession(net);
  const thread = (await nco(`/api/collections/net_sessions/records/${ses.id}`)).json.slack_thread_ts;
  const ignored = [
    reply(thread, "1800000010.000100", "from a bot", { bot_id: "B1" }),
    reply(thread, "1800000011.000100", "an edit", { subtype: "message_changed" }),
    reply("1799999999.000100", "1800000012.000100", "some other thread"),
    reply(undefined, "1800000013.000100", "top level chatter"),
    reply(thread, thread, "the parent itself"),
    reply(thread, "1800000014.000100", "wrong channel", { channel: "COTHERCHAN" }),
    { type: "event_callback", event: { type: "reaction_added", user: "U1" } },
  ];
  for (const p of ignored) assert.equal((await slackEvent(p)).status, 200);
  assert.equal((await messages(ses.id)).length, 0);

  // Turn chat off for the net: even a genuine reply is dropped.
  await nco(`/api/collections/nets/records/${net.id}`, { method: "PATCH", body: { slack_enabled: false } });
  await slackEvent(reply(thread, "1800000015.000100", "after it was turned off"));
  assert.equal((await messages(ses.id)).length, 0);
});

test("slack: closing the net tells the thread; chat is then closed and its messages go with the session", async () => {
  const net = await chatNet("Chat Close Net");
  const ses = await openSession(net);
  const thread = (await nco(`/api/collections/net_sessions/records/${ses.id}`)).json.slack_thread_ts;
  await addCheckIn(ses, net, "K1AAA", "checked_in");
  await addCheckIn(ses, net, "K1BBB", "early");
  await nco("/api/rt/chat/send", { method: "POST", body: { session_id: ses.id, text: "welcome" } });
  await mockReset();

  const close = await nco("/api/rt/session/close", { method: "POST", body: { session_id: ses.id } });
  assert.equal(close.status, 200, JSON.stringify(close.json));
  const posted = (await slackCalls("chat.postMessage"))[0].body;
  assert.equal(posted.thread_ts, thread);
  assert.match(posted.text, /Net closed: 2 check-ins/);

  const late = await nco("/api/rt/chat/send", { method: "POST", body: { session_id: ses.id, text: "too late" } });
  assert.equal(late.status, 409);

  assert.equal((await messages(ses.id)).length, 1);
  assert.equal((await nco(`/api/collections/net_sessions/records/${ses.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await messages(ses.id)).length, 0, "messages are deleted with their session");
});

test("slack: operators can read chat messages but only the server writes them", async () => {
  const net = await chatNet("Chat Rules Net");
  const ses = await openSession(net);
  await nco("/api/rt/chat/send", { method: "POST", body: { session_id: ses.id, text: "hello" } });
  const read = await nco(`/api/collections/chat_messages/records?filter=${encodeURIComponent(`session_id = "${ses.id}"`)}`);
  assert.equal(read.status, 200);
  assert.equal(read.json.items.length, 1);
  assert.equal((await api(`/api/collections/chat_messages/records`)).status === 200 && (await api(`/api/collections/chat_messages/records`)).json.items.length, 0, "signed-out visitors see nothing");
  const make = await nco("/api/collections/chat_messages/records", { method: "POST", body: { session_id: ses.id, source: "nco", text: "forged" } });
  assert.ok(make.status === 403 || make.status === 400, "creating through the API is refused, got " + make.status);
  const msg = read.json.items[0];
  assert.ok([403, 404].includes((await nco(`/api/collections/chat_messages/records/${msg.id}`, { method: "DELETE" })).status));
  assert.ok([403, 404].includes((await nco(`/api/collections/chat_messages/records/${msg.id}`, { method: "PATCH", body: { text: "edited" } })).status));
});

// ------------------------------------------------------------------ publish

test("publish: without WordPress settings it refuses and sends nothing", async () => {
  const net = await makeNet("Nopub Net");
  const ses = await openSession(net);
  await mockReset();
  const r = await nco("/api/rt/session/publish", { method: "POST", body: { session_id: ses.id } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /not configured/i);
  assert.equal((await mockCalls()).length, 0);
});

test("publish: builds an escaped report and posts it with the right login and category", async () => {
  const settings = (await su("/api/collections/settings/records")).json.items[0];
  const upd = await su(`/api/collections/settings/records/${settings.id}`, {
    method: "PATCH", body: { wordpress_url: MOCK + "/wp/", wordpress_username: "wpuser", club_name: "Test Club" },
  });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));

  const net = await makeNet("Pub Net");
  await makeStation(net, "K1PUB", { name: "Roster Name" });
  const ses = await openSession(net, { topic: "Antennas <b>& more</b>", notes: "Line one" });
  await addCheckIn(ses, net, "K1PUB", "checked_in", { comment: "<script>alert(1)</script>" });
  await addCheckIn(ses, net, "K1ZED", "guest", { name: "Zed", location: "Phoenix, AZ" });
  await nco("/api/rt/session/close", { method: "POST", body: { session_id: ses.id } });

  await mockReset();
  const r = await nco("/api/rt/session/publish", { method: "POST", body: { session_id: ses.id } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.success, true);
  assert.equal(r.json.post_url, "https://wp.test/post-55");

  const calls = await mockCalls();
  const ai = calls.find((c) => c.path === "/anthropic");
  assert.ok(ai, "AI summary requested");
  assert.equal(ai.headers["x-api-key"], "a");
  assert.match(ai.body.messages[0].content, /Total check-ins: 2/);

  const cat = calls.find((c) => c.path === "/wp/wp-json/wp/v2/categories");
  assert.match(cat.query, /slug=regional-gmrs-net/);
  const post = calls.find((c) => c.path === "/wp/wp-json/wp/v2/posts");
  assert.equal(post.headers.authorization, "Basic " + Buffer.from("wpuser:wp").toString("base64"));
  assert.deepEqual(post.body.categories, [7]);
  assert.equal(post.body.status, "publish");
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Phoenix", year: "numeric", month: "long", day: "numeric" });
  assert.equal(post.body.title, `Pub Net ${run} - Net Report - ${today}`);
  const html = post.body.content;
  assert.match(html, /A friendly net with a good turnout/);
  assert.match(html, /Test Club net control system/);
  assert.ok(!html.includes("<script>"), "comments are escaped");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Antennas &lt;b&gt;&amp; more&lt;\/b&gt;/);
  assert.match(html, /Roster Name/); // name filled in from the roster
  assert.match(html, /Phoenix, AZ/);
  assert.match(html, /Check-Ins \(2\)/);
});

test("publish: a WordPress failure is reported, not hidden", async () => {
  const settings = (await su("/api/collections/settings/records")).json.items[0];
  await su(`/api/collections/settings/records/${settings.id}`, { method: "PATCH", body: { wordpress_url: MOCK + "/nowhere" } });
  const net = await makeNet("Failpub Net");
  const ses = await openSession(net);
  const r = await nco("/api/rt/session/publish", { method: "POST", body: { session_id: ses.id } });
  assert.equal(r.status, 502);
  assert.match(r.json.error, /WordPress API error \(404\)/);
  assert.equal((await nco("/api/rt/session/publish", { method: "POST", body: { session_id: "nonexistent" } })).status, 404);
  assert.equal((await nco("/api/rt/session/publish", { method: "POST", body: {} })).status, 400);
});

test("settings: the map tile fields exist, start empty, save, and only the club account can read them", async () => {
  const rec = (await nco("/api/collections/settings/records")).json.items[0];
  for (const f of ["map_tile_url", "map_attribution", "map_api_key"]) assert.equal(rec[f], "", `${f} starts empty`);
  const upd = await nco(`/api/collections/settings/records/${rec.id}`, {
    method: "PATCH", body: { map_tile_url: "https://t.example.org/{z}/{x}/{y}.png?key={key}", map_api_key: "k-123", map_attribution: "(c) Example" },
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.map_api_key, "k-123");
  // A list rule that fails answers 200 with nothing in it, not an error.
  assert.deepEqual((await api("/api/collections/settings/records")).json.items, [], "signed out sees no settings");
  assert.equal((await api(`/api/collections/settings/records/${rec.id}`)).status, 404, "signed out cannot view the record");
  await nco(`/api/collections/settings/records/${rec.id}`, { method: "PATCH", body: { map_tile_url: "", map_api_key: "", map_attribution: "" } });
});

// A 1x1 transparent PNG.
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const putLogo = (token, bytes, type, name) => {
  const body = new FormData();
  body.append("logo", new Blob([bytes], { type }), name);
  return fetch(`${PB}/api/collections/settings/records/${logoSettingsId}`, { method: "PATCH", headers: { Authorization: token }, body });
};
let logoSettingsId;

test("logo: a transparent PNG uploads, is served, and can be removed; other files are refused", async () => {
  const rec = (await nco("/api/collections/settings/records")).json.items[0];
  logoSettingsId = rec.id;
  assert.equal(rec.logo, "", "starts with no logo");

  const ok = await putLogo(S.nco, TINY_PNG, "image/png", "club.png");
  assert.equal(ok.status, 200);
  const saved = await ok.json();
  assert.match(saved.logo, /^club.*\.png$/);
  const img = await fetch(`${PB}/api/files/settings/${rec.id}/${saved.logo}`);
  assert.equal(img.status, 200, "the logo loads in an <img> without a token");
  assert.equal(img.headers.get("content-type"), "image/png");

  assert.equal((await putLogo(S.nco, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), "image/svg+xml", "x.svg")).status, 400, "SVG refused");
  assert.equal((await putLogo(S.nco, Buffer.from("this is not a picture"), "image/png", "fake.png")).status, 400, "text named .png refused");
  assert.equal((await putLogo(S.nco, Buffer.concat([TINY_PNG, Buffer.alloc(1024 * 1024)]), "image/png", "big.png")).status, 400, "over 1 MB refused");
  assert.equal((await nco("/api/collections/settings/records")).json.items[0].logo, saved.logo, "refused uploads change nothing");

  const gone = await nco(`/api/collections/settings/records/${rec.id}`, { method: "PATCH", body: { logo: null } });
  assert.equal(gone.status, 200);
  assert.equal(gone.json.logo, "");
});

// ------------------------------------------------------------- rate limiting

test("rate limit: the PIN route stops a flood of guesses", async () => {
  const codes = [];
  for (let i = 0; i < 16; i++) {
    codes.push((await api("/api/rt/auth/pin", { method: "POST", body: { pin: "guess" + i } })).status);
  }
  assert.ok(codes.includes(429), `no 429 in ${codes}`);
  assert.ok(codes.slice(0, 3).every((c) => c === 401));
});
