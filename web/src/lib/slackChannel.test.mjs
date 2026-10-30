import test from "node:test";
import assert from "node:assert/strict";
import { chatProblem, isChannelId, tidyChannelId } from "./slackChannel.ts";

test("channel IDs are accepted, names are not", () => {
  for (const ok of ["C0123ABCD", " C0123ABCD ", "G01ABCDEFG"]) assert.equal(isChannelId(ok), true, ok);
  for (const bad of ["", "#general", "general", "c0123abcd", "C12", "U0123ABCD", "C0123 ABCD"]) assert.equal(isChannelId(bad), false, bad);
});

test("the ID is tidied before it is saved", () => {
  assert.equal(tidyChannelId("  c0123abcd "), "C0123ABCD");
});

test("a channel is only needed when chat is on", () => {
  assert.equal(chatProblem(false, ""), "");
  assert.equal(chatProblem(false, "nonsense"), "");
  assert.match(chatProblem(true, ""), /Enter the Slack channel ID/);
  assert.match(chatProblem(true, "#general"), /not a channel ID/);
  assert.equal(chatProblem(true, "c0123abcd"), "");
});
