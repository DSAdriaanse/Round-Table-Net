import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Megaphone, Plus, Trash2 } from "lucide-react";
import { createAnnouncement, deleteAnnouncement, listAnnouncements, updateAnnouncement } from "@/api";
import type { Announcement } from "@/api";
import RichTextEditor from "@/components/RichTextEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/lib/toast";

const isEmptyHtml = (html: string) => !html.replace(/<[^>]*>/g, "").trim();

// Announcements read aloud at the opening of every net: add, reorder, switch on and off, delete.
export default function AnnouncementsManager() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [newText, setNewText] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try { setItems(await listAnnouncements()); } catch (e) { toast.error(`Could not load announcements: ${(e as Error).message}`); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const guard = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { toast.error(`Something went wrong: ${(e as Error).message}`); }
    await load();
  };

  const add = () => guard(async () => {
    if (isEmptyHtml(newText)) return;
    await createAnnouncement({ text: newText, order: items.length, active: true });
    setNewText("");
  });
  const remove = (id: string) => window.confirm("Delete this announcement?") && guard(() => deleteAnnouncement(id));
  const toggle = (a: Announcement) => guard(() => updateAnnouncement(a.id, { active: !a.active }));

  // Swap the order numbers of two neighbours. The list is re-numbered first so ties never happen.
  const move = (idx: number, dir: -1 | 1) => guard(async () => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const list = items.map((a, i) => ({ id: a.id, order: i }));
    [list[idx].order, list[j].order] = [list[j].order, list[idx].order];
    await Promise.all(list.map((x, i) => (items[i].order === x.order ? null : updateAnnouncement(x.id, { order: x.order }))));
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Megaphone className="w-6 h-6 text-purple-400" />
          <h1 className="text-2xl font-bold">Global Announcements Manager</h1>
        </div>

        <Card className="bg-gray-900 border-gray-700 mb-6">
          <CardHeader><CardTitle className="text-white">Add New Announcement</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <RichTextEditor value={newText} onChange={setNewText} placeholder="Enter announcement text..." />
            <Button onClick={add} disabled={isEmptyHtml(newText)} className="bg-purple-600 hover:bg-purple-700 w-full"><Plus className="w-4 h-4 mr-2" />Add Announcement</Button>
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-700">
          <CardHeader><CardTitle className="text-white">Announcements</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {loading ? <p className="text-gray-500">Loading...</p>
              : items.length === 0 ? <p className="text-gray-500">No announcements yet. Create one above.</p>
              : items.map((a, i) => (
                <div key={a.id} className={`flex items-start gap-3 p-4 rounded-lg border ${a.active ? "border-purple-800 bg-purple-900/20" : "border-gray-700 bg-gray-800 opacity-60"}`}>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-600 hover:text-gray-400 disabled:opacity-30 p-1"><ChevronUp className="w-4 h-4" /></button>
                    <button aria-label="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="text-gray-600 hover:text-gray-400 disabled:opacity-30 p-1"><ChevronDown className="w-4 h-4" /></button>
                  </div>
                  <span className="text-gray-500 text-xs w-6 mt-1 text-center font-mono">{i + 1}.</span>
                  <div className="text-white text-sm flex-1 min-w-0 rich-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: a.text }} />
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge onClick={() => toggle(a)} className={`cursor-pointer text-xs ${a.active ? "bg-purple-700 text-purple-200" : "bg-gray-700 text-gray-400"}`}>{a.active ? "Active" : "Inactive"}</Badge>
                    <Button variant="ghost" size="icon" aria-label="Delete announcement" onClick={() => remove(a.id)} className="text-gray-500 hover:text-red-400 h-6 w-6"><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
