// The routes anyone can call, no sign-in: used by the public check-in page.
import { get, post, type RouteError } from "./records";
import type { PublicCheckInResult, PublicNet, PublicSession } from "./types";

export const publicNets = () => get<PublicNet[]>("/api/rt/public/nets");
export const publicSession = (netId: string) => get<PublicSession>("/api/rt/public/session", { net: netId });

/**
 * Check in to the open session of a net. Resolves with what happened:
 * "checked_in", "already" (that callsign is already in) or "no_session" (nothing is open).
 * Anything else (bad callsign, server down) rejects with the server's message.
 */
export async function publicCheckIn(body: { net_id: string; callsign: string; name: string; location: string; comment: string }): Promise<PublicCheckInResult> {
  try {
    await post("/api/rt/public/checkin", body);
    return "checked_in";
  } catch (e) {
    const err = e as RouteError;
    const result = err.response?.data?.result;
    if (err.status === 409 && result === "already") return "already";
    if (err.status === 404 && result === "no_session") return "no_session";
    throw err;
  }
}
