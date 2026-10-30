// Team chat through Slack: whether the server has Slack set up, and a test message for the Manage Nets screen.
// (Sending and receiving chat messages is in the chat panel's own files.)
import { get, post } from "./records";

/** Does the server have its Slack token and signing secret? Without them the chat switch stays off. */
export const getSlackStatus = () => get<{ configured: boolean }>("/api/rt/slack/status");

/** Post a test message to a channel. Rejects with the server's plain-words reason if Slack refuses. */
export const sendSlackTest = (channel: string) => post<{ ok: boolean }>("/api/rt/slack/test", { channel });
