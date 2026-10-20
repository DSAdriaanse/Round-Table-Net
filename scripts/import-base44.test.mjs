// Run:  node --test scripts/import-base44.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFolder, loadJson, parseCsv, pbDate, plan, stringifyRow } from "./import-base44.mjs";

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

// ---- single-file JSON export
const jsonExport = {
  meta: { app_name: "x" },
  schema: {},
  Net: [{ id: "n1", name: "N", day_of_week: "Monday", time: "7 PM", frequency: null, is_sample: false }],
  Station: [
    { id: "s1", callsign: "K7ABC", name: "A", net_id: "n1", active: true, lat: 32.2, lng: -110.9, needs_review: false, consecutive_absences: 0 },
    { id: "s9", callsign: "W1OLD", name: "Old", net_id: "gone", active: false },
  ],
  NetSession: [
    { id: "x1", net_id: "n1", net_name: "N", date: "2026-01-05", status: "closed", checkin_count: 1 },
    { id: "x2", net_id: "gone", net_name: "Old Net", date: "2026-03-02", status: "closed" }, // no checkin_count key at all
    { id: "x3", net_id: "gone", net_name: "Old Net", date: "2026-03-09", status: "closed" },
  ],
  CheckIn: [
    { id: "c1", session_id: "x1", callsign: "K7ABC", station_id: "s1", status: "checked_in", net_id: "n1" },
    { id: "c2", session_id: "x2", callsign: "W1OLD", station_id: "s9", status: "checked_in", net_id: "gone" },
    { id: "c3", session_id: "x2", callsign: "N0BODY", status: "not_heard", net_id: "gone" },
    { id: "c4", session_id: "x1", callsign: "TEST1", station_id: "nothere", status: "guest", net_id: "n1" },
  ],
  Announcement: [{ id: "a1", text: "<p>hi</p>", order: 1, active: true }],
  users: [{ id: "u1", email: "someone@example.org" }],
};
const writeJson = (obj) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rtn-")), "export.json"); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

test("JSON values become the text a CSV cell would hold", () => {
  assert.deepEqual(stringifyRow({ a: true, b: false, c: null, d: 5, e: ["x"], f: "s" }), { a: "true", b: "false", c: "", d: "5", e: '["x"]', f: "s" });
});

test("a JSON export plans like the CSV one, ignoring users and schema", () => {
  const t = loadJson(writeJson(jsonExport));
  assert.deepEqual(Object.keys(t).sort(), ["Announcement", "CheckIn", "Net", "NetSession", "Station"]);
  const p = plan(t);
  assert.deepEqual([p.nets.length, p.stations.length, p.sessions.length, p.checkIns.length, p.announcements.length], [1, 1, 1, 2, 1]);
  assert.equal(p.stations[0].data.active, true);
  assert.equal(p.stations[0].data.lat, 32.2);
  assert.equal(p.sessions[0].data.checkin_count, 1);
});

test("a JSON file that is not an export is refused", () => {
  assert.throws(() => loadJson(writeJson({ hello: "world" })), /does not look like a Base44 export/);
});

test("--recreate-missing-nets keeps the history of a net the old app deleted", () => {
  const p = plan(loadJson(writeJson(jsonExport)), { recreateMissingNets: true });
  assert.equal(p.nets.length, 2);
  const re = p.nets.find((n) => n.old === "gone");
  assert.equal(re.data.name, "Old Net");
  assert.equal(re.data.day_of_week, "Monday"); // 2026-03-02 and 2026-03-09 are Mondays
  assert.equal(re.data.legacy_id, "gone");
  assert.equal(p.stations.length, 2);
  assert.equal(p.sessions.length, 3);
  assert.equal(p.checkIns.length, 4);
  assert.ok(p.stations.every((s) => p.nets.some((n) => n.old === s.net)));
  assert.ok(p.notes.some((n) => /Recreated the net "Old Net"/.test(n)));
});

test("a session whose JSON has no check-in count gets one from its check-ins (not_heard excluded)", () => {
  const p = plan(loadJson(writeJson(jsonExport)), { recreateMissingNets: true });
  assert.equal(p.sessions.find((s) => s.old === "x2").data.checkin_count, 1);
  assert.equal(p.sessions.find((s) => s.old === "x3").data.checkin_count, 0);
  assert.equal(p.sessions.find((s) => s.old === "x1").data.checkin_count, 1); // a stored count is kept
});

test("check-ins naming a missing roster station are counted, or skipped on request", () => {
  const t = loadJson(writeJson(jsonExport));
  const kept = plan(t);
  assert.ok(kept.checkIns.some((c) => c.old === "c4" && c.station === ""));
  assert.ok(kept.notes.some((n) => /1 check-in\(s\) name a roster station that is not in the export/.test(n)));
  const skipped = plan(t, { skipDanglingCheckins: true });
  assert.ok(!skipped.checkIns.some((c) => c.old === "c4"));
});
