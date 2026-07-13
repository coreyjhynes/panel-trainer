/* =========================================================================
   Service Panel Install Trainer
   Hardware: Square D Homeline HOM4080M200PC (200A, 40 spaces)
   Code: NEC 2023 (conservative). See NEC-2023-VALIDATION.md.

   Flow:
     • Requirements tab: set difficulty, generate a job. It shows a
       self-contained work order (scenario + spec table + grading + markdown).
     • Panel tab: a graphical load center + a side rail of hardware. Drag a
       BREAKER (configured poles + type) into an empty slot, then drag WIRE
       gauges onto each breaker TERMINAL. Run inspection.
     • Scoring matches the breakers you installed against the required circuits.
   ========================================================================= */

const PANEL_MODEL = "HOM4080M200PC";
const SLOT_COUNT = 40;
const PASS_THRESHOLD = 80;
const API_BASE = "";            // same origin (Azure SWA / local dev-server)

/* ---- Reference data ---------------------------------------------------- */
const WIRE_OPTIONS = [14, 12, 10, 8, 6];
const AMP_OPTIONS = [15, 20, 30, 40, 50];
const TYPE_LABELS = { standard: "Standard", gfci: "GFCI", afci: "AFCI", dual: "Dual GFCI/AFCI" };
const PROT_LABELS = { standard: "Standard", gfci: "GFCI", afci: "AFCI", dual: "AFCI+GFCI (dual-function)" };
const TYPE_COLOR = { standard: "var(--t-standard)", gfci: "var(--t-gfci)", afci: "var(--t-afci)", dual: "var(--t-dual)" };
const WIRE_COLOR = { 14: "#e8e8e8", 12: "#f4c542", 10: "#e8863c", 8: "#4a4a4a", 6: "#3a6fb0" };
const WIRE_TEXT = { 14: "#111", 12: "#111", 10: "#111", 8: "#fff", 6: "#fff" };

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
function reqBreakerLabel(c) { return c.hvac ? `30–${c.mocp}A (≤ nameplate MOCP)` : `${c.amps}A`; }

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

/* ---- Job / panel state ------------------------------------------------- */
let job = null;
const binState = { poles: 1, type: "standard" };

function newJob(difficulty) {
  const circuits = buildWorkOrder(DIFFICULTY[difficulty] || 7);
  // instanceId = one run per app instance; re-inspecting upserts this record.
  job = { difficulty, circuits, units: [], nextId: 1, startTs: Date.now(),
    instanceId: "run_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) };
}

/* A unit = an installed breaker. terminals: {A:gauge|null [,B]}. */
function unitSlots(u) { return u.poles === 2 ? [u.slot, u.slot + 2] : [u.slot]; }
function occupancy() { const m = {}; if (job) job.units.forEach(u => unitSlots(u).forEach(s => { m[s] = u; })); return m; }
function slotFree(slot, poles) {
  const occ = occupancy();
  const need = poles === 2 ? [slot, slot + 2] : [slot];
  return need.every(n => n >= 1 && n <= SLOT_COUNT && !occ[n]);
}
function unitById(id) { return job.units.find(u => u.id === id); }

/* ======================================================================= */
/*  Drag & drop plumbing                                                   */
/* ======================================================================= */
function setDrag(e, payload) {
  e.dataTransfer.setData("application/json", JSON.stringify(payload));
  e.dataTransfer.setData("app/" + payload.kind, "1");
  e.dataTransfer.effectAllowed = "copyMove";
}
function dragHasKind(e, kind) { return Array.from(e.dataTransfer.types).includes("app/" + kind); }
function readPayload(e) { try { return JSON.parse(e.dataTransfer.getData("application/json")); } catch { return null; } }

/* ======================================================================= */
/*  Rendering — hardware rail                                              */
/* ======================================================================= */
function renderBins() {
  document.querySelectorAll(".seg").forEach(seg => {
    const key = seg.dataset.seg;
    seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.val === String(binState[key])));
  });
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

/* ======================================================================= */
/*  Rendering — the panel                                                  */
/* ======================================================================= */
function renderPanel() {
  const occ = occupancy();
  const slotsEl = $("#slots");
  slotsEl.innerHTML = "";
  for (let s = 1; s <= SLOT_COUNT; s++) {
    const u = occ[s];
    const div = document.createElement("div");
    div.dataset.slot = s;
    if (!u) {
      div.className = "pslot empty";
      div.innerHTML = `<span class="snum">${s}</span>`;
      div.addEventListener("dragover", e => { if (dragHasKind(e, "breaker")) { e.preventDefault(); div.classList.add("drop-ok"); } });
      div.addEventListener("dragleave", () => div.classList.remove("drop-ok"));
      div.addEventListener("drop", e => {
        div.classList.remove("drop-ok");
        const p = readPayload(e); if (!p || p.kind !== "breaker") return;
        e.preventDefault();
        if (slotFree(s, p.poles)) {
          const terminals = p.poles === 2 ? { A: null, B: null } : { A: null };
          job.units.push({ id: job.nextId++, slot: s, poles: p.poles, amps: p.amps, type: p.type, terminals });
          renderPanel();
        }
      });
    } else if (u.slot === s) {
      div.className = "pslot placed";
      const termHtml = Object.keys(u.terminals).map(k => {
        const g = u.terminals[k];
        const wired = g != null;
        const chip = wired
          ? `<span class="tw" data-clearterm="${u.id}:${k}" style="background:${WIRE_COLOR[g]};color:${WIRE_TEXT[g]}">${g} AWG ✕</span>`
          : `<span style="opacity:.7">drop wire</span>`;
        return `<span class="term ${wired ? "wired" : ""}" data-term="${u.id}:${k}"><span class="tlabel">${k}</span>${chip}</span>`;
      }).join("");
      div.innerHTML = `<span class="snum">${s}</span>
        <div class="brkbody" style="border-left-color:${TYPE_COLOR[u.type]}">
          <div class="brkline"><span>${u.amps}A · ${u.poles}P · ${TYPE_LABELS[u.type]}</span><span class="x" data-remove="${u.id}" title="Remove breaker">✕</span></div>
          <div class="terminals">${termHtml}</div>
        </div>`;
      attachTerminalDrops(div, u);
    } else {
      div.className = "pslot cont";
      div.innerHTML = `<span class="snum">${s}</span><span>↑ ${u.amps}A ${u.poles}P (same breaker)</span>`;
    }
    slotsEl.appendChild(div);
  }
}

function attachTerminalDrops(div, u) {
  div.querySelectorAll(".term").forEach(term => {
    const [id, key] = term.dataset.term.split(":");
    term.addEventListener("dragover", e => { if (dragHasKind(e, "wire")) { e.preventDefault(); term.classList.add("drop-ok"); } });
    term.addEventListener("dragleave", () => term.classList.remove("drop-ok"));
    term.addEventListener("drop", e => {
      term.classList.remove("drop-ok");
      const p = readPayload(e); if (!p || p.kind !== "wire") return;
      e.preventDefault();
      const unit = unitById(Number(id)); if (unit) { unit.terminals[key] = p.gauge; renderPanel(); }
    });
  });
}

function onSlotsClick(e) {
  const rm = e.target.closest("[data-remove]");
  if (rm) { job.units = job.units.filter(u => u.id !== Number(rm.dataset.remove)); renderPanel(); return; }
  const ct = e.target.closest("[data-clearterm]");
  if (ct) { const [id, key] = ct.dataset.clearterm.split(":"); const u = unitById(Number(id)); if (u) { u.terminals[key] = null; renderPanel(); } }
}

function renderPanelTab() {
  if (!job) { $("#noJob").classList.remove("hidden"); $("#simLayout").classList.add("hidden"); return; }
  $("#noJob").classList.add("hidden"); $("#simLayout").classList.remove("hidden");
  $("#panelRating").textContent = `${PANEL_MODEL} · 200A · ${SLOT_COUNT} spaces`;
  renderBins();
  renderPanel();
}

/* Scoring is performed server-side (api/lib/scoring.js). The app posts the
   current panel state to /api/scores and renders the result it returns. */

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
        <p>${res.faults} fault(s) · ${res.critical} critical hazard(s) · ${res.durationSec}s · recorded to the external scoring service</p>
      </div>
    </div>
    <div class="findings">${findings}</div>`;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ======================================================================= */
/*  Requirements: rendered work order + markdown                          */
/* ======================================================================= */
function jobRows() {
  return job.circuits.map((c, i) => ({
    n: i + 1, name: c.name, v: c.v + "V",
    breaker: reqBreakerLabel(c), poles: c.v === 240 ? "2-pole" : "1-pole",
    wire: c.hvac ? `${c.wire} AWG (per MCA)` : `${c.wire} AWG`,
    prot: PROT_LABELS[c.protection],
    note: c.hvac ? `MCA ${c.mca}A; size to nameplate, not 240.4(D)` : c.desc,
  }));
}
function jobMarkdown() {
  const L = [];
  L.push(`# Panel Install Work Order`, ``);
  L.push(`- **Panel:** Square D Homeline ${PANEL_MODEL} — 200 A main breaker, 40 spaces, 120/240 V 1-phase`);
  L.push(`- **Code basis:** NEC 2023 (conservative interpretation)`);
  L.push(`- **Difficulty:** ${job.difficulty} (${job.circuits.length} circuits)`);
  L.push(`- **Generated:** ${new Date().toISOString()}`, ``);
  L.push(`## Scenario`);
  L.push(`Install and wire the branch circuits below into the load center. For each circuit install a breaker of the correct **amperage, pole count, and protection type**, and land a conductor of the correct **gauge** on **every pole terminal**. Wiring must satisfy NEC 2023, including the 210.11(C) required-circuit minimums, 240.4(D) conductor protection (with the Article 440 HVAC exception), and the 210.8 / 210.12(B) GFCI/AFCI rules.`, ``);
  L.push(`## Required circuits`, ``);
  L.push(`| # | Load | Volts | Breaker | Poles | Wire | Protection | Notes / Code |`);
  L.push(`|---|------|-------|---------|-------|------|-----------|--------------|`);
  jobRows().forEach(r => L.push(`| ${r.n} | ${r.name} | ${r.v} | ${r.breaker} | ${r.poles} | ${r.wire} | ${r.prot} | ${r.note} |`));
  L.push(``, `## Grading`);
  L.push(`Each circuit is scored on three checks — breaker (poles + sizing), conductor, and protection. **Pass = ≥ ${PASS_THRESHOLD}% and zero critical hazards.** Critical hazards include undersized or unlanded conductors, mismatched conductor gauges across poles, oversized breakers on normal circuits, wrong pole count on 240 V loads, and missing required GFCI/AFCI protection.`);
  return L.join("\n");
}
function renderRequirements() {
  const empty = $("#reqEmpty"), body = $("#reqBody");
  if (!job) { empty.classList.remove("hidden"); body.classList.add("hidden"); return; }
  empty.classList.add("hidden"); body.classList.remove("hidden");
  const rows = jobRows().map(r => `<tr>
    <td class="mono">${r.n}</td><td>${escapeHtml(r.name)}</td><td class="mono">${r.v}</td>
    <td class="mono">${r.breaker}</td><td class="mono">${r.poles}</td><td class="mono">${r.wire}</td>
    <td>${escapeHtml(r.prot)}</td><td>${escapeHtml(r.note)}</td></tr>`).join("");
  $("#reqTitle").textContent = `Work Order — ${job.circuits.length} circuits (${job.difficulty})`;
  $("#reqRendered").innerHTML = `
    <p>Install every circuit below into the load center on the <b>Panel</b> tab: correct breaker (amps, poles, protection) with the correct conductor gauge landed on each pole terminal.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Load</th><th>Volts</th><th>Breaker</th><th>Poles</th><th>Wire</th><th>Protection</th><th>Notes / Code</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p style="margin-top:12px"><b>Pass = ≥ ${PASS_THRESHOLD}% and zero critical hazards.</b> Panel: Square D Homeline ${PANEL_MODEL}, 200 A, 40 spaces · Code: NEC 2023 (conservative).</p>`;
  $("#reqMarkdown").textContent = jobMarkdown();
}

/* ======================================================================= */
/*  Inspection (external scoring) + Records tab                            */
/* ======================================================================= */
/* The current panel state, sent to the API which scores it. */
function currentState() {
  return {
    instanceId: job.instanceId,
    difficulty: job.difficulty,
    durationSec: Math.round((Date.now() - job.startTs) / 1000),
    circuits: job.circuits.map(c => ({ uid: c.uid, name: c.name, v: c.v, amps: c.amps, wire: c.wire, protection: c.protection, hvac: !!c.hvac, mca: c.mca, mocp: c.mocp })),
    units: job.units.map(u => ({ id: u.id, slot: u.slot, poles: u.poles, amps: u.amps, type: u.type, terminals: u.terminals })),
  };
}

/* POST the state to the external scorer; render the single returned result. */
async function runInspection() {
  if (!job) { renderRecordsTab(); return; }
  const btn = $("#inspectBtn"), label = btn.textContent;
  btn.disabled = true; btn.textContent = "Scoring…";
  try {
    const res = await fetch(`${API_BASE}/api/scores`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(currentState()) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    renderResult(await res.json());
  } catch (e) {
    const el = $("#result"); el.classList.remove("hidden");
    el.innerHTML = `<div class="finding fail"><span class="icon">❌</span><span><span class="fname">Scoring service unavailable:</span> <span class="fmsg">${escapeHtml(e.message)}. Scoring runs on the external API — use the Azure deployment or run dev-server.js.</span></span></div>`;
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

/* Records tab holds only the inspect action + the single current result. */
function renderRecordsTab() {
  const has = !!job;
  $("#noJobRecords").classList.toggle("hidden", has);
  $("#inspectBtn").classList.toggle("hidden", !has);
  if (!has) $("#result").classList.add("hidden");
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function download(filename, text, type) { const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }

/* ======================================================================= */
/*  UI wiring                                                              */
/* ======================================================================= */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tabpane").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    $("#tab-" + t.dataset.tab).classList.add("active");
    if (t.dataset.tab === "req") renderRequirements();
    if (t.dataset.tab === "sim") renderPanelTab();
    if (t.dataset.tab === "records") renderRecordsTab();
  }));

  document.querySelectorAll(".seg").forEach(seg => seg.addEventListener("click", e => {
    const btn = e.target.closest("button"); if (!btn) return;
    binState[seg.dataset.seg] = seg.dataset.seg === "poles" ? Number(btn.dataset.val) : btn.dataset.val;
    renderBins();
  }));
  $("#slots").addEventListener("click", onSlotsClick);

  $("#startBtn").addEventListener("click", () => {
    newJob($("#difficulty").value);
    $("#result").classList.add("hidden");
    renderRequirements();
    renderPanelTab();
    renderRecordsTab();
  });
  $("#resetBtn").addEventListener("click", () => { if (job) { job.units = []; job.startTs = Date.now(); $("#result").classList.add("hidden"); renderPanel(); } });
  $("#inspectBtn").addEventListener("click", runInspection);

  $("#copyMd").addEventListener("click", () => { if (job) navigator.clipboard?.writeText(jobMarkdown()); });
  $("#downloadMd").addEventListener("click", () => { if (job) download("panel_work_order.md", jobMarkdown(), "text/markdown"); });

  renderPanelTab();
  renderRecordsTab();
});
