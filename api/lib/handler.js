/* Shared request logic for the API. Used by both the Azure Function
   (api/scores/index.js) and the local dev server (dev-server.js).

   Endpoints (resource = the path segment after /api/):
     POST   /api/state     store the running app's current panel
     GET    /api/state     read it back
     DELETE /api/state     clear it
     GET    /api/inspect   score the currently-stored panel (the "Run
                           inspection" action) and return pass + details

   The APPLICATION scores (api/lib/scoring.js). The panel lives in the app and
   is synced to /api/state; nobody submits a panel to be inspected. */

const store = require("./store");
const { scoreState } = require("./scoring");

function parseBody(body) {
  if (typeof body === "string") { try { return JSON.parse(body); } catch { return null; } }
  return body;
}

async function handleRequest({ method, resource, body }) {
  method = (method || "GET").toUpperCase();

  if (resource === "state") {
    if (method === "POST") {
      const s = parseBody(body);
      if (!s || typeof s !== "object") return { status: 400, body: { error: "missing state" } };
      await store.setState({
        circuits: Array.isArray(s.circuits) ? s.circuits : [],
        units: Array.isArray(s.units) ? s.units : [],
        difficulty: s.difficulty || "unknown",
        updatedAt: new Date().toISOString(),
      });
      return { status: 200, body: { ok: true } };
    }
    if (method === "GET") return { status: 200, body: (await store.getState()) || {} };
    if (method === "DELETE") { await store.setState(null); return { status: 200, body: { ok: true } }; }
    return { status: 405, body: { error: "method not allowed" } };
  }

  if (resource === "inspect") {
    const s = await store.getState();
    if (!s || !Array.isArray(s.circuits) || s.circuits.length === 0) {
      return { status: 200, body: {
        empty: true, pass: false, score: 0, faults: 0, critical: 0,
        details: [{ name: "Panel", issues: [{ level: "fail",
          text: "No panel has been synced from the running app yet. Open the app, start a job, and build the panel." }] }],
      } };
    }
    const r = scoreState({ circuits: s.circuits, units: s.units });
    return { status: 200, body: {
      pass: r.pass, score: r.score, faults: r.faults, critical: r.critical,
      difficulty: s.difficulty, details: r.details,
    } };
  }

  return { status: 404, body: { error: "unknown resource" } };
}

module.exports = { handleRequest };
