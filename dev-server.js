/* LOCAL DEV / TEST ONLY — not used in production.
   Serves the static app AND the /api/scores endpoint using the exact same
   handler as the Azure Function, so you can test the full loop before deploy:

       node dev-server.js            # http://localhost:8781

   In production, Azure Static Web Apps runs the api/ folder as managed
   Functions and serves the static files; this file is ignored there. */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { handleRequest } = require("./api/lib/handler");

const PORT = process.env.PORT || 8781;
const ROOT = __dirname;
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".md": "text/markdown", ".svg": "image/svg+xml" };

function send(res, status, body, type = "application/json") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "OPTIONS") return send(res, 204, "");

  if (u.pathname.startsWith("/api/")) {
    const resource = u.pathname.slice("/api/".length);
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", async () => {
      let parsed;
      if (body) { try { parsed = JSON.parse(body); } catch { parsed = body; } }
      try {
        const r = await handleRequest({ method: req.method, resource, body: parsed });
        send(res, r.status, JSON.stringify(r.body));
      } catch (e) {
        send(res, 500, JSON.stringify({ error: String((e && e.message) || e) }));
      }
    });
    return;
  }

  // static files
  let p = decodeURIComponent(u.pathname);
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, "Not found", "text/plain");
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || "application/octet-stream");
});

server.listen(PORT, () => console.log(`Panel Trainer dev server + API → http://localhost:${PORT}  (API: /api/scores)`));
