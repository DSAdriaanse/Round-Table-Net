import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Clock, Radio, Search, VolumeX, Zap } from "lucide-react";
import { createCheckIn, updateCheckIn, updateStation } from "@/api";
import type { CheckIn, CheckInStatus, Station } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { useActiveRoster, useAllStations, useIsInactive } from "@/hooks/useNetData";
import type { NetSession } from "@/api";

type Filter = "all" | "hide_early_short" | "guests" | "not_heard";

// The Standard Roll tab: the active roster in order (by state, then callsign); a switch adds the inactive stations too. The
// operator taps a status for each station as it answers; a comment can be typed any time.
export default function StandardRoll({ session, netId, checkIns, onUpdate }: { session: NetSession; netId: string; checkIns: CheckIn[]; onUpdate: () => void }) {
  const [comments, setComments] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const queryClient = useQueryClient();
  const isInactive = useIsInactive(netId);

  // Shared roster caches, also used by NetControl, SessionDashboard and the Pileup Logger.
  const { data: activeStations = [] } = useActiveRoster(netId);
  const { data: allStations = [] } = useAllStations(netId);
  const inactiveCount = allStations.filter(isInactive).length;
  const rawStations = showInactive ? allStations : activeStations;

  const stations = useMemo(
    () =>
      [...rawStations].sort((a, b) => {
        const stateA = (a.state || "").toUpperCase();
        const stateB = (b.state || "").toUpperCase();
        if (stateA !== stateB) return stateA.localeCompare(stateB);
        return a.callsign.localeCompare(b.callsign);
      }),
    [rawStations],
  );

  // New check-ins arrive through the live subscription in useSessionCheckIns (the
  // parent), so this tab never re-fetches.
  const findRecord = (station: Station) => checkIns.find((c) => c.station_id === station.id || c.callsign === station.callsign);
  const statusOf = (station: Station): CheckInStatus => findRecord(station)?.status || "not_heard";
  // A station is "flagged" once it has any record; un-called stations have none and are
  // skipped by the current-row highlight.
  const hasRecord = (station: Station) => !!findRecord(station);

  const setStatus = async (station: Station, status: CheckInStatus) => {
    setSaving((p) => ({ ...p, [station.id]: true }));
    try {
      const existing = findRecord(station);
      const comment = comments[station.id] || "";
      // An inactive station that answers is active again (the end-of-session update skips inactive stations,
      // so it would otherwise stay inactive for good). Hearing nothing from it changes nothing.
      if (isInactive(station) && status !== "not_heard") {
        const saved = await updateStation(station.id, { active: true, consecutive_absences: 0 });
        // Put the saved station straight into both roster caches, so the Inactive badge goes at once.
        for (const scope of ["active", "all"]) {
          queryClient.setQueryData<Station[]>(["stations", scope, netId], (prev = []) => (prev.some((x) => x.id === saved.id) ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved]));
        }
        toast.success(`${station.callsign} is active again.`);
      }
      if (existing) {
        await updateCheckIn(existing.id, { status, comment: comment || existing.comment, station_id: station.id });
      } else {
        await createCheckIn({ session_id: session.id, net_id: netId, callsign: station.callsign, station_id: station.id, status, comment });
      }
      onUpdate();
    } catch (err) {
      toast.error(`Could not save ${station.callsign}: ${(err as Error).message}`);
    } finally {
      setSaving((p) => ({ ...p, [station.id]: false }));
    }
  };

  // Save a comment on its own, when the field loses focus, so a comment typed for an
  // already-checked-in station is kept when the operator switches tabs.
  const saveComment = async (station: Station) => {
    const comment = comments[station.id];
    if (comment === undefined) return; // never touched
    const existing = findRecord(station);
    if (!existing) return;
    try {
      await updateCheckIn(existing.id, { comment });
      onUpdate();
    } catch (err) {
      toast.error(`Could not save comment: ${(err as Error).message}`);
    }
  };

  const statusColor = (status: CheckInStatus) => {
    if (status === "checked_in") return "bg-green-700 text-green-100";
    if (status === "short_time") return "bg-yellow-700 text-yellow-100";
    if (status === "early") return "bg-purple-700 text-purple-100";
    if (status === "not_heard") return "bg-red-700 text-red-100";
    return "";
  };

  const attendanceCount = checkIns.filter((c) => c.status === "checked_in" || c.status === "short_time" || c.status === "early").length;

  const filteredStations = stations.filter((station) => {
    const status = statusOf(station);
    if (filter === "not_heard" && status !== "not_heard") return false;
    if (filter === "hide_early_short" && (status === "early" || status === "short_time")) return false;
    if (filter === "guests" && status !== "guest") return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return [station.callsign, station.name, station.city, station.state].some((v) => v?.toLowerCase().includes(q));
    }
    return true;
  });

  // The "current" station is the first in the filtered list with no record yet.
  const currentStationId = filteredStations.find((s) => !hasRecord(s) && !isInactive(s))?.id;

  const filterButtons: { id: Filter; label: string; on: string; icon?: boolean }[] = [
    { id: "all", label: "All", on: "bg-blue-600" },
    { id: "hide_early_short", label: "Hide Earlies/Short Time", on: "bg-yellow-600" },
    { id: "guests", label: "Guests", on: "bg-orange-600" },
    { id: "not_heard", label: "Not Heard", on: "bg-red-700", icon: true },
  ];

  const actions: { status: CheckInStatus; icon: typeof Clock; on: string; hover: string; title: string }[] = [
    { status: "checked_in", icon: CheckCircle2, on: "bg-green-600", hover: "hover:bg-green-700", title: "Checked in" },
    { status: "short_time", icon: Clock, on: "bg-yellow-600", hover: "hover:bg-yellow-700", title: "Short time" },
    { status: "early", icon: Zap, on: "bg-purple-600", hover: "hover:bg-purple-700", title: "Early" },
    { status: "not_heard", icon: VolumeX, on: "bg-red-600", hover: "hover:bg-gray-600", title: "Not heard" },
  ];

  let lastState: string | null = null;

  return (
    <Card className="bg-gray-900 border-gray-700 mt-4">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-white flex items-center gap-2 flex-wrap">
            <Radio className="w-5 h-5 text-green-400" />
            Standard Roll Call — {stations.length} stations
            <span className="text-sm font-normal text-green-400 ml-2">({attendanceCount} attending)</span>
          </CardTitle>
          <div className="flex gap-2 flex-wrap">
            {filterButtons.map((f) => (
              <Button
                key={f.id}
                size="sm"
                onClick={() => setFilter(f.id)}
                className={`h-7 px-3 text-xs ${filter === f.id ? `${f.on} text-white` : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
              >
                {f.icon && <VolumeX className="w-3 h-3 mr-1" />}
                {f.label}
              </Button>
            ))}
            {(inactiveCount > 0 || showInactive) && (
              <Button
                size="sm"
                onClick={() => setShowInactive((v) => !v)}
                aria-pressed={showInactive}
                className={`h-7 px-3 text-xs ${showInactive ? "bg-amber-600 hover:bg-amber-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
              >
                Include inactive ({inactiveCount})
              </Button>
            )}
          </div>
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search callsign, name, city, state..."
            aria-label="Search the roster"
            className="pl-8 bg-gray-800 border-gray-600 text-white text-sm h-8 w-full"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filteredStations.length === 0 ? (
          <p className="text-gray-500 text-center py-8 px-4">{stations.length === 0 ? (showInactive ? "No stations on the roster for this net." : "No active stations on roster for this net.") : "No stations match this filter."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-gray-400 font-medium px-4 py-2.5 w-8">#</th>
                  <th className="text-left text-gray-400 font-medium px-4 py-2.5 w-28">Callsign</th>
                  <th className="text-left text-gray-400 font-medium px-4 py-2.5">Name</th>
                  <th className="text-left text-gray-400 font-medium px-4 py-2.5 w-16 hidden sm:table-cell">State</th>
                  <th className="text-left text-gray-400 font-medium px-4 py-2.5 hidden md:table-cell">City</th>
                  <th className="text-left text-gray-400 font-medium px-4 py-2.5 w-44">Comment</th>
                  <th className="text-left text-gray-400 font-medium px-4 py-2.5 w-24 hidden sm:table-cell">Status</th>
                  <th className="text-right text-gray-400 font-medium px-4 py-2.5 w-28">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredStations.map((station, idx) => {
                  const status = statusOf(station);
                  const existing = findRecord(station);
                  const isSaving = saving[station.id];
                  const hasRec = hasRecord(station);
                  const isCurrent = station.id === currentStationId;
                  const stateLabel = station.state || "—";
                  const showStateHeader = stateLabel !== lastState;
                  lastState = stateLabel;
                  return (
                    <Fragment key={station.id}>
                      {showStateHeader && (
                        <tr className="bg-gray-800/60">
                          <td colSpan={8} className="px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-blue-400">{stateLabel}</td>
                        </tr>
                      )}
                      <tr
                        data-callsign={station.callsign}
                        className={`border-b border-gray-800 ${
                          isCurrent ? "bg-green-900/30 ring-2 ring-green-500 ring-inset"
                            : status === "not_heard" && hasRec ? "bg-red-900/20"
                            : status === "early" ? "opacity-30"
                            : idx % 2 === 0 ? "bg-gray-800/10 hover:bg-gray-800/40" : "bg-gray-800/30 hover:bg-gray-800/40"
                        }`}
                      >
                        <td className="px-4 py-2 text-xs">
                          {isCurrent ? <ChevronRight className="w-4 h-4 text-green-400 animate-pulse" /> : <span className="text-gray-600">{idx + 1}</span>}
                        </td>
                        <td className="px-4 py-2 font-mono font-bold text-green-400">{station.callsign}</td>
                        <td className="px-4 py-2 text-white">{station.name}{isInactive(station) && <Badge className="ml-2 bg-amber-900 text-amber-300 text-xs">Inactive</Badge>}</td>
                        <td className="px-4 py-2 text-gray-400 hidden sm:table-cell">{station.state || "—"}</td>
                        <td className="px-4 py-2 text-gray-400 hidden md:table-cell">{station.city || "—"}</td>
                        <td className="px-4 py-2">
                          <Input
                            value={station.id in comments ? comments[station.id] : existing?.comment || ""}
                            onChange={(e) => setComments((p) => ({ ...p, [station.id]: e.target.value }))}
                            onBlur={() => saveComment(station)}
                            placeholder="Comment..."
                            aria-label={`Comment for ${station.callsign}`}
                            className="bg-gray-800 border-gray-600 text-white text-xs w-full h-7"
                          />
                        </td>
                        <td className="px-4 py-2 hidden sm:table-cell">
                          <Badge className={`${hasRec ? statusColor(status) : "bg-gray-800 text-gray-500"} text-xs whitespace-nowrap`}>
                            {hasRec ? status.replace("_", " ") : "—"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1 justify-end">
                            {actions.map((a) => (
                              <Button
                                key={a.status}
                                size="sm"
                                title={a.title}
                                aria-label={`${a.title}: ${station.callsign}`}
                                onClick={() => setStatus(station, a.status)}
                                disabled={isSaving}
                                className={`h-7 px-2 ${status === a.status && (a.status !== "not_heard" || hasRec) ? a.on : `bg-gray-700 ${a.hover}`}`}
                              >
                                <a.icon className="w-3.5 h-3.5" />
                              </Button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
