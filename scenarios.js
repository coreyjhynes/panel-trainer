/* Scenario authoring: create/edit scenarios, generate lab-instruction Markdown,
   and test each against the live panel (Complete / Inspect). */

const API_BASE = "";
const $ = (s) => document.querySelector(s);
const PROT_LABELS = { standard: "Standard", gfci: "GFCI", afci: "AFCI", dual: "AFCI+GFCI (dual-function)" };

let catalog = [];
let current = null;   // { id?, title, description, circuits: [] }
let savedMarkdown = "";

const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const breakerLabel = (c) => c.hvac ? `≤ ${c.mocp}A` : `${c.amps}A`;

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}/api/${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/* ---- List -------------------------------------------------------------- */
async function renderList() {
  const list = await api("GET", "scenarios");
  const el = $("#scnList");
  if (!list.length) { el.innerHTML = `<div class="empty-note">No scenarios yet.</div>`; return; }
  el.innerHTML = list.map(s => `
    <div class="scn-item" data-id="${escapeHtml(s.id)}">
      <div class="scn-item-title">${escapeHtml(s.title || s.id)}</div>
      <div class="scn-item-meta mono">${escapeHtml(s.id)} · ${s.circuits} circuit(s)</div>
    </div>`).join("");
  el.querySelectorAll(".scn-item").forEach(i => i.addEventListener("click", () => editScenario(i.dataset.id)));
}

/* ---- Editor ------------------------------------------------------------ */
function showEditor() { $("#editorEmpty").classList.add("hidden"); $("#editor").classList.remove("hidden"); }

function newScenario() {
  current = { title: "", description: "", circuits: [] };
  $("#editorTitle").textContent = "New scenario";
  $("#scnId").textContent = "(id assigned on save)";
  $("#fTitle").value = ""; $("#fDesc").value = "";
  $("#deleteBtn").classList.add("hidden");
  $("#savedBox").classList.add("hidden");
  renderCircuits(); showEditor();
}

async function editScenario(id) {
  const s = await api("GET", "scenarios/" + encodeURIComponent(id));
  current = { id: s.id, title: s.title, description: s.description, circuits: s.circuits || [] };
  $("#editorTitle").textContent = "Edit scenario";
  $("#scnId").textContent = "ID: " + s.id;
  $("#fTitle").value = s.title || ""; $("#fDesc").value = s.description || "";
  $("#deleteBtn").classList.remove("hidden");
  savedMarkdown = s.markdown || "";
  $("#mdOut").textContent = savedMarkdown;
  $("#savedBox").classList.remove("hidden");
  $("#tryOut").textContent = "";
  renderCircuits(); showEditor();
}

function renderCatalog() {
  $("#catalogSel").innerHTML = catalog.map((c, i) =>
    `<option value="${i}">${escapeHtml(c.name)} — ${c.v}V, ${breakerLabel(c)}, ${PROT_LABELS[c.protection]}</option>`).join("");
}

function addCircuit() {
  const i = Number($("#catalogSel").value);
  const c = catalog[i]; if (!c) return;
  current.circuits.push({ ...c, uid: c.key + "_" + Date.now().toString(36) });
  renderCircuits();
}

function renderCircuits() {
  const tb = $("#circuitsTable tbody");
  if (!current.circuits.length) { tb.innerHTML = `<tr class="empty-row"><td colspan="7">No circuits yet — add from the catalog above.</td></tr>`; return; }
  tb.innerHTML = current.circuits.map((c, i) => `
    <tr>
      <td>${escapeHtml(c.name)}</td><td class="mono">${c.v}V</td>
      <td class="mono">${breakerLabel(c)}</td><td class="mono">${c.v === 240 ? "2-pole" : "1-pole"}</td>
      <td class="mono">${c.wire} AWG</td><td>${PROT_LABELS[c.protection]}</td>
      <td><button class="link-btn" data-del="${i}">remove</button></td>
    </tr>`).join("");
  tb.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { current.circuits.splice(Number(b.dataset.del), 1); renderCircuits(); }));
}

async function save() {
  current.title = $("#fTitle").value.trim();
  current.description = $("#fDesc").value.trim();
  if (!current.title) { alert("Give the scenario a title."); return; }
  if (!current.circuits.length) { alert("Add at least one circuit."); return; }
  const saved = await api("POST", "scenarios", { id: current.id, title: current.title, description: current.description, circuits: current.circuits });
  current.id = saved.id;
  savedMarkdown = saved.markdown || "";
  $("#scnId").textContent = "ID: " + saved.id;
  $("#editorTitle").textContent = "Edit scenario";
  $("#deleteBtn").classList.remove("hidden");
  $("#mdOut").textContent = savedMarkdown;
  $("#savedBox").classList.remove("hidden");
  $("#tryOut").textContent = "Saved.";
  await renderList();
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

/* ---- Try on the live panel -------------------------------------------- */
async function completeToPanel() {
  if (!current.id) { alert("Save the scenario first."); return; }
  await api("POST", "complete", { scenarioId: current.id });
  $("#tryOut").innerHTML = `Sent the 100% solution to the live panel — open the <a href="index.html">Panel</a> and it will refresh to the completed build.`;
}
async function inspectPanel() {
  if (!current.id) { alert("Save the scenario first."); return; }
  const r = await api("POST", "inspect", { scenarioId: current.id });
  const lines = (r.details || []).flatMap(d => d.issues.map(i => `${i.level.toUpperCase()} — ${d.name}: ${i.text}`));
  $("#tryOut").innerHTML = `<b>${r.pass ? "PASS" : "FAIL"} · ${r.score}%</b> (${r.faults} fault, ${r.critical} critical)<br>` +
    lines.map(escapeHtml).join("<br>");
}

/* ---- Init -------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  $("#newBtn").addEventListener("click", newScenario);
  $("#addCircuitBtn").addEventListener("click", addCircuit);
  $("#saveBtn").addEventListener("click", () => save().catch(e => alert("Save failed: " + e.message)));
  $("#deleteBtn").addEventListener("click", async () => {
    if (!current.id || !confirm("Delete this scenario?")) return;
    await api("DELETE", "scenarios/" + encodeURIComponent(current.id));
    $("#editor").classList.add("hidden"); $("#editorEmpty").classList.remove("hidden");
    await renderList();
  });
  $("#copyMd").addEventListener("click", () => navigator.clipboard?.writeText(savedMarkdown));
  $("#downloadMd").addEventListener("click", () => download(`${current.id || "scenario"}.md`, savedMarkdown, "text/markdown"));
  $("#completeBtn").addEventListener("click", () => completeToPanel().catch(e => alert(e.message)));
  $("#inspectBtn").addEventListener("click", () => inspectPanel().catch(e => alert(e.message)));

  try { catalog = await api("GET", "catalog"); renderCatalog(); } catch (_) {}
  await renderList();
});
