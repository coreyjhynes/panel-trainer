/* =========================================================================
   Service Panel Install Trainer
   Hardware model: Square D Homeline HOM4080M200PC (200A, 40 spaces / 80 ckt)
   Code model: NEC 2023 (conservative encoding where 2023 scope is ambiguous)
   See NEC-2023-VALIDATION.md for the article-by-article basis of every rule.
   Pure client-side. Scoring records persist in localStorage.
   ========================================================================= */

const PANEL_MODEL = "HOM4080M200PC";
const SLOT_COUNT = 40;               // real Homeline 200A: 40 spaces
const STORE_KEY = "panelTrainer.records.v2";
const PASS_THRESHOLD = 80;           // % to pass

/* ---- Reference data ---------------------------------------------------- */
// NM cable ampacity, NEC Table 310.16 60°C copper column (residential default).
const WIRE_AMPACITY = { 14: 15, 12: 20, 10: 30, 8: 40, 6: 55 };
// NEC 240.4(D) small-conductor MAX overcurrent caps (copper). null = governed by
// ampacity / Art. 440 instead.
const SMALL_COND_CAP = { 14: 15, 12: 20, 10: 30, 8: null, 6: null };
const WIRE_OPTIONS  = [14, 12, 10, 8, 6];
const AMP_OPTIONS   = [15, 20, 30, 40, 50];
const TYPE_LABELS   = { standard: "Standard", gfci: "GFCI", afci: "AFCI", dual: "Dual GFCI/AFCI" };

/* Circuit pool. Fields:
   v            120 | 240
   amps         nominal correct breaker size (non-HVAC)
   wire         spec conductor (AWG)
   protection   standard | gfci | afci | dual   (dual = AFCI+GFCI required)
   hvac         if true, breaker sized to nameplate: mca ≤ breaker ≤ mocp,
                and conductor sized to MCA (NEC 240.4(G)/440.4(B), NOT 240.4(D))
   mandatory    part of the NEC 210.11(C) required-circuit set                    */
const MANDATORY_POOL = [
  { key: "ksa1", name: "Kitchen small-appliance #1", desc: "20A counter circuit · 210.11(C)(1) · kitchen = AFCI+GFCI", v: 120, amps: 20, wire: 12, protection: "dual", mandatory: true },
  { key: "ksa2", name: "Kitchen small-appliance #2", desc: "2nd required 20A counter circuit · 210.11(C)(1)",          v: 120, amps: 20, wire: 12, protection: "dual", mandatory: true },
  { key: "laundry", name: "Laundry circuit",         desc: "Dedicated 20A · 210.11(C)(2) · laundry = AFCI+GFCI",       v: 120, amps: 20, wire: 12, protection: "dual", mandatory: true },
  { key: "bath",   name: "Bathroom circuit",          desc: "20A · 210.11(C)(3) · GFCI (not on AFCI list)",             v: 120, amps: 20, wire: 12, protection: "gfci", mandatory: true },
];

const EXTRA_POOL = [
  { key: "bedroom",  name: "Bedroom receptacles",  desc: "General receptacles · AFCI (210.12(B))",                 v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "living",   name: "Living room circuit",  desc: "Living area · AFCI (210.12(B))",                          v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "lighting", name: "Hall / general lighting", desc: "Lighting · AFCI (210.12(B))",                          v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "garage",   name: "Garage receptacles",   desc: "GFCI (210.8(A)) · garage not on AFCI list",              v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "outdoor",  name: "Outdoor receptacles",  desc: "Weather-resistant · GFCI (210.8(A))",                    v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "dishwash", name: "Dishwasher",           desc: "Kitchen appliance · GFCI (422.5) + AFCI ⇒ dual",         v: 120, amps: 20, wire: 12, protection: "dual" },
  { key: "range",    name: "Electric range",       desc: "240V receptacle · GFCI (2023, conservative)",            v: 240, amps: 40, wire: 8,  protection: "gfci" },
  { key: "dryer",    name: "Electric dryer",       desc: "240V receptacle · GFCI (2023, conservative)",            v: 240, amps: 30, wire: 10, protection: "gfci" },
  { key: "wheater",  name: "Water heater",         desc: "240V hardwired · standard (no receptacle)",              v: 240, amps: 30, wire: 10, protection: "standard" },
  { key: "furnace",  name: "Electric furnace",     desc: "240V electric heat · standard",                          v: 240, amps: 50, wire: 6,  protection: "standard" },
  { key: "hvac",     name: "A/C condenser",        desc: "Outdoor · nameplate MCA 24.5A, Max OCPD 40A · GFCI (210.8(F))",
    v: 240, wire: 10, protection: "gfci", hvac: true, mca: 24.5, mocp: 40 },
];

const DIFFICULTY = { basic: 5, standard: 7, advanced: 9 };

/* ---- Shuffle ----------------------------------------------------------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Work order = the mandatory 210.11(C) core + random extras (>=1 always 240V). */
function buildWorkOrder(count) {
  const core = MANDATORY_POOL.slice();               // always the 4 required circuits
  const need = Math.max(count, core.length) - core.length;
  const extras = shuffle(EXTRA_POOL);
  const picked = [];
  // guarantee at least one 240V load for a realistic job
  const first240 = extras.find(c => c.v === 240);
  if (need > 0 && first240) picked.push(first240);
  for (const c of extras) {
    if (picked.length >= need) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return shuffle(core.concat(picked.slice(0, need)))
    .map((def, i) => ({ ...def, uid: def.key + "_" + i }));
}

/* ---- Job state --------------------------------------------------------- */
let job = null;

function newJob(difficulty) {
  const circuits = buildWorkOrder(DIFFICULTY[difficulty] || 7);
  job = { difficulty, circuits, assign: {}, amps: {}, wire: {}, type: {}, startTs: Date.now() };
  circuits.forEach(c => { job.assign[c.uid] = ""; job.amps[c.uid] = ""; job.wire[c.uid] = ""; job.type[c.uid] = ""; });
}

/* Physical slots a circuit occupies (2-pole spans same-column n & n+2). */
function occupiedSlots(circuit, start) {
  if (!start) return [];
  const s = Number(start);
  return circuit.v === 240 ? [s, s + 2] : [s];
}
function buildOccupancy(exceptUid) {
  const map = {};
  for (const c of job.circuits) {
    if (c.uid === exceptUid) continue;
    occupiedSlots(c, job.assign[c.uid]).forEach(s => { map[s] = c.uid; });
  }
  return map;
}
function validStarts(circuit) {
  const used = buildOccupancy(circuit.uid);
  const starts = [];
  for (let s = 1; s <= SLOT_COUNT; s++) {
    const need = circuit.v === 240 ? [s, s + 2] : [s];
    if (need.every(n => n >= 1 && n <= SLOT_COUNT && !(n in used))) starts.push(s);
  }
  return starts;
}

/* ======================================================================= */
/*  Rendering                                                              */
/* ======================================================================= */
const $ = (sel) => document.querySelector(sel);

function renderPanel() {
  const occ = buildOccupancy(null);
  const slotsEl = $("#slots");
  slotsEl.innerHTML = "";
  for (let s = 1; s <= SLOT_COUNT; s++) {
    const uid = occ[s];
    const c = uid ? job.circuits.find(x => x.uid === uid) : null;
    const div = document.createElement("div");
    div.className = "slot" + (c ? (c.v === 240 ? " filled pole240" : " filled") : "");
    div.innerHTML = `<span class="num">${s}</span><span class="lbl">${c ? c.name : ""}</span>`;
    slotsEl.appendChild(div);
  }
}

function optionList(values, current, labeler) {
  return ['<option value="">—</option>']
    .concat(values.map(v => `<option value="${v}" ${String(v) === String(current) ? "selected" : ""}>${labeler(v)}</option>`))
    .join("");
}

function renderCircuits() {
  const list = $("#circuitList");
  list.innerHTML = "";
  for (const c of job.circuits) {
    const starts = validStarts(c);
    const card = document.createElement("div");
    card.className = "circuit";
    const badge = c.hvac ? `${c.v}V · HVAC` : (c.v === 240 ? `${c.v}V · 2-pole` : `${c.v}V`);
    card.innerHTML = `
      <div class="circuit-top">
        <div>
          <div class="circuit-name">${c.name}</div>
          <div class="circuit-desc">${c.desc}</div>
        </div>
        <span class="badge ${c.v === 240 ? "v240" : ""}">${badge}</span>
      </div>
      <div class="controls">
        <label>Slot
          <select data-field="assign" data-uid="${c.uid}">
            ${optionList(starts, job.assign[c.uid], s => c.v === 240 ? `${s} & ${s + 2}` : `${s}`)}
          </select>
        </label>
        <label>Breaker A
          <select data-field="amps" data-uid="${c.uid}">
            ${optionList(AMP_OPTIONS, job.amps[c.uid], a => `${a} A`)}
          </select>
        </label>
        <label>Type
          <select data-field="type" data-uid="${c.uid}">
            ${optionList(Object.keys(TYPE_LABELS), job.type[c.uid], t => TYPE_LABELS[t])}
          </select>
        </label>
        <label>Wire
          <select data-field="wire" data-uid="${c.uid}">
            ${optionList(WIRE_OPTIONS, job.wire[c.uid], w => `${w} AWG`)}
          </select>
        </label>
      </div>`;
    list.appendChild(card);
  }
  list.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const { field, uid } = e.target.dataset;
      job[field][uid] = e.target.value;
      if (field === "assign") { renderCircuits(); renderPanel(); }
    });
  });
}

function renderWorkspace() {
  $("#panelRating").textContent = `${PANEL_MODEL} · 200A · ${SLOT_COUNT} spaces`;
  renderPanel();
  renderCircuits();
}

/* ======================================================================= */
/*  Scoring  (see NEC-2023-VALIDATION.md)                                  */
/* ======================================================================= */
// smallest breaker option >= a
function minStdAmp(a) { return AMP_OPTIONS.find(x => x >= a); }

function scoreJob() {
  const details = [];
  let earned = 0, max = 0, faults = 0, critical = 0;

  for (const c of job.circuits) {
    const issues = [];
    const start = job.assign[c.uid];
    const amps  = Number(job.amps[c.uid]);
    const wire  = Number(job.wire[c.uid]);
    const type  = job.type[c.uid];

    max += 3; // breaker, wire, protection

    if (!start || !amps || !wire || !type) {
      issues.push({ level: "fail", text: "Circuit not fully installed (missing slot, breaker, type, or wire)." });
      faults++; critical++;
      details.push({ name: c.name, ok: false, issues });
      continue;
    }

    // ---- 1) Breaker sizing --------------------------------------------
    if (c.hvac) {
      // Nameplate governs: MCA floor, MOCP ceiling. 240.4(D) does NOT apply.
      const floor = minStdAmp(c.mca);
      if (amps > c.mocp) { faults++; critical++; issues.push({ level: "fail", text: `Breaker ${amps}A exceeds nameplate Max OCPD (${c.mocp}A) — NEC 440.4(B).` }); }
      else if (amps < floor) { faults++; issues.push({ level: "warn", text: `Breaker ${amps}A is below the circuit MCA (${c.mca}A) — undersized for the unit.` }); }
      else earned++;   // e.g. 30A OR 40A both valid here
    } else if (amps === c.amps) {
      earned++;
    } else {
      faults++;
      if (amps > c.amps) { critical++; issues.push({ level: "fail", text: `Breaker oversized: ${amps}A on a ${c.amps}A circuit — overcurrent/fire risk (240.4(D)).` }); }
      else issues.push({ level: "warn", text: `Breaker undersized: ${amps}A where ${c.amps}A is required — nuisance tripping.` });
    }

    // ---- 2) Conductor --------------------------------------------------
    const ampacity = WIRE_AMPACITY[wire] || 0;
    // Ampacity floor: HVAC sizes to MCA; everything else to the breaker.
    const floor = c.hvac ? c.mca : amps;
    // 240.4(D) small-conductor cap applies to normal circuits, NOT to HVAC (440/240.4(G)).
    const cap = c.hvac ? null : SMALL_COND_CAP[wire];
    if (ampacity < floor) {
      faults++; critical++;
      issues.push({ level: "fail", text: `Wire ${wire} AWG (${ampacity}A) undersized for ${c.hvac ? `MCA ${c.mca}A` : `${amps}A breaker`} — FIRE HAZARD.` });
    } else if (!c.hvac && cap != null && amps > cap) {
      faults++; critical++;
      issues.push({ level: "fail", text: `${wire} AWG limited to ${cap}A by NEC 240.4(D); ${amps}A breaker violates the small-conductor rule.` });
    } else if (wire !== c.wire) {
      earned += 0.5; faults++;
      issues.push({ level: "warn", text: `Wire ${wire} AWG is adequate but spec calls for ${c.wire} AWG for this load.` });
    } else {
      earned++;
    }

    // ---- 3) Protection -------------------------------------------------
    const okProt =
      (c.protection === "gfci" && (type === "gfci" || type === "dual")) ||
      (c.protection === "afci" && (type === "afci" || type === "dual")) ||
      (c.protection === "dual" && type === "dual") ||
      (c.protection === "standard" && type === "standard");
    if (okProt) {
      earned++;
    } else if (c.protection === "dual") {
      faults++; critical++;
      issues.push({ level: "fail", text: `Requires dual-function (AFCI+GFCI); ${TYPE_LABELS[type]} provides only part — 210.8 & 210.12(B).` });
    } else if (c.protection === "standard") {
      earned += 0.5; faults++;
      issues.push({ level: "warn", text: `${TYPE_LABELS[type]} breaker used where a standard breaker is sufficient.` });
    } else {
      faults++; critical++;
      const need = c.protection === "gfci" ? "GFCI" : "AFCI";
      issues.push({ level: "fail", text: `Missing ${need} protection required for this location — code violation / shock or arc-fault risk.` });
    }

    if (issues.length === 0) issues.push({ level: "ok", text: "Installed to spec." });
    details.push({ name: c.name, ok: issues.every(i => i.level === "ok"), issues });
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
        <p>${res.faults} fault(s) · ${res.critical} critical hazard(s) · completed in ${res.durationSec}s · saved to records</p>
      </div>
    </div>
    <div class="findings">${findings}</div>`;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ======================================================================= */
/*  Records (localStorage)                                                 */
/* ======================================================================= */
function loadRecords() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveRecord(rec) {
  const all = loadRecords();
  all.unshift(rec);
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}
function recordFromResult(res) {
  return {
    id: "att_" + job.startTs,
    ts: new Date().toISOString(),
    trainee: ($("#traineeName").value || "Anonymous").trim(),
    difficulty: job.difficulty,
    circuits: job.circuits.length,
    score: res.score, pass: res.pass, faults: res.faults, critical: res.critical,
    durationSec: res.durationSec,
  };
}

function renderRecords() {
  const all = loadRecords();
  const nameF = $("#filterName").value.trim().toLowerCase();
  const passF = $("#filterPass").value;
  const minF  = Number($("#filterMinScore").value) || 0;

  const rows = all.filter(r =>
    (!nameF || r.trainee.toLowerCase().includes(nameF)) &&
    (!passF || (passF === "pass" ? r.pass : !r.pass)) &&
    (r.score >= minF));

  const n = rows.length;
  const passCount = rows.filter(r => r.pass).length;
  const avg = n ? Math.round(rows.reduce((s, r) => s + r.score, 0) / n) : 0;
  $("#recordStats").innerHTML = `
    <span><b>${n}</b> attempt(s)</span>
    <span><b>${n ? Math.round((passCount / n) * 100) : 0}%</b> pass rate</span>
    <span><b>${avg}%</b> avg score</span>`;

  const tbody = $("#recordsTable tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No records yet. Complete an inspection in the Simulator tab.</td></tr>`;
    return;
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${new Date(r.ts).toLocaleString()}</td>
      <td>${escapeHtml(r.trainee)}</td>
      <td>${r.difficulty}</td>
      <td class="mono">${r.score}%</td>
      <td><span class="pill ${r.pass ? "pass" : "fail"}">${r.pass ? "PASS" : "FAIL"}</span></td>
      <td class="mono">${r.faults} (${r.critical} crit)</td>
      <td class="mono">${r.durationSec}s</td>
      <td><button class="link-btn" data-del="${r.id}">delete</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("[data-del]").forEach(b =>
    b.addEventListener("click", () => {
      localStorage.setItem(STORE_KEY, JSON.stringify(loadRecords().filter(x => x.id !== b.dataset.del)));
      renderRecords();
    }));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function exportCsv() {
  const all = loadRecords();
  const cols = ["id", "ts", "trainee", "difficulty", "circuits", "score", "pass", "faults", "critical", "durationSec"];
  const lines = [cols.join(",")].concat(all.map(r =>
    cols.map(k => { const v = String(r[k]); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(",")));
  download("panel_trainer_records.csv", lines.join("\n"), "text/csv");
}

/* ======================================================================= */
/*  UI wiring                                                              */
/* ======================================================================= */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab").forEach(t =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".tabpane").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      $("#tab-" + t.dataset.tab).classList.add("active");
      if (t.dataset.tab === "records") renderRecords();
    }));

  $("#startBtn").addEventListener("click", () => {
    newJob($("#difficulty").value);
    $("#workspace").classList.remove("hidden");
    $("#result").classList.add("hidden");
    renderWorkspace();
  });
  $("#resetBtn").addEventListener("click", () => {
    newJob(job.difficulty);
    $("#result").classList.add("hidden");
    renderWorkspace();
  });
  $("#inspectBtn").addEventListener("click", () => {
    const res = scoreJob();
    saveRecord(recordFromResult(res));
    renderResult(res);
  });

  ["filterName", "filterPass", "filterMinScore"].forEach(id => $("#" + id).addEventListener("input", renderRecords));
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#exportJson").addEventListener("click", () =>
    download("panel_trainer_records.json", JSON.stringify(loadRecords(), null, 2), "application/json"));
  $("#clearRecords").addEventListener("click", () => {
    if (confirm("Delete ALL scoring records? This cannot be undone.")) { localStorage.removeItem(STORE_KEY); renderRecords(); }
  });
});
