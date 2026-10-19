/// <reference path="../pb_data/types.d.ts" />
//
// The only routes anyone on the internet can call (no sign-in). They return a small,
// safe slice of the data and never expose the roster, names or comments.
//   GET  /api/rt/public/nets                   which nets exist, and whether one is live now
//   GET  /api/rt/public/session?net=<net id>   the open session of a net and who has checked in
//   POST /api/rt/public/checkin                check in to the open session of a net
// All three are rate limited per client address (bootstrap.pb.js).

routerAdd("GET", "/api/rt/public/nets", (e) => {
  const u = require(`${__hooks}/lib/util.js`);
  const nets = u.find($app, "nets", "id != ''", "name");
  const out = [];
  for (let i = 0; i < nets.length; i++) {
    const n = nets[i];
    out.push({
      id: n.id,
      name: n.getString("name"),
      day_of_week: n.getString("day_of_week"),
      time: n.getString("time"),
      frequency: n.getString("frequency"),
      is_live: u.openSession($app, n.id) !== null,
    });
  }
  return e.json(200, out);
});

routerAdd("GET", "/api/rt/public/session", (e) => {
  const u = require(`${__hooks}/lib/util.js`);
  const netId = u.trunc(e.requestInfo().query["net"], 40);
  let net = null;
  try { net = $app.findRecordById("nets", netId); } catch (_) {}
  if (!net) throw new NotFoundError("No such net.");

  const session = u.openSession($app, net.id);
  const checkIns = [];
  if (session) {
    const rows = u.find($app, "check_ins", "session_id = {:s} && status != 'not_heard'", "@rowid", { s: session.id });
    for (let i = 0; i < rows.length; i++) {
      checkIns.push({ callsign: rows[i].getString("callsign"), status: rows[i].getString("status") });
    }
  }
  return e.json(200, {
    net: { id: net.id, name: net.getString("name"), day_of_week: net.getString("day_of_week"), time: net.getString("time") },
    session: session ? { id: session.id, date: session.getString("date"), topic: session.getString("topic") } : null,
    check_ins: checkIns,
  });
});

routerAdd("POST", "/api/rt/public/checkin", (e) => {
  const u = require(`${__hooks}/lib/util.js`);
  const body = e.requestInfo().body || {};

  const callsign = u.normCallsign(body.callsign);
  if (!/^[A-Z0-9\/-]{3,12}$/.test(callsign)) {
    throw new BadRequestError("Enter a valid callsign.");
  }
  let net = null;
  try { net = $app.findRecordById("nets", u.trunc(body.net_id, 40)); } catch (_) {}
  if (!net) throw new NotFoundError("No such net.");

  const session = u.openSession($app, net.id);
  if (!session) {
    return e.json(404, { result: "no_session", message: "The net control operator has not opened a session yet." });
  }

  const dupFilter = "session_id = {:s} && callsign = {:c}";
  if (u.find($app, "check_ins", dupFilter, "", { s: session.id, c: callsign }).length > 0) {
    return e.json(409, { result: "already", message: callsign + " has already checked in this session." });
  }

  // On the roster (active or not)? Prefer the active one, and bring an inactive
  // station back with its absences cleared, as the old app did.
  const matches = u.find($app, "stations", "net_id = {:n} && callsign = {:c}", "-active", { n: net.id, c: callsign });
  let station = matches.length ? matches[0] : null;
  if (station && !station.getBool("active")) {
    station.set("active", true);
    station.set("consecutive_absences", 0);
    $app.save(station);
  }

  const rec = new Record($app.findCollectionByNameOrId("check_ins"));
  rec.set("session_id", session.id);
  rec.set("net_id", net.id);
  rec.set("callsign", callsign);
  rec.set("station_id", station ? station.id : "");
  rec.set("status", "checked_in");
  rec.set("name", u.trunc(body.name, 200).trim());
  rec.set("location", u.trunc(body.location, 200).trim());
  rec.set("comment", u.trunc(body.comment, 300).trim());
  $app.save(rec);

  // Two people submitting the same callsign at the same instant can both pass the
  // check above. Settle it afterwards: the earliest row (insert order) survives.
  const all = u.find($app, "check_ins", dupFilter, "@rowid", { s: session.id, c: callsign });
  if (all.length > 1 && all[0].id !== rec.id) {
    $app.delete(rec);
    return e.json(409, { result: "already", message: callsign + " has already checked in this session." });
  }

  return e.json(200, { result: "checked_in", callsign: callsign });
});
