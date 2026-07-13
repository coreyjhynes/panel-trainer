/* Storage for scenarios + the live panel state.
   - Durable (Azure Table Storage) when AZURE_STORAGE_CONNECTION_STRING is set.
   - In-memory fallback otherwise (local dev). @azure/data-tables loaded lazily. */

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING;

let clientCache = {};
async function table(name) {
  if (!CONN) return null;
  if (clientCache[name]) return clientCache[name];
  const { TableClient } = require("@azure/data-tables");
  const c = TableClient.fromConnectionString(CONN, name);
  try { await c.createTable(); } catch (_) { /* exists */ }
  clientCache[name] = c;
  return c;
}

/* ---- Scenarios ---------------------------------------------------------- */
let scenariosMem = {};   // id -> scenario

function toEntity(s) {
  return { partitionKey: "s", rowKey: s.id, title: s.title || "", description: s.description || "",
    circuits: JSON.stringify(s.circuits || []), updatedAt: s.updatedAt || new Date().toISOString() };
}
function fromEntity(e) {
  let circuits = [];
  try { circuits = JSON.parse(e.circuits || "[]"); } catch (_) {}
  return { id: e.rowKey, title: e.title, description: e.description, circuits, updatedAt: e.updatedAt };
}

async function listScenarios() {
  const t = await table("scenarios");
  if (!t) return Object.values(scenariosMem);
  const out = [];
  for await (const e of t.listEntities()) out.push(fromEntity(e));
  return out;
}
async function getScenario(id) {
  const t = await table("scenarios");
  if (!t) return scenariosMem[id] || null;
  try { return fromEntity(await t.getEntity("s", id)); } catch (_) { return null; }
}
async function saveScenario(s) {
  s.updatedAt = new Date().toISOString();
  const t = await table("scenarios");
  if (!t) { scenariosMem[s.id] = s; return s; }
  await t.upsertEntity(toEntity(s), "Replace");
  return s;
}
async function deleteScenario(id) {
  const t = await table("scenarios");
  if (!t) { delete scenariosMem[id]; return; }
  try { await t.deleteEntity("s", id); } catch (_) {}
}

/* ---- Live panel state, keyed by session (multi-tenant) ------------------ */
let stateMem = {};   // sessionId -> {units, rev, setBy, updatedAt}
const sid = (s) => String(s || "default").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "default";

async function getState(sessionId) {
  const key = sid(sessionId);
  const t = await table("runtime");
  if (!t) return stateMem[key] ? { ...stateMem[key] } : { units: [], rev: 0, setBy: null, updatedAt: null };
  try {
    const e = await t.getEntity("r", key);
    let units = []; try { units = JSON.parse(e.units || "[]"); } catch (_) {}
    return { units, rev: Number(e.rev) || 0, setBy: e.setBy || null, updatedAt: e.updatedAt || null };
  } catch (_) { return { units: [], rev: 0, setBy: null, updatedAt: null }; }
}
async function setState(sessionId, units, setBy) {
  const key = sid(sessionId);
  const cur = await getState(key);
  const next = { units: Array.isArray(units) ? units : [], rev: (cur.rev || 0) + 1, setBy: setBy || null, updatedAt: new Date().toISOString() };
  const t = await table("runtime");
  if (!t) { stateMem[key] = next; return next; }
  await t.upsertEntity({ partitionKey: "r", rowKey: key, units: JSON.stringify(next.units), rev: next.rev, setBy: next.setBy, updatedAt: next.updatedAt }, "Replace");
  return next;
}

module.exports = { listScenarios, getScenario, saveScenario, deleteScenario, getState, setState, usingTable: !!CONN };
