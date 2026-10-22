// Which map tiles to draw. The club can set a tile provider and API key in Settings; without one, or with one
// that cannot work, the map falls back to CARTO's dark tiles. CARTO now wants a (free) key on its tile requests:
// without one its tiles carry an "API KEY REQUIRED" watermark, so the fallback is a stopgap, not a working default. Pure and relative-import only so Node can
// test it (tileConfig.test.mjs).

export const DEFAULT_TILES = {
  url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution: '© OpenStreetMap contributors, © <a href="https://carto.com/">CARTO</a>', // fixed text of ours, so it is not escaped
};

export interface TileSettings { map_tile_url?: string; map_attribution?: string; map_api_key?: string }
export interface TileChoice { url: string; attribution: string; custom: boolean; problem: string }

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The tile address, credit line and, if a custom setup was rejected, why. `url` is always usable.
 * - The address must be https and contain {z}, {x} and {y}.
 * - A {key} placeholder is replaced by the key (URL-encoded); an address with {key} but no key is rejected.
 * - The credit line is plain text; it is escaped because Leaflet inserts it as HTML.
 */
export function tileLayerFor(settings: TileSettings | null | undefined): TileChoice {
  const fallback = (problem: string): TileChoice => ({ ...DEFAULT_TILES, custom: false, problem });
  const template = (settings?.map_tile_url || "").trim();
  if (!template) return fallback("");
  if (!/^https:\/\//i.test(template)) return fallback("The tile address must start with https://");
  if (!["{z}", "{x}", "{y}"].every((part) => template.includes(part))) return fallback("The tile address needs {z}, {x} and {y} in it.");

  const key = (settings?.map_api_key || "").trim();
  if (template.includes("{key}") && !key) return fallback("The tile address has {key} in it but no API key is set.");
  const url = template.split("{key}").join(encodeURIComponent(key));

  let host = "";
  try { host = new URL(url.replace(/\{[a-z]\}/g, "a")).hostname; } catch { return fallback("The tile address is not a valid web address."); }
  const credit = (settings?.map_attribution || "").trim();
  return { url, attribution: escapeHtml(credit || `Map tiles: ${host}`), custom: true, problem: "" };
}
