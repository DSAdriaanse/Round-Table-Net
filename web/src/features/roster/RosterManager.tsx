import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckSquare, ClipboardPaste, MapPin, Pencil, Plus, Search, Trash2, Users, XSquare } from "lucide-react";
import { GEOCODE_DELAY_MS, createStation, deleteStation, deleteStations, geocode, isDuplicateStation, updateStation } from "@/api";
import type { Station } from "@/api";
import { useNet } from "@/components/NetContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAllStations } from "@/hooks/useNetData";
import { isInactive } from "@/lib/stationState";
import { toast } from "@/lib/toast";
import BulkImportDialog from "./BulkImportDialog";

type Form = Pick<Station, "callsign" | "name" | "city" | "state" | "permanent_attendance" | "active" | "needs_review">;
const EMPTY: Form = { callsign: "", name: "", city: "", state: "", permanent_attendance: false, active: true, needs_review: false };

function StationBadges({ s, short }: { s: Station; short?: boolean }) {
  const inactive = isInactive(s);
  return (
    <div className="flex gap-1 flex-wrap">
      {s.permanent_attendance && <Badge className="bg-blue-800 text-blue-200 text-xs">{short ? "Perm" : "Permanent"}</Badge>}
      {s.needs_review && <Badge className="bg-orange-800 text-orange-200 text-xs">Guest</Badge>}
      {inactive && <Badge className="bg-red-900 text-red-300 text-xs">Inactive</Badge>}
    </div>
  );
}

// The roster: add, edit, remove, bulk import, bulk delete, and fill in map coordinates.
export default function RosterManager() {
  const { selectedNet } = useNet();
  const queryClient = useQueryClient();
  const { data: all = [], isLoading } = useAllStations(selectedNet);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "guests">("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const stations = useMemo(() => [...all].sort((a, b) => {
    const sa = (a.state || "").toUpperCase();
    const sb = (b.state || "").toUpperCase();
    return sa !== sb ? sa.localeCompare(sb) : a.callsign.localeCompare(b.callsign);
  }), [all]);
  const existing = useMemo(() => new Set(stations.map((s) => s.callsign.toUpperCase())), [stations]);
  const reload = () => queryClient.invalidateQueries({ queryKey: ["stations"] });

  const filtered = stations
    .filter((s) => !search || s.callsign.includes(search))
    .filter((s) => (filter === "guests" ? s.needs_review : true));

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} station(s) from the roster? This cannot be undone.`)) return;
    try {
      await deleteStations([...selected]);
      setSelected(new Set());
      setBulkMode(false);
    } catch (e) { toast.error(`Delete failed: ${(e as Error).message}`); }
    reload();
  };

  const geocodeAll = async () => {
    const missing = stations.filter((s) => s.city && s.city !== "-" && s.state && (!s.lat || !s.lng));
    if (missing.length === 0) { toast.info("All geocodable stations already have coordinates."); return; }
    if (!window.confirm(`Look up map coordinates for ${missing.length} stations? This takes about ${Math.ceil((missing.length * GEOCODE_DELAY_MS) / 1000)} seconds.`)) return;
    setBusy(true);
    let found = 0;
    for (const s of missing) {
      const pos = await geocode(s.city, s.state);
      if (pos) { await updateStation(s.id, pos).catch(() => {}); found++; }
      await new Promise((r) => setTimeout(r, GEOCODE_DELAY_MS)); // the service allows one request a second
    }
    setBusy(false);
    toast.success(`Found coordinates for ${found} of ${missing.length} stations.`);
    reload();
  };

  const openNew = () => { setForm(EMPTY); setEditing(null); setOpen(true); };
  const openEdit = (s: Station) => {
    setForm({ callsign: s.callsign, name: s.name, city: s.city, state: s.state, permanent_attendance: s.permanent_attendance, active: s.active, needs_review: s.needs_review });
    setEditing(s);
    setOpen(true);
  };

  const save = async () => {
    const callsign = form.callsign.trim().toUpperCase();
    if (!callsign || !form.name.trim()) return toast.error("A station needs a callsign and a name.");
    // A callsign that is already on this net's roster cannot be added again. If it is there but inactive,
    // offer to bring it back instead of failing.
    const already = !editing ? all.find((s) => s.callsign.toUpperCase() === callsign) : undefined;
    if (already) {
      if (!isInactive(already)) return toast.error(`${callsign} is already on this net's roster.`);
      if (!window.confirm(`${callsign} (${already.name}) is already on this net's roster but is inactive. Make them active again?`)) return;
      setBusy(true);
      try {
        await updateStation(already.id, { active: true, consecutive_absences: 0 });
        toast.success(`${callsign} is active again.`);
        setOpen(false);
        reload();
      } catch (e) {
        toast.error(`Could not reactivate ${callsign}: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      const data: Partial<Station> = { ...form, callsign, name: form.name.trim() };
      // Only look the place up again when it changed or has no coordinates yet.
      const placeChanged = !editing || editing.city !== form.city || editing.state !== form.state || !editing.lat || !editing.lng;
      if (placeChanged) {
        const pos = await geocode(form.city, form.state);
        data.lat = pos?.lat ?? 0;
        data.lng = pos?.lng ?? 0;
      }
      if (editing) await updateStation(editing.id, data);
      else await createStation({ ...data, net_id: selectedNet, consecutive_absences: 0 });
      setOpen(false);
      reload();
    } catch (e) {
      toast.error(isDuplicateStation(e) ? `${callsign} is already on this net's roster.` : `Could not save the station: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Station) => {
    if (!window.confirm(`Remove ${s.callsign} from roster?`)) return;
    try { await deleteStation(s.id); reload(); } catch (e) { toast.error(`Could not remove: ${(e as Error).message}`); }
  };

  const Actions = ({ s }: { s: Station }) => (
    <div className="flex gap-1 justify-end">
      <Button variant="ghost" size="icon" aria-label={`Edit ${s.callsign}`} onClick={() => openEdit(s)} className="text-gray-400 hover:text-white h-7 w-7"><Pencil className="w-3.5 h-3.5" /></Button>
      <Button variant="ghost" size="icon" aria-label={`Remove ${s.callsign}`} onClick={() => remove(s)} className="text-gray-400 hover:text-red-400 h-7 w-7"><Trash2 className="w-3.5 h-3.5" /></Button>
    </div>
  );

  const rowFor = (s: Station, flat: boolean) => {
    const dim = isInactive(s) ? "opacity-50" : "";
    return (
      <tr key={s.id} className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/40 ${dim}`}>
        {bulkMode && <td className="px-3 sm:px-4 py-2.5 w-10"><Checkbox aria-label={`Select ${s.callsign}`} checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} /></td>}
        <td className="px-3 sm:px-4 py-2.5 font-mono font-bold text-green-400">{s.callsign}</td>
        <td className="px-3 sm:px-4 py-2.5 text-white">{s.name}</td>
        <td className="px-4 py-2.5 text-gray-400 hidden md:table-cell">{s.city || "—"}{flat && s.state ? `, ${s.state}` : ""}</td>
        <td className="px-4 py-2.5 text-gray-400 hidden sm:table-cell whitespace-nowrap">{s.consecutive_absences || 0} abs</td>
        <td className="px-3 sm:px-4 py-2.5"><StationBadges s={s} short /></td>
        <td className="px-2 sm:px-4 py-2.5"><Actions s={s} /></td>
      </tr>
    );
  };

  const groups = filtered.reduce<Record<string, Station[]>>((acc, s) => { (acc[s.state || "—"] ||= []).push(s); return acc; }, {});

  return (
    <div className="bg-gray-950 text-white p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Users className="w-6 h-6 text-green-400" />
          <h1 className="text-2xl font-bold">Station Roster</h1>
        </div>

        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="flex gap-1">
            <Button size="sm" onClick={() => setFilter("all")} className={`h-8 px-3 text-xs ${filter === "all" ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}>All</Button>
            <Button size="sm" onClick={() => setFilter("guests")} className={`h-8 px-3 text-xs ${filter === "guests" ? "bg-orange-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}>Guests Only</Button>
          </div>
          <div className="relative flex-1 min-w-40 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())} placeholder="Search callsign..." aria-label="Search callsign" className="bg-gray-800 border-gray-600 text-white pl-9" />
          </div>
          <Button onClick={geocodeAll} disabled={busy} className="bg-blue-700 hover:bg-blue-800"><MapPin className="w-4 h-4 mr-2" />{busy ? "Working..." : "Geocode Missing"}</Button>
          <Button onClick={() => setShowImport(true)} variant="outline" className="bg-gray-800 border-gray-600 text-white hover:bg-gray-700"><ClipboardPaste className="w-4 h-4 mr-2" />Bulk Import</Button>
          <Button onClick={() => { setBulkMode((b) => !b); setSelected(new Set()); }} variant="outline" className={`border-gray-600 text-white hover:bg-gray-700 ${bulkMode ? "bg-red-800 border-red-600" : "bg-gray-800"}`}><Trash2 className="w-4 h-4 mr-2" />{bulkMode ? "Cancel Bulk" : "Bulk Edit"}</Button>
          <Button onClick={openNew} disabled={!selectedNet} className="bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4 mr-2" />Add Station</Button>
        </div>

        {bulkMode && (
          <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 flex-wrap">
            <span className="text-red-300 text-sm font-medium">{selected.size} selected</span>
            <Button size="sm" onClick={() => setSelected(new Set(filtered.map((s) => s.id)))} className="bg-gray-700 hover:bg-gray-600 text-white h-8"><CheckSquare className="w-3.5 h-3.5 mr-1" />Select All Visible</Button>
            <Button size="sm" onClick={() => setSelected(new Set())} variant="ghost" className="text-gray-300 hover:text-white h-8"><XSquare className="w-3.5 h-3.5 mr-1" />Clear</Button>
            <div className="flex-1" />
            <Button size="sm" onClick={bulkDelete} disabled={selected.size === 0} className="bg-red-600 hover:bg-red-700 text-white h-8"><Trash2 className="w-3.5 h-3.5 mr-1" />Delete Selected</Button>
          </div>
        )}

        {isLoading ? (
          <p className="text-center text-gray-500 py-12">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-500 py-12">{stations.length === 0 ? "No stations on roster. Add one to get started." : "No stations match your search."}</div>
        ) : search ? (
          <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm"><tbody>{filtered.map((s) => rowFor(s, true))}</tbody></table>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.keys(groups).sort().map((state) => (
              <div key={state} className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-gray-800/60 border-b border-gray-700">
                  <span className="text-blue-400 font-bold text-xs uppercase tracking-widest">{state}</span>
                  <span className="text-gray-500 text-xs ml-2">({groups[state].length})</span>
                </div>
                <table className="w-full text-sm"><tbody>{groups[state].map((s) => rowFor(s, false))}</tbody></table>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white">
          <DialogHeader><DialogTitle>{editing ? "Edit Station" : "Add Station"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label htmlFor="st-call">Callsign</Label><Input id="st-call" value={form.callsign} onChange={(e) => setForm({ ...form, callsign: e.target.value.toUpperCase() })} className="bg-gray-800 border-gray-600 text-white mt-1 font-mono" /></div>
              <div><Label htmlFor="st-name">Name</Label><Input id="st-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label htmlFor="st-city">City</Label><Input id="st-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
              <div><Label htmlFor="st-state">State</Label><Input id="st-state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} className="bg-gray-800 border-gray-600 text-white mt-1 uppercase" /></div>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="st-perm" checked={form.permanent_attendance} onCheckedChange={(v) => setForm({ ...form, permanent_attendance: v })} />
              <Label htmlFor="st-perm">Permanent Attendance (never auto-drop)</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="st-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label htmlFor="st-active">Active on Roster</Label>
            </div>
            {form.needs_review && (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-orange-700 bg-orange-900/20">
                <Switch id="st-review" checked={!form.needs_review} onCheckedChange={(v) => setForm({ ...form, needs_review: !v })} />
                <Label htmlFor="st-review" className="text-orange-300">Guest — pending review (toggle to approve as roster member)</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} className="text-gray-400">Cancel</Button>
            <Button onClick={save} className="bg-green-600 hover:bg-green-700" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImportDialog open={showImport} onOpenChange={setShowImport} netId={selectedNet} existingCallsigns={existing} onImported={reload} />
    </div>
  );
}
