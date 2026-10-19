import { useEffect, useMemo, useState } from "react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { Edit2, GripVertical, Megaphone, Plus, Save, Trash2, X } from "lucide-react";
import { createAnnouncement, deleteAnnouncement, listAnnouncements, updateAnnouncement } from "@/api";
import type { Announcement, Net, NetSession } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseShortcodes } from "@/utils/shortcodes";

// The "Opening" tab: the net's opening script to read aloud (with the topic and the
// active announcements filled in), plus a place to add, edit and switch announcements.
export default function AnnouncementsPanel({ net, session }: { net: Net | undefined; session: NetSession }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [newText, setNewText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = async () => setAnnouncements(await listAnnouncements());
  useEffect(() => {
    load();
  }, []);

  const preambleHtml = useMemo(
    () => parseShortcodes(net?.preamble, { topic: session.topic, announcements }),
    [net?.preamble, session.topic, announcements],
  );

  const add = async () => {
    if (!newText.trim()) return;
    await createAnnouncement({ text: newText, order: announcements.length, active: true });
    setNewText("");
    load();
  };
  const remove = async (id: string) => {
    await deleteAnnouncement(id);
    load();
  };
  const toggle = async (a: Announcement) => {
    await updateAnnouncement(a.id, { active: !a.active });
    load();
  };
  const saveEdit = async (id: string) => {
    await updateAnnouncement(id, { text: editText });
    setEditingId(null);
    setEditText("");
    load();
  };

  return (
    <Card className="bg-gray-900 border-gray-700 mt-4">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-purple-400" />
          Opening
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {net?.preamble && (
          <div className="bg-gradient-to-br from-purple-900/40 to-gray-800 border-2 border-purple-600 rounded-lg p-5">
            <p className="text-purple-300 text-xs uppercase tracking-widest mb-3 font-bold">📡 Net Preamble — Read Aloud to Open</p>
            <div className="text-white leading-relaxed text-[15px] rich-text max-w-none" dangerouslySetInnerHTML={{ __html: preambleHtml }} />
          </div>
        )}

        <div>
          <p className="text-purple-300 text-xs uppercase tracking-wide mb-2 font-medium">Active Announcements</p>
          <div className="space-y-2">
            {announcements.map((a, i) => (
              <div key={a.id} className={`border rounded-lg ${a.active ? "border-purple-800 bg-purple-900/20" : "border-gray-700 bg-gray-800 opacity-50"}`}>
                {editingId === a.id ? (
                  <div className="p-3 space-y-2">
                    <ReactQuill value={editText} onChange={setEditText} theme="snow" className="bg-white text-black" />
                    <div className="flex gap-2 justify-end pt-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="h-7">
                        <X className="w-3 h-3 mr-1" />Cancel
                      </Button>
                      <Button size="sm" onClick={() => saveEdit(a.id)} className="bg-purple-600 hover:bg-purple-700 h-7">
                        <Save className="w-3 h-3 mr-1" />Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 p-3">
                    <GripVertical className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />
                    <span className="text-gray-500 text-xs w-5 mt-0.5">{i + 1}.</span>
                    <div className="text-white text-sm flex-1 rich-text max-w-none" dangerouslySetInnerHTML={{ __html: a.text }} />
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge onClick={() => toggle(a)} className={`cursor-pointer text-xs ${a.active ? "bg-purple-700 text-purple-200" : "bg-gray-700 text-gray-400"}`}>
                        {a.active ? "Active" : "Skip"}
                      </Badge>
                      <Button variant="ghost" size="icon" aria-label="Edit announcement" onClick={() => { setEditingId(a.id); setEditText(a.text); }} className="text-gray-500 hover:text-blue-400 h-6 w-6">
                        <Edit2 className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Delete announcement" onClick={() => remove(a.id)} className="text-gray-500 hover:text-red-400 h-6 w-6">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-gray-400 text-xs">New Announcement</p>
          <ReactQuill value={newText} onChange={setNewText} theme="snow" className="bg-white text-black" />
          <Button onClick={add} disabled={!newText.trim()} className="bg-purple-600 hover:bg-purple-700 w-full">
            <Plus className="w-4 h-4 mr-2" />
            Add Announcement
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
