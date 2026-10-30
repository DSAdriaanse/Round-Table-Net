import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, LogOut, Pencil, Plus, Radio, X } from "lucide-react";
import { deleteSession, findOpenSession, openSession as createSession, updateSession } from "@/api";
import type { NetSession } from "@/api";
import { useNet } from "@/components/NetContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveRoster, useSessionCheckIns } from "@/hooks/useNetData";
import { toast } from "@/lib/toast";
import AnnouncementsPanel from "./AnnouncementsPanel";
import CloseSessionPanel from "./CloseSessionPanel";
import PileupLogger from "./PileupLogger";
import NetClock from "./NetClock";
import SessionDashboard from "./SessionDashboard";
import StandardRoll from "./StandardRoll";

// The topic pill on a running session: click to change it.
function TopicEditor({ session, onUpdated }: { session: NetSession; onUpdated: (s: NetSession) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(session.topic || "");

  const save = async () => {
    try {
      const updated = await updateSession(session.id, { topic: value.trim() });
      onUpdated(updated);
      setEditing(false);
      toast.success("Topic updated");
    } catch (err) {
      toast.error(`Could not update the topic: ${(err as Error).message}`);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          placeholder="Topic..."
          aria-label="Topic"
          className="bg-gray-800 border-gray-600 text-white text-sm h-8 w-64 max-w-full"
          autoFocus
        />
        <button onClick={save} aria-label="Save topic" className="text-green-400 hover:text-green-300"><Check className="w-4 h-4" /></button>
        <button onClick={() => setEditing(false)} aria-label="Cancel" className="text-gray-500 hover:text-gray-300"><X className="w-4 h-4" /></button>
      </div>
    );
  }

  return (
    <button
      onClick={() => { setValue(session.topic || ""); setEditing(true); }}
      className="flex items-center gap-2 text-yellow-300 text-sm font-medium bg-yellow-900/30 border border-yellow-800 px-3 py-1 rounded-lg hover:bg-yellow-900/50 transition-colors"
    >
      📡 {session.topic ? `Topic: ${session.topic}` : "Add Topic"}
      <Pencil className="w-3 h-3 opacity-70" />
    </button>
  );
}

// THE NET CONTROL SCREEN. With no session running it asks for the operator's callsign and
// opens one; with one running it shows the counters and four tabs (Opening, Pileup Logger,
// Standard Roll, Close Session). Follow a check-in through: StandardRoll.setStatus ->
// api/checkIns.ts -> collection "check_ins" -> live update back into useSessionCheckIns.
export default function NetControl() {
  const { nets, selectedNet } = useNet();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<NetSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("announcements");
  const tabsRef = useRef<HTMLDivElement>(null);
  const [ncoCallsign, setNcoCallsign] = useState("");
  const [topic, setTopic] = useState("");

  // Shared caches: one copy for every tab and every operator on this net.
  const { data: rosterStations = [] } = useActiveRoster(selectedNet);
  const { data: checkIns = [] } = useSessionCheckIns(session?.id);

  useEffect(() => {
    if (!selectedNet) return;
    findOpenSession(selectedNet).then(setSession, () => setSession(null));
  }, [selectedNet]);

  const net = nets.find((n) => n.id === selectedNet);

  const openSession = async () => {
    if (!ncoCallsign.trim()) return toast.error("Enter NCO callsign first");
    setLoading(true);
    try {
      const s = await createSession({ net_id: selectedNet, net_name: net?.name || "", nco_callsign: ncoCallsign.trim().toUpperCase(), topic: topic.trim() });
      setSession(s);
      queryClient.invalidateQueries({ queryKey: ["checkins", s.id] });
    } catch (err) {
      toast.error(`Failed to open session: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // A slow safety-net refresh on top of the live updates, in case a connection dropped.
  // Every new session starts on the Opening tab.
  useEffect(() => { setTab("announcements"); }, [session?.id]);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshCheckIns = () => {
    if (!session) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => queryClient.invalidateQueries({ queryKey: ["checkins", session.id] }), 2000);
  };

  const handleSessionClosed = () => {
    if (session) queryClient.invalidateQueries({ queryKey: ["checkins", session.id] });
    queryClient.invalidateQueries({ queryKey: ["stations", "active", selectedNet] });
    queryClient.invalidateQueries({ queryKey: ["stations", "all", selectedNet] });
    setSession(null);
  };

  // Abandon a session: deletes it and its check-ins (the server cascades), leaving the
  // roster and the history alone. For testing and training only. The confirmation (typing
  // CANCEL when there are check-ins) is the dialog in the Close Session tab; this only
  // does the delete and reports whether it worked.
  const cancelSession = async (): Promise<boolean> => {
    if (!session) return false;
    try {
      await deleteSession(session.id);
      queryClient.removeQueries({ queryKey: ["checkins", session.id] });
      setSession(null);
      toast.success("Session discarded — not recorded");
      return true;
    } catch (err) {
      toast.error(`Failed to discard session: ${(err as Error).message}`);
      return false;
    }
  };

  // The header's Close Session button: jump to the Close tab, where the confirmation lives.
  const goToClose = () => {
    setTab("close");
    tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Radio className="w-6 h-6 text-green-400" />
          <h1 className="text-xl sm:text-2xl font-bold">Round Table Net Control{net ? ` — ${net.name}` : ""}</h1>
        </div>

        <div className="flex items-end gap-4 mb-6 flex-wrap">
          <NetClock />
          {!session && (
            <>
              <div>
                <Label className="text-gray-400" htmlFor="nco-callsign">NCO Callsign</Label>
                <Input id="nco-callsign" value={ncoCallsign} onChange={(e) => setNcoCallsign(e.target.value.toUpperCase())} placeholder="W1AW" className="bg-gray-900 border-gray-700 text-white mt-1 font-mono w-36" />
              </div>
              <div className="flex-1 min-w-48">
                <Label className="text-gray-400" htmlFor="session-topic">Today's Topic</Label>
                <Input id="session-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Optional topic or discussion subject..." className="bg-gray-900 border-gray-700 text-white mt-1 w-full" />
              </div>
              <Button onClick={openSession} disabled={loading || !selectedNet} className="bg-green-600 hover:bg-green-700">
                <Plus className="w-4 h-4 mr-2" />Open Session
              </Button>
            </>
          )}

          {session && (
            <div className="flex items-center gap-3 sm:ml-auto sm:flex-1 sm:min-w-0 sm:justify-end flex-wrap">
              <TopicEditor session={session} onUpdated={setSession} />
              <span className="text-green-400 text-sm font-mono">Session Open — NCO: {session.nco_callsign}</span>
              <span className="bg-green-500/20 text-green-400 text-xs px-2 py-1 rounded-full animate-pulse">● LIVE</span>
              <Button onClick={goToClose} size="sm" className="bg-green-600 hover:bg-green-700 text-white h-8">
                <LogOut className="w-4 h-4 mr-1.5" />Close Session
              </Button>
            </div>
          )}
        </div>

        {session && selectedNet && (
          <>
            <SessionDashboard checkIns={checkIns} selectedNet={selectedNet} />

            <Tabs value={tab} onValueChange={setTab} ref={tabsRef} className="mt-6 scroll-mt-4">
              <TabsList className="bg-gray-900 border border-gray-700 h-auto flex-wrap justify-start">
                <TabsTrigger value="announcements" className="data-[state=active]:bg-purple-700 data-[state=active]:text-white text-gray-400">Opening</TabsTrigger>
                <TabsTrigger value="pileup" className="data-[state=active]:bg-yellow-700 data-[state=active]:text-white text-gray-400">Pileup Logger</TabsTrigger>
                <TabsTrigger value="roll" className="data-[state=active]:bg-green-700 data-[state=active]:text-white text-gray-400">Standard Roll</TabsTrigger>
                <TabsTrigger value="close" className="data-[state=active]:bg-green-700 data-[state=active]:text-white text-gray-400">Close Session</TabsTrigger>
              </TabsList>

              {/* forceMount keeps half-typed pileup rows when the operator switches tabs */}
              <TabsContent value="pileup" forceMount className="data-[state=inactive]:hidden">
                <PileupLogger session={session} netId={selectedNet} onUpdate={refreshCheckIns} />
              </TabsContent>
              <TabsContent value="roll">
                <StandardRoll session={session} netId={selectedNet} checkIns={checkIns} onUpdate={refreshCheckIns} />
              </TabsContent>
              <TabsContent value="announcements">
                <AnnouncementsPanel net={net} session={session} />
              </TabsContent>
              <TabsContent value="close">
                <CloseSessionPanel session={session} net={net} checkIns={checkIns} rosterStations={rosterStations} onClose={handleSessionClosed} onDiscard={cancelSession} />
              </TabsContent>
            </Tabs>
          </>
        )}

        {!session && selectedNet && (
          <Card className="bg-gray-900 border-gray-700 mt-6">
            <CardContent className="text-center py-16 text-gray-500">
              <Radio className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg">No open session for this net.</p>
              <p className="text-sm mt-1">Enter your callsign and open a session to begin.</p>
            </CardContent>
          </Card>
        )}

        {!selectedNet && (
          <Card className="bg-gray-900 border-gray-700 mt-6">
            <CardContent className="text-center py-16 text-gray-500">
              <p className="text-lg">There are no nets yet.</p>
              <p className="text-sm mt-1">Add a net before starting a session.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
