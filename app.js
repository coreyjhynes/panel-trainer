/* Service Panel Install Trainer - panel workbench (scenario-agnostic).
   The UI is only the panel + hardware. It publishes the live panel to the API
   (POST /api/state) and polls it, so a CompleteScenario call (which sets the
   panel to a scenario's 100% solution server-side) refreshes the UI. All
   requirements and scoring live outside this page (scenarios + the API). */

const PANEL_MODEL = "HOM4080M200PC";
const SLOT_COUNT = 40;
const API_BASE = "";
const POLL_MS = 2000;

const WIRE_OPTIONS = [14, 12, 10, 8, 6];
const AMP_OPTIONS = [15, 20, 30, 40, 50];
const TYPE_LABELS = { standard: "Standard", gfci: "GFCI", afci: "AFCI", dual: "Dual GFCI/AFCI" };
const TYPE_COLOR = { standard: "var(--t-standard)", gfci: "var(--t-gfci)", afci: "var(--t-afci)", dual: "var(--t-dual)" };
const WIRE_COLOR = { 14: "#e8e8e8", 12: "#f4c542", 10: "#e8863c", 8: "#4a4a4a", 6: "#3a6fb0" };
const WIRE_TEXT = { 14: "#111", 12: "#111", 10: "#111", 8: "#fff", 6: "#fff" };

const $ = (sel) => document.querySelector(sel);
const clientId = "app_" + Math.random().toString(36).slice(2, 10);
// Session isolates concurrent labs. Skillable opens the panel as ?session=<id>;
// without one, we share the "default" panel (single-instance / authoring test).
const sessionId = new URLSearchParams(location.search).get("session") || "default";

/* ---- Panel state ------------------------------------------------------- */
let panel = { units: [], nextId: 1 };
let localRev = 0;
const binState = { poles: 1, type: "standard" };

function unitSlots(u) { return u.poles === 2 ? [u.slot, u.slot + 2] : [u.slot]; }
function occupancy() { const m = {}; panel.units.forEach(u => unitSlots(u).forEach(s => { m[s] = u; })); return m; }
function slotFree(slot, poles) {
  const occ = occupancy();
  const need = poles === 2 ? [slot, slot + 2] : [slot];
  return need.every(n => n >= 1 && n <= SLOT_COUNT && !occ[n]);
}
function unitById(id) { return panel.units.find(u => u.id === id); }

/* ---- Drag & drop ------------------------------------------------------- */
function setDrag(e, payload) {
  e.dataTransfer.setData("application/json", JSON.stringify(payload));
  e.dataTransfer.setData("app/" + payload.kind, "1");
  e.dataTransfer.effectAllowed = "copyMove";
}
function dragHasKind(e, kind) { return Array.from(e.dataTransfer.types).includes("app/" + kind); }
function readPayload(e) { try { return JSON.parse(e.dataTransfer.getData("application/json")); } catch { return null; } }

/* ---- Server sync ------------------------------------------------------- */
function syncState() {
  fetch(`${API_BASE}/api/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ units: panel.units, clientId, sessionId }) })
    .then(r => r.ok ? r.json() : null).then(j => { if (j && j.rev) localRev = j.rev; }).catch(() => {});
}
/* Local change: re-render then publish. */
function changed() { renderPanel(); syncState(); }

/* Poll for external changes (e.g. CompleteScenario) and refresh the panel. */
async function pollState() {
  try {
    const r = await fetch(`${API_BASE}/api/state?session=${encodeURIComponent(sessionId)}`);
    if (!r.ok) return;
    const s = await r.json();
    if (s && s.rev > localRev && s.setBy !== clientId) {
      panel.units = (s.units || []).map(u => ({ ...u }));
      panel.nextId = panel.units.reduce((m, u) => Math.max(m, u.id || 0), 0) + 1;
      localRev = s.rev;
      renderPanel();          // reflect the server-set panel (no re-publish)
    }
  } catch (_) { /* ignore */ }
}

/* ---- Rendering --------------------------------------------------------- */
function renderBins() {
  document.querySelectorAll(".seg").forEach(seg => {
    const key = seg.dataset.seg;
    seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.val === String(binState[key])));
  });
  const bt = $("#breakerTiles"); bt.innerHTML = "";
  AMP_OPTIONS.forEach(a => {
    const t = document.createElement("div");
    t.className = "tile brk-tile"; t.draggable = true; t.style.background = TYPE_COLOR[binState.type];
    t.innerHTML = `${a}A<span class="tmeta">${binState.poles}P · ${TYPE_LABELS[binState.type]}</span>`;
    t.addEventListener("dragstart", e => setDrag(e, { kind: "breaker", amps: a, poles: binState.poles, type: binState.type }));
    bt.appendChild(t);
  });
  const wt = $("#wireTiles"); wt.innerHTML = "";
  WIRE_OPTIONS.forEach(g => {
    const t = document.createElement("div");
    t.className = "wtile"; t.draggable = true; t.style.background = WIRE_COLOR[g]; t.style.color = WIRE_TEXT[g];
    t.textContent = `${g} AWG`;
    t.addEventListener("dragstart", e => setDrag(e, { kind: "wire", gauge: g }));
    wt.appendChild(t);
  });
}

function renderPanel() {
  const occ = occupancy();
  const slotsEl = $("#slots"); slotsEl.innerHTML = "";
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
          panel.units.push({ id: panel.nextId++, slot: s, poles: p.poles, amps: p.amps, type: p.type, terminals });
          changed();
        }
      });
    } else if (u.slot === s) {
      div.className = "pslot placed";
      const termHtml = Object.keys(u.terminals).map(k => {
        const g = u.terminals[k], wired = g != null;
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
      const unit = unitById(Number(id)); if (unit) { unit.terminals[key] = p.gauge; changed(); }
    });
  });
}

function onSlotsClick(e) {
  const rm = e.target.closest("[data-remove]");
  if (rm) { panel.units = panel.units.filter(u => u.id !== Number(rm.dataset.remove)); changed(); return; }
  const ct = e.target.closest("[data-clearterm]");
  if (ct) { const [id, key] = ct.dataset.clearterm.split(":"); const u = unitById(Number(id)); if (u) { u.terminals[key] = null; changed(); } }
}

/* ---- Init -------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  $("#panelRating").textContent = `${PANEL_MODEL} · 200A · ${SLOT_COUNT} spaces`;
  document.querySelectorAll(".seg").forEach(seg => seg.addEventListener("click", e => {
    const btn = e.target.closest("button"); if (!btn) return;
    binState[seg.dataset.seg] = seg.dataset.seg === "poles" ? Number(btn.dataset.val) : btn.dataset.val;
    renderBins();
  }));
  $("#slots").addEventListener("click", onSlotsClick);
  $("#clearBtn").addEventListener("click", () => { panel.units = []; panel.nextId = 1; changed(); });

  renderBins();
  renderPanel();
  // Load any state already on the server (e.g. a pre-completed scenario), then poll.
  pollState();
  setInterval(pollState, POLL_MS);
});
