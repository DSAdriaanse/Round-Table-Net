/// <reference path="../pb_data/types.d.ts" />
//
// Session life cycle, for net control operators only (all need a signed-in club account).
//   POST /api/rt/session/close     body: { session_id, technical_difficulty }
//   POST /api/rt/session/process   body: { session_id? }   update the roster now
//   POST /api/rt/session/publish   body: { session_id }    post the report to WordPress
// and a job every 15 minutes that updates the roster for every session left "pending".
//
// open  --close-->  pending  --job or "process"-->  closed
//                   (technical_difficulty skips pending and goes straight to closed)

// Close the session the operator is running. What it does, in order:
//   1. drops the "not heard" rows (they were only a working list),
//   2. adds guests who are not on the roster to it, flagged "needs review",
//   3. records how many people attended,
//   4. marks the session pending (or closed at once if there were technical difficulties).
routerAdd("POST", "/api/rt/session/close", (e) => {
  const u = require(`${__hooks}/lib/util.js`);
  u.requireNco(e);
  const body = e.requestInfo().body || {};

  let session = null;
  try { session = $app.findRecordById("net_sessions", u.trunc(body.session_id, 40)); } catch (_) {}
  if (!session) throw new NotFoundError("No such session.");
  if (session.getString("status") !== "open") throw new ApiError(409, "This session is already closed.", {});

  const technical = body.technical_difficulty === true;
  const netId = session.getString("net_id");
  let result = null;

  $app.runInTransaction((tx) => {
    const all = u.find(tx, "check_ins", "session_id = {:s}", "@rowid", { s: session.id });
    const attending = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].getString("status") === "not_heard") tx.delete(all[i]);
      else attending.push(all[i]);
    }

    const onRoster = {};
    const stations = u.find(tx, "stations", "net_id = {:n}", "", { n: netId });
    for (let i = 0; i < stations.length; i++) onRoster[stations[i].getString("callsign").toUpperCase()] = true;

    const col = tx.findCollectionByNameOrId("stations");
    let guestsAdded = 0;
    for (let i = 0; i < attending.length; i++) {
      const c = attending[i];
      const cs = c.getString("callsign").toUpperCase();
      if (c.getString("status") !== "guest" || onRoster[cs]) continue;
      onRoster[cs] = true;
      const st = new Record(col);
      st.set("callsign", c.getString("callsign"));
      st.set("name", c.getString("name") || c.getString("callsign"));
      st.set("city", c.getString("location"));
      st.set("net_id", netId);
      st.set("active", true);
      st.set("consecutive_absences", 0);
      st.set("needs_review", true);
      tx.save(st);
      guestsAdded++;
    }

    // Fresh copy inside the transaction, so a double click cannot close it twice.
    const s = tx.findRecordById("net_sessions", session.id);
    if (s.getString("status") !== "open") throw new Error("already closed");
    s.set("closed_at", new Date().toISOString());
    s.set("checkin_count", attending.length);
    if (technical) {
      s.set("status", "closed");
      s.set("technical_difficulty", true);
      s.set("roster_updated", true);
    } else {
      s.set("status", "pending");
    }
    tx.save(s);
    result = { status: s.getString("status"), checkin_count: attending.length, guests_added: guestsAdded };
  });

  return e.json(200, result);
});

// Update the roster for a pending session right now instead of waiting for the job.
// With no session_id it takes the oldest-first pending session, like the old admin button.
routerAdd("POST", "/api/rt/session/process", (e) => {
  const u = require(`${__hooks}/lib/util.js`);
  const roster = require(`${__hooks}/lib/roster.js`);
  u.requireNco(e);
  const body = e.requestInfo().body || {};

  let session = null;
  if (body.session_id) {
    try { session = $app.findRecordById("net_sessions", u.trunc(body.session_id, 40)); } catch (_) {}
    if (!session) throw new NotFoundError("No such session.");
    if (session.getString("status") !== "pending") throw new ApiError(409, "This session is not waiting to be processed.", {});
  } else {
    const pending = u.find($app, "net_sessions", "status = 'pending'", "-opened_at");
    if (!pending.length) return e.json(200, { success: true, processed: 0, message: "No pending sessions" });
    session = pending[0];
  }

  let r = null;
  $app.runInTransaction((tx) => { r = roster.processSession(tx, tx.findRecordById("net_sessions", session.id)); });
  if (!r) throw new ApiError(409, "This session was already processed.", {});
  return e.json(200, { success: true, processed: 1, updatedStations: r.stationsUpdated, checkinCount: r.checkinCount });
});

routerAdd("POST", "/api/rt/session/publish", (e) => {
  const u = require(`${__hooks}/lib/util.js`);
  const report = require(`${__hooks}/lib/report.js`);
  u.requireNco(e);
  const body = e.requestInfo().body || {};
  if (!body.session_id) throw new BadRequestError("session_id is required");
  const r = report.publish(u, u.trunc(body.session_id, 40));
  return e.json(r.status, r.body);
});

// Every 15 minutes: finish every pending session. One failing session is skipped
// (and logged) so it cannot block the others.
cronAdd("processPendingSessions", "*/15 * * * *", () => {
  const u = require(`${__hooks}/lib/util.js`);
  const roster = require(`${__hooks}/lib/roster.js`);
  const pending = u.find($app, "net_sessions", "status = 'pending'", "-opened_at");
  for (let i = 0; i < pending.length; i++) {
    try {
      $app.runInTransaction((tx) => { roster.processSession(tx, tx.findRecordById("net_sessions", pending[i].id)); });
    } catch (err) {
      console.log("processPendingSessions: session " + pending[i].id + " failed: " + err);
    }
  }
});
