// 队伍属性字段与真实 jar 的一致性检查：server.js 里登记的 TEAM_FIELDS 必须
// 和 mindustry.game.Rules$TeamRule 的可写字段**完全一致**。
//
// 为什么需要它：这个下拉框是「生成的代码能不能编译」的赌注。
//   * 字段名拼错 / 这个版本没有该字段  -> Kotlin 编译报 unresolved reference
//   * 类型写错（boolean 当成 float）   -> 生成 `cheat = 1.0f`，编译不过
//   * float 字段漏了 f 后缀            -> 编译不过（Kotlin 不隐式转换）
// 三种错在本工具里都不报错，只有进游戏加载时才炸。所以对着 javap 转储查。
//
// 转储由 tests/dump-api.ps1 生成；没有转储就跳过（不影响常规构建）。
// 用法： node tests/team-fields.js
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dumpPath = join(ROOT, 'tests/_api/mindustry.game.Rules$TeamRule.txt');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const skip = (m) => { console.log('  ⏭  ' + m); process.exit(0); };

console.log('=== 队伍属性字段（对照真实 jar）===');

if (!existsSync(dumpPath)) {
  skip('没有 tests/_api/mindustry.game.Rules$TeamRule.txt，先跑 tests/dump-api.ps1');
}

// ---------- 1. jar 里的可写字段 ----------
const dump = readFileSync(dumpPath, 'utf8');
const jar = { boolean: [], float: [], int: [] };
for (const line of dump.split('\n')) {
  const m = line.match(/^\s+public (boolean|float|int) ([A-Za-z0-9_]+);/);
  if (m) jar[m[1]].push(m[2]);
}
const jarAll = [...jar.boolean, ...jar.float, ...jar.int];
if (!jarAll.length) {
  bad('从转储里一个字段都没读出来（javap 输出格式变了？）');
  process.exit(1);
}
ok(`jar 里有 ${jarAll.length} 个可写字段（${jar.boolean.length} boolean / ${jar.int.length} int / ${jar.float.length} float）`);

// ---------- 2. 我们登记的字段 ----------
const src = readFileSync(join(ROOT, 'src/frontend/js/catalog/server.js'), 'utf8');
const start = src.indexOf('TEAM_FIELDS');
if (start < 0) { bad('server.js 里找不到 TEAM_FIELDS'); process.exit(1); }
const block = src.slice(start, src.indexOf('];', start));
const ours = [...block.matchAll(/\['([A-Za-z0-9_]+)',\s*'[^']*',\s*'(boolean|int|float)'\]/g)]
  .map((m) => ({ field: m[1], type: m[2] }));
if (!ours.length) { bad('没能从 TEAM_FIELDS 里解析出字段'); process.exit(1); }

const oursSet = new Set(ours.map((o) => o.field));
const jarSet = new Set(jarAll);

// ---------- 3. 双向比对 ----------
{
  const missing = jarAll.filter((f) => !oursSet.has(f));
  const extra = ours.filter((o) => !jarSet.has(o.field)).map((o) => o.field);
  const typeBad = ours.filter((o) => jarSet.has(o.field) && !jar[o.type].includes(o.field))
    .map((o) => `${o.field}（写成 ${o.type}）`);

  if (missing.length) bad(`漏登记了 jar 里有的字段：${missing.join(', ')}`);
  if (extra.length) bad(`登记了 jar 里没有的字段：${extra.join(', ')}（生成出来编译不过）`);
  if (typeBad.length) bad(`字段类型和 jar 不一致：${typeBad.join(', ')}`);
  if (!missing.length && !extra.length && !typeBad.length) {
    ok(`${ours.length} 个字段名字和类型都与 jar 完全一致`);
  }
}

// ---------- 4. 每种类型生成的字面量都要合法 ----------
//
// 光有对照表还不够：真正决定能不能编译的是 teamValue() 吐出来的字面量。
// 这里 import 真实模块，而不是抠出源码 eval —— 免得 FIELD_TYPE 这类
// 模块级依赖漏掉，测了个假的。
{
  const { teamValue, TEAM_FIELDS } = await import(
    pathToFileURL(join(ROOT, 'src/frontend/js/catalog/server.js')).href
  );

  const boolField = jar.boolean[0];
  const intField = jar.int[0];
  const floatField = jar.float[0];

  const cases = [
    [boolField, 'true', 'true'],
    [boolField, '是', 'true'],
    [boolField, '', 'false'],
    [intField, '10', '10'],
    [intField, '10.7', '11'],           // 取整，不能写出 11.7 给 int
    [floatField, '2.5', '2.5f'],        // 必须有 f 后缀
    [floatField, '3', '3f'],
  ];
  let allOk = true;
  for (const [f, input, want] of cases) {
    const got = teamValue(f, input);
    if (got !== want) { bad(`${f}("${input}") = ${got}，应该是 ${want}`); allOk = false; }
  }
  // 浮点字段全部都要带 f 后缀
  for (const f of jar.float) {
    if (!/f$/.test(teamValue(f, '1'))) { bad(`float 字段 ${f} 生成的字面量没有 f 后缀`); allOk = false; }
  }
  // boolean / int 字段绝不能带 f
  for (const f of [...jar.boolean, ...jar.int]) {
    if (/f$/.test(teamValue(f, '1'))) { bad(`${f} 是 boolean/int，生成的字面量却带了 f 后缀`); allOk = false; }
  }
  if (allOk) ok('boolean / int / float 三种字面量都合法（float 带 f 后缀、int 取整）');

  // 每个字段都要能在下拉里被选到（否则面板上有、生成时找不到）
  const labelCount = new Set(TEAM_FIELDS.map((x) => x[1])).size;
  if (labelCount !== TEAM_FIELDS.length) bad('TEAM_FIELDS 里有重名的中文标签（下拉会混淆）');
  else ok(`${TEAM_FIELDS.length} 个字段的中文标签都不重复`);
}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
