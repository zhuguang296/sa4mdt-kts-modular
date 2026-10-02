// 校验：轻量结构校验 + 名称冲突检查
// 错误（阻断导出）与警告（放行）分开返回

import { defOf } from './catalog/index.js';
import { generatePlugin } from './generate.js';
import { structuralInEdges, outEdges, isRootNode, toFileName, toModuleId } from './model.js';

const RESERVED = new Set([
  'it', 'this', 'true', 'false', 'null', 'if', 'else', 'for', 'while', 'when',
  'val', 'var', 'fun', 'class', 'object', 'return', 'break', 'continue', 'in', 'is',
  'player', 'state', 'world', 'unit', 'tile', 'team', 'message', 'Groups', 'Call',
]);

/**
 * 校验整个工程
 * @returns {{errors:Array<{level,scope,message,nodeId?}>, warnings:Array}}
 */
export function validateProject(project) {
  const errors = [];
  const warnings = [];
  const E = (message, extra = {}) => errors.push({ level: 'error', message, ...extra });
  const W = (message, extra = {}) => warnings.push({ level: 'warn', message, ...extra });

  // ---- 生成一次，收集生成期错误 ----
  let gen;
  try {
    gen = generatePlugin(project);
  } catch (e) {
    E('生成代码时发生意外错误：' + e.message);
    return { errors, warnings };
  }
  for (const e of gen.errors) {
    errors.push({
      level: 'error', nodeId: e.nodeId, canvas: e.canvas, canvasTitle: e.canvasTitle,
      module: e.module, message: e.message,
    });
  }
  for (const w of gen.warnings) {
    warnings.push({
      level: 'warn', nodeId: w.nodeId, canvas: w.canvas, canvasTitle: w.canvasTitle,
      module: w.module, message: w.message,
    });
  }

  // ---- 模块级检查 ----
  const moduleIds = new Set();
  const allFiles = new Set();
  for (const m of project.modules) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.id)) {
      E(`模块名「${m.id}」不合法：只能用字母、数字、下划线，且不能以数字开头`, { module: m.id });
    }
    if (moduleIds.has(m.id)) E(`有两个模块都叫「${m.id}」，名字必须唯一`, { module: m.id });
    moduleIds.add(m.id);
    if (!m.canvases.length) W(`模块「${m.id}」里没有任何画布`, { module: m.id });

    const fileNames = new Set();
    for (const c of m.canvases) {
      const f = String(c.file || '').trim();
      if (!f) E(`画布「${c.title}」没有文件名`, { module: m.id, canvas: c.id });
      else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f)) {
        E(`画布文件名「${f}」不合法：只能用字母、数字、下划线，且不能以数字开头`, { module: m.id, canvas: c.id });
      }
      if (fileNames.has(f)) E(`模块「${m.id}」里有多个画布都叫 ${f}.kts`, { module: m.id, canvas: c.id });
      fileNames.add(f);
      const full = `${m.id}/${f}.kts`;
      if (allFiles.has(full)) E(`文件名冲突：${full}`, { module: m.id, canvas: c.id });
      allFiles.add(full);
      if (!c.nodes.length) W(`画布「${c.title}」是空的`, { module: m.id, canvas: c.id, canvasTitle: c.title });
    }
  }

  // ---- 画布级检查 ----
  const commandNames = new Map();
  for (const m of project.modules) {
    for (const c of m.canvases) {
      checkCanvas(c, m, E, W, commandNames);
    }
  }

  return { errors, warnings };
}

function checkCanvas(c, m, E, W, commandNames) {
  const ctxInfo = { module: m.id, canvas: c.id, canvasTitle: c.title };

  // 同名变量（同一画布内、同一层作用域）— 近似检查：同一直链上的重复名
  const seenData = new Map();

  for (const n of c.nodes) {
    const d = defOf(n.def);
    if (!d) {
      E(`不认识这个功能块：${n.def}`, { ...ctxInfo, nodeId: n.id });
      continue;
    }

    // 必填参数
    for (const p of d.props || []) {
      if (p.type === 'rules') continue;
      if (!p.required) continue;
      if (p.showIf && !propVisible(n, p)) continue;
      const v = n.props ? n.props[p.key] : undefined;
      if (v == null || String(v).trim() === '') {
        E(`「${d.label}」的「${p.label}」还没填`, { ...ctxInfo, nodeId: n.id });
      }
    }

    // 布尔规则组
    for (const p of d.props || []) {
      if (p.type !== 'rules') continue;
      const rules = (n.props && n.props.rules) || [];
      if (!rules.length) E(`「${d.label}」还没有添加条件`, { ...ctxInfo, nodeId: n.id });
      for (const r of rules) {
        if (!r.var) E(`「${d.label}」里有一条条件没选对象`, { ...ctxInfo, nodeId: n.id });
        if (!r.field) E(`「${d.label}」里有一条条件没选属性`, { ...ctxInfo, nodeId: n.id });
      }
    }

    // 指令重名
    if (n.def === 'action.registerCommand') {
      const name = String((n.props && n.props.name) || '').trim();
      if (name) {
        if (/\s/.test(name)) E(`指令名字不能有空格：${name}`, { ...ctxInfo, nodeId: n.id });
        const prev = commandNames.get(name);
        if (prev) {
          E(`有两个画布都注册了指令「${name}」（另一个在「${prev}」），会冲突`, { ...ctxInfo, nodeId: n.id });
        } else {
          commandNames.set(name, c.title);
        }
      }
    }

    // 变量名合法性
    const nameLike = ['data.value', 'action.config', 'action.savable', 'query.units', 'loop.forEach'];
    if (nameLike.includes(n.def)) {
      const key = n.def === 'loop.forEach' ? 'itemName' : 'name';
      const nm = String((n.props && n.props[key]) || '').trim();
      if (nm) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nm)) {
          E(`名字「${nm}」不合法：只能用字母、数字、下划线，且不能以数字开头`, { ...ctxInfo, nodeId: n.id });
        } else if (RESERVED.has(nm)) {
          W(`名字「${nm}」和系统内置的名字一样，建议换一个`, { ...ctxInfo, nodeId: n.id });
        }
      }
    }

    // 需要额外依赖的控件：生成时会自动把 requiresDeps 补进文件头（generate.js），
    // 不需要用户手动在模块配置里勾，所以这里不再发警告。

    // 孤立节点
    if (isRootNode(c, n.id) && !d.isRoot && d.category !== 'event' && !d.canBeRoot) {
      // 本身是根节点但它是动作 -> 没法执行
      if (d.category === 'action' && !d.isRoot) {
        W(`「${d.label}」没有接在任何起点后面，不会被触发`, { ...ctxInfo, nodeId: n.id });
      }
    }
    if (d.category === 'event' && outEdges(c, n.id, 'out').length === 0) {
      W(`「${d.label}」后面还没有要做的事`, { ...ctxInfo, nodeId: n.id });
    }
  }
}

function propVisible(node, p) {
  if (!p.showIf) return true;
  for (const [k, v] of Object.entries(p.showIf)) {
    if ((node.props || {})[k] !== v) return false;
  }
  return true;
}

/** 只做语法层面的括号/引号配平检查（对导出的每个文件） */
export function checkBalance(text) {
  const problems = [];
  let paren = 0, brace = 0, bracket = 0, inStr = false, inChar = false, inLineComment = false, inBlockComment = false;
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    inLineComment = false;
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      inBlockComment = false;
    }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i], nx = line[i + 1];
      if (inLineComment) break;
      if (inStr) {
        if (ch === '\\') { i++; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '/' && nx === '/') { inLineComment = true; continue; }
      if (ch === '/' && nx === '*') { inBlockComment = true; i++; continue; }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') brace++;
      else if (ch === '}') brace--;
      else if (ch === '(') paren++;
      else if (ch === ')') paren--;
      else if (ch === '[') bracket++;
      else if (ch === ']') bracket--;
      if (brace < 0) problems.push({ line: li + 1, message: '多了一个 }' });
      if (paren < 0) problems.push({ line: li + 1, message: '多了一个 )' });
      if (bracket < 0) problems.push({ line: li + 1, message: '多了一个 ]' });
    }
  }
  if (inStr) problems.push({ line: lines.length, message: '有一个双引号没有闭合' });
  if (brace > 0) problems.push({ line: lines.length, message: `还差 ${brace} 个 }` });
  if (brace < 0) problems.push({ line: lines.length, message: `多了 ${-brace} 个 }` });
  if (paren > 0) problems.push({ line: lines.length, message: `还差 ${paren} 个 )` });
  if (bracket > 0) problems.push({ line: lines.length, message: `还差 ${bracket} 个 ]` });
  return problems;
}

/** 对生成结果做一次配平自检（属于我们的 bug，不是用户的） */
export function selfCheck(files) {
  const out = [];
  for (const f of files) {
    const p = checkBalance(f.content);
    for (const x of p) out.push({ file: f.path, ...x });
  }
  return out;
}
