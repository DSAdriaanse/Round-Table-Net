/// <reference path="../pb_data/types.d.ts" />
//
// Session life cycle, for net control operators only (all need a signed-in club account).
//   POST /api/rt/session/close     body: { session_id, technical_difficulty }
//   POST /api/rt/session/publish   body: { session_id }    post the report to WordPress
//
// open  --close-->  closed
// Closing also updates the roster (absences, 3-strike rule) in the same database
// transaction, so a session is never half-closed. With technical difficulty the roster
// update is skipped. "pending" is the old in-between state, from when a job ran every
// 15 minutes; nothing creates it any more, and bootstrap.pb.js finishes any left over.

// Close the session the operator is running. What it does, in order:
//   1. drops the "not heard" rows (they were only a working list),
//   2. adds guests who are not on the roster to it, flagged "needs review",
//   3. records how many people attended,
//   4. updates the roster for the net (skipped when there were technical difficulties),
//   5. marks the session closed.
routerAdd("POST", "/api/rt/session/close", (e) => {
  const u = require(`${__hooks}/lib/util.js`);
  const roster = require(`${__hooks}/lib/roster.js`);
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
      tx.save(s);
      result = { status: "closed", checkin_count: attending.length, guests_added: guestsAdded, stations_updated: 0 };
    } else {
      // Saved as pending only so processSession accepts it; it finishes the job (closed,
      // roster_updated) inside this same transaction, so nobody ever sees "pending".
      s.set("status", "pending");
      tx.save(s);
      const r = roster.processSession(tx, tx.findRecordById("net_sessions", session.id));
      result = { status: "closed", checkin_count: attending.length, guests_added: guestsAdded, stations_updated: r.stationsUpdated };
    }
  });

  return e.json(200, result);
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
