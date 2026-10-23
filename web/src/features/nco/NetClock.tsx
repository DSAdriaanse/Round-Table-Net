import { useEffect, useState } from "react";
import { clockText, msToNextSecond } from "@/lib/clock";

// Zulu (UTC) and local time for the net control screen, ticking every second on the second.
// "Local" is the time zone of the device the operator is using.
export default function NetClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = new Date();
      setNow(current);
      timer = setTimeout(tick, msToNextSecond(current)); // re-aimed each time, so it does not drift
    };
    timer = setTimeout(tick, msToNextSecond(new Date()));
    return () => clearTimeout(timer);
  }, []);

  const { zulu, local } = clockText(now);
  return (
    <div role="timer" aria-label="Current time, Zulu and local" className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 font-mono tabular-nums leading-tight">
      <div className="text-green-400 text-base">{zulu}</div>
      <div className="text-gray-400 text-sm">{local}</div>
    </div>
  );
}
