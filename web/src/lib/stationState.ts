// When a roster station counts as inactive. Pure so Node can test it (stationState.test.mjs).
// The server makes a station inactive after a net's max_absences sessions in a row without
// checking in (backend/pb_hooks/lib/roster.js); the roster screen shows the same rule.
// Each net sets its own limit. 3 is the default; 0 means the net never drops anyone for absences.
export const DEFAULT_MAX_ABSENCES = 3;

export const isInactive = (s: { active: boolean; consecutive_absences: number }, maxAbsences: number = DEFAULT_MAX_ABSENCES): boolean =>
  !s.active || (maxAbsences > 0 && s.consecutive_absences >= maxAbsences);
