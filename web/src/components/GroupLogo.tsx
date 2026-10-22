import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSettings, logoUrl } from "@/api";

// The club's logo at the top of the sidebar, with a subtle line under it. Shows nothing until a logo is
// uploaded in Settings. The picture is stretched to the sidebar's width, keeping its proportions, up to a
// maximum height, so a small logo is scaled up and a wide one fills the width. A transparent PNG shows the
// sidebar through it. In the collapsed (narrow) sidebar it shrinks to a small mark.
export default function GroupLogo({ collapsed = false }: { collapsed?: boolean }) {
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 5 * 60_000 });
  const url = logoUrl(settings);
  const [failed, setFailed] = useState("");
  if (!url || failed === url) return null;

  return (
    <div className={`border-b border-gray-800 flex justify-center ${collapsed ? "px-1.5 py-2" : "px-3 py-3"}`}>
      <img
        src={url}
        alt={`${settings?.club_name || "Group"} logo`}
        onError={() => setFailed(url)}
        className={`w-full object-contain ${collapsed ? "max-h-10" : "max-h-32"}`}
      />
    </div>
  );
}
