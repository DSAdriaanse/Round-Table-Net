// Run:  node --test scripts/import-base44.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { loadFolder, parseCsv, pbDate, plan } from "./import-base44.mjs";

test("CSV parser handles quotes, doubled quotes and embedded newlines", () => {
  const rows = parseCsv('"a","b"\n"x ""y""","line1\nline2"\n');
  assert.deepEqual(rows, [{ a: 'x "y"', b: "line1\nline2" }]);
});

test("dates become PocketBase format, with or without a zone", () => {
  assert.equal(pbDate("2026-10-19T00:42:20.840000"), "2026-10-19 00:42:20.840Z");
  assert.equal(pbDate("2026-10-18T23:32:27.287Z"), "2026-10-18 23:32:27.287Z");
  assert.equal(pbDate(""), "");
});

test("the bundled example data plans to the expected records", () => {
  const p = plan(loadFolder(new URL("../example-data", import.meta.url).pathname));
  assert.deepEqual([p.nets.length, p.stations.length, p.sessions.length, p.checkIns.length, p.announcements.length], [3, 120, 12, 174, 2]);
  // every link points at something that is in the plan
  const nets = new Set(p.nets.map((n) => n.old)), sessions = new Set(p.sessions.map((s) => s.old)), stations = new Set(p.stations.map((s) => s.old));
  assert.ok(p.stations.every((s) => nets.has(s.net)));
  assert.ok(p.sessions.every((s) => nets.has(s.net)));
  assert.ok(p.checkIns.every((c) => sessions.has(c.session) && (!c.station || stations.has(c.station))));
  assert.ok(p.stations.every((s) => s.data.callsign === s.data.callsign.trim().toUpperCase()));
});

test("orphans are skipped and counted, blank counts recomputed, repeated stations kept once", () => {
  const p = plan({
    Net: [{ id: "n1", name: "N", day_of_week: "Monday", time: "7 PM" }],
    Station: [
      { id: "s1", callsign: " k7abc ", name: "A", net_id: "n1", active: "true" },
      { id: "s2", callsign: "K7ABC", name: "A again", net_id: "n1", active: "true" },
      { id: "s3", callsign: "W1AW", name: "B", net_id: "gone" },
    ],
    NetSession: [{ id: "x1", net_id: "n1", date: "2026-01-01", status: "closed", checkin_count: "" }, { id: "x2", net_id: "gone", date: "2026-01-01" }],
    CheckIn: [
      { id: "c1", session_id: "x1", callsign: "k7abc", station_id: "s2", status: "checked_in", net_id: "n1" },
      { id: "c2", session_id: "x1", callsign: "N7XYZ", status: "not_heard", net_id: "n1" },
      { id: "c3", session_id: "x2", callsign: "W1AW", status: "checked_in" },
    ],
    Announcement: [{ id: "a1", text: "<p>hi</p>", order: "2", active: "false" }, { id: "a2", text: "sample", is_sample: "true" }],
  });
  assert.equal(p.stations.length, 1);
  assert.equal(p.stations[0].data.callsign, "K7ABC");
  assert.equal(p.sessions.length, 1);
  assert.equal(p.sessions[0].data.checkin_count, 1); // not_heard is not counted
  assert.equal(p.checkIns.length, 2);
  assert.equal(p.checkIns[0].station, "s1"); // pointed at the kept station, not the dropped repeat
  assert.equal(p.announcements.length, 1);
  assert.equal(p.announcements[0].data.active, false);
  assert.ok(p.notes.some((n) => /1 stations skipped: their net/.test(n)));
  assert.ok(p.notes.some((n) => /1 check-ins skipped/.test(n)));
});
