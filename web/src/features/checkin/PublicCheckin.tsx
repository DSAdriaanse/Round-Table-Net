import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Radio, Users } from "lucide-react";
import { publicCheckIn, publicNets, publicSession } from "@/api";
import type { PublicNet, PublicSession } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const POLL_MS = 5000;
const EMPTY_FORM = { callsign: "", name: "", location: "", comment: "" };

// THE PUBLIC CHECK-IN PAGE. No sign-in. Talks only to the three /api/rt/public routes.
// It refreshes the list by polling every few seconds (the public cannot subscribe to
// the database, by design).
export default function PublicCheckin() {
  const netIdParam = new URLSearchParams(window.location.search).get("net_id") || "";
  const [nets, setNets] = useState<PublicNet[]>([]);
  const [netId, setNetId] = useState(netIdParam);
  const [data, setData] = useState<PublicSession | null>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<"success" | "already" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    publicNets().then(setNets, () => setLoadError("Could not load the list of nets."));
  }, []);

  const load = useCallback(async () => {
    if (!netId) return;
    try {
      setData(await publicSession(netId));
      setLoadError("");
    } catch {
      setLoadError("Could not reach the server. Retrying...");
    }
  }, [netId]);

  useEffect(() => {
    setData(null);
    if (!netId) return;
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [netId, load]);

  const selectNet = (id: string) => { setNetId(id); setStatus(null); setError(""); };

  const session = data?.session ?? null;
  const net = data?.net;
  const heard = (data?.check_ins ?? []).filter((c) => c.status !== "not_heard");

  const submit = async () => {
    if (!form.callsign.trim() || !netId) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await publicCheckIn({ net_id: netId, ...form, callsign: form.callsign.trim().toUpperCase() });
      if (result === "checked_in") { setStatus("success"); setForm(EMPTY_FORM); }
      else if (result === "already") setStatus("already");
      else { setData((d) => (d ? { ...d, session: null } : d)); }
      load();
    } catch (err) {
      setError((err as Error).message || "Check-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4">
      <div className="max-w-lg mx-auto pt-8">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <div className="bg-green-500/20 rounded-full p-3"><Radio className="w-10 h-10 text-green-400" /></div>
          </div>
          <h1 className="text-3xl font-bold mb-2">Net Check-In</h1>
          <p className="text-gray-400">Check in to the current net session</p>
        </div>

        {loadError && <p role="alert" className="text-yellow-400 text-sm text-center mb-4">{loadError}</p>}

        {!netIdParam && (
          <div className="mb-6 space-y-2">
            <p className="text-gray-400 text-sm">Select a net:</p>
            {nets.map((n) => (
              <button key={n.id} onClick={() => selectNet(n.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${netId === n.id ? "border-green-500 bg-green-900/30" : "border-gray-700 bg-gray-900 hover:border-gray-500"}`}>
                <span className="font-medium text-white">{n.name}</span>
                <span className="text-gray-400 text-sm ml-2">{n.day_of_week}s at {n.time}</span>
                {n.is_live && <span className="ml-2 text-green-400 text-xs">● live</span>}
              </button>
            ))}
          </div>
        )}

        {data && !session && (
          <Card className="bg-gray-900 border-gray-700">
            <CardContent className="text-center py-12">
              <AlertCircle className="w-10 h-10 text-yellow-400 mx-auto mb-3" />
              <p className="text-white font-medium">No open session for {net?.name}</p>
              <p className="text-gray-400 text-sm mt-1">The NCO has not opened a session yet. Check back soon.</p>
            </CardContent>
          </Card>
        )}

        {session && status === "success" && (
          <Card className="bg-green-900/30 border-green-700">
            <CardContent className="text-center py-12">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <p className="text-white text-xl font-bold">You're checked in!</p>
              <p className="text-gray-400 mt-1">Thank you for joining {net?.name}.</p>
            </CardContent>
          </Card>
        )}

        {session && status === "already" && (
          <Card className="bg-yellow-900/30 border-yellow-700">
            <CardContent className="text-center py-12">
              <AlertCircle className="w-10 h-10 text-yellow-400 mx-auto mb-3" />
              <p className="text-white font-medium">Already checked in</p>
              <p className="text-gray-400 text-sm mt-1">That callsign has already checked in this session.</p>
              <Button variant="ghost" className="mt-3 text-gray-300" onClick={() => setStatus(null)}>Try again</Button>
            </CardContent>
          </Card>
        )}

        {session && !status && (
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <span className="text-green-400 animate-pulse">●</span>{net?.name} — Live Session
              </CardTitle>
              <p className="text-gray-400 text-sm">{heard.length} stations checked in so far</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="pc-callsign">Your Callsign *</Label>
                <Input id="pc-callsign" value={form.callsign} onChange={(e) => setForm({ ...form, callsign: e.target.value.toUpperCase() })} placeholder="W1AW" className="bg-gray-800 border-gray-600 text-white font-mono text-xl mt-1" maxLength={8} />
              </div>
              <div>
                <Label htmlFor="pc-name">Your Name</Label>
                <Input id="pc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Optional" className="bg-gray-800 border-gray-600 text-white mt-1" />
              </div>
              <div>
                <Label htmlFor="pc-location">Location</Label>
                <Input id="pc-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, State (Optional)" className="bg-gray-800 border-gray-600 text-white mt-1" />
              </div>
              <div>
                <Label htmlFor="pc-comment">Comment</Label>
                <Textarea id="pc-comment" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} placeholder="Optional message for the NCO" rows={2} className="bg-gray-800 border-gray-600 text-white mt-1" />
              </div>
              {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
              <Button onClick={submit} disabled={submitting || !form.callsign.trim()} className="w-full bg-green-600 hover:bg-green-700 text-white text-lg py-6">
                <Radio className="w-5 h-5 mr-2" />{submitting ? "Checking in..." : "Check In to Net"}
              </Button>
            </CardContent>
          </Card>
        )}

        {session && heard.length > 0 && (
          <Card className="bg-gray-900 border-gray-700 mt-4">
            <CardHeader>
              <CardTitle className="text-gray-400 text-sm flex items-center gap-2"><Users className="w-4 h-4" />Checked In Stations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {heard.map((c) => (
                  <div key={c.callsign} className="flex gap-3 text-sm">
                    <span className="font-mono text-green-400 w-24">{c.callsign}</span>
                    <span className="text-gray-400 capitalize">{c.status.replace("_", " ")}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
