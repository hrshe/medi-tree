import {
  FlowGraphCanvas,
  escapeHtml,
  getOutgoingEdges,
} from "/static/graph-core.js";

const mainEl = document.getElementById("volunteer-main");
const titleEl = document.getElementById("tree-title");
const descEl = document.getElementById("tree-description");
const versionEl = document.getElementById("tree-version");
const breadcrumbsEl = document.getElementById("breadcrumbs");
const stepContainerEl = document.getElementById("step-container");
const graphViewportEl = document.getElementById("volunteer-graph");

let tree = null;
// Ephemeral in-memory navigation stack: [{ nodeId, viaEdgeId, viaLabel }]
let historyStack = [];
let checkedItems = new Set();

const canvas = new FlowGraphCanvas(graphViewportEl, {
  editable: false,
  onSelectNode: (nodeId) => jumpToNode(nodeId),
  onSelectEdge: (edgeId) => {
    const edge = (tree?.edges || []).find((e) => e.id === edgeId);
    if (!edge) return;
    const current = currentStep();
    if (current && edge.source === current.nodeId) {
      chooseEdge(edge);
    } else {
      jumpToNode(edge.target);
    }
  },
});

function getNode(nodeId) {
  return (tree?.nodes || []).find((n) => n.id === nodeId) || null;
}

function currentStep() {
  return historyStack[historyStack.length - 1] || null;
}

function resetSession() {
  if (!tree) return;
  const root = getNode(tree.rootNodeId) || tree.nodes[0];
  historyStack = root ? [{ nodeId: root.id, viaEdgeId: null, viaLabel: null }] : [];
  checkedItems = new Set();
  renderAll();
  if (root) {
    canvas.fitToView();
  }
}

function chooseEdge(edge) {
  if (!getNode(edge.target)) return;
  historyStack.push({
    nodeId: edge.target,
    viaEdgeId: edge.id,
    viaLabel: edge.label,
  });
  checkedItems = new Set();
  renderAll();
}

function goBack() {
  if (historyStack.length <= 1) return;
  historyStack.pop();
  checkedItems = new Set();
  renderAll();
}

function rewindToIndex(index) {
  if (index < 0 || index >= historyStack.length) return;
  historyStack = historyStack.slice(0, index + 1);
  checkedItems = new Set();
  renderAll();
}

function findPathFromRoot(targetNodeId) {
  if (!tree) return null;
  const startId = tree.rootNodeId;
  if (startId === targetNodeId) {
    return [{ nodeId: startId, viaEdgeId: null, viaLabel: null }];
  }
  const queue = [[{ nodeId: startId, viaEdgeId: null, viaLabel: null }]];
  const visited = new Set([startId]);

  while (queue.length > 0) {
    const path = queue.shift();
    const last = path[path.length - 1];
    for (const edge of getOutgoingEdges(tree, last.nodeId)) {
      if (visited.has(edge.target)) continue;
      const nextPath = [...path, { nodeId: edge.target, viaEdgeId: edge.id, viaLabel: edge.label }];
      if (edge.target === targetNodeId) return nextPath;
      visited.add(edge.target);
      queue.push(nextPath);
    }
  }
  return null;
}

function jumpToNode(nodeId) {
  const existingIdx = historyStack.findIndex((s) => s.nodeId === nodeId);
  if (existingIdx !== -1) {
    rewindToIndex(existingIdx);
    return;
  }
  const curr = currentStep();
  if (curr) {
    const directEdge = getOutgoingEdges(tree, curr.nodeId).find((e) => e.target === nodeId);
    if (directEdge) {
      chooseEdge(directEdge);
      return;
    }
  }
  const path = findPathFromRoot(nodeId);
  if (path) {
    historyStack = path;
  } else {
    historyStack = [{ nodeId, viaEdgeId: null, viaLabel: null }];
  }
  checkedItems = new Set();
  renderAll();
}

function renderBreadcrumbs() {
  breadcrumbsEl.innerHTML = "";
  historyStack.forEach((step, idx) => {
    const node = getNode(step.nodeId);
    if (!node) return;

    if (idx > 0) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "›";
      breadcrumbsEl.appendChild(sep);
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = idx === historyStack.length - 1 ? "crumb current" : "crumb";
    btn.textContent = node.title || `Step ${idx + 1}`;
    btn.title = step.viaLabel ? `Via: ${step.viaLabel}` : "Start";
    btn.addEventListener("click", () => rewindToIndex(idx));
    breadcrumbsEl.appendChild(btn);
  });
}

function renderStepCard() {
  const step = currentStep();
  const node = step ? getNode(step.nodeId) : null;

  if (!node) {
    stepContainerEl.innerHTML = `<div class="step-card"><p>No published decision tree is available yet.</p></div>`;
    return;
  }

  const outgoing = getOutgoingEdges(tree, node.id);
  const isOutcome = node.type === "outcome" || outgoing.length === 0;
  const level = node.outcomeLevel || "action";

  const tagClass = isOutcome ? `step-tag outcome-${escapeHtml(level)}` : "step-tag";
  const tagText = isOutcome
    ? `Recommended Outcome · ${escapeHtml(level)}`
    : `Step ${historyStack.length} · Decision Question`;

  let html = `
    <article class="step-card">
      <div class="step-meta">
        <span class="${tagClass}">${tagText}</span>
        ${step.viaLabel ? `<span class="pill">Choice: ${escapeHtml(step.viaLabel)}</span>` : ""}
      </div>
      <h1 class="step-title">${escapeHtml(node.title || "Untitled Step")}</h1>
      ${node.prompt ? `<p class="step-prompt">${escapeHtml(node.prompt)}</p>` : ""}
      ${
        node.guidance
          ? `<div class="guidance-box"><strong>Volunteer Guidance</strong>${escapeHtml(node.guidance)}</div>`
          : ""
      }
  `;

  if (node.type === "outcome" && Array.isArray(node.checklist) && node.checklist.length > 0) {
    html += `<div class="checklist" id="outcome-checklist">`;
    node.checklist.forEach((item, idx) => {
      const isChecked = checkedItems.has(idx);
      html += `
        <label class="checklist-item ${isChecked ? "checked" : ""}">
          <input type="checkbox" data-check-idx="${idx}" ${isChecked ? "checked" : ""} />
          <span>${escapeHtml(item)}</span>
        </label>
      `;
    });
    html += `</div>`;
  }

  if (outgoing.length > 0) {
    html += `<div class="options-list">`;
    outgoing.forEach((edge, idx) => {
      html += `
        <button type="button" class="option-btn" data-edge-id="${escapeHtml(edge.id)}">
          <span class="option-left">
            <span class="option-num">${idx + 1}</span>
            <span class="option-label">${escapeHtml(edge.label)}</span>
          </span>
          <span class="option-arrow" aria-hidden="true">→</span>
        </button>
      `;
    });
    html += `</div>`;
  } else if (node.type === "question") {
    html += `<div class="alert alert-warn">No outgoing branches are configured for this question yet.</div>`;
  }

  html += `
      <div class="step-footer">
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn btn-sm" id="btn-step-back" ${historyStack.length <= 1 ? "disabled" : ""}>
            ← Back
          </button>
          <button type="button" class="btn btn-soft btn-sm" id="btn-step-reset">
            Start New Case
          </button>
        </div>
        <span class="kbd-hint">${outgoing.length > 0 ? "Keys: 1–9 to pick · Backspace" : "R to start new case"}</span>
      </div>
    </article>
  `;

  stepContainerEl.innerHTML = html;

  stepContainerEl.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const edge = outgoing.find((e) => e.id === btn.dataset.edgeId);
      if (edge) chooseEdge(edge);
    });
  });

  stepContainerEl.querySelectorAll('input[type="checkbox"][data-check-idx]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = Number(cb.dataset.checkIdx);
      if (cb.checked) checkedItems.add(idx);
      else checkedItems.delete(idx);
      cb.closest(".checklist-item")?.classList.toggle("checked", cb.checked);
    });
  });

  document.getElementById("btn-step-back")?.addEventListener("click", goBack);
  document.getElementById("btn-step-reset")?.addEventListener("click", resetSession);
}

function renderMap() {
  if (!tree) return;
  const activeNodeId = currentStep()?.nodeId || null;
  const visitedNodeIds = historyStack.map((s) => s.nodeId);
  const traversedEdgeIds = historyStack.map((s) => s.viaEdgeId).filter(Boolean);
  canvas.setData(tree, {
    activeNodeId,
    visitedNodeIds,
    traversedEdgeIds,
    dimUnvisited: historyStack.length > 1,
  });
}

function renderAll() {
  renderBreadcrumbs();
  renderStepCard();
  renderMap();
}

function setViewMode(mode) {
  mainEl.classList.remove("mode-split", "mode-wizard", "mode-map");
  mainEl.classList.add(`mode-${mode}`);
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === mode);
  });
  if (mode !== "wizard") {
    requestAnimationFrame(() => canvas.fitToView());
  }
}

document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => setViewMode(btn.dataset.view));
});

document.getElementById("btn-restart").addEventListener("click", resetSession);
document.getElementById("btn-zoom-in").addEventListener("click", () => canvas.setZoom(canvas.transform.scale * 1.15));
document.getElementById("btn-zoom-out").addEventListener("click", () => canvas.setZoom(canvas.transform.scale * 0.85));
document.getElementById("btn-fit").addEventListener("click", () => canvas.fitToView());

window.addEventListener("keydown", (ev) => {
  if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA") return;
  const step = currentStep();
  if (!step) return;
  if (ev.key === "Backspace") {
    ev.preventDefault();
    goBack();
    return;
  }
  if (ev.key === "r" || ev.key === "R") {
    resetSession();
    return;
  }
  const num = Number(ev.key);
  if (num >= 1 && num <= 9) {
    const outgoing = getOutgoingEdges(tree, step.nodeId);
    if (outgoing[num - 1]) {
      chooseEdge(outgoing[num - 1]);
    }
  }
});

async function init() {
  if (window.matchMedia("(max-width: 768px)").matches) {
    setViewMode("wizard");
  }
  try {
    const res = await fetch("/api/tree/published");
    if (!res.ok) throw new Error("Failed to load flowchart");
    const data = await res.json();
    tree = data.tree;
    titleEl.textContent = tree.title || "Medinetz Decision Guide";
    descEl.textContent = tree.description || "Case-by-case static guidance for Medinetz volunteers";
    versionEl.textContent = `v${data.version ?? 1}`;
    resetSession();
  } catch (err) {
    stepContainerEl.innerHTML = `<div class="alert alert-error">Could not load the decision tree: ${escapeHtml(err.message)}</div>`;
  }
}

init();
