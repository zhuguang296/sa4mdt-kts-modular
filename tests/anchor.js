// 锚点格式的离线测试。
//
// 重点盯三件事：
//   1. 控件编码表只许追加 —— 用户导出的 .kts 里存的是编码，
//      一旦顺序变了，老文件就会认成别的控件（静默出错，最难查）。
//   2. 生成 -> 解析 的往返必须一致（控件数、连线数、层级）。
//   3. 老格式（v1）必须还能解析 —— 1.1.0 导出的文件不能报废。
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (p) => pathToFileURL(join(ROOT, p)).href;

const M = await import(url('src/frontend/js/model.js'));
const A = await import(url('src/frontend/js/anchor.js'));
const C = await import(url('src/frontend/js/catalog/codes.js'));
const Cat = await import(url('src/frontend/js/catalog/index.js'));
const { generatePlugin } = await import(url('src/frontend/js/generate.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  OK  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
}

console.log('== 1. 控件编码表 ==');
{
  const defs = Cat.allDefs().filter(d => d && d.key);
  const keys = new Set(defs.map(d => d.key));
  const inTable = new Set(C.DEF_CODES);
  const missing = [...keys].filter(k => !inTable.has(k));
  const stale = [...inTable].filter(k => !keys.has(k));
  ok('编码表里的控件都存在', stale.length === 0, stale.length ? '多余的: ' + stale.join(', ') : '');
  ok('每个控件都有编码', missing.length === 0,
    missing.length ? '缺编码的: ' + missing.join(', ') + '（请追加到 codes.js 末尾）' : '');
  // 顺序即编码，重复会让两个控件映射到同一个码
  ok('编码表无重复', new Set(C.DEF_CODES).size === C.DEF_CODES.length,
    '有重复项');
  // 往返
  ok('每个编码都能还原回原控件', C.DEF_CODES.every(k => C.defFromCode(C.defCode(k)) === k));
  // 表外控件：加 `?` 前缀写成完整 key，读回来还是它自己
  const unknown = C.defCode('no.such.control');
  ok('表外控件带 ? 前缀且能还原', unknown === '?no.such.control' && C.defFromCode(unknown) === 'no.such.control', unknown);
}

console.log('== 2. 坐标编解码 ==');
{
  ok('80 -> 28', A.encodeXY(80) === '28', A.encodeXY(80));
  ok('420 -> bo', A.encodeXY(420) === 'bo', A.encodeXY(420));
  ok('0 -> 0', A.encodeXY(0) === '0', A.encodeXY(0));
  ok('负数', A.encodeXY(-20) === '-k', A.encodeXY(-20));
  ok('小数按四舍五入', A.encodeXY(80.4) === '28' && A.encodeXY(80.6) === '29');
  // 往返：常见画布坐标
  let allOk = true;
  for (const v of [0, 1, 19, 20, 40, 80, 120, 140, 240, 300, 420, 440, 760, 1200, 2400]) {
    const back = parseInt(A.encodeXY(v), 36);
    if (back !== v) { allOk = false; console.log(`     ${v} -> ${A.encodeXY(v)} -> ${back}`); }
  }
  ok('常见坐标 base36 无损往返', allOk);
}

console.log('== 3. 生成 -> 解析 往返 ==');
{
  const runSrc = readFileSync(join(ROOT, 'tests/run.js'), 'utf8');
  const bb = runSrc.slice(runSrc.indexOf('function buildProject()'), runSrc.indexOf('const proj = buildProject()'));
  const buildProject = new Function('M', bb + '\nreturn buildProject;')(M);
  const proj = buildProject();
  const gen = generatePlugin(proj);

  let canvasFiles = 0;
  for (const f of gen.files) {
    if (f.path.endsWith('module.kts')) {
      ok(`${f.path} 不含任何注释`, !/^\s*\/\//m.test(f.content));
      continue;
    }
    canvasFiles++;
    const anchorCount = (f.content.match(/^\/\/@/gm) || []).length;
    const p = A.parseKts(f.content);
    ok(`${f.path} 能解析`, p.ok, p.error);
    if (!p.ok) continue;
    ok(`${f.path} 控件数一致`, p.canvas.nodes.length === anchorCount,
      `解析 ${p.canvas.nodes.length} / 锚点 ${anchorCount}`);
    ok(`${f.path} 无未知控件`, p.unknown.length === 0, p.unknown.join(', '));
    // 连线数 = 控件数 - 顶层根数
    const roots = p.canvas.nodes.filter(n => !p.canvas.edges.some(e => e.to.node === n.id)).length;
    ok(`${f.path} 层级连成树（边=点-根）`,
      p.canvas.edges.length === p.canvas.nodes.length - roots,
      `边 ${p.canvas.edges.length} 点 ${p.canvas.nodes.length} 根 ${roots}`);
  }
  ok('样例工程有画布文件', canvasFiles > 0);

  // 每个文件都必须带 @file:Depends，否则游戏里加载不了
  for (const f of gen.files) {
    ok(`${f.path} 有 @file:Depends`, /@file:Depends\(/.test(f.content));
  }
}

console.log('== 4. 老格式（v1）仍能解析 ==');
{
  const v1 = [
    '// @sa:file id=c1 module=demo title=进服欢迎',
    '',
    '@file:Depends("coreMindustry")',
    '',
    'package demo',
    '',
    '// @sa:node id=n1 def=event.PlayerJoin x=80 y=80',
    'listen<EventType.PlayerJoin> {',
    '    // @sa:node id=n2 def=action.broadcast x=420 y=80',
    '    broadcast("hi".with(), MsgType.InfoMessage, 10f)',
    '}',
  ].join('\n');
  ok('looksLikeOurKts(v1)', A.looksLikeOurKts(v1));
  const p = A.parseKts(v1);
  ok('v1 能解析', p.ok, p.error);
  if (p.ok) {
    ok('v1 控件数 = 2', p.canvas.nodes.length === 2, String(p.canvas.nodes.length));
    ok('v1 还原出嵌套', p.canvas.edges.length === 1, String(p.canvas.edges.length));
    ok('v1 控件 key 完整', p.canvas.nodes[0].def === 'event.PlayerJoin', p.canvas.nodes[0].def);
    ok('v1 坐标保留', p.canvas.nodes[1].x === 420 && p.canvas.nodes[1].y === 80);
  }
}

console.log('== 5. 新格式识别与防误判 ==');{
  const v2 = [
    '@file:Depends("coreMindustry")',
    '',
    'package demo',
    '',
    '//@14 28 28',
    'listen<EventType.PlayerJoin> {',
    '//@2 bo 28 1',
    '    broadcast("hi".with(), MsgType.InfoMessage, 10f)',
    '}',
  ].join('\n');
  ok('looksLikeOurKts(v2)', A.looksLikeOurKts(v2));
  const p = A.parseKts(v2);
  ok('v2 能解析', p.ok, p.error);
  if (p.ok) {
    ok('v2 控件数 = 2', p.canvas.nodes.length === 2, String(p.canvas.nodes.length));
    ok('v2 还原出嵌套', p.canvas.edges.length === 1, String(p.canvas.edges.length));
    ok('v2 深度 1 的控件是子节点', p.canvas.edges[0].to.node === p.canvas.nodes[1].id);
    ok('v2 坐标 base36 还原', p.canvas.nodes[1].x === 420 && p.canvas.nodes[1].y === 80,
      `${p.canvas.nodes[1].x},${p.canvas.nodes[1].y}`);
  }

  // 用户手写的普通注释不能被当成锚点
  ok('@TODO 注释不算锚点', !A.looksLikeOurKts('//@TODO fix this later'));
  ok('@param 注释不算锚点', !A.looksLikeOurKts('// @param x 坐标'));
  ok('普通代码文件不算', !A.looksLikeOurKts('package demo\nfun main() {}'));
  const noise = A.parseKts('//@TODO fix 42\n//@note 1 2 3\npackage demo');
  ok('只有像锚点但没有合法编码时解析失败', !noise.ok);
}

console.log('== 6. 表外控件必须能往返（忘了登记 codes.js 也不能坏）==');
{
  // 情形一：控件在目录里，但没登记进 codes.js（加控件时最常见的疏忽）。
  // 这时锚点写成 `?完整key`，必须原样读回来 —— 否则用户导出的文件
  // 工具自己都认不出，等于把文件写坏了。
  const fake = 'action.notYetInCodes';
  ok('表外控件编码带 ? 前缀', C.defCode(fake) === '?' + fake, C.defCode(fake));
  const anchor = A.nodeAnchor({ def: fake, x: 80, y: 420 }, 0);
  ok('表外控件的锚点', anchor === `//@?${fake} 28 bo`, anchor);
  const t = ['@file:Depends("coreMindustry")', '', 'package p', '', anchor, 'doThing()'].join('\n');
  ok('表外控件的文件能被认出', A.looksLikeOurKts(t));
  ok('表外控件能被解析', A.parseKts(t).ok);

  // 情形二：控件既不在目录也不在表里（比如来自更新的版本）。
  // 应该被认成 unknown 并跳过，而不是当成乱码、更不是把整个文件判为「不是本工具的文件」。
  const future = [
    '@file:Depends("coreMindustry")', '', 'package demo', '',
    '//@14 28 28', 'listen<EventType.PlayerJoin> {',
    '//@?action.brandNew 28 28', '}',
  ].join('\n');
  ok('未知控件的文件仍被认成本工具的', A.looksLikeOurKts(future));
  const p = A.parseKts(future);
  ok('未知控件的文件仍能解析', p.ok, p.error);
  if (p.ok) {
    ok('未知控件被记进 unknown', p.unknown.length === 1 && p.unknown[0] === 'action.brandNew',
      JSON.stringify(p.unknown));
    ok('未知控件不会混进画布', p.canvas.nodes.length === 1, String(p.canvas.nodes.length));
  }

  // ui.js 必须真的把 unknown 说出去，否则上面这条路等于白记
  const ui = readFileSync(join(ROOT, 'src/frontend/js/ui.js'), 'utf8');
  ok('ui.js 提示里用到了 p.unknown', /p\.unknown\.length/.test(ui),
    '还原时认不出的控件会被静默丢弃，用户不会知道');
}

console.log('== 7. 注释占比（生成物）==');
{
  const runSrc = readFileSync(join(ROOT, 'tests/run.js'), 'utf8');
  const bb = runSrc.slice(runSrc.indexOf('function buildProject()'), runSrc.indexOf('const proj = buildProject()'));
  const buildProject = new Function('M', bb + '\nreturn buildProject;')(M);
  const gen = generatePlugin(buildProject());
  let total = 0, cmt = 0;
  for (const f of gen.files) {
    total += Buffer.byteLength(f.content, 'utf8');
    cmt += f.content.split('\n').filter(l => /^\s*\/\//.test(l))
      .reduce((n, l) => n + Buffer.byteLength(l + '\n', 'utf8'), 0);
  }
  const pct = 100 * cmt / total;
  ok(`样例工程注释占比 ${pct.toFixed(1)}% ≤ 10%`, pct <= 10, `${cmt}B / ${total}B`);
}

console.log('');
console.log(`锚点测试：${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('❌ 有问题'); process.exitCode = 1; }
else console.log('✅ 全部通过');
