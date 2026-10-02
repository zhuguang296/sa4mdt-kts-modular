// 工程数据模型：Project / Module / Canvas / Node / Edge
// 以及连线规则（禁环、结构入线唯一、同级按画布位置排序）

export const FORMAT = 'saproj';
export const FORMAT_VERSION = 1;

let seq = 0;
export function newId(prefix = 'n') {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

export function newCanvas(title = '新画布', file = 'main') {
  return { id: newId('c'), file, title, nodes: [], edges: [] };
}

export function newModule(id = 'myPlugin') {
  return { id, deps: ['coreMindustry'], canvases: [newCanvas('新画布', 'main')] };
}

export function newProject(name = '我的插件') {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    plugin: { name, author: '', description: '' },
    modules: [newModule('myPlugin')],
    activeCanvas: null,
    ui: { guide: true },
  };
}

export function newNode(defKey, x, y, props = {}) {
  return { id: newId('n'), def: defKey, x: Math.round(x), y: Math.round(y), props };
}

// ---------------- 查找 ----------------

export function allCanvases(project) {
  const out = [];
  for (const m of project.modules) for (const c of m.canvases) out.push({ module: m, canvas: c });
  return out;
}

export function findModuleOfCanvas(project, canvasId) {
  return project.modules.find(m => m.canvases.some(c => c.id === canvasId)) || null;
}

export function findCanvas(project, canvasId) {
  for (const m of project.modules) {
    const c = m.canvases.find(x => x.id === canvasId);
    if (c) return { module: m, canvas: c };
  }
  return null;
}

export function nodeById(canvas, id) {
  return canvas.nodes.find(n => n.id === id) || null;
}

// ---------------- 连线 ----------------

/** 某节点的结构入线（kind=flow 且指向该节点的入端口） */
export function structuralInEdges(canvas, nodeId) {
  return canvas.edges.filter(e => e.kind !== 'ref' && e.to.node === nodeId);
}

/** 某节点某出端口的下游连线 */
export function outEdges(canvas, nodeId, portId) {
  return canvas.edges.filter(e => e.kind !== 'ref' && e.from.node === nodeId &&
    (portId == null || e.from.port === portId));
}

/** 该节点有无结构入线（即它是不是根） */
export function isRootNode(canvas, nodeId) {
  return structuralInEdges(canvas, nodeId).length === 0;
}

/**
 * 连线合法性检查。from / to 形如 {node, port}（不含 def，由画布里的节点查出来）。
 */
export function checkConnect(canvas, from, to, defs) {
  const fromNode = nodeById(canvas, from.node);
  const toNode = nodeById(canvas, to.node);
  if (!fromNode || !toNode) return { ok: false, reason: '找不到要连的控件，看看是不是已经删掉了' };
  const fromDef = defs.defOf(fromNode.def);
  const toDef = defs.defOf(toNode.def);
  if (!fromDef || !toDef) return { ok: false, reason: '不认识的控件' };
  if (from.node === to.node) return { ok: false, reason: '不能连到自己：一个控件不能接到它自己后面' };

  const fp = (fromDef.outPorts || []).find(p => p.id === from.port);
  const tp = (toDef.inPorts || []).find(p => p.id === to.port);
  if (!fp) return { ok: false, reason: `「${fromDef.label}」没有这个出口：出口是它右侧的小圆点，别从别的地方拉线` };
  if (!tp) return { ok: false, reason: `「${toDef.label}」没有这个入口：入口是它左侧的小圆点，别接到别的地方` };

  if (fp.type !== 'flow' || tp.type !== 'flow') {
    return { ok: false, reason: '只有「执行」类型的接口可以连线：普通数据/引用接口不是用来连线的，直接在下拉里选就行' };
  }
  if ((toDef.inPorts || []).length === 0) {
    return { ok: false, reason: `「${toDef.label}」是起点（自己触发），不能接在别的控件后面` };
  }
  if (fromDef.key === toDef.key && toDef.isRoot) return { ok: false, reason: '这类控件不能嵌套自己：同一个起点控件不能放进它自己里面' };

  // 禁环
  if (reaches(canvas, to.node, from.node)) {
    return { ok: false, reason: `「${toDef.label}」已经在「${fromDef.label}」里面了，连回去会绕成死循环` };
  }
  return { ok: true };
}

/** 从 start 沿出线能否到达 target */
function reaches(canvas, start, target) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of canvas.edges) {
      if (e.kind === 'ref') continue;
      if (e.from.node === cur) stack.push(e.to.node);
    }
  }
  return false;
}

/** 加一条结构线（直接改 canvas.edges）。结构入线唯一：目标已有入线就替换掉旧的。 */
export function addStructuralEdge(canvas, from, to) {
  const kept = canvas.edges.filter(e => !(e.kind !== 'ref' && e.to.node === to.node && e.to.port === to.port));
  const replaced = kept.length !== canvas.edges.length;
  const edge = { id: newId('e'), from, to, kind: 'flow' };
  kept.push(edge);
  canvas.edges = kept;
  return { edges: kept, replaced, edge };
}

/** 删除与某节点相关的所有连线 */
export function removeNodeEdges(canvas, nodeId) {
  canvas.edges = canvas.edges.filter(e => e.from.node !== nodeId && e.to.node !== nodeId);
}

/** 多入线兜底：按优先级选出唯一嵌套父，其余降级为引用线。优先级数字越大越优先。 */
const PARENT_PRIORITY = { condition: 60, loop: 50, timer: 40, event: 30, action: 20, query: 10, data: 10 };

export function normalizeEdges(canvas, defs) {
  const warnings = [];
  const byTarget = new Map();
  for (const e of canvas.edges) {
    if (e.kind === 'ref') continue;
    const k = `${e.to.node}::${e.to.port}`;
    if (!byTarget.has(k)) byTarget.set(k, []);
    byTarget.get(k).push(e);
  }
  const drop = new Set();
  for (const [k, list] of byTarget) {
    if (list.length <= 1) continue;
    // 优先级最高的那个当父节点
    let best = list[0], bestP = -1;
    for (const e of list) {
      const d = defs.defOf((canvas.nodes.find(n => n.id === e.from.node) || {}).def);
      const p = d ? (PARENT_PRIORITY[d.category] || 0) : 0;
      if (p > bestP) { bestP = p; best = e; }
    }
    for (const e of list) {
      if (e === best) continue;
      e.kind = 'ref';
      const t = canvas.nodes.find(n => n.id === e.to.node);
      warnings.push(`「${t ? t.def : e.to.node}」有多条入线，已只保留一条作为嵌套关系，其余的按「引用」处理`);
    }
  }
  return warnings;
}

/** 同级排序：上→下，同 Y 再左→右 */
export function sortSiblings(nodes) {
  return [...nodes].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

// ---------------- 存取 ----------------

export function serialize(project) {
  return JSON.stringify(project, null, 2);
}

export function parse(text) {
  const obj = JSON.parse(text);
  if (!obj || obj.format !== FORMAT) throw new Error('这不是一个有效的 .saproj 工程文件');
  if (!Array.isArray(obj.modules) || !obj.modules.length) throw new Error('工程里没有任何模块');
  for (const m of obj.modules) {
    if (!Array.isArray(m.canvases)) m.canvases = [];
    for (const c of m.canvases) {
      if (!Array.isArray(c.nodes)) c.nodes = [];
      if (!Array.isArray(c.edges)) c.edges = [];
    }
  }
  return obj;
}

/** 稳定的短哈希（FNV-1a -> base36），用于给纯中文名字生成可用的英文名 */
function shortHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).slice(0, 4);
}

/**
 * 把中文/任意名字转成合法的英文模块名：纯 ASCII 转小写驼峰
 * （"hello world" -> "helloWorld"）；含非 ASCII 时保留能用的英文字母，否则用
 * plugin+短哈希，保证同一名字每次结果一致、不同名字不撞车。
 */
export function toModuleId(name, fallback = 'myPlugin') {
  const s = String(name || '').trim();
  if (!s) return fallback;

  if (/^[\x20-\x7e]+$/.test(s)) {
    const parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
    if (!parts.length) return fallback;
    const head = parts[0].toLowerCase();
    const tail = parts.slice(1).map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join('');
    let id = head + tail;
    if (/^[0-9]/.test(id)) id = '_' + id;
    return id || fallback;
  }

  // 含非 ASCII 字符：取其中可用的 ASCII 字母数字部分
  const ascii = s.replace(/[^A-Za-z0-9]/g, '');
  const base = ascii && /[A-Za-z_]/.test(ascii[0]) ? ascii[0].toLowerCase() + ascii.slice(1) : '';
  const head = base ? base.charAt(0).toLowerCase() + base.slice(1) : 'plugin';
  return head + shortHash(s);
}

/** 文件名合法化：中文等无法直译时用 pinyin 无从谈起，改用稳定哈希后缀避免互相撞名 */
export function toFileName(name, fallback = 'main') {
  const s = String(name || '').trim();
  if (!s) return fallback;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return s;

  const ascii = s.replace(/[^A-Za-z0-9_]/g, '');
  if (ascii && /^[A-Za-z_]/.test(ascii)) {
    const cleaned = ascii.replace(/^([0-9])/, '_$1');
    return cleaned || fallback;
  }
  return 'canvas' + shortHash(s);
}
