// Shared helpers for hook handlers. Load inside handlers with:
//   const u = require(`${__hooks}/lib/util.js`)
//
// Why require() inside each handler instead of once at the top of a file:
// PocketBase runs every route handler in its own isolated JavaScript context,
// so top-level variables and imports from the file are NOT visible inside a
// handler. Loading the helper inside the handler is what makes it available.

// Read a server environment variable (set in /etc/round-table-net/env). Returns
// the fallback, or an empty string, when it is missing or blank.
function env(name, fallback) {
  const v = $os.getenv(name);
  return v ? v : (fallback === undefined ? "" : fallback);
}

// Clamp any value to a string of at most max characters. Used on every piece of
// text that arrives from outside, so nothing oversized reaches the database.
function trunc(v, max) {
  const s = v === undefined || v === null ? "" : String(v);
  return s.length > max ? s.slice(0, max) : s;
}

// Callsigns are stored trimmed and upper case ("wsol865/2 " becomes "WSOL865/2").
function normCallsign(v) {
  return trunc(v, 40).trim().toUpperCase();
}

// The single settings record (non-secret configuration), or null.
function settings() {
  const all = $app.findAllRecords("settings");
  return all.length ? all[0] : null;
}

// One text field from the settings record, or "" if there is none.
function setting(rec, name) {
  return rec ? (rec.getString(name) || "") : "";
}

// Server-side check used by every route that is only for net control operators.
// Returns the signed-in club account, or throws 401/403.
function requireNco(e) {
  const a = e.auth;
  if (!a || a.collection().name !== "users") {
    throw new UnauthorizedError("Sign in required.");
  }
  if (!a.getBool("active") || a.getString("role") !== "nco") {
    throw new ForbiddenError("You do not have permission to do this.");
  }
  return a;
}

// Records of one collection matching a filter. `params` fills the {:name}
// placeholders, which keeps user input out of the filter text itself.
// `app` is $app, or the transaction app inside runInTransaction.
function find(app, collection, filter, sort, params) {
  return app.findRecordsByFilter(collection, filter, sort || "", 0, 0, params || {});
}

// The newest open session of a net, or null.
function openSession(app, netId) {
  const rows = app.findRecordsByFilter("net_sessions", "net_id = {:net} && status = 'open'", "-opened_at", 1, 0, { net: netId });
  return rows.length ? rows[0] : null;
}

module.exports = { env, trunc, normCallsign, settings, setting, requireNco, find, openSession };
