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

  let STATE = { items: [], connections: [], view: { x: 0, y: 0, scale: 1 }, nextId: 1 };
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
    const backLink = activeMapName
      ? `<a class="topbar-back" href="./">← Back to main map</a>`
      : `<a class="topbar-back" href="../">← OMA Workshop</a>`;
    const title = activeMapName
      ? `Reliance Map <span style="color:var(--accent);font-size:.82rem;font-weight:600;margin-left:.3rem">${esc(activeMapName)}</span>`
      : "Reliance Map";
    $("#topbar").innerHTML = `<div class="topbar-inner">
      <div style="display:flex;align-items:center;gap:.6rem">
        ${backLink}
        <span class="sep">|</span>
        <span class="topbar-brand">${title}</span>
      </div>
    </div>`;
  }

  function renderApp() {
    const app = $("#app");
    app.innerHTML = "";
    app.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
    app.appendChild(buildToolbar());
    app.appendChild(buildLegend());
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
    app.appendChild(wrap);

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
    drop.innerHTML = "<span>Drop JSON file to import</span>";
    app.appendChild(drop);

    const lineMenu = el("div", "line-menu hidden");
    lineMenu.id = "line-menu";
    app.appendChild(lineMenu);

    renderAllItems();
    renderConnections();
    applyTransform();
    updateZoomIndicator();
    updateMinimap();

    if (!STATE.items.length) renderEmptyState();
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
        <span>Scroll to zoom</span>
        <span>Hold Space to pan</span>
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
      items: [
        { id: 1, label: "Platform team onboarded", scope: "in", description: "Core team trained on AAP", needsSubMap: false, subMapName: "", x: 100, y: 100 },
        { id: 2, label: "CI/CD pipeline", scope: "in", description: "Automated deployment pipeline", needsSubMap: true, subMapName: "ci-cd-pipeline", x: 400, y: 100 },
        { id: 3, label: "Monitoring & alerting", scope: "stretch", description: "Grafana dashboards + PagerDuty", needsSubMap: false, subMapName: "", x: 400, y: 280 },
        { id: 4, label: "Self-service portal", scope: "stretch", description: "Developer portal for job launching", needsSubMap: false, subMapName: "", x: 100, y: 280 },
        { id: 5, label: "Multi-cloud expansion", scope: "out", description: "Azure + GCP automation targets", needsSubMap: false, subMapName: "", x: 250, y: 440 },
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

  /* ── Toolbar ── */
  function buildToolbar() {
    const tb = el("div", "rm-toolbar");
    tb.id = "toolbar";
    tb.innerHTML = `
      <button class="tb-btn primary" onclick="window._rm.openModal()">+ Add Item</button>
      <div class="tb-sep"></div>
      <div class="tb-group">
        <button class="tb-btn" onclick="window._rm.undo()" title="Undo (Ctrl+Z)">↩ Undo</button>
        <button class="tb-btn" onclick="window._rm.redo()" title="Redo (Ctrl+Y)">↪ Redo</button>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-group">
        <button class="tb-btn" onclick="window._rm.exportJSON()" title="Export reliance map as JSON">Export JSON</button>
        <button class="tb-btn" onclick="window._rm.exportPNG()" title="Export map as PNG image">Export PNG</button>
        <button class="tb-btn" onclick="document.getElementById('import-input').click()" title="Import reliance map or OMA snapshot">Import</button>
        <input type="file" id="import-input" accept=".json" style="display:none" onchange="window._rm.importJSON(event)">
      </div>
      <div class="tb-sep"></div>
      <button class="tb-btn danger" onclick="window._rm.clearAll()">Clear All</button>
      <div style="flex:1"></div>
      <a href="guide.html" class="tb-btn" style="text-decoration:none" title="What is a Reliance Map?">? Guide</a>`;
    return tb;
  }

  /* ── Legend ── */
  function buildLegend() {
    const lg = el("div", "rm-legend");
    lg.innerHTML = `
      <span class="lg-item"><span class="lg-swatch in"></span> In Scope</span>
      <span class="lg-item"><span class="lg-swatch stretch"></span> Stretch Scope</span>
      <span class="lg-item"><span class="lg-swatch out"></span> Out of Scope</span>
      <span class="lg-sep"></span>
      <span class="lg-item"><span class="lg-line hard"></span> Hard dep</span>
      <span class="lg-item"><span class="lg-line soft"></span> Soft dep</span>
      <span class="lg-item"><span class="lg-line parallel"></span> Parallel</span>`;
    return lg;
  }

  /* ── Item CRUD ── */
  function addItem(label, scope, description, needsSubMap, subMapName) {
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
      <div class="item-actions">
        <button class="item-act-btn" onclick="event.stopPropagation();window._rm.duplicateItem(${item.id})" title="Duplicate">⧉</button>
        <button class="item-act-btn" onclick="event.stopPropagation();window._rm.openModal(${item.id})" title="Edit">✎</button>
        <button class="item-act-btn del" onclick="event.stopPropagation();window._rm.removeItem(${item.id})" title="Delete">✕</button>
      </div>
      <div class="item-header">
        <span class="item-label">${esc(item.label)}</span>
        <span class="item-scope-pill ${item.scope}">${SCOPE_LABELS[item.scope]}</span>
      </div>
      ${item.description ? `<div class="item-desc">${esc(item.description)}</div>` : ""}
      <div class="item-footer">
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
      return;
    }

    if (!selectedIds.has(id)) {
      deselectAll();
      selectedIds.add(id);
      card.classList.add("selected");
    }

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
      if (item) updateItem(item.id, { label, scope, description: desc, needsSubMap: submap, subMapName });
      else addItem(label, scope, desc, submap, subMapName);
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
      }
    });

    wrap.addEventListener("wheel", e => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const oldS = STATE.view.scale;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newS = Math.min(3, Math.max(0.15, oldS * delta));
      STATE.view.x = mx - (mx - STATE.view.x) * (newS / oldS);
      STATE.view.y = my - (my - STATE.view.y) * (newS / oldS);
      STATE.view.scale = newS;
      applyTransform();
      updateZoomIndicator();
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
      if (file && file.name.endsWith(".json")) {
        const reader = new FileReader();
        reader.onload = () => { loadFromJSON(reader.result); };
        reader.readAsText(file);
      }
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
        if (parsed && Array.isArray(parsed.items)) STATE = parsed;
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
    const w = maxX - minX + PAD * 2, h = maxY - minY + PAD * 2;
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

    const scopeColors = { in: { bg: "#edf7ed", bd: "#8bcf8b", fg: "#1a6e1a" }, stretch: { bg: "#fff8e6", bd: "#f0c040", fg: "#7a5700" }, out: { bg: "#f3f3f3", bd: "#c0c0c0", fg: "#666" } };
    STATE.items.forEach(item => {
      const card = $(`[data-item-id="${item.id}"]`);
      if (!card) return;
      const cx = parseFloat(card.style.left) + offX, cy = parseFloat(card.style.top) + offY;
      const cw = card.offsetWidth, ch = card.offsetHeight;
      const sc = scopeColors[item.scope];
      const r = document.createElementNS(svgNS, "rect");
      r.setAttribute("x", cx); r.setAttribute("y", cy); r.setAttribute("width", cw); r.setAttribute("height", ch);
      r.setAttribute("rx", "6"); r.setAttribute("fill", sc.bg); r.setAttribute("stroke", sc.bd); r.setAttribute("stroke-width", "2");
      if (item.needsSubMap) r.setAttribute("stroke-dasharray", "6 3");
      svgRoot.appendChild(r);
      const leftBar = document.createElementNS(svgNS, "rect");
      leftBar.setAttribute("x", cx); leftBar.setAttribute("y", cy); leftBar.setAttribute("width", "4"); leftBar.setAttribute("height", ch);
      leftBar.setAttribute("rx", "6"); leftBar.setAttribute("fill", sc.bd); svgRoot.appendChild(leftBar);
      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("x", cx + 12); label.setAttribute("y", cy + 18); label.setAttribute("font-size", "13");
      label.setAttribute("font-weight", "700"); label.setAttribute("fill", "#1a1a1a"); label.textContent = item.label;
      svgRoot.appendChild(label);
      if (item.description) {
        const desc = document.createElementNS(svgNS, "text");
        desc.setAttribute("x", cx + 12); desc.setAttribute("y", cy + 34); desc.setAttribute("font-size", "11"); desc.setAttribute("fill", "#4a4a4a");
        desc.textContent = item.description.length > 40 ? item.description.slice(0, 38) + "…" : item.description;
        svgRoot.appendChild(desc);
      }
      const pill = document.createElementNS(svgNS, "text");
      pill.setAttribute("x", cx + cw - 8); pill.setAttribute("y", cy + 16); pill.setAttribute("font-size", "9");
      pill.setAttribute("font-weight", "700"); pill.setAttribute("fill", sc.fg); pill.setAttribute("text-anchor", "end");
      pill.textContent = SCOPE_LABELS[item.scope].toUpperCase(); svgRoot.appendChild(pill);
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
    const pOrder = snap.priorityOrder || [];
    const STATUS_SCOPE = { risk: "in", planned: "stretch", gap: "out" };
    const entries = [];
    for (const [path, status] of Object.entries(ann)) {
      if (!STATUS_SCOPE[status]) continue;
      const parts = path.split("|");
      const name = parts[parts.length - 1];
      const group = parts.length >= 3 ? parts[parts.length - 2] : "";
      const pillar = parts.length >= 2 ? parts[1] : "";
      const rank = pOrder.indexOf(path);
      entries.push({ path, name, group, pillar, status, scope: STATUS_SCOPE[status], rank: rank >= 0 ? rank : 9999 });
    }
    entries.sort((a, b) => a.rank - b.rank);
    if (!entries.length) { alert("No risk, planned, or gap items found in this OMA snapshot."); return; }
    const cols = { in: [], stretch: [], out: [] };
    entries.forEach(e => cols[e.scope].push(e));
    STATE = { items: [], connections: [], view: { x: 0, y: 0, scale: 1 }, nextId: 1 };
    const colX = { in: 80, stretch: 360, out: 640 };
    for (const [scope, list] of Object.entries(cols)) {
      list.forEach((e, i) => {
        STATE.items.push({
          id: STATE.nextId++, label: e.name, scope,
          description: [e.pillar, e.group].filter(Boolean).join(" › "),
          needsSubMap: false, subMapName: "",
          x: snapToGrid(colX[scope]), y: snapToGrid(60 + i * 100),
        });
      });
    }
    saveState(); renderApp();
  }

  function clearAll() {
    if (!confirm("Clear all items and connections? This cannot be undone.")) return;
    pushUndo();
    STATE = { items: [], connections: [], view: { x: 0, y: 0, scale: 1 }, nextId: 1 };
    saveState(); renderApp();
  }

  /* ── Helpers ── */
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  window._rm = {
    openModal, removeItem, duplicateItem, exportJSON, exportPNG, importJSON,
    clearAll, zoomTo, resetView, openSubMap, loadSample, undo, redo,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
