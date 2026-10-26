import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Clock, UserPlus, VolumeX, Zap } from "lucide-react";
import { createCheckIn, createStation, findStationsByCallsign, isDuplicateStation, listCheckIns, updateCheckIn, updateStation } from "@/api";
import type { CheckIn, CheckInStatus, NetSession, Station } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAllStations } from "@/hooks/useNetData";
import { toast } from "@/lib/toast";
import { finalStatus, makeRow, matchRow, rowsToLog, typeCallsign } from "./pileupRow";
import type { Row } from "./pileupRow";

const NO_SUGGESTIONS = { index: null as number | null, list: [] as Station[] };

// The Pileup Logger tab: type many callsigns quickly when a lot of stations call at once.
// A callsign on the roster fills in its details; anything else is flagged as a guest.
export default function PileupLogger({ session, netId, onUpdate }: { session: NetSession; netId: string; onUpdate: () => void }) {
  const queryClient = useQueryClient();
  const [defaultStatus, setDefaultStatus] = useState<CheckInStatus>("short_time");
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, () => makeRow("short_time")));
  const { data: stations = [] } = useAllStations(netId);
  const [saving, setSaving] = useState(false);
  const [logged, setLogged] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState(NO_SUGGESTIONS);

  const updateRow = (i: number, field: keyof Row, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      if (field !== "callsign") {
        next[i] = { ...next[i], [field]: value };
        return next;
      }
      next[i] = typeCallsign(next[i], value, stations);
      if (next[i].matched) {
        setSuggestions(NO_SUGGESTIONS);
      } else {
        const cs = next[i].callsign;
        if (cs.length >= 2) {
          const partial = stations.filter((s) => s.callsign.includes(cs) || s.name?.toUpperCase().includes(cs)).slice(0, 6);
          setSuggestions({ index: i, list: partial });
        } else {
          setSuggestions(NO_SUGGESTIONS);
        }
      }
      return next;
    });
  };

  const applySuggestion = (i: number, station: Station) => {
    setRows((prev) => {
      const next = [...prev];
      next[i] = matchRow(next[i], station);
      return next;
    });
    setSuggestions(NO_SUGGESTIONS);
  };

  const setRowStatus = (i: number, status: CheckInStatus) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, status } : r)));

  const changeDefault = (status: CheckInStatus) => {
    setDefaultStatus(status);
    setRows((prev) => prev.map((r) => (r.callsign.trim() ? r : { ...r, status })));
  };

  // The roster entry for a callsign that was not on the roster when typed: reactivate it if it is there but
  // inactive, else add it as a guest waiting for review. Another operator, or another browser tab, may have added
  // the same callsign a moment ago; the server then refuses the second add, and the one that exists is used.
  const guestStation = async (row: Row): Promise<Station> => {
    const known = await findStationsByCallsign(netId, row.callsign);
    const inactive = known.find((s) => !s.active);
    if (inactive) return updateStation(inactive.id, { active: true, consecutive_absences: 0, needs_review: false });
    if (known.length) return known[0];
    try {
      return await createStation({
        callsign: row.callsign, name: row.name || row.callsign, city: row.location || "", state: row.state || "",
        net_id: netId, active: true, consecutive_absences: 0, needs_review: true,
      });
    } catch (err) {
      if (!isDuplicateStation(err)) throw err;
      const now = await findStationsByCallsign(netId, row.callsign);
      if (!now.length) throw err;
      return now[0];
    }
  };

  const submit = async () => {
    const { rows: toLog, merged } = rowsToLog(rows);
    if (!toLog.length) return;
    setSaving(true);

    try {
      const existing = await listCheckIns(session.id);
      const existingByCallsign = new Map<string, CheckIn>(existing.map((c) => [c.callsign.toUpperCase(), c]));

      // Stop an older roster request from overwriting the stations saved below.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["stations", "active", netId] }),
        queryClient.cancelQueries({ queryKey: ["stations", "all", netId] }),
      ]);

      // Roster side: bring matched stations back to full standing, add unknown callsigns as
      // guests waiting for review, and reactivate a known inactive callsign.
      await Promise.all(
        toLog.map(async (row) => {
          if (row.matched && row.station) {
            if (!row.station.active || row.station.consecutive_absences > 0) {
              row.station = await updateStation(row.station.id, { active: true, consecutive_absences: 0 });
            }
          } else if (row.isGuest && !row.matched) {
            row.station = await guestStation(row);
          }
        }),
      );

      // Put the saved stations straight into both shared roster caches.
      for (const scope of ["active", "all"]) {
        queryClient.setQueryData<Station[]>(["stations", scope, netId], (previous = []) => {
          const updated = new Map(previous.map((station) => [station.id, station]));
          toLog.forEach((row) => {
            if (row.station) updated.set(row.station.id, row.station);
          });
          return [...updated.values()];
        });
      }

      // Check-in side: update a callsign that is already in this session, else add it.
      await Promise.all(
        toLog.map(async (row) => {
          const status = finalStatus(row);
          const existingRecord = existingByCallsign.get(row.callsign.toUpperCase());
          if (existingRecord) {
            await updateCheckIn(existingRecord.id, {
              status,
              station_id: row.station?.id || existingRecord.station_id,
              comment: row.comment || existingRecord.comment,
            });
          } else {
            await createCheckIn({
              session_id: session.id, net_id: netId, callsign: row.callsign, station_id: row.station?.id || "",
              status, name: row.name, location: `${row.location}${row.state ? ", " + row.state : ""}`, comment: row.comment || "",
            });
          }
        }),
      );

      await queryClient.invalidateQueries({ queryKey: ["checkins", session.id] });

      setLogged((prev) => [...new Set([...prev, ...toLog.map((r) => r.callsign)])]);
      setRows(Array.from({ length: 5 }, () => makeRow(defaultStatus)));
      toast.success(`Logged ${toLog.length} check-in${toLog.length > 1 ? "s" : ""}${merged ? ` (${merged} repeated callsign${merged > 1 ? "s" : ""} merged)` : ""}`);
      setTimeout(onUpdate, 100);
    } catch (err) {
      toast.error(`Failed to log pileup: ${(err as Error).message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const loggable = rowsToLog(rows).rows.length;

  const statusButtons: { status: CheckInStatus; icon: typeof Clock; title: string; on: string; hover: string }[] = [
    { status: "checked_in", icon: CheckCircle2, title: "Checked In", on: "bg-green-600", hover: "hover:bg-green-700" },
    { status: "short_time", icon: Clock, title: "Short Time", on: "bg-yellow-600", hover: "hover:bg-yellow-700" },
    { status: "early", icon: Zap, title: "Early", on: "bg-purple-600", hover: "hover:bg-purple-700" },
    { status: "not_heard", icon: VolumeX, title: "Not Heard", on: "bg-gray-600", hover: "hover:bg-gray-600" },
  ];

  return (
    <Card className="bg-gray-900 border-gray-700 mt-4">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          Pileup Logger
        </CardTitle>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="text-gray-400 text-sm">Default status:</span>
          <Button size="sm" onClick={() => changeDefault("short_time")} className={`h-7 px-3 text-xs ${defaultStatus === "short_time" ? "bg-yellow-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}>
            <Clock className="w-3 h-3 mr-1" />Short Time
          </Button>
          <Button size="sm" onClick={() => changeDefault("early")} className={`h-7 px-3 text-xs ${defaultStatus === "early" ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}>
            <Zap className="w-3 h-3 mr-1" />Early
          </Button>
        </div>
        <p className="text-gray-400 text-sm mt-1">Roster matches auto-fill. Non-roster callsigns are auto-flagged as guests.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 font-medium px-2 py-2 w-32">Callsign</th>
                <th className="text-left text-gray-400 font-medium px-2 py-2">Name</th>
                <th className="text-left text-gray-400 font-medium px-2 py-2 hidden md:table-cell">City</th>
                <th className="text-left text-gray-400 font-medium px-2 py-2 w-20 hidden md:table-cell">State</th>
                <th className="text-left text-gray-400 font-medium px-2 py-2 w-40">Comment</th>
                <th className="text-right text-gray-400 font-medium px-2 py-2 w-44">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={`border-b border-gray-800 ${row.matched ? "bg-yellow-900/10" : row.isGuest ? "bg-orange-900/10" : ""}`}>
                  <td className="px-2 py-1.5 relative">
                    <Input
                      value={row.callsign}
                      onChange={(e) => updateRow(i, "callsign", e.target.value)}
                      onBlur={() => setTimeout(() => setSuggestions(NO_SUGGESTIONS), 150)}
                      placeholder="W1ABC"
                      aria-label={`Callsign, row ${i + 1}`}
                      className="bg-gray-800 border-gray-600 text-green-400 font-mono h-8 text-sm"
                    />
                    {suggestions.index === i && suggestions.list.length > 0 && (
                      <div className="absolute z-20 left-2 top-full mt-0.5 w-64 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden">
                        {suggestions.list.map((s) => (
                          <button key={s.id} onMouseDown={() => applySuggestion(i, s)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-700 text-left text-xs">
                            <span className="font-mono text-green-400 w-20 font-bold shrink-0">{s.callsign}</span>
                            <span className="text-white truncate">{s.name}</span>
                            <span className="text-gray-500 ml-auto shrink-0">{s.state}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Input value={row.name} onChange={(e) => updateRow(i, "name", e.target.value)} placeholder="Name" readOnly={row.matched} aria-label={`Name, row ${i + 1}`}
                      className={`h-8 text-sm border-gray-600 ${row.matched ? "bg-gray-700 text-gray-300 cursor-default" : "bg-gray-800 text-white"}`} />
                  </td>
                  <td className="px-2 py-1.5 hidden md:table-cell">
                    <Input value={row.location} onChange={(e) => updateRow(i, "location", e.target.value)} placeholder="City" readOnly={row.matched} aria-label={`City, row ${i + 1}`}
                      className={`h-8 text-sm border-gray-600 ${row.matched ? "bg-gray-700 text-gray-300 cursor-default" : "bg-gray-800 text-white"}`} />
                  </td>
                  <td className="px-2 py-1.5 hidden md:table-cell">
                    <Input value={row.state} onChange={(e) => updateRow(i, "state", e.target.value)} placeholder="ST" readOnly={row.matched} aria-label={`State, row ${i + 1}`}
                      className={`h-8 text-sm border-gray-600 ${row.matched ? "bg-gray-700 text-gray-300 cursor-default" : "bg-gray-800 text-white"}`} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input value={row.comment} onChange={(e) => updateRow(i, "comment", e.target.value)} placeholder="Comment..." aria-label={`Comment, row ${i + 1}`}
                      className="h-8 text-sm border-gray-600 bg-gray-800 text-white" />
                  </td>
                  <td className="px-2 py-1.5">
                    {row.isGuest ? (
                      <div className="flex justify-end">
                        <Badge className="bg-orange-800 text-orange-200 text-xs"><UserPlus className="w-3 h-3 mr-1" />Guest</Badge>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-end">
                        {statusButtons.map((b) => (
                          <Button key={b.status} size="sm" title={b.title} aria-label={`${b.title}, row ${i + 1}`} onClick={() => setRowStatus(i, b.status)} disabled={!row.matched}
                            className={`h-7 px-2 ${row.status === b.status ? b.on : `bg-gray-700 ${b.hover}`}`}>
                            <b.icon className="w-3.5 h-3.5" />
                          </Button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {logged.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {logged.map((cs) => (
              <Badge key={cs} className="bg-green-900 text-green-300 font-mono">
                <Check className="w-3 h-3 mr-1" />{cs}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center gap-4">
          <Button onClick={submit} disabled={saving || loggable === 0} className="bg-yellow-600 hover:bg-yellow-700">
            {saving ? "Logging..." : "Log Pileup"}
          </Button>
          <button onClick={() => setRows((prev) => [...prev, makeRow(defaultStatus)])} className="text-gray-500 hover:text-gray-300 text-xs underline">
            + Add row
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
