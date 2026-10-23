import test from "node:test";
import assert from "node:assert/strict";
import { clockText, hms, msToNextSecond } from "./clock.ts";

test("zulu and local read HH:MM:SSZ and HH:MM:SSL", () => {
  const t = clockText(new Date("2026-10-22T18:05:09Z"), "America/Phoenix");
  assert.equal(t.zulu, "18:05:09Z");
  assert.equal(t.local, "11:05:09L"); // Arizona is UTC-7 all year
});

test("local can be on the previous day while zulu has rolled over", () => {
  const t = clockText(new Date("2026-10-23T02:30:00Z"), "America/Phoenix");
  assert.deepEqual(t, { zulu: "02:30:00Z", local: "19:30:00L" });
});

test("midnight is 00:00:00, never 24:00:00, and values are zero padded", () => {
  assert.equal(hms(new Date("2026-10-22T00:00:00Z"), "UTC"), "00:00:00");
  assert.equal(hms(new Date("2026-10-22T07:00:00Z"), "America/Phoenix"), "00:00:00");
  assert.equal(clockText(new Date("2026-01-02T03:04:05Z"), "UTC").local, "03:04:05L");
});

test("zones with daylight saving follow it", () => {
  assert.equal(clockText(new Date("2026-07-01T12:00:00Z"), "America/New_York").local, "08:00:00L");
  assert.equal(clockText(new Date("2026-01-01T12:00:00Z"), "America/New_York").local, "07:00:00L");
});

test("the next tick is at the start of the next second", () => {
  assert.equal(msToNextSecond(new Date("2026-10-22T18:05:09.250Z")), 750);
  assert.equal(msToNextSecond(new Date("2026-10-22T18:05:09.000Z")), 1000);
  assert.equal(msToNextSecond(new Date("2026-10-22T18:05:09.999Z")), 1);
});
