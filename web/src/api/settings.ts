// The one settings record (non-secret configuration).
import { pb } from "./pb";
import { table } from "./records";
import type { Settings } from "./types";

const settings = table<Settings>("settings");

export async function getSettings(): Promise<Settings | null> {
  const rows = await settings.list({ limit: 1, sort: "created_date" });
  return rows[0] || null;
}
export const updateSettings = (id: string, data: Partial<Settings>) => settings.update(id, data);

/** Upload (or replace) the group logo. The server checks type and size; the pixel size is checked before this is called. */
export function uploadLogo(id: string, file: File): Promise<Settings> {
  const body = new FormData();
  body.append("logo", file);
  return pb.collection("settings").update<Settings>(id, body);
}

/** Remove the group logo. */
export const removeLogo = (id: string) => pb.collection("settings").update<Settings>(id, { logo: null });

/** The address of the logo image, or "" when none is set. A new upload gets a new file name, so a cached copy is never reused. */
export const logoUrl = (settings: Pick<Settings, "id" | "logo"> | null | undefined): string =>
  settings?.logo ? pb.files.getURL({ id: settings.id, collectionName: "settings" }, settings.logo) : "";
