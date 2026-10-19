// Check-ins: one row per station per session.
import { table } from "./records";
import type { CheckIn } from "./types";

const checkIns = table<CheckIn>("check_ins");

export const listCheckIns = (sessionId: string) => checkIns.list({ sort: "created_date", where: { session_id: sessionId } });
export const createCheckIn = (data: Partial<CheckIn>) => checkIns.create(data);
export const updateCheckIn = (id: string, data: Partial<CheckIn>) => checkIns.update(id, data);
export const deleteCheckIn = (id: string) => checkIns.remove(id);

/** Live check-in changes from anyone (every session; filter by session_id in the callback). */
export const watchCheckIns = checkIns.watch;
