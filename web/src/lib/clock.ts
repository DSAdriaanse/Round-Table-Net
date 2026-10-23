// Time-of-day text for the net control clock. Pure so Node can test it (clock.test.mjs).

/** 24-hour HH:MM:SS for a moment in a time zone (UTC by default; undefined timeZone means the device's own). */
export function hms(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone }).format(date);
}

/** Zulu (UTC) and local time as "HH:MM:SSZ" and "HH:MM:SSL". `localZone` overrides the device's zone (used by tests). */
export function clockText(date: Date, localZone?: string): { zulu: string; local: string } {
  return { zulu: `${hms(date, "UTC")}Z`, local: `${hms(date, localZone)}L` };
}

/** Milliseconds from `now` to the start of the next whole second, so a clock can tick exactly on the second. */
export const msToNextSecond = (now: Date): number => 1000 - now.getMilliseconds();
