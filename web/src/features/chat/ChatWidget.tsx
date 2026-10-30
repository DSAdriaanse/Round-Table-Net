import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, MessageCircle, Send, X } from "lucide-react";
import { useNet } from "@/components/NetContext";
import { Button } from "@/components/ui/button";
import { badgeText, chatAvailable } from "@/lib/chatState";
import { toast } from "@/lib/toast";
import { useChat, useMuted, useOpenSession } from "./useChat";

// The "Chat with us" bubble: a corner button on every signed-in screen while the selected net has team chat
// turned on and a session is open. It opens a small panel for the session's Slack thread. Muting hides the
// unread badge and the pulse (messages still arrive and are there when the panel is opened).
export default function ChatWidget() {
  const { nets, selectedNet } = useNet();
  const net = nets.find((n) => n.id === selectedNet);
  const { data: session } = useOpenSession(net?.slack_enabled ? net.id : undefined);
  if (!chatAvailable(net, !!session) || !session || !net) return null;
  return <ChatPanel key={session.id} sessionId={session.id} netName={net.name} />;
}

const timeOf = (iso: string) => {
  const d = new Date(iso.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

function ChatPanel({ sessionId, netName }: { sessionId: string; netName: string }) {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useMuted();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const { messages, loaded, unread, send } = useChat(sessionId, open);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) end.current?.scrollIntoView?.({ block: "end" }); }, [open, messages.length]);
  useEffect(() => { if (open) box.current?.focus(); }, [open]);

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await send(body);
      setText("");
    } catch (e) {
      toast.error((e as Error).message); // the text stays in the box so it can be sent again
    } finally {
      setSending(false);
    }
  };

  const badge = muted ? "" : badgeText(unread);

  return (
    <div className="print:hidden fixed z-50 bottom-3 right-3 sm:bottom-4 sm:right-4 flex flex-col items-end gap-2">
      {open && (
        <section aria-label="Team chat" className="flex flex-col w-[22rem] max-w-[calc(100vw-1.5rem)] h-[26rem] max-h-[calc(100dvh-7rem)] rounded-xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden">
          <header className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-950">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white leading-tight">Team chat</p>
              <p className="text-xs text-gray-500 truncate">{netName} &middot; Slack thread</p>
            </div>
            <button type="button" onClick={() => setMuted(!muted)} aria-pressed={muted} aria-label={muted ? "Unmute chat notifications" : "Mute chat notifications"} title={muted ? "Muted: no badge for new messages" : "Mute"} className="text-gray-400 hover:text-white p-1.5 rounded">
              {muted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            </button>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="text-gray-400 hover:text-white p-1.5 rounded"><X className="w-4 h-4" /></button>
          </header>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" role="log" aria-live="polite" aria-label="Chat messages">
            {loaded && messages.length === 0 && <p className="text-sm text-gray-500 text-center pt-8 px-4">No messages yet. What you type here goes to the team in Slack, and their replies in the thread show up here.</p>}
            {messages.map((m) => {
              const mine = m.source === "nco";
              return (
                <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                  <p className="text-[11px] text-gray-500 px-1">{m.author || "Slack"} &middot; {timeOf(m.created_date)}</p>
                  <p className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words ${mine ? "bg-green-700 text-white rounded-br-sm" : "bg-gray-800 text-gray-100 rounded-bl-sm"}`}>{m.text}</p>
                </div>
              );
            })}
            <div ref={end} />
          </div>

          <form className="flex gap-2 p-2 border-t border-gray-800" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input ref={box} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Message the team" aria-label="Message the team" className="flex-1 min-w-0 rounded-md bg-gray-800 border border-gray-600 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-600" />
            <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label="Send message" className="bg-green-600 hover:bg-green-700 shrink-0"><Send className="w-4 h-4" /></Button>
          </form>
        </section>
      )}

      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label={badge ? `Open team chat, ${unread} new` : "Open team chat"} className={`relative flex items-center gap-2 rounded-full pl-4 pr-5 py-3 text-sm font-semibold text-white shadow-lg ${muted ? "bg-gray-700 hover:bg-gray-600" : "bg-green-600 hover:bg-green-700"} ${badge ? "animate-pulse" : ""}`}>
          {muted ? <BellOff className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
          <span className="hidden sm:inline">Chat with us</span>
          {badge && <span aria-hidden className="absolute -top-1.5 -right-1.5 min-w-[1.4rem] h-[1.4rem] px-1 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center border-2 border-gray-950">{badge}</span>}
        </button>
      )}
    </div>
  );
}
