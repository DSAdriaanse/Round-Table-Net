import { BookOpen, ClipboardList, Globe, ListChecks, LogOut, Megaphone, Radio, Users, Zap, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const steps: { icon: LucideIcon; title: string; color: string; body: string }[] = [
  { icon: Radio, title: "1. Open a Session", color: "text-green-400",
    body: "On the Net Control page, enter your callsign and an optional topic, then click Open Session. This creates a live session for the selected net and marks it as LIVE. Only one session can be open per net at a time. If a session is already open, it will appear automatically when you load the page." },
  { icon: Megaphone, title: "2. Opening Tab — Preamble & Announcements", color: "text-purple-400",
    body: "The Opening tab displays the net preamble script (read this on air to open the net) and the list of active announcements. Announcements are managed centrally on the Announcements page and shown here in display order. Read each announcement aloud during the opening of the net." },
  { icon: Zap, title: "3. Pileup Logger Tab — Fast Check-Ins", color: "text-yellow-400",
    body: "Use the Pileup Logger when stations check in rapidly at the start of the net. Type callsigns and the system auto-fills station details from the roster. Unrecognized callsigns are logged as guests. Set the status per row (Checked In, Short Time, Early, Guest) or change all rows at once. Click Log All to save everything in one batch." },
  { icon: ListChecks, title: "4. Standard Roll Tab — Roll Call", color: "text-blue-400",
    body: "Use the Standard Roll for the formal roll call. The roster is sorted by state then callsign. The current station is highlighted — mark each station as Checked In, Short Time, Early, or Not Heard. Use the search box to filter by callsign, name, city, or state. Comments save when you click away from the field." },
  { icon: LogOut, title: "5. Close Session Tab — Closing & Roster Update", color: "text-red-400",
    body: "When the net is done, read the closing statement aloud, then click Close Session. The system deletes Not Heard check-ins, adds guests to the roster for review, records the check-in count, and marks the session for processing. Roster attendance and consecutive absences are then updated automatically by a background job that runs every 15 minutes. If WordPress publishing on close is switched on, the session report is posted to WordPress right after closing; otherwise use the Publish button on the session report." },
  { icon: ClipboardList, title: "6. Technical Difficulty", color: "text-orange-400",
    body: "If the repeater had issues (interference, dropout, etc.), check the Technical Difficulty box before closing. This skips absence tracking so no one falls off the roster due to RF problems. Guests are still added for review. The session is closed immediately without pending processing." },
  { icon: Globe, title: "7. Public Check-In & Other Tools", color: "text-cyan-400",
    body: "The Public Check-In page lets non-NCO stations check themselves in from a phone or browser. Print Net Sheet generates a printable roster sheet for offline use. Session History shows past sessions with attendance reports. The Roster Manager handles station additions, edits, and bulk imports." },
];

// The in-app help page. Keep it in step with the screens when behaviour changes.
export default function Instructions() {
  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <BookOpen className="w-7 h-7 text-green-400" />
          <h1 className="text-2xl font-bold">Net Control Operator Guide</h1>
        </div>
        <p className="text-gray-400 mb-8">A walkthrough of the net control module — from opening the net to closing the session.</p>

        <div className="space-y-4">
          {steps.map(({ icon: Icon, title, color, body }) => (
            <Card key={title} className="bg-gray-900 border-gray-700">
              <CardHeader className="pb-3"><CardTitle className={`flex items-center gap-2.5 text-lg ${color}`}><Icon className="w-5 h-5" />{title}</CardTitle></CardHeader>
              <CardContent><p className="text-gray-300 text-sm leading-relaxed">{body}</p></CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-gray-900 border-gray-700 mt-6">
          <CardContent className="pt-6">
            <h3 className="text-green-400 font-semibold mb-2 flex items-center gap-2"><Users className="w-4 h-4" /> Quick Tips</h3>
            <ul className="text-gray-400 text-sm space-y-1.5 list-disc pl-5">
              <li>Always confirm the <strong className="text-white">Active Net</strong> in the sidebar before opening a session. Logging the wrong net is the most common mistake.</li>
              <li>The Pileup Logger is for speed; the Standard Roll is for the formal roll call. Use both as needed.</li>
              <li>Comments on the Standard Roll save when you leave the field. There is no save button.</li>
              <li>Guests are added to the roster with a "needs review" flag. Review them in the Roster Manager.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
