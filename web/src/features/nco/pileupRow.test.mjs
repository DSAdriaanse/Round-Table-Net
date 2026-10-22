// Run with:  npm test   (node --test with type stripping; no extra packages)
import test from "node:test";
import assert from "node:assert/strict";
import { finalStatus, makeRow, matchRow, typeCallsign } from "./pileupRow.ts";

const station = (callsign, extra = {}) => ({ id: `id-${callsign}`, callsign, name: `Op ${callsign}`, city: "Tucson", state: "AZ", ...extra });
const roster = [station("WQAB123"), station("KAE1234")];

// Type a callsign one character at a time, like an operator does.
const typeOut = (row, text) => [...text].reduce((r, _, i) => typeCallsign(r, text.slice(0, i + 1), roster), row);

test("a roster callsign typed character by character saves with the default status, not guest", () => {
  const row = typeOut(makeRow("short_time"), "wqab123");
  assert.equal(row.matched, true);
  assert.equal(row.isGuest, false);
  assert.equal(row.status, "short_time");
  assert.equal(finalStatus(row), "short_time");
});

test("a callsign that is not on the roster saves as guest", () => {
  const row = typeOut(makeRow("short_time"), "N0ONE");
  assert.equal(row.matched, false);
  assert.equal(row.isGuest, true);
  assert.equal(finalStatus(row), "guest");
});

test("a guest and a roster station in the same batch are kept apart", () => {
  const rows = [typeOut(makeRow("checked_in"), "N0ONE"), typeOut(makeRow("checked_in"), "KAE1234")];
  assert.deepEqual(rows.map(finalStatus), ["guest", "checked_in"]);
});

test("choosing a suggestion fills the row and keeps its status", () => {
  const partial = typeOut(makeRow("early"), "WQA");
  assert.equal(partial.isGuest, true);
  const row = matchRow(partial, roster[0]);
  assert.equal(row.isGuest, false);
  assert.equal(finalStatus(row), "early");
});

test("a status the operator picked survives typing the rest of the callsign", () => {
  const row = typeCallsign({ ...typeOut(makeRow("short_time"), "WQAB12"), status: "early" }, "WQAB123", roster);
  assert.equal(finalStatus(row), "early");
});

test("editing a matched callsign into a non-match clears the filled-in details and flags a guest", () => {
  const matched = typeOut(makeRow("checked_in"), "KAE1234");
  const row = typeCallsign(matched, "KAE123", roster);
  assert.deepEqual([row.name, row.location, row.state, row.matched, row.isGuest, row.station], ["", "", "", false, true, null]);
});

test("a name typed for a guest is kept while the callsign is edited", () => {
  const guest = { ...typeOut(makeRow("checked_in"), "N0ONE"), name: "Pat" };
  assert.equal(typeCallsign(guest, "N0ONES", roster).name, "Pat");
});
