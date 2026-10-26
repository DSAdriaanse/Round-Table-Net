import test from "node:test";
import assert from "node:assert/strict";
import { canDiscard, cancelPlan, isCancelPhrase } from "./cancelSession.ts";

test("an empty session needs no typing", () => {
  const plan = cancelPlan(0);
  assert.equal(plan.needsTyping, false);
  assert.equal(canDiscard(plan, "", false), true);
});

test("a session with check-ins needs CANCEL typed, and says how many are lost", () => {
  const plan = cancelPlan(14);
  assert.equal(plan.needsTyping, true);
  assert.match(plan.warning, /14 check-ins/);
  assert.equal(canDiscard(plan, "", false), false);
  assert.equal(canDiscard(plan, "cance", false), false);
  assert.equal(canDiscard(plan, "CANCEL", false), true);
});

test("one check-in reads in the singular", () => {
  assert.match(cancelPlan(1).warning, /1 check-in\./);
});

test("the word is accepted in any case with stray spaces, nothing else", () => {
  assert.equal(isCancelPhrase("  cancel "), true);
  assert.equal(isCancelPhrase("Cancel"), true);
  assert.equal(isCancelPhrase("cancel it"), false);
  assert.equal(isCancelPhrase("close"), false);
});

test("the button stays off while a delete is already running", () => {
  assert.equal(canDiscard(cancelPlan(0), "", true), false);
  assert.equal(canDiscard(cancelPlan(5), "CANCEL", true), false);
});
