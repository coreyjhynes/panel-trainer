/* Scenario helpers shared by the API:
   - CIRCUIT_CATALOG : the palette of circuits an author can put in a scenario
   - solutionFor()   : the correct panel (breakers + wires) for a scenario
   - scenarioMarkdown(): the requirements Markdown for lab instructions
   A scenario = { id, title, description, circuits: [ {uid,name,v,amps,wire,protection,hvac?,mca?,mocp?} ] } */

const AMP_OPTIONS = [15, 20, 30, 40, 50];
const PROT_LABELS = { standard: "Standard", gfci: "GFCI", afci: "AFCI", dual: "AFCI+GFCI (dual-function)" };

// Building blocks for authoring. mca/mocp only on hvac entries.
const CIRCUIT_CATALOG = [
  { key: "ksa",        name: "Kitchen small-appliance", v: 120, amps: 20, wire: 12, protection: "dual" },
  { key: "laundry",    name: "Laundry circuit",         v: 120, amps: 20, wire: 12, protection: "dual" },
  { key: "bath",       name: "Bathroom circuit",        v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "bedroom",    name: "Bedroom receptacles",     v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "living",     name: "Living room circuit",     v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "lighting",   name: "General lighting",        v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "garage",     name: "Garage receptacles",      v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "outdoor",    name: "Outdoor receptacles",     v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "dishwasher", name: "Dishwasher",              v: 120, amps: 20, wire: 12, protection: "dual" },
  { key: "range",      name: "Electric range",          v: 240, amps: 40, wire: 8,  protection: "gfci" },
  { key: "dryer",      name: "Electric dryer",          v: 240, amps: 30, wire: 10, protection: "gfci" },
  { key: "wheater",    name: "Water heater",            v: 240, amps: 30, wire: 10, protection: "standard" },
  { key: "furnace",    name: "Electric furnace",        v: 240, amps: 50, wire: 6,  protection: "standard" },
  { key: "hvac",       name: "A/C condenser",           v: 240, wire: 10, protection: "gfci", hvac: true, mca: 24.5, mocp: 40 },
];

const minStdAmp = (a) => AMP_OPTIONS.find((x) => x >= a);

/* The correct installed panel for a scenario (what scores 100%). */
function solutionFor(scenario) {
  const circuits = (scenario && Array.isArray(scenario.circuits)) ? scenario.circuits : [];
  const used = new Set();
  const place = (poles) => {
    for (let s = 1; s <= 40; s++) {
      const need = poles === 2 ? [s, s + 2] : [s];
      if (need.every((n) => n <= 40 && !used.has(n))) { need.forEach((n) => used.add(n)); return s; }
    }
    return null;
  };
  const units = [];
  let id = 1;
  for (const c of circuits) {
    const poles = c.v === 240 ? 2 : 1;
    const amps = c.hvac ? c.mocp : c.amps;   // HVAC breaker = nameplate MOCP
    const slot = place(poles);
    if (slot == null) continue;
    const wire = c.wire;
    const terminals = poles === 2 ? { A: wire, B: wire } : { A: wire };
    units.push({ id: id++, slot, poles, amps, type: c.protection, terminals });
  }
  return units;
}

/* Requirements Markdown for lab instructions. */
function scenarioMarkdown(scenario) {
  const c = scenario || {};
  const L = [];
  L.push(`# ${c.title || c.id || "Scenario"}`, "");
  L.push(`**Scenario ID:** \`${c.id || ""}\``, "");
  if (c.description) L.push(c.description, "");
  L.push(`**Panel:** Square D Homeline HOM4080M200PC — 200 A main, 40 spaces, 120/240 V. **Code:** NEC 2023 (conservative).`, "");
  L.push(`## Required circuits`, "");
  L.push(`| # | Load | Volts | Breaker | Poles | Wire | Protection |`);
  L.push(`|---|------|-------|---------|-------|------|-----------|`);
  (c.circuits || []).forEach((x, i) => {
    const breaker = x.hvac ? `≤ ${x.mocp}A (nameplate MOCP)` : `${x.amps}A`;
    const poles = x.v === 240 ? "2-pole" : "1-pole";
    const wire = x.hvac ? `${x.wire} AWG (per MCA)` : `${x.wire} AWG`;
    L.push(`| ${i + 1} | ${x.name} | ${x.v}V | ${breaker} | ${poles} | ${wire} | ${PROT_LABELS[x.protection] || x.protection} |`);
  });
  L.push("", `## Grading`,
    `Install every circuit above into the load center: a breaker of the correct amperage, pole count, and protection type, with the correct conductor gauge landed on every pole terminal. **Pass = ≥ 80% and zero critical hazards.**`);
  return L.join("\n");
}

module.exports = { CIRCUIT_CATALOG, solutionFor, scenarioMarkdown };
