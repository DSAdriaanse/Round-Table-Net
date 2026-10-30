import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listCheckIns, listStations, watchCheckIns, watchStations } from "@/api";
import type { CheckIn, Station } from "@/api";
import { useNet } from "@/components/NetContext";
import { DEFAULT_MAX_ABSENCES, isInactive } from "@/lib/stationState";

// Shared, live-updating copies of the roster and of a session's check-ins. Every screen
// that asks for the same thing shares one cache entry, and the server's live updates
// keep it current, so several net control operators on one net stay in sync.

// Live roster updates for one net. `activeOnly` says whether the cache holds only
// active stations (so a station that becomes inactive drops out of it).
function useStationSubscription(netId: string | undefined, queryKey: unknown[], activeOnly: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!netId) return;
    return watchStations((event) => {
      const station = event.data;
      if (!station || station.net_id !== netId) return;

      queryClient.setQueryData<Station[]>(queryKey, (prev) => {
        if (!Array.isArray(prev)) return prev;

        if (event.type === "delete") return prev.filter((s) => s.id !== event.id);

        const isActive = station.active !== false;
        const existingIdx = prev.findIndex((s) => s.id === event.id);

        if (event.type === "create") {
          if (activeOnly && !isActive) return prev;
          if (existingIdx >= 0) return prev; // already present
          return [...prev, station];
        }

        // update
        if (activeOnly && !isActive) return prev.filter((s) => s.id !== event.id); // became inactive
        if (existingIdx >= 0) {
          const next = [...prev];
          next[existingIdx] = station;
          return next;
        }
        return [...prev, station]; // became active (or not in the cache yet)
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netId, queryClient]);
}

/** "Is this station inactive?" using the absence limit of the given net (see lib/stationState.ts). */
export function useIsInactive(netId: string | undefined) {
  const { nets } = useNet();
  const limit = nets.find((n) => n.id === netId)?.max_absences ?? DEFAULT_MAX_ABSENCES;
  return (s: { active: boolean; consecutive_absences: number }) => isInactive(s, limit);
}

/** Active roster for a net. */
export function useActiveRoster(netId: string | undefined) {
  const queryKey = ["stations", "active", netId];
  useStationSubscription(netId, queryKey, true);
  return useQuery({
    queryKey,
    queryFn: () => listStations(netId!, true),
    enabled: !!netId,
    staleTime: 30000,
  });
}

/** All stations (active and inactive) for a net. */
export function useAllStations(netId: string | undefined) {
  const queryKey = ["stations", "all", netId];
  useStationSubscription(netId, queryKey, false);
  return useQuery({
    queryKey,
    queryFn: () => listStations(netId!, false),
    enabled: !!netId,
    staleTime: 30000,
  });
}

/** Check-ins of one session, kept live. */
export function useSessionCheckIns(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["checkins", sessionId];

  const query = useQuery({
    queryKey,
    queryFn: () => listCheckIns(sessionId!),
    enabled: !!sessionId,
    staleTime: 5000,
  });

  useEffect(() => {
    if (!sessionId) return;
    return watchCheckIns((event) => {
      if (event.data?.session_id !== sessionId) return; // another session
      queryClient.setQueryData<CheckIn[]>(queryKey, (prev) => {
        if (!Array.isArray(prev)) return prev;
        if (event.type === "create") return prev.find((c) => c.id === event.id) ? prev : [...prev, event.data];
        if (event.type === "update") return prev.map((c) => (c.id === event.id ? event.data : c));
        if (event.type === "delete") return prev.filter((c) => c.id !== event.id);
        return prev;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, queryClient]);

  return query;
}
