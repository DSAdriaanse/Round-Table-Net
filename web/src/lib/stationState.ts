// When a roster station counts as inactive. Pure so Node can test it (stationState.test.mjs).
// The server makes a station inactive after this many sessions in a row without checking in
// (backend/pb_hooks/lib/roster.js); the roster screen shows the same rule.
export const MAX_ABSENCES = 3;

export const isInactive = (s: { active: boolean; consecutive_absences: number }): boolean =>
  !s.active || s.consecutive_absences >= MAX_ABSENCES;
