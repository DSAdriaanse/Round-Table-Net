// Roster bookkeeping for a finished session. Used by the 15-minute job and by the
// manual "process now" route (sessions.pb.js).
//
// A session goes open -> pending (the net control operator closed it) -> closed (this file).
// For every station on the active roster of the net:
//   attended (checked_in, short_time or early)  -> absences back to 0
//   did not attend                              -> one more absence; at MAX_ABSENCES the
//                                                  station is made inactive
// permanent_attendance stations are never counted absent, and stations waiting for
// review (added as a guest) are left alone.

const MAX_ABSENCES = 3;
const ATTENDED = ["checked_in", "short_time", "early"];

// `app` is $app, or the transaction app inside runInTransaction, and `session` was read
// through that same app. Returns { stationsUpdated, checkinCount }, or null when the
// session is no longer pending: the 15-minute job and the manual button can overlap,
// and a session must never be counted twice.
function processSession(app, session) {
  if (session.getString("status") !== "pending") return null;
  const checkIns = app.findRecordsByFilter("check_ins", "session_id = {:s}", "", 0, 0, { s: session.id });
  const attended = {};
  let checkinCount = 0;
  for (let i = 0; i < checkIns.length; i++) {
    const status = checkIns[i].getString("status");
    if (status !== "not_heard") checkinCount++;
    if (ATTENDED.indexOf(status) >= 0) attended[checkIns[i].getString("callsign").trim().toUpperCase()] = true;
  }

  const stations = app.findRecordsByFilter("stations", "net_id = {:n}", "", 0, 0, { n: session.getString("net_id") });
  let stationsUpdated = 0;
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    if (!st.getBool("active")) continue;
    if (st.getBool("needs_review")) continue;

    const here = attended[st.getString("callsign").trim().toUpperCase()] === true;
    const absences = st.getInt("consecutive_absences");
    if (here) {
      if (absences !== 0) {
        st.set("consecutive_absences", 0);
        st.set("active", true);
        app.save(st);
        stationsUpdated++;
      }
    } else {
      if (st.getBool("permanent_attendance")) continue;
      const next = absences + 1;
      st.set("consecutive_absences", next);
      st.set("active", next < MAX_ABSENCES);
      app.save(st);
      stationsUpdated++;
    }
  }

  session.set("status", "closed");
  session.set("roster_updated", true);
  session.set("checkin_count", checkinCount);
  app.save(session);
  return { stationsUpdated: stationsUpdated, checkinCount: checkinCount };
}

module.exports = { processSession, MAX_ABSENCES };
