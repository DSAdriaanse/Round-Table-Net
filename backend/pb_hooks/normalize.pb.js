/// <reference path="../pb_data/types.d.ts" />
//
// Keeps callsigns tidy and refuses repeated check-ins.
//
// 1. Whatever way a station or check-in is saved (screens, routes, importer), its
//    callsign is stored trimmed and upper case, so "wrwt531 " and "WRWT531" are the same station.
// 2. A net control operator cannot add a second check-in for the same callsign to a
//    session; the screens update the existing one instead. Superusers (the importer)
//    are not held to this, because the historical data contains repeats.
// 3. A net created without max_absences gets the default of 3. (A number field cannot
//    tell "not given" from 0, and 0 means "never drop anyone", so the default is set here.)

onRecordValidate((e) => {
  const u = require(`${__hooks}/lib/util.js`);
  e.record.set("callsign", u.normCallsign(e.record.getString("callsign")));
  e.next();
}, "stations", "check_ins");

onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const u = require(`${__hooks}/lib/util.js`);
    const cs = u.normCallsign(e.record.getString("callsign"));
    const same = u.find($app, "check_ins", "session_id = {:s} && callsign = {:c}", "", { s: e.record.getString("session_id"), c: cs });
    if (same.length > 0) {
      throw new ApiError(409, cs + " is already checked in to this session.", {});
    }
  }
  e.next();
}, "check_ins");

onRecordCreateRequest((e) => {
  const given = (e.requestInfo().body || {}).max_absences;
  if (given === undefined || given === null || given === "") e.record.set("max_absences", 3);
  e.next();
}, "nets");
