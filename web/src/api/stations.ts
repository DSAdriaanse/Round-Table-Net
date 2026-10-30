// The roster: stations that normally check in to a net.
import { inBatches, table } from "./records";
import type { Station } from "./types";

export { isDuplicateStation } from "../lib/duplicateStation";

const stations = table<Station>("stations");

/** Everyone on a net's roster, or only the active ones. */
export const listStations = (netId: string, activeOnly = false) =>
  stations.list({ sort: "-created_date", where: activeOnly ? { net_id: netId, active: true } : { net_id: netId } });

/** Every roster entry with this callsign on this net (normally 0 or 1). */
export const findStationsByCallsign = (netId: string, callsign: string) =>
  stations.list({ limit: 10, where: { net_id: netId, callsign } });

export const createStation = (data: Partial<Station>) => stations.create(data);
export const updateStation = (id: string, data: Partial<Station>) => stations.update(id, data);
export const deleteStation = (id: string) => stations.remove(id);

export const deleteStations = (ids: string[]) => inBatches(ids, 20, (id) => stations.remove(id));

/** Bulk add, a few at a time. Rows the server refuses (for example a callsign already on the net) are counted, not fatal. */
export async function createStations(rows: Partial<Station>[]): Promise<{ created: number; failed: number }> {
  const results = await inBatches(rows, 20, (row) => stations.create(row).then(() => true, () => false));
  const created = results.filter(Boolean).length;
  return { created, failed: results.length - created };
}

/** Live roster changes from anyone (every net; filter by net_id in the callback). */
export const watchStations = stations.watch;
