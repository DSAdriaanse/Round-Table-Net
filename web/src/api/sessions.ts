// Sessions: one meeting of a net, from "open" to "closed", and the routes that move it along.
import { post, table } from "./records";
import type { NetSession, SessionStatus } from "./types";

const sessions = table<NetSession>("net_sessions");

export const getSession = (id: string) => sessions.get(id);
export const updateSession = (id: string, data: Partial<NetSession>) => sessions.update(id, data);

/** Deleting a session also deletes its check-ins (the server cascades it). */
export const deleteSession = (id: string) => sessions.remove(id);

/** The session the operator is running on this net, if any (newest first). */
export async function findOpenSession(netId: string): Promise<NetSession | null> {
  const rows = await sessions.list({ sort: "-opened_at", limit: 1, where: { net_id: netId, status: "open" } });
  return rows[0] || null;
}

/** Sessions of a net in the given states, newest first. */
export const listSessions = (netId: string, statuses: SessionStatus[], limit = 200) =>
  sessions.list({ sort: "-opened_at", limit, where: { net_id: netId, status: statuses } });

export const openSession = (data: { net_id: string; net_name: string; nco_callsign: string; topic: string }) =>
  sessions.create({
    ...data,
    date: new Date().toISOString().split("T")[0],
    status: "open",
    opened_at: new Date().toISOString(),
  });

export interface CloseResult { status: SessionStatus; checkin_count: number; guests_added: number }

/** Close the running session: guests join the roster for review and the roster update is queued. */
export const closeSession = (session_id: string, technical_difficulty: boolean) =>
  post<CloseResult>("/api/rt/session/close", { session_id, technical_difficulty });

/** Update the roster for pending sessions now instead of waiting for the 15-minute job. */
export const processPendingNow = () =>
  post<{ success: boolean; processed: number; updatedStations?: number; checkinCount?: number; message?: string }>("/api/rt/session/process", {});

/** Post the session report to WordPress. Rejects with the server's reason if it cannot. */
export const publishReport = (session_id: string) =>
  post<{ success: boolean; post_url: string; post_id: number }>("/api/rt/session/publish", { session_id });

