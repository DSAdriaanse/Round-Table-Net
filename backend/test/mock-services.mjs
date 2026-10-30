// Fake third-party services for local testing: Anthropic, WordPress and Slack.
// The tests never talk to the real ones, so no real posts or API calls are ever made.
// Usage: node mock-services.mjs [port]   (default 9100)
import http from "node:http";

const port = Number(process.argv[2] || 9100);
let calls = [];
let slackTs = 1700000000;

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

const send = (res, status, obj, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(obj));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const raw = await readBody(req);

    if (url.pathname === "/_calls") return send(res, 200, calls);
    if (url.pathname === "/_reset") { calls = []; return send(res, 200, { ok: true }); }

    let body = raw;
    try { body = JSON.parse(raw); } catch {}
    calls.push({ path: url.pathname, query: url.search, method: req.method, headers: req.headers, body });

    switch (url.pathname) {
      case "/anthropic":
        return send(res, 200, { content: [{ type: "text", text: "A friendly net with a good turnout this evening." }] });
      case "/wp/wp-json/wp/v2/categories":
        return send(res, 200, [{ id: 7, slug: "regional-gmrs-net" }]);
      case "/wp/wp-json/wp/v2/posts":
        return send(res, 201, { id: 55, link: "https://wp.test/post-55" });
      // Slack Web API. Two channel IDs behave like real failures so the error messages can be tested.
      case "/slack/chat.postMessage":
        if (body.channel === "CNOTIN0000") return send(res, 200, { ok: false, error: "not_in_channel" });
        if (body.channel === "CMISSING00") return send(res, 200, { ok: false, error: "channel_not_found" });
        slackTs += 1;
        return send(res, 200, { ok: true, channel: body.channel, ts: `${slackTs}.000100` });
      case "/slack/users.info":
        return send(res, 200, { ok: true, user: { name: "todd", real_name: "Todd Realname", profile: { display_name: "Todd" } } });
      default:
        return send(res, 404, { error: "unknown mock route " + url.pathname });
    }
  })
  .listen(port, "127.0.0.1", () => console.log("mock services on", port));
