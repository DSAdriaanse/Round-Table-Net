/// <reference path="../pb_data/types.d.ts" />
//
// Turn off PocketBase's "login alert" email on the club account.
//
// PocketBase emails a user when they sign in from a device it has not seen before. The club account
// is shared by every net control operator, so almost every sign-in is a "new device", and the account's
// address (nco@round-table-net.local) is not a real mailbox. The server has no mail set up either, so each
// attempt only wrote a warning to the PocketBase logs ("Failed to send login alert ... sendmail"). Sign-in
// itself was never affected.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.authAlert.enabled = false;
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.authAlert.enabled = true;
  app.save(users);
});
