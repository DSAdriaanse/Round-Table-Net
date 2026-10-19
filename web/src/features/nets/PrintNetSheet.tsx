import { useEffect, useMemo, useState } from "react";
import { FileText, Printer } from "lucide-react";
import { listAnnouncements } from "@/api";
import type { Announcement } from "@/api";
import { useNet } from "@/components/NetContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useActiveRoster } from "@/hooks/useNetData";
import { parseShortcodes } from "@/utils/shortcodes";

const BLANK_ROWS = 10;
const SCAN_EMAIL = "wqvs960@swcrs.org"; // where operators send a scanned paper log

// A paper copy of the net: scripts, the active roster with tick boxes, and blank rows.
// Everything outside #net-sheet-content is hidden when printing (see index.css).
export default function PrintNetSheet() {
  const { nets, selectedNet } = useNet();
  const { data: roster = [], isLoading } = useActiveRoster(selectedNet);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const net = nets.find((n) => n.id === selectedNet);

  useEffect(() => {
    listAnnouncements().then((a) => setAnnouncements(a.filter((x) => x.active)), () => setAnnouncements([]));
  }, []);

  const stations = useMemo(() => [...roster].sort((a, b) => {
    const sa = (a.state || "").toUpperCase();
    const sb = (b.state || "").toUpperCase();
    return sa !== sb ? sa.localeCompare(sb) : a.callsign.localeCompare(b.callsign);
  }), [roster]);

  if (!selectedNet) {
    return (
      <div className="min-h-screen bg-gray-950 text-white p-4">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-gray-900 border-gray-700">
            <CardContent className="text-center py-16 text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg">Select a net to print a net sheet.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const cell = "border border-black px-2 py-1";
  const boxes = ["☐", "☐", "☐"].map((b, i) => <td key={i} className={`${cell} text-center`}>{b}</td>);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6 print:hidden">
          <div className="flex items-center gap-3">
            <Printer className="w-6 h-6 text-blue-400" />
            <h1 className="text-2xl font-bold">Print Net Sheet</h1>
          </div>
          <Button onClick={() => window.print()} disabled={isLoading} className="bg-blue-600 hover:bg-blue-700"><Printer className="w-4 h-4 mr-2" />Print</Button>
        </div>

        <div id="net-sheet-content" className="net-sheet-print bg-white text-black p-4 sm:p-8 space-y-6 overflow-x-auto">
          <div className="text-center border-b-2 border-black pb-3">
            <h1 className="text-xl font-bold">{net?.name}</h1>
            <p className="text-sm">{net?.day_of_week} {net?.time}{net?.frequency ? ` — ${net.frequency}` : ""}</p>
          </div>

          {net?.preamble && <div className="rich-text text-sm" dangerouslySetInnerHTML={{ __html: parseShortcodes(net.preamble, { announcements }) }} />}

          <div>
            <h2 className="text-base font-bold mb-2 underline">Roll Call</h2>
            <table className="w-full border-collapse border border-black text-xs">
              <thead>
                <tr className="bg-gray-200">
                  <th className={`${cell} w-16 text-left`}>Callsign</th>
                  <th className={`${cell} w-32 text-left`}>Name</th>
                  <th className={`${cell} w-10 text-left`}>ST</th>
                  <th className={`${cell} w-28 text-left`}>City</th>
                  <th className={`${cell} text-left`}>Comment</th>
                  <th className={`${cell} w-12`}>In</th>
                  <th className={`${cell} w-12`}>Short</th>
                  <th className={`${cell} w-12`}>NH</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s, i) => (
                  <tr key={s.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className={`${cell} font-mono font-bold`}>{s.callsign}</td>
                    <td className={cell}>{s.name}</td>
                    <td className={cell}>{s.state || "—"}</td>
                    <td className={cell}>{s.city || "—"}</td>
                    <td className={cell}></td>
                    {boxes}
                  </tr>
                ))}
                {Array.from({ length: BLANK_ROWS }).map((_, i) => (
                  <tr key={`blank-${i}`} className={(stations.length + i) % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className={cell}>&nbsp;</td><td className={cell}></td><td className={cell}></td><td className={cell}></td><td className={cell}></td>
                    {boxes}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {net?.closing && (
            <div className="mt-8 border-t-2 border-black pt-4">
              <h2 className="text-base font-bold mb-2 underline">Closing</h2>
              <div className="rich-text text-sm" dangerouslySetInnerHTML={{ __html: parseShortcodes(net.closing, { announcements }) }} />
            </div>
          )}

          <div className="mt-6 border-t border-black pt-3 text-sm italic">
            Dear NCO: If you used a printed paper log, please scan or take a picture and send to
            <span className="font-mono not-italic"> {SCAN_EMAIL} </span>
            for processing.
          </div>
        </div>
      </div>
    </div>
  );
}
