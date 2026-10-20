#!/usr/bin/env node
// Read-only check for orphaned records: rows whose link points at a net, session or station that is not there.
//   PB_URL=http://127.0.0.1:8090 PB_SUPERUSER_EMAIL=... PB_SUPERUSER_PASSWORD=... node scripts/find-orphans.mjs
// Prints what it found and exits 1 if there is anything, 0 if all links are intact. It never changes data.
//
// PocketBase enforces these links as relations: it refuses to save a row that points at nothing, deleting a
// net or session deletes what belongs to it, and deleting a station clears the station link on its check-ins.
// So a healthy install reports nothing. This is a safety check for after an import, a restore or a manual
// edit of the database file.
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Pure: tables in, a list of { what, count, ids } out. */
export function findOrphans({ nets = [], stations = [], sessions = [], checkIns = [] }) {
  const ids = (rows) => new Set(rows.map((r) => r.id));
  const N = ids(nets), S = ids(sessions), T = ids(stations);
  const rules = [
    ["stations whose net is missing", stations, (r) => !N.has(r.net_id)],
    ["sessions whose net is missing", sessions, (r) => !N.has(r.net_id)],
    ["check-ins whose session is missing", checkIns, (r) => !S.has(r.session_id)],
    ["check-ins whose net is missing", checkIns, (r) => r.net_id && !N.has(r.net_id)],
    ["check-ins whose roster station is missing", checkIns, (r) => r.station_id && !T.has(r.station_id)],
  ];
  return rules.map(([what, rows, bad]) => ({ what, hits: rows.filter(bad) })).filter((x) => x.hits.length)
    .map(({ what, hits }) => ({ what, count: hits.length, ids: hits.slice(0, 20).map((r) => r.id) }));
}

async function main() {
  const PB = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
  const call = async (p, o = {}) => {
    const r = await fetch(PB + p, { ...o, headers: { "content-type": "application/json", ...(o.headers || {}) } });
    if (!r.ok) throw new Error(`${p} -> ${r.status}`);
    return r.json();
  };
  const { token } = await call("/api/collections/_superusers/auth-with-password", { method: "POST", body: JSON.stringify({ identity: process.env.PB_SUPERUSER_EMAIL, password: process.env.PB_SUPERUSER_PASSWORD }) });
  const all = async (c) => {
    const items = [];
    for (let page = 1; ; page++) {
      const r = await call(`/api/collections/${c}/records?perPage=500&page=${page}`, { headers: { authorization: token } });
      items.push(...r.items);
      if (page >= r.totalPages) return items;
    }
  };
  const [nets, stations, sessions, checkIns] = await Promise.all(["nets", "stations", "net_sessions", "check_ins"].map(all));
  const found = findOrphans({ nets, stations, sessions, checkIns });
  console.log(`checked ${nets.length} nets, ${stations.length} stations, ${sessions.length} sessions, ${checkIns.length} check-ins`);
  if (!found.length) { console.log("OK: no orphaned records"); return; }
  for (const f of found) console.error(`ORPHANS: ${f.count} ${f.what} (ids: ${f.ids.slice(0, 5).join(", ")}${f.count > 5 ? ", ..." : ""})`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error("FAILED:", e.message); process.exit(2); });
}
