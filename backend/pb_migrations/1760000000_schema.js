/// <reference path="../pb_data/types.d.ts" />
//
// Round Table Net schema and access rules.
//
// WHO CAN DO WHAT
//   The public (nobody signed in) can only use three custom routes under
//   /api/rt/public/ (see backend/pb_hooks/public.pb.js): list nets, see the open
//   session, and check in. They cannot read or write any collection directly.
//
//   Net control operators (NCOs) sign in by typing the club PIN. The server checks
//   the PIN (env NCO_PIN) and hands back a normal PocketBase sign-in for one shared
//   "club" account in the users collection (role "nco"). Every collection below is
//   then readable and writable by that account. There is no other way to sign in:
//   password sign-in is switched off on users.
//
// Every rule below is enforced by the server. The UI hides things for convenience only.
//
// HOW TO READ THIS FILE
//   A migration runs once, the first time PocketBase starts on a new database (the
//   second function at the bottom undoes it). Each block creates one table, called a
//   "collection". For each collection:
//     listRule / viewRule                      who may read it
//     createRule / updateRule / deleteRule     who may change it
//   A rule is a filter expression. null means "nobody through the API" (only server
//   code in pb_hooks can do it); "" would mean "anyone, even signed out".
//   To change the schema later, add a NEW migration file with a later timestamp in
//   its name. Do not edit this one on a database that already ran it.

migrate((app) => {
  // Rule building block, reused below: the signed-in, active club account.
  const NCO = `@request.auth.id != "" && @request.auth.collectionName = "users" && @request.auth.active = true`;

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const SESSION_STATUS = ["open", "pending", "closed"];
  const CHECKIN_STATUS = ["checked_in", "short_time", "early", "not_heard", "guest"];

  // Created and updated timestamps, named created_date and updated_date (the users
  // collection keeps PocketBase's own created and updated).
  const stamps = () => [
    { type: "autodate", name: "created_date", onCreate: true, onUpdate: false },
    { type: "autodate", name: "updated_date", onCreate: true, onUpdate: true },
  ];

  // ---------------------------------------------------------------- users
  // One shared account for all net control operators. Nobody knows its password;
  // the PIN route (/api/rt/auth/pin) issues its sign-in token instead.
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new SelectField({ name: "role", required: true, maxSelect: 1, values: ["nco"] }));
  users.fields.add(new BoolField({ name: "active" }));
  users.authRule = "active = true";
  users.createRule = null; // no self-registration; only the migration below creates the club account
  users.listRule = null;
  users.viewRule = `id = @request.auth.id`;
  users.updateRule = null;
  users.deleteRule = null;
  users.passwordAuth.enabled = false; // the PIN route is the only way in
  users.otp.enabled = false;
  users.mfa.enabled = false;
  users.oauth2.enabled = false;
  users.authToken.duration = 12 * 60 * 60; // a PIN sign-in lasts 12 hours
  app.save(users);

  const club = new Record(users);
  club.set("email", "nco@round-table-net.local");
  club.set("emailVisibility", false);
  club.set("verified", true);
  club.set("name", "Net Control");
  club.set("role", "nco");
  club.set("active", true);
  club.set("password", $security.randomString(48));
  app.save(club);

  // ----------------------------------------------------------------- nets
  const nets = new Collection({
    type: "base",
    name: "nets",
    listRule: NCO,
    viewRule: NCO,
    createRule: NCO,
    updateRule: NCO,
    deleteRule: NCO,
    fields: [
      { type: "text", name: "name", required: true, max: 200 },
      { type: "select", name: "day_of_week", required: true, maxSelect: 1, values: DAYS },
      { type: "text", name: "time", required: true, max: 50 },
      { type: "text", name: "frequency", max: 200 },
      // Rich text (HTML) scripts the NCO reads aloud. May contain [/TOPIC] and [/ANNOUNCEMENTS].
      { type: "editor", name: "preamble", maxSize: 200000, convertURLs: false },
      { type: "editor", name: "closing", maxSize: 200000, convertURLs: false },
      { type: "text", name: "legacy_id", max: 64 }, // old app id; used by the importer, remove after cutover
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_nets_name ON nets (name)"],
  });
  app.save(nets);

  // ------------------------------------------------------------- stations
  // The roster: people who normally check in to a net.
  const stations = new Collection({
    type: "base",
    name: "stations",
    listRule: NCO,
    viewRule: NCO,
    createRule: NCO,
    updateRule: NCO,
    deleteRule: NCO,
    fields: [
      { type: "text", name: "callsign", required: true, max: 20 },
      { type: "text", name: "name", required: true, max: 200 },
      { type: "text", name: "city", max: 200 },
      { type: "text", name: "state", max: 50 },
      { type: "number", name: "lat" },
      { type: "number", name: "lng" },
      { type: "relation", name: "net_id", required: true, collectionId: nets.id, maxSelect: 1, cascadeDelete: true },
      { type: "bool", name: "permanent_attendance" }, // never dropped for missing nets
      { type: "bool", name: "active" }, // on the active roster
      { type: "number", name: "consecutive_absences", min: 0 },
      { type: "bool", name: "needs_review" }, // added as a guest, waiting for a manager to look
      { type: "text", name: "legacy_id", max: 64 },
      ...stamps(),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_stations_net_callsign ON stations (net_id, callsign)",
      "CREATE INDEX idx_stations_net_active ON stations (net_id, active)",
    ],
  });
  app.save(stations);

  // --------------------------------------------------------- net_sessions
  // One meeting of a net. status: open (running) -> pending (closed, roster
  // not yet updated) -> closed (roster updated).
  const sessions = new Collection({
    type: "base",
    name: "net_sessions",
    listRule: NCO,
    viewRule: NCO,
    createRule: NCO,
    updateRule: NCO,
    deleteRule: NCO,
    fields: [
      { type: "relation", name: "net_id", required: true, collectionId: nets.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "net_name", max: 200 }, // the net's name when the session was opened
      { type: "text", name: "date", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$", max: 10 }, // YYYY-MM-DD
      { type: "select", name: "status", maxSelect: 1, values: SESSION_STATUS },
      { type: "text", name: "nco_callsign", max: 20 },
      { type: "text", name: "topic", max: 2000 },
      { type: "text", name: "notes", max: 20000 },
      { type: "date", name: "opened_at" },
      { type: "date", name: "closed_at" },
      { type: "bool", name: "roster_updated" },
      { type: "bool", name: "technical_difficulty" }, // true: absences are not counted for this session
      { type: "number", name: "checkin_count", min: 0 }, // people who attended (not_heard excluded); written at close
      { type: "text", name: "legacy_id", max: 64 },
      ...stamps(),
    ],
    indexes: [
      "CREATE INDEX idx_sessions_net_status ON net_sessions (net_id, status)",
      "CREATE INDEX idx_sessions_opened ON net_sessions (opened_at)",
    ],
  });
  app.save(sessions);

  // ------------------------------------------------------------ check_ins
  // Deleting a session deletes its check-ins (cascade), so none are left orphaned.
  // Deleting a station keeps its past check-ins and just clears station_id.
  const checkIns = new Collection({
    type: "base",
    name: "check_ins",
    listRule: NCO,
    viewRule: NCO,
    createRule: NCO,
    updateRule: NCO,
    deleteRule: NCO,
    fields: [
      { type: "relation", name: "session_id", required: true, collectionId: sessions.id, maxSelect: 1, cascadeDelete: true },
      { type: "relation", name: "net_id", collectionId: nets.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "callsign", required: true, max: 20 },
      { type: "relation", name: "station_id", collectionId: stations.id, maxSelect: 1, cascadeDelete: false },
      { type: "select", name: "status", required: true, maxSelect: 1, values: CHECKIN_STATUS },
      { type: "text", name: "comment", max: 5000 },
      { type: "text", name: "name", max: 200 }, // typed in for guests and public check-ins
      { type: "text", name: "location", max: 200 },
      { type: "text", name: "legacy_id", max: 64 },
      ...stamps(),
    ],
    // Not unique on purpose: the old app's data contains repeated check-ins for one callsign
    // in one session. The check-in routes refuse new duplicates.
    indexes: [
      "CREATE INDEX idx_checkins_session ON check_ins (session_id)",
      "CREATE INDEX idx_checkins_session_callsign ON check_ins (session_id, callsign)",
    ],
  });
  app.save(checkIns);

  // -------------------------------------------------------- announcements
  const announcements = new Collection({
    type: "base",
    name: "announcements",
    listRule: NCO,
    viewRule: NCO,
    createRule: NCO,
    updateRule: NCO,
    deleteRule: NCO,
    fields: [
      { type: "editor", name: "text", required: true, maxSize: 20000, convertURLs: false },
      { type: "number", name: "order" },
      { type: "bool", name: "active" },
      { type: "text", name: "legacy_id", max: 64 },
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_announcements_order ON announcements (\"order\")"],
  });
  app.save(announcements);

  // ------------------------------------------------------------- settings
  // Non-secret configuration, one record. Secrets (club PIN, WordPress password,
  // Anthropic key) live in the server environment and are never stored here.
  const settings = new Collection({
    type: "base",
    name: "settings",
    listRule: NCO,
    viewRule: NCO,
    createRule: null,
    updateRule: NCO,
    deleteRule: null,
    fields: [
      { type: "text", name: "club_name", max: 200 },
      { type: "url", name: "wordpress_url" },
      { type: "text", name: "wordpress_username", max: 200 },
      { type: "text", name: "wordpress_category", max: 100 },
      { type: "bool", name: "publish_on_close" }, // post the report to WordPress when a session is closed
      ...stamps(),
    ],
  });
  app.save(settings);

  const defaults = new Record(settings);
  defaults.set("club_name", "SWCRS");
  defaults.set("wordpress_category", "regional-gmrs-net");
  defaults.set("publish_on_close", false); // off until someone fills in the WordPress settings
  app.save(defaults);
}, (app) => {
  for (const name of ["settings", "announcements", "check_ins", "net_sessions", "stations", "nets"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  try {
    app.delete(app.findAuthRecordByEmail("users", "nco@round-table-net.local"));
  } catch (_) {}
  const users = app.findCollectionByNameOrId("users");
  for (const f of ["role", "active"]) users.fields.removeByName(f);
  users.authRule = "";
  users.createRule = "";
  users.passwordAuth.enabled = true;
  app.save(users);
});
