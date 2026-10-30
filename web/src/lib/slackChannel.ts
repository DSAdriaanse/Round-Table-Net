// Checks for the Slack channel setting on a net (Manage Nets). Pure, so Node can test it (slackChannel.test.mjs).
// Slack wants the channel's ID (C0123ABCD, or G... for older private channels), not its name; the server
// checks the same shape before it posts anything.

const CHANNEL_ID = /^[CG][A-Z0-9]{6,}$/;

/** Whether text looks like a Slack channel ID. */
export const isChannelId = (text: string): boolean => CHANNEL_ID.test(text.trim());

/** The channel ID tidied for saving: spaces dropped, upper case. */
export const tidyChannelId = (text: string): string => text.trim().toUpperCase();

/**
 * What is wrong with the chat settings, in plain words, or "" when they can be saved.
 * A channel is only required when chat is switched on.
 */
export function chatProblem(enabled: boolean, channel: string): string {
  if (!enabled) return "";
  const id = tidyChannelId(channel);
  if (!id) return "Enter the Slack channel ID to turn team chat on.";
  if (!isChannelId(id)) return "That is not a channel ID. It starts with C or G, such as C0123ABCD. In Slack: right-click the channel, View channel details, and copy the ID at the bottom.";
  return "";
}
