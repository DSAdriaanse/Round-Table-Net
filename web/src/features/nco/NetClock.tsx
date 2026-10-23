import { useEffect, useState } from "react";
import { clockText, msToNextSecond } from "@/lib/clock";

// Zulu (UTC) on the left and local time on the right, large and bold so the operator can read them at a glance,
// ticking every second on the second.
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
    <div role="timer" aria-label="Current time, Zulu and local" className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 font-mono font-bold tabular-nums leading-tight flex items-center gap-5 text-xl sm:text-2xl">
      <span className="text-green-400">{zulu}</span>
      <span className="text-white">{local}</span>
    </div>
  );
}
