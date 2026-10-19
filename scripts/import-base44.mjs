#!/usr/bin/env node
// Import a Base44 CSV export (Net, Station, NetSession, CheckIn, Announcement) into PocketBase.
//
//   PB_URL=http://127.0.0.1:8090 PB_SUPERUSER_EMAIL=... PB_SUPERUSER_PASSWORD=... \
//   node scripts/import-base44.mjs <folder-with-*_export.csv> [--dry-run] [--allow-nonempty]
//
// What it does
//   * Base44 ids (24 hex characters) become PocketBase ids. The old id is kept in each record's
//     legacy_id field, and every link (station -> net, session -> net, check-in -> session and
//     station) is rewritten to the new ids.
//   * created_date / updated_date are collected into restore-dates.sql (PocketBase stamps its own
//     dates and cannot be told otherwise). Applying it is optional; see the note printed at the end.
//   * Callsigns are trimmed and upper-cased. Blank numbers become 0; a blank checkin_count is
//     recomputed from the session's check-ins (everyone except "not heard").
//   * Rows that point at a net, session or station that is not in the export are skipped and counted
//     (the old app left such rows behind when a net was deleted). Nothing is invented for them.
//   * Rows flagged is_sample in the export are skipped.
//   * The old data holds repeated check-ins for one callsign in one session. They are imported as they
//     are (the server refuses new ones, but this script signs in as superuser).
// --dry-run reads and checks the files and prints what would happen; it contacts no server.
// Without --allow-nonempty it refuses to import into a database that already has nets.
// Nothing is ever deleted or overwritten.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- tiny RFC 4180 CSV parser (quoted fields, doubled quotes, embedded newlines)
export function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const bool = (v) => String(v).toLowerCase() === "true";
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const callsign = (v) => String(v || "").trim().toUpperCase();
// "2026-10-19T00:42:20.840000" (UTC, no zone) or an ISO string with Z -> PocketBase's "YYYY-MM-DD HH:MM:SS.mmmZ"
export function pbDate(v) {
  if (!v) return "";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + "Z");
  return isNaN(d) ? "" : d.toISOString().replace("T", " ");
}
const iso = (v) => { const s = pbDate(v); return s ? s.replace(" ", "T") : ""; };

/**
 * Turns the parsed export into the records to create, in order, with links expressed as old ids.
 * Pure (no network), so --dry-run and the tests use exactly what the real run uses.
 */
export function plan(tables) {
  const notes = [];
  const skipped = {};
  const skip = (kind, why) => { skipped[why] = (skipped[why] || 0) + 1; return null; };
  const missing = { net: new Set(), session: new Set() };
  const live = (rows) => (rows || []).filter((r) => r.is_sample !== "true");

  const nets = live(tables.Net).map((r) => ({ old: r.id, dates: [r.created_date, r.updated_date], data: {
    name: r.name, day_of_week: r.day_of_week, time: r.time, frequency: r.frequency, preamble: r.preamble, closing: r.closing, legacy_id: r.id } }));
  const netIds = new Set(nets.map((n) => n.old));

  const stations = []; const stationKeys = new Set();
  for (const r of live(tables.Station)) {
    if (!netIds.has(r.net_id)) { missing.net.add(r.net_id); skip("station", "stations skipped: their net is not in the export (deleted in the old app)"); continue; }
    const cs = callsign(r.callsign);
    if (!cs) { skip("station", "stations skipped: no callsign"); continue; }
    const key = r.net_id + "|" + cs;
    if (stationKeys.has(key)) { skip("station", "stations skipped: callsign repeated on the same net (first one kept)"); continue; }
    stationKeys.add(key);
    stations.push({ old: r.id, net: r.net_id, dates: [r.created_date, r.updated_date], data: {
      callsign: cs, name: (r.name || "").trim() || cs, city: r.city, state: r.state, lat: num(r.lat), lng: num(r.lng),
      permanent_attendance: bool(r.permanent_attendance), active: r.active === "" ? true : bool(r.active),
      consecutive_absences: Math.max(0, Math.round(num(r.consecutive_absences))), needs_review: bool(r.needs_review), legacy_id: r.id } });
  }
  const stationIds = new Set(stations.map((s) => s.old));
  // a check-in that names a station we dropped as a repeat should point at the kept one
  const keptByKey = new Map(stations.map((s) => [s.net + "|" + s.data.callsign, s.old]));

  const sessions = [];
  for (const r of live(tables.NetSession)) {
    if (!netIds.has(r.net_id)) { missing.net.add(r.net_id); skip("session", "sessions skipped: their net is not in the export (deleted in the old app)"); continue; }
    sessions.push({ old: r.id, net: r.net_id, dates: [r.created_date, r.updated_date], blankCount: r.checkin_count === "", data: {
      net_name: r.net_name, date: r.date, status: r.status || "closed", nco_callsign: callsign(r.nco_callsign), topic: r.topic, notes: r.notes,
      opened_at: iso(r.opened_at), closed_at: iso(r.closed_at), roster_updated: bool(r.roster_updated), technical_difficulty: bool(r.technical_difficulty),
      checkin_count: Math.round(num(r.checkin_count)), legacy_id: r.id } });
  }
  const sessionIds = new Set(sessions.map((s) => s.old));

  const checkIns = [];
  for (const r of live(tables.CheckIn)) {
    if (!sessionIds.has(r.session_id)) { missing.session.add(r.session_id); skip("check-in", "check-ins skipped: their session is not in the export (it belonged to a deleted net)"); continue; }
    const cs = callsign(r.callsign);
    if (!cs) { skip("check-in", "check-ins skipped: no callsign"); continue; }
    let station = r.station_id;
    if (station && !stationIds.has(station)) station = keptByKey.get(r.net_id + "|" + cs) || "";
    checkIns.push({ old: r.id, session: r.session_id, station, net: netIds.has(r.net_id) ? r.net_id : "", dates: [r.created_date, r.updated_date], data: {
      callsign: cs, status: r.status || "checked_in", comment: r.comment, name: r.name, location: r.location, legacy_id: r.id } });
  }

  // Sessions without a stored count get one from their check-ins.
  const attended = new Map();
  for (const c of checkIns) if (c.data.status !== "not_heard") attended.set(c.session, (attended.get(c.session) || 0) + 1);
  let recomputed = 0;
  for (const s of sessions) if (s.blankCount) { s.data.checkin_count = attended.get(s.old) || 0; recomputed++; }
  if (recomputed) notes.push(`${recomputed} session(s) had no check-in count; it was worked out from their check-ins.`);

  const seen = new Map();
  for (const c of checkIns) { const k = c.session + "|" + c.data.callsign; seen.set(k, (seen.get(k) || 0) + 1); }
  const repeats = [...seen.values()].filter((n) => n > 1).length;
  if (repeats) notes.push(`${repeats} callsign(s) are checked in more than once in the same session in the old data. They are imported as they are.`);

  const announcements = live(tables.Announcement).map((r) => ({ old: r.id, dates: [r.created_date, r.updated_date], data: {
    text: r.text, order: Math.round(num(r.order)), active: r.active === "" ? true : bool(r.active), legacy_id: r.id } }));

  for (const [why, n] of Object.entries(skipped)) notes.push(`${n} ${why}.`);
  if (missing.net.size) notes.push(`Missing net id(s): ${[...missing.net].join(", ")}`);
  return { nets, stations, sessions, checkIns, announcements, notes, skipped };
}

export function loadFolder(dir) {
  const tables = {};
  for (const entity of ["Net", "Station", "NetSession", "CheckIn", "Announcement"]) {
    const f = fs.readdirSync(dir).find((n) => n === `${entity}_export.csv` || n.endsWith(`-${entity}_export.csv`) || n.endsWith(`_${entity}_export.csv`));
    tables[entity] = f ? parseCsv(fs.readFileSync(path.join(dir, f), "utf8")) : [];
    if (!f) console.error(`note: no ${entity}_export.csv in ${dir}`);
  }
  return tables;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const flag = (n) => args.includes(`--${n}`);
  if (!dir) { console.error("usage: import-base44.mjs <folder> [--dry-run] [--allow-nonempty]"); process.exit(2); }
  if (!fs.existsSync(dir)) { console.error(`folder not found: ${dir}`); process.exit(2); }
  const DRY = flag("dry-run");
  const PB = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/$/, "");

  const p = plan(loadFolder(dir));
  const counts = { nets: p.nets.length, stations: p.stations.length, sessions: p.sessions.length, check_ins: p.checkIns.length, announcements: p.announcements.length };

  if (!DRY) {
    let token = "";
    const api = async (method, url, body) => {
      const r = await fetch(PB + url, { method, headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not JSON */ }
      if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${t.slice(0, 300)}`);
      return j;
    };
    const email = process.env.PB_SUPERUSER_EMAIL, password = process.env.PB_SUPERUSER_PASSWORD;
    if (!email || !password) throw new Error("set PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD");
    token = (await api("POST", "/api/collections/_superusers/auth-with-password", { identity: email, password })).token;
    if (!flag("allow-nonempty") && (await api("GET", "/api/collections/nets/records?perPage=1&skipTotal=1")).items.length)
      throw new Error("nets already has records. Import into a fresh install, or pass --allow-nonempty.");

    const dateFixes = [];
    const create = async (col, item, extra = {}) => {
      const rec = await api("POST", `/api/collections/${col}/records`, { ...item.data, ...extra });
      const c = pbDate(item.dates[0]), u = pbDate(item.dates[1]) || c;
      if (c) dateFixes.push({ col, id: rec.id, c, u });
      return rec.id;
    };
    const netMap = new Map(), stationMap = new Map(), sessionMap = new Map();
    for (const n of p.nets) netMap.set(n.old, await create("nets", n));
    for (const s of p.stations) stationMap.set(s.old, await create("stations", s, { net_id: netMap.get(s.net) }));
    for (const s of p.sessions) sessionMap.set(s.old, await create("net_sessions", s, { net_id: netMap.get(s.net) }));
    for (const c of p.checkIns) await create("check_ins", c, { session_id: sessionMap.get(c.session), net_id: c.net ? netMap.get(c.net) : "", station_id: c.station ? stationMap.get(c.station) || "" : "" });
    for (const a of p.announcements) await create("announcements", a);

    if (dateFixes.length) {
      const out = path.resolve(process.env.DATES_SQL || "restore-dates.sql");
      fs.writeFileSync(out, "BEGIN;\n" + dateFixes.map((d) => `UPDATE ${d.col} SET created_date='${d.c}', updated_date='${d.u}' WHERE id='${d.id}';`).join("\n") + "\nCOMMIT;\n");
      p.notes.push(`Original timestamps: stop the app, run  sqlite3 /path/to/pb_data/data.db < ${out}  then start it again. Optional; it only affects ordering and history.`);
    }
  }

  console.log(DRY ? "DRY RUN (nothing written, no server contacted). Would import:" : "Imported:");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${String(v).padStart(4)}  ${k}`);
  if (p.notes.length) { console.log("\nNotes:"); p.notes.forEach((w) => console.log("  - " + w)); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
}
