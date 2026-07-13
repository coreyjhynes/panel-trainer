/* API router. Used by the Azure Function (api/scores/index.js) and dev-server.js.

   GET    /api/catalog              circuit palette for authoring
   GET    /api/scenarios            list scenarios
   POST   /api/scenarios            create/update a scenario (body: {id?,title,description,circuits})
   GET    /api/scenarios/{id}       one scenario + its requirements Markdown
   DELETE /api/scenarios/{id}       delete a scenario
   POST   /api/state                app publishes its live panel (body: {units, clientId})
   GET    /api/state                read the live panel (units, rev, setBy)
   POST   /api/inspect              score the live panel vs a scenario (body: {scenarioId})
   POST   /api/complete             build the scenario's 100% solution into the live panel (body: {scenarioId})

   The application scores (api/lib/scoring.js). The panel lives in the app. */

const store = require("./store");
const { scoreState } = require("./scoring");
const { CIRCUIT_CATALOG, solutionFor, scenarioMarkdown } = require("./scenarios");

const parse = (b) => (typeof b === "string" ? (() => { try { return JSON.parse(b); } catch { return null; } })() : b);
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const rand = () => Math.random().toString(36).slice(2, 8);

async function handleRequest({ method, path, query, body }) {
  method = (method || "GET").toUpperCase();
  query = query || {};
  const parts = String(path || "").split("/").filter(Boolean);
  const resource = parts[0];
  const id = parts[1];

  if (resource === "catalog" && method === "GET") {
    return { status: 200, body: CIRCUIT_CATALOG };
  }

  if (resource === "scenarios") {
    if (method === "GET" && !id) {
      const list = (await store.listScenarios()).map((s) => ({ id: s.id, title: s.title, description: s.description, circuits: (s.circuits || []).length, updatedAt: s.updatedAt }));
      list.sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
      return { status: 200, body: list };
    }
    if (method === "GET" && id) {
      const s = await store.getScenario(id);
      if (!s) return { status: 404, body: { error: "scenario not found" } };
      return { status: 200, body: { ...s, markdown: scenarioMarkdown(s) } };
    }
    if (method === "POST") {
      const b = parse(body);
      if (!b || typeof b !== "object") return { status: 400, body: { error: "missing scenario" } };
      const scenario = {
        id: b.id ? slug(b.id) : (slug(b.title) || "scenario") + "-" + rand(),
        title: b.title || "Untitled scenario",
        description: b.description || "",
        circuits: (Array.isArray(b.circuits) ? b.circuits : []).map((c, i) => ({
          uid: c.uid || (c.key || "c") + "_" + i, name: c.name, v: Number(c.v), amps: c.amps != null ? Number(c.amps) : undefined,
          wire: Number(c.wire), protection: c.protection, hvac: !!c.hvac,
          mca: c.hvac ? Number(c.mca) : undefined, mocp: c.hvac ? Number(c.mocp) : undefined,
        })),
      };
      await store.saveScenario(scenario);
      return { status: 200, body: { ...scenario, markdown: scenarioMarkdown(scenario) } };
    }
    if (method === "DELETE" && id) { await store.deleteScenario(id); return { status: 200, body: { ok: true } }; }
    return { status: 405, body: { error: "method not allowed" } };
  }

  if (resource === "state") {
    if (method === "POST") {
      const b = parse(body) || {};
      const next = await store.setState(b.sessionId, Array.isArray(b.units) ? b.units : [], b.clientId || "app");
      return { status: 200, body: { rev: next.rev, setBy: next.setBy } };
    }
    if (method === "GET") return { status: 200, body: await store.getState(query.session) };
    return { status: 405, body: { error: "method not allowed" } };
  }

  if (resource === "inspect" && method === "POST") {
    const b = parse(body) || {};
    const s = await store.getScenario(b.scenarioId);
    if (!s) return { status: 404, body: { error: "unknown scenarioId", pass: false, details: [{ name: "Scenario", issues: [{ level: "fail", text: `Scenario '${b.scenarioId}' not found.` }] }] } };
    const st = await store.getState(b.sessionId);
    const r = scoreState({ circuits: s.circuits, units: st.units });
    return { status: 200, body: { scenarioId: s.id, scenarioTitle: s.title, sessionId: b.sessionId || "default", pass: r.pass, score: r.score, faults: r.faults, critical: r.critical, details: r.details } };
  }

  if (resource === "complete" && method === "POST") {
    const b = parse(body) || {};
    const s = await store.getScenario(b.scenarioId);
    if (!s) return { status: 404, body: { error: "unknown scenarioId" } };
    const units = solutionFor(s);
    const next = await store.setState(b.sessionId, units, "server:complete:" + s.id);
    return { status: 200, body: { ok: true, scenarioId: s.id, sessionId: b.sessionId || "default", rev: next.rev, units } };
  }

  return { status: 404, body: { error: "not found" } };
}

module.exports = { handleRequest };
