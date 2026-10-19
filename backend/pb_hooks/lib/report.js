// Builds the net report and posts it to WordPress (used by POST /api/rt/session/publish).
//
// The post has: an optional one-paragraph AI summary, a details table, topic and
// notes, the check-in table and anyone not heard. Times are shown in the server's
// time zone (set TZ in the environment file; the installer does this).

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function esc(s) {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// "October 18, 2026" from the time the session was opened, else from its date.
function longDate(session) {
  let d = null;
  const opened = session.getString("opened_at");
  if (opened) d = new Date(opened.replace(" ", "T"));
  else if (session.getString("date")) d = new Date(session.getString("date") + "T12:00:00");
  if (!d || isNaN(d.getTime())) return "";
  return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

// "7:05 PM" from an ISO/PocketBase date string, in server time.
function clock(str) {
  if (!str) return "";
  const d = new Date(String(str).replace(" ", "T"));
  if (isNaN(d.getTime())) return "";
  const h = d.getHours();
  const m = d.getMinutes();
  return (h % 12 === 0 ? 12 : h % 12) + ":" + (m < 10 ? "0" + m : m) + " " + (h < 12 ? "AM" : "PM");
}

const TD = 'style="border:1px solid #ddd;padding:6px 8px;';
const TH = 'style="border:1px solid #ddd;padding:6px 8px;text-align:left;background:#f4f4f4;"';

// Asks the Anthropic API for a short, friendly summary. Returns "" when there is no
// key or the call fails, and the post is then published without a summary paragraph.
function aiSummary(u, ctx) {
  const key = u.env("ANTHROPIC_API_KEY").trim();
  if (!key) return "";
  const prompt =
    "Write a single concise paragraph (3-5 sentences) summarizing this amateur radio net session for a club website post. " +
    "Be warm and engaging. Reference the net name, date, NCO, attendance count, and any notable topic or comments if present. " +
    "Do not use headings or bullet points - just one paragraph of plain prose.\n\n" +
    "Net name: " + ctx.netName + "\n" +
    "Date: " + (ctx.dateStr || "unknown") + "\n" +
    "NCO (Net Control Operator): " + (ctx.nco || "unknown") + "\n" +
    "Topic: " + (ctx.topic || "none specified") + "\n" +
    "Notes: " + (ctx.notes || "none") + "\n" +
    "Total check-ins: " + ctx.attended.length + "\n" +
    "Not heard: " + ctx.notHeard.length + "\n" +
    "Sample check-ins: " + ctx.attended.slice(0, 15).map((c) => c.callsign + " (" + c.name + ")").join(", ") + "\n" +
    "Notable comments: " + ctx.attended.filter((c) => c.comment).slice(0, 8).map((c) => c.callsign + ": " + c.comment).join("; ");
  try {
    const res = $http.send({
      url: u.env("ANTHROPIC_API_URL", "https://api.anthropic.com/v1/messages"),
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: u.env("ANTHROPIC_MODEL", "claude-sonnet-5-5"), max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
      timeout: 60,
    });
    if (res.statusCode >= 200 && res.statusCode < 300 && res.json && res.json.content) {
      return res.json.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    }
  } catch (_) {}
  return "";
}

// Returns { status, body } for the route to send back.
function publish(u, sessionId) {
  let session = null;
  try { session = $app.findRecordById("net_sessions", sessionId); } catch (_) {}
  if (!session) return { status: 404, body: { error: "Session not found" } };

  const cfg = u.settings();
  const wpUrl = u.setting(cfg, "wordpress_url").replace(/\/+$/, "");
  const wpUser = u.setting(cfg, "wordpress_username");
  const wpPass = u.env("WORDPRESS_APP_PASSWORD").trim();
  if (!wpUrl || !wpUser || !wpPass) {
    return { status: 400, body: { error: "WordPress is not configured. Set the URL and username in Settings and WORDPRESS_APP_PASSWORD in the server environment." } };
  }
  const club = u.setting(cfg, "club_name") || "Round Table Net";

  let net = null;
  try { net = $app.findRecordById("nets", session.getString("net_id")); } catch (_) {}
  const netName = session.getString("net_name") || (net ? net.getString("name") : "") || "Net Session";

  // Check-ins with the roster's name and location filled in where the check-in has none.
  const stations = u.find($app, "stations", "net_id = {:n}", "", { n: session.getString("net_id") });
  const byCall = {};
  for (let i = 0; i < stations.length; i++) byCall[stations[i].getString("callsign")] = stations[i];
  const rows = u.find($app, "check_ins", "session_id = {:s}", "callsign", { s: sessionId }).map((c) => {
    const st = byCall[c.getString("callsign")];
    return {
      callsign: c.getString("callsign"),
      status: c.getString("status"),
      comment: c.getString("comment"),
      name: c.getString("name") || (st ? st.getString("name") : "") || "-",
      location: c.getString("location") || (st && st.getString("city") && st.getString("state") ? st.getString("city") + ", " + st.getString("state") : "") || "-",
    };
  });
  const attended = rows.filter((c) => c.status !== "not_heard");
  const notHeard = rows.filter((c) => c.status === "not_heard");

  const ctx = {
    netName: netName, dateStr: longDate(session), nco: session.getString("nco_callsign"),
    topic: session.getString("topic"), notes: session.getString("notes"), attended: attended, notHeard: notHeard,
  };
  const summary = aiSummary(u, ctx);
  const title = netName + " - Net Report" + (ctx.dateStr ? " - " + ctx.dateStr : "");

  let html = '<p style="font-style:italic;color:#666;font-size:0.85em;border-left:3px solid #ccc;padding-left:10px;margin-bottom:1.5em;">This post was automatically generated by the ' + esc(club) + " net control system.</p>\n";
  if (summary) html += "<p>" + esc(summary) + "</p>\n";

  const detail = (k, v) => "<tr><td " + 'style="padding:4px 8px;font-weight:bold;width:160px;">' + k + '</td><td style="padding:4px 8px;">' + v + "</td></tr>\n";
  html += "<h2>Session Details</h2>\n" + '<table style="border-collapse:collapse;width:100%;margin-bottom:1.5em;">\n';
  html += detail("Net", esc(netName));
  if (ctx.dateStr) html += detail("Date", esc(ctx.dateStr));
  if (ctx.nco) html += detail("Net Control", esc(ctx.nco));
  if (clock(session.getString("opened_at"))) html += detail("Opened", clock(session.getString("opened_at")));
  if (clock(session.getString("closed_at"))) html += detail("Closed", clock(session.getString("closed_at")));
  html += detail("Check-Ins", String(attended.length));
  if (notHeard.length > 0) html += detail("Not Heard", String(notHeard.length));
  html += "</table>\n";

  if (ctx.topic || ctx.notes || session.getBool("technical_difficulty")) {
    html += "<h2>Topic &amp; Notes</h2>\n";
    if (ctx.topic) html += "<p><strong>Topic:</strong> " + esc(ctx.topic) + "</p>\n";
    if (session.getBool("technical_difficulty")) html += "<p><em>Technical difficulty - absences not updated</em></p>\n";
    if (ctx.notes) html += "<p>" + esc(ctx.notes) + "</p>\n";
  }

  if (attended.length > 0) {
    html += "<h2>Check-Ins (" + attended.length + ")</h2>\n" + '<table style="border-collapse:collapse;width:100%;margin-bottom:1.5em;">\n<thead><tr>';
    ["Callsign", "Name", "Location", "Status", "Comment"].forEach((h) => { html += "<th " + TH + ">" + h + "</th>"; });
    html += "</tr></thead>\n<tbody>\n";
    for (let i = 0; i < attended.length; i++) {
      const c = attended[i];
      html += "<tr><td " + TD + 'font-family:monospace;font-weight:bold;">' + esc(c.callsign) + "</td>" +
        "<td " + TD + '">' + esc(c.name) + "</td><td " + TD + '">' + esc(c.location) + "</td>" +
        "<td " + TD + '">' + esc(c.status.replace(/_/g, " ")) + "</td><td " + TD + 'font-style:italic;">' + esc(c.comment) + "</td></tr>\n";
    }
    html += "</tbody></table>\n";
  }
  if (notHeard.length > 0) {
    html += "<h2>Not Heard (" + notHeard.length + ")</h2>\n<p>" +
      notHeard.map((c) => '<code style="background:#eee;padding:2px 6px;margin:2px;border-radius:3px;">' + esc(c.callsign) + "</code>").join(" ") + "</p>\n";
  }

  const auth = "Basic " + Buffer.from(wpUser + ":" + wpPass).toString("base64");

  // Category by slug (optional: the post is still made without it).
  let categoryId = 0;
  const slug = u.setting(cfg, "wordpress_category") || "regional-gmrs-net";
  try {
    const cat = $http.send({ url: wpUrl + "/wp-json/wp/v2/categories?slug=" + encodeURIComponent(slug), method: "GET", headers: { authorization: auth }, timeout: 20 });
    if (cat.statusCode === 200 && Array.isArray(cat.json) && cat.json.length > 0) categoryId = cat.json[0].id;
  } catch (_) {}

  // Date the post with when the net was held, so late-closed nets are not stamped with today.
  const post = { title: title, content: html, status: u.env("WORDPRESS_POST_STATUS", "publish") };
  if (categoryId) post.categories = [categoryId];
  const when = session.getString("opened_at") ? new Date(session.getString("opened_at").replace(" ", "T")) : null;
  if (when && !isNaN(when.getTime())) post.date = when.toISOString();

  let res = null;
  try {
    res = $http.send({
      url: wpUrl + "/wp-json/wp/v2/posts", method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(post), timeout: 30,
    });
  } catch (err) {
    return { status: 502, body: { error: "WordPress could not be reached." } };
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    return { status: 502, body: { error: "WordPress API error (" + res.statusCode + ")" } };
  }
  const data = res.json || {};
  return { status: 200, body: { success: true, post_url: data.link || (wpUrl + "/?p=" + data.id), post_id: data.id } };
}

module.exports = { publish, esc, longDate, clock };
