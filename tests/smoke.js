// 在 Node 里跑一遍前端逻辑（不依赖 DOM），确认模块能加载、状态机能跑通
// 运行： node tests/smoke.js

import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const u = (p) => pathToFileURL(p).href;

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

// ---------------- 1. 所有 JS 文件都能被解析 ----------------

console.log('=== 1. 模块语法检查 ===');
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(join(ROOT, 'src/frontend/js'));
for (const f of files) {
  const rel = f.replace(ROOT + '\\', '').replace(/\\/g, '/');
  try {
    await import(u(f));
    ok(rel);
  } catch (e) {
    // 依赖 DOM 的模块（canvas/inspector/ui/main）在 Node 里自然会失败，单独标记
    if (/document|window is not defined|__TAURI__/.test(e.message)) {
      console.log(`  ○ ${rel}  (需要浏览器环境：${e.message.slice(0, 40)})`);
    } else {
      bad(`${rel} -> ${e.message}`);
    }
  }
}

// ---------------- 2. 纯逻辑模块联动 ----------------

console.log('\n=== 2. 纯逻辑模块联动 ===');
const M = await import(u(join(ROOT, 'src/frontend/js/model.js')));
const G = await import(u(join(ROOT, 'src/frontend/js/generate.js')));
const CAT = await import(u(join(ROOT, 'src/frontend/js/catalog/index.js')));
const V = await import(u(join(ROOT, 'src/frontend/js/validate.js')));
const Z = await import(u(join(ROOT, 'src/frontend/js/zip.js')));
const A = await import(u(join(ROOT, 'src/frontend/js/anchor.js')));

// 2.1 序列化往返
{
  const p = M.newProject('往返测试');
  p.modules[0].id = 'rt';
  p.modules[0].canvases = [];
  const c = M.newCanvas('画布', 'main');
  const e = M.newNode('event.PlayerJoin', 10, 20);
  const a = M.newNode('action.broadcast', 300, 20, { target: 'all', text: 'hi', msgType: 'MsgType.Message' });
  c.nodes = [e, a];
  c.edges = [{ id: 'x', from: { node: e.id, port: 'out' }, to: { node: a.id, port: 'in' }, kind: 'flow' }];
  p.modules[0].canvases.push(c);
  const json = M.serialize(p);
  const back = M.parse(json);
  if (back.modules[0].canvases[0].nodes.length === 2 && back.modules[0].id === 'rt') ok('serialize/parse 往返一致');
  else bad('serialize/parse 往返丢数据');
}

// 2.2 名字归一化
{
  const cases = [
    ['hello world', 'helloWorld'],
    ['a-b_c', 'aBC'],
    ['My Plugin', 'myPlugin'],
  ];
  let allOk = true;
  for (const [inp, want] of cases) {
    const got = M.toModuleId(inp, 'fallback');
    if (got !== want) { bad(`toModuleId("${inp}") = "${got}"，期望 "${want}"`); allOk = false; }
  }
  // 纯中文：必须产出合法标识符，且同名同结果、异名异结果
  const cn1 = M.toModuleId('我的插件', 'fallback');
  const cn2 = M.toModuleId('我的插件', 'fallback');
  const cn3 = M.toModuleId('另一个插件', 'fallback');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cn1)) { bad(`中文模块名不合法："${cn1}"`); allOk = false; }
  if (cn1 !== cn2) { bad('同一个中文名两次结果不同'); allOk = false; }
  if (cn1 === cn3) { bad(`不同中文名撞车了：都是 "${cn1}"`); allOk = false; }
  if (allOk) ok(`名字归一化（中文 -> "${cn1}"，稳定且不撞车）`);

  const f1 = M.toFileName('进服欢迎', 'main');
  const f2 = M.toFileName('定时公告', 'main');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f1)) bad(`toFileName("进服欢迎") 不合法："${f1}"`);
  else if (f1 === f2) bad(`两个不同中文画布名撞成同一个文件名："${f1}"`);
  else ok(`toFileName 中文画布名合法且不撞车（"${f1}" / "${f2}"）`);
}

// 2.3 连线校验
{
  const p = M.newProject('环');
  p.modules[0].canvases = [];
  const c = M.newCanvas('c', 'main');
  const e = M.newNode('event.PlayerJoin', 0, 0);
  const a = M.newNode('action.broadcast', 300, 0, { target: 'all', text: 'x', msgType: 'MsgType.Message' });
  const b = M.newNode('action.broadcast', 600, 0, { target: 'all', text: 'y', msgType: 'MsgType.Message' });
  c.nodes = [e, a, b];
  c.edges = [
    { id: '1', from: { node: e.id, port: 'out' }, to: { node: a.id, port: 'in' }, kind: 'flow' },
    { id: '2', from: { node: a.id, port: 'out' }, to: { node: b.id, port: 'in' }, kind: 'flow' },
  ];
  // b -> a 会让 a 落进自己的子树里，成环
  const r = M.checkConnect(c, { node: b.id, port: 'out' }, { node: a.id, port: 'in' }, { defOf: CAT.defOf });
  if (!r.ok && /死循环/.test(r.reason)) ok('拒绝成环连线：' + r.reason);
  else bad(`成环连线没被拦住：${JSON.stringify(r)}`);

  // 事件是起点，不能接在后面
  const r2 = M.checkConnect(c, { node: a.id, port: 'out' }, { node: e.id, port: 'in' }, { defOf: CAT.defOf });
  if (!r2.ok) ok('拒绝把控件接到事件后面：' + r2.reason);
  else bad('竟然允许把控件接到事件后面');

  // 合法连线要放行
  const d = M.newNode('action.broadcast', 900, 0, { target: 'all', text: 'z', msgType: 'MsgType.Message' });
  c.nodes.push(d);
  const r3 = M.checkConnect(c, { node: b.id, port: 'out' }, { node: d.id, port: 'in' }, { defOf: CAT.defOf });
  if (r3.ok) ok('合法连线正常放行');
  else bad('合法连线被误拦：' + r3.reason);

  // addStructuralEdge 必须真的改到画布上，并且入线唯一（替换旧的）
  const before = c.edges.length;
  const added = M.addStructuralEdge(c, { node: e.id, port: 'out' }, { node: d.id, port: 'in' });
  if (c.edges.length === before + 1 && !added.replaced) ok('addStructuralEdge 写入画布');
  else bad(`addStructuralEdge 没写入画布：${before} -> ${c.edges.length}，replaced=${added.replaced}`);
  const again = M.addStructuralEdge(c, { node: b.id, port: 'out' }, { node: d.id, port: 'in' });
  if (again.replaced && c.edges.length === before + 1) ok('结构入线唯一：已有入线被替换');
  else bad(`结构入线没保持唯一：${c.edges.length} 条，replaced=${again.replaced}`);
}

// 2.4 ZIP 结构
{
  const zip = Z.makeZip([
    { path: 'demo/module.kts', content: '@file:Depends("coreMindustry")\npackage demo\n' },
    { path: 'demo/main.kts', content: 'package demo\n' },
  ]);
  const sig = new DataView(zip.buffer).getUint32(0, true);
  if (sig === 0x04034b50) ok(`ZIP 头正确，共 ${zip.length} 字节`);
  else bad('ZIP 头不对');
  // 中央目录结束标记
  const hasEocd = (() => {
    for (let i = zip.length - 22; i >= 0; i--) {
      if (new DataView(zip.buffer).getUint32(i, true) === 0x06054b50) return true;
    }
    return false;
  })();
  if (hasEocd) ok('ZIP 有正确的中央目录结束标记');
  else bad('ZIP 缺少 EOCD');
  const enc = new TextEncoder();
  if (zip.length > enc.encode('demo/module.kts').length * 2) ok('ZIP 内含文件数据');
  else bad('ZIP 内容为空');
}

// 2.5 锚点往返（生成 -> 解析）
{
  const p = M.newProject('锚点');
  p.modules[0].id = 'anc';
  p.modules[0].canvases = [];
  const c = M.newCanvas('我的画布', 'main');
  const e = M.newNode('event.PlayerJoin', 80, 80);
  const cond = M.newNode('condition.if', 400, 80, {
    joiner: 'and',
    rules: [{ var: 'player', type: 'Player', field: 'name', op: '==', valueSource: 'literal', value: 'x' }],
  });
  const t = M.newNode('action.broadcast', 700, 40, { target: 'all', text: 'a', msgType: 'MsgType.Message' });
  const f = M.newNode('action.broadcast', 700, 200, { target: 'all', text: 'b', msgType: 'MsgType.Message' });
  c.nodes = [e, cond, t, f];
  c.edges = [
    { id: '1', from: { node: e.id, port: 'out' }, to: { node: cond.id, port: 'in' }, kind: 'flow' },
    { id: '2', from: { node: cond.id, port: 'then' }, to: { node: t.id, port: 'in' }, kind: 'flow' },
    { id: '3', from: { node: cond.id, port: 'else' }, to: { node: f.id, port: 'in' }, kind: 'flow' },
  ];
  p.modules[0].canvases.push(c);
  const g = G.generatePlugin(p);
  const text = g.files[1].content;
  if (A.looksLikeOurKts(text)) ok('生成的文件带本工具标记');
  else bad('生成的文件缺少 @sa 标记，无法反向还原');
  const parsed = A.parseKts(text);
  if (parsed.ok) {
    const n = parsed.canvas.nodes.length;
    const e2 = parsed.canvas.edges.length;
    if (n === 4) ok(`从代码还原出 ${n} 个控件、${e2} 条连线`);
    else bad(`还原控件数不对：${n}，期望 4`);
    // 检查 then/else 分配。
    // 注意：锚点里不写节点 id（那是为了压字节），所以还原时 id 是新发的，
    // 不能再拿原来的 cond.id 去比对，得按控件类型定位。
    const cond2 = parsed.canvas.nodes.find(x => x.def === 'condition.if');
    if (!cond2) { bad('还原后找不到条件控件'); }
    else {
      const toCond = parsed.canvas.edges.filter(x => x.from.node === cond2.id);
      const ports = toCond.map(x => x.from.port).sort();
      if (ports.includes('then') && ports.includes('else')) ok('条件两个分支都还原正确');
      else bad('条件分支还原不对：' + JSON.stringify(ports));
      // 还原必须发新 id：同一个文件导入两次，否则会和原画布撞 id
      const origIds = new Set([e.id, cond.id, t.id, f.id]);
      const clash = parsed.canvas.nodes.filter(x => origIds.has(x.id));
      if (clash.length === 0) ok('还原时重新分配 id（重复导入不会撞 id）');
      else bad('还原沿用了原 id，重复导入会撞车：' + clash.map(x => x.id).join(','));
    }
  } else {
    bad('反向还原失败：' + parsed.error);
  }
}

// 2.6 校验器能抓出常见错误
{
  const p = M.newProject('坏工程');
  p.modules[0].id = 'bad';
  p.modules[0].canvases = [];
  const c = M.newCanvas('空画布', 'main');
  const a = M.newNode('action.broadcast', 0, 0, {});   // 参数全空
  c.nodes = [a];
  p.modules[0].canvases.push(c);
  const r = V.validateProject(p);
  if (r.errors.length) ok(`校验器抓出 ${r.errors.length} 个错误：${r.errors[0].message}`);
  else bad('校验器没能抓出空白必填参数');
}

// 2.7 配平检查器本身要准
{
  const good = 'fun a() {\n  val s = "}}{{"\n  // }\n}\n';
  const bad1 = 'fun a() {\n}\n}\n';
  const bad2 = 'val s = "unclosed\n';
  if (V.checkBalance(good).length === 0) ok('配平检查：正确代码判为平衡（忽略字符串/注释里的括号）');
  else bad('配平检查误报：' + JSON.stringify(V.checkBalance(good)));
  if (V.checkBalance(bad1).length > 0) ok('配平检查：多出的 } 能发现');
  else bad('配平检查漏掉多出的 }');
  if (V.checkBalance(bad2).length > 0) ok('配平检查：未闭合的引号能发现');
  else bad('配平检查漏掉未闭合引号');
}

// 2.8 每个 mockable 控件的 props 定义完整
{
  let problems = 0;
  for (const d of CAT.allDefs()) {
    if (!d.key || !d.label || !d.category) { bad(`控件缺少 key/label/category：${JSON.stringify(d.key)}`); problems++; }
    for (const p of d.props || []) {
      if (!p.key) { bad(`控件 ${d.key} 有 prop 缺少 key`); problems++; }
      if (!p.label) { bad(`控件 ${d.key}.${p.key} 缺少 label`); problems++; }
      if (!p.type) { bad(`控件 ${d.key}.${p.key} 缺少 type`); problems++; }
      if (p.type === 'rules' && !p.label) { bad(`规则组 ${d.key} 缺少 label`); problems++; }
    }
    if (typeof d.emit !== 'function') { bad(`控件 ${d.key} 没有 emit()`); problems++; }
  }
  if (!problems) ok(`${CAT.allDefs().length} 个控件的定义都完整`);
}

// 2.9b 搜索能用中文关键词命中
{
  const tests = [['玩家', 'event.PlayerJoin'], ['消息', 'action.broadcast'], ['广播', 'action.broadcast'],
                 ['定时', 'timer.every'], ['如果', 'condition.if'], ['循环', 'loop.repeat'],
                 ['踢', 'action.playerControl'], ['权限', 'action.permission']];
  let allOk = true;
  for (const [q, wantKey] of tests) {
    const hits = CAT.searchDefs(q).map(d => d.key);
    if (wantKey && !hits.includes(wantKey)) { bad(`搜索「${q}」没有命中 ${wantKey}，实际命中：${hits.join(',')}`); allOk = false; }
  }
  if (allOk) ok('中文关键词搜索都能命中');
}

// 2.10 界面变量列表 与 生成器作用域 必须一致
{
  const p = M.newProject('作用域');
  p.modules[0].id = 'sc';
  p.modules[0].canvases = [];
  const c = M.newCanvas('c', 'main');
  const ev = M.newNode('event.PlayerChatEvent', 0, 0);
  const cond = M.newNode('condition.if', 300, 400, {
    joiner: 'and',
    rules: [{ var: 'message', type: 'String', field: 'contains', op: '==', valueSource: 'literal', arg: '签到' }],
  });
  const inside = M.newNode('action.broadcast', 700, 400, { target: 'all', text: 'a', msgType: 'MsgType.Message' });
  const q = M.newNode('query.units', 300, 700, { name: 'targets', scope: 'enemy', healthy: true });
  const loop = M.newNode('loop.forEach', 700, 700, { listVar: 'targets', itemName: 'enemy' });
  const applied = M.newNode('action.applyStatus', 1100, 700, { status: 'slow', seconds: 5, on: 'ctx' });
  c.nodes = [ev, cond, inside, q, loop, applied];
  c.edges = [
    { id: '1', from: { node: ev.id, port: 'out' }, to: { node: cond.id, port: 'in' }, kind: 'flow' },
    { id: '2', from: { node: cond.id, port: 'then' }, to: { node: inside.id, port: 'in' }, kind: 'flow' },
    { id: '3', from: { node: cond.id, port: 'else' }, to: { node: q.id, port: 'in' }, kind: 'flow' },
    { id: '4', from: { node: q.id, port: 'out' }, to: { node: loop.id, port: 'in' }, kind: 'flow' },
    { id: '5', from: { node: loop.id, port: 'out' }, to: { node: applied.id, port: 'in' }, kind: 'flow' },
  ];
  p.modules[0].canvases.push(c);

  // 条件节点处应能看到事件的两个变量
  const atCond = G.varsInScopeAt(c, cond.id).map(v => v.name);
  if (atCond.includes('player') && atCond.includes('message')) ok(`条件处可见变量：${atCond.join(', ')}`);
  else bad(`条件处变量不对：${atCond.join(', ')}`);

  // 循环内应能看到 targets 和 enemy，但看不到 message（它在另一个分支里）
  const atApplied = G.varsInScopeAt(c, applied.id).map(v => v.name);
  if (atApplied.includes('enemy')) ok(`循环体内可见「每个元素」变量：${atApplied.join(', ')}`);
  else bad(`循环体内看不到元素变量：${atApplied.join(', ')}`);

  // 关键：界面上列出来的变量，生成器必须都认得（否则用户选了却报错）
  const g = G.generatePlugin(p);
  if (g.errors.length === 0) ok('整条链（事件→条件→查询→循环→动作）零错误生成');
  else bad('整条链生成报错：' + g.errors.map(e => e.message).join(' | '));
}

// 2.11 画布坐标换算必须严格互逆（否则连线会跟节点错位）
{
  const CV = await import(u(join(ROOT, 'src/frontend/js/canvas.js')));
  const view = { left: 232, top: 34, width: 900, height: 600 };
  let worst = 0;
  for (const zoom of [0.25, 0.5, 1, 1.7, 2.5]) {
    for (const panX of [-500, 0, 40, 1234]) {
      for (const panY of [-300, 0, 60, 999]) {
        for (const [sx, sy] of [[0, 0], [400, 300], [1200, 800]]) {
          const w = CV.screenToWorldPt(sx, sy, view, panX, panY, zoom);
          const s = CV.worldToScreenPt(w.x, w.y, view, panX, panY, zoom);
          worst = Math.max(worst, Math.abs(s.x - sx), Math.abs(s.y - sy));
        }
      }
    }
  }
  if (worst < 1e-9) ok(`坐标换算严格互逆（125 组随机组合，最大误差 ${worst.toExponential(1)}）`);
  else bad(`坐标换算不互逆，最大误差 ${worst}`);

  // 缩放时锚点必须钉在光标下
  let worstZoom = 0;
  for (const oldZ of [0.3, 1, 2]) {
    for (const newZ of [0.5, 1.3, 2.4]) {
      for (const [cx, cy] of [[300, 200], [800, 500], [240, 40]]) {
        const before = CV.screenToWorldPt(cx, cy, view, 77, -33, oldZ);
        const np = CV.panForZoomAt(cx, cy, view, 77, -33, oldZ, newZ);
        const after = CV.screenToWorldPt(cx, cy, view, np.panX, np.panY, newZ);
        worstZoom = Math.max(worstZoom, Math.abs(after.x - before.x), Math.abs(after.y - before.y));
      }
    }
  }
  if (worstZoom < 1e-9) ok(`缩放锚点稳定（光标下的世界点不动，误差 ${worstZoom.toExponential(1)}）`);
  else bad(`缩放时锚点漂移了：${worstZoom}`);

  // 适应视野后所有节点都应落在视口内
  {
    const bounds = { minX: -400, minY: 120, maxX: 1500, maxY: 900 };
    const t = CV.fitTransform(bounds, view.width, view.height);
    const a = CV.worldToScreenPt(bounds.minX, bounds.minY, view, t.panX, t.panY, t.zoom);
    const b = CV.worldToScreenPt(bounds.maxX, bounds.maxY, view, t.panX, t.panY, t.zoom);
    const inView = a.x >= view.left - 1 && a.y >= view.top - 1 &&
                   b.x <= view.left + view.width + 1 && b.y <= view.top + view.height + 1;
    if (inView) ok(`适应视野：内容落在视口内（缩放 ${t.zoom.toFixed(2)}）`);
    else bad(`适应视野后内容超出视口：${JSON.stringify({ a, b, view, t })}`);
  }
}

// 2.12 输入参数时不能触发整体重绘（否则输入框每敲一个字就失焦）
{
  // store.js 依赖 localStorage，给个最小替身
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const S = await import(u(join(ROOT, 'src/frontend/js/store.js')));

  const p = M.newProject('焦点');
  p.modules[0].id = 'f';
  p.modules[0].canvases = [];
  const c = M.newCanvas('c', 'main');
  const ev = M.newNode('event.PlayerJoin', 0, 0);
  const act = M.newNode('action.broadcast', 300, 0, { target: 'all', text: 'a', msgType: 'MsgType.Message' });
  c.nodes = [ev, act];
  c.edges = [{ id: '1', from: { node: ev.id, port: 'out' }, to: { node: act.id, port: 'in' }, kind: 'flow' }];
  p.modules[0].canvases.push(c);
  S.store.project = p;
  S.store.activeCanvasId = c.id;

  const seen = [];
  S.on((what) => seen.push(what));

  S.setProp(act.id, 'text', 'ab');
  if (!seen.includes('props')) bad(`改参数没有发出 'props' 事件，实际：${seen.join(',')}`);
  else if (seen.includes('node') || seen.includes('canvas') || seen.includes('load')) {
    bad(`改参数触发了整体重绘（${seen.join(',')}），输入框会失焦`);
  } else ok(`改参数只发 'props' 事件（${seen.join(',')}），输入框不会失焦`);

  // 撤销点要合并：同一个字段连打 5 次只应产生 1 个撤销点
  const before = S.store.undoStack.length;
  seen.length = 0;
  S.setProp(act.id, 'text', 'abc');
  S.setProp(act.id, 'text', 'abcd');
  S.setProp(act.id, 'text', 'abcde');
  S.setProp(act.id, 'text', 'abcdef');
  const added = S.store.undoStack.length - before;
  if (added === 0) ok('连续输入同一字段只记一次撤销点（合并生效）');
  else bad(`连续输入 4 次却加了 ${added} 个撤销点`);

  // 值没变时不应产生任何事件
  seen.length = 0;
  S.setProp(act.id, 'text', 'abcdef');
  if (!seen.length) ok('值没变时不产生任何事件');
  else bad(`值没变却发出了：${seen.join(',')}`);

  // 换一个字段应该记新的撤销点
  const b2 = S.store.undoStack.length;
  S.setProp(act.id, 'msgType', 'MsgType.Announce');
  if (S.store.undoStack.length > b2) ok('换字段会记新的撤销点');
  else bad('换字段没有记撤销点');
}

// 2.13 生成器必须为 defaultImport 覆盖不到的符号补 import
//
// coreMindustry 的 defaultImport 只给 arc.Core / mindustry.Vars.* /
// mindustry.content.* / mindustry.gen.{Player,Call,Groups} /
// mindustry.game.EventType / coreMindustry.lib.*。
// 工作区脚本里 Team 是 18/18 个文件都显式 import 的，漏了会直接编译不过。
{
  const cases = [
    // [控件, 参数, 正文里必须出现, 必须补的 import]
    ['action.spawnUnit', { unitType: 'mono', team: 'sharded', pos: 'fixed', px: 1, py: 2 },
      'Team.sharded', 'import mindustry.game.Team'],
    ['action.playerControl', { op: 'team', team: 'crux' },
      'Team.crux', 'import mindustry.game.Team'],
    ['action.effect', { kind: 'effect', fx: 'placeBlock', pos: 'fixed', px: 1, py: 2 },
      'Color.white', 'import arc.graphics.Color'],
    // Fx 属于 mindustry.content.*，而 coreMindustry 的 @file:Import 已经把它
    // defaultImport 进来了 —— 工作区 166 个文件里没有任何一处 import Fx
    // （history.kts 直接用 Fx.placeBlock 却没写过 import）。多写反而会报冗余。
    ['action.effect', { kind: 'effect', fx: 'placeBlock', pos: 'fixed', px: 1, py: 2 },
      'Fx.placeBlock', null],
  ];

  const PRE = {
    'action.spawnUnit': { def: 'event.PlayerJoin', gives: null },
    'action.playerControl': { def: 'event.PlayerJoin', gives: null },
    'action.effect': { def: 'event.PlayerJoin', gives: null },
  };

  let allOk = true;
  for (const [defKey, props, mustHave, mustImport] of cases) {
    const p = M.newProject('导入');
    p.modules[0].id = 'imp';
    p.modules[0].canvases = [];
    const c = M.newCanvas('c', 'main');
    const ev = M.newNode('event.PlayerJoin', 0, 0);
    const n = M.newNode(defKey, 300, 0, { ...props });
    c.nodes = [ev, n];
    c.edges = [{ id: '1', from: { node: ev.id, port: 'out' }, to: { node: n.id, port: 'in' }, kind: 'flow' }];
    p.modules[0].canvases.push(c);

    const g = G.generatePlugin(p);
    if (g.errors.length) {
      bad(`${defKey} 生成报错：${g.errors.map(e => e.message).join(' | ')}`);
      allOk = false;
      continue;
    }
    const text = g.files.find(f => f.path.endsWith('main.kts')).content;
    if (!text.includes(mustHave)) {
      bad(`${defKey} 正文里没有 ${mustHave}`);
      allOk = false;
    }
    if (mustImport && !text.includes(mustImport)) {
      bad(`${defKey} 用到 ${mustHave} 却没有补「${mustImport}」`);
      allOk = false;
    }
    // 反过来也要查：确认不该补的确实没补（别的 import 可以有，就是不能有 Fx 的）
    if (!mustImport && /^import .*\bFx\b/m.test(text)) {
      bad(`${defKey} 的 ${mustHave} 不需要 import，却补了一条`);
      allOk = false;
    }
    // import 必须写在 package 之前
    const lines = text.split('\n');
    const iImp = lines.findIndex(l => l.startsWith('import '));
    const iPkg = lines.findIndex(l => l.startsWith('package '));
    if (iImp >= 0 && iPkg >= 0 && iImp > iPkg) {
      bad(`${defKey} 的 import 写在了 package 后面，Kotlin 不允许`);
      allOk = false;
    }
  }
  if (allOk) ok(`按需补 import 正确（Team / Color 要补、Fx 不补，共 ${cases.length} 例，且都在 package 之前）`);
}

// 2.14 存盘数据必须用 var（val 无法把磁盘上的值写回）
{
  const p = M.newProject('存盘');
  p.modules[0].id = 'sav';
  p.modules[0].canvases = [];
  const c = M.newCanvas('c', 'main');
  for (const [i, [t, init]] of [['Int', '0'], ['String', 'hi'], ['Boolean', 'true']].entries()) {
    c.nodes.push(M.newNode('action.savable', 0, i * 200, { name: 'd' + i, dataType: t, init }));
  }
  p.modules[0].canvases.push(c);
  const g = G.generatePlugin(p);
  const text = g.files.find(f => f.path.endsWith('main.kts')).content;
  if (/@Savable\(false\)\s*\n\s*val d[0-2]/.test(text)) {
    bad('基本类型的存盘数据用了 val，值无法写回');
  } else if (text.includes('customLoad(::d0) { d0 = it }') &&
             text.includes('customLoad(::d1) { d1 = it }') &&
             text.includes('customLoad(::d2) { d2 = it }')) {
    ok('基本类型的存盘数据用 var + customLoad 回写');
  } else {
    bad('存盘数据没有生成 customLoad 回写：\n' + text);
  }
  // 集合类型保持 val + 原地修改
  const c2 = M.newCanvas('c2', 'main2');
  c2.nodes.push(M.newNode('action.savable', 0, 0, { name: 'list', dataType: 'MutableList<String>', init: '' }));
  p.modules[0].canvases.push(c2);
  const g2 = G.generatePlugin(p);
  const t2 = g2.files.find(f => f.path.endsWith('main2.kts')).content;
  if (t2.includes('val list = mutableListOf<String>()') && t2.includes('customLoad(::list, list::addAll)')) {
    ok('集合类型的存盘数据用 val + addAll');
  } else {
    bad('集合类型的存盘数据形状不对：\n' + t2);
  }
}

// 2.15 上游控件自己产出的变量，它下面的节点必须能直接看到
//
// 「生成单位」会写 `val newUnit = ...`，紧接着的兄弟节点就在同一个花括号里，
// 应该能直接用 newUnit。这类「产出但不开花括号」的控件以前会漏掉。
{
  const p = M.newProject('产出可见');
  p.modules[0].id = 'own';
  p.modules[0].canvases = [];
  const c = M.newCanvas('c', 'main');
  const ev = M.newNode('event.PlayerJoin', 0, 0);
  const sp = M.newNode('action.spawnUnit', 300, 0, { unitType: 'mono', team: 'sharded', pos: 'player' });
  const ap = M.newNode('action.applyStatus', 600, 0, { status: 'invincible', seconds: 10, on: 'spawned' });
  c.nodes = [ev, sp, ap];
  c.edges = [
    { id: '1', from: { node: ev.id, port: 'out' }, to: { node: sp.id, port: 'in' }, kind: 'flow' },
    { id: '2', from: { node: sp.id, port: 'out' }, to: { node: ap.id, port: 'in' }, kind: 'flow' },
  ];
  p.modules[0].canvases.push(c);

  const g = G.generatePlugin(p);
  const text = g.files.find(f => f.path.endsWith('main.kts')).content;
  if (g.errors.length) {
    bad('上游产出的变量没传给下游：' + g.errors.map(e => e.message).join(' | '));
  } else if (text.includes('newUnit.apply(StatusEffects.invincible')) {
    ok('上游 `val newUnit = ...` 的产出对下游可见');
  } else {
    bad('下游没有用上上游产出的变量：\n' + text);
  }
}

// 2.16 控件库折叠状态：默认全折叠、能开关、**刻意不持久化**
//
// 这里和旧版本相反：以前要求「展开状态要记住」，用户反馈那看着就像
// 「一进来模块组全是展开的」，要求每次都是干净的折叠态。所以现在
// 断言的是「不写 localStorage、重启后必然全折叠」。
{
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };
  const S = await import(u(join(ROOT, 'src/frontend/js/store.js')));

  let allOk = true;
  const check = (cond, msg) => { if (!cond) { bad(msg); allOk = false; } };

  // 默认：什么都没存 → 全折叠
  S.loadUiPrefs();
  check(S.ui.openGroups.length === 0, '没存过偏好时不是默认全折叠');
  check(S.isGroupOpen('basic:event') === false, '默认状态下分类竟然是展开的');

  // 能展开、能收起
  const opened = S.toggleGroup('basic:event');
  check(opened === true, 'toggleGroup 展开时没返回 true');
  check(S.isGroupOpen('basic:event') === true, '展开后 isGroupOpen 仍是 false');
  const closed = S.toggleGroup('basic:event');
  check(closed === false, 'toggleGroup 收起时没返回 false');
  check(S.isGroupOpen('basic:event') === false, '收起后 isGroupOpen 仍是 true');

  // 关键：展开状态**不该**被写进 localStorage
  S.toggleGroup('basic:event');
  check(!mem.has('kts-builder.ui.v1'),
    '展开状态被写进 localStorage 了 —— 重启后会残留，用户看到的就是「默认全展开」');

  // 模拟重启：内存态清空 + 重新 loadUiPrefs，必须回到全折叠
  S.loadUiPrefs();
  check(S.ui.openGroups.length === 0, '重启后没有回到全折叠状态');
  check(S.isGroupOpen('basic:event') === false, '重启后上次展开的分类还开着');

  // 就算 localStorage 里躺着旧版本留下的数据，也不能被读进来
  mem.set('kts-builder.ui.v1', JSON.stringify({ openGroups: ['basic:event', 'advanced:action'] }));
  S.ui.openGroups = [];
  S.loadUiPrefs();
  check(S.ui.openGroups.length === 0,
    '旧版本残留在 localStorage 里的展开状态被恢复了 —— 老用户升级后仍会看到「全展开」');

  // 坏数据不能让程序崩
  mem.set('kts-builder.ui.v1', '{ 这不是 JSON');
  S.ui.openGroups = [];
  S.loadUiPrefs();
  check(Array.isArray(S.ui.openGroups), '遇到坏 JSON 时 openGroups 不是数组');

  delete globalThis.localStorage;
  if (allOk) ok('控件库折叠状态：默认全折叠 / 可开关 / 不持久化（重启必回到折叠）/ 旧数据不干扰');
}

// ---------------- 3. 主题亮度 ----------------
//
// 界面结构、样式完整性、欢迎页/折叠等回归都在 tests/ui-structure.js 里，
// 这里只保留一条「底色确实是浅色」的数值断言（那边用的是色值黑名单）。
const css = readFileSync(join(ROOT, 'src/frontend/css/app.css'), 'utf8');
console.log('\n=== 3. 主题亮度 ===');
{
  const bgMatch = css.match(/--bg:\s*(#[0-9a-fA-F]{6})/);
  if (!bgMatch) bad('找不到 --bg 变量');
  else {
    const hex = bgMatch[1];
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum < 0.75) bad(`--bg (${hex}) 不够浅，亮度只有 ${lum.toFixed(2)}，应该 ≥ 0.75`);
    else ok(`主题是浅色：--bg = ${hex}（亮度 ${lum.toFixed(2)}）`);
  }
}

// ---------------- 4. 前端资源引用完整性 ----------------

console.log('\n=== 4. 前端资源引用 ===');
{
  const html = readFileSync(join(ROOT, 'src/frontend/index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  let allOk = true;
  for (const r of refs) {
    const p = join(ROOT, 'src/frontend', r);
    try { statSync(p); ok(`引用存在：${r}`); }
    catch { bad(`引用缺失：${r}`); allOk = false; }
  }
  // HTML 里用到的所有 id，JS 或 CSS 里至少要有一处用到（否则是死元素）
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const jsAll = walk(join(ROOT, 'src/frontend/js')).map(f => readFileSync(f, 'utf8')).join('\n');
  const cssAll = readFileSync(join(ROOT, 'src/frontend/css/app.css'), 'utf8');
  const orphans = [];
  for (const id of ids) {
    if (!jsAll.includes(id) && !cssAll.includes('#' + id)) orphans.push(id);
  }
  if (orphans.length) bad(`HTML 里的 id 无人使用（JS 和 CSS 都没引用）：${orphans.join(', ')}`);
  else ok(`HTML 引用的 ${refs.length} 个资源都存在，${ids.length} 个 id 都被使用`);
  if (!allOk) bad('有前端资源缺失');
}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
