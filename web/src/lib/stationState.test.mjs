import test from "node:test";
import assert from "node:assert/strict";
import { MAX_ABSENCES, isInactive } from "./stationState.ts";

test("an active station with few absences is not inactive", () => {
  assert.equal(isInactive({ active: true, consecutive_absences: 0 }), false);
  assert.equal(isInactive({ active: true, consecutive_absences: MAX_ABSENCES - 1 }), false);
});

test("a station switched off, or at the absence limit, is inactive", () => {
  assert.equal(isInactive({ active: false, consecutive_absences: 0 }), true);
  assert.equal(isInactive({ active: true, consecutive_absences: MAX_ABSENCES }), true);
  assert.equal(isInactive({ active: false, consecutive_absences: 5 }), true);
});
