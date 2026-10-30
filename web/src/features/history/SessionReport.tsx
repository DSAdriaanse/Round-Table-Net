import { useEffect, useState } from "react";
import { AlertCircle, Calendar, CheckCircle, ExternalLink, FileText, Loader2, Radio, User } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getNet, getSession, listCheckIns, listStations, publishReport } from "@/api";
import type { CheckIn, Net, NetSession } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sessionDate } from "./SessionHistory";

const STATUS_COLORS: Record<string, string> = {
  checked_in: "bg-green-800 text-green-200",
  short_time: "bg-yellow-800 text-yellow-200",
  early: "bg-purple-800 text-purple-200",
  not_heard: "bg-gray-700 text-gray-400",
  guest: "bg-orange-800 text-orange-200",
};

// A check-in with its name and place filled in from the roster when the check-in lacks them.
type Row = CheckIn;

// The report for one session: header, attendance table, and the WordPress publish button.
// Address: /session-report?session_id=...  (the old /SessionReport?session_id=... still works).
export default function SessionReport() {
  const sessionId = new URLSearchParams(window.location.search).get("session_id");
  const [session, setSession] = useState<NetSession | null>(null);
  const [net, setNet] = useState<Net | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ ok: true; url: string } | { ok: false; error: string } | null>(null);

  useEffect(() => {
    if (!sessionId) { setLoading(false); return; }
    (async () => {
      try {
        const s = await getSession(sessionId);
        setSession(s);
        const [n, ci, stations] = await Promise.all([getNet(s.net_id).catch(() => null), listCheckIns(sessionId), listStations(s.net_id)]);
        setNet(n);
        const byCall = new Map(stations.map((st) => [st.callsign, st]));
        setRows(ci.map((c) => {
          const st = byCall.get(c.callsign);
          return {
            ...c,
            name: c.name || st?.name || "",
            location: c.location || (st?.city && st?.state ? `${st.city}, ${st.state}` : ""),
          };
        }).sort((a, b) => a.callsign.localeCompare(b.callsign)));
      } catch {
        setSession(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  const center = "flex-1 bg-gray-950 text-white flex items-center justify-center";
  if (loading) return <div className={center}><p className="text-gray-400">Loading report...</p></div>;
  if (!session) return <div className={center}><p className="text-gray-400">Session not found.</p></div>;

  const attended = rows.filter((c) => c.status !== "not_heard");
  const notHeard = rows.filter((c) => c.status === "not_heard");

  const publish = async () => {
    setPublishing(true);
    setResult(null);
    try {
      const res = await publishReport(session.id);
      setResult({ ok: true, url: res.post_url });
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message || "Failed to publish" });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="bg-gray-950 text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-end gap-3 mb-4 flex-wrap">
          {result?.ok && (
            <span className="flex items-center gap-2 text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" />Published
              <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:underline">View post <ExternalLink className="w-3 h-3" /></a>
            </span>
          )}
          {result && !result.ok && (
            <span role="alert" className="flex items-center gap-2 text-red-400 text-sm max-w-md"><AlertCircle className="w-4 h-4 shrink-0" />{result.error}</span>
          )}
          <Button onClick={publish} disabled={publishing} className="bg-blue-600 hover:bg-blue-700 text-white">
            {publishing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Publishing...</> : <><FileText className="w-4 h-4 mr-2" />Publish to WordPress</>}
          </Button>
        </div>

        <Card className="bg-gray-900 border-gray-700 mb-6">
          <CardHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-green-900/30 rounded-lg p-2"><Radio className="w-6 h-6 text-green-400" /></div>
              <div>
                <CardTitle className="text-white text-xl">{session.net_name || net?.name || "Net Session"}</CardTitle>
                <p className="text-gray-400 text-sm mt-0.5">Session Report</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wide mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" />Date</div>
              <div className="text-white font-medium">{sessionDate(session, "MMMM d, yyyy")}</div>
              {session.opened_at && <div className="text-blue-400 text-xs mt-0.5">Opened: {format(parseISO(session.opened_at), "h:mm a")}</div>}
              {session.closed_at && <div className="text-gray-400 text-xs">Closed: {format(parseISO(session.closed_at), "h:mm a")}</div>}
            </div>
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wide mb-1 flex items-center gap-1"><User className="w-3 h-3" />Net Control Operator</div>
              <div className="text-green-400 font-mono font-bold">{session.nco_callsign || "—"}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wide mb-1">Check-Ins</div>
              <div className="text-white font-bold text-xl">{attended.length}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wide mb-1">Not Heard</div>
              <div className="text-gray-400 font-bold text-xl">{notHeard.length}</div>
            </div>
          </CardContent>
        </Card>

        {(session.topic || session.notes || session.technical_difficulty) && (
          <Card className="bg-gray-900 border-gray-700 mb-6">
            <CardContent className="py-4 space-y-2">
              {session.topic && <p className="text-yellow-300 text-sm"><span className="text-gray-400">Topic:</span> {session.topic}</p>}
              {session.technical_difficulty && <p className="text-orange-400 text-sm font-medium">⚠ Technical Difficulty — Absences not updated</p>}
              {session.notes && <p className="text-gray-400 text-sm">{session.notes}</p>}
            </CardContent>
          </Card>
        )}

        <Card className="bg-gray-900 border-gray-700 mb-6">
          <CardHeader><CardTitle className="text-white text-base">Check-Ins ({attended.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left text-gray-400 font-medium px-4 py-3">Callsign</th>
                    <th className="text-left text-gray-400 font-medium px-4 py-3">Name</th>
                    <th className="text-left text-gray-400 font-medium px-4 py-3">Location</th>
                    <th className="text-left text-gray-400 font-medium px-4 py-3">Comment</th>
                    <th className="text-left text-gray-400 font-medium px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {attended.map((c) => (
                    <tr key={c.id} className="border-b border-gray-800 hover:bg-gray-800/30">
                      <td className="px-4 py-2.5 font-mono font-bold text-green-400">{c.callsign}</td>
                      <td className="px-4 py-2.5 text-white">{c.name || "—"}</td>
                      <td className="px-4 py-2.5 text-gray-300">{c.location || "—"}</td>
                      <td className="px-4 py-2.5 text-gray-400 italic text-xs">{c.comment}</td>
                      <td className="px-4 py-2.5"><Badge className={`text-xs ${STATUS_COLORS[c.status] || "bg-gray-700 text-gray-300"}`}>{c.status.replace("_", " ")}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {notHeard.length > 0 && (
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader><CardTitle className="text-gray-400 text-base">Not Heard ({notHeard.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {notHeard.map((c) => <span key={c.id} className="font-mono text-gray-500 text-sm bg-gray-800 px-3 py-1 rounded">{c.callsign}</span>)}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
