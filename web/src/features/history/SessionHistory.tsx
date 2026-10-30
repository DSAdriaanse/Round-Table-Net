import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ExternalLink, History, Pencil, Radio, Trash2 } from "lucide-react";
import { deleteSession, listSessions, updateSession } from "@/api";
import type { NetSession } from "@/api";
import { useNet } from "@/components/NetContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

// Turn a stored UTC time into the value a datetime-local input wants (the browser's own zone).
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function sessionDate(s: Pick<NetSession, "opened_at" | "date">, pattern: string): string {
  if (s.opened_at) return format(parseISO(s.opened_at), pattern);
  if (s.date) return format(new Date(`${s.date}T12:00:00`), pattern);
  return "Unknown date";
}

interface EditForm { date: string; nco_callsign: string; topic: string; notes: string; opened_at: string; closed_at: string }

// Past sessions of the selected net, with a link to each report.
export default function SessionHistory() {
  const { nets, selectedNet } = useNet();
  const [sessions, setSessions] = useState<NetSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<NetSession | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);

  useEffect(() => {
    if (!selectedNet) { setSessions([]); setLoading(false); return; }
    setLoading(true);
    listSessions(selectedNet, ["closed", "pending"]).then(
      (rows) => { setSessions(rows); setLoading(false); },
      (e) => { toast.error(`Could not load sessions: ${e.message}`); setLoading(false); },
    );
  }, [selectedNet]);

  const remove = async (s: NetSession) => {
    if (!window.confirm(`Delete session from ${s.net_name || "Unknown Net"} on ${s.date || s.opened_at?.slice(0, 10)}? Its check-ins are deleted too. This cannot be undone.`)) return;
    try {
      await deleteSession(s.id);
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) { toast.error(`Could not delete: ${(e as Error).message}`); }
  };

  const openEdit = (s: NetSession) => {
    setForm({ date: s.date || "", nco_callsign: s.nco_callsign || "", topic: s.topic || "", notes: s.notes || "", opened_at: toLocalInput(s.opened_at), closed_at: toLocalInput(s.closed_at) });
    setEditing(s);
  };

  const saveEdit = async () => {
    if (!editing || !form) return;
    const updates: Partial<NetSession> = { date: form.date, nco_callsign: form.nco_callsign.toUpperCase(), topic: form.topic, notes: form.notes };
    if (form.opened_at) updates.opened_at = new Date(form.opened_at).toISOString();
    if (form.closed_at) updates.closed_at = new Date(form.closed_at).toISOString();
    try {
      const saved = await updateSession(editing.id, updates);
      setSessions((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
      setEditing(null);
    } catch (e) { toast.error(`Could not save: ${(e as Error).message}`); }
  };

  const net = nets.find((n) => n.id === selectedNet);

  return (
    <div className="bg-gray-950 text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <History className="w-6 h-6 text-blue-400" />
          <h1 className="text-2xl font-bold">Session History</h1>
          {net && <span className="text-gray-400 text-sm">— {net.name}</span>}
        </div>

        {loading && <p className="text-gray-500">Loading sessions...</p>}

        {!loading && sessions.length === 0 && (
          <Card className="bg-gray-900 border-gray-700">
            <CardContent className="text-center py-16 text-gray-500">
              <History className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg">No sessions yet.</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {sessions.map((s) => (
            <Card key={s.id} className="bg-gray-900 border-gray-700">
              <CardContent className="flex items-center gap-3 sm:gap-4 py-4 flex-wrap sm:flex-nowrap">
                <div className="bg-blue-900/30 rounded-lg p-2 hidden sm:block"><Radio className="w-5 h-5 text-blue-400" /></div>
                <div className="flex-1 min-w-48">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white">{s.net_name || net?.name || "Unknown Net"}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "pending" ? "bg-yellow-900/30 text-yellow-400" : "bg-green-900/30 text-green-400"}`}>
                      {s.status === "pending" ? "Pending Processing" : "Closed"}
                    </span>
                  </div>
                  <div className="text-sm text-gray-400 mt-0.5">
                    {sessionDate(s, "EEEE, MMMM d, yyyy")}
                    {s.opened_at && <span className="ml-3 text-blue-400">{format(parseISO(s.opened_at), "h:mm a")}</span>}
                    {s.closed_at && <span className="ml-1 text-gray-500">→ {format(parseISO(s.closed_at), "h:mm a")}</span>}
                    {s.nco_callsign && <span className="ml-3">NCO: <span className="font-mono text-green-400">{s.nco_callsign}</span></span>}
                  </div>
                </div>
                <div className="text-right sm:mr-4">
                  <div className="text-2xl font-bold text-white">{s.checkin_count}</div>
                  <div className="text-xs text-gray-500">check-ins</div>
                </div>
                <Link to={`/session-report?session_id=${s.id}`}>
                  <Button size="sm" className="bg-blue-700 hover:bg-blue-600"><ExternalLink className="w-4 h-4 mr-1" />Report</Button>
                </Link>
                <Button size="sm" variant="ghost" aria-label="Edit session" onClick={() => openEdit(s)} className="text-gray-500 hover:text-white hover:bg-gray-800"><Pencil className="w-4 h-4" /></Button>
                <Button size="sm" variant="ghost" aria-label="Delete session" onClick={() => remove(s)} className="text-gray-500 hover:text-red-400 hover:bg-red-900/20"><Trash2 className="w-4 h-4" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-lg">
            <DialogHeader><DialogTitle>Edit Session</DialogTitle></DialogHeader>
            {form && (
              <div className="space-y-4">
                <div><Label htmlFor="es-date">Date</Label><Input id="es-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
                <div><Label htmlFor="es-nco">NCO Callsign</Label><Input id="es-nco" value={form.nco_callsign} onChange={(e) => setForm({ ...form, nco_callsign: e.target.value.toUpperCase() })} className="bg-gray-800 border-gray-600 text-white mt-1 font-mono" /></div>
                <div><Label htmlFor="es-topic">Topic</Label><Input id="es-topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><Label htmlFor="es-start">Start Time</Label><Input id="es-start" type="datetime-local" value={form.opened_at} onChange={(e) => setForm({ ...form, opened_at: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
                  <div><Label htmlFor="es-end">End Time</Label><Input id="es-end" type="datetime-local" value={form.closed_at} onChange={(e) => setForm({ ...form, closed_at: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
                </div>
                <div><Label htmlFor="es-notes">Notes</Label><Input id="es-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditing(null)} className="text-gray-400">Cancel</Button>
              <Button onClick={saveEdit} className="bg-green-600 hover:bg-green-700">Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
