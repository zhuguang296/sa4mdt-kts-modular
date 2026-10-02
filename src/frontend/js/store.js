// 工程状态管理：当前工程、当前画布、撤销栈、localStorage 自动保存
import * as M from './model.js';
import * as S from './settings.js';

const LS_KEY = 'kts-builder.project.v1';
const LS_UI = 'kts-builder.ui.v1';

export const store = {
  project: null,
  activeCanvasId: null,
  selection: [],
  listeners: [],
  undoStack: [],
  redoStack: [],
  dirty: false,
};

export function on(fn) { store.listeners.push(fn); }
export function emit(what = 'change') {
  for (const fn of store.listeners) {
    try { fn(what); } catch (e) { console.error(e); }
  }
}

// ---------------- 初始化 ----------------

export function initProject() {
  const saved = loadLocal();
  store.project = saved || M.newProject();
  const ref = M.findCanvas(store.project, store.project.activeCanvas);
  store.activeCanvasId = ref ? ref.canvas.id : firstCanvasId();
  // 恢复出来的内容就是「当前状态」，把它当作已保存的基准。
  // 否则一开机就顶着「未保存」，关窗时还会问要不要保存。
  resetDirtyBaseline();
  emit('load');
  return store.project;
}

function firstCanvasId() {
  for (const m of store.project.modules) if (m.canvases.length) return m.canvases[0].id;
  // 一个画布都没有就建一个
  const m = store.project.modules[0] || (store.project.modules.push(M.newModule()), store.project.modules[0]);
  const c = M.newCanvas('新画布', 'main');
  m.canvases.push(c);
  return c.id;
}

export function activeRef() {
  return M.findCanvas(store.project, store.activeCanvasId);
}

export function activeCanvas() {
  const r = activeRef();
  return r ? r.canvas : null;
}

export function activeModule() {
  const r = activeRef();
  return r ? r.module : store.project.modules[0];
}

export function setActiveCanvas(id) {
  store.activeCanvasId = id;
  store.project.activeCanvas = id;
  store.selection = [];
  emit('canvas');
  autoSave();
}

// ---------------- 撤销 / 重做 ----------------

function snapshot() {
  return JSON.stringify({ project: store.project, activeCanvasId: store.activeCanvasId });
}

/** 在修改前调用，记录快照 */
export function pushUndo() {
  store.undoStack.push(snapshot());
  if (store.undoStack.length > 100) store.undoStack.shift();
  store.redoStack.length = 0;
}

// 连续输入合并：同一个字段在短时间内连续变化，只记一次撤销点，
// 否则打一个词就会产生十几个撤销步骤。
let lastEditKey = null;
let lastEditAt = 0;
const EDIT_COALESCE_MS = 900;

function pushUndoCoalesced(key) {
  const now = Date.now();
  if (key && key === lastEditKey && now - lastEditAt < EDIT_COALESCE_MS) {
    lastEditAt = now;
    return;
  }
  lastEditKey = key;
  lastEditAt = now;
  pushUndo();
}

function restore(snap) {
  const o = JSON.parse(snap);
  store.project = o.project;
  store.activeCanvasId = o.activeCanvasId;
  emit('load');
}

export function undo() {
  if (!store.undoStack.length) return false;
  store.redoStack.push(snapshot());
  restore(store.undoStack.pop());
  emit('undo');
  return true;
}

export function redo() {
  if (!store.redoStack.length) return false;
  store.undoStack.push(snapshot());
  restore(store.redoStack.pop());
  emit('redo');
  return true;
}

export function canUndo() { return store.undoStack.length > 0; }
export function canRedo() { return store.redoStack.length > 0; }

// ---------------- 持久化 ----------------

/**
 * 控件库分类的展开状态。刻意**不**存盘：必须是「每次进来都是干净的折叠态」，
 * 只存在内存里，重启必然回到全折叠。
 */
export const ui = {
  openGroups: [],
};

export function loadUiPrefs() {
  ui.openGroups = [];
}

export function saveUiPrefs() {
  /* 不再持久化：见上面 openGroups 的说明 */
}

/** 分类是否展开 */
export function isGroupOpen(key) { return ui.openGroups.includes(key); }

/** 切换分类展开状态（仅本次运行内有效） */
export function toggleGroup(key) {
  const i = ui.openGroups.indexOf(key);
  if (i >= 0) ui.openGroups.splice(i, 1);
  else ui.openGroups.push(key);
  return i < 0;
}

let saveTimer = null;
export function autoSave() {
  if (saveTimer) clearTimeout(saveTimer);
  // 间隔可在设置里调（默认 400ms）
  const delay = Math.max(100, Number(S.get('autosaveMs')) || 400);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, M.serialize(store.project));
    } catch (e) { /* 忽略配额错误 */ }
  }, delay);
}

/**
 * 立刻把工程写进本地存档（不等自动保存的定时器）。
 * 给「安全重载界面」（F5 拦截）用：刷新前必须同步写完，否则 setTimeout
 * 里那次保存会随着页面卸载一起丢掉。
 * @returns {boolean} 是否写成功
 */
export function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    localStorage.setItem(LS_KEY, M.serialize(store.project));
    return true;
  } catch (e) { return false; }
}

// ---------------- 「有没有没存成文件」 ----------------

/**
 * 最近一次「保存为 .saproj」或「打开工程」时的工程快照。
 *
 * 用快照对比而不是 dirty 布尔：布尔只能表示「动过」，撤销回原样或改完又改回去
 * 它都会一直亮着；存一份序列化结果来比，才能回答「现在和上次存盘是不是一样」。
 * 这里说的是「存成文件」，和自动保存到 localStorage 是两回事：后者是防崩溃的
 * 兜底，这里管的是用户心里那个「我存了吗」。
 */
let savedSnapshot = null;

/**
 * 做「有没有改动」比对时用的快照。
 *
 * 关键在于**剔除 `activeCanvas`**：那只是「用户现在站在哪个画布上」的光标，
 * 不是工程内容。不剔掉的话，光是切标签页、或者从首页点进某个插件组，
 * 序列化结果就变了 —— 明明一个字没改，状态栏却亮起「未保存」，
 * 关窗还要拦一道问要不要保存。
 */
function contentSnapshot() {
  try {
    const project = store.project;
    if (!project) return null;
    // 无条件剔除 activeCanvas —— 注意不能「只有它非空时才剔」：
    // 那样基准里留着 "activeCanvas": null、切换后却整个键消失，
    // 两边照样对不上，等于白改。
    const { activeCanvas, ...rest } = project;
    return M.serialize(rest);
  } catch (e) {
    return null;
  }
}

/** 记下「此刻就是已保存状态」 */
export function markSaved() {
  savedSnapshot = contentSnapshot();
}

/** 现在有没有未保存到文件的改动 */
export function isDirty() {
  if (savedSnapshot === null) return false;   // 还没基准（刚启动的新工程）
  const now = contentSnapshot();
  if (now === null) return false;
  return now !== savedSnapshot;
}

/** 建立一个「干净」基准。启动时从 localStorage 恢复出来的状态就当作已保存。 */
export function resetDirtyBaseline() { markSaved(); }

export function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return M.parse(raw);
  } catch (e) {
    console.warn('本地存档损坏，已忽略', e);
    return null;
  }
}

export function clearLocal() {
  localStorage.removeItem(LS_KEY);
  // 顺手清掉旧版本留下的界面偏好键
  localStorage.removeItem(LS_UI);
}

export function replaceProject(p) {
  pushUndo();
  store.project = p;
  store.activeCanvasId = (function () {
    for (const m of p.modules) if (m.canvases.length) return m.canvases[0].id;
    return null;
  })();
  if (!store.activeCanvasId) store.activeCanvasId = firstCanvasId();
  emit('load');
  autoSave();
}

// ---------------- 画布/节点操作（都带撤销） ----------------

export function addNode(defKey, x, y, props) {
  pushUndo();
  const c = activeCanvas();
  const n = M.newNode(defKey, x, y, props);
  c.nodes.push(n);
  emit('node');
  autoSave();
  return n;
}

export function removeNodes(ids) {
  if (!ids.length) return;
  pushUndo();
  const c = activeCanvas();
  c.nodes = c.nodes.filter(n => !ids.includes(n.id));
  c.edges = c.edges.filter(e => !ids.includes(e.from.node) && !ids.includes(e.to.node));
  store.selection = store.selection.filter(id => !ids.includes(id));
  emit('node');
  autoSave();
}

export function moveNode(id, x, y) {
  const c = activeCanvas();
  const n = c.nodes.find(v => v.id === id);
  if (!n) return;
  n.x = Math.round(x);
  n.y = Math.round(y);
  autoSave();
}

export function setProp(nodeId, key, value) {
  const c = activeCanvas();
  const n = c.nodes.find(v => v.id === nodeId);
  if (!n) return;
  if (n.props && n.props[key] === value) return;   // 值没变就不动
  pushUndoCoalesced(`${nodeId}.${key}`);
  if (!n.props) n.props = {};
  n.props[key] = value;
  // 这里发 'props' 而不是 'node'：属性变化通常来自右侧面板的输入框，触发整体
  // 重绘会把正在输入的 <input> 用 innerHTML 替换掉。
  emit('props');
  autoSave();
}

export function connect(from, to) {
  pushUndo();
  const c = activeCanvas();
  const r = M.addStructuralEdge(c, from, to);
  emit('edge');
  autoSave();
  return r;
}
export function removeEdge(edgeId) {
  pushUndo();
  const c = activeCanvas();
  c.edges = c.edges.filter(e => e.id !== edgeId);
  emit('edge');
  autoSave();
}

/**
 * 删掉某个节点的**全部**连线（右键菜单「断开所有连线」）。单独一个函数而不是
 * 循环调 removeEdge：后者每次都 pushUndo()，循环十次就往撤销栈里塞十个快照，
 * 而按一次 Ctrl+Z 只该撤销这一次断开。
 */
export function removeEdgesOf(nodeId) {
  const c = activeCanvas();
  const linked = c.edges.filter(e => e.from.node === nodeId || e.to.node === nodeId);
  if (!linked.length) return 0;
  // pushUndo 必须在改动之前，它记的是当前（改前）快照
  pushUndo();
  c.edges = c.edges.filter(e => e.from.node !== nodeId && e.to.node !== nodeId);
  emit('edge');
  autoSave();
  return linked.length;
}

// ---------------- 模块 / 画布管理 ----------------

export function addCanvas(moduleId, title, file) {
  pushUndo();
  const m = store.project.modules.find(x => x.id === moduleId) || store.project.modules[0];
  const base = M.toFileName(file || title || 'main', 'main');
  const used = new Set(m.canvases.map(c => c.file));
  let f = base, i = 2;
  while (used.has(f)) { f = base + i; i++; }
  const c = M.newCanvas(title || '新画布', f);
  m.canvases.push(c);
  store.activeCanvasId = c.id;
  emit('canvas');
  autoSave();
  return c;
}

export function removeCanvas(canvasId) {
  const ref = M.findCanvas(store.project, canvasId);
  if (!ref) return;
  if (ref.module.canvases.length <= 1) return false;
  pushUndo();
  ref.module.canvases = ref.module.canvases.filter(c => c.id !== canvasId);
  if (store.activeCanvasId === canvasId) store.activeCanvasId = ref.module.canvases[0].id;
  emit('canvas');
  autoSave();
  return true;
}

export function renameCanvas(canvasId, title, file) {
  const ref = M.findCanvas(store.project, canvasId);
  if (!ref) return;
  pushUndo();
  ref.canvas.title = title;
  if (file) ref.canvas.file = M.toFileName(file, ref.canvas.file);
  emit('canvas');
  autoSave();
}

export function addModule(name) {
  pushUndo();
  const id = M.toModuleId(name, 'module' + (store.project.modules.length + 1));
  const m = M.newModule(id);
  m.canvases[0].title = '新画布';
  m.canvases[0].file = 'main';
  store.project.modules.push(m);
  store.activeCanvasId = m.canvases[0].id;
  emit('canvas');
  autoSave();
  return m;
}

export function removeModule(moduleId) {
  if (store.project.modules.length <= 1) return false;
  pushUndo();
  store.project.modules = store.project.modules.filter(m => m.id !== moduleId);
  const first = store.project.modules[0];
  if (!M.findCanvas(store.project, store.activeCanvasId)) store.activeCanvasId = first.canvases[0] ? first.canvases[0].id : null;
  emit('canvas');
  autoSave();
  return true;
}

export function setModuleDep(moduleId, dep, on) {
  const m = store.project.modules.find(x => x.id === moduleId);
  if (!m) return;
  pushUndo();
  m.deps = m.deps || [];
  if (on && !m.deps.includes(dep)) m.deps.push(dep);
  if (!on) m.deps = m.deps.filter(d => d !== dep);
  emit('module');
  autoSave();
}

export function setModuleId(moduleId, newId) {
  const id = M.toModuleId(newId, moduleId);
  if (id === moduleId) return;
  pushUndo();
  const m = store.project.modules.find(x => x.id === moduleId);
  if (m) m.id = id;
  emit('module');
  autoSave();
}
