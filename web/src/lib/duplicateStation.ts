// Recognise PocketBase's refusal to add a station whose callsign is already on that net's roster
// (the roster has a unique index on net + callsign). Pure so Node can test it (duplicateStation.test.mjs).
//
// The refusal looks like: { response: { data: { callsign: { code: "validation_not_unique" }, net_id: { ... } } } }
export function isDuplicateStation(err: unknown): boolean {
  const data = (err as { response?: { data?: Record<string, { code?: string } | undefined> } } | null)?.response?.data;
  return data?.callsign?.code === "validation_not_unique" || data?.net_id?.code === "validation_not_unique";
}
