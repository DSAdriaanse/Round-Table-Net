import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAX_ABSENCES, isInactive } from "./stationState.ts";

test("an active station with few absences is not inactive", () => {
  assert.equal(isInactive({ active: true, consecutive_absences: 0 }), false);
  assert.equal(isInactive({ active: true, consecutive_absences: DEFAULT_MAX_ABSENCES - 1 }), false);
});

test("a station switched off, or at the absence limit, is inactive", () => {
  assert.equal(isInactive({ active: false, consecutive_absences: 0 }), true);
  assert.equal(isInactive({ active: true, consecutive_absences: DEFAULT_MAX_ABSENCES }), true);
  assert.equal(isInactive({ active: false, consecutive_absences: 5 }), true);
});

test("the limit is the net's own: 2 drops sooner, 5 later", () => {
  assert.equal(isInactive({ active: true, consecutive_absences: 2 }, 2), true);
  assert.equal(isInactive({ active: true, consecutive_absences: 3 }, 5), false);
  assert.equal(isInactive({ active: true, consecutive_absences: 5 }, 5), true);
});

test("limit 0 never makes anyone inactive for absences, but a switched-off station is still inactive", () => {
  assert.equal(isInactive({ active: true, consecutive_absences: 40 }, 0), false);
  assert.equal(isInactive({ active: false, consecutive_absences: 0 }, 0), true);
});
