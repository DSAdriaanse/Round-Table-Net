// Run:  node --test scripts/find-orphans.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { findOrphans } from "./find-orphans.mjs";

const base = () => ({
  nets: [{ id: "n1" }],
  stations: [{ id: "s1", net_id: "n1" }],
  sessions: [{ id: "x1", net_id: "n1" }],
  checkIns: [{ id: "c1", session_id: "x1", net_id: "n1", station_id: "s1" }, { id: "c2", session_id: "x1", net_id: "", station_id: "" }],
});

test("intact data has no orphans (a guest check-in has no station or net link)", () => {
  assert.deepEqual(findOrphans(base()), []);
});

test("each kind of dead link is reported with its count and ids", () => {
  const d = base();
  d.stations.push({ id: "s2", net_id: "gone" });
  d.sessions.push({ id: "x2", net_id: "gone" });
  d.checkIns.push({ id: "c3", session_id: "nosession", net_id: "n1" }, { id: "c4", session_id: "x1", net_id: "gone" }, { id: "c5", session_id: "x1", station_id: "nostation" });
  const r = Object.fromEntries(findOrphans(d).map((f) => [f.what, f]));
  assert.equal(r["stations whose net is missing"].count, 1);
  assert.deepEqual(r["sessions whose net is missing"].ids, ["x2"]);
  assert.deepEqual(r["check-ins whose session is missing"].ids, ["c3"]);
  assert.deepEqual(r["check-ins whose net is missing"].ids, ["c4"]);
  assert.deepEqual(r["check-ins whose roster station is missing"].ids, ["c5"]);
});

test("at most 20 ids are listed", () => {
  const d = base();
  for (let i = 0; i < 30; i++) d.stations.push({ id: "x" + i, net_id: "gone" });
  const f = findOrphans(d).find((x) => x.what.startsWith("stations"));
  assert.equal(f.count, 30);
  assert.equal(f.ids.length, 20);
});
