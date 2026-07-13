/* =========================================================================
   Service Panel Install Trainer — POC
   Pure client-side. Scoring records persist in localStorage.
   ========================================================================= */

const SLOT_COUNT = 20;              // panel spaces (10 per column)
const STORE_KEY = "panelTrainer.records.v1";
const PASS_THRESHOLD = 80;          // % to pass

/* ---- Reference data ---------------------------------------------------- */
// NM cable ampacity (typical 60°C residential). Wire must be rated >= breaker.
const WIRE_AMPACITY = { 14: 15, 12: 20, 10: 30, 8: 40, 6: 55 };
const WIRE_OPTIONS  = [14, 12, 10, 8, 6];
const AMP_OPTIONS   = [15, 20, 30, 40, 50];
const TYPE_LABELS   = { standard: "Standard", gfci: "GFCI", afci: "AFCI", dual: "Dual GFCI/AFCI" };

// Circuit pool. protection: what the code requires for this location.
// Accepts 'dual' anywhere gfci or afci is required.
const CIRCUIT_POOL = [
  { key: "bedroom",   name: "Bedroom receptacles",  desc: "General-use receptacles in a bedroom",   v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "living",    name: "Living room circuit",  desc: "Living area receptacles & lighting",     v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "lighting",  name: "General lighting",     desc: "Hallway / general lighting circuit",     v: 120, amps: 15, wire: 14, protection: "afci" },
  { key: "kitchen",   name: "Kitchen counter",      desc: "Small-appliance counter receptacles",    v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "bath",      name: "Bathroom",             desc: "Bathroom receptacle circuit",            v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "laundry",   name: "Laundry",              desc: "Laundry room receptacle",                v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "garage",    name: "Garage receptacles",   desc: "Garage general-use receptacles",         v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "outdoor",   name: "Outdoor receptacles",  desc: "Exterior weather-resistant receptacles", v: 120, amps: 20, wire: 12, protection: "gfci" },
  { key: "range",     name: "Electric range",       desc: "240V kitchen range",                     v: 240, amps: 40, wire: 8,  protection: "standard" },
  { key: "dryer",     name: "Electric dryer",       desc: "240V laundry dryer",                     v: 240, amps: 30, wire: 10, protection: "standard" },
  { key: "wheater",   name: "Water heater",         desc: "240V electric water heater",             v: 240, amps: 30, wire: 10, protection: "standard" },
  { key: "hvac",      name: "AC condenser",         desc: "240V outdoor A/C unit",                  v: 240, amps: 30, wire: 10, protection: "standard" },
  { key: "furnace",   name: "Electric furnace",     desc: "240V electric heat",                     v: 240, amps: 50, wire: 6,  protection: "standard" },
];

const DIFFICULTY = { basic: 5, standard: 7, advanced: 9 };

/* ---- Deterministic-ish shuffle ---------------------------------------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Build a work order: guarantee a couple of 240V loads + a GFCI + an AFCI. */
function buildWorkOrder(count) {
  const v240 = shuffle(CIRCUIT_POOL.filter(c => c.v === 240));
  const gfci = shuffle(CIRCUIT_POOL.filter(c => c.protection === "gfci"));
  const afci = shuffle(CIRCUIT_POOL.filter(c => c.protection === "afci"));
  const picked = [];
  const take = (c) => { if (c && !picked.find(p => p.key === c.key)) picked.push(c); };
  take(v240[0]); take(v240[1]); take(gfci[0]); take(afci[0]);
  const rest = shuffle(CIRCUIT_POOL.filter(c => !picked.find(p => p.key === c.key)));
  for (const c of rest) { if (picked.length >= count) break; take(c); }
  return shuffle(picked.slice(0, count)).map((def, i) => ({ ...def, uid: def.key + "_" + i }));
}

/* ---- Job state --------------------------------------------------------- */
let job = null;

function newJob(difficulty) {
  const circuits = buildWorkOrder(DIFFICULTY[difficulty] || 7);
  job = {
    difficulty,
    circuits,
    assign: {}, amps: {}, wire: {}, type: {},
    startTs: Date.now(),
  };
  circuits.forEach(c => {
    job.assign[c.uid] = "";
    job.amps[c.uid]   = "";
    job.wire[c.uid]   = "";
    job.type[c.uid]   = "";
  });
}

/* Which physical slots a circuit occupies given its start slot. */
function occupiedSlots(circuit, start) {
  if (!start) return [];
  const s = Number(start);
  return circuit.v === 240 ? [s, s + 2] : [s];   // 2-pole uses same-column adjacent space
}

/* Map of slot -> circuit uid, plus validity. Excludes one uid if provided. */
function buildOccupancy(exceptUid) {
  const map = {};
  for (const c of job.circuits) {
    if (c.uid === exceptUid) continue;
    const slots = occupiedSlots(c, job.assign[c.uid]);
    slots.forEach(s => { map[s] = c.uid; });
  }
  return map;
}

/* Valid starting slots for a circuit, given current occupancy of others. */
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
    .concat(values.map(v =>
      `<option value="${v}" ${String(v) === String(current) ? "selected" : ""}>${labeler(v)}</option>`))
    .join("");
}

function renderCircuits() {
  const list = $("#circuitList");
  list.innerHTML = "";
  for (const c of job.circuits) {
    const starts = validStarts(c);
    const card = document.createElement("div");
    card.className = "circuit";
    card.innerHTML = `
      <div class="circuit-top">
        <div>
          <div class="circuit-name">${c.name}</div>
          <div class="circuit-desc">${c.desc}</div>
        </div>
        <span class="badge ${c.v === 240 ? "v240" : ""}">${c.v}V${c.v === 240 ? " · 2-pole" : ""}</span>
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
  // Wire up change handlers
  list.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const { field, uid } = e.target.dataset;
      job[field][uid] = e.target.value;
      // Slot changes affect availability elsewhere -> full re-render.
      if (field === "assign") { renderCircuits(); renderPanel(); }
    });
  });
}

function renderWorkspace() {
  $("#panelRating").textContent = `200A · ${SLOT_COUNT} spaces`;
  renderPanel();
  renderCircuits();
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
    const amps  = Number(job.amps[c.uid]);
    const wire  = Number(job.wire[c.uid]);
    const type  = job.type[c.uid];

    max += 3; // amps, wire, protection

    if (!start || !amps || !wire || !type) {
      issues.push({ level: "fail", text: "Circuit not fully installed (missing slot, breaker, type, or wire)." });
      faults++; critical++;
      details.push({ name: c.name, ok: false, issues });
      continue;
    }

    // 1) Breaker sizing
    if (amps === c.amps) { earned++; }
    else {
      faults++;
      if (amps > c.amps) { critical++; issues.push({ level: "fail", text: `Breaker oversized: ${amps}A on a circuit rated for ${c.amps}A — overcurrent/fire risk.` }); }
      else issues.push({ level: "warn", text: `Breaker undersized: ${amps}A where ${c.amps}A is required — nuisance tripping.` });
    }

    // 2) Wire vs breaker (ampacity must cover breaker) and vs spec
    const ampacity = WIRE_AMPACITY[wire] || 0;
    if (ampacity < amps) {
      faults++; critical++;
      issues.push({ level: "fail", text: `Wire ${wire} AWG (${ampacity}A) is undersized for a ${amps}A breaker — FIRE HAZARD.` });
    } else if (wire !== c.wire) {
      // Adequate for the breaker but not the spec'd gauge
      earned += 0.5; faults++;
      issues.push({ level: "warn", text: `Wire ${wire} AWG works but spec calls for ${c.wire} AWG for this load.` });
    } else {
      earned++;
    }

    // 3) Protection type
    const okProt =
      (c.protection === "gfci" && (type === "gfci" || type === "dual")) ||
      (c.protection === "afci" && (type === "afci" || type === "dual")) ||
      (c.protection === "standard" && type === "standard");
    if (okProt) { earned++; }
    else if (c.protection === "standard") {
      // Extra protection on an appliance circuit: allowed but unnecessary
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
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
  catch { return []; }
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
    score: res.score,
    pass: res.pass,
    faults: res.faults,
    critical: res.critical,
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

  // Stats
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
      const all = loadRecords().filter(x => x.id !== b.dataset.del);
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
      renderRecords();
    }));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
    cols.map(k => {
      const v = String(r[k]);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(",")));
  download("panel_trainer_records.csv", lines.join("\n"), "text/csv");
}

/* ======================================================================= */
/*  Wiring up the UI                                                       */
/* ======================================================================= */
document.addEventListener("DOMContentLoaded", () => {
  // Tabs
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

  // Records controls
  ["filterName", "filterPass", "filterMinScore"].forEach(id =>
    $("#" + id).addEventListener("input", renderRecords));
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#exportJson").addEventListener("click", () =>
    download("panel_trainer_records.json", JSON.stringify(loadRecords(), null, 2), "application/json"));
  $("#clearRecords").addEventListener("click", () => {
    if (confirm("Delete ALL scoring records? This cannot be undone.")) {
      localStorage.removeItem(STORE_KEY);
      renderRecords();
    }
  });
});
