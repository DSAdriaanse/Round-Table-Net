#!/usr/bin/env node
// Checks an imported database for broken links and wrong counts. Exits 1 if anything is off.
//   PB_URL=... PB_SUPERUSER_EMAIL=... PB_SUPERUSER_PASSWORD=... node scripts/verify-import.mjs [nets stations sessions check_ins announcements]
// With five numbers it also checks the row counts (the bundled example data is: 3 120 12 174 2).
const PB = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const expected = process.argv.slice(2).map(Number);
const call = async (p, o = {}) => {
  const r = await fetch(PB + p, { ...o, headers: { "content-type": "application/json", ...(o.headers || {}) } });
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
};
const { token } = await call("/api/collections/_superusers/auth-with-password", { method: "POST", body: JSON.stringify({ identity: process.env.PB_SUPERUSER_EMAIL, password: process.env.PB_SUPERUSER_PASSWORD }) });
// every page: a roster or check-in list can be longer than one page of 500
const all = async (c) => {
  const items = [];
  for (let page = 1; ; page++) {
    const r = await call(`/api/collections/${c}/records?perPage=500&page=${page}`, { headers: { authorization: token } });
    items.push(...r.items);
    if (page >= r.totalPages) return items;
  }
};
const [nets, stations, sessions, checkIns, announcements] = await Promise.all(["nets", "stations", "net_sessions", "check_ins", "announcements"].map(all));

const nid = new Set(nets.map((x) => x.id)), sid = new Set(sessions.map((x) => x.id)), stid = new Set(stations.map((x) => x.id));
const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); };
check(stations.every((s) => nid.has(s.net_id)), "a station points at a missing net");
check(sessions.every((s) => nid.has(s.net_id)), "a session points at a missing net");
check(checkIns.every((c) => sid.has(c.session_id)), "a check-in points at a missing session");
check(checkIns.every((c) => !c.station_id || stid.has(c.station_id)), "a check-in points at a missing station");
check([...nets, ...stations, ...sessions, ...checkIns, ...announcements].every((x) => x.legacy_id), "a record has no legacy_id");
const wrong = sessions.filter((s) => checkIns.filter((c) => c.session_id === s.id && c.status !== "not_heard").length !== s.checkin_count);
check(wrong.length === 0, `${wrong.length} session(s) whose stored check-in count differs from their check-ins`);
const counts = [nets, stations, sessions, checkIns, announcements].map((x) => x.length);
if (expected.length === 5) check(counts.every((n, i) => n === expected[i]), `counts ${counts.join(" ")} differ from the expected ${expected.join(" ")}`);

console.log(`nets ${counts[0]}, stations ${counts[1]}, sessions ${counts[2]}, check-ins ${counts[3]}, announcements ${counts[4]}`);
if (problems.length) { problems.forEach((p) => console.error("PROBLEM: " + p)); process.exit(1); }
console.log("OK: links, legacy ids and counts check out");
