import {
  FlowGraphCanvas,
  NODE_HEIGHT,
  NODE_WIDTH,
  computeAutoLayout,
  escapeHtml,
  exportTreeAsSvg,
  getOutgoingEdges,
  validateTreeGraph,
} from "/static/graph-core.js";

const loginScreenEl = document.getElementById("login-screen");
const loginFormEl = document.getElementById("login-form");
const loginErrorEl = document.getElementById("login-error");
const loginTopbarActionsEl = document.getElementById("login-topbar-actions");

const adminWorkspaceEl = document.getElementById("admin-workspace");
const mobileAdminTabsEl = document.getElementById("mobile-admin-tabs");
const adminToolbarEl = document.getElementById("admin-toolbar");
const adminSubtitleEl = document.getElementById("admin-subtitle");
const statusPillEl = document.getElementById("publish-status-pill");

const graphViewportEl = document.getElementById("admin-graph");
const inspectorEl = document.getElementById("inspector-panel");
const nodeOutlineEl = document.getElementById("node-outline");
const nodeCountEl = document.getElementById("node-count");
const nodeSearchEl = document.getElementById("node-search");
const toastEl = document.getElementById("toast");

const accountModalEl = document.getElementById("account-modal");
const accountUsernameEl = document.getElementById("account-username");
const passwordFormEl = document.getElementById("password-form");
const passwordFeedbackEl = document.getElementById("password-feedback");

let currentAdmin = null;
let tree = null;
let serverMeta = { draftVersion: 1, publishedVersion: 1, hasUnpublishedChanges: false };
let hasUnsavedEdits = false;
let selectedNodeId = null;
let selectedEdgeId = null;
let toastTimer = null;

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

const canvas = new FlowGraphCanvas(graphViewportEl, {
  editable: true,
  onSelectNode: (nodeId) => {
    selectedNodeId = nodeId;
    selectedEdgeId = null;
    syncCanvas();
    renderOutline();
    renderInspector();
  },
  onSelectEdge: (edgeId) => {
    selectedEdgeId = edgeId;
    selectedNodeId = null;
    syncCanvas();
    renderOutline();
    renderInspector();
  },
  onDeselect: () => {
    selectedNodeId = null;
    selectedEdgeId = null;
    syncCanvas();
    renderOutline();
    renderInspector();
  },
  onMoveNode: () => {
    markDirty();
  },
  onConnectNodes: (sourceId, targetId) => {
    createEdge(sourceId, targetId, "Option");
  },
  onDropNewNode: (kind, pos) => {
    createNode(kind, pos);
  },
});

function markDirty() {
  hasUnsavedEdits = true;
  updateStatusPill();
}

function updateStatusPill() {
  statusPillEl.classList.remove("hidden", "pill-warning", "pill-success");
  if (hasUnsavedEdits) {
    statusPillEl.textContent = "Unsaved Edits";
    statusPillEl.classList.add("pill-warning");
  } else if (serverMeta.hasUnpublishedChanges) {
    statusPillEl.textContent = `Draft v${serverMeta.draftVersion} (Unpublished)`;
    statusPillEl.classList.add("pill-warning");
  } else {
    statusPillEl.textContent = `Published v${serverMeta.publishedVersion}`;
    statusPillEl.classList.add("pill-success");
  }
}

function syncCanvas() {
  if (!tree) return;
  canvas.setData(tree, {
    selectedNodeId,
    selectedEdgeId,
  });
}

function getNode(id) {
  return (tree?.nodes || []).find((n) => n.id === id) || null;
}

function getEdge(id) {
  return (tree?.edges || []).find((e) => e.id === id) || null;
}

function createNode(kind = "question", position = null) {
  if (!tree) return null;
  let pos = position;
  if (!pos) {
    const rect = graphViewportEl.getBoundingClientRect();
    const center = canvas.screenToGraph(rect.left + rect.width / 2, rect.top + rect.height / 2);
    pos = {
      x: Math.round((center.x - NODE_WIDTH / 2) / 10) * 10,
      y: Math.round((center.y - NODE_HEIGHT / 2) / 10) * 10,
    };
  }
  const isOutcome = kind === "outcome";
  const node = {
    id: uid("n"),
    type: isOutcome ? "outcome" : "question",
    title: isOutcome ? "New Outcome" : "New Question",
    prompt: isOutcome
      ? "Describe the recommended action for the volunteer."
      : "Enter the question the volunteer should ask or assess.",
    guidance: "",
    outcomeLevel: "action",
    checklist: isOutcome ? ["Follow Medinetz anonymous voucher protocol"] : [],
    position: pos,
  };
  tree.nodes.push(node);
  if (!tree.rootNodeId) tree.rootNodeId = node.id;
  selectedNodeId = node.id;
  selectedEdgeId = null;
  markDirty();
  syncCanvas();
  renderOutline();
  renderInspector();
  return node;
}

function createEdge(sourceId, targetId, label = "New option") {
  if (!tree || sourceId === targetId) return null;
  const existing = getOutgoingEdges(tree, sourceId);
  const edge = {
    id: uid("e"),
    source: sourceId,
    target: targetId,
    label,
    order: existing.length + 1,
  };
  tree.edges.push(edge);
  selectedEdgeId = edge.id;
  selectedNodeId = null;
  markDirty();
  syncCanvas();
  renderOutline();
  renderInspector();
  return edge;
}

function deleteNode(nodeId) {
  if (!tree) return;
  if (tree.nodes.length <= 1) {
    showToast("At least one node must remain in the tree.");
    return;
  }
  tree.nodes = tree.nodes.filter((n) => n.id !== nodeId);
  tree.edges = tree.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  if (tree.rootNodeId === nodeId) {
    tree.rootNodeId = tree.nodes[0].id;
  }
  if (selectedNodeId === nodeId) selectedNodeId = null;
  markDirty();
  syncCanvas();
  renderOutline();
  renderInspector();
}

function deleteEdge(edgeId) {
  if (!tree) return;
  tree.edges = tree.edges.filter((e) => e.id !== edgeId);
  if (selectedEdgeId === edgeId) selectedEdgeId = null;
  markDirty();
  syncCanvas();
  renderOutline();
  renderInspector();
}

function renderOutline() {
  if (!tree) return;
  const query = (nodeSearchEl.value || "").trim().toLowerCase();
  nodeCountEl.textContent = String(tree.nodes.length);
  nodeOutlineEl.innerHTML = "";

  const filtered = tree.nodes.filter((n) => {
    if (!query) return true;
    return (
      (n.title || "").toLowerCase().includes(query) ||
      (n.prompt || "").toLowerCase().includes(query)
    );
  });

  for (const node of filtered) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `outline-item ${node.id === selectedNodeId ? "active" : ""}`;
    const dotColor =
      node.type === "outcome"
        ? { urgent: "#dc2626", action: "#059669", referral: "#2563eb", info: "#d97706" }[node.outcomeLevel || "action"]
        : "#0d9488";
    btn.innerHTML = `
      <span style="display:flex;align-items:center;gap:7px;min-width:0;">
        <span class="legend-dot" style="background:${dotColor};margin:0;flex-shrink:0;"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(node.title || "Untitled")}</span>
      </span>
      ${node.id === tree.rootNodeId ? '<span style="font-size:10px;font-weight:700;color:var(--teal-700);">START</span>' : ""}
    `;
    btn.addEventListener("click", () => {
      selectedNodeId = node.id;
      selectedEdgeId = null;
      syncCanvas();
      canvas.centerOnNode(node.id);
      renderOutline();
      renderInspector();
      if (window.matchMedia("(max-width: 980px)").matches) {
        setMobileAdminTab("inspector");
      }
    });
    nodeOutlineEl.appendChild(btn);
  }
}

function renderInspector() {
  if (!tree) return;

  if (selectedNodeId) {
    const node = getNode(selectedNodeId);
    if (node) {
      renderNodeInspector(node);
      return;
    }
  }
  if (selectedEdgeId) {
    const edge = getEdge(selectedEdgeId);
    if (edge) {
      renderEdgeInspector(edge);
      return;
    }
  }
  renderTreeInspector();
}

function renderTreeInspector() {
  const issues = validateTreeGraph(tree);
  let issuesHtml = "";
  if (issues.length === 0) {
    issuesHtml = `<div class="alert alert-ok">Flowchart check passed: all nodes are reachable from Start and every question has branches.</div>`;
  } else {
    issuesHtml = issues
      .map(
        (iss) => `
        <div class="alert ${iss.level === "error" ? "alert-error" : "alert-warn"}" style="margin-bottom:6px;cursor:${iss.nodeId ? "pointer" : "default"};" data-jump-node="${escapeHtml(iss.nodeId || "")}">
          ${escapeHtml(iss.message)}
        </div>`
      )
      .join("");
  }

  inspectorEl.innerHTML = `
    <div>
      <h2 class="panel-section-title">Decision Tree Settings</h2>
      <div class="field">
        <label for="tree-title-input">Title</label>
        <input class="input" id="tree-title-input" value="${escapeHtml(tree.title || "")}" />
      </div>
      <div class="field">
        <label for="tree-desc-input">Description</label>
        <textarea class="textarea" id="tree-desc-input">${escapeHtml(tree.description || "")}</textarea>
      </div>
      <div class="field">
        <label for="tree-root-select">Start Node</label>
        <select class="select" id="tree-root-select">
          ${tree.nodes
            .map(
              (n) =>
                `<option value="${escapeHtml(n.id)}" ${n.id === tree.rootNodeId ? "selected" : ""}>${escapeHtml(n.title || n.id)}</option>`
            )
            .join("")}
        </select>
      </div>
    </div>
    <div>
      <h2 class="panel-section-title">Validation Check</h2>
      ${issuesHtml}
    </div>
    <div style="font-size:12px;color:var(--text-muted);line-height:1.5;border-top:1px solid var(--border);padding-top:12px;">
      Click any node or connector line on the canvas to edit its text, branches, or outcome checklist.
    </div>
  `;

  document.getElementById("tree-title-input").addEventListener("input", (e) => {
    tree.title = e.target.value;
    markDirty();
  });
  document.getElementById("tree-desc-input").addEventListener("input", (e) => {
    tree.description = e.target.value;
    markDirty();
  });
  document.getElementById("tree-root-select").addEventListener("change", (e) => {
    tree.rootNodeId = e.target.value;
    markDirty();
    syncCanvas();
    renderOutline();
  });
  inspectorEl.querySelectorAll("[data-jump-node]").forEach((el) => {
    const nid = el.dataset.jumpNode;
    if (!nid) return;
    el.addEventListener("click", () => {
      selectedNodeId = nid;
      syncCanvas();
      canvas.centerOnNode(nid);
      renderOutline();
      renderInspector();
    });
  });
}

function renderNodeInspector(node) {
  const outgoing = getOutgoingEdges(tree, node.id);
  const otherNodes = tree.nodes.filter((n) => n.id !== node.id);
  const isStart = tree.rootNodeId === node.id;

  let html = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <h2 class="panel-section-title" style="margin:0;">Edit ${node.type === "outcome" ? "Outcome" : "Question"}</h2>
      <button type="button" class="btn btn-sm" id="btn-back-tree">Tree Settings</button>
    </div>

    <div>
      <div class="field">
        <label for="node-type-select">Node Type</label>
        <select class="select" id="node-type-select">
          <option value="question" ${node.type === "question" ? "selected" : ""}>Question (branches to answers)</option>
          <option value="outcome" ${node.type === "outcome" ? "selected" : ""}>Outcome (final guidance & checklist)</option>
        </select>
      </div>

      <div class="field">
        <label for="node-title-input">Title</label>
        <input class="input" id="node-title-input" value="${escapeHtml(node.title || "")}" />
      </div>

      <div class="field">
        <label for="node-prompt-input">${node.type === "outcome" ? "Recommended Action / Instructions" : "Question Prompt"}</label>
        <textarea class="textarea" id="node-prompt-input">${escapeHtml(node.prompt || "")}</textarea>
      </div>

      <div class="field">
        <label for="node-guidance-input">Volunteer Guidance Note (Optional)</label>
        <textarea class="textarea" style="min-height:56px;" id="node-guidance-input">${escapeHtml(node.guidance || "")}</textarea>
      </div>
  `;

  if (node.type === "outcome") {
    html += `
      <div class="field">
        <label for="node-level-select">Outcome Category</label>
        <select class="select" id="node-level-select">
          <option value="urgent" ${node.outcomeLevel === "urgent" ? "selected" : ""}>Urgent / Emergency</option>
          <option value="action" ${node.outcomeLevel === "action" ? "selected" : ""}>Action / Care Pathway</option>
          <option value="referral" ${node.outcomeLevel === "referral" ? "selected" : ""}>Referral / Counseling</option>
          <option value="info" ${node.outcomeLevel === "info" ? "selected" : ""}>Information / Prerequisite</option>
        </select>
      </div>

      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <label style="font-size:12px;font-weight:600;color:var(--text-secondary);">Action Checklist</label>
          <button type="button" class="btn btn-sm" id="btn-add-checklist">+ Add Item</button>
        </div>
        <div id="checklist-editor">
          ${(node.checklist || [])
            .map(
              (item, idx) => `
              <div class="checklist-edit-row">
                <input class="input" data-checklist-idx="${idx}" value="${escapeHtml(item)}" />
                <button type="button" class="btn btn-danger btn-sm" data-del-checklist="${idx}">×</button>
              </div>`
            )
            .join("")}
        </div>
      </div>
    `;
  } else {
    html += `
      <div style="margin-top:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <label style="font-size:12px;font-weight:600;color:var(--text-secondary);">Answer Branches (${outgoing.length})</label>
        </div>
        <div id="branches-editor">
          ${outgoing
            .map(
              (edge) => `
              <div class="branch-row" data-branch-id="${escapeHtml(edge.id)}">
                <div style="display:flex;flex-direction:column;gap:5px;">
                  <input class="input" data-branch-label="${escapeHtml(edge.id)}" value="${escapeHtml(edge.label || "")}" placeholder="Answer option text" />
                  <select class="select" data-branch-target="${escapeHtml(edge.id)}">
                    ${otherNodes
                      .map(
                        (t) =>
                          `<option value="${escapeHtml(t.id)}" ${t.id === edge.target ? "selected" : ""}>→ ${escapeHtml(t.title || t.id)}</option>`
                      )
                      .join("")}
                  </select>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                  <button type="button" class="btn btn-sm" data-branch-select="${escapeHtml(edge.id)}" title="Inspect edge">Edit</button>
                  <button type="button" class="btn btn-danger btn-sm" data-branch-del="${escapeHtml(edge.id)}" title="Remove branch">×</button>
                </div>
              </div>`
            )
            .join("")}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
          <button type="button" class="btn btn-soft btn-sm" id="btn-spawn-question">+ New Question Child</button>
          <button type="button" class="btn btn-soft btn-sm" id="btn-spawn-outcome">+ New Outcome Child</button>
        </div>
      </div>
    `;
  }

  html += `
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--border);padding-top:12px;">
      ${
        isStart
          ? `<div class="alert alert-ok" style="padding:7px 10px;">This is the Start Node for volunteers.</div>`
          : `<button type="button" class="btn btn-sm" id="btn-set-start">Set as Start Node</button>`
      }
      <button type="button" class="btn btn-danger btn-sm" id="btn-delete-node">Delete Node</button>
    </div>
  `;

  inspectorEl.innerHTML = html;

  document.getElementById("btn-back-tree").addEventListener("click", () => {
    selectedNodeId = null;
    syncCanvas();
    renderOutline();
    renderInspector();
  });

  document.getElementById("node-type-select").addEventListener("change", (e) => {
    node.type = e.target.value;
    if (node.type === "outcome") {
      tree.edges = tree.edges.filter((edge) => edge.source !== node.id);
      if (!Array.isArray(node.checklist)) node.checklist = [];
    }
    markDirty();
    syncCanvas();
    renderOutline();
    renderInspector();
  });

  document.getElementById("node-title-input").addEventListener("input", (e) => {
    node.title = e.target.value;
    markDirty();
    syncCanvas();
    renderOutline();
  });

  document.getElementById("node-prompt-input").addEventListener("input", (e) => {
    node.prompt = e.target.value;
    markDirty();
    syncCanvas();
  });

  document.getElementById("node-guidance-input").addEventListener("input", (e) => {
    node.guidance = e.target.value;
    markDirty();
  });

  if (node.type === "outcome") {
    document.getElementById("node-level-select").addEventListener("change", (e) => {
      node.outcomeLevel = e.target.value;
      markDirty();
      syncCanvas();
      renderOutline();
    });

    document.getElementById("btn-add-checklist").addEventListener("click", () => {
      if (!Array.isArray(node.checklist)) node.checklist = [];
      node.checklist.push("New action step");
      markDirty();
      renderInspector();
    });

    inspectorEl.querySelectorAll("[data-checklist-idx]").forEach((inp) => {
      inp.addEventListener("input", () => {
        node.checklist[Number(inp.dataset.checklistIdx)] = inp.value;
        markDirty();
      });
    });

    inspectorEl.querySelectorAll("[data-del-checklist]").forEach((btn) => {
      btn.addEventListener("click", () => {
        node.checklist.splice(Number(btn.dataset.delChecklist), 1);
        markDirty();
        renderInspector();
      });
    });
  } else {
    inspectorEl.querySelectorAll("[data-branch-label]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const edge = getEdge(inp.dataset.branchLabel);
        if (edge) {
          edge.label = inp.value;
          markDirty();
          syncCanvas();
        }
      });
    });

    inspectorEl.querySelectorAll("[data-branch-target]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const edge = getEdge(sel.dataset.branchTarget);
        if (edge) {
          edge.target = sel.value;
          markDirty();
          syncCanvas();
        }
      });
    });

    inspectorEl.querySelectorAll("[data-branch-select]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedEdgeId = btn.dataset.branchSelect;
        selectedNodeId = null;
        syncCanvas();
        renderInspector();
      });
    });

    inspectorEl.querySelectorAll("[data-branch-del]").forEach((btn) => {
      btn.addEventListener("click", () => deleteEdge(btn.dataset.branchDel));
    });

    const spawnChild = (kind) => {
      const siblingOffset = outgoing.length * 270 - 120;
      const child = createNode(kind, {
        x: Math.round((node.position?.x ?? 100) + siblingOffset),
        y: Math.round((node.position?.y ?? 100) + 210),
      });
      if (child) {
        const edge = {
          id: uid("e"),
          source: node.id,
          target: child.id,
          label: outgoing.length === 0 ? "Yes" : "Option",
          order: outgoing.length + 1,
        };
        tree.edges.push(edge);
        selectedNodeId = child.id;
        selectedEdgeId = null;
        markDirty();
        syncCanvas();
        renderOutline();
        renderInspector();
      }
    };

    document.getElementById("btn-spawn-question").addEventListener("click", () => spawnChild("question"));
    document.getElementById("btn-spawn-outcome").addEventListener("click", () => spawnChild("outcome"));
  }

  document.getElementById("btn-set-start")?.addEventListener("click", () => {
    tree.rootNodeId = node.id;
    markDirty();
    syncCanvas();
    renderOutline();
    renderInspector();
  });

  document.getElementById("btn-delete-node").addEventListener("click", () => deleteNode(node.id));
}

function renderEdgeInspector(edge) {
  const srcNode = getNode(edge.source);
  const tgtNode = getNode(edge.target);

  inspectorEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <h2 class="panel-section-title" style="margin:0;">Edit Branch</h2>
      <button type="button" class="btn btn-sm" id="btn-back-tree">Tree Settings</button>
    </div>

    <div class="alert" style="background:var(--surface-muted);">
      <div><strong>From:</strong> ${escapeHtml(srcNode?.title || edge.source)}</div>
      <div style="margin-top:4px;"><strong>To:</strong> ${escapeHtml(tgtNode?.title || edge.target)}</div>
    </div>

    <div class="field">
      <label for="edge-label-input">Answer Option Label</label>
      <input class="input" id="edge-label-input" value="${escapeHtml(edge.label || "")}" />
    </div>

    <div class="field">
      <label for="edge-order-input">Display Order (in wizard)</label>
      <input class="input" id="edge-order-input" type="number" min="1" value="${Number(edge.order ?? 1)}" />
    </div>

    <div class="field">
      <label for="edge-target-select">Target Node</label>
      <select class="select" id="edge-target-select">
        ${tree.nodes
          .filter((n) => n.id !== edge.source)
          .map(
            (n) =>
              `<option value="${escapeHtml(n.id)}" ${n.id === edge.target ? "selected" : ""}>${escapeHtml(n.title || n.id)}</option>`
          )
          .join("")}
      </select>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--border);padding-top:12px;">
      <button type="button" class="btn btn-danger btn-sm" id="btn-delete-edge">Delete Branch</button>
    </div>
  `;

  document.getElementById("btn-back-tree").addEventListener("click", () => {
    selectedEdgeId = null;
    syncCanvas();
    renderInspector();
  });

  document.getElementById("edge-label-input").addEventListener("input", (e) => {
    edge.label = e.target.value;
    markDirty();
    syncCanvas();
  });

  document.getElementById("edge-order-input").addEventListener("input", (e) => {
    edge.order = Number(e.target.value) || 1;
    markDirty();
  });

  document.getElementById("edge-target-select").addEventListener("change", (e) => {
    edge.target = e.target.value;
    markDirty();
    syncCanvas();
  });

  document.getElementById("btn-delete-edge").addEventListener("click", () => deleteEdge(edge.id));
}

async function saveTree(publish = false) {
  if (!tree) return;
  const res = await fetch("/api/admin/tree", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tree, publish }),
  });
  const data = await res.json();
  if (!res.ok) {
    const details = Array.isArray(data.details) ? data.details.join(" ") : data.error;
    showToast(`Save failed: ${details}`);
    return;
  }
  tree = data.tree;
  serverMeta = {
    draftVersion: data.draftVersion,
    publishedVersion: data.publishedVersion,
    hasUnpublishedChanges: data.hasUnpublishedChanges,
  };
  hasUnsavedEdits = false;
  updateStatusPill();
  syncCanvas();
  renderOutline();
  renderInspector();
  showToast(publish ? `Published live (v${data.publishedVersion})` : `Draft saved (v${data.draftVersion})`);
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function handleExport(format) {
  if (!tree) return;
  if (format === "svg") {
    downloadFile("medinetz-decision-tree.svg", exportTreeAsSvg(tree), "image/svg+xml;charset=utf-8");
    showToast("Exported SVG diagram");
    return;
  }
  if (format === "json") {
    downloadFile("medinetz-decision-tree.json", JSON.stringify(tree, null, 2), "application/json;charset=utf-8");
    showToast("Exported JSON tree");
    return;
  }
  // Save draft first if unsaved so server export matches current canvas
  if (hasUnsavedEdits) {
    await saveTree(false);
  }
  const res = await fetch(`/api/admin/tree/export?format=${encodeURIComponent(format)}&scope=draft`);
  if (!res.ok) {
    showToast("Export failed");
    return;
  }
  const text = await res.text();
  const ext = format === "mermaid" ? "mmd" : "md";
  const mime = format === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8";
  downloadFile(`medinetz-decision-tree.${ext}`, text, mime);
  showToast(`Exported ${format.toUpperCase()}`);
}

function setMobileAdminTab(tab) {
  adminWorkspaceEl.classList.remove("mobile-tab-canvas", "mobile-tab-nodes", "mobile-tab-inspector");
  adminWorkspaceEl.classList.add(`mobile-tab-${tab}`);
  mobileAdminTabsEl.querySelectorAll("[data-admin-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.adminTab === tab);
  });
  if (tab === "canvas") {
    requestAnimationFrame(() => canvas.fitToView());
  }
}

mobileAdminTabsEl.querySelectorAll("[data-admin-tab]").forEach((btn) => {
  btn.addEventListener("click", () => setMobileAdminTab(btn.dataset.adminTab));
});

async function loadAdminWorkspace(admin) {
  currentAdmin = admin;
  loginScreenEl.classList.add("hidden");
  loginTopbarActionsEl.classList.add("hidden");
  adminWorkspaceEl.classList.remove("hidden");
  mobileAdminTabsEl.classList.remove("hidden");
  adminToolbarEl.classList.remove("hidden");
  adminSubtitleEl.textContent = `Signed in as ${admin.username} · Drag-and-Drop Decision Tree Editor`;
  accountUsernameEl.textContent = admin.username;

  const res = await fetch("/api/admin/tree");
  if (!res.ok) {
    showToast("Failed to load decision tree");
    return;
  }
  const data = await res.json();
  tree = data.tree;
  serverMeta = {
    draftVersion: data.draftVersion,
    publishedVersion: data.publishedVersion,
    hasUnpublishedChanges: data.hasUnpublishedChanges,
  };
  hasUnsavedEdits = false;
  selectedNodeId = null;
  selectedEdgeId = null;
  updateStatusPill();
  syncCanvas();
  renderOutline();
  renderInspector();
  requestAnimationFrame(() => canvas.fitToView());
}

function showLoginScreen() {
  currentAdmin = null;
  adminWorkspaceEl.classList.add("hidden");
  mobileAdminTabsEl.classList.add("hidden");
  adminToolbarEl.classList.add("hidden");
  statusPillEl.classList.add("hidden");
  loginScreenEl.classList.remove("hidden");
  loginTopbarActionsEl.classList.remove("hidden");
  adminSubtitleEl.textContent = "Sign in to edit and publish the decision tree";
}

// Login & Auth Events
loginFormEl.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  loginErrorEl.classList.add("hidden");
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;

  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    loginErrorEl.textContent = data.error || "Sign in failed.";
    loginErrorEl.classList.remove("hidden");
    return;
  }
  document.getElementById("login-password").value = "";
  await loadAdminWorkspace(data.admin);
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  showLoginScreen();
});

// Palette drag & click-to-add
document.querySelectorAll("[data-create-node]").forEach((el) => {
  const kind = el.dataset.createNode;
  el.addEventListener("dragstart", (ev) => {
    ev.dataTransfer.setData("application/x-medinetz-node-type", kind);
    ev.dataTransfer.effectAllowed = "copy";
  });
  el.addEventListener("click", () => {
    createNode(kind);
  });
});

nodeSearchEl.addEventListener("input", renderOutline);

// Toolbar Actions
document.getElementById("btn-auto-layout").addEventListener("click", () => {
  if (!tree) return;
  computeAutoLayout(tree);
  markDirty();
  syncCanvas();
  canvas.fitToView();
  showToast("Auto-arranged flowchart");
});

document.getElementById("btn-save-draft").addEventListener("click", () => saveTree(false));
document.getElementById("btn-publish").addEventListener("click", () => saveTree(true));

document.getElementById("btn-zoom-in").addEventListener("click", () => canvas.setZoom(canvas.transform.scale * 1.15));
document.getElementById("btn-zoom-out").addEventListener("click", () => canvas.setZoom(canvas.transform.scale * 0.85));
document.getElementById("btn-fit").addEventListener("click", () => canvas.fitToView());

// Export dropdown
const exportMenuEl = document.getElementById("export-menu");
document.getElementById("btn-export-toggle").addEventListener("click", (ev) => {
  ev.stopPropagation();
  exportMenuEl.classList.toggle("hidden");
});
document.addEventListener("click", () => exportMenuEl.classList.add("hidden"));
exportMenuEl.querySelectorAll("[data-export]").forEach((btn) => {
  btn.addEventListener("click", () => {
    exportMenuEl.classList.add("hidden");
    handleExport(btn.dataset.export);
  });
});

// Import JSON
document.getElementById("input-import-json").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const res = await fetch("/api/admin/tree/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tree: parsed, publish: false }),
    });
    const data = await res.json();
    if (!res.ok) {
      const details = Array.isArray(data.details) ? data.details.join(" ") : data.error;
      showToast(`Import error: ${details}`);
      return;
    }
    tree = data.tree;
    serverMeta = {
      draftVersion: data.draftVersion,
      publishedVersion: data.publishedVersion,
      hasUnpublishedChanges: data.hasUnpublishedChanges,
    };
    hasUnsavedEdits = false;
    selectedNodeId = null;
    selectedEdgeId = null;
    updateStatusPill();
    syncCanvas();
    renderOutline();
    renderInspector();
    canvas.fitToView();
    showToast("Imported JSON into draft");
  } catch (err) {
    showToast(`Invalid JSON file: ${err.message}`);
  }
});

// Account / Password Modal
document.getElementById("btn-account").addEventListener("click", () => {
  passwordFeedbackEl.classList.add("hidden");
  passwordFormEl.reset();
  accountModalEl.classList.remove("hidden");
});
document.getElementById("btn-close-account").addEventListener("click", () => {
  accountModalEl.classList.add("hidden");
});
passwordFormEl.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  passwordFeedbackEl.classList.add("hidden");
  const currentPassword = document.getElementById("curr-pass").value;
  const newPassword = document.getElementById("new-pass").value;
  const res = await fetch("/api/admin/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await res.json();
  passwordFeedbackEl.classList.remove("hidden", "alert-ok", "alert-error");
  if (!res.ok) {
    passwordFeedbackEl.classList.add("alert-error");
    passwordFeedbackEl.textContent = data.error || "Password update failed.";
    return;
  }
  passwordFeedbackEl.classList.add("alert-ok");
  passwordFeedbackEl.textContent = "Password updated successfully.";
  passwordFormEl.reset();
});

// Keyboard shortcuts
window.addEventListener("keydown", (ev) => {
  if (!currentAdmin) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
    ev.preventDefault();
    saveTree(false);
    return;
  }
  if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.tagName === "SELECT") {
    return;
  }
  if (ev.key === "Escape") {
    selectedNodeId = null;
    selectedEdgeId = null;
    syncCanvas();
    renderOutline();
    renderInspector();
  } else if (ev.key === "Delete" || ev.key === "Backspace") {
    if (selectedEdgeId) {
      ev.preventDefault();
      deleteEdge(selectedEdgeId);
    } else if (selectedNodeId) {
      ev.preventDefault();
      deleteNode(selectedNodeId);
    }
  }
});

async function init() {
  const res = await fetch("/api/admin/me");
  const data = await res.json();
  if (data.authenticated && data.admin) {
    await loadAdminWorkspace(data.admin);
  } else {
    showLoginScreen();
  }
}

init();
