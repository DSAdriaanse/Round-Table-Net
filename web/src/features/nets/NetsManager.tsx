import { useEffect, useState } from "react";
import { Pencil, Plus, Radio, Trash2 } from "lucide-react";
import { createNet, deleteNet, getSlackStatus, listNets, sendSlackTest, updateNet } from "@/api";
import type { DayOfWeek, Net } from "@/api";
import { useNet } from "@/components/NetContext";
import RichTextEditor from "@/components/RichTextEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chatProblem, tidyChannelId } from "@/lib/slackChannel";
import { toast } from "@/lib/toast";

const DAYS: DayOfWeek[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type Form = Pick<Net, "name" | "day_of_week" | "time" | "frequency" | "preamble" | "closing"> & { max_absences: string; slack_enabled: boolean; slack_channel: string };
const EMPTY: Form = { name: "", day_of_week: "Monday", time: "", frequency: "", preamble: "", closing: "", max_absences: "3", slack_enabled: false, slack_channel: "" };

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// Add, edit and delete nets, including the opening and closing scripts.
export default function NetsManager() {
  const { refreshNets } = useNet();
  const [nets, setNets] = useState<Net[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Net | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  // null while we find out whether the server has Slack set up.
  const [slackReady, setSlackReady] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);

  const load = () => listNets().then(setNets, (e) => toast.error(`Could not load nets: ${e.message}`));
  useEffect(() => { load(); }, []);
  useEffect(() => { getSlackStatus().then((s) => setSlackReady(s.configured), () => setSlackReady(false)); }, []);

  const openNew = () => { setForm(EMPTY); setEditing(null); setOpen(true); };
  const openEdit = (n: Net) => {
    setForm({ name: n.name, day_of_week: n.day_of_week, time: n.time, frequency: n.frequency, preamble: n.preamble, closing: n.closing, max_absences: String(n.max_absences ?? 3), slack_enabled: !!n.slack_enabled, slack_channel: n.slack_channel ?? "" });
    setEditing(n);
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.time.trim()) return toast.error("A net needs a name and a time.");
    const maxAbsences = Number(form.max_absences);
    if (form.max_absences.trim() === "" || !Number.isInteger(maxAbsences) || maxAbsences < 0 || maxAbsences > 52) {
      return toast.error("Absences before a station goes inactive must be a whole number from 0 to 52 (0 = never).");
    }
    const problem = chatProblem(form.slack_enabled, form.slack_channel);
    if (problem) return toast.error(problem);
    const data = { ...form, max_absences: maxAbsences, slack_channel: tidyChannelId(form.slack_channel) };
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

  const testSlack = async () => {
    const problem = chatProblem(true, form.slack_channel);
    if (problem) return toast.error(problem);
    setTesting(true);
    try {
      await sendSlackTest(tidyChannelId(form.slack_channel));
      toast.success("Test message sent. Check the Slack channel.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
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
                <p className="text-xs text-gray-500">{n.slack_enabled ? `Team chat on (Slack channel ${n.slack_channel})` : "Team chat off"}</p>
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
            <div className="rounded-md border border-gray-700 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="net-slack-enabled">Team chat with Slack</Label>
                <Switch id="net-slack-enabled" checked={form.slack_enabled} disabled={slackReady !== true && !form.slack_enabled} onCheckedChange={(v) => setForm({ ...form, slack_enabled: v })} />
              </div>
              <p className="text-xs text-gray-500">
                {slackReady === false
                  ? "Slack is not set up on this server yet, so this cannot be turned on. See docs/slack-chat.md."
                  : "While this net is running, the operator gets a chat bubble and each session has its own thread in the Slack channel below."}
              </p>
              {form.slack_enabled && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[12rem]">
                    <Label htmlFor="net-slack-channel">Slack channel ID</Label>
                    <Input id="net-slack-channel" value={form.slack_channel} onChange={(e) => setForm({ ...form, slack_channel: e.target.value })} placeholder="C0123ABCD" className="bg-gray-800 border-gray-600 text-white mt-1" />
                  </div>
                  <Button type="button" variant="outline" onClick={testSlack} disabled={testing || slackReady !== true} className="border-gray-600 text-gray-200">{testing ? "Sending..." : "Send test message"}</Button>
                </div>
              )}
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
