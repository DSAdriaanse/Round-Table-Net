// Looks up map coordinates for a US city and state with OpenStreetMap's free Nominatim
// service (the only outside service the browser contacts). Its usage policy allows about
// one request per second, so callers that loop must wait between calls (GEOCODE_DELAY_MS).
export const GEOCODE_DELAY_MS = 1100;

/** Resolves with coordinates, or null when the place is not found or the lookup fails. */
export async function geocode(city: string, state: string): Promise<{ lat: number; lng: number } | null> {
  if (!city || !state) return null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&country=USA&format=json&limit=1`);
    if (!res.ok) return null;
    const data = (await res.json()) as { lat: string; lon: string }[];
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    /* network problem: treat as not found */
  }
  return null;
}
