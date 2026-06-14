const state = {
  issues: [],
  selectedId: null,
  view: "jira",
  drag: null,
  mindmapFocusId: null,
  editingMindmapId: null,
  lastMindmapClick: null,
};

const els = {
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll("[data-panel]"),
  tree: document.querySelector("#issueTree"),
  form: document.querySelector("#issueForm"),
  search: document.querySelector("#search"),
  newIssue: document.querySelector("#newIssue"),
  addSubIssue: document.querySelector("#addSubIssue"),
  deleteIssue: document.querySelector("#deleteIssue"),
  parent: document.querySelector("#parent_id"),
  gantt: document.querySelector("#ganttGrid"),
  rangeSummary: document.querySelector("#rangeSummary"),
  mindmap: document.querySelector("#mindmapCanvas"),
  mindmapSummary: document.querySelector("#mindmapSummary"),
};

const fields = ["title", "status", "created_at", "start_date", "deadline", "parent_id", "description", "file"]
  .reduce((map, id) => ({ ...map, [id]: document.querySelector(`#${id}`) }), {});

const DAY_MS = 86400000;

function formatLocalDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function today() {
  return formatLocalDate(new Date());
}

function formatDate(value) {
  if (!value) return "未設定";
  return value.length > 10 ? value.slice(0, 10) : value;
}

function parseDate(value) {
  const [year, month, day] = formatDate(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeIssue(issue = {}) {
  return {
    id: issue.id || "",
    parent_id: issue.parent_id || "",
    title: issue.title || "",
    status: issue.status || "todo",
    created_at: issue.created_at || new Date().toISOString(),
    start_date: issue.start_date || today(),
    deadline: issue.deadline || today(),
    description: issue.description || "",
    file: issue.file || "",
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function loadIssues() {
  state.issues = await api("/api/issues");
  if (!state.selectedId && state.issues.length) state.selectedId = state.issues[0].id;
  renderAll();
}

function issueChildren(parentId) {
  return state.issues.filter((issue) => (issue.parent_id || "") === parentId);
}

function orderedIssues() {
  const result = [];
  const visited = new Set();
  const walk = (parentId, depth) => {
    issueChildren(parentId).forEach((issue) => {
      if (visited.has(issue.id)) return;
      visited.add(issue.id);
      result.push({ ...issue, depth });
      walk(issue.id, depth + 1);
    });
  };
  walk("", 0);
  state.issues
    .filter((issue) => !visited.has(issue.id))
    .forEach((issue) => {
      result.push({ ...issue, depth: 0 });
      visited.add(issue.id);
    });
  return result;
}

function isDescendant(candidateId, ancestorId) {
  if (!candidateId || !ancestorId) return false;
  let current = state.issues.find((issue) => issue.id === candidateId);
  const visited = new Set();
  while (current?.parent_id) {
    if (current.parent_id === ancestorId) return true;
    if (visited.has(current.parent_id)) return false;
    visited.add(current.parent_id);
    current = state.issues.find((issue) => issue.id === current.parent_id);
  }
  return false;
}

function canReparent(issueId, parentId) {
  if (!issueId) return false;
  if (!parentId || parentId === "root") return true;
  if (issueId === parentId) return false;
  return !isDescendant(parentId, issueId);
}

function renderTree() {
  const query = els.search.value.trim().toLowerCase();
  const rows = orderedIssues().filter((issue) => {
    const content = `${issue.title} ${issue.description}`.toLowerCase();
    return !query || content.includes(query);
  });

  els.tree.innerHTML = rows.length
    ? rows.map((issue) => `
      <button class="issue-item ${issue.depth ? "child" : ""} ${issue.id === state.selectedId ? "active" : ""}" data-id="${issue.id}">
        <span class="issue-title-line">
          <span class="status-dot status-${issue.status}"></span>
          <strong class="issue-title">${escapeHtml(issue.title)}</strong>
        </span>
        <span class="issue-meta">${formatDate(issue.start_date)} → ${formatDate(issue.deadline)}</span>
      </button>
    `).join("")
    : `<div class="empty-state">目前沒有工作項目</div>`;

  els.tree.querySelectorAll(".issue-item").forEach((button) => {
    button.addEventListener("click", () => selectIssue(button.dataset.id));
  });
}

function renderParentOptions() {
  const options = [`<option value="">無上層項目</option>`]
    .concat(state.issues
      .filter((issue) => issue.id !== state.selectedId && !isDescendant(issue.id, state.selectedId))
      .map((issue) => `<option value="${issue.id}">${escapeHtml(issue.title)}</option>`));
  els.parent.innerHTML = options.join("");
}

function renderForm() {
  renderParentOptions();
  const issue = normalizeIssue(state.issues.find((item) => item.id === state.selectedId));
  Object.entries(fields).forEach(([key, input]) => {
    input.value = issue[key] || "";
  });
  els.deleteIssue.disabled = !issue.id;
  els.addSubIssue.disabled = !issue.id;
}

function renderGantt() {
  const items = orderedIssues().filter((issue) => issue.start_date || issue.deadline);
  if (!items.length) {
    els.gantt.innerHTML = `<div class="empty-state">設定開始日期和最後期限後，這裡會出現 Gantt 圖</div>`;
    els.rangeSummary.textContent = "";
    return;
  }

  const starts = items.map((issue) => parseDate(issue.start_date || issue.deadline));
  const ends = items.map((issue) => parseDate(issue.deadline || issue.start_date));
  const min = new Date(Math.min(...starts));
  const max = new Date(Math.max(...ends));
  const days = Math.max(1, Math.round((max - min) / DAY_MS) + 1);
  const columns = Array.from({ length: days }, (_, index) => {
    const date = new Date(min);
    date.setDate(min.getDate() + index);
    return date;
  });
  els.rangeSummary.textContent = `${formatLocalDate(min)} 到 ${formatLocalDate(max)}`;

  const header = columns.map((date) => `<th>${date.getMonth() + 1}/${date.getDate()}</th>`).join("");
  const now = new Date();
  const rangeStart = startOfDay(min);
  const rangeEnd = new Date(startOfDay(max).getTime() + DAY_MS);
  const nowOffset = now >= rangeStart && now <= rangeEnd
    ? ((now - rangeStart) / (days * DAY_MS)) * 100
    : null;
  const nowLine = nowOffset === null
    ? ""
    : `<div class="gantt-now-line" style="--now-left:${nowOffset}%" title="現在"></div>`;

  const rows = items.map((issue) => {
    const start = parseDate(issue.start_date || issue.deadline);
    const end = parseDate(issue.deadline || issue.start_date);
    const left = Math.max(0, Math.round((start - min) / DAY_MS));
    const span = Math.max(1, Math.round((end - start) / DAY_MS) + 1);
    const barLeft = (left / days) * 100;
    const barWidth = (span / days) * 100;
    return `
      <tr>
        <td>
          <span class="gantt-row-title" style="padding-left:${issue.depth * 18}px">
            <span class="status-dot status-${issue.status}"></span>
            <span>${escapeHtml(issue.title)}</span>
          </span>
        </td>
        <td class="gantt-bar-cell" colspan="${days}" style="--gantt-day-width:${100 / days}%">
          ${nowLine}
          <div class="gantt-bar" style="--left:${barLeft}%; --width:calc(${barWidth}% - 6px); background:${barColor(issue.status)}">
            ${escapeHtml(issue.title)}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  els.gantt.innerHTML = `
    <table class="gantt-table">
      <thead><tr><th>項目</th>${header}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderMindmap() {
  const issues = state.issues;
  els.mindmapSummary.textContent = issues.length ? `${issues.length} 個工作項目` : "";
  if (!issues.length) {
    els.mindmap.innerHTML = `<div class="empty-state">新增 issue 或 sub-issue 後，這裡會出現主從關係圖</div>`;
    return;
  }

  const byParent = new Map();
  issues.forEach((issue) => {
    const parentExists = issue.parent_id && issues.some((candidate) => candidate.id === issue.parent_id);
    const parentId = parentExists ? issue.parent_id : "";
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(issue);
  });

  const nodes = [];
  const edges = [];
  const visited = new Set();
  let leafIndex = 0;
  let maxDepth = 0;
  const xGap = 270;
  const yGap = 92;
  const top = 44;

  const placeNode = (issue, depth, parentNodeId) => {
    if (visited.has(issue.id)) return null;
    visited.add(issue.id);
    const children = byParent.get(issue.id) || [];
    const childNodes = children
      .map((child) => placeNode(child, depth + 1, issue.id))
      .filter(Boolean);
    const y = childNodes.length
      ? childNodes.reduce((sum, node) => sum + node.y, 0) / childNodes.length
      : top + leafIndex++ * yGap;
    const node = { ...issue, depth, x: 36 + depth * xGap, y };
    nodes.push(node);
    if (parentNodeId) edges.push({ from: parentNodeId, to: issue.id });
    maxDepth = Math.max(maxDepth, depth);
    return node;
  };

  const roots = byParent.get("")?.length ? byParent.get("") : issues;
  const rootChildNodes = roots
    .map((issue) => placeNode(issue, 1, "root"))
    .filter(Boolean);
  const rootY = rootChildNodes.reduce((sum, node) => sum + node.y, 0) / rootChildNodes.length;
  const rootNode = {
    id: "root",
    title: "工作項目",
    status: "root",
    start_date: "",
    deadline: "",
    depth: 0,
    x: 36,
    y: rootY,
  };
  const allNodes = [rootNode, ...nodes];
  const nodeById = new Map(allNodes.map((node) => [node.id, node]));
  const width = Math.max(720, 36 + (maxDepth + 1) * xGap + 220);
  const height = Math.max(360, top * 2 + Math.max(leafIndex, 1) * yGap);

  const edgeMarkup = edges.map((edge) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    const startX = from.x + 212;
    const startY = from.y + 32;
    const endX = to.x;
    const endY = to.y + 32;
    const midX = startX + (endX - startX) / 2;
    return `<path d="M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}" />`;
  }).join("");

  const nodeMarkup = allNodes.map((node) => {
    const isRoot = node.id === "root";
    const active = node.id === state.mindmapFocusId ? "active" : "";
    const editable = !isRoot && node.id === state.mindmapFocusId;
    const meta = isRoot ? "Root" : `${formatDate(node.start_date)} → ${formatDate(node.deadline)}`;
    return `
      <div
        class="mindmap-node ${isRoot ? "root" : ""} ${active}"
        style="left:${node.x}px; top:${node.y}px"
        data-id="${node.id}"
        role="button"
        tabindex="0"
      >
        <span class="issue-title-line">
          <span class="status-dot status-${node.status}"></span>
          ${editable
            ? `<input class="mindmap-edit-field mindmap-title-input" data-id="${node.id}" data-field="title" value="${escapeHtml(node.title)}" aria-label="節點名稱" />`
            : `<strong class="issue-title">${escapeHtml(node.title)}</strong>`}
        </span>
        ${editable
          ? `<span class="mindmap-date-fields">
              <input class="mindmap-edit-field mindmap-date-input" data-id="${node.id}" data-field="start_date" type="date" value="${escapeHtml(node.start_date)}" aria-label="開始日期" />
              <span aria-hidden="true">→</span>
              <input class="mindmap-edit-field mindmap-date-input" data-id="${node.id}" data-field="deadline" type="date" value="${escapeHtml(node.deadline)}" aria-label="結束日期" />
            </span>`
          : `<span class="issue-meta">${meta}</span>`}
      </div>
    `;
  }).join("");

  els.mindmap.innerHTML = `
    <div class="mindmap-board" style="width:${width}px; height:${height}px">
      <svg class="mindmap-lines" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
        ${edgeMarkup}
      </svg>
      ${nodeMarkup}
    </div>
  `;

  els.mindmap.querySelectorAll(".mindmap-node").forEach((button) => {
    button.addEventListener("pointerdown", startMindmapDrag);
    button.addEventListener("dblclick", openMindmapNode);
    button.addEventListener("keydown", handleMindmapNodeKeydown);
  });
  els.mindmap.querySelectorAll(".mindmap-edit-field").forEach((input) => {
    input.addEventListener("click", handleMindmapFieldClick);
    input.addEventListener("keydown", handleMindmapFieldKeydown);
    input.addEventListener("blur", saveMindmapField);
  });
  focusMindmapTitleInput();
}

function renderAll() {
  renderTree();
  renderForm();
  renderGantt();
  renderMindmap();
}

function selectIssue(id) {
  state.selectedId = id;
  renderAll();
}

function focusMindmapNode(id, focusNode = true) {
  state.editingMindmapId = null;
  state.mindmapFocusId = id;
  state.selectedId = id;
  renderMindmap();
  if (focusNode) {
    requestAnimationFrame(() => {
      els.mindmap.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus();
    });
  }
}

function clearMindmapFocus(event) {
  if (event.target.closest(".mindmap-node")) return;
  if (!state.mindmapFocusId && !state.editingMindmapId) return;
  state.mindmapFocusId = null;
  state.editingMindmapId = null;
  renderMindmap();
}

function openIssueInJira(id) {
  state.selectedId = id;
  switchView("jira");
  requestAnimationFrame(() => {
    const item = els.tree.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (item) item.scrollIntoView({ block: "center", behavior: "smooth" });
    fields.title.focus();
  });
}

function openMindmapNode(event) {
  const node = event.currentTarget;
  if (node.classList.contains("root")) return;
  state.lastMindmapClick = null;
  focusMindmapNode(node.dataset.id);
  openIssueInJira(node.dataset.id);
}

function isMindmapDoubleClick(id) {
  const now = Date.now();
  const recent = state.lastMindmapClick
    && state.lastMindmapClick.id === id
    && now - state.lastMindmapClick.time <= 350;
  state.lastMindmapClick = recent ? null : { id, time: now };
  return recent;
}

function startMindmapDrag(event) {
  if (event.button !== 0) return;
  if (event.target.closest(".mindmap-edit-field")) return;
  const node = event.currentTarget;
  if (node.classList.contains("root")) return;

  const rect = node.getBoundingClientRect();
  state.drag = {
    id: node.dataset.id,
    node,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    moved: false,
    dropId: null,
  };
  node.setPointerCapture(event.pointerId);
  node.addEventListener("pointermove", moveMindmapDrag);
  node.addEventListener("pointerup", endMindmapDrag);
  node.addEventListener("pointercancel", cancelMindmapDrag);
}

function moveMindmapDrag(event) {
  const drag = state.drag;
  if (!drag) return;

  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.moved && distance < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    drag.node.classList.add("dragging");
    els.mindmap.classList.add("drag-active");
  }

  drag.node.style.left = `${event.clientX - els.mindmap.getBoundingClientRect().left + els.mindmap.scrollLeft - drag.offsetX}px`;
  drag.node.style.top = `${event.clientY - els.mindmap.getBoundingClientRect().top + els.mindmap.scrollTop - drag.offsetY}px`;

  const dropNode = findMindmapDropNode(event.clientX, event.clientY, drag.id);
  setMindmapDropTarget(dropNode?.dataset.id || null);
}

async function endMindmapDrag(event) {
  const drag = state.drag;
  if (!drag) return;
  const dropId = drag.dropId;
  cleanupMindmapDrag(event);

  if (!drag.moved) {
    if (isMindmapDoubleClick(drag.id)) {
      openIssueInJira(drag.id);
      return;
    }
    focusMindmapNode(drag.id);
    return;
  }

  const parentId = dropId === "root" ? "" : dropId;
  const issue = state.issues.find((item) => item.id === drag.id);
  if (!issue || parentId == null || issue.parent_id === parentId || !canReparent(issue.id, parentId)) {
    renderMindmap();
    return;
  }

  state.selectedId = issue.id;
  const updated = { ...issue, parent_id: parentId };
  issue.parent_id = parentId;
  renderAll();
  try {
    await api(`/api/issues/${encodeURIComponent(issue.id)}`, {
      method: "PUT",
      body: JSON.stringify(updated),
    });
    await loadIssues();
  } catch (error) {
    console.error(error);
    renderMindmap();
  }
}

function handleMindmapNodeKeydown(event) {
  if (event.target.closest(".mindmap-edit-field")) return;
  if (event.key !== "Tab" && event.key !== "Enter") return;

  event.preventDefault();
  const id = event.currentTarget.dataset.id;
  if (event.key === "Tab") {
    createMindmapIssue(id === "root" ? "" : id);
    return;
  }

  const issue = state.issues.find((item) => item.id === id);
  createMindmapIssue(issue?.parent_id || "");
}

async function createMindmapIssue(parentId) {
  const issue = normalizeIssue({ parent_id: parentId, title: "新節點" });
  const saved = await api("/api/issues", { method: "POST", body: JSON.stringify(issue) });
  state.selectedId = saved.id;
  state.mindmapFocusId = saved.id;
  state.editingMindmapId = saved.id;
  await loadIssues();
}

function focusMindmapTitleInput() {
  if (!state.editingMindmapId) return;
  requestAnimationFrame(() => {
    const input = els.mindmap.querySelector(".mindmap-title-input");
    if (!input) return;
    input.focus();
    input.select();
  });
}

function handleMindmapFieldClick(event) {
  const node = event.currentTarget.closest(".mindmap-node");
  if (!node || node.classList.contains("root")) return;
  if (!isMindmapDoubleClick(node.dataset.id)) return;
  event.preventDefault();
  openIssueInJira(node.dataset.id);
}

function handleMindmapFieldKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.blur();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    state.editingMindmapId = null;
    renderMindmap();
  }
}

async function saveMindmapField(event) {
  const input = event.currentTarget;
  const issue = state.issues.find((item) => item.id === input.dataset.id);
  if (!issue) return;

  const field = input.dataset.field;
  const value = field === "title"
    ? input.value.trim() || issue.title || "未命名項目"
    : input.value;
  if (!["title", "start_date", "deadline"].includes(field)) return;

  state.editingMindmapId = null;
  if (value === issue[field]) return;

  issue[field] = value;
  renderTree();
  renderForm();
  renderGantt();
  try {
    const saved = await api(`/api/issues/${encodeURIComponent(issue.id)}`, {
      method: "PUT",
      body: JSON.stringify(issue),
    });
    Object.assign(issue, saved);
    renderTree();
    renderForm();
    renderGantt();
  } catch (error) {
    console.error(error);
    await loadIssues();
  }
}

function cancelMindmapDrag(event) {
  cleanupMindmapDrag(event);
  renderMindmap();
}

function cleanupMindmapDrag(event) {
  const drag = state.drag;
  if (!drag) return;
  drag.node.releasePointerCapture?.(event.pointerId);
  drag.node.removeEventListener("pointermove", moveMindmapDrag);
  drag.node.removeEventListener("pointerup", endMindmapDrag);
  drag.node.removeEventListener("pointercancel", cancelMindmapDrag);
  drag.node.classList.remove("dragging");
  els.mindmap.classList.remove("drag-active");
  setMindmapDropTarget(null);
  state.drag = null;
}

function findMindmapDropNode(clientX, clientY, draggedId) {
  const draggedNode = state.drag?.node;
  if (draggedNode) draggedNode.style.pointerEvents = "none";
  const element = document.elementFromPoint(clientX, clientY);
  if (draggedNode) draggedNode.style.pointerEvents = "";
  const node = element?.closest?.(".mindmap-node");
  if (node && canReparent(draggedId, node.dataset.id)) return node;

  return findNearestMindmapDropNode(draggedId);
}

function findNearestMindmapDropNode(draggedId) {
  const draggedNode = state.drag?.node;
  if (!draggedNode) return null;

  const draggedRect = draggedNode.getBoundingClientRect();
  const draggedCenter = {
    x: draggedRect.left + draggedRect.width / 2,
    y: draggedRect.top + draggedRect.height / 2,
  };
  const candidates = [...els.mindmap.querySelectorAll(".mindmap-node")]
    .filter((node) => node.dataset.id !== draggedId && canReparent(draggedId, node.dataset.id));

  const nearest = candidates.reduce((best, node) => {
    const rect = node.getBoundingClientRect();
    const dx = Math.max(rect.left - draggedCenter.x, 0, draggedCenter.x - rect.right);
    const dy = Math.max(rect.top - draggedCenter.y, 0, draggedCenter.y - rect.bottom);
    const distance = Math.hypot(dx, dy);
    return distance < best.distance ? { node, distance } : best;
  }, { node: null, distance: Number.POSITIVE_INFINITY });

  return nearest.distance <= 180 ? nearest.node : null;
}

function setMindmapDropTarget(id) {
  if (state.drag) state.drag.dropId = id;
  els.mindmap.querySelectorAll(".mindmap-node").forEach((node) => {
    node.classList.toggle("drop-target", Boolean(id) && node.dataset.id === id);
  });
}

function formIssue() {
  return normalizeIssue({
    id: state.selectedId,
    title: fields.title.value,
    status: fields.status.value,
    created_at: fields.created_at.value,
    start_date: fields.start_date.value,
    deadline: fields.deadline.value,
    parent_id: fields.parent_id.value,
    description: fields.description.value,
  });
}

async function saveIssue(event) {
  event.preventDefault();
  const issue = formIssue();
  const method = issue.id ? "PUT" : "POST";
  const path = issue.id ? `/api/issues/${encodeURIComponent(issue.id)}` : "/api/issues";
  const saved = await api(path, { method, body: JSON.stringify(issue) });
  state.selectedId = saved.id;
  await loadIssues();
}

function newIssue(parentId = "") {
  state.selectedId = null;
  renderParentOptions();
  const issue = normalizeIssue({ parent_id: parentId, title: "" });
  Object.entries(fields).forEach(([key, input]) => {
    input.value = issue[key] || "";
  });
  fields.parent_id.value = parentId;
  fields.title.focus();
}

async function deleteIssue() {
  if (!state.selectedId) return;
  await api(`/api/issues/${encodeURIComponent(state.selectedId)}`, { method: "DELETE" });
  state.issues
    .filter((issue) => issue.parent_id === state.selectedId)
    .forEach((issue) => { issue.parent_id = ""; });
  state.selectedId = null;
  await loadIssues();
}

function switchView(view) {
  state.view = view;
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  els.panels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== view));
  renderGantt();
  renderMindmap();
}

function barColor(status) {
  return { todo: "#78909c", doing: "#2f80ed", done: "#2e7d32" }[status] || "#0f766e";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

els.form.addEventListener("submit", saveIssue);
els.search.addEventListener("input", renderTree);
els.newIssue.addEventListener("click", () => newIssue(""));
els.addSubIssue.addEventListener("click", () => newIssue(state.selectedId || ""));
els.deleteIssue.addEventListener("click", deleteIssue);
els.tabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
els.mindmap.addEventListener("click", clearMindmapFocus);
window.addEventListener("scroll", () => {
  document.body.classList.toggle("scrolled", window.scrollY > 24);
}, { passive: true });

loadIssues().catch((error) => {
  console.error(error);
  els.tree.innerHTML = `<div class="empty-state">載入失敗，請查看終端機輸出</div>`;
});
