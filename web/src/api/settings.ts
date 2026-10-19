// The one settings record (non-secret configuration).
import { table } from "./records";
import type { Settings } from "./types";

const settings = table<Settings>("settings");

export async function getSettings(): Promise<Settings | null> {
  const rows = await settings.list({ limit: 1, sort: "created_date" });
  return rows[0] || null;
}
export const updateSettings = (id: string, data: Partial<Settings>) => settings.update(id, data);
