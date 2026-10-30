import test from "node:test";
import assert from "node:assert/strict";
import { badgeText, chatAvailable, dropMessage, mergeMessage, newestDate, unreadCount } from "./chatState.ts";

const m = (id, source, created_date) => ({ id, source, created_date });

test("messages stay oldest first and a repeat is not shown twice", () => {
  let list = [];
  list = mergeMessage(list, m("b", "slack", "2026-10-29 10:00:02.000Z"));
  list = mergeMessage(list, m("a", "nco", "2026-10-29 10:00:01.000Z"));
  list = mergeMessage(list, m("b", "slack", "2026-10-29 10:00:02.000Z"));
  assert.deepEqual(list.map((x) => x.id), ["a", "b"]);
});

test("a message with the same time as another keeps a stable order", () => {
  let list = mergeMessage([], m("y", "slack", "2026-10-29 10:00:00.000Z"));
  list = mergeMessage(list, m("x", "slack", "2026-10-29 10:00:00.000Z"));
  assert.deepEqual(list.map((x) => x.id), ["x", "y"]);
});

test("dropping a message removes only that one", () => {
  assert.deepEqual(dropMessage([m("a", "nco", "1"), m("b", "nco", "2")], "a").map((x) => x.id), ["b"]);
});

test("only messages from Slack newer than the last look are unread", () => {
  const list = [m("1", "slack", "2026-10-29 10:00:00.000Z"), m("2", "nco", "2026-10-29 10:01:00.000Z"), m("3", "slack", "2026-10-29 10:02:00.000Z"), m("4", "slack", "2026-10-29 10:03:00.000Z")];
  assert.equal(unreadCount(list, ""), 3, "never looked: every Slack message");
  assert.equal(unreadCount(list, "2026-10-29 10:02:00.000Z"), 1);
  assert.equal(unreadCount(list, "2026-10-29 10:03:00.000Z"), 0);
  assert.equal(unreadCount([m("5", "nco", "2026-10-29 10:04:00.000Z")], ""), 0, "your own messages are never unread");
});

test("the newest date is remembered, and never goes backwards", () => {
  const list = [m("1", "slack", "2026-10-29 10:00:00.000Z"), m("2", "slack", "2026-10-29 10:05:00.000Z")];
  assert.equal(newestDate(list), "2026-10-29 10:05:00.000Z");
  assert.equal(newestDate(list, "2026-10-29 11:00:00.000Z"), "2026-10-29 11:00:00.000Z");
  assert.equal(newestDate([]), "");
});

test("the badge shows a number up to 9, then 9+", () => {
  assert.deepEqual([0, -1, 1, 9, 10, 250].map(badgeText), ["", "", "1", "9", "9+", "9+"]);
});

test("the bubble needs chat turned on for the net and an open session", () => {
  assert.equal(chatAvailable({ slack_enabled: true }, true), true);
  assert.equal(chatAvailable({ slack_enabled: true }, false), false);
  assert.equal(chatAvailable({ slack_enabled: false }, true), false);
  assert.equal(chatAvailable(undefined, true), false);
});
