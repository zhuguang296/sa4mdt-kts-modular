// 样式表自检：CSS 变量不能自己引用自己，用到的变量必须有定义。
//
// 为什么需要这个：主题重构成变量时很容易犯两种错，而且**都不报错**，
// 只是页面上某块颜色突然不对/变成透明 ——
//   1) `--danger-hover: var(--danger-hover);`   自己引用自己，变量失效
//   2) `color: var(--nope)`                     拼错名字，静默退回无色
// 这类错误肉眼过一遍很难发现，交给脚本查。
//
// 用法： node tests/css-vars.js
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'src/frontend/css/app.css'), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

// 去掉注释，避免把注释里写的示例当成真代码
const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

// 收集所有定义： --name: value;   （允许多个变量挤在同一行）
const defines = [];   // { name, value, line }
const lines = clean.split('\n');
lines.forEach((l, i) => {
  for (const m of l.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]*)/g)) {
    defines.push({ name: m[1], value: m[2], line: i + 1 });
  }
});

console.log('=== 1. 变量不能自己引用自己 ===');
{
  const selfRefs = defines.filter(d => d.value.includes(`var(${d.name})`));
  if (selfRefs.length) {
    for (const d of selfRefs) bad(`第 ${d.line} 行：${d.name} 引用了自己 —— ${d.value.trim()}`);
  } else {
    ok(`${defines.length} 个变量定义，没有自我引用`);
  }
}

console.log('\n=== 2. 用到的变量都有定义（或是有意留的兜底） ===');
{
  const defined = new Set(defines.map(d => d.name));
  const used = new Map();   // name -> 第一次出现的行号
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/var\((--[A-Za-z0-9_-]+)/g)) {
      if (!used.has(m[1])) used.set(m[1], i + 1);
    }
  });
  // 这些由 JS 在运行时写到元素上（settings.js / canvas.js 的 applyGrid），
  // CSS 里查不到定义是正常的
  const fromJs = new Set(['--ui-font-size', '--code-font-size', '--grid-size']);
  const missing = [...used.entries()].filter(([n]) => !defined.has(n) && !fromJs.has(n));
  if (missing.length) {
    for (const [n, ln] of missing) bad(`第 ${ln} 行用到 ${n}，但它没有定义（拼错了？）`);
  } else {
    ok(`用到的 ${used.size} 个变量全部有出处`);
  }
  const fromJsUsed = [...used.keys()].filter(n => fromJs.has(n));
  if (fromJsUsed.length) ok(`其中 ${fromJsUsed.join(' / ')} 由 js/settings.js 在运行时提供`);
}

console.log('\n=== 3. 两套主题定义同一批变量 ===');
{
  // 按 `:root {` 和 `[data-theme="dark"] {` 切块，比较变量名集合
  const grab = (startRe) => {
    const i = clean.search(startRe);
    if (i < 0) return null;
    const s = clean.indexOf('{', i);
    let depth = 0, j = s;
    for (; j < clean.length; j++) {
      if (clean[j] === '{') depth++;
      else if (clean[j] === '}') { depth--; if (!depth) break; }
    }
    const body = clean.slice(s + 1, j);
    return new Set([...body.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map(m => m[1]));
  };
  const light = grab(/^:root\s*\{/m);
  const dark = grab(/^\[data-theme="dark"\]\s*\{/m);
  if (!light || !dark) bad('找不到 :root 或 [data-theme="dark"] 变量块');
  else {
    // 深色块允许不重定义「结构」变量（--r / --font / --mono 这些与配色无关）
    const structural = new Set(['--r', '--font', '--mono', '--ui-font-size', '--code-font-size']);
    const missingDark = [...light].filter(n => !dark.has(n) && !structural.has(n));
    const extraDark = [...dark].filter(n => !light.has(n));
    if (missingDark.length) bad(`深色主题漏了这些变量：${missingDark.join(', ')}（会继承浅色值，可能出现白底黑字）`);
    else ok(`深色主题覆盖了全部 ${dark.size} 个配色变量`);
    if (extraDark.length) bad(`深色主题多出浅色没有的变量：${extraDark.join(', ')}`);
  }
}

console.log('\n=== 4. [hidden] 兜底存在 ===');
{
  // [hidden] 只是浏览器默认样式，作者写的 display 会盖掉它。
  // 必须有一条带 !important 的兜底规则，否则「设了 hidden 还看得见」。
  if (/\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(clean)) {
    ok('[hidden] { display: none !important } 兜底存在');
  } else {
    bad('缺少 [hidden] 的 !important 兜底 —— display:flex 的组件会盖掉 hidden 属性');
  }
}

console.log('\n=== 5. 不再有写死的浅色主题色值 ===');
{
  // :root 之外不该再出现这批浅色专用的字面量（重构后都应走变量）
  const lightOnly = [
    ['#fde2e2', '删除按钮悬停底色'],
    ['#9aa3b8', '连线颜色'],
    ['#b6bccb', '次要连线颜色'],
    ['#d3d8e2', '网格点'],
    ['#c3c9d6', '空画布虚线'],
    ['#ccd2dd', '滚动条'],
    ['#b3bbc9', '滚动条悬停'],
    ['#98a0b0', '灰字'],
  ];
  // 只看 :root 块之外的部分
  const rootEnd = clean.indexOf('}', clean.indexOf(':root'));
  const after = clean.slice(rootEnd);
  const hits = lightOnly.filter(([hex]) => after.includes(hex));
  if (hits.length) {
    for (const [hex, what] of hits) bad(`:root 之外还有写死的 ${hex}（${what}）—— 深色主题下不会变`);
  } else {
    ok(`${lightOnly.length} 个浅色专用色值都已改成变量`);
  }
}

console.log('\n=== 6. 没有写死的半透明白/黑（深色主题的暗礁）===');
{
  // 上一版漏掉的就是这一类：「类型」小标签写了 rgba(255,255,255,.7)，
  // 浅色下没问题，深色下变成**白底 + 近白色的字**，整个标签看不见。
  // 十六进制色值黑名单查不到 rgba()，所以这里单独查。
  //
  // 允许的例外：
  //   - 蒙层遮罩（modal-mask / 画布框选）本来就是半透明黑，两套主题通用
  //   - :root / [data-theme] 变量定义块内（那里正是定义颜色的地方）
  //   - .code-dark 代码区（它恒定深色，白字是刻意的）
  const hexRootEnd = clean.indexOf('}', clean.indexOf(':root'));
  const darkBlock = clean.indexOf('[data-theme="dark"]');
  const darkEnd = darkBlock >= 0 ? clean.indexOf('}', darkBlock) : -1;
  const codeDarkStart = clean.indexOf('.code-dark');
  const fatalStart = clean.indexOf('#fatal');
  const fatalEnd = fatalStart >= 0 ? clean.indexOf('::-webkit-scrollbar', fatalStart) : -1;

  // 逐行检查，能明确报出行号
  const lines = clean.split('\n');
  const offenders = [];
  lines.forEach((line, i) => {
    const m = line.match(/rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,[^)]*\)|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,[^)]*\)/);
    if (!m) return;
    const at = clean.indexOf(line);
    if (at < hexRootEnd) return;                        // :root 变量区
    if (darkEnd > 0 && at > darkBlock && at < darkEnd) return;  // 深色变量区
    if (codeDarkStart >= 0 && at > codeDarkStart && at < codeDarkStart + 400) return; // 代码区
    // #fatal 报错框恒定深色（和代码区同类），白系半透明是刻意的
    if (fatalStart >= 0 && fatalEnd > 0 && at > fatalStart && at < fatalEnd) return;
    // 遮罩/框选这类「本来就该半透明黑」的允许保留
    if (/mask|marquee|overlay|shadow|scrim/i.test(line)) return;
    if (/box-shadow|text-shadow/i.test(line)) return;
    offenders.push(`第 ${i + 1} 行: ${line.trim().slice(0, 90)}`);
  });

  if (offenders.length) {
    bad(`发现写死的半透明白/黑（深色主题下很可能变成「同色看不见」）：\n      ${offenders.join('\n      ')}`);
  } else {
    ok('没有写死的半透明白/黑（都已走 --nc-chip / --hover / --danger-hover 这类变量）');
  }
}

console.log('\n=== 7. 深色主题下前景/背景不会撞成同色 ===');
{
  // 从 [data-theme="dark"] 块里取出配色，检查几组「叠在一起」的
  // 背景-文字配对，确保亮度差够大。数值来自实际渲染，这条是兜底。
  const darkStart = clean.indexOf('[data-theme="dark"]');
  const darkEnd = clean.indexOf('}', darkStart);
  const block = darkStart >= 0 ? clean.slice(darkStart, darkEnd) : '';
  const val = (name) => {
    const m = block.match(new RegExp('--' + name + ':\\s*([^;]+);'));
    return m ? m[1].trim() : null;
  };
  const lum = (c) => {
    if (!c) return null;
    const h = c.match(/^#([0-9a-f]{6})$/i);
    if (h) {
      const n = parseInt(h[1], 16);
      return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    }
    const r = c.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+([\d.]+))?\)/);
    if (r) {
      const a = r[4] === undefined ? 1 : Number(r[4]);
      // 半透明白叠在卡头上：按 alpha 分层估算，只要不是「白叠白」就够
      return ((0.299 * Number(r[1]) + 0.587 * Number(r[2]) + 0.114 * Number(r[3])) / 255) * a;
    }
    return null;
  };

  // 关键配对：卡片头底色 vs 类型标签文字
  const pairs = [
    ['nc-event', 'nc-chip-fg', '事件卡头 / 类型标签字'],
    ['nc-action', 'nc-chip-fg', '动作卡头 / 类型标签字'],
    ['nc-condition', 'nc-chip-fg', '条件卡头 / 类型标签字'],
    ['bg-2', 'fg-2', '面板底 / 次要文字'],
    ['bg-3', 'fg', '卡片底 / 正文'],
  ];
  let allOk = true;
  for (const [bgName, fgName, what] of pairs) {
    const b = val(bgName), f = val(fgName);
    const bl = lum(b), fl = lum(f);
    if (bl == null || fl == null) continue;
    const diff = Math.abs(bl - fl);
    if (diff < 0.18) {
      bad(`${what}：深色下亮度只差 ${diff.toFixed(2)}（${b} vs ${f}）—— 会看不清`);
      allOk = false;
    }
  }
  if (allOk) ok('深色主题的关键配色配对亮度差都够（≥ 0.18）');
}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
