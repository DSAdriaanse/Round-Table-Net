import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, LogOut, Trash2 } from "lucide-react";
import { closeSession, getSettings, listAnnouncements, publishReport } from "@/api";
import type { Announcement, CheckIn, Net, NetSession, Station } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/lib/toast";
import { parseShortcodes } from "@/utils/shortcodes";
import DiscardSessionDialog from "./DiscardSessionDialog";

// The Close Session tab: the closing script to read aloud, the technical-difficulty
// switch, the Close button, and a five-column summary of who checked in.
// The close itself happens on the server (POST /api/rt/session/close).
// The rarely-wanted "discard" lives at the very bottom, out of the way of the real close.
export default function CloseSessionPanel({ session, net, checkIns, rosterStations, onClose, onDiscard }: {
  session: NetSession; net: Net | undefined; checkIns: CheckIn[]; rosterStations: Station[]; onClose: () => void;
  /** Deletes the session; resolves true when it worked. */
  onDiscard: () => Promise<boolean>;
}) {
  const [technicalDifficulty, setTechnicalDifficulty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    listAnnouncements().then((a) => setAnnouncements(a.filter((x) => x.active)));
  }, []);

  const closingHtml = useMemo(
    () => parseShortcodes(net?.closing, { topic: session.topic, announcements }),
    [net?.closing, session.topic, announcements],
  );

  const doClose = async () => {
    const confirmMsg = technicalDifficulty
      ? "Close session with Technical Difficulty flag? Absences will NOT be updated. Guests will still be added to the roster."
      : "Are you sure you want to close this session? The roster will be updated now (absences counted).";
    if (!window.confirm(confirmMsg)) return;
    setLoading(true);

    try {
      await closeSession(session.id, technicalDifficulty);
      toast.success("Session closed successfully.");

      // Post the report to WordPress if the club has turned that on in Settings.
      // A failed post never undoes the close; it only shows a message.
      const settings = await getSettings().catch(() => null);
      if (settings?.publish_on_close) {
        toast.loading("Publishing report to WordPress...", { id: "wp-publish" });
        try {
          const res = await publishReport(session.id);
          toast.success("Report published to WordPress.", { id: "wp-publish", description: res.post_url });
        } catch (err) {
          toast.error("WordPress publish failed.", { id: "wp-publish", description: (err as Error).message });
        }
      }
      onClose();
    } catch (err) {
      toast.error(`Failed to close session: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // "Not heard" also includes roster stations that were never logged at all.
  const loggedCallsigns = new Set(checkIns.map((c) => c.callsign.toUpperCase()));
  const implicitNotHeard = rosterStations
    .filter((s) => !loggedCallsigns.has(s.callsign.toUpperCase()))
    .map((s) => ({ id: `implicit-${s.id}`, callsign: s.callsign, status: "not_heard" }));
  const allNotHeard = [...checkIns.filter((c) => c.status === "not_heard"), ...implicitNotHeard];

  const cols = [
    { label: "Checked In", status: "checked_in", color: "text-green-400", bg: "bg-green-900/20 border-green-800" },
    { label: "Short Time", status: "short_time", color: "text-yellow-400", bg: "bg-yellow-900/20 border-yellow-800" },
    { label: "Early", status: "early", color: "text-purple-400", bg: "bg-purple-900/20 border-purple-800" },
    { label: "Guests", status: "guest", color: "text-orange-400", bg: "bg-orange-900/20 border-orange-800" },
    { label: "Not Heard", status: "not_heard", color: "text-gray-400", bg: "bg-gray-800/40 border-gray-700" },
  ];

  return (
    <Card className="bg-gray-900 border-gray-700">
      <CardHeader>
        <CardTitle className="text-green-400">Close Session</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {net?.closing && (
          <div className="bg-gradient-to-br from-green-900/30 to-gray-800 border-2 border-green-600 rounded-lg p-5">
            <p className="text-green-300 text-xs uppercase tracking-widest mb-3 font-bold">📡 Net Closing Statement — Read Aloud to Close</p>
            <div className="text-white text-[15px] rich-text max-w-none" dangerouslySetInnerHTML={{ __html: closingHtml }} />
          </div>
        )}

        <div className={`flex items-start gap-3 p-3 rounded-lg border ${technicalDifficulty ? "border-orange-600 bg-orange-900/20" : "border-gray-700 bg-gray-800/40"}`}>
          <Checkbox id="tech-difficulty" checked={technicalDifficulty} onCheckedChange={(v) => setTechnicalDifficulty(v === true)} className="mt-0.5" />
          <label htmlFor="tech-difficulty" className="cursor-pointer">
            <div className="flex items-center gap-2 text-sm font-medium text-orange-300">
              <AlertTriangle className="w-4 h-4" />
              In Case of Repeater System Issues
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Checking this box will prevent the system from processing absences. Use this in cases where we don't want people to fall off the roster due to connection problems on unique circumstances via RF. Guests will still be added to the roster for review.
            </p>
          </label>
        </div>

        <p className="text-sm text-gray-400">
          {technicalDifficulty
            ? "Session will close immediately (no absence tracking). Guests will still be added for review."
            : "This will close the session and update the roster right away based on attendance."}
        </p>

        <Button id="close-session-button" onClick={doClose} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white w-full">
          <LogOut className="w-4 h-4 mr-2" />
          {loading ? "Closing..." : "Close Session"}
        </Button>

        {/* Five-column check-in summary (a scrolling row on a phone) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-2">
          {cols.map((col) => {
            const list = col.status === "not_heard" ? allNotHeard : checkIns.filter((c) => c.status === col.status);
            return (
              <div key={col.status} className={`rounded-lg border p-3 ${col.bg}`}>
                <p className={`text-xs font-bold uppercase tracking-wide mb-2 ${col.color}`}>
                  {col.label} <span className="font-normal opacity-70">({list.length})</span>
                </p>
                <div className="space-y-0.5">
                  {list.length === 0 ? (
                    <p className="text-gray-600 text-xs italic">None</p>
                  ) : (
                    list.map((c) => (
                      <p key={c.id} className="font-mono text-xs text-white">{c.callsign}</p>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-4 mt-2 border-t border-gray-800 flex justify-end">
          <Button
            onClick={() => setDiscardOpen(true)}
            variant="ghost"
            size="sm"
            className="text-gray-500 hover:text-red-400 hover:bg-red-900/20 h-7 text-xs"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />Discard session (testing only)
          </Button>
        </div>
      </CardContent>

      <DiscardSessionDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        checkInCount={checkIns.length}
        onDiscard={onDiscard}
        onCloseProperly={() => document.getElementById("close-session-button")?.focus()}
      />
    </Card>
  );
}
