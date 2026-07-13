/* =========================================================================
   Service Panel Install Trainer
   Hardware: Square D Homeline HOM4080M200PC (200A, 40 spaces)
   Code: NEC 2023 (conservative). See NEC-2023-VALIDATION.md.

   Interaction: graphical drag & drop.
     1. Drag a circuit TICKET onto panel slot(s) to position it.
     2. Drag a BREAKER (configured in the bin) onto the placed circuit.
     3. Drag a WIRE gauge onto the placed circuit.
   ========================================================================= */

const PANEL_MODEL = "HOM4080M200PC";
const SLOT_COUNT = 40;
const STORE_KEY = "panelTrainer.records.v2";
const PASS_THRESHOLD = 80;

/* ---- Reference data ---------------------------------------------------- */
const WIRE_AMPACITY = { 14: 15, 12: 20, 10: 30, 8: 40, 6: 55 };   // NEC T310.16 60°C Cu
const SMALL_COND_CAP = { 14: 15, 12: 20, 10: 30, 8: null, 6: null }; // NEC 240.4(D)
const WIRE_OPTIONS = [14, 12, 10, 8, 6];
const AMP_OPTIONS = [15, 20, 30, 40, 50];
const TYPE_LABELS = { standard: "Standard", gfci: "GFCI", afci: "AFCI", dual: "Dual GFCI/AFCI" };
const PROT_LABELS = { standard: "Standard", gfci: "GFCI", afci: "AFCI", dual: "AFCI+GFCI (dual-function)" };
const TYPE_COLOR = { standard: "var(--t-standard)", gfci: "var(--t-gfci)", afci: "var(--t-afci)", dual: "var(--t-dual)" };
const WIRE_COLOR = { 14: "#e8e8e8", 12: "#f4c542", 10: "#e8863c", 8: "#4a4a4a", 6: "#3a6fb0" };
const WIRE_TEXT  = { 14: "#111", 12: "#111", 10: "#111", 8: "#fff", 6: "#fff" };

const MANDATORY_POOL = [
  { key: "ksa1", name: "Kitchen small-appliance #1", desc: "20A counter circuit · 210.11(C)(1) · kitchen = AFCI+GFCI", v: 120, amps: 20, wire: 12, protection: "dual", mandatory: true },
  { key: "ksa2", name: "Kitchen small-appliance #2", desc: "2nd required 20A counter circuit · 210.11(C)(1)",          v: 120, amps: 20, wire: 12, protection: "dual", mandatory: true },
  { key: "laundry", name: "Laundry circuit",         desc: "Dedicated 20A · 210.11(C)(2) · laundry = AFCI+GFCI",       v: 120, amps: 20, wire: 12, protection: "dual", mandatory: true },
  { key: "bath",   name: "Bathroom circuit",          desc: "20A · 210.11(C)(3) · GFCI (not on AFCI list)",             v: 120, amps: 20, wire: 12, protection: "gfci", mandatory: true },
];
const EXTRA_POOL = [
  { key: "bedroom",  name: "Bedroom receptacles",  desc: "General receptacles · AFCI (210.12(B))",              v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "living",   name: "Living room circuit",  desc: "Living area · AFCI (210.12(B))",                       v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "lighting", name: "Hall / general lighting", desc: "Lighting · AFCI (210.12(B))",                       v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "garage",   name: "Garage receptacles",   desc: "GFCI (210.8(A)) · garage not on AFCI list",           v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "outdoor",  name: "Outdoor receptacles",  desc: "Weather-resistant · GFCI (210.8(A))",                 v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "dishwash", name: "Dishwasher",           desc: "Kitchen appliance · GFCI (422.5) + AFCI ⇒ dual",      v: 120, amps: 20, wire: 12, protection: "dual" },
  { key: "range",    name: "Electric range",       desc: "240V receptacle · GFCI (2023, conservative)",         v: 240, amps: 40, wire: 8,  protection: "gfci" },
  { key: "dryer",    name: "Electric dryer",       desc: "240V receptacle · GFCI (2023, conservative)",         v: 240, amps: 30, wire: 10, protection: "gfci" },
  { key: "wheater",  name: "Water heater",         desc: "240V hardwired · standard (no receptacle)",           v: 240, amps: 30, wire: 10, protection: "standard" },
  { key: "furnace",  name: "Electric furnace",     desc: "240V electric heat · standard",                       v: 240, amps: 50, wire: 6,  protection: "standard" },
  { key: "hvac",     name: "A/C condenser",        desc: "Outdoor · nameplate MCA 24.5A, Max OCPD 40A · GFCI (210.8(F))",
    v: 240, wire: 10, protection: "gfci", hvac: true, mca: 24.5, mocp: 40 },
];
const DIFFICULTY = { basic: 5, standard: 7, advanced: 9 };

/* ---- Helpers ----------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function minStdAmp(a) { return AMP_OPTIONS.find(x => x >= a); }
function reqBreakerLabel(c) {
  if (c.hvac) return `≤${c.mocp}A (nameplate MOCP)`;
  return `${c.amps}A`;
}

function buildWorkOrder(count) {
  const core = MANDATORY_POOL.slice();
  const need = Math.max(count, core.length) - core.length;
  const extras = shuffle(EXTRA_POOL);
  const picked = [];
  const first240 = extras.find(c => c.v === 240);
  if (need > 0 && first240) picked.push(first240);
  for (const c of extras) { if (picked.length >= need) break; if (!picked.includes(c)) picked.push(c); }
  return shuffle(core.concat(picked.slice(0, need))).map((def, i) => ({ ...def, uid: def.key + "_" + i }));
}

/* ---- Job state --------------------------------------------------------- */
let job = null;
// Bin configuration for the breaker the trainee is about to drag.
const binState = { poles: 1, type: "standard" };

function newJob(difficulty) {
  const circuits = buildWorkOrder(DIFFICULTY[difficulty] || 7);
  job = { difficulty, circuits, assign: {}, breaker: {}, wire: {}, startTs: Date.now() };
  circuits.forEach(c => { job.assign[c.uid] = null; job.breaker[c.uid] = null; job.wire[c.uid] = null; });
}

function occupiedSlots(c, start) { if (!start) return []; const s = Number(start); return c.v === 240 ? [s, s + 2] : [s]; }
function buildOccupancy(exceptUid) {
  const map = {};
  for (const c of job.circuits) { if (c.uid === exceptUid) continue; occupiedSlots(c, job.assign[c.uid]).forEach(s => { map[s] = c.uid; }); }
  return map;
}
function canPlace(c, start) {
  const used = buildOccupancy(c.uid);
  const need = occupiedSlots(c, start);
  return need.length > 0 && need.every(n => n >= 1 && n <= SLOT_COUNT && !(n in used));
}
function ownerAt(slot) { const occ = buildOccupancy(null); return occ[slot] || null; }

/* ======================================================================= */
/*  Drag & drop plumbing                                                   */
/* ======================================================================= */
function setDrag(e, payload) {
  e.dataTransfer.setData("application/json", JSON.stringify(payload));
  e.dataTransfer.setData("app/" + payload.kind, "1");   // readable type during dragover
  e.dataTransfer.effectAllowed = "copyMove";
}
function dragHasKind(e, kind) { return Array.from(e.dataTransfer.types).includes("app/" + kind); }
function readPayload(e) { try { return JSON.parse(e.dataTransfer.getData("application/json")); } catch { return null; } }

/* ======================================================================= */
/*  Rendering                                                              */
/* ======================================================================= */
function renderBins() {
  // reflect toggle state
  document.querySelectorAll(".seg").forEach(seg => {
    const key = seg.dataset.seg;
    seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.val === String(binState[key])));
  });
  // breaker tiles
  const bt = $("#breakerTiles");
  bt.innerHTML = "";
  AMP_OPTIONS.forEach(a => {
    const t = document.createElement("div");
    t.className = "tile brk-tile";
    t.draggable = true;
    t.style.background = TYPE_COLOR[binState.type];
    t.innerHTML = `${a}A<span class="tmeta">${binState.poles}P · ${TYPE_LABELS[binState.type]}</span>`;
    t.addEventListener("dragstart", e => setDrag(e, { kind: "breaker", amps: a, poles: binState.poles, type: binState.type }));
    bt.appendChild(t);
  });
  // wire tiles
  const wt = $("#wireTiles");
  wt.innerHTML = "";
  WIRE_OPTIONS.forEach(g => {
    const t = document.createElement("div");
    t.className = "wtile";
    t.draggable = true;
    t.style.background = WIRE_COLOR[g];
    t.style.color = WIRE_TEXT[g];
    t.textContent = `${g} AWG`;
    t.addEventListener("dragstart", e => setDrag(e, { kind: "wire", gauge: g }));
    wt.appendChild(t);
  });
}

function renderPanel() {
  const occ = buildOccupancy(null);
  const slotsEl = $("#slots");
  slotsEl.innerHTML = "";
  for (let s = 1; s <= SLOT_COUNT; s++) {
    const uid = occ[s];
    const c = uid ? job.circuits.find(x => x.uid === uid) : null;
    const div = document.createElement("div");
    div.dataset.slot = s;
    const isStart = c && Number(job.assign[c.uid]) === s;

    if (!c) {
      div.className = "pslot empty";
      div.innerHTML = `<span class="snum">${s}</span>`;
      // accepts a circuit ticket
      div.addEventListener("dragover", e => { if (dragHasKind(e, "load")) { e.preventDefault(); div.classList.add("drop-ok"); } });
      div.addEventListener("dragleave", () => div.classList.remove("drop-ok"));
      div.addEventListener("drop", e => {
        div.classList.remove("drop-ok");
        const p = readPayload(e); if (!p || p.kind !== "load") return;
        e.preventDefault();
        const load = job.circuits.find(x => x.uid === p.uid); if (!load) return;
        if (canPlace(load, s)) { job.assign[load.uid] = s; renderAll(); }
      });
    } else if (isStart) {
      const brk = job.breaker[c.uid];
      const wire = job.wire[c.uid];
      div.className = "pslot placed";
      const brkChip = brk
        ? `<span class="chip brk" data-clear="breaker" data-uid="${c.uid}" style="background:${TYPE_COLOR[brk.type]}">${brk.amps}A ${brk.poles}P ${TYPE_LABELS[brk.type]} ✕</span>`
        : `<span class="chip empty-slotfit">drop breaker</span>`;
      const wireChip = wire
        ? `<span class="chip wire" data-clear="wire" data-uid="${c.uid}" style="background:${WIRE_COLOR[wire]};color:${WIRE_TEXT[wire]}">${wire} AWG ✕</span>`
        : `<span class="chip empty-slotfit">drop wire</span>`;
      div.className = "pslot placed";
      div.innerHTML = `<span class="snum">${s}</span>
        <div class="body">
          <span class="load-name">${c.name}${c.v === 240 ? " ⎓" : ""}</span>
          <span class="fitrow">${brkChip}${wireChip}</span>
        </div>
        <span class="x" data-unassign="${c.uid}" title="Remove circuit">✕</span>`;
      attachFitDrop(div, c);
    } else {
      // continuation slot of a 2-pole
      div.className = "pslot cont";
      div.innerHTML = `<span class="snum">${s}</span><span class="body">↑ ${c.name}</span>`;
      attachFitDrop(div, c);
    }
    slotsEl.appendChild(div);
  }
}

function attachFitDrop(div, c) {
  div.addEventListener("dragover", e => {
    if (dragHasKind(e, "breaker") || dragHasKind(e, "wire")) { e.preventDefault(); div.classList.add("drop-ok"); }
  });
  div.addEventListener("dragleave", () => div.classList.remove("drop-ok"));
  div.addEventListener("drop", e => {
    div.classList.remove("drop-ok");
    const p = readPayload(e); if (!p) return;
    e.preventDefault();
    if (p.kind === "breaker") { job.breaker[c.uid] = { amps: p.amps, poles: p.poles, type: p.type }; renderAll(); }
    else if (p.kind === "wire") { job.wire[c.uid] = p.gauge; renderAll(); }
  });
}

function renderTickets() {
  const list = $("#circuitTickets");
  list.innerHTML = "";
  for (const c of job.circuits) {
    const placed = job.assign[c.uid] != null;
    const t = document.createElement("div");
    t.className = "ticket" + (placed ? " placed" : "");
    t.draggable = !placed;
    const badge = c.hvac ? `${c.v}V · HVAC` : (c.v === 240 ? `${c.v}V · 2-pole` : `${c.v}V`);
    t.innerHTML = `
      <div>
        <div class="tname">${c.name}</div>
        <div class="tdesc">${c.desc}</div>
        ${placed ? `<div class="placed-tag">● placed at slot ${job.assign[c.uid]}${c.v === 240 ? " & " + (Number(job.assign[c.uid]) + 2) : ""}</div>` : ""}
      </div>
      <span class="badge ${c.v === 240 ? "v240" : ""}">${badge}</span>`;
    if (!placed) t.addEventListener("dragstart", e => setDrag(e, { kind: "load", uid: c.uid }));
    list.appendChild(t);
  }
}

function renderAll() { renderPanel(); renderTickets(); }

function renderWorkspace() {
  $("#panelRating").textContent = `${PANEL_MODEL} · 200A · ${SLOT_COUNT} spaces`;
  renderBins();
  renderAll();
  renderRequirements();
}

/* Delegated clicks for clear / unassign */
function onSlotsClick(e) {
  const clr = e.target.closest("[data-clear]");
  if (clr) { job[clr.dataset.clear][clr.dataset.uid] = clr.dataset.clear === "wire" ? null : null; renderAll(); return; }
  const un = e.target.closest("[data-unassign]");
  if (un) { const uid = un.dataset.unassign; job.assign[uid] = null; job.breaker[uid] = null; job.wire[uid] = null; renderAll(); }
}

/* ======================================================================= */
/*  Scoring                                                                */
/* ======================================================================= */
function scoreJob() {
  const details = [];
  let earned = 0, max = 0, faults = 0, critical = 0;

  for (const c of job.circuits) {
    const issues = [];
    const start = job.assign[c.uid];
    const brk = job.breaker[c.uid];
    const wire = job.wire[c.uid] ? Number(job.wire[c.uid]) : 0;
    max += 3;

    if (!start || !brk || !wire) {
      issues.push({ level: "fail", text: "Circuit not fully installed (needs a slot, a breaker, and a wire)." });
      faults++; critical++;
      details.push({ name: c.name, issues });
      continue;
    }
    const amps = brk.amps, type = brk.type, poles = brk.poles;
    const needPoles = c.v === 240 ? 2 : 1;

    // 1) Breaker: correct poles AND correct sizing
    let pBreaker = 0;
    if (poles !== needPoles) {
      faults++; critical++;
      issues.push({ level: "fail", text: needPoles === 2
        ? "240V load requires a 2-pole breaker — a 1-pole cannot supply 240V."
        : "120V load should use a 1-pole breaker, not 2-pole." });
    } else if (c.hvac) {
      const floor = minStdAmp(c.mca);
      if (amps > c.mocp) { faults++; critical++; issues.push({ level: "fail", text: `Breaker ${amps}A exceeds nameplate Max OCPD (${c.mocp}A) — NEC 440.4(B).` }); }
      else if (amps < floor) { faults++; issues.push({ level: "warn", text: `Breaker ${amps}A is below the circuit MCA (${c.mca}A) — undersized.` }); }
      else pBreaker = 1;
    } else if (amps === c.amps) {
      pBreaker = 1;
    } else {
      faults++;
      if (amps > c.amps) { critical++; issues.push({ level: "fail", text: `Breaker oversized: ${amps}A on a ${c.amps}A circuit — overcurrent/fire risk (240.4(D)).` }); }
      else issues.push({ level: "warn", text: `Breaker undersized: ${amps}A where ${c.amps}A is required — nuisance tripping.` });
    }

    // 2) Conductor
    let pWire = 0;
    const ampacity = WIRE_AMPACITY[wire] || 0;
    const floor = c.hvac ? c.mca : amps;
    const cap = c.hvac ? null : SMALL_COND_CAP[wire];
    if (ampacity < floor) {
      faults++; critical++;
      issues.push({ level: "fail", text: `Wire ${wire} AWG (${ampacity}A) undersized for ${c.hvac ? `MCA ${c.mca}A` : `${amps}A breaker`} — FIRE HAZARD.` });
    } else if (!c.hvac && cap != null && amps > cap) {
      faults++; critical++;
      issues.push({ level: "fail", text: `${wire} AWG limited to ${cap}A by NEC 240.4(D); ${amps}A breaker violates the small-conductor rule.` });
    } else if (wire !== c.wire) {
      pWire = 0.5; faults++;
      issues.push({ level: "warn", text: `Wire ${wire} AWG is adequate but spec calls for ${c.wire} AWG for this load.` });
    } else pWire = 1;

    // 3) Protection
    let pProt = 0;
    const okProt =
      (c.protection === "gfci" && (type === "gfci" || type === "dual")) ||
      (c.protection === "afci" && (type === "afci" || type === "dual")) ||
      (c.protection === "dual" && type === "dual") ||
      (c.protection === "standard" && type === "standard");
    if (okProt) pProt = 1;
    else if (c.protection === "dual") { faults++; critical++; issues.push({ level: "fail", text: `Requires dual-function (AFCI+GFCI); ${TYPE_LABELS[type]} provides only part — 210.8 & 210.12(B).` }); }
    else if (c.protection === "standard") { pProt = 0.5; faults++; issues.push({ level: "warn", text: `${TYPE_LABELS[type]} breaker where a standard breaker is sufficient.` }); }
    else { faults++; critical++; const need = c.protection === "gfci" ? "GFCI" : "AFCI"; issues.push({ level: "fail", text: `Missing ${need} protection required here — code violation / shock or arc-fault risk.` }); }

    earned += pBreaker + pWire + pProt;
    if (issues.length === 0) issues.push({ level: "ok", text: "Installed to spec." });
    details.push({ name: c.name, issues });
  }

  const score = Math.round((earned / max) * 100);
  const pass = score >= PASS_THRESHOLD && critical === 0;
  const durationSec = Math.round((Date.now() - job.startTs) / 1000);
  return { score, pass, faults, critical, durationSec, details };
}

function renderResult(res) {
  const el = $("#result");
  el.classList.remove("hidden");
  const color = res.pass ? "var(--ok)" : (res.score >= 60 ? "var(--warn)" : "var(--bad)");
  const ringStyle = `background: conic-gradient(${color} ${res.score * 3.6}deg, var(--panel-2) 0); color:${color};`;
  const inner = `<div style="width:74px;height:74px;border-radius:50%;background:var(--panel);display:grid;place-items:center;">${res.score}%</div>`;
  const findings = res.details.map(d => d.issues.map(i => `
    <div class="finding ${i.level}">
      <span class="icon">${i.level === "ok" ? "✅" : i.level === "warn" ? "⚠️" : "❌"}</span>
      <span><span class="fname">${d.name}:</span> <span class="fmsg">${i.text}</span></span>
    </div>`).join("")).join("");
  el.innerHTML = `
    <div class="score-hero">
      <div class="score-ring" style="${ringStyle}">${inner}</div>
      <div class="score-meta">
        <h2>${res.pass ? "PASS — Inspection cleared" : "FAIL — Corrections required"}</h2>
        <p>${res.faults} fault(s) · ${res.critical} critical hazard(s) · ${res.durationSec}s · saved to records</p>
      </div>
    </div>
    <div class="findings">${findings}</div>`;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ======================================================================= */
/*  Requirements markdown                                                  */
/* ======================================================================= */
function jobMarkdown() {
  const trainee = ($("#traineeName").value || "—").trim();
  const L = [];
  L.push(`# Panel Install Work Order`);
  L.push("");
  L.push(`- **Panel:** Square D Homeline ${PANEL_MODEL} — 200 A main breaker, 40 spaces, 120/240 V 1-phase`);
  L.push(`- **Code basis:** NEC 2023 (conservative interpretation)`);
  L.push(`- **Trainee:** ${trainee}`);
  L.push(`- **Difficulty:** ${job.difficulty} (${job.circuits.length} circuits)`);
  L.push(`- **Generated:** ${new Date().toISOString()}`);
  L.push("");
  L.push(`## Scenario`);
  L.push(`Install and wire the branch circuits below into the load center. For each circuit, install a breaker of the correct **amperage, pole count, and protection type**, and land a conductor of the correct **gauge**. Wiring must satisfy NEC 2023, including the NEC 210.11(C) required-circuit minimums, 240.4(D) conductor protection (with the Article 440 HVAC exception), and the 210.8 / 210.12(B) GFCI/AFCI rules.`);
  L.push("");
  L.push(`## Required circuits`);
  L.push("");
  L.push(`| # | Load | Volts | Breaker | Poles | Wire | Protection | Notes / Code |`);
  L.push(`|---|------|-------|---------|-------|------|-----------|--------------|`);
  job.circuits.forEach((c, i) => {
    const poles = c.v === 240 ? "2-pole" : "1-pole";
    const wire = c.hvac ? `${c.wire} AWG (per MCA)` : `${c.wire} AWG`;
    const note = c.hvac ? `MCA ${c.mca}A; size to nameplate, not 240.4(D)` : c.desc;
    L.push(`| ${i + 1} | ${c.name} | ${c.v}V | ${reqBreakerLabel(c)} | ${poles} | ${wire} | ${PROT_LABELS[c.protection]} | ${note} |`);
  });
  L.push("");
  L.push(`## Grading`);
  L.push(`Each circuit is scored on three checks — breaker (poles + sizing), conductor, and protection. **Pass = ≥ ${PASS_THRESHOLD}% and zero critical hazards.** Critical hazards include undersized conductors, oversized breakers on normal circuits, wrong pole count on 240 V loads, and missing required GFCI/AFCI protection.`);
  return L.join("\n");
}

function renderRequirements() {
  const empty = $("#reqEmpty"), pre = $("#reqMarkdown");
  if (!job) { empty.classList.remove("hidden"); pre.classList.add("hidden"); return; }
  empty.classList.add("hidden"); pre.classList.remove("hidden");
  pre.textContent = jobMarkdown();
}

/* ======================================================================= */
/*  Records (localStorage)                                                 */
/* ======================================================================= */
function loadRecords() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } }
function saveRecord(rec) { const all = loadRecords(); all.unshift(rec); localStorage.setItem(STORE_KEY, JSON.stringify(all)); }
function recordFromResult(res) {
  return { id: "att_" + job.startTs, ts: new Date().toISOString(), trainee: ($("#traineeName").value || "Anonymous").trim(),
    difficulty: job.difficulty, circuits: job.circuits.length, score: res.score, pass: res.pass, faults: res.faults, critical: res.critical, durationSec: res.durationSec };
}
function renderRecords() {
  const all = loadRecords();
  const nameF = $("#filterName").value.trim().toLowerCase();
  const passF = $("#filterPass").value;
  const minF = Number($("#filterMinScore").value) || 0;
  const rows = all.filter(r => (!nameF || r.trainee.toLowerCase().includes(nameF)) && (!passF || (passF === "pass" ? r.pass : !r.pass)) && (r.score >= minF));
  const n = rows.length, passCount = rows.filter(r => r.pass).length, avg = n ? Math.round(rows.reduce((s, r) => s + r.score, 0) / n) : 0;
  $("#recordStats").innerHTML = `<span><b>${n}</b> attempt(s)</span><span><b>${n ? Math.round((passCount / n) * 100) : 0}%</b> pass rate</span><span><b>${avg}%</b> avg score</span>`;
  const tbody = $("#recordsTable tbody");
  tbody.innerHTML = "";
  if (!rows.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No records yet. Complete an inspection in the Simulator tab.</td></tr>`; return; }
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="mono">${new Date(r.ts).toLocaleString()}</td><td>${escapeHtml(r.trainee)}</td><td>${r.difficulty}</td>
      <td class="mono">${r.score}%</td><td><span class="pill ${r.pass ? "pass" : "fail"}">${r.pass ? "PASS" : "FAIL"}</span></td>
      <td class="mono">${r.faults} (${r.critical} crit)</td><td class="mono">${r.durationSec}s</td>
      <td><button class="link-btn" data-del="${r.id}">delete</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { localStorage.setItem(STORE_KEY, JSON.stringify(loadRecords().filter(x => x.id !== b.dataset.del))); renderRecords(); }));
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function download(filename, text, type) { const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function exportCsv() {
  const all = loadRecords();
  const cols = ["id", "ts", "trainee", "difficulty", "circuits", "score", "pass", "faults", "critical", "durationSec"];
  const lines = [cols.join(",")].concat(all.map(r => cols.map(k => { const v = String(r[k]); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(",")));
  download("panel_trainer_records.csv", lines.join("\n"), "text/csv");
}

/* ======================================================================= */
/*  UI wiring                                                              */
/* ======================================================================= */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tabpane").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    $("#tab-" + t.dataset.tab).classList.add("active");
    if (t.dataset.tab === "records") renderRecords();
    if (t.dataset.tab === "req") renderRequirements();
  }));

  // Bin toggles
  document.querySelectorAll(".seg").forEach(seg => seg.addEventListener("click", e => {
    const btn = e.target.closest("button"); if (!btn) return;
    const key = seg.dataset.seg;
    binState[key] = key === "poles" ? Number(btn.dataset.val) : btn.dataset.val;
    renderBins();
  }));

  $("#slots").addEventListener("click", onSlotsClick);

  $("#startBtn").addEventListener("click", () => {
    newJob($("#difficulty").value);
    $("#workspace").classList.remove("hidden");
    $("#result").classList.add("hidden");
    renderWorkspace();
  });
  $("#resetBtn").addEventListener("click", () => { newJob(job.difficulty); $("#result").classList.add("hidden"); renderWorkspace(); });
  $("#inspectBtn").addEventListener("click", () => { const res = scoreJob(); saveRecord(recordFromResult(res)); renderResult(res); });

  // Requirements actions
  $("#copyMd").addEventListener("click", () => { if (job) navigator.clipboard?.writeText(jobMarkdown()); });
  $("#downloadMd").addEventListener("click", () => { if (job) download("panel_work_order.md", jobMarkdown(), "text/markdown"); });

  // Records
  ["filterName", "filterPass", "filterMinScore"].forEach(id => $("#" + id).addEventListener("input", renderRecords));
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#exportJson").addEventListener("click", () => download("panel_trainer_records.json", JSON.stringify(loadRecords(), null, 2), "application/json"));
  $("#clearRecords").addEventListener("click", () => { if (confirm("Delete ALL scoring records? This cannot be undone.")) { localStorage.removeItem(STORE_KEY); renderRecords(); } });
});
