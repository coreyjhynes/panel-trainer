/* Server-side NEC 2023 scoring (ported from the client).
   scoreState({ circuits, units }) evaluates the current panel state and returns
   { score, pass, faults, critical, details }. This is the single source of
   scoring truth — the app no longer scores locally. */

const WIRE_AMPACITY = { 14: 15, 12: 20, 10: 30, 8: 40, 6: 55 };      // NEC T310.16 60C Cu
const SMALL_COND_CAP = { 14: 15, 12: 20, 10: 30, 8: null, 6: null };  // NEC 240.4(D)
const AMP_OPTIONS = [15, 20, 30, 40, 50];
const TYPE_LABELS = { standard: "Standard", gfci: "GFCI", afci: "AFCI", dual: "Dual GFCI/AFCI" };
const PROT_LABELS = { standard: "Standard", gfci: "GFCI", afci: "AFCI", dual: "AFCI+GFCI (dual-function)" };
const PASS_THRESHOLD = 80;

const minStdAmp = (a) => AMP_OPTIONS.find((x) => x >= a);
const needPolesOf = (c) => (c.v === 240 ? 2 : 1);
const reqBreakerLabel = (c) => (c.hvac ? `<= ${c.mocp}A (nameplate MOCP)` : `${c.amps}A`);

function protSatisfied(type, protection) {
  return (protection === "gfci" && (type === "gfci" || type === "dual")) ||
         (protection === "afci" && (type === "afci" || type === "dual")) ||
         (protection === "dual" && type === "dual") ||
         (protection === "standard" && type === "standard");
}

function wireOf(u) {
  const keys = Object.keys(u.terminals || {});
  const vals = keys.map((k) => u.terminals[k]).filter((v) => v != null).map(Number);
  if (vals.length === 0) return { status: "none", total: keys.length };
  if (vals.length < keys.length) return { status: "partial", filled: vals.length, total: keys.length };
  const uniq = [...new Set(vals)];
  if (uniq.length > 1) return { status: "mixed", gauges: uniq };
  return { status: "ok", gauge: uniq[0] };
}

function matchScore(u, c) {
  const polesOK = u.poles === needPolesOf(c);
  // Amps: exact match for normal circuits; for HVAC any in-range breaker fits,
  // but prefer the MOCP value so an in-range unit isn't stolen from a circuit
  // that needs it exactly (e.g. a 30A dryer vs an HVAC that accepts 30-40A).
  let ampsPts = 0;
  if (c.hvac) {
    if (u.amps >= minStdAmp(c.mca) && u.amps <= c.mocp) ampsPts = (u.amps === c.mocp) ? 2 : 1.5;
  } else if (u.amps === c.amps) {
    ampsPts = 2;
  }
  const typeOK = protSatisfied(u.type, c.protection);
  const w = wireOf(u);
  const wireOK = w.status === "ok" && w.gauge === c.wire;
  return (polesOK ? 4 : 0) + ampsPts + (typeOK ? 1 : 0) + (wireOK ? 1 : 0);
}

function attributeUnits(circuits, units) {
  const spec = (c) => (c.v === 240 ? 2 : 0) + (c.protection === "dual" ? 2 : c.protection !== "standard" ? 1 : 0) + (c.hvac ? 1 : 0);
  const order = circuits.slice().sort((a, b) => spec(b) - spec(a));
  const consumed = new Set();
  const map = {};
  for (const c of order) {
    let best = -1, bestScore = 0;
    units.forEach((u, i) => {
      if (consumed.has(i)) return;
      const s = matchScore(u, c);
      if (s >= 2 && s > bestScore) { bestScore = s; best = i; }
    });
    if (best >= 0) { map[c.uid] = units[best]; consumed.add(best); }
  }
  const extras = units.filter((_, i) => !consumed.has(i));
  return { map, extras };
}

function scoreState({ circuits, units }) {
  circuits = Array.isArray(circuits) ? circuits : [];
  units = Array.isArray(units) ? units : [];
  const { map, extras } = attributeUnits(circuits, units);
  const details = [];
  let earned = 0, max = 0, faults = 0, critical = 0;

  for (const c of circuits) {
    const issues = [];
    max += 3;
    const u = map[c.uid];
    if (!u) {
      issues.push({ level: "fail", text: `No matching breaker installed for this circuit (need ${reqBreakerLabel(c)}, ${needPolesOf(c)}-pole, ${PROT_LABELS[c.protection]}).` });
      faults++; critical++;
      details.push({ name: c.name, issues });
      continue;
    }
    const { amps, type, poles } = u;
    const needPoles = needPolesOf(c);

    // 1) Breaker: poles + sizing
    let pBreaker = 0;
    if (poles !== needPoles) {
      faults++; critical++;
      issues.push({ level: "fail", text: needPoles === 2 ? "240V load requires a 2-pole breaker - a 1-pole cannot supply 240V." : "120V load should use a 1-pole breaker, not 2-pole." });
    } else if (c.hvac) {
      const floor = minStdAmp(c.mca);
      if (amps > c.mocp) { faults++; critical++; issues.push({ level: "fail", text: `Breaker ${amps}A exceeds nameplate Max OCPD (${c.mocp}A) - NEC 440.4(B).` }); }
      else if (amps < floor) { faults++; issues.push({ level: "warn", text: `Breaker ${amps}A is below the circuit MCA (${c.mca}A) - undersized.` }); }
      else pBreaker = 1;
    } else if (amps === c.amps) { pBreaker = 1; }
    else { faults++; if (amps > c.amps) { critical++; issues.push({ level: "fail", text: `Breaker oversized: ${amps}A on a ${c.amps}A circuit - overcurrent/fire risk (240.4(D)).` }); } else issues.push({ level: "warn", text: `Breaker undersized: ${amps}A where ${c.amps}A is required - nuisance tripping.` }); }

    // 2) Conductor (per-terminal wiring)
    let pWire = 0;
    const w = wireOf(u);
    if (w.status === "none") { faults++; critical++; issues.push({ level: "fail", text: "No conductor landed on the breaker terminal(s)." }); }
    else if (w.status === "partial") { faults++; critical++; issues.push({ level: "fail", text: `Only ${w.filled} of ${w.total} pole terminals wired - both legs of a 2-pole breaker must be landed.` }); }
    else if (w.status === "mixed") { faults++; critical++; issues.push({ level: "fail", text: `Different gauge conductors on the poles (${w.gauges.map((g) => g + " AWG").join(" & ")}) - both legs must match.` }); }
    else {
      const wire = w.gauge, ampacity = WIRE_AMPACITY[wire] || 0;
      const floor = c.hvac ? c.mca : amps, cap = c.hvac ? null : SMALL_COND_CAP[wire];
      if (ampacity < floor) { faults++; critical++; issues.push({ level: "fail", text: `Wire ${wire} AWG (${ampacity}A) undersized for ${c.hvac ? `MCA ${c.mca}A` : `${amps}A breaker`} - FIRE HAZARD.` }); }
      else if (!c.hvac && cap != null && amps > cap) { faults++; critical++; issues.push({ level: "fail", text: `${wire} AWG limited to ${cap}A by NEC 240.4(D); ${amps}A breaker violates the small-conductor rule.` }); }
      else if (wire !== c.wire) { pWire = 0.5; faults++; issues.push({ level: "warn", text: `Wire ${wire} AWG is adequate but spec calls for ${c.wire} AWG for this load.` }); }
      else pWire = 1;
    }

    // 3) Protection
    let pProt = 0;
    if (protSatisfied(type, c.protection)) pProt = 1;
    else if (c.protection === "dual") { faults++; critical++; issues.push({ level: "fail", text: `Requires dual-function (AFCI+GFCI); ${TYPE_LABELS[type]} provides only part - 210.8 & 210.12(B).` }); }
    else if (c.protection === "standard") { pProt = 0.5; faults++; issues.push({ level: "warn", text: `${TYPE_LABELS[type]} breaker where a standard breaker is sufficient.` }); }
    else { faults++; critical++; const need = c.protection === "gfci" ? "GFCI" : "AFCI"; issues.push({ level: "fail", text: `Missing ${need} protection required here - code violation / shock or arc-fault risk.` }); }

    earned += pBreaker + pWire + pProt;
    if (issues.length === 0) issues.push({ level: "ok", text: `Installed to spec (slot ${u.slot}).` });
    details.push({ name: c.name, issues });
  }

  extras.forEach((u) => { faults++; details.push({ name: `Extra breaker (slot ${u.slot})`, issues: [{ level: "warn", text: `${u.amps}A ${u.poles}-pole ${TYPE_LABELS[u.type]} breaker not part of the work order.` }] }); });

  const score = max > 0 ? Math.round((earned / max) * 100) : 0;
  const pass = score >= PASS_THRESHOLD && critical === 0;
  return { score, pass, faults, critical, details };
}

module.exports = { scoreState, PASS_THRESHOLD };
