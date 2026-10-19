/// <reference path="../pb_data/types.d.ts" />
//
// PIN sign-in for net control operators.
//   POST /api/rt/auth/pin   body: { "pin": "..." }
//
// The old app checked a PIN in the browser. Here the server checks it against NCO_PIN
// in its environment file, and a correct PIN is exchanged for a normal PocketBase
// sign-in (token + record) for the one shared "club" account. From then on the
// collection rules in the schema decide what that account may read and write.
// If NCO_PIN is not set the route refuses everything. Attempts are rate limited per
// client address in bootstrap.pb.js.

routerAdd("POST", "/api/rt/auth/pin", (e) => {
  const u = require(`${__hooks}/lib/util.js`);

  const expected = u.env("NCO_PIN").trim();
  if (!expected) {
    throw new ApiError(503, "Sign-in is not configured on this server (NCO_PIN is not set).", {});
  }

  const body = e.requestInfo().body || {};
  const given = String(body.pin === undefined || body.pin === null ? "" : body.pin).trim();
  // $security.equal compares in constant time so the PIN cannot be guessed by timing.
  if (!given || !$security.equal(given, expected)) {
    throw new UnauthorizedError("Incorrect PIN.");
  }

  const club = $app.findAuthRecordByEmail("users", "nco@round-table-net.local");
  if (!club.getBool("active")) {
    throw new ForbiddenError("The club account is switched off.");
  }
  return $apis.recordAuthResponse(e, club, "pin");
});
