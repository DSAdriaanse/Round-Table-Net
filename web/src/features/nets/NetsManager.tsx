import { useEffect, useState } from "react";
import { Pencil, Plus, Radio, Trash2 } from "lucide-react";
import { createNet, deleteNet, listNets, updateNet } from "@/api";
import type { DayOfWeek, Net } from "@/api";
import { useNet } from "@/components/NetContext";
import RichTextEditor from "@/components/RichTextEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";

const DAYS: DayOfWeek[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type Form = Pick<Net, "name" | "day_of_week" | "time" | "frequency" | "preamble" | "closing"> & { max_absences: string };
const EMPTY: Form = { name: "", day_of_week: "Monday", time: "", frequency: "", preamble: "", closing: "", max_absences: "3" };

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// Add, edit and delete nets, including the opening and closing scripts.
export default function NetsManager() {
  const { refreshNets } = useNet();
  const [nets, setNets] = useState<Net[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Net | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);

  const load = () => listNets().then(setNets, (e) => toast.error(`Could not load nets: ${e.message}`));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setEditing(null); setOpen(true); };
  const openEdit = (n: Net) => {
    setForm({ name: n.name, day_of_week: n.day_of_week, time: n.time, frequency: n.frequency, preamble: n.preamble, closing: n.closing, max_absences: String(n.max_absences ?? 3) });
    setEditing(n);
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.time.trim()) return toast.error("A net needs a name and a time.");
    const maxAbsences = Number(form.max_absences);
    if (form.max_absences.trim() === "" || !Number.isInteger(maxAbsences) || maxAbsences < 0 || maxAbsences > 52) {
      return toast.error("Absences before a station goes inactive must be a whole number from 0 to 52 (0 = never).");
    }
    const data = { ...form, max_absences: maxAbsences };
    try {
      if (editing) await updateNet(editing.id, data);
      else await createNet(data);
      setOpen(false);
      await load();
      refreshNets();
    } catch (e) {
      toast.error(`Could not save the net: ${(e as Error).message}`);
    }
  };

  const remove = async (n: Net) => {
    if (!window.confirm(`Delete net "${n.name}"? Its roster, sessions and check-ins are deleted too. This cannot be undone.`)) return;
    try {
      await deleteNet(n.id);
      await load();
      refreshNets();
    } catch (e) {
      toast.error(`Could not delete the net: ${(e as Error).message}`);
    }
  };

  return (
    <div className="bg-gray-950 text-white p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8 flex-wrap">
          <Radio className="w-6 h-6 text-green-400" />
          <h1 className="text-2xl font-bold">Manage Nets</h1>
          <div className="ml-auto">
            <Button onClick={openNew} className="bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4 mr-2" />Add Net</Button>
          </div>
        </div>

        <div className="space-y-4">
          {nets.map((n) => (
            <Card key={n.id} className="bg-gray-900 border-gray-700">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-white">{n.name}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" aria-label={`Edit ${n.name}`} onClick={() => openEdit(n)} className="text-gray-400 hover:text-white"><Pencil className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${n.name}`} onClick={() => remove(n)} className="text-gray-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </CardHeader>
              <CardContent className="text-gray-400 text-sm space-y-1">
                <p>{n.day_of_week}s at {n.time}{n.frequency ? ` · ${n.frequency}` : ""}</p>
                <p className="text-xs text-gray-500">{n.max_absences === 0 ? "Stations are never dropped for absences" : `Inactive after ${n.max_absences ?? 3} absences in a row`}</p>
                {n.preamble && <p className="text-xs text-gray-600 truncate">Preamble: {stripHtml(n.preamble).substring(0, 80)}...</p>}
              </CardContent>
            </Card>
          ))}
          {nets.length === 0 && <p className="text-gray-500 text-center py-8">No nets yet. Add one to get started.</p>}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Net" : "New Net"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div><Label htmlFor="net-name">Net Name</Label><Input id="net-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
              <div><Label htmlFor="net-freq">Frequency / Repeater</Label><Input id="net-freq" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Day of Week</Label>
                <Select value={form.day_of_week} onValueChange={(v) => setForm({ ...form, day_of_week: v as DayOfWeek })}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-white mt-1" aria-label="Day of week"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-600">{DAYS.map((d) => <SelectItem key={d} value={d} className="text-white">{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="net-time">Time</Label><Input id="net-time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} placeholder="e.g. 7:30 PM" className="bg-gray-800 border-gray-600 text-white mt-1" /></div>
            </div>
            <div className="sm:max-w-xs">
              <Label htmlFor="net-max-absences">Absences before a station goes inactive</Label>
              <Input id="net-max-absences" type="number" inputMode="numeric" min={0} max={52} step={1} value={form.max_absences} onChange={(e) => setForm({ ...form, max_absences: e.target.value })} className="bg-gray-800 border-gray-600 text-white mt-1 w-24" />
              <p className="text-xs text-gray-500 mt-1">Sessions in a row a station can miss before it is made inactive. 3 is the default. 0 turns this off: no one is dropped and absences are not counted.</p>
            </div>
            <div>
              <Label>Preamble</Label>
              <RichTextEditor value={form.preamble} onChange={(v) => setForm((f) => ({ ...f, preamble: v }))} />
              <p className="text-xs text-gray-500 mt-1">Shortcodes: [/TOPIC] is replaced by the session topic, [/ANNOUNCEMENTS] by the numbered active announcements.</p>
            </div>
            <div>
              <Label>Closing Statement</Label>
              <RichTextEditor value={form.closing} onChange={(v) => setForm((f) => ({ ...f, closing: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} className="text-gray-400">Cancel</Button>
            <Button onClick={save} className="bg-green-600 hover:bg-green-700">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
