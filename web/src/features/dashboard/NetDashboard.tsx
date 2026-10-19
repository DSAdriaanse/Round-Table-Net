import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Map as MapIcon, Users } from "lucide-react";
import { findOpenSession } from "@/api";
import type { CheckInStatus, NetSession, Station } from "@/api";
import { useNet } from "@/components/NetContext";
import StationMap, { statusColor } from "@/components/StationMap";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useActiveRoster, useSessionCheckIns } from "@/hooks/useNetData";
import SessionDashboard from "@/features/nco/SessionDashboard";

// Read-only view of the running session: counters, a map and the roster with each
// station's status tonight.
export default function NetDashboard() {
  const { selectedNet } = useNet();
  const [session, setSession] = useState<NetSession | null>(null);
  const { data: stations = [] } = useActiveRoster(selectedNet);
  const { data: checkIns = [] } = useSessionCheckIns(session?.id);

  useEffect(() => {
    if (!selectedNet) { setSession(null); return; }
    findOpenSession(selectedNet).then(setSession, () => setSession(null));
  }, [selectedNet]);

  const statusOf = (s: Station): CheckInStatus | null =>
    checkIns.find((c) => c.station_id === s.id || c.callsign === s.callsign)?.status ?? null;
  const mapped = stations.filter((s) => s.lat && s.lng);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Net Dashboard</h1>
        {!session && <p className="text-gray-500 text-sm mb-4">No session is open for this net. The map and roster show no check-in status.</p>}
        <SessionDashboard checkIns={checkIns} selectedNet={selectedNet} />

        <div className="grid lg:grid-cols-2 gap-6 mt-6">
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2"><MapIcon className="w-5 h-5 text-green-400" />Station Map ({mapped.length} mapped)</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-hidden rounded-b-lg">
              <StationMap stations={mapped} statusOf={statusOf} />
            </CardContent>
          </Card>

          <Card className="bg-gray-900 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2"><Users className="w-5 h-5 text-green-400" />Roster Status ({stations.length} active)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 max-h-96 overflow-y-auto">
              {stations.map((s) => {
                const status = statusOf(s);
                return (
                  <div key={s.id} className="flex items-center gap-3 py-1.5 border-b border-gray-800">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: statusColor(status) }} />
                    <span className="font-mono text-green-400 w-24 text-sm font-bold">{s.callsign}</span>
                    <span className="text-white text-sm flex-1 truncate">{s.name}</span>
                    <span className="text-gray-500 text-xs hidden sm:inline">{[s.city, s.state].filter(Boolean).join(", ")}</span>
                    {status && (
                      <Badge className={`text-xs ${status === "checked_in" ? "bg-green-800 text-green-200" : status === "short_time" ? "bg-yellow-800 text-yellow-200" : "bg-gray-700 text-gray-400"}`}>
                        {status === "checked_in" ? <CheckCircle2 className="w-3 h-3 mr-1 inline" /> : status === "short_time" ? <Clock className="w-3 h-3 mr-1 inline" /> : null}
                        {status.replace("_", " ")}
                      </Badge>
                    )}
                  </div>
                );
              })}
              {stations.length === 0 && <p className="text-gray-500 text-center py-8">No active stations on roster.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
