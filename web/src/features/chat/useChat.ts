import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { findOpenSession, listChatMessages, sendChatMessage, watchChatMessages, watchSessions } from "@/api";
import type { ChatMessage } from "@/api";
import { dropMessage, mergeMessage, newestDate, unreadCount } from "@/lib/chatState";

// Browser storage can be blocked or full; the chat must work without it.
const read = (key: string) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } };

/** The session this net is running right now, kept current by live updates. */
export function useOpenSession(netId: string | undefined) {
  const queryClient = useQueryClient();
  const key = ["open-session", netId];
  useEffect(() => {
    if (!netId) return;
    return watchSessions((event) => {
      if (event.data?.net_id === netId) queryClient.invalidateQueries({ queryKey: ["open-session", netId] });
    });
  }, [netId, queryClient]);
  return useQuery({ queryKey: key, queryFn: () => findOpenSession(netId!), enabled: !!netId, staleTime: 30000,
    // A safety net for a session opened in the moment before the live connection is ready.
    refetchInterval: 20000 });
}

/** Whether chat sound/badge is muted. Remembered in this browser, for every net. */
export function useMuted(): [boolean, (muted: boolean) => void] {
  const [muted, setMuted] = useState(() => read("chatMuted") === "1");
  return [muted, (value) => { setMuted(value); write("chatMuted", value ? "1" : ""); }];
}

/**
 * The messages of one session's thread, live, plus how many arrived since the operator last looked.
 * `visible` says whether the panel is open: while it is, everything counts as seen.
 */
export function useChat(sessionId: string | undefined, visible: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const seenKey = `chatSeen:${sessionId}`;
  const [seenAt, setSeenAt] = useState(() => read(seenKey));

  useEffect(() => {
    setMessages([]);
    setLoaded(false);
    setSeenAt(read(seenKey));
    if (!sessionId) return;
    let alive = true;
    listChatMessages(sessionId).then((rows) => {
      if (!alive) return;
      // Keep anything that arrived live while the list was loading.
      setMessages((now) => rows.reduce((acc, r) => mergeMessage(acc, r), now));
      setLoaded(true);
    }, () => alive && setLoaded(true));
    const stop = watchChatMessages((event) => {
      if (event.data?.session_id !== sessionId) return;
      setMessages((now) => (event.type === "delete" ? dropMessage(now, event.id) : mergeMessage(now, event.data)));
    });
    return () => { alive = false; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // While the panel is open, whatever is there has been seen.
  useEffect(() => {
    if (!sessionId || !visible || !loaded) return;
    const next = newestDate(messages, seenAt);
    if (next !== seenAt) { setSeenAt(next); write(seenKey, next); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, visible, loaded, sessionId]);

  const send = useCallback((text: string) => sendChatMessage(sessionId!, text), [sessionId]);
  return { messages, loaded, unread: visible ? 0 : unreadCount(messages, seenAt), send };
}
