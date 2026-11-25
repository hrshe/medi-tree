/**
 * Shared flowchart engine for both Volunteer Map and Admin Drag-and-Drop Studio.
 */

export const NODE_WIDTH = 244;
export const NODE_HEIGHT = 104;

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getOutgoingEdges(tree, nodeId) {
  return (tree?.edges || [])
    .filter((e) => e.source === nodeId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function validateTreeGraph(tree) {
  const issues = [];
  const nodes = tree?.nodes || [];
  const edges = tree?.edges || [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  if (!tree?.title?.trim()) {
    issues.push({ level: "error", message: "Tree title is empty." });
  }
  if (!tree?.rootNodeId || !nodeMap.has(tree.rootNodeId)) {
    issues.push({ level: "error", message: "No valid Start Node is selected." });
    return issues;
  }

  // BFS reachability from rootNodeId
  const reachable = new Set();
  const queue = [tree.rootNodeId];
  while (queue.length > 0) {
    const curr = queue.shift();
    if (reachable.has(curr)) continue;
    reachable.add(curr);
    for (const edge of edges) {
      if (edge.source === curr && nodeMap.has(edge.target) && !reachable.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      issues.push({
        level: "warn",
        nodeId: node.id,
        message: `Unreachable node: "${node.title || node.id}"`,
      });
    }
    const out = edges.filter((e) => e.source === node.id);
    if (node.type === "question" && out.length === 0) {
      issues.push({
        level: "warn",
        nodeId: node.id,
        message: `Question "${node.title || node.id}" has no outgoing branches.`,
      });
    }
  }

  return issues;
}

/**
 * Compute a clean top-down hierarchical layout using BFS levels from rootNodeId.
 */
export function computeAutoLayout(tree) {
  const nodes = tree?.nodes || [];
  const edges = tree?.edges || [];
  if (nodes.length === 0) return;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const rootId = nodeMap.has(tree.rootNodeId) ? tree.rootNodeId : nodes[0].id;

  const levels = new Map();
  const visited = new Set();
  const queue = [{ id: rootId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    levels.set(id, depth);

    const out = getOutgoingEdges(tree, id);
    for (const edge of out) {
      if (nodeMap.has(edge.target) && !visited.has(edge.target)) {
        queue.push({ id: edge.target, depth: depth + 1 });
      }
    }
  }

  // Place disconnected nodes below the deepest level
  let maxDepth = 0;
  for (const d of levels.values()) {
    if (d > maxDepth) maxDepth = d;
  }
  for (const node of nodes) {
    if (!levels.has(node.id)) {
      maxDepth += 1;
      levels.set(node.id, maxDepth);
    }
  }

  const byDepth = new Map();
  for (const node of nodes) {
    const d = levels.get(node.id);
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(node);
  }

  const xGap = 300;
  const yGap = 210;
  let maxCount = 1;
  for (const group of byDepth.values()) {
    if (group.length > maxCount) maxCount = group.length;
  }
  const totalWidth = maxCount * xGap;

  for (const [depth, group] of byDepth.entries()) {
    const groupWidth = group.length * xGap;
    const startX = Math.max(40, (totalWidth - groupWidth) / 2 + 40);
    group.forEach((node, idx) => {
      node.position = {
        x: Math.round(startX + idx * xGap),
        y: Math.round(40 + depth * yGap),
      };
    });
  }
}

function buildCubicPath(x1, y1, x2, y2) {
  const dy = Math.abs(y2 - y1);
  const offset = Math.max(48, Math.min(140, dy * 0.55));
  const c1y = y1 + offset;
  const c2y = y2 - offset;
  const path = `M ${x1} ${y1} C ${x1} ${c1y}, ${x2} ${c2y}, ${x2} ${y2}`;
  // Midpoint on cubic bezier at t = 0.5
  const midX = 0.125 * x1 + 0.375 * x1 + 0.375 * x2 + 0.125 * x2;
  const midY = 0.125 * y1 + 0.375 * c1y + 0.375 * c2y + 0.125 * y2;
  return { path, midX, midY };
}

/**
 * Generate a standalone SVG graphic of the decision tree for export.
 */
export function exportTreeAsSvg(tree) {
  const nodes = tree?.nodes || [];
  const edges = tree?.edges || [];
  if (nodes.length === 0) return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

  const pad = 60;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const x = n.position?.x ?? 0;
    const y = n.position?.y ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + NODE_WIDTH);
    maxY = Math.max(maxY, y + NODE_HEIGHT);
  }
  const width = Math.max(400, maxX - minX + pad * 2);
  const height = Math.max(300, maxY - minY + pad * 2);
  const ox = -minX + pad;
  const oy = -minY + pad;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const levelStroke = {
    urgent: "#dc2626",
    action: "#059669",
    referral: "#2563eb",
    info: "#d97706",
  };

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, Arial, sans-serif">\n`;
  svg += `<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b"/></marker></defs>\n`;
  svg += `<rect width="100%" height="100%" fill="#f8fafc"/>\n`;

  for (const edge of edges) {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (!src || !tgt) continue;
    const x1 = (src.position?.x ?? 0) + ox + NODE_WIDTH / 2;
    const y1 = (src.position?.y ?? 0) + oy + NODE_HEIGHT;
    const x2 = (tgt.position?.x ?? 0) + ox + NODE_WIDTH / 2;
    const y2 = (tgt.position?.y ?? 0) + oy;
    const { path, midX, midY } = buildCubicPath(x1, y1, x2, y2);
    svg += `<path d="${path}" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#arrow)"/>\n`;
    const lbl = escapeHtml((edge.label || "").slice(0, 32));
    const pillW = Math.max(60, lbl.length * 6.5 + 18);
    svg += `<rect x="${midX - pillW / 2}" y="${midY - 11}" width="${pillW}" height="22" rx="11" fill="#ffffff" stroke="#cbd5e1"/>\n`;
    svg += `<text x="${midX}" y="${midY + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="#334155">${lbl}</text>\n`;
  }

  for (const node of nodes) {
    const x = (node.position?.x ?? 0) + ox;
    const y = (node.position?.y ?? 0) + oy;
    const topColor = node.type === "outcome" ? levelStroke[node.outcomeLevel] || "#059669" : "#0d9488";
    const title = escapeHtml((node.title || "").slice(0, 30));
    const kind = node.type === "outcome" ? `OUTCOME (${(node.outcomeLevel || "action").toUpperCase()})` : "QUESTION";
    svg += `<g>\n`;
    svg += `<rect x="${x}" y="${y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>\n`;
    svg += `<rect x="${x}" y="${y}" width="${NODE_WIDTH}" height="6" rx="3" fill="${topColor}"/>\n`;
    svg += `<text x="${x + 14}" y="${y + 26}" font-size="10" font-weight="700" fill="#64748b">${escapeHtml(kind)}</text>\n`;
    svg += `<text x="${x + 14}" y="${y + 48}" font-size="13.5" font-weight="700" fill="#0f172a">${title}</text>\n`;
    const preview = escapeHtml((node.prompt || "").slice(0, 38));
    svg += `<text x="${x + 14}" y="${y + 70}" font-size="11" fill="#64748b">${preview}</text>\n`;
    svg += `</g>\n`;
  }

  svg += `</svg>\n`;
  return svg;
}

/**
 * Interactive Pan/Zoom + Drag-and-Drop Flowchart Canvas.
 */
export class FlowGraphCanvas {
  constructor(viewportEl, options = {}) {
    this.viewportEl = viewportEl;
    this.editable = Boolean(options.editable);
    this.snapGrid = options.snapGrid ?? 10;
    this.onSelectNode = options.onSelectNode || (() => {});
    this.onSelectEdge = options.onSelectEdge || (() => {});
    this.onDeselect = options.onDeselect || (() => {});
    this.onMoveNode = options.onMoveNode || (() => {});
    this.onConnectNodes = options.onConnectNodes || (() => {});
    this.onDropNewNode = options.onDropNewNode || (() => {});

    this.tree = null;
    this.state = {
      selectedNodeId: null,
      selectedEdgeId: null,
      activeNodeId: null,
      visitedNodeIds: new Set(),
      traversedEdgeIds: new Set(),
      dimUnvisited: false,
    };

    this.transform = { x: 40, y: 30, scale: 1 };
    this.nodeElements = new Map();

    this._buildDom();
    this._bindViewportEvents();
  }

  _buildDom() {
    this.viewportEl.innerHTML = "";

    this.stageEl = document.createElement("div");
    this.stageEl.className = "graph-stage";

    this.svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svgEl.setAttribute("class", "graph-edges-svg");
    this.svgEl.setAttribute("width", "4000");
    this.svgEl.setAttribute("height", "4000");

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
      <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8"></path>
      </marker>
      <marker id="flow-arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#0d9488"></path>
      </marker>
    `;
    this.svgEl.appendChild(defs);

    this.edgesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.draftLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
    this.draftLine.setAttribute("class", "edge-draft-line hidden");
    this.svgEl.appendChild(this.edgesGroup);
    this.svgEl.appendChild(this.draftLine);

    this.edgeLabelsEl = document.createElement("div");
    this.nodesLayerEl = document.createElement("div");

    this.stageEl.appendChild(this.svgEl);
    this.stageEl.appendChild(this.edgeLabelsEl);
    this.stageEl.appendChild(this.nodesLayerEl);
    this.viewportEl.appendChild(this.stageEl);

    this._applyTransform();
  }

  _applyTransform() {
    const { x, y, scale } = this.transform;
    this.stageEl.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.viewportEl.style.backgroundPosition = `${x}px ${y}px`;
    const gridPx = Math.max(10, 22 * scale);
    this.viewportEl.style.backgroundSize = `${gridPx}px ${gridPx}px`;
  }

  screenToGraph(clientX, clientY) {
    const rect = this.viewportEl.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.transform.x) / this.transform.scale,
      y: (clientY - rect.top - this.transform.y) / this.transform.scale,
    };
  }

  setZoom(nextScale, anchorClientX = null, anchorClientY = null) {
    const clamped = Math.min(1.8, Math.max(0.18, nextScale));
    const rect = this.viewportEl.getBoundingClientRect();
    const cx = anchorClientX ?? rect.left + rect.width / 2;
    const cy = anchorClientY ?? rect.top + rect.height / 2;
    const gx = (cx - rect.left - this.transform.x) / this.transform.scale;
    const gy = (cy - rect.top - this.transform.y) / this.transform.scale;

    this.transform.scale = clamped;
    this.transform.x = cx - rect.left - gx * clamped;
    this.transform.y = cy - rect.top - gy * clamped;
    this._applyTransform();
  }

  fitToView() {
    const nodes = this.tree?.nodes || [];
    if (nodes.length === 0) return;
    const rect = this.viewportEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const x = n.position?.x ?? 0;
      const y = n.position?.y ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + NODE_WIDTH);
      maxY = Math.max(maxY, y + NODE_HEIGHT);
    }

    const padX = rect.width < 520 ? 28 : 52;
    const padTop = 64;
    const padBottom = 80;
    const contentW = maxX - minX + padX * 2;
    const contentH = maxY - minY + padTop + padBottom;
    const scale = Math.min(1.05, Math.max(0.18, Math.min(rect.width / contentW, rect.height / contentH)));
    this.transform.scale = scale;
    this.transform.x = (rect.width - contentW * scale) / 2 - (minX - padX) * scale;
    this.transform.y = (rect.height - contentH * scale) / 2 - (minY - padTop) * scale;
    this._applyTransform();
  }

  centerOnNode(nodeId) {
    const node = (this.tree?.nodes || []).find((n) => n.id === nodeId);
    if (!node) return;
    const rect = this.viewportEl.getBoundingClientRect();
    const x1 = (node.position?.x ?? 0) * this.transform.scale + this.transform.x;
    const y1 = (node.position?.y ?? 0) * this.transform.scale + this.transform.y;
    const x2 = x1 + NODE_WIDTH * this.transform.scale;
    const y2 = y1 + NODE_HEIGHT * this.transform.scale;
    if (x1 >= 16 && x2 <= rect.width - 16 && y1 >= 44 && y2 <= rect.height - 64) {
      return;
    }
    const nx = (node.position?.x ?? 0) + NODE_WIDTH / 2;
    const ny = (node.position?.y ?? 0) + NODE_HEIGHT / 2;
    this.transform.x = rect.width / 2 - nx * this.transform.scale;
    this.transform.y = rect.height / 2 - ny * this.transform.scale;
    this._applyTransform();
  }

  setData(tree, viewState = {}) {
    this.tree = tree;
    this.state = {
      selectedNodeId: viewState.selectedNodeId ?? null,
      selectedEdgeId: viewState.selectedEdgeId ?? null,
      activeNodeId: viewState.activeNodeId ?? null,
      visitedNodeIds: new Set(viewState.visitedNodeIds || []),
      traversedEdgeIds: new Set(viewState.traversedEdgeIds || []),
      dimUnvisited: Boolean(viewState.dimUnvisited),
    };
    this.render();
  }

  render() {
    if (!this.tree) return;
    this._renderNodes();
    this._renderEdges();
  }

  _renderNodes() {
    this.nodesLayerEl.innerHTML = "";
    this.nodeElements.clear();

    for (const node of this.tree.nodes || []) {
      const el = document.createElement("div");
      const classes = ["flow-node"];
      if (node.type === "outcome") {
        classes.push(`node-outcome-${node.outcomeLevel || "action"}`);
      } else {
        classes.push("node-question");
      }

      const isSelected = node.id === this.state.selectedNodeId;
      const isActive = node.id === this.state.activeNodeId;
      const isVisited = this.state.visitedNodeIds.has(node.id);

      if (isSelected) classes.push("selected");
      if (isActive) classes.push("active-step");
      else if (isVisited) classes.push("visited-step");
      else if (this.state.dimUnvisited) classes.push("dimmed");

      el.className = classes.join(" ");
      el.dataset.nodeId = node.id;
      el.style.left = `${node.position?.x ?? 0}px`;
      el.style.top = `${node.position?.y ?? 0}px`;

      const kindLabel =
        node.type === "outcome"
          ? `Outcome · ${(node.outcomeLevel || "action").toUpperCase()}`
          : "Question";
      const isRoot = node.id === this.tree.rootNodeId;

      el.innerHTML = `
        <div class="flow-node-top">
          <span class="node-kind-badge">${escapeHtml(kindLabel)}</span>
          ${isRoot ? '<span class="node-start-badge">Start</span>' : ""}
        </div>
        <div class="flow-node-title">${escapeHtml(node.title || "Untitled")}</div>
        <div class="flow-node-preview">${escapeHtml(node.prompt || "Click to inspect")}</div>
      `;

      if (this.editable) {
        const inPort = document.createElement("div");
        inPort.className = "node-port node-port-in";
        inPort.title = "Drop connection here";
        inPort.dataset.portIn = node.id;
        el.appendChild(inPort);

        if (node.type === "question") {
          const outPort = document.createElement("div");
          outPort.className = "node-port node-port-out";
          outPort.title = "Drag to connect a new branch";
          outPort.textContent = "+";
          outPort.addEventListener("pointerdown", (ev) => {
            ev.stopPropagation();
            this._startConnectionDrag(ev, node.id);
          });
          el.appendChild(outPort);
        }
      }

      el.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        if (this.editable) {
          this._startNodeDrag(ev, node, el);
        } else {
          this.onSelectNode(node.id);
        }
      });

      this.nodesLayerEl.appendChild(el);
      this.nodeElements.set(node.id, el);
    }
  }

  _renderEdges() {
    this.edgesGroup.innerHTML = "";
    this.edgeLabelsEl.innerHTML = "";

    const nodeMap = new Map((this.tree.nodes || []).map((n) => [n.id, n]));

    for (const edge of this.tree.edges || []) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) continue;

      const x1 = (src.position?.x ?? 0) + NODE_WIDTH / 2;
      const y1 = (src.position?.y ?? 0) + (this.nodeElements.get(src.id)?.offsetHeight || NODE_HEIGHT);
      const x2 = (tgt.position?.x ?? 0) + NODE_WIDTH / 2;
      const y2 = tgt.position?.y ?? 0;

      const { path, midX, midY } = buildCubicPath(x1, y1, x2, y2);

      const isTraversed = this.state.traversedEdgeIds.has(edge.id);
      const isSelected = edge.id === this.state.selectedEdgeId;

      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", path);
      hit.setAttribute("class", "edge-hit-path");
      hit.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        this.onSelectEdge(edge.id);
      });

      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const lineClasses = ["edge-line"];
      if (isTraversed) lineClasses.push("traversed");
      if (isSelected) lineClasses.push("selected");
      if (this.state.dimUnvisited && !isTraversed) lineClasses.push("dimmed");
      line.setAttribute("d", path);
      line.setAttribute("class", lineClasses.join(" "));
      line.setAttribute("marker-end", isTraversed || isSelected ? "url(#flow-arrow-active)" : "url(#flow-arrow)");

      this.edgesGroup.appendChild(line);
      this.edgesGroup.appendChild(hit);

      const labelEl = document.createElement("button");
      labelEl.type = "button";
      const pillClasses = ["edge-label-pill"];
      if (isTraversed) pillClasses.push("traversed");
      if (isSelected) pillClasses.push("selected");
      if (this.state.dimUnvisited && !isTraversed) pillClasses.push("dimmed");
      labelEl.className = pillClasses.join(" ");
      labelEl.style.left = `${midX}px`;
      labelEl.style.top = `${midY}px`;
      labelEl.textContent = edge.label || "Next";
      labelEl.title = edge.label || "Next";
      labelEl.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        this.onSelectEdge(edge.id);
      });
      this.edgeLabelsEl.appendChild(labelEl);
    }
  }

  _startNodeDrag(ev, node, el) {
    const startPt = this.screenToGraph(ev.clientX, ev.clientY);
    const origX = node.position?.x ?? 0;
    const origY = node.position?.y ?? 0;
    let moved = false;

    const onMove = (moveEv) => {
      const pt = this.screenToGraph(moveEv.clientX, moveEv.clientY);
      const dx = pt.x - startPt.x;
      const dy = pt.y - startPt.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      if (!moved) return;

      const snap = this.snapGrid;
      const nextX = Math.round((origX + dx) / snap) * snap;
      const nextY = Math.round((origY + dy) / snap) * snap;
      node.position = { x: nextX, y: nextY };
      el.style.left = `${nextX}px`;
      el.style.top = `${nextY}px`;
      this._renderEdges();
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        this.onMoveNode(node.id, node.position);
      }
      this.onSelectNode(node.id);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  _startConnectionDrag(ev, sourceNodeId) {
    const srcEl = this.nodeElements.get(sourceNodeId);
    const srcNode = (this.tree?.nodes || []).find((n) => n.id === sourceNodeId);
    if (!srcNode || !srcEl) return;

    const x1 = (srcNode.position?.x ?? 0) + NODE_WIDTH / 2;
    const y1 = (srcNode.position?.y ?? 0) + (srcEl.offsetHeight || NODE_HEIGHT);
    this.draftLine.classList.remove("hidden");

    let hoveredTargetId = null;

    const updateTargetHighlight = (clientX, clientY) => {
      this.viewportEl.querySelectorAll(".node-port-in.drop-target").forEach((p) => p.classList.remove("drop-target"));
      hoveredTargetId = null;
      const under = document.elementFromPoint(clientX, clientY);
      const nodeCard = under?.closest?.(".flow-node");
      if (nodeCard && nodeCard.dataset.nodeId && nodeCard.dataset.nodeId !== sourceNodeId) {
        hoveredTargetId = nodeCard.dataset.nodeId;
        const port = nodeCard.querySelector(".node-port-in");
        if (port) port.classList.add("drop-target");
      }
    };

    const onMove = (moveEv) => {
      const pt = this.screenToGraph(moveEv.clientX, moveEv.clientY);
      const { path } = buildCubicPath(x1, y1, pt.x, pt.y);
      this.draftLine.setAttribute("d", path);
      updateTargetHighlight(moveEv.clientX, moveEv.clientY);
    };

    const onUp = (upEv) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      this.draftLine.classList.add("hidden");
      this.viewportEl.querySelectorAll(".node-port-in.drop-target").forEach((p) => p.classList.remove("drop-target"));
      if (hoveredTargetId) {
        this.onConnectNodes(sourceNodeId, hoveredTargetId);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  _bindViewportEvents() {
    this.viewportEl.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 && ev.button !== 1) return;
      const startX = ev.clientX;
      const startY = ev.clientY;
      const origTx = this.transform.x;
      const origTy = this.transform.y;
      let panned = false;

      this.viewportEl.classList.add("panning");

      const onMove = (moveEv) => {
        const dx = moveEv.clientX - startX;
        const dy = moveEv.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panned = true;
        this.transform.x = origTx + dx;
        this.transform.y = origTy + dy;
        this._applyTransform();
      };

      const onUp = () => {
        this.viewportEl.classList.remove("panning");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (!panned) {
          this.onDeselect();
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    this.viewportEl.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? 1.09 : 0.91;
        this.setZoom(this.transform.scale * factor, ev.clientX, ev.clientY);
      },
      { passive: false }
    );

    if (this.editable) {
      this.viewportEl.addEventListener("dragover", (ev) => {
        ev.preventDefault();
      });
      this.viewportEl.addEventListener("drop", (ev) => {
        ev.preventDefault();
        const kind = ev.dataTransfer?.getData("application/x-medinetz-node-type");
        if (!kind) return;
        const pt = this.screenToGraph(ev.clientX, ev.clientY);
        this.onDropNewNode(kind, {
          x: Math.round((pt.x - NODE_WIDTH / 2) / this.snapGrid) * this.snapGrid,
          y: Math.round((pt.y - NODE_HEIGHT / 2) / this.snapGrid) * this.snapGrid,
        });
      });
    }
  }
}
