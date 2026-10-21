// The row logic of the Pileup Logger, kept free of React so it can be tested on its own
// (pileupRow.test.mjs). Imports are type-only and relative so Node can run this file directly.
import type { CheckInStatus, Station } from "../../api/types";

export interface Row {
  callsign: string; name: string; location: string; state: string; comment: string;
  isGuest: boolean; matched: boolean; station: Station | null; status: CheckInStatus;
}

export const makeRow = (defaultStatus: CheckInStatus): Row => ({
  callsign: "", name: "", location: "", state: "", comment: "",
  isGuest: false, matched: false, station: null, status: defaultStatus,
});

/** Fill a row from a roster station. The row's status is left as the operator or the default set it. */
export function matchRow(row: Row, station: Station): Row {
  return {
    ...row, callsign: station.callsign, name: station.name || "", location: station.city || "", state: station.state || "",
    matched: true, isGuest: false, station,
  };
}

/**
 * Apply a typed callsign. An exact roster match fills the row in; anything else is flagged as a guest.
 * Being a guest is the `isGuest` flag only. `status` is never set to "guest" here, because a callsign
 * typed one character at a time passes through non-matches on the way to a roster match, and a status
 * written along the way would stay on the row.
 */
export function typeCallsign(row: Row, value: string, stations: Station[]): Row {
  const callsign = value.trim().toUpperCase();
  const exact = stations.find((s) => s.callsign === callsign);
  if (exact) return matchRow(row, exact);
  return {
    ...row, callsign,
    ...(row.matched ? { name: "", location: "", state: "" } : {}),
    matched: false, isGuest: true, station: null,
  };
}

/** The status a row is saved with: guests are "guest", roster stations keep their chosen status. */
export const finalStatus = (row: Row): CheckInStatus => (row.isGuest ? "guest" : row.status);
