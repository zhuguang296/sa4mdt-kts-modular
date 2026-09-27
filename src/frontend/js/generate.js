// 代码生成器：CanvasModel -> .kts 文本。目标是与工作区
// ScriptAgent4MindustryExt-3.4.0-scripts 的真实 DSL 一致。
//
// 生成分两趟：第一趟 prescan 递归走整棵子树，记录每个节点真正用到了哪些
// 上下文变量；第二趟据此只为「确实用得上」的变量生成 val 绑定。

import { sortSiblings, structuralInEdges, outEdges, nodeById } from './model.js';
import { defOf } from './catalog/index.js';
import { nodeAnchor } from './anchor.js';

const IND = '    ';

// coreMindustry/module.kts 的 defaultImport 只覆盖 arc.Core、mindustry.Vars.*、
// mindustry.content.*、mindustry.gen.Player / Call / Groups、
// mindustry.game.EventType、coreMindustry.lib.*；Team / Color 这类符号必须逐文件
// 显式 import。生成完成后扫正文，用到谁补谁 —— 多写只是警告，漏写编译不过。
// Items / UnitTypes / StatusEffects / Groups / Call / MsgType / state 已被覆盖。
const AUTO_IMPORTS = [
  [/\bTeam\b/, 'mindustry.game.Team'],
  [/\bColor\b/, 'arc.graphics.Color'],
  // Fx 不需要 import：coreMindustry 的 defaultImport 覆盖了 mindustry.content.*，
  // 工作区脚本里没有任何一处 import Fx。多写反而出错。
  [/\bEffect\b/, 'mindustry.entities.Effect'],
  [/\bTile\b/, 'mindustry.world.Tile'],
  [/\bUnitType\b/, 'mindustry.type.UnitType'],
  [/\bBlock\b/, 'mindustry.world.Block'],
  [/\bItem\b/, 'mindustry.type.Item'],
  // 以下为新增控件用到、且不在 coreMindustry 默认导入里的符号
  [/\bUnits\./, 'mindustry.entities.Units'],
  [/\bTime\./, 'arc.util.Time'],
  [/\bRandom\b/, 'kotlin.random.Random'],
  [/\bMathf\b/, 'arc.math.Mathf'],
  [/\bAlign\b/, 'arc.util.Align'],
  [/\bInterval\b/, 'arc.util.Interval'],
  // Building 在 mindustry.gen 下（工作区 3 处都这么导），不是 mindustry.world
  [/\bBuilding\b/, 'mindustry.gen.Building'],
  [/\bUnit\b/, 'mindustry.gen.Unit'],
  [/\bCoreBuild\b/, 'mindustry.world.blocks.storage.CoreBlock.CoreBuild'],
  [/\bIconc\b/, 'mindustry.gen.Iconc'],
];

/** 扫一遍正文，返回需要的 import 语句（已排序去重） */
function scanImports(bodyText, deps) {
  const out = new Set();
  // coreLibrary 没被依赖时 Team/Items 等可能来自别处；这里只按符号补，依赖是否
  // 存在由 validate.js 的 requiresDeps 负责提醒。
  for (const [re, cls] of AUTO_IMPORTS) {
    if (re.test(bodyText)) out.add(`import ${cls}`);
  }
  return out;
}

// ---------------- 字面量 ----------------

export function kotlinString(s) {
  const body = String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/\r?\n/g, '\\n');
  return `"${body}"`;
}

export function kotlinNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return String(n);
}

// ---------------- 作用域 ----------------

class Scope {
  constructor(parent, vars, used) {
    this.parent = parent || null;
    this.vars = vars || [];
    this.used = used || null;
  }
  withRecorder(used) {
    return new Scope(this.parent, this.vars, used);
  }
  child(vars) {
    return new Scope(this, vars, this.used);
  }
  lookup(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    let s = this;
    while (s) {
      for (let i = s.vars.length - 1; i >= 0; i--) {
        if (s.vars[i].name === n) {
          if (this.used) this.used.add(n);
          return s.vars[i].expr;
        }
      }
      s = s.parent;
    }
    return null;
  }
  lookupType(type) {
    let s = this;
    while (s) {
      for (let i = s.vars.length - 1; i >= 0; i--) {
        if (s.vars[i].type === type) {
          if (this.used) this.used.add(s.vars[i].name);
          return s.vars[i].expr;
        }
      }
      s = s.parent;
    }
    return null;
  }
  has(name) { return this.lookup(name) != null; }
}

function makeApi(scope, env) {
  return {
    varOf: (n) => scope.lookup(n),
    varOfType: (t) => scope.lookupType(t),
    hasVar: (n) => scope.has(n),
    lit: kotlinString,
    num: kotlinNumber,
    bool: (v) => (v ? 'true' : 'false'),
    /** 声明这段代码需要某个 import。参数写全限定类名；已带 "import " 前缀的原样收下。 */
    need: (cls) => {      if (!env || !env.imports || !cls) return;
      const s = String(cls).trim();
      if (!s) return;
      env.imports.add(/^import\s/.test(s) ? s : `import ${s}`);
    },
    /**
     * 当前位置用于提前返回的 lambda 标签（如 listen / loop / body）。「到此为止」
     * 靠它生成 return@xxx，写错就编译不过；不在 lambda 里返回 null。
     */
    returnLabel: () => {
      const st = env && env.labelStack;
      return st && st.length ? st[st.length - 1] : null;
    },
    /**
     * 把界面上的消息文本转成带占位符替换的 Kotlin 表达式。只有当前作用域里真
     * 存在的名字才会被替换（{foo} 找不到就原样留着）。
     * 即使没有占位符也要输出 `.with()`：broadcast / sendMessage / logger 收的是
     * PlaceHoldString（ContentHelper.kt:39,54），不是普通 String，少 .with() 编译不过。
     * 第二个参数（候选名字）已忽略，只为兼容旧调用。
     */
    msgTemplate(text) {
      const t = String(text == null ? '' : text);
      const used = [];
      const re = /\{([A-Za-z_][A-Za-z0-9_]*)/g;
      let m;
      while ((m = re.exec(t))) {
        const n = m[1];
        if (!used.includes(n) && scope.has(n)) used.push(n);
      }
      const base = kotlinString(t);
      // 无占位符时也要 .with()：类型是 PlaceHoldString
      if (!used.length) return `${base}.with()`;
      return `${base}.with(${used.map(n => `${kotlinString(n)} to ${scope.lookup(n)}`).join(', ')})`;
    },
  };
}

// ---------------- 通用小工具 ----------------

/** 取某端口下排好序的子节点 */
function childrenOfPort(canvas, nodeId, portId) {
  return sortSiblings(
    outEdges(canvas, nodeId, portId)
      .map(e => nodeById(canvas, e.to.node))
      .filter(Boolean)
  );
}

/** 取节点产出、可供后续兄弟使用的变量（静态声明 produces） */
function outVarsOf(node, d) {
  return (d.produces || []).map(p => {
    const name = p.nameFrom ? node.props[p.nameFrom] : p.name;
    return name ? { name: String(name), type: p.type, expr: String(name) } : null;
  }).filter(Boolean);
}

/** 取节点「给自己的子节点」新增的变量：静态 produces 加 emit() 返回的 provides。 */
function ownProvidedVars(node, d, vars) {
  const base = outVarsOf(node, d);
  const scope = new Scope(null, vars.map(v => ({
    name: v.name, type: v.type, expr: v.expr != null ? v.expr : v.name,
  })), null);
  let res;
  try {
    res = d.emit(node, makeApi(scope)) || {};
  } catch (_) {
    return base;
  }
  const runtime = normVars(res.provides);
  const seen = new Set(base.map(v => v.name));
  for (const v of runtime) if (!seen.has(v.name)) { base.push(v); seen.add(v.name); }
  return base;
}

/** 候选上下文变量（用于 prescan 里的宽作用域） */
function candidateContexts(d) {
  return (d.contexts || []).map(c => ({ name: c.name, type: c.type, expr: c.expr }));
}

/** 规范化控件返回的变量声明：expr 缺省时用变量名本身（写 `provides:[{name:'targets'}]` 即可）。 */
function normVars(list) {
  return (list || []).map(v => ({
    name: v.name,
    type: v.type,
    expr: v.expr != null ? v.expr : v.name,
  })).filter(v => v.name);
}

/**
 * 在画布上按生成顺序 DFS，收集「执行到 nodeId 时作用域里已有的变量」。
 * 界面的变量下拉和生成器共用这一份遍历逻辑，避免两边不一致。
 * @returns {Array<{name, type, expr, label}>}
 */
export function varsInScopeAt(canvas, nodeId) {
  const out = [];
  let found = false;

  const visit = (node, vars) => {
    if (found) return;
    if (node.id === nodeId) { out.push(...vars); found = true; return; }
    const d = defOf(node.def);
    if (!d) return;

    // 事件带来的上下文变量
    let next = [...vars];
    for (const c of d.contexts || []) {
      if (!next.some(v => v.name === c.name)) {
        next.push({ name: c.name, type: c.type, label: `${c.name}（${typeName(c.type)}）` });
      }
    }

    // 本节点对自己子节点新增的变量，与生成器 childScope 的构造保持一致
    const own = ownProvidedVars(node, d, next)
      .map(v => ({ name: v.name, type: v.type, label: v.name }));
    const childVars = [...next];
    for (const v of own) if (!childVars.some(x => x.name === v.name)) childVars.push(v);

    for (const pt of d.outPorts || []) {
      let sc = childVars;
      for (const k of childrenOfPort(canvas, node.id, pt.id)) {
        visit(k, sc);
        if (found) return;
        // 这个兄弟产出的变量，后面的兄弟也能用。只用静态 produces —— 运行时
        // provides 只在自己的作用域内有效，出了花括号就没了。
        const kd = defOf(k.def);
        const ov = kd ? outVarsOf(k, kd) : [];
        for (const v of ov) {
          if (!sc.some(x => x.name === v.name)) {
            sc = [...sc, { name: v.name, type: v.type, label: v.name }];
          }
        }
      }
    }
  };

  const roots = sortSiblings(canvas.nodes.filter(n => structuralInEdges(canvas, n.id).length === 0));
  for (const r of roots) {
    visit(r, []);
    if (found) break;
    const rd = defOf(r.def);
    const ov = rd ? outVarsOf(r, rd) : [];
    if (ov.length) { /* 根节点产出对后续根可见，交给下一个 root 的 vars 参数 */ }
  }
  return out;
}

function typeName(t) {
  return ({ Unit: '单位', UnitList: '单位列表', Player: '玩家', Team: '队伍', Tile: '方块', Number: '数字', String: '文本', Boolean: '真/假', flow: '执行' }[t]) || t;
}

// ---------------- 第一趟：prescan ----------------

/**
 * 递归预扫：返回「这棵子树里用到的所有变量名」，并记到 env.used。假定所有
 * 上下文变量都可用（宽作用域），只会多记、不会漏记。
 */
function prescan(node, scope, env) {
  const d = defOf(node.def);
  const subtree = new Set();
  env.used.set(node.id, subtree);
  if (!d) return subtree;

  const ownUsed = new Set();
  const api = makeApi(scope.withRecorder(ownUsed));
  let res;
  try {
    res = d.emit(node, api) || { lines: [] };
  } catch (_) {
    for (const n of ownUsed) subtree.add(n);
    return subtree;
  }
  for (const n of ownUsed) subtree.add(n);

  const childScope = scope.child([
    ...normVars(res.provides),
    ...candidateContexts(d),
    ...normVars(res.scopeVars),
  ]);

  for (const pt of d.outPorts || []) {
    let sc = childScope;
    for (const k of childrenOfPort(env.canvas, node.id, pt.id)) {
      const sub = prescan(k, sc, env);
      for (const n of sub) subtree.add(n);
      const kd = defOf(k.def);
      const ov = kd ? outVarsOf(k, kd) : [];
      if (ov.length) sc = sc.child(ov);
    }
  }
  return subtree;
}

// ---------------- 第二趟：生成 ----------------

export function generateCanvas(module, canvas, project) {
  const errors = [];
  const warnings = [];
  const deps = new Set(module.deps && module.deps.length ? module.deps : ['coreMindustry']);
  const imports = new Set();

  const env = { canvas, deps, imports, errors, warnings, used: new Map(), labelStack: [], anchorSeq: 1 };
  const body = [];

  const roots = sortSiblings(canvas.nodes.filter(n => structuralInEdges(canvas, n.id).length === 0));

  if (!canvas.nodes.length) {
    warnings.push({ nodeId: null, message: '这张画布是空的，导出后会生成一个空文件' });
  } else if (!roots.length) {
    errors.push({
      nodeId: null,
      message: '这张画布里的控件首尾相连成了环，找不到起点。每个画布至少要有一个自带起点的控件（比如「当……发生时」）。',
    });
  }

  // 第一趟：prescan
  let preScope = new Scope(null, [], null);
  for (const root of roots) {
    prescan(root, preScope, env);
    const rd = defOf(root.def);
    const ov = rd ? outVarsOf(root, rd) : [];
    if (ov.length) preScope = preScope.child(ov);
  }

  // 第二趟：生成
  let scope = new Scope(null, [], null);
  for (const root of roots) {
    const r = emitNode(root, scope, 0, env);
    body.push(...r.lines);
    if (r.outVars.length) scope = scope.child(r.outVars);
  }

  // 第三趟：扫正文，补齐 defaultImport 覆盖不到的 import；控件用 ctx.need()
  // 显式声明的也一并收进来
  const bodyText = body.join('\n');
  for (const im of scanImports(bodyText, deps)) imports.add(im);
  for (const im of env.imports) imports.add(im);

  // 文件头不带任何注释：模块 id 由 package 行说明，画布标题由文件名说明，
  // 而注释会算进生成物的「注释占比」。
  const header = [];
  for (const d of deps) header.push(`@file:Depends(${kotlinString(d)})`);
  // 显式 import 必须写在 package 之前
  for (const im of [...imports].sort()) header.push(im);
  header.push('', `package ${module.id}`, '');

  let text = header.join('\n');
  if (body.length) text += '\n' + body.join('\n') + '\n';

  return { text, errors, warnings, deps, imports };
}

export function generateModuleFile(module) {
  const deps = module.deps && module.deps.length ? module.deps : ['coreMindustry'];
  const lines = [];
  for (const d of deps) lines.push(`@file:Depends(${kotlinString(d)})`);
  lines.push('', `package ${module.id}`, '');
  return lines.join('\n');
}

function emitNode(node, scope, depth, env) {
  const ind = IND.repeat(depth);
  const d = defOf(node.def);
  const lines = [];

  if (!d) {
    env.errors.push({ nodeId: node.id, message: `不认识这个功能块：${node.def}` });
    lines.push(`${ind}// 未知控件 ${node.def}`);
    return { lines, outVars: [] };
  }

  // 锚点顶格写：层级已经记在锚点里了，再缩进一遍纯属浪费字节
  lines.push(nodeAnchor(node, depth));

  // 提前返回要用的标签。Kotlin 的标签取自 lambda 传给的函数名：listen ->
  // return@listen、repeat -> return@repeat、forEach -> return@forEach、
  // loop -> return@loop、command(..) { body { } } -> return@body。
  // 只有真的开了新 lambda 的控件才压栈；「如果……就」这种不开 lambda 的控件
  // 必须沿用外层标签，否则 return@xxx 找不到目标。
  const myLabel = d.labelName || null;
  if (myLabel) env.labelStack.push(myLabel);
  try {
    return emitNodeBody(node, scope, depth, env, ind, d, lines);
  } finally {
    if (myLabel) env.labelStack.pop();
  }
}

function emitNodeBody(node, scope, depth, env, ind, d, lines) {
  let res;
  try {
    res = d.emit(node, makeApi(scope, env)) || { lines: [] };
  } catch (e) {
    env.errors.push({ nodeId: node.id, message: `「${d.label}」生成代码时出错：${e.message}` });
    lines.push(`${ind}// ⚠ ${d.label}：生成失败（${e.message}）`);
    return { lines, outVars: [] };
  }
  if (res.error) {
    env.errors.push({ nodeId: node.id, message: res.error });
    lines.push(`${ind}// ⚠ ${d.label}：${res.error}`);
    return { lines, outVars: [] };
  }

  for (const l of res.lines) lines.push(ind + l);
  if (res.extraDeps) for (const x of res.extraDeps) env.deps.add(x);

  const provided = normVars(res.provides);
  const blockPorts = (d.outPorts || []).filter(p => p.opensBlock);
  const delta = res.childIndentDelta != null ? res.childIndentDelta : (blockPorts.length ? 1 : 0);
  const childIndent = depth + delta;

  // 只绑定真正被用到的上下文变量
  const usedSet = env.used.get(node.id) || new Set();
  const bindings = (d.contexts || []).filter(c => usedSet.has(c.name))
    .map(c => ({ name: c.name, type: c.type, expr: c.expr }));

  // 绑定为 val 之后，作用域里的表达式就是那个变量名本身
  const boundVars = bindings.map(b => ({ name: b.name, type: b.type, expr: b.name }));

  if (bindings.length && !res.suppressBindings) {
    const bindInd = IND.repeat(childIndent);
    for (const b of bindings) lines.push(`${bindInd}val ${b.name} = ${b.expr}`);
  }

  // scopeVars：直接注入子作用域的变量（不生成 val，如指令体内的 player!!）
  const scopeVars = normVars(res.scopeVars);

  // 自己产出的变量也要进子作用域：像「生成单位」这种不开花括号的控件，子节点
  // 是紧接着写在后面的兄弟语句，能直接看到上面的 val。
  const ownVars = outVarsOf(node, d);

  const childScope = scope.child([...provided, ...ownVars, ...boundVars, ...scopeVars]);

  const api = {
    ind,
    depth,
    childIndent,
    ctx: childScope,
    hasChildren: (portId) => outEdges(env.canvas, node.id, portId).length > 0,
    childrenOf: (portId, base, atDepth) => {
      const out = [];
      let sc = base || childScope;
      for (const k of childrenOfPort(env.canvas, node.id, portId)) {
        const r = emitNode(k, sc, atDepth == null ? childIndent : atDepth, env);
        out.push(...r.lines);
        if (r.outVars.length) sc = sc.child(r.outVars);
      }
      return out;
    },
  };

  if (typeof d.expand === 'function') {
    lines.push(...d.expand(node, res, api));
  } else if (d.wrapper) {
    lines.push(`${ind}    body {`);
    lines.push(...api.childrenOf('out', childScope, childIndent + 1));
    lines.push(`${ind}    }`);
    lines.push(IND.repeat(depth) + ((d.closers && d.closers.out) || '}'));
  } else {
    for (const pt of d.outPorts || []) {
      lines.push(...api.childrenOf(pt.id, childScope, childIndent));
      if (pt.opensBlock) lines.push(IND.repeat(depth) + ((d.closers && d.closers[pt.id]) || '}'));
    }
  }

  return { lines, outVars: outVarsOf(node, d) };
}

/** 生成整个插件的文件表 */
export function generatePlugin(project) {
  const files = [];
  const errors = [];
  const warnings = [];

  for (const m of project.modules) {
    if (!m.canvases.length) {
      warnings.push({ module: m.id, message: `模块「${m.id}」里没有任何画布，已跳过` });
      continue;
    }
    files.push({ path: `${m.id}/module.kts`, content: generateModuleFile(m) });
    const usedFiles = new Set();
    for (const c of m.canvases) {
      let file = String(c.file || 'main').trim() || 'main';
      if (usedFiles.has(file)) {
        let i = 2;
        while (usedFiles.has(`${file}${i}`)) i++;
        const old = file;
        file = `${file}${i}`;
        warnings.push({
          module: m.id, canvas: c.id, canvasTitle: c.title, nodeId: null,
          message: `画布「${c.title}」的文件名 ${old}.kts 与另一张重复，已自动改成 ${file}.kts`,
        });
      }
      usedFiles.add(file);
      const r = generateCanvas(m, c, project);
      for (const e of r.errors) errors.push({ ...e, module: m.id, canvas: c.id, canvasTitle: c.title });
      for (const w of r.warnings) warnings.push({ ...w, module: m.id, canvas: c.id, canvasTitle: c.title });
      files.push({ path: `${m.id}/${file}.kts`, content: r.text });
    }
  }

  return { files, errors, warnings };
}
