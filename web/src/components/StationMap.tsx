import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Map as MapIcon } from "lucide-react";
import type { CheckInStatus, Station } from "@/api";

/** Marker colour for a check-in status tonight (blue = no status / just on the roster). */
export function statusColor(status: CheckInStatus | null): string {
  if (status === "checked_in") return "#22c55e";
  if (status === "short_time") return "#eab308";
  if (status === "not_heard") return "#6b7280";
  return "#3b82f6";
}

// A dark map with one dot per station. Shared by the dashboard and the roster view.
// Stations without coordinates (0, 0) must be filtered out by the caller.
export default function StationMap({ stations, statusOf, height = 400 }: { stations: Station[]; statusOf?: (s: Station) => CheckInStatus | null; height?: number }) {
  if (stations.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <MapIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>No geocoded stations yet.</p>
          <p className="text-sm">Add city/state to stations in the roster.</p>
        </div>
      </div>
    );
  }
  return (
    <MapContainer center={[34.0, -109.5]} zoom={6} style={{ height, width: "100%" }} className="rounded-b-lg">
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='© <a href="https://carto.com/">CARTO</a>' />
      {stations.map((s) => {
        const status = statusOf ? statusOf(s) : null;
        const color = statusColor(status);
        return (
          <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={8} pathOptions={{ fillColor: color, color, weight: 2, opacity: 1, fillOpacity: 0.8 }}>
            <Popup>
              <div className="p-1">
                <div className="font-mono font-bold text-green-600 text-lg">{s.callsign}</div>
                <div>{s.name}</div>
                <div className="text-gray-500 text-sm">{[s.city, s.state].filter(Boolean).join(", ")}</div>
                {status && <div className="mt-1 capitalize text-xs" style={{ color }}>{status.replace("_", " ")}</div>}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
