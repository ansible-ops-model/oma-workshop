(function () {
  "use strict";

  const STORAGE_KEY = "oma_reliance_map";
  const SCOPE_LABELS = { in: "In Scope", stretch: "Stretch", out: "Out of Scope" };
  const CONN_TYPES = {
    hard:     { label: "Hard dep",     full: "Hard dependency — must finish A before B", cls: "hard" },
    soft:     { label: "Soft dep",     full: "Soft dependency — A must start before B",  cls: "soft" },
    parallel: { label: "Parallel",     full: "No dependency — can run in parallel",      cls: "parallel" },
  };
  const GRID = 20;
  const SNAP_THRESHOLD = 6;
  const HISTORY_LIMIT = 60;

  let STATE = { items: [], connections: [], view: { x: 0, y: 0, scale: 1 }, nextId: 1, teamList: [], phaseList: [] };
  let activeStorageKey = STORAGE_KEY;
  let activeMapName = null;
  let selectedIds = new Set();
  let dragState = null;
  let panState = null;
  let wireState = null;
  let spaceHeld = false;
  let marqueeState = null;

  // ── Undo / Redo ──
  let undoStack = [];
  let redoStack = [];

  function pushUndo() {
    undoStack.push(JSON.stringify(STATE));
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(STATE));
    STATE = JSON.parse(undoStack.pop());
    saveState();
    renderApp();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(STATE));
    STATE = JSON.parse(redoStack.pop());
    saveState();
    renderApp();
  }

  const $ = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

  /* ── Init ── */
  function init() {
    const params = new URLSearchParams(window.location.search);
    activeMapName = params.get("map");
    activeStorageKey = activeMapName ? STORAGE_KEY + "_" + activeMapName : STORAGE_KEY;
    loadState();
    renderTopbar();
    renderApp();
    attachGlobalListeners();
  }

  function renderTopbar() {
    // Topbar hidden — header is in sidebar now
  }

  function renderApp() {
    const app = $("#app");
    app.innerHTML = "";
    app.style.cssText = "flex:1;display:flex;flex-direction:row;overflow:hidden;";
    app.appendChild(buildSidebar());
    const canvasArea = el("div", "rm-canvas-area");
    canvasArea.appendChild(buildLegend());
    const wrap = el("div", "rm-canvas-wrap");
    wrap.id = "canvas-wrap";
    const canvas = el("div", "rm-canvas");
    canvas.id = "canvas";

    // Alignment guides layer
    const guides = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    guides.classList.add("rm-guides");
    guides.id = "guides-svg";
    canvas.appendChild(guides);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("rm-lines");
    svg.id = "lines-svg";
    svg.innerHTML = `<defs>
      <marker id="ah-hard" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="var(--line-hard)"/></marker>
      <marker id="ah-soft" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="var(--line-soft)"/></marker>
      <marker id="ah-parallel" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="var(--line-parallel)"/></marker>
    </defs>`;
    canvas.appendChild(svg);
    wrap.appendChild(canvas);
    canvasArea.appendChild(wrap);

    const zoomInd = el("div", "zoom-indicator");
    zoomInd.id = "zoom-ind";
    wrap.appendChild(zoomInd);

    // Minimap
    const mm = el("div", "minimap");
    mm.id = "minimap";
    mm.innerHTML = `<canvas id="minimap-canvas" width="180" height="120"></canvas><div class="minimap-viewport" id="minimap-vp"></div>`;
    wrap.appendChild(mm);

    // Marquee selection rectangle
    const mq = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    mq.classList.add("rm-marquee-layer");
    mq.id = "marquee-svg";
    mq.innerHTML = `<rect id="marquee-rect" class="marquee-rect" x="0" y="0" width="0" height="0" style="display:none"/>`;
    wrap.appendChild(mq);

    const drop = el("div", "drop-overlay");
    drop.id = "drop-overlay";
    drop.innerHTML = "<span>Drop JSON, CSV, or Markdown file to import</span>";
    canvasArea.appendChild(drop);

    const lineMenu = el("div", "line-menu hidden");
    lineMenu.id = "line-menu";
    canvasArea.appendChild(lineMenu);

    app.appendChild(canvasArea);

    renderAllItems();
    renderConnections();
    applyTransform();
    updateZoomIndicator();
    updateMinimap();

    if (!STATE.items.length) renderEmptyState();
    refreshManageChips();
  }

  /* ── Empty state ── */
  function renderEmptyState() {
    const canvas = $("#canvas");
    const empty = el("div", "empty-state");
    empty.id = "empty-state";
    empty.innerHTML = `
      <div class="empty-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--ink-light)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
          <path d="M14 17h7M17.5 14v7"/><line x1="10" y1="6.5" x2="14" y2="6.5" stroke-dasharray="2 2"/>
          <line x1="6.5" y1="10" x2="6.5" y2="14" stroke-dasharray="2 2"/>
        </svg>
      </div>
      <h2>Start your Reliance Map</h2>
      <p>Add items, classify their scope, and draw dependency lines between them.</p>
      <div class="empty-actions">
        <button class="tb-btn primary" onclick="window._rm.openModal()">+ Add first item</button>
        <button class="tb-btn" onclick="window._rm.loadSample()">Load sample map</button>
        <button class="tb-btn" onclick="document.getElementById('import-input').click()">Import from OMA</button>
      </div>
      <div class="empty-hints">
        <span>Drag edges to connect</span>
        <span>Scroll / trackpad to pan</span>
        <span>Pinch or Ctrl+scroll to zoom</span>
        <span>Ctrl+Z / Ctrl+Y to undo/redo</span>
      </div>`;
    canvas.appendChild(empty);
  }

  function removeEmptyState() {
    const es = $("#empty-state");
    if (es) es.remove();
  }

  function loadSample() {
    pushUndo();
    STATE = {
      teamList: ["Platform", "DevOps"],
      phaseList: ["Phase 1", "Phase 2", "Phase 3"],
      items: [
        { id: 1, label: "Platform team onboarded", scope: "in", description: "Core team trained on AAP", needsSubMap: false, subMapName: "", team: "Platform", phase: "Phase 1", notes: "Training scheduled for Q1", x: 100, y: 100 },
        { id: 2, label: "CI/CD pipeline", scope: "in", description: "Automated deployment pipeline", needsSubMap: true, subMapName: "ci-cd-pipeline", team: "DevOps", phase: "Phase 1", notes: "", x: 400, y: 100 },
        { id: 3, label: "Monitoring & alerting", scope: "stretch", description: "Grafana dashboards + PagerDuty", needsSubMap: false, subMapName: "", team: "DevOps", phase: "Phase 2", notes: "Depends on CI/CD completion", x: 400, y: 280 },
        { id: 4, label: "Self-service portal", scope: "stretch", description: "Developer portal for job launching", needsSubMap: false, subMapName: "", team: "", phase: "Phase 2", notes: "", x: 100, y: 280 },
        { id: 5, label: "Multi-cloud expansion", scope: "out", description: "Azure + GCP automation targets", needsSubMap: false, subMapName: "", team: "", phase: "Phase 3", notes: "Future consideration", x: 250, y: 440 },
      ],
      connections: [
        { id: 6, fromId: 1, toId: 2, type: "hard", note: "Team must be trained first" },
        { id: 7, fromId: 2, toId: 3, type: "soft", note: "" },
        { id: 8, fromId: 1, toId: 4, type: "hard", note: "" },
        { id: 9, fromId: 3, toId: 5, type: "parallel", note: "" },
      ],
      view: { x: 50, y: 30, scale: 1 },
      nextId: 10,
    };
    saveState();
    renderApp();
  }

  /* ── Sidebar ── */
  function buildSidebar() {
    const sb = el("div", "rm-sidebar");
    sb.id = "sidebar";
    const backHref = activeMapName ? "./" : "../";
    const backLabel = activeMapName ? "← Main map" : "← OMA Workshop";
    const title = activeMapName
      ? `Reliance Map <span style="color:var(--accent);font-size:.75rem">${esc(activeMapName)}</span>`
      : "Reliance Map";
    sb.innerHTML = `
      <div class="sb-header">
        <a href="${backHref}">${backLabel}</a>
        <div class="sb-title">${title}</div>
      </div>
      <div class="sb-section">
        <button class="tb-btn primary" onclick="window._rm.openModal()">+ Add Item</button>
      </div>
      <div class="sb-section" id="sb-selected" style="display:none">
        <div class="sb-label">Selected</div>
        <div class="sb-sel-name" id="sb-sel-name"></div>
        <div class="sb-row" id="sb-sel-actions"></div>
        <div style="margin-top:.5rem">
          <div class="sb-label">Scope</div>
          <div class="sb-scope-radios" id="sb-scope-radios"></div>
        </div>
        <div style="margin-top:.5rem">
          <div class="sb-label">Teams</div>
          <div id="sb-team-select" style="max-height:100px;overflow-y:auto"></div>
          <div class="sb-add-team-row">
            <input type="text" id="sb-new-team" placeholder="New team name…">
            <button class="tb-btn" onclick="window._rm.sidebarAddTeam()">+</button>
          </div>
        </div>
        <div style="margin-top:.5rem">
          <div class="sb-label">Phase</div>
          <select class="sb-select" id="sb-phase-select" onchange="window._rm.sidebarSetPhase(this.value)">
            <option value="">No phase</option>
          </select>
          <div class="sb-add-team-row">
            <input type="text" id="sb-new-phase" placeholder="New phase name…">
            <button class="tb-btn" onclick="window._rm.sidebarAddPhase()">+</button>
          </div>
        </div>
        <div style="margin-top:.5rem">
          <div class="sb-label">Notes</div>
          <textarea class="sb-select" id="sb-notes" rows="3" placeholder="Add notes…" onchange="window._rm.sidebarSetNotes(this.value)" style="resize:vertical;min-height:50px;font-size:.78rem;line-height:1.4"></textarea>
        </div>
        <div style="margin-top:.5rem">
          <label class="sb-checkbox" id="sb-initiative-label">
            <input type="checkbox" id="sb-initiative" onchange="window._rm.sidebarToggleInitiative(this.checked)">
            Needs own initiative
          </label>
        </div>
      </div>
      <div class="sb-section">
        <div class="sb-label">Teams</div>
        <div id="sb-team-chips" class="sb-row" style="gap:.25rem;margin-bottom:.3rem"></div>
        <div class="sb-add-team-row">
          <input type="text" id="sb-manage-new-team" placeholder="Add team…">
          <button class="tb-btn" onclick="window._rm.manageAddTeam()">+</button>
        </div>
      </div>
      <div class="sb-section">
        <div class="sb-label">Phases</div>
        <div id="sb-phase-chips" class="sb-row" style="gap:.25rem;margin-bottom:.3rem"></div>
        <div class="sb-add-team-row">
          <input type="text" id="sb-manage-new-phase" placeholder="Add phase…">
          <button class="tb-btn" onclick="window._rm.manageAddPhase()">+</button>
        </div>
      </div>
      <div class="sb-section">
        <div class="sb-label">History</div>
        <div class="sb-row">
          <button class="tb-btn" onclick="window._rm.undo()" title="Undo (Ctrl+Z)">↩ Undo</button>
          <button class="tb-btn" onclick="window._rm.redo()" title="Redo (Ctrl+Y)">↪ Redo</button>
        </div>
      </div>
      <div class="sb-section">
        <div class="sb-label">Export</div>
        <div class="sb-row">
          <button class="tb-btn" onclick="window._rm.exportJSON()" title="Export as JSON">JSON</button>
          <button class="tb-btn" onclick="window._rm.exportPNG()" title="Export as PNG">PNG</button>
          <button class="tb-btn" onclick="window._rm.exportDrawio()" title="Export as draw.io diagram">draw.io</button>
          <button class="tb-btn" onclick="window._rm.exportMiroCSV()" title="Export as Miro-ready CSV">Miro CSV</button>
        </div>
      </div>
      <div class="sb-section">
        <div class="sb-label">Import</div>
        <div class="sb-row">
          <button class="tb-btn" onclick="document.getElementById('import-input').click()" title="Import JSON or OMA snapshot">JSON / OMA</button>
          <button class="tb-btn" onclick="document.getElementById('import-csv-input').click()" title="Import from CSV">CSV</button>
          <button class="tb-btn" onclick="document.getElementById('import-md-input').click()" title="Import from Markdown">Markdown</button>
          <input type="file" id="import-input" accept=".json" style="display:none" onchange="window._rm.importJSON(event)">
          <input type="file" id="import-csv-input" accept=".csv,.tsv" style="display:none" onchange="window._rm.importCSV(event)">
          <input type="file" id="import-md-input" accept=".md,.txt,.markdown" style="display:none" onchange="window._rm.importMarkdown(event)">
        </div>
        <button class="tb-btn full" onclick="window._rm.importFromText()" title="Paste CSV or Markdown text directly" style="margin-top:.3rem">Paste text…</button>
        <div style="margin-top:.35rem;display:flex;gap:.25rem">
          <button class="tb-btn" onclick="window._rm.downloadCSVTemplate()" title="Download a CSV template" style="flex:1;font-size:.68rem;justify-content:center">↓ CSV template</button>
          <button class="tb-btn" onclick="window._rm.downloadMDTemplate()" title="Download a Markdown template" style="flex:1;font-size:.68rem;justify-content:center">↓ MD template</button>
        </div>
      </div>
      <div class="sb-section">
        <button class="tb-btn danger full" onclick="window._rm.clearAll()">Clear All</button>
      </div>
      <div class="sb-section" style="margin-top:auto;border-top:1px solid var(--border)">
        <a href="guide.html" class="tb-btn full" style="text-decoration:none;justify-content:center" title="What is a Reliance Map?">? Guide</a>
      </div>`;
    return sb;
  }

  function updateSidebar() {
    const sec = $("#sb-selected");
    if (!sec) return;
    if (!selectedIds.size) { sec.style.display = "none"; return; }
    sec.style.display = "block";
    const ids = [...selectedIds];
    const items = ids.map(id => STATE.items.find(i => i.id === id)).filter(Boolean);
    if (!items.length) { sec.style.display = "none"; return; }
    const single = items.length === 1;
    const item = items[0];

    // Name
    const nameEl = $("#sb-sel-name");
    nameEl.textContent = single ? item.label : `${items.length} items selected`;

    // Action buttons
    const actEl = $("#sb-sel-actions");
    if (single) {
      actEl.innerHTML = `
        <button class="tb-btn" onclick="window._rm.openModal(${item.id})" title="Edit">✎ Edit</button>
        <button class="tb-btn" onclick="window._rm.duplicateItem(${item.id})" title="Duplicate">⧉ Dup</button>
        <button class="tb-btn danger" onclick="window._rm.removeItem(${item.id})" title="Delete">✕ Del</button>`;
    } else {
      actEl.innerHTML = `
        <button class="tb-btn danger" onclick="window._rm.removeSelected()" title="Delete selected">✕ Delete ${items.length}</button>`;
    }

    // Scope radios
    const scopeEl = $("#sb-scope-radios");
    const curScope = single ? item.scope : "";
    scopeEl.innerHTML = ["in", "stretch", "out"].map(s => {
      const labels = { in: "In Scope", stretch: "Stretch", out: "Out" };
      return `<label class="sb-scope-radio ${s}">
        <input type="radio" name="sb-scope" value="${s}" ${curScope === s ? "checked" : ""} onchange="window._rm.sidebarSetScope('${s}')">
        <span>${labels[s]}</span>
      </label>`;
    }).join("");

    // Team select
    const teamSel = $("#sb-team-select");
    const curTeams = single ? (item.team || []) : [];
    teamSel.innerHTML = (STATE.teamList || []).map(t =>
      `<label style="display:flex;align-items:center;gap:5px;padding:2px 0;font-size:.78rem;cursor:pointer"><input type="checkbox" class="sb-team-cb" value="${esc(t)}" ${curTeams.includes(t)?'checked':''} onchange="window._rm.sidebarSetTeam()" style="accent-color:var(--accent);width:14px;height:14px"> ${esc(t)}</label>`
    ).join("") || '<span style="font-size:.72rem;color:var(--ink-light)">No teams yet</span>';

    // Phase select
    const phaseSel = $("#sb-phase-select");
    const curPhase = single ? (item.phase || "") : "";
    phaseSel.innerHTML = `<option value="">No phase</option>` +
      (STATE.phaseList || []).map(p => `<option value="${esc(p)}" ${p === curPhase ? "selected" : ""}>${esc(p)}</option>`).join("");

    // Notes
    const notesEl = $("#sb-notes");
    notesEl.value = single ? (item.notes || "") : "";

    // Initiative checkbox
    const initCb = $("#sb-initiative");
    initCb.checked = single ? !!item.needsSubMap : false;
  }

  function sidebarSetScope(scope) {
    for (const id of selectedIds) {
      updateItem(id, { scope });
    }
    updateSidebar();
  }

  function sidebarSetTeam() {
    const checked = [...document.querySelectorAll('.sb-team-cb:checked')].map(cb => cb.value);
    for (const id of selectedIds) {
      updateItem(id, { team: checked });
    }
  }

  function sidebarAddTeam() {
    const input = $("#sb-new-team");
    const name = input.value.trim();
    if (!name) return;
    if (!STATE.teamList) STATE.teamList = [];
    if (!STATE.teamList.includes(name)) {
      STATE.teamList.push(name);
      STATE.teamList.sort((a, b) => a.localeCompare(b));
      saveState();
    }
    input.value = "";
    for (const id of selectedIds) {
      const it = STATE.items.find(i => i.id === id);
      if (it) {
        if (!Array.isArray(it.team)) it.team = [];
        if (!it.team.includes(name)) it.team.push(name);
      }
    }
    saveState(); renderAllItems(); renderConnections(); updateSidebar();
  }

  function sidebarSetPhase(phase) {
    for (const id of selectedIds) {
      updateItem(id, { phase });
    }
    updateSidebar();
  }

  function sidebarAddPhase() {
    const input = $("#sb-new-phase");
    const name = input.value.trim();
    if (!name) return;
    if (!STATE.phaseList) STATE.phaseList = [];
    if (!STATE.phaseList.includes(name)) {
      STATE.phaseList.push(name);
      saveState();
    }
    input.value = "";
    sidebarSetPhase(name);
  }

  function sidebarSetNotes(notes) {
    for (const id of selectedIds) {
      updateItem(id, { notes });
    }
  }

  function refreshManageChips() {
    const tc = $("#sb-team-chips");
    if (tc) tc.innerHTML = (STATE.teamList || []).map(t =>
      `<span class="sb-chip team">${esc(t)} <button onclick="window._rm.manageRemoveTeam('${esc(t)}')">&times;</button></span>`
    ).join("") || '<span style="font-size:.7rem;color:var(--ink-light)">No teams yet</span>';
    const pc = $("#sb-phase-chips");
    if (pc) pc.innerHTML = (STATE.phaseList || []).map(p =>
      `<span class="sb-chip phase">${esc(p)} <button onclick="window._rm.manageRemovePhase('${esc(p)}')">&times;</button></span>`
    ).join("") || '<span style="font-size:.7rem;color:var(--ink-light)">No phases yet</span>';
  }

  function manageAddTeam() {
    const input = $("#sb-manage-new-team");
    const name = input.value.trim();
    if (!name) return;
    if (!STATE.teamList) STATE.teamList = [];
    if (!STATE.teamList.includes(name)) {
      STATE.teamList.push(name);
      saveState();
    }
    input.value = "";
    refreshManageChips();
    updateSidebar();
  }

  function manageRemoveTeam(name) {
    if (!STATE.teamList) return;
    STATE.teamList = STATE.teamList.filter(t => t !== name);
    STATE.items.forEach(i => { if (Array.isArray(i.team)) i.team = i.team.filter(t => t !== name); });
    saveState(); renderAllItems(); renderConnections();
    refreshManageChips();
    updateSidebar();
  }

  function manageAddPhase() {
    const input = $("#sb-manage-new-phase");
    const name = input.value.trim();
    if (!name) return;
    if (!STATE.phaseList) STATE.phaseList = [];
    if (!STATE.phaseList.includes(name)) {
      STATE.phaseList.push(name);
      saveState();
    }
    input.value = "";
    refreshManageChips();
    updateSidebar();
  }

  function manageRemovePhase(name) {
    if (!STATE.phaseList) return;
    STATE.phaseList = STATE.phaseList.filter(p => p !== name);
    saveState();
    refreshManageChips();
    updateSidebar();
  }

  function sidebarToggleInitiative(checked) {
    for (const id of selectedIds) {
      updateItem(id, { needsSubMap: checked });
    }
    updateSidebar();
  }

  /* ── Legend ── */
  function buildLegend() {
    const lg = el("div", "rm-legend");
    lg.innerHTML = `
      <span class="lg-item"><span class="lg-swatch in"></span> In Scope</span>
      <span class="lg-item"><span class="lg-swatch stretch"></span> Stretch</span>
      <span class="lg-item"><span class="lg-swatch out"></span> Out of Scope</span>
      <span class="lg-sep"></span>
      <span class="lg-item"><span class="lg-line hard"></span> Hard dependency</span>
      <span class="lg-item"><span class="lg-line soft"></span> Soft dependency</span>
      <span class="lg-item"><span class="lg-line parallel"></span> Parallel work</span>
      <span class="lg-sep"></span>
      <span class="lg-item" style="font-style:italic;border:2px dashed var(--border);padding:1px 6px;border-radius:4px">⑂ Needs own initiative</span>`;
    return lg;
  }

  /* ── Item CRUD ── */
  function addItem(label, scope, description, needsSubMap, subMapName, team, phase, notes) {
    pushUndo();
    removeEmptyState();
    const wrap = $("#canvas-wrap");
    const cx = (-STATE.view.x + wrap.clientWidth / 2) / STATE.view.scale;
    const cy = (-STATE.view.y + wrap.clientHeight / 2) / STATE.view.scale;
    const item = {
      id: STATE.nextId++, label, scope,
      description: description || "",
      needsSubMap: !!needsSubMap,
      subMapName: subMapName || "",
      team: Array.isArray(team) ? team : (team ? [team] : []),
      phase: phase || "",
      notes: notes || "",
      x: snapToGrid(cx - 100 + (Math.random() - 0.5) * 80),
      y: snapToGrid(cy - 40 + (Math.random() - 0.5) * 80),
    };
    STATE.items.push(item);
    renderItem(item);
    renderConnections();
    saveState();
    updateMinimap();
    return item;
  }

  function updateItem(id, changes) {
    pushUndo();
    const item = STATE.items.find(i => i.id === id);
    if (!item) return;
    Object.assign(item, changes);
    const card = $(`[data-item-id="${id}"]`);
    if (card) { card.remove(); renderItem(item); }
    renderConnections();
    saveState();
    updateMinimap();
  }

  function removeItem(id) {
    pushUndo();
    STATE.items = STATE.items.filter(i => i.id !== id);
    STATE.connections = STATE.connections.filter(c => c.fromId !== id && c.toId !== id);
    const card = $(`[data-item-id="${id}"]`);
    if (card) card.remove();
    selectedIds.delete(id);
    renderConnections();
    saveState();
    updateMinimap();
    if (!STATE.items.length) renderEmptyState();
  }

  function removeSelected() {
    if (!selectedIds.size) return;
    pushUndo();
    for (const id of selectedIds) {
      STATE.items = STATE.items.filter(i => i.id !== id);
      STATE.connections = STATE.connections.filter(c => c.fromId !== id && c.toId !== id);
      const card = $(`[data-item-id="${id}"]`);
      if (card) card.remove();
    }
    selectedIds.clear();
    renderConnections();
    saveState();
    updateMinimap();
    if (!STATE.items.length) renderEmptyState();
  }

  function duplicateItem(id) {
    const src = STATE.items.find(i => i.id === id);
    if (!src) return;
    pushUndo();
    const dup = {
      id: STATE.nextId++,
      label: src.label + " (copy)",
      scope: src.scope,
      description: src.description,
      needsSubMap: src.needsSubMap,
      subMapName: src.subMapName,
      team: Array.isArray(src.team) ? [...src.team] : [],
      phase: src.phase || "",
      notes: src.notes || "",
      x: snapToGrid(src.x + 30),
      y: snapToGrid(src.y + 30),
    };
    STATE.items.push(dup);
    renderItem(dup);
    saveState();
    updateMinimap();
  }

  /* ── Render items ── */
  function renderAllItems() {
    STATE.items.forEach(renderItem);
  }

  function renderItem(item) {
    const card = el("div", `rm-item scope-${item.scope}${item.needsSubMap ? " needs-submap" : ""}`);
    card.dataset.itemId = item.id;
    card.style.left = item.x + "px";
    card.style.top = item.y + "px";

    card.innerHTML = `
      <div class="item-header">
        <span class="item-label">${esc(item.label)}</span>
        <span class="item-scope-pill ${item.scope}">${SCOPE_LABELS[item.scope]}</span>
      </div>
      ${item.description ? `<div class="item-desc">${esc(item.description)}</div>` : ""}
      ${item.notes ? `<div class="item-notes">${esc(item.notes)}</div>` : ""}
      <div class="item-footer">
        ${item.phase ? `<span class="item-phase-badge">${esc(item.phase)}</span>` : ""}
        ${item.team && item.team.length ? `<span class="item-team-badge">${esc(item.team.join(', '))}</span>` : ""}
        ${item.needsSubMap ? (item.subMapName
          ? `<a class="item-submap-badge submap-link" href="?map=${encodeURIComponent(item.subMapName)}" onclick="event.stopPropagation();window._rm.openSubMap('${esc(item.subMapName)}');return false;">⑂ ${esc(item.subMapName)} →</a>`
          : '<span class="item-submap-badge">⑂ Needs own initiative</span>') : ""}
      </div>
      <span class="handle handle-top" data-side="top"></span>
      <span class="handle handle-right" data-side="right"></span>
      <span class="handle handle-bottom" data-side="bottom"></span>
      <span class="handle handle-left" data-side="left"></span>`;

    card.addEventListener("pointerdown", onItemPointerDown);
    card.addEventListener("dblclick", () => openModal(item.id));
    if (selectedIds.has(item.id)) card.classList.add("selected");
    $("#canvas").appendChild(card);
  }

  /* ── Snap to grid ── */
  function snapToGrid(v) {
    return Math.round(v / GRID) * GRID;
  }

  /* ── Alignment guides ── */
  function showAlignmentGuides(dragId) {
    const gSvg = $("#guides-svg");
    if (!gSvg) return;
    gSvg.innerHTML = "";
    const dragCard = $(`[data-item-id="${dragId}"]`);
    if (!dragCard) return;
    const dx = parseFloat(dragCard.style.left), dy = parseFloat(dragCard.style.top);
    const dw = dragCard.offsetWidth, dh = dragCard.offsetHeight;
    const dCx = dx + dw / 2, dCy = dy + dh / 2;

    for (const item of STATE.items) {
      if (item.id === dragId || selectedIds.has(item.id)) continue;
      const card = $(`[data-item-id="${item.id}"]`);
      if (!card) continue;
      const ox = item.x, oy = item.y;
      const ow = card.offsetWidth, oh = card.offsetHeight;
      const oCx = ox + ow / 2, oCy = oy + oh / 2;

      const checks = [
        { a: dx, b: ox, orient: "v" },           // left-left
        { a: dx + dw, b: ox + ow, orient: "v" }, // right-right
        { a: dCx, b: oCx, orient: "v" },          // center-center x
        { a: dy, b: oy, orient: "h" },            // top-top
        { a: dy + dh, b: oy + oh, orient: "h" },  // bottom-bottom
        { a: dCy, b: oCy, orient: "h" },           // center-center y
      ];

      for (const c of checks) {
        if (Math.abs(c.a - c.b) < SNAP_THRESHOLD) {
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          if (c.orient === "v") {
            line.setAttribute("x1", c.b); line.setAttribute("x2", c.b);
            line.setAttribute("y1", Math.min(dy, oy) - 20);
            line.setAttribute("y2", Math.max(dy + dh, oy + oh) + 20);
          } else {
            line.setAttribute("y1", c.b); line.setAttribute("y2", c.b);
            line.setAttribute("x1", Math.min(dx, ox) - 20);
            line.setAttribute("x2", Math.max(dx + dw, ox + ow) + 20);
          }
          line.setAttribute("stroke", "var(--accent)");
          line.setAttribute("stroke-width", "1");
          line.setAttribute("stroke-dasharray", "4 3");
          line.setAttribute("opacity", "0.6");
          gSvg.appendChild(line);
        }
      }
    }
  }

  function clearGuides() {
    const gSvg = $("#guides-svg");
    if (gSvg) gSvg.innerHTML = "";
  }

  /* ── Connection handles — drag to wire ── */
  function isHandle(el) {
    return el && el.classList && el.classList.contains("handle");
  }

  function onItemPointerDown(e) {
    if (e.button !== 0) return;
    const card = e.currentTarget;
    const id = +card.dataset.itemId;

    if (isHandle(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      wireState = { fromId: id, pointerId: e.pointerId };
      card.classList.add("connect-source");
      document.addEventListener("pointermove", onWireMove);
      document.addEventListener("pointerup", onWireUp);
      return;
    }

    if (spaceHeld) return;
    e.preventDefault();

    // Multi-select with shift
    if (e.shiftKey) {
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
        card.classList.remove("selected");
      } else {
        selectedIds.add(id);
        card.classList.add("selected");
      }
      updateSidebar();
      return;
    }

    if (!selectedIds.has(id)) {
      deselectAll();
      selectedIds.add(id);
      card.classList.add("selected");
    }
    updateSidebar();

    const item = STATE.items.find(i => i.id === id);
    const offsets = [];
    for (const sid of selectedIds) {
      const si = STATE.items.find(i => i.id === sid);
      if (si) offsets.push({ id: sid, dx: si.x - item.x, dy: si.y - item.y });
    }

    dragState = {
      id, startX: e.clientX, startY: e.clientY,
      origX: item.x, origY: item.y,
      offsets, moved: false, undoPushed: false,
    };
    card.setPointerCapture(e.pointerId);
    card.addEventListener("pointermove", onItemPointerMove);
    card.addEventListener("pointerup", onItemPointerUp);
  }

  function onWireMove(e) {
    if (!wireState) return;
    updateTempLine(e.clientX, e.clientY);
    const target = findSnapTarget(e.clientX, e.clientY);
    $$(".rm-item.snap-target").forEach(el => el.classList.remove("snap-target"));
    if (target && target !== wireState.fromId) {
      const card = $(`[data-item-id="${target}"]`);
      if (card) card.classList.add("snap-target");
    }
  }

  function onWireUp(e) {
    if (!wireState) return;
    document.removeEventListener("pointermove", onWireMove);
    document.removeEventListener("pointerup", onWireUp);
    $$(".connect-source").forEach(el => el.classList.remove("connect-source"));
    $$(".snap-target").forEach(el => el.classList.remove("snap-target"));
    const temp = $("#temp-line");
    if (temp) temp.remove();
    const target = findSnapTarget(e.clientX, e.clientY);
    if (target && target !== wireState.fromId) {
      addConnection(wireState.fromId, target, "hard", "");
    }
    wireState = null;
  }

  function findSnapTarget(clientX, clientY) {
    const wrap = $("#canvas-wrap");
    const rect = wrap.getBoundingClientRect();
    const canvasX = (clientX - rect.left - STATE.view.x) / STATE.view.scale;
    const canvasY = (clientY - rect.top - STATE.view.y) / STATE.view.scale;
    const SNAP = 40;
    let best = null, bestDist = Infinity;
    for (const item of STATE.items) {
      const card = $(`[data-item-id="${item.id}"]`);
      if (!card) continue;
      const cx = item.x + card.offsetWidth / 2;
      const cy = item.y + card.offsetHeight / 2;
      const dx = canvasX - cx, dy = canvasY - cy;
      const hw = card.offsetWidth / 2 + SNAP, hh = card.offsetHeight / 2 + SNAP;
      if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) { bestDist = dist; best = item.id; }
      }
    }
    return best;
  }

  /* ── Item dragging with alignment guides ── */
  function onItemPointerMove(e) {
    if (!dragState) return;
    const scale = STATE.view.scale;
    const dx = (e.clientX - dragState.startX) / scale;
    const dy = (e.clientY - dragState.startY) / scale;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      if (!dragState.undoPushed) { pushUndo(); dragState.undoPushed = true; }
      dragState.moved = true;
    }

    for (const off of dragState.offsets) {
      const si = STATE.items.find(i => i.id === off.id);
      if (!si) continue;
      si.x = snapToGrid(dragState.origX + off.dx + dx);
      si.y = snapToGrid(dragState.origY + off.dy + dy);
      const sc = $(`[data-item-id="${off.id}"]`);
      if (sc) { sc.style.left = si.x + "px"; sc.style.top = si.y + "px"; }
    }
    showAlignmentGuides(dragState.id);
    renderConnections();
  }

  function onItemPointerUp(e) {
    if (!dragState) return;
    const card = e.currentTarget;
    card.releasePointerCapture(e.pointerId);
    card.removeEventListener("pointermove", onItemPointerMove);
    card.removeEventListener("pointerup", onItemPointerUp);
    clearGuides();
    if (dragState.moved) { saveState(); updateMinimap(); }
    dragState = null;
  }

  /* ── Connections ── */
  function addConnection(fromId, toId, type, note) {
    const exists = STATE.connections.find(c =>
      (c.fromId === fromId && c.toId === toId) || (c.fromId === toId && c.toId === fromId));
    if (exists) return;
    pushUndo();
    STATE.connections.push({ id: STATE.nextId++, fromId, toId, type, note: note || "" });
    renderConnections();
    saveState();
    updateMinimap();
  }

  function removeConnection(id) {
    pushUndo();
    STATE.connections = STATE.connections.filter(c => c.id !== id);
    renderConnections();
    saveState();
  }

  function changeConnectionType(id, newType) {
    pushUndo();
    const conn = STATE.connections.find(c => c.id === id);
    if (conn) conn.type = newType;
    renderConnections();
    saveState();
  }

  function setConnectionNote(id, note) {
    pushUndo();
    const conn = STATE.connections.find(c => c.id === id);
    if (conn) conn.note = note;
    renderConnections();
    saveState();
  }

  /* ── Orthogonal line routing ── */
  function orthoPath(from, to, fromSide, toSide) {
    const OFFSET = 30;
    const pts = [from];

    if (fromSide === "right" && toSide === "left") {
      const midX = (from.x + to.x) / 2;
      pts.push({ x: midX, y: from.y }, { x: midX, y: to.y });
    } else if (fromSide === "left" && toSide === "right") {
      const midX = (from.x + to.x) / 2;
      pts.push({ x: midX, y: from.y }, { x: midX, y: to.y });
    } else if (fromSide === "bottom" && toSide === "top") {
      const midY = (from.y + to.y) / 2;
      pts.push({ x: from.x, y: midY }, { x: to.x, y: midY });
    } else if (fromSide === "top" && toSide === "bottom") {
      const midY = (from.y + to.y) / 2;
      pts.push({ x: from.x, y: midY }, { x: to.x, y: midY });
    } else if (fromSide === "right" && toSide === "top") {
      pts.push({ x: to.x, y: from.y });
    } else if (fromSide === "right" && toSide === "bottom") {
      pts.push({ x: to.x, y: from.y });
    } else if (fromSide === "left" && toSide === "top") {
      pts.push({ x: to.x, y: from.y });
    } else if (fromSide === "left" && toSide === "bottom") {
      pts.push({ x: to.x, y: from.y });
    } else if (fromSide === "bottom" && toSide === "left") {
      pts.push({ x: from.x, y: to.y });
    } else if (fromSide === "bottom" && toSide === "right") {
      pts.push({ x: from.x, y: to.y });
    } else if (fromSide === "top" && toSide === "left") {
      pts.push({ x: from.x, y: to.y });
    } else if (fromSide === "top" && toSide === "right") {
      pts.push({ x: from.x, y: to.y });
    } else {
      // same side — route around
      if (fromSide === "right" || fromSide === "left") {
        const ext = fromSide === "right" ? Math.max(from.x, to.x) + OFFSET : Math.min(from.x, to.x) - OFFSET;
        pts.push({ x: ext, y: from.y }, { x: ext, y: to.y });
      } else {
        const ext = fromSide === "bottom" ? Math.max(from.y, to.y) + OFFSET : Math.min(from.y, to.y) - OFFSET;
        pts.push({ x: from.x, y: ext }, { x: to.x, y: ext });
      }
    }
    pts.push(to);
    return pts;
  }

  function getEdgeMidpoint(id, center, target) {
    const card = $(`[data-item-id="${id}"]`);
    if (!card) return { point: center, side: "right" };
    const w = card.offsetWidth / 2, h = card.offsetHeight / 2;
    const dx = target.x - center.x, dy = target.y - center.y;
    if (dx === 0 && dy === 0) return { point: center, side: "right" };
    if (Math.abs(dx) / w > Math.abs(dy) / h) {
      const side = dx > 0 ? "right" : "left";
      return { point: { x: center.x + (dx > 0 ? w : -w), y: center.y }, side };
    }
    const side = dy > 0 ? "bottom" : "top";
    return { point: { x: center.x, y: center.y + (dy > 0 ? h : -h) }, side };
  }

  function renderConnections() {
    const svg = $("#lines-svg");
    if (!svg) return;
    const old = svg.querySelectorAll("line:not(#temp-line),polyline.conn,text.conn-label,rect.conn-label-bg");
    old.forEach(el => el.remove());

    const lineColors = { hard: "var(--line-hard)", soft: "var(--line-soft)", parallel: "var(--line-parallel)" };
    const lineDash = { hard: "", soft: "4 4", parallel: "10 5" };

    STATE.connections.forEach(conn => {
      const fromCenter = getItemCenter(conn.fromId);
      const toCenter = getItemCenter(conn.toId);
      if (!fromCenter || !toCenter) return;

      const fromEdge = getEdgeMidpoint(conn.fromId, fromCenter, toCenter);
      const toEdge = getEdgeMidpoint(conn.toId, toCenter, fromCenter);
      const pts = orthoPath(fromEdge.point, toEdge.point, fromEdge.side, toEdge.side);

      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      polyline.classList.add("conn");
      polyline.setAttribute("points", pts.map(p => `${p.x},${p.y}`).join(" "));
      polyline.setAttribute("stroke", lineColors[conn.type]);
      polyline.setAttribute("stroke-width", "2.5");
      polyline.setAttribute("fill", "none");
      if (lineDash[conn.type]) polyline.setAttribute("stroke-dasharray", lineDash[conn.type]);
      polyline.setAttribute("marker-end", `url(#ah-${conn.type})`);
      polyline.dataset.connId = conn.id;
      polyline.addEventListener("contextmenu", onLineContext);
      polyline.addEventListener("click", onLineContext);
      svg.appendChild(polyline);

      // Only show label if there's a custom note
      if (conn.note) {
        const midIdx = Math.floor(pts.length / 2);
        const lp1 = pts[midIdx - 1] || pts[0];
        const lp2 = pts[midIdx] || pts[pts.length - 1];
        const labelX = (lp1.x + lp2.x) / 2;
        const labelY = (lp1.y + lp2.y) / 2;
        const labelText = conn.note;

        const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        bg.classList.add("conn-label-bg");
        const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textEl.classList.add("conn-label");
        textEl.setAttribute("x", labelX);
        textEl.setAttribute("y", labelY + 3.5);
        textEl.setAttribute("text-anchor", "middle");
        textEl.setAttribute("font-size", "10");
        textEl.setAttribute("font-family", "'Red Hat Display', system-ui, sans-serif");
        textEl.setAttribute("font-weight", "600");
        const fillMap = { hard: "#1a1a1a", soft: "#0066cc", parallel: "#8a8d90" };
        textEl.setAttribute("fill", fillMap[conn.type]);
        textEl.textContent = labelText.length > 25 ? labelText.slice(0, 23) + "…" : labelText;
        textEl.style.pointerEvents = "none";
        svg.appendChild(textEl);

        const bbox = textEl.getBBox();
        bg.setAttribute("x", bbox.x - 4);
        bg.setAttribute("y", bbox.y - 1);
        bg.setAttribute("width", bbox.width + 8);
        bg.setAttribute("height", bbox.height + 2);
        bg.setAttribute("rx", "3");
        bg.setAttribute("fill", "var(--paper)");
        bg.setAttribute("opacity", "0.9");
        bg.style.pointerEvents = "none";
        svg.insertBefore(bg, textEl);
      }
    });
  }

  function getItemCenter(id) {
    const card = $(`[data-item-id="${id}"]`);
    if (!card) return null;
    return { x: parseFloat(card.style.left) + card.offsetWidth / 2, y: parseFloat(card.style.top) + card.offsetHeight / 2 };
  }

  /* ── Line context menu (with note editing) ── */
  function onLineContext(e) {
    e.preventDefault();
    e.stopPropagation();
    const connId = +e.currentTarget.dataset.connId;
    const conn = STATE.connections.find(c => c.id === connId);
    if (!conn) return;
    const menu = $("#line-menu");
    menu.innerHTML = Object.entries(CONN_TYPES).map(([key, t]) =>
      `<button data-type="${key}" ${conn.type === key ? 'style="font-weight:700"' : ""}>
        <span class="conn-pop-line ${t.cls}"></span> ${t.label}${conn.type === key ? " ✓" : ""}
      </button>`).join("") +
      `<div class="lm-sep"></div>
      <div class="lm-note-row">
        <input type="text" class="lm-note-input" id="lm-note" placeholder="Add a note…" value="${esc(conn.note || "")}">
      </div>
      <div class="lm-sep"></div>
      <button class="del">Remove connection</button>`;
    menu.style.left = e.clientX + "px";
    menu.style.top = e.clientY + "px";
    menu.classList.remove("hidden");
    menu.querySelectorAll("button[data-type]").forEach(btn =>
      btn.addEventListener("click", () => {
        changeConnectionType(connId, btn.dataset.type);
        menu.classList.add("hidden");
      }));
    menu.querySelector("button.del").addEventListener("click", () => {
      removeConnection(connId);
      menu.classList.add("hidden");
    });
    const noteInput = menu.querySelector("#lm-note");
    noteInput.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Enter") {
        setConnectionNote(connId, noteInput.value.trim());
        menu.classList.add("hidden");
      }
    });
    noteInput.addEventListener("blur", () => {
      const v = noteInput.value.trim();
      if (v !== (conn.note || "")) setConnectionNote(connId, v);
    });
    setTimeout(() => noteInput.focus(), 60);
    setTimeout(() => {
      document.addEventListener("click", function once(e) {
        if (!menu.contains(e.target)) {
          const v = noteInput.value.trim();
          if (v !== (conn.note || "")) setConnectionNote(connId, v);
          menu.classList.add("hidden");
        }
        document.removeEventListener("click", once);
      });
    }, 50);
  }

  function deselectAll() {
    selectedIds.clear();
    $$(".rm-item.selected").forEach(el => el.classList.remove("selected"));
    updateSidebar();
  }

  /* ── Modal ── */
  function openModal(existingId) {
    const item = existingId ? STATE.items.find(i => i.id === existingId) : null;
    const bg = $("#modal-bg");
    const modal = $("#modal");
    modal.innerHTML = `
      <h3>${item ? "Edit Item" : "Add Item"}</h3>
      <div class="modal-field">
        <label>Label</label>
        <input type="text" id="m-label" value="${item ? esc(item.label) : ""}" placeholder="e.g. CI/CD Pipeline">
      </div>
      <div class="modal-field">
        <label>Scope</label>
        <div class="scope-radios">
          <label class="scope-radio in"><input type="radio" name="m-scope" value="in" ${!item || item.scope === "in" ? "checked" : ""}><span>In Scope</span></label>
          <label class="scope-radio stretch"><input type="radio" name="m-scope" value="stretch" ${item && item.scope === "stretch" ? "checked" : ""}><span>Stretch</span></label>
          <label class="scope-radio out"><input type="radio" name="m-scope" value="out" ${item && item.scope === "out" ? "checked" : ""}><span>Out of Scope</span></label>
        </div>
      </div>
      <div class="modal-field">
        <label>Description (optional)</label>
        <textarea id="m-desc" placeholder="Brief context…">${item ? esc(item.description) : ""}</textarea>
      </div>
      <div class="modal-field">
        <label class="checkbox-field">
          <input type="checkbox" id="m-submap" ${item && item.needsSubMap ? "checked" : ""}>
          Needs its own initiative / sub-map
        </label>
      </div>
      <div class="modal-field" id="m-submap-name-wrap" style="display:${item && item.needsSubMap ? "block" : "none"}">
        <label>Linked map name</label>
        <input type="text" id="m-submap-name" value="${item && item.subMapName ? esc(item.subMapName) : ""}" placeholder="e.g. ci-cd-pipeline">
      </div>
      <div class="modal-field">
        <label>Teams (optional)</label>
        <div id="m-team-cbs" style="max-height:120px;overflow-y:auto">
          ${(STATE.teamList || []).map(t => `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:.85rem;cursor:pointer"><input type="checkbox" class="m-team-cb" value="${esc(t)}" ${item && Array.isArray(item.team) && item.team.includes(t) ? "checked" : ""} style="accent-color:var(--accent);width:15px;height:15px"> ${esc(t)}</label>`).join("") || '<span style="font-size:.82rem;color:var(--ink-light)">No teams yet</span>'}
        </div>
      </div>
      <div class="modal-field">
        <label>Phase (optional)</label>
        <select id="m-phase" style="width:100%;font-family:var(--font);font-size:.88rem;padding:.45rem .6rem;border:1px solid var(--border);border-radius:4px;color:var(--ink)">
          <option value="">No phase</option>
          ${(STATE.phaseList || []).map(p => `<option value="${esc(p)}" ${item && item.phase === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
        </select>
      </div>
      <div class="modal-field">
        <label>Notes (optional)</label>
        <textarea id="m-notes" placeholder="Additional notes…" style="min-height:50px">${item ? esc(item.notes || "") : ""}</textarea>
      </div>
      <div class="modal-actions">
        <button class="modal-btn cancel" id="m-cancel">Cancel</button>
        <button class="modal-btn save" id="m-save">${item ? "Update" : "Add"}</button>
      </div>`;
    bg.classList.remove("hidden");
    setTimeout(() => $("#m-label").focus(), 60);
    $("#m-cancel").onclick = () => bg.classList.add("hidden");
    bg.addEventListener("click", e => { if (e.target === bg) bg.classList.add("hidden"); });
    $("#m-submap").addEventListener("change", e => {
      $("#m-submap-name-wrap").style.display = e.target.checked ? "block" : "none";
    });
    $("#m-save").onclick = () => {
      const label = $("#m-label").value.trim();
      if (!label) { $("#m-label").style.borderColor = "#c00"; return; }
      const scope = $('input[name="m-scope"]:checked').value;
      const desc = $("#m-desc").value.trim();
      const submap = $("#m-submap").checked;
      const subMapName = submap ? $("#m-submap-name").value.trim() : "";
      const team = [...document.querySelectorAll('.m-team-cb:checked')].map(cb => cb.value);
      const phase = $("#m-phase").value;
      const notes = $("#m-notes").value.trim();
      if (item) updateItem(item.id, { label, scope, description: desc, needsSubMap: submap, subMapName, team, phase, notes });
      else addItem(label, scope, desc, submap, subMapName, team, phase, notes);
      bg.classList.add("hidden");
    };
    $("#m-label").addEventListener("keydown", e => { if (e.key === "Enter") $("#m-save").click(); });
  }

  /* ── Pan / Zoom ── */
  function attachGlobalListeners() {
    const wrap = $("#canvas-wrap");

    // Marquee select on background drag (select mode)
    wrap.addEventListener("pointerdown", e => {
      const onBg = e.target === wrap || e.target.id === "canvas" ||
        (e.target.closest && e.target.closest(".rm-lines") && !e.target.dataset.connId) ||
        e.target.closest && e.target.closest(".rm-guides");
      if (!onBg && !spaceHeld) return;
      if (spaceHeld || e.button === 1) {
        e.preventDefault();
        panState = { startX: e.clientX, startY: e.clientY, origX: STATE.view.x, origY: STATE.view.y };
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      // marquee selection
      if (!e.shiftKey) deselectAll();
      closeMenus();
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const sx = (e.clientX - rect.left - STATE.view.x) / STATE.view.scale;
      const sy = (e.clientY - rect.top - STATE.view.y) / STATE.view.scale;
      marqueeState = { startX: sx, startY: sy, pointerId: e.pointerId };
      wrap.setPointerCapture(e.pointerId);
    });

    wrap.addEventListener("pointermove", e => {
      if (panState) {
        STATE.view.x = panState.origX + (e.clientX - panState.startX);
        STATE.view.y = panState.origY + (e.clientY - panState.startY);
        applyTransform();
        updateMinimapViewport();
      }
      if (marqueeState) {
        const rect = wrap.getBoundingClientRect();
        const cx = (e.clientX - rect.left - STATE.view.x) / STATE.view.scale;
        const cy = (e.clientY - rect.top - STATE.view.y) / STATE.view.scale;
        const x = Math.min(marqueeState.startX, cx);
        const y = Math.min(marqueeState.startY, cy);
        const w = Math.abs(cx - marqueeState.startX);
        const h = Math.abs(cy - marqueeState.startY);
        const mr = $("#marquee-rect");
        if (mr) {
          mr.style.display = "block";
          // Position the marquee SVG to match canvas transform
          const mSvg = $("#marquee-svg");
          if (mSvg) mSvg.style.transform = `translate(${STATE.view.x}px,${STATE.view.y}px) scale(${STATE.view.scale})`;
          mr.setAttribute("x", x); mr.setAttribute("y", y);
          mr.setAttribute("width", w); mr.setAttribute("height", h);
        }
        // Live highlight
        for (const item of STATE.items) {
          const card = $(`[data-item-id="${item.id}"]`);
          if (!card) continue;
          const iw = card.offsetWidth, ih = card.offsetHeight;
          const inside = item.x + iw > x && item.x < x + w && item.y + ih > y && item.y < y + h;
          if (inside) { selectedIds.add(item.id); card.classList.add("selected"); }
          else if (!e.shiftKey) { selectedIds.delete(item.id); card.classList.remove("selected"); }
        }
      }
    });

    wrap.addEventListener("pointerup", e => {
      if (panState) {
        wrap.releasePointerCapture(e.pointerId);
        panState = null;
        saveState();
        updateMinimap();
      }
      if (marqueeState) {
        wrap.releasePointerCapture(e.pointerId);
        marqueeState = null;
        const mr = $("#marquee-rect");
        if (mr) mr.style.display = "none";
        updateSidebar();
      }
    });

    wrap.addEventListener("wheel", e => {
      e.preventDefault();
      if (e.ctrlKey) {
        const rect = wrap.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const oldS = STATE.view.scale;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newS = Math.min(3, Math.max(0.15, oldS * delta));
        STATE.view.x = mx - (mx - STATE.view.x) * (newS / oldS);
        STATE.view.y = my - (my - STATE.view.y) * (newS / oldS);
        STATE.view.scale = newS;
        updateZoomIndicator();
      } else {
        STATE.view.x -= e.deltaX;
        STATE.view.y -= e.deltaY;
      }
      applyTransform();
      updateMinimapViewport();
      saveState();
    }, { passive: false });

    document.addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.code === "Space" && !spaceHeld) { spaceHeld = true; wrap.classList.add("mode-pan"); e.preventDefault(); }
      if (e.key === "Escape") { closeMenus(); deselectAll(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size) { removeSelected(); }
      if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo(); }
      if (((e.key === "y" || e.key === "Y") && (e.ctrlKey || e.metaKey)) ||
          ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); redo(); }
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        STATE.items.forEach(i => { selectedIds.add(i.id); const c = $(`[data-item-id="${i.id}"]`); if (c) c.classList.add("selected"); });
        updateSidebar();
      }
      if (e.key === "d" && (e.ctrlKey || e.metaKey) && selectedIds.size === 1) {
        e.preventDefault();
        duplicateItem([...selectedIds][0]);
      }
    });

    document.addEventListener("keyup", e => {
      if (e.code === "Space") { spaceHeld = false; wrap.classList.remove("mode-pan"); }
    });

    document.addEventListener("dragover", e => { e.preventDefault(); $("#drop-overlay").classList.add("show"); });
    document.addEventListener("dragleave", e => {
      if (e.relatedTarget === null || !document.contains(e.relatedTarget)) $("#drop-overlay").classList.remove("show");
    });
    document.addEventListener("drop", e => {
      e.preventDefault();
      $("#drop-overlay").classList.remove("show");
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const reader = new FileReader();
      const name = file.name.toLowerCase();
      reader.onload = () => {
        if (name.endsWith(".json")) loadFromJSON(reader.result);
        else if (name.endsWith(".csv") || name.endsWith(".tsv")) loadFromCSV(reader.result);
        else if (name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".txt")) loadFromMarkdown(reader.result);
        else alert("Unsupported file type. Use JSON, CSV, or Markdown.");
      };
      reader.readAsText(file);
    });
  }

  function updateTempLine(clientX, clientY) {
    const svg = $("#lines-svg");
    let temp = $("#temp-line");
    if (!temp) {
      temp = document.createElementNS("http://www.w3.org/2000/svg", "line");
      temp.id = "temp-line";
      temp.setAttribute("stroke", "var(--accent)");
      temp.setAttribute("stroke-width", "2");
      temp.setAttribute("stroke-dasharray", "6 4");
      temp.style.pointerEvents = "none";
      svg.appendChild(temp);
    }
    const fromCenter = getItemCenter(wireState.fromId);
    if (!fromCenter) return;
    const wrap = $("#canvas-wrap");
    const rect = wrap.getBoundingClientRect();
    const toX = (clientX - rect.left - STATE.view.x) / STATE.view.scale;
    const toY = (clientY - rect.top - STATE.view.y) / STATE.view.scale;
    const edgeFrom = getEdgeMidpoint(wireState.fromId, fromCenter, { x: toX, y: toY });
    temp.setAttribute("x1", edgeFrom.point.x);
    temp.setAttribute("y1", edgeFrom.point.y);
    temp.setAttribute("x2", toX);
    temp.setAttribute("y2", toY);
  }

  function applyTransform() {
    const canvas = $("#canvas");
    if (canvas) canvas.style.transform = `translate(${STATE.view.x}px,${STATE.view.y}px) scale(${STATE.view.scale})`;
  }

  function updateZoomIndicator() {
    const ind = $("#zoom-ind");
    if (!ind) return;
    const pct = Math.round(STATE.view.scale * 100);
    ind.innerHTML = `<button class="zoom-btn" onclick="window._rm.zoomTo(${Math.max(0.15, STATE.view.scale / 1.2)})">−</button>
      <span>${pct}%</span>
      <button class="zoom-btn" onclick="window._rm.zoomTo(${Math.min(3, STATE.view.scale * 1.2)})">+</button>
      <button class="zoom-btn" onclick="window._rm.resetView()" title="Reset view" style="font-size:.65rem">⟲</button>`;
  }

  function zoomTo(s) {
    const wrap = $("#canvas-wrap");
    const cx = wrap.clientWidth / 2, cy = wrap.clientHeight / 2;
    const oldS = STATE.view.scale;
    STATE.view.x = cx - (cx - STATE.view.x) * (s / oldS);
    STATE.view.y = cy - (cy - STATE.view.y) * (s / oldS);
    STATE.view.scale = s;
    applyTransform(); updateZoomIndicator(); updateMinimapViewport(); saveState();
  }

  function resetView() {
    STATE.view = { x: 0, y: 0, scale: 1 };
    applyTransform(); updateZoomIndicator(); updateMinimapViewport(); saveState();
  }

  function closeMenus() {
    const lm = $("#line-menu"); if (lm) lm.classList.add("hidden");
  }

  /* ── Minimap ── */
  function updateMinimap() {
    updateMinimapCanvas();
    updateMinimapViewport();
  }

  function updateMinimapCanvas() {
    const c = $("#minimap-canvas");
    if (!c) return;
    const ctx = c.getContext("2d");
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, W, H);
    if (!STATE.items.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    STATE.items.forEach(item => {
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + 200);
      maxY = Math.max(maxY, item.y + 80);
    });
    const pad = 50;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const scaleX = W / (maxX - minX), scaleY = H / (maxY - minY);
    const scale = Math.min(scaleX, scaleY);

    const scopeFills = { in: "#c8e6c8", stretch: "#f0d080", out: "#d0d0d0" };
    const lineStrokes = { hard: "#1a1a1a", soft: "#0066cc", parallel: "#8a8d90" };

    STATE.connections.forEach(conn => {
      const fi = STATE.items.find(i => i.id === conn.fromId);
      const ti = STATE.items.find(i => i.id === conn.toId);
      if (!fi || !ti) return;
      ctx.beginPath();
      ctx.moveTo((fi.x + 100 - minX) * scale, (fi.y + 40 - minY) * scale);
      ctx.lineTo((ti.x + 100 - minX) * scale, (ti.y + 40 - minY) * scale);
      ctx.strokeStyle = lineStrokes[conn.type] || "#999";
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    STATE.items.forEach(item => {
      const x = (item.x - minX) * scale, y = (item.y - minY) * scale;
      const w = 200 * scale, h = 60 * scale;
      ctx.fillStyle = scopeFills[item.scope] || "#ddd";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#999";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, w, h);
    });

    // Store bounds for viewport calc
    c.dataset.minX = minX; c.dataset.minY = minY;
    c.dataset.maxX = maxX; c.dataset.maxY = maxY;
    c.dataset.scale = scale;
  }

  function updateMinimapViewport() {
    const c = $("#minimap-canvas");
    const vp = $("#minimap-vp");
    if (!c || !vp || !STATE.items.length) { if (vp) vp.style.display = "none"; return; }
    const wrap = $("#canvas-wrap");
    if (!wrap) return;
    const minX = +c.dataset.minX, minY = +c.dataset.minY, mmScale = +c.dataset.scale;
    if (!mmScale) return;

    const vpLeft = (-STATE.view.x / STATE.view.scale - minX) * mmScale;
    const vpTop = (-STATE.view.y / STATE.view.scale - minY) * mmScale;
    const vpW = (wrap.clientWidth / STATE.view.scale) * mmScale;
    const vpH = (wrap.clientHeight / STATE.view.scale) * mmScale;

    vp.style.display = "block";
    vp.style.left = vpLeft + "px";
    vp.style.top = vpTop + "px";
    vp.style.width = vpW + "px";
    vp.style.height = vpH + "px";
  }

  /* ── Persistence ── */
  function saveState() {
    try { localStorage.setItem(activeStorageKey, JSON.stringify(STATE)); } catch (e) { /* quota */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(activeStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          STATE = parsed;
          if (!STATE.teamList) STATE.teamList = [];
          if (!STATE.phaseList) STATE.phaseList = [];
          STATE.items.forEach(i => {
            if (typeof i.team === 'string') i.team = i.team ? [i.team] : [];
            if (!Array.isArray(i.team)) i.team = [];
            if (i.phase === undefined) i.phase = "";
            if (i.notes === undefined) i.notes = "";
          });
        }
      }
    } catch (e) { /* corrupt */ }
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = (activeMapName || "reliance-map") + ".json";
    a.click(); URL.revokeObjectURL(url);
  }

  function exportDrawio() {
    if (!STATE.items.length) return;
    const scopeColors = {
      in:      { bg: "#edf7ed", bd: "#8bcf8b", fg: "#1a6e1a" },
      stretch: { bg: "#fff8e6", bd: "#f0c040", fg: "#7a5700" },
      out:     { bg: "#f3f3f3", bd: "#c0c0c0", fg: "#666666" },
    };
    const connStyles = {
      hard:     { color: "#1a1a1a", dash: "0", style: "" },
      soft:     { color: "#0066cc", dash: "1", style: "dashed=1;" },
      parallel: { color: "#8a8d90", dash: "1", style: "dashed=1;dashPattern=10 5;" },
    };
    let cells = `<mxCell id="0"/><mxCell id="1" parent="0"/>`;
    STATE.items.forEach(item => {
      const sc = scopeColors[item.scope] || scopeColors.out;
      let label = esc(item.label);
      if (item.phase) label += `<br><font style="font-size:9px" color="#0066cc">[${esc(item.phase)}]</font>`;
      if (item.team && item.team.length) label += `<br><font style="font-size:9px" color="#6753AC">[${esc(item.team.join(', '))}]</font>`;
      if (item.notes) label += `<br><font style="font-size:8px" color="#666">${esc(item.notes.length > 60 ? item.notes.slice(0, 58) + "…" : item.notes)}</font>`;
      if (item.needsSubMap) label += `<br><font style="font-size:9px" color="${sc.fg}">⑂ initiative</font>`;
      const dashStyle = item.needsSubMap ? "dashed=1;" : "";
      cells += `<mxCell id="item-${item.id}" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${sc.bg};strokeColor=${sc.bd};fontColor=#1a1a1a;fontSize=12;fontFamily=Red Hat Display;${dashStyle}" vertex="1" parent="1"><mxGeometry x="${item.x}" y="${item.y}" width="200" height="80" as="geometry"/></mxCell>`;
    });
    STATE.connections.forEach(conn => {
      const cs = connStyles[conn.type] || connStyles.hard;
      let label = "";
      if (conn.note) label = esc(conn.note);
      cells += `<mxCell id="conn-${conn.id}" value="${label}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=${cs.color};${cs.style}endArrow=block;endFill=1;fontSize=10;fontColor=${cs.color};" edge="1" parent="1" source="item-${conn.fromId}" target="item-${conn.toId}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
    });
    const xml = `<?xml version="1.0" encoding="UTF-8"?><mxfile><diagram name="Reliance Map"><mxGraphModel><root>${cells}</root></mxGraphModel></diagram></mxfile>`;
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = (activeMapName || "reliance-map") + ".drawio";
    a.click(); URL.revokeObjectURL(url);
  }

  function exportMiroCSV() {
    if (!STATE.items.length) return;
    const rows = [["Title", "Description", "Scope", "Team", "Phase", "Notes", "Needs Initiative", "Dependencies"]];
    STATE.items.forEach(item => {
      const deps = STATE.connections
        .filter(c => c.toId === item.id)
        .map(c => {
          const from = STATE.items.find(i => i.id === c.fromId);
          return from ? `${from.label} (${CONN_TYPES[c.type]?.label || c.type})` : "";
        })
        .filter(Boolean)
        .join("; ");
      rows.push([
        item.label,
        item.description || "",
        SCOPE_LABELS[item.scope] || item.scope,
        (item.team || []).join(', '),
        item.phase || "",
        item.notes || "",
        item.needsSubMap ? "Yes" : "No",
        deps,
      ]);
    });
    const csv = rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = (activeMapName || "reliance-map") + "-miro.csv";
    a.click(); URL.revokeObjectURL(url);
  }

  async function exportPNG() {
    const canvas = $("#canvas");
    if (!canvas || !STATE.items.length) return;
    const PAD = 60;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    $$(".rm-item", canvas).forEach(card => {
      const x = parseFloat(card.style.left), y = parseFloat(card.style.top);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + card.offsetWidth); maxY = Math.max(maxY, y + card.offsetHeight);
    });
    const LEGEND_H = 40;
    const w = maxX - minX + PAD * 2, h = maxY - minY + PAD * 2 + LEGEND_H;
    const offX = -minX + PAD, offY = -minY + PAD;

    const svgNS = "http://www.w3.org/2000/svg";
    const svgRoot = document.createElementNS(svgNS, "svg");
    svgRoot.setAttribute("xmlns", svgNS);
    svgRoot.setAttribute("width", w); svgRoot.setAttribute("height", h);
    svgRoot.setAttribute("viewBox", `0 0 ${w} ${h}`);

    const style = document.createElementNS(svgNS, "style");
    style.textContent = `text{font-family:'Red Hat Display',system-ui,sans-serif}`;
    svgRoot.appendChild(style);

    const defs = document.createElementNS(svgNS, "defs");
    ["hard","soft","parallel"].forEach(t => {
      const marker = document.createElementNS(svgNS, "marker");
      marker.setAttribute("id", `png-ah-${t}`); marker.setAttribute("markerWidth", "8");
      marker.setAttribute("markerHeight", "6"); marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "3"); marker.setAttribute("orient", "auto");
      const p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", "M0,0 L8,3 L0,6");
      const colors = { hard: "#1a1a1a", soft: "#0066cc", parallel: "#8a8d90" };
      p.setAttribute("fill", colors[t]); marker.appendChild(p); defs.appendChild(marker);
    });
    svgRoot.appendChild(defs);

    const bg = document.createElementNS(svgNS, "rect");
    bg.setAttribute("width", w); bg.setAttribute("height", h); bg.setAttribute("fill", "#f5f5f5");
    svgRoot.appendChild(bg);

    const lineColors = { hard: "#1a1a1a", soft: "#0066cc", parallel: "#8a8d90" };
    const lineDash = { hard: "", soft: "4 4", parallel: "10 5" };

    STATE.connections.forEach(conn => {
      const fromCenter = getItemCenter(conn.fromId);
      const toCenter = getItemCenter(conn.toId);
      if (!fromCenter || !toCenter) return;
      const fromEdge = getEdgeMidpoint(conn.fromId, fromCenter, toCenter);
      const toEdge = getEdgeMidpoint(conn.toId, toCenter, fromCenter);
      const pts = orthoPath(fromEdge.point, toEdge.point, fromEdge.side, toEdge.side);
      const offsetPts = pts.map(p => ({ x: p.x + offX, y: p.y + offY }));

      const polyline = document.createElementNS(svgNS, "polyline");
      polyline.setAttribute("points", offsetPts.map(p => `${p.x},${p.y}`).join(" "));
      polyline.setAttribute("stroke", lineColors[conn.type]); polyline.setAttribute("stroke-width", "2.5");
      polyline.setAttribute("fill", "none");
      if (lineDash[conn.type]) polyline.setAttribute("stroke-dasharray", lineDash[conn.type]);
      polyline.setAttribute("marker-end", `url(#png-ah-${conn.type})`);
      svgRoot.appendChild(polyline);

      if (conn.note) {
        const midIdx = Math.floor(offsetPts.length / 2);
        const lp1 = offsetPts[midIdx - 1] || offsetPts[0];
        const lp2 = offsetPts[midIdx] || offsetPts[offsetPts.length - 1];
        const labelText = conn.note;
        const lbg = document.createElementNS(svgNS, "rect");
        lbg.setAttribute("rx", "3"); lbg.setAttribute("fill", "#f5f5f5"); lbg.setAttribute("opacity", "0.9");
        const lt = document.createElementNS(svgNS, "text");
        lt.setAttribute("x", (lp1.x + lp2.x) / 2); lt.setAttribute("y", (lp1.y + lp2.y) / 2 + 3.5);
        lt.setAttribute("text-anchor", "middle"); lt.setAttribute("font-size", "10");
        lt.setAttribute("font-weight", "600"); lt.setAttribute("fill", lineColors[conn.type]);
        lt.textContent = labelText.length > 25 ? labelText.slice(0, 23) + "…" : labelText;
        svgRoot.appendChild(lt);
        const approxW = labelText.length * 6 + 8;
        lbg.setAttribute("x", (lp1.x + lp2.x) / 2 - approxW / 2);
        lbg.setAttribute("y", (lp1.y + lp2.y) / 2 - 6);
        lbg.setAttribute("width", approxW); lbg.setAttribute("height", 14);
        svgRoot.insertBefore(lbg, lt);
      }
    });

    function wrapText(str, maxW, fontSize) {
      const avgChar = fontSize * 0.58;
      const maxChars = Math.floor(maxW / avgChar);
      const words = str.split(/\s+/);
      const lines = [];
      let cur = "";
      for (const word of words) {
        const test = cur ? cur + " " + word : word;
        if (test.length > maxChars && cur) { lines.push(cur); cur = word; }
        else cur = test;
      }
      if (cur) lines.push(cur);
      return lines;
    }

    function addWrappedText(parent, str, x, y, maxW, fontSize, opts) {
      const lines = wrapText(str, maxW, fontSize);
      const el = document.createElementNS(svgNS, "text");
      el.setAttribute("x", x); el.setAttribute("font-size", fontSize);
      if (opts.weight) el.setAttribute("font-weight", opts.weight);
      el.setAttribute("fill", opts.fill || "#1a1a1a");
      const lineH = fontSize * 1.3;
      lines.forEach((line, i) => {
        if (opts.maxLines && i >= opts.maxLines) return;
        let text = line;
        if (opts.maxLines && i === opts.maxLines - 1 && i < lines.length - 1) text += "…";
        const ts = document.createElementNS(svgNS, "tspan");
        ts.setAttribute("x", x); ts.setAttribute("y", y + i * lineH);
        ts.textContent = text; el.appendChild(ts);
      });
      parent.appendChild(el);
      const rendered = Math.min(lines.length, opts.maxLines || lines.length);
      return rendered * lineH;
    }

    const scopeColors = { in: { bg: "#edf7ed", bd: "#8bcf8b", fg: "#1a6e1a" }, stretch: { bg: "#fff8e6", bd: "#f0c040", fg: "#7a5700" }, out: { bg: "#f3f3f3", bd: "#c0c0c0", fg: "#666" } };
    STATE.items.forEach(item => {
      const card = $(`[data-item-id="${item.id}"]`);
      if (!card) return;
      const cx = parseFloat(card.style.left) + offX, cy = parseFloat(card.style.top) + offY;
      const cw = card.offsetWidth, ch = card.offsetHeight;
      const sc = scopeColors[item.scope];
      const textW = cw - 24;
      const pillText = SCOPE_LABELS[item.scope].toUpperCase();
      const pillW = pillText.length * 5.5 + 12;
      const labelW = textW - pillW;

      const r = document.createElementNS(svgNS, "rect");
      r.setAttribute("x", cx); r.setAttribute("y", cy); r.setAttribute("width", cw); r.setAttribute("height", ch);
      r.setAttribute("rx", "6"); r.setAttribute("fill", sc.bg); r.setAttribute("stroke", sc.bd); r.setAttribute("stroke-width", "2");
      if (item.needsSubMap) r.setAttribute("stroke-dasharray", "6 3");
      svgRoot.appendChild(r);
      const leftBar = document.createElementNS(svgNS, "rect");
      leftBar.setAttribute("x", cx); leftBar.setAttribute("y", cy); leftBar.setAttribute("width", "4"); leftBar.setAttribute("height", ch);
      leftBar.setAttribute("rx", "6"); leftBar.setAttribute("fill", sc.bd); svgRoot.appendChild(leftBar);

      const pill = document.createElementNS(svgNS, "text");
      pill.setAttribute("x", cx + cw - 8); pill.setAttribute("y", cy + 16); pill.setAttribute("font-size", "9");
      pill.setAttribute("font-weight", "700"); pill.setAttribute("fill", sc.fg); pill.setAttribute("text-anchor", "end");
      pill.textContent = pillText; svgRoot.appendChild(pill);

      let ty = cy + 18;
      const labelH = addWrappedText(svgRoot, item.label, cx + 12, ty, labelW, 13, { weight: "700", maxLines: 3 });
      ty += labelH + 2;

      if (item.description) {
        const descH = addWrappedText(svgRoot, item.description, cx + 12, ty, textW, 11, { fill: "#4a4a4a", maxLines: 2 });
        ty += descH + 2;
      }

      if (item.notes) {
        const notesH = addWrappedText(svgRoot, item.notes, cx + 12, ty, textW, 10, { fill: "#767676", maxLines: 2 });
        ty += notesH + 2;
      }

      let badgeY = cy + ch - 6;
      if (item.team && item.team.length) {
        const teamEl = document.createElementNS(svgNS, "text");
        teamEl.setAttribute("x", cx + 12); teamEl.setAttribute("y", badgeY); teamEl.setAttribute("font-size", "9");
        teamEl.setAttribute("font-weight", "600"); teamEl.setAttribute("fill", "#6753AC");
        teamEl.textContent = item.team.join(', '); svgRoot.appendChild(teamEl);
        badgeY -= 12;
      }
      if (item.phase) {
        const phaseEl = document.createElementNS(svgNS, "text");
        phaseEl.setAttribute("x", cx + 12); phaseEl.setAttribute("y", badgeY); phaseEl.setAttribute("font-size", "9");
        phaseEl.setAttribute("font-weight", "600"); phaseEl.setAttribute("fill", "#0066cc");
        phaseEl.textContent = item.phase; svgRoot.appendChild(phaseEl);
      }
      if (item.needsSubMap) {
        const initEl = document.createElementNS(svgNS, "text");
        initEl.setAttribute("x", cx + 12); initEl.setAttribute("y", badgeY); initEl.setAttribute("font-size", "9");
        initEl.setAttribute("font-weight", "600"); initEl.setAttribute("fill", sc.fg);
        initEl.textContent = "⑂ " + (item.subMapName || "Needs own initiative"); svgRoot.appendChild(initEl);
      }
    });

    const legendY = h - 30;
    const legendItems = [
      { type: "swatch", color: "#edf7ed", border: "#8bcf8b", label: "In Scope" },
      { type: "swatch", color: "#fff8e6", border: "#f0c040", label: "Stretch" },
      { type: "swatch", color: "#f3f3f3", border: "#c0c0c0", label: "Out of Scope" },
      { type: "sep" },
      { type: "line", color: "#1a1a1a", dash: "", label: "Hard dependency" },
      { type: "line", color: "#0066cc", dash: "4 4", label: "Soft dependency" },
      { type: "line", color: "#8a8d90", dash: "10 5", label: "Parallel work" },
    ];
    let lx = 20;
    legendItems.forEach(li => {
      if (li.type === "sep") { lx += 10; return; }
      if (li.type === "swatch") {
        const r = document.createElementNS(svgNS, "rect");
        r.setAttribute("x", lx); r.setAttribute("y", legendY); r.setAttribute("width", "12"); r.setAttribute("height", "12");
        r.setAttribute("rx", "2"); r.setAttribute("fill", li.color); r.setAttribute("stroke", li.border); r.setAttribute("stroke-width", "1");
        svgRoot.appendChild(r); lx += 16;
      } else {
        const ln = document.createElementNS(svgNS, "line");
        ln.setAttribute("x1", lx); ln.setAttribute("y1", legendY + 6); ln.setAttribute("x2", lx + 24); ln.setAttribute("y2", legendY + 6);
        ln.setAttribute("stroke", li.color); ln.setAttribute("stroke-width", "2.5");
        if (li.dash) ln.setAttribute("stroke-dasharray", li.dash);
        svgRoot.appendChild(ln); lx += 28;
      }
      const t = document.createElementNS(svgNS, "text");
      t.setAttribute("x", lx); t.setAttribute("y", legendY + 10); t.setAttribute("font-size", "10");
      t.setAttribute("fill", "#666"); t.textContent = li.label; svgRoot.appendChild(t);
      lx += li.label.length * 6 + 14;
    });

    const svgStr = new XMLSerializer().serializeToString(svgRoot);
    const img = new Image();
    const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const dpr = window.devicePixelRatio || 2;
      const c = document.createElement("canvas"); c.width = w * dpr; c.height = h * dpr;
      const ctx = c.getContext("2d"); ctx.scale(dpr, dpr); ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(svgUrl);
      c.toBlob(blob => {
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = pngUrl;
        a.download = (activeMapName || "reliance-map") + ".png";
        a.click(); URL.revokeObjectURL(pngUrl);
      }, "image/png");
    };
    img.src = svgUrl;
  }

  /* ── CSV Import ── */
  function importCSV(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { loadFromCSV(reader.result); };
    reader.readAsText(file);
    e.target.value = "";
  }

  function loadFromCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) { alert("CSV needs a header row and at least one data row."); return; }
    const sep = lines[0].includes("\t") ? "\t" : ",";
    const parseRow = line => {
      const cells = []; let cur = ""; let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') inQ = false;
          else cur += ch;
        } else {
          if (ch === '"') inQ = true;
          else if (ch === sep) { cells.push(cur.trim()); cur = ""; }
          else cur += ch;
        }
      }
      cells.push(cur.trim());
      return cells;
    };
    const header = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const col = name => header.indexOf(name);
    const nameIdx = [col("title"), col("name"), col("label"), col("item"), col("topic")].find(i => i >= 0);
    if (nameIdx === undefined) { alert("CSV must have a column named Title, Name, Label, Item, or Topic."); return; }
    const scopeIdx = [col("scope"), col("status")].find(i => i >= 0);
    const descIdx = [col("description"), col("desc"), col("details")].find(i => i >= 0);
    const teamIdx = [col("team"), col("teams"), col("owner"), col("owners")].find(i => i >= 0);
    const phaseIdx = [col("phase"), col("milestone"), col("stage")].find(i => i >= 0);
    const notesIdx = [col("notes"), col("note"), col("comments")].find(i => i >= 0);
    const SCOPE_MAP = { in: "in", "in scope": "in", inscope: "in", stretch: "stretch", out: "out", "out of scope": "out", outofscope: "out" };

    pushUndo();
    const newTeams = new Set(STATE.teamList || []);
    const newPhases = new Set(STATE.phaseList || []);
    const items = [];
    for (let r = 1; r < lines.length; r++) {
      if (!lines[r].trim()) continue;
      const cells = parseRow(lines[r]);
      const label = cells[nameIdx];
      if (!label) continue;
      const rawScope = scopeIdx !== undefined ? (cells[scopeIdx] || "").toLowerCase().replace(/\s+/g, " ").trim() : "";
      const scope = SCOPE_MAP[rawScope] || "in";
      const desc = descIdx !== undefined ? cells[descIdx] || "" : "";
      const rawTeam = teamIdx !== undefined ? cells[teamIdx] || "" : "";
      const teamArr = rawTeam ? rawTeam.split(/[,;]/).map(t => t.trim()).filter(Boolean) : [];
      teamArr.forEach(t => newTeams.add(t));
      const phase = phaseIdx !== undefined ? cells[phaseIdx] || "" : "";
      if (phase) newPhases.add(phase);
      const notes = notesIdx !== undefined ? cells[notesIdx] || "" : "";
      items.push({ label, scope, description: desc, team: teamArr, phase, notes });
    }
    if (!items.length) { alert("No items found in CSV."); return; }
    populateItems(items, [...newTeams], [...newPhases]);
  }

  /* ── Markdown Import ── */
  function importMarkdown(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { loadFromMarkdown(reader.result); };
    reader.readAsText(file);
    e.target.value = "";
  }

  function loadFromMarkdown(text) {
    const lines = text.trim().split(/\r?\n/);
    const items = [];
    const newTeams = new Set(STATE.teamList || []);
    const newPhases = new Set(STATE.phaseList || []);
    let currentPhase = "";

    const SCOPE_MAP = { in: "in", "in scope": "in", stretch: "stretch", out: "out", "out of scope": "out" };

    for (const line of lines) {
      const headMatch = line.match(/^#{1,3}\s+(.+)/);
      if (headMatch) {
        currentPhase = headMatch[1].trim();
        if (currentPhase) newPhases.add(currentPhase);
        continue;
      }
      const listMatch = line.match(/^\s*[-*+]\s+(.+)/);
      if (!listMatch) continue;
      let raw = listMatch[1].trim();
      let scope = "in", description = "", notes = "", teamArr = [];

      const scopeTag = raw.match(/\[(in(?:\s*scope)?|stretch|out(?:\s*of\s*scope)?)\]/i);
      if (scopeTag) {
        scope = SCOPE_MAP[scopeTag[1].toLowerCase().replace(/\s+/g, " ")] || "in";
        raw = raw.replace(scopeTag[0], "").trim();
      }
      const teamTag = raw.match(/\{([^}]+)\}/);
      if (teamTag) {
        teamArr = teamTag[1].split(/[,;]/).map(t => t.trim()).filter(Boolean);
        teamArr.forEach(t => newTeams.add(t));
        raw = raw.replace(teamTag[0], "").trim();
      }
      const descSplit = raw.match(/^([^—–:]+)[—–:]\s*(.+)/);
      if (descSplit) {
        raw = descSplit[1].trim();
        description = descSplit[2].trim();
      }
      const boldMatch = raw.match(/^\*\*(.+?)\*\*/);
      if (boldMatch) raw = boldMatch[1];

      if (!raw) continue;
      items.push({ label: raw, scope, description, team: teamArr, phase: currentPhase, notes });
    }
    if (!items.length) { alert("No list items found in Markdown. Use - or * bullets for items."); return; }
    pushUndo();
    populateItems(items, [...newTeams], [...newPhases]);
  }

  /* ── Paste text import ── */
  function importFromText() {
    const bg = $("#modal-bg");
    const modal = $("#modal");
    modal.innerHTML = `
      <h3>Import from text</h3>
      <p style="font-size:.82rem;color:var(--ink-mid);margin-bottom:.6rem;line-height:1.45">
        Paste CSV or Markdown. The tool auto-detects the format.<br>
        <strong>CSV:</strong> needs a header row with at least a <em>Title</em> column. Optional: Scope, Team, Phase, Notes, Description.<br>
        <strong>Markdown:</strong> use <code>- item name</code> bullets. Headings become phases. Tags: <code>[stretch]</code> for scope, <code>{Team A, Team B}</code> for teams, <code>— description</code> for details.
      </p>
      <div class="modal-field">
        <textarea id="import-text-area" style="width:100%;min-height:180px;font-family:var(--mono);font-size:.82rem;resize:vertical;padding:.5rem;border:1px solid var(--border);border-radius:4px" placeholder="Title, Scope, Team, Phase\nBuild CI pipeline, In Scope, Platform Ops, Phase 1\n\nor\n\n## Phase 1\n- Build CI pipeline {Platform Ops}\n- Set up monitoring [stretch] — observability stack"></textarea>
      </div>
      <div class="modal-actions">
        <button class="modal-btn cancel" id="import-text-cancel">Cancel</button>
        <button class="modal-btn save" id="import-text-go">Import</button>
      </div>`;
    bg.classList.remove("hidden");
    setTimeout(() => $("#import-text-area").focus(), 60);
    $("#import-text-cancel").onclick = () => bg.classList.add("hidden");
    bg.addEventListener("click", e => { if (e.target === bg) bg.classList.add("hidden"); });
    $("#import-text-go").onclick = () => {
      const text = $("#import-text-area").value.trim();
      if (!text) return;
      bg.classList.add("hidden");
      if (looksLikeCSV(text)) loadFromCSV(text);
      else loadFromMarkdown(text);
    };
  }

  function looksLikeCSV(text) {
    const first = text.split(/\r?\n/)[0] || "";
    const lower = first.toLowerCase();
    if (lower.includes(",") && (lower.includes("title") || lower.includes("name") || lower.includes("label"))) return true;
    if (first.includes("\t")) return true;
    return false;
  }

  /* ── Import templates ── */
  function downloadCSVTemplate() {
    const csv = `Title,Scope,Team,Phase,Description,Notes\nCI/CD Pipeline,In Scope,Platform Ops,Phase 1,Automated build and deploy,\nMonitoring Stack,Stretch,SRE; Platform Ops,Phase 2,Observability and alerting,Need to evaluate tools\nLegacy Migration,Out of Scope,,Phase 3,Move off old platform,Blocked on vendor contract`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "reliance-map-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadMDTemplate() {
    const md = `## Phase 1\n- CI/CD Pipeline {Platform Ops} — Automated build and deploy\n- Authentication service [in scope] {Security} — SSO integration\n\n## Phase 2\n- Monitoring stack [stretch] {SRE, Platform Ops} — Observability and alerting\n- API Gateway — Centralised routing and rate limiting\n\n## Phase 3\n- Legacy migration [out of scope] — Move off old platform`;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "reliance-map-template.md"; a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Shared item builder ── */
  function populateItems(items, teamList, phaseList) {
    const COLS = 3, COL_W = 280, ROW_H = 100;
    items.forEach((it, i) => {
      STATE.items.push({
        id: STATE.nextId++, label: it.label, scope: it.scope,
        description: it.description || "", needsSubMap: false, subMapName: "",
        team: it.team || [], phase: it.phase || "", notes: it.notes || "",
        x: snapToGrid(80 + (i % COLS) * COL_W),
        y: snapToGrid(60 + Math.floor(i / COLS) * ROW_H),
      });
    });
    teamList.forEach(t => { if (!STATE.teamList.includes(t)) STATE.teamList.push(t); });
    STATE.teamList.sort((a, b) => a.localeCompare(b));
    phaseList.forEach(p => { if (!STATE.phaseList.includes(p)) STATE.phaseList.push(p); });
    STATE.phaseList.sort((a, b) => a.localeCompare(b));
    saveState(); renderApp();
  }

  function openSubMap(name) {
    saveState();
    window.location.href = "?map=" + encodeURIComponent(name);
  }

  function importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { loadFromJSON(reader.result); };
    reader.readAsText(file);
    e.target.value = "";
  }

  function loadFromJSON(text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.items)) {
        pushUndo();
        STATE = parsed;
        saveState(); renderApp(); return;
      }
      const ann = parsed.ann || parsed.ANN;
      if (ann && typeof ann === "object") { importOMASnapshot(parsed); return; }
      alert("Unrecognised file format — expected a Reliance Map export or an OMA snapshot.");
    } catch (e) { alert("Failed to parse JSON file."); }
  }

  function importOMASnapshot(snap) {
    pushUndo();
    const ann = snap.ann || snap.ANN || {};
    const mapped = snap.mapped || snap.MAPPED || {};
    const pOrder = snap.priorityOrder || [];
    const teams = snap.teams || snap.TEAMS || {};
    const tList = snap.teamList || [];

    const mapEntries = [];
    const fallbackEntries = [];
    const FALLBACK_SCOPE = { risk: "in", planned: "stretch", gap: "out" };
    for (const [path, status] of Object.entries(ann)) {
      const parts = path.split("|");
      const name = parts[parts.length - 1];
      const group = parts.length >= 3 ? parts[parts.length - 2] : "";
      const pillar = parts.length >= 2 ? parts[1] : "";
      const rank = pOrder.indexOf(path);
      const entry = { path, name, group, pillar, status, rank: rank >= 0 ? rank : 9999 };
      if (mapped[path]) {
        entry.scope = FALLBACK_SCOPE[status] || "in";
        mapEntries.push(entry);
      } else if (FALLBACK_SCOPE[status]) {
        entry.scope = FALLBACK_SCOPE[status];
        fallbackEntries.push(entry);
      }
    }
    const entries = mapEntries.length ? mapEntries : fallbackEntries;
    entries.sort((a, b) => a.rank - b.rank);
    if (!entries.length) { alert("No mapped (⑂), risk, planned, or gap items found in this OMA snapshot."); return; }

    STATE = { items: [], connections: [], view: { x: 0, y: 0, scale: 1 }, nextId: 1, teamList: [...tList], phaseList: [] };
    const SPACING = 100;
    entries.forEach((e, i) => {
      const t = teams[e.path];
      const teamArr = Array.isArray(t) ? [...t] : (t ? [t] : []);
      STATE.items.push({
        id: STATE.nextId++, label: e.name, scope: e.scope,
        description: [e.pillar, e.group].filter(Boolean).join(" › "),
        needsSubMap: false, subMapName: "",
        team: teamArr,
        phase: "", notes: "",
        x: snapToGrid(80 + (i % 3) * 280), y: snapToGrid(60 + Math.floor(i / 3) * SPACING),
      });
    });
    saveState(); renderApp();
  }

  function clearAll() {
    if (!confirm("Clear all items and connections? This cannot be undone.")) return;
    pushUndo();
    STATE = { items: [], connections: [], view: { x: 0, y: 0, scale: 1 }, nextId: 1, teamList: [], phaseList: [] };
    saveState(); renderApp();
  }

  /* ── Helpers ── */
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  window._rm = {
    openModal, removeItem, removeSelected, duplicateItem,
    exportJSON, exportPNG, exportDrawio, exportMiroCSV,
    importJSON, importCSV, importMarkdown, importFromText,
    downloadCSVTemplate, downloadMDTemplate,
    clearAll, zoomTo, resetView, openSubMap, loadSample, undo, redo,
    sidebarSetScope, sidebarSetTeam, sidebarAddTeam,
    sidebarSetPhase, sidebarAddPhase, sidebarSetNotes, sidebarToggleInitiative,
    manageAddTeam, manageRemoveTeam, manageAddPhase, manageRemovePhase,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
