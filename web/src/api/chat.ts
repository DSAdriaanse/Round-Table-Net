// Team chat through Slack: whether the server has Slack set up, and a test message for the Manage Nets screen.
import { get, post, table } from "./records";
import type { ChatMessage } from "./types";

/** Does the server have its Slack token and signing secret? Without them the chat switch stays off. */
export const getSlackStatus = () => get<{ configured: boolean }>("/api/rt/slack/status");

/** Post a test message to a channel. Rejects with the server's plain-words reason if Slack refuses. */
export const sendSlackTest = (channel: string) => post<{ ok: boolean }>("/api/rt/slack/test", { channel });

const messages = table<ChatMessage>("chat_messages");

/** Everything said so far in a session's thread, oldest first. */
export const listChatMessages = (sessionId: string) => messages.list({ sort: "created_date", where: { session_id: sessionId } });

/** Live chat messages from anyone (every session; filter by session_id in the callback). */
export const watchChatMessages = messages.watch;

/** Say something in the session's Slack thread. Rejects with the server's plain-words reason. */
export const sendChatMessage = (session_id: string, text: string) => post<{ ok: boolean; id: string }>("/api/rt/chat/send", { session_id, text });
