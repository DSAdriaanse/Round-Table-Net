import test from "node:test";
import assert from "node:assert/strict";
import { isDuplicateStation } from "./duplicateStation.ts";

// What PocketBase really answered when WQAB123 was added to a net twice.
const real = { status: 400, response: { message: "Failed to create record.", data: { callsign: { code: "validation_not_unique", message: "Value must be unique." }, net_id: { code: "validation_not_unique", message: "Value must be unique." } } } };

test("PocketBase's duplicate answer is recognised", () => assert.equal(isDuplicateStation(real), true));

test("other failures are not mistaken for a duplicate", () => {
  assert.equal(isDuplicateStation(new Error("Failed to fetch")), false);
  assert.equal(isDuplicateStation({ response: { data: { name: { code: "validation_required" } } } }), false);
  assert.equal(isDuplicateStation({ response: { data: {} } }), false);
  assert.equal(isDuplicateStation(null), false);
  assert.equal(isDuplicateStation(undefined), false);
});
