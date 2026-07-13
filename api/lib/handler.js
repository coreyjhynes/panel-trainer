/* Shared request logic for the scores API. Used by both the Azure Function
   (api/scores/index.js) and the local dev server (dev-server.js). */

const store = require("./store");
const { scoreState } = require("./scoring");
const crypto = require("crypto");

const newId = () => "att_" + crypto.randomBytes(6).toString("hex");

function applyFilters(recs, q) {
  let out = recs;
  if (q && q.trainee) {
    const t = String(q.trainee).toLowerCase();
    out = out.filter(r => String(r.trainee || "").toLowerCase().includes(t));
  }
  if (q && q.min_score != null && q.min_score !== "") {
    const m = Number(q.min_score);
    if (!Number.isNaN(m)) out = out.filter(r => Number(r.score) >= m);
  }
  if (q && q.pass != null && q.pass !== "") {
    const want = ["1", "true", "yes", "pass"].includes(String(q.pass).toLowerCase());
    out = out.filter(r => Boolean(r.pass) === want);
  }
  return out;
}

async function handleRequest({ method, query, body }) {
  method = (method || "GET").toUpperCase();

  if (method === "GET") {
    let recs = await store.listScores();
    recs = applyFilters(recs, query || {});
    recs.sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
    return { status: 200, body: recs };
  }

  if (method === "POST") {
    let payload = body;
    if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return { status: 400, body: { error: "invalid json" } }; } }
    if (!payload || typeof payload !== "object") return { status: 400, body: { error: "missing body" } };

    // Score the submitted panel STATE server-side (external scoring).
    const result = scoreState({ circuits: payload.circuits, units: payload.units });

    // One record per instance: same instanceId replaces its previous result.
    const rec = {
      id: payload.instanceId || newId(),
      ts: new Date().toISOString(),
      difficulty: payload.difficulty || "unknown",
      circuits: Array.isArray(payload.circuits) ? payload.circuits.length : 0,
      score: result.score,
      pass: result.pass,
      faults: result.faults,
      critical: result.critical,
      durationSec: Number.isFinite(payload.durationSec) ? payload.durationSec : 0,
    };
    await store.upsertScore(rec);

    // Return the stored summary PLUS the findings so the app can display them.
    return { status: 200, body: { ...rec, details: result.details } };
  }

  if (method === "DELETE") {
    await store.clearScores();
    return { status: 200, body: { status: "cleared" } };
  }

  return { status: 405, body: { error: "method not allowed" } };
}

module.exports = { handleRequest };
