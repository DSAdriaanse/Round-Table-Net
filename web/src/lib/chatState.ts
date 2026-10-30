// The logic behind the chat bubble, kept free of React so Node can test it (chatState.test.mjs).

export interface ChatLine { id: string; source: "nco" | "slack"; created_date: string }

/** Add or replace a message in a list kept oldest first. A message already there (by id) is replaced, not repeated. */
export function mergeMessage<T extends { id: string; created_date: string }>(list: T[], msg: T): T[] {
  const without = list.filter((m) => m.id !== msg.id);
  const next = [...without, msg];
  next.sort((a, b) => (a.created_date < b.created_date ? -1 : a.created_date > b.created_date ? 1 : a.id < b.id ? -1 : 1));
  return next;
}

/** Remove a message by id (a session being deleted takes its messages with it). */
export const dropMessage = <T extends { id: string }>(list: T[], id: string): T[] => list.filter((m) => m.id !== id);

/**
 * How many messages from the Slack side arrived after the operator last looked. Their own messages never count.
 * `seenAt` is the created_date of the newest message they have seen ("" = none yet).
 */
export function unreadCount(messages: ChatLine[], seenAt: string): number {
  return messages.filter((m) => m.source === "slack" && m.created_date > seenAt).length;
}

/** The created_date to remember once everything shown has been seen. */
export function newestDate(messages: ChatLine[], previous = ""): string {
  return messages.reduce((latest, m) => (m.created_date > latest ? m.created_date : latest), previous);
}

/** What the badge says: nothing for 0, the number up to 9, then "9+". */
export const badgeText = (count: number): string => (count <= 0 ? "" : count > 9 ? "9+" : String(count));

/** Whether the bubble is offered: the net has chat on and a session is open. */
export const chatAvailable = (net: { slack_enabled?: boolean } | undefined, hasOpenSession: boolean): boolean => !!net?.slack_enabled && hasOpenSession;
