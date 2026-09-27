// 源码编码健康检查。
//
// 为什么需要它：本项目所有注释和界面文案都是中文，而 Windows PowerShell 5.1
// 的 `Get-Content` 默认按 ANSI(GBK) 解码、`Out-File -Encoding utf8` 再写回，
// 一次「读出来改一下写回去」就能把整个文件的 UTF-8 中文变成乱码，
// 而且文件仍然是合法的 JS（字符串和注释都可以是任意字符），语法检查、
// 单元测试**全都不会报错** —— 只是注释变成「鐢诲竷锛氳嚜鐢辨憜鏀」，
// 界面上的中文文案也跟着烂掉。
//
// 这个脚本是真发生过的：canvas.js 被这样毁过一次，靠编译产物里嵌的副本才救回来。
// 所以加一道便宜的兜底：直接在字节层面查这几个特征。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

// 要检查的源码与文档（都是 UTF-8，且都含中文）
const DIRS = ['src/frontend/js', 'src/frontend/css', 'src/backend/src', 'tests', 'docs'];
const EXTS = new Set(['.js', '.css', '.rs', '.ps1', '.html', '.json', '.md']);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(name))) out.push(p);
  }
  return out;
}

const files = [
  join(ROOT, 'src/frontend/index.html'),
  join(ROOT, 'README.md'),
  ...DIRS.flatMap(d => walk(join(ROOT, d))),
  // 本文件自己就带着乱码样本当检测特征，不能拿它检查它自己
].filter((f, i, a) => a.indexOf(f) === i && f !== fileURLToPath(import.meta.url));

console.log('=== 1. 没有替换字符（解码失败的标志）===');
{
  // U+FFFD 是「按错误的编码解码」时留下的痕迹，正常源码里绝不该出现
  const hits = [];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    if (t.includes('\uFFFD')) hits.push(relative(ROOT, f));
  }
  if (hits.length) bad(`这些文件含替换字符 U+FFFD（编码被破坏过）：${hits.join(', ')}`);
  else ok(`${files.length} 个文件都不含 U+FFFD`);
}

console.log('\n=== 2. 没有 UTF-8 被当成 GBK 解读后的典型乱码 ===');
{
  // 这些字是「UTF-8 中文被按 GBK 解码」后高频出现的产物，
  // 正常的中文技术文案里几乎不会连续出现它们。
  const suspects = ['鐢诲竷', '锛氳', '鑴氭湰', '鍔熻兘', '鐣岄潰', '鏂囦欢', '棰滆壊',
    '璁剧疆', '鎺т欢', '杈撳叆', '鍥剧墖', '缂栬緫', '鏄剧ず', '鍒犻櫎'];
  const hits = [];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    for (const s of suspects) {
      if (t.includes(s)) { hits.push(`${relative(ROOT, f)} 含「${s}」`); break; }
    }
  }
  if (hits.length) bad(`疑似 GBK 乱码：\n      ${hits.join('\n      ')}`);
  else ok(`${suspects.length} 个乱码特征都没有出现`);
}

console.log('\n=== 3. 该有中文的文件确实还有中文 ===');
{
  // 反证：以上两条只查「有没有乱码」，一个被清空或被写成纯 ASCII 的文件
  // 同样能通过。所以再查关键文件里中文是否还在。
  const mustHaveChinese = [
    ['src/frontend/js/canvas.js', ['画布', '缩放']],
    ['src/frontend/js/ui.js', ['工具栏', '保存']],
    ['src/frontend/js/store.js', ['撤销']],
    ['src/frontend/js/settings.js', ['设置']],
    ['README.md', ['插件', '画布']],
    // 文档是最重中文的部分，也是最容易被 PowerShell 往返毁掉的地方
    ['docs/使用手册.md', ['画布', '导出']],
    ['docs/控件参考.md', ['控件']],
    ['docs/README.md', ['文档']],
    // Rust 源码现在也有中文注释了（崩溃日志那段），一并守住 ——
    // 它同样会被 PowerShell 往返毁掉。
    ['src/backend/src/main.rs', ['插件', '日志']],
  ];
  let allOk = true;
  for (const [rel, words] of mustHaveChinese) {
    if (!words.length) continue;
    const t = readFileSync(join(ROOT, rel), 'utf8');
    const missing = words.filter(w => !t.includes(w));
    if (missing.length) { bad(`${rel} 里找不到中文「${missing.join('、')}」——文件可能被改坏了`); allOk = false; }
  }
  if (allOk) ok('关键文件的中文文案都还在');
}

console.log('\n=== 4. 文件没有被压成一行 ===');
{
  // PowerShell 的 -replace 往返还有另一个副作用：换行被吞掉、整个文件挤成一两行。
  // 行数骤降是很好抓的信号。
  const minLines = {
    'src/frontend/js/canvas.js': 400,
    'src/frontend/js/ui.js': 600,
    'src/frontend/js/catalog/others2.js': 400,
    'src/frontend/css/app.css': 500,
    'docs/使用手册.md': 300,
    'docs/控件参考.md': 200,
  };
  let allOk = true;
  for (const [rel, min] of Object.entries(minLines)) {
    const n = readFileSync(join(ROOT, rel), 'utf8').split('\n').length;
    if (n < min) { bad(`${rel} 只有 ${n} 行（预期至少 ${min}）——可能被压成一行了`); allOk = false; }
  }
  if (allOk) ok(`${Object.keys(minLines).length} 个文件的换行结构正常`);
}

console.log('\n=== 5. build.ps1 必须是纯 ASCII ===');
{
  // build.ps1 走的是 Windows PowerShell 5.1，它**按 ANSI 代码页**解析 .ps1
  // 文件（不是 UTF-8）。里面一旦出现中文注释，就会被解析成乱码字节，
  // 轻则报错、重则把后面的语法结构吃掉。所以这个文件只能写英文。
  //
  // 我自己就犯过：给 log-unit.js 加注释时顺手写了「按钮: fit」，文件仍是
  // 合法 PS 脚本、单跑也看不出来 —— 只有在别的机器 / 别的代码页上才炸。
  const p = join(ROOT, 'build.ps1');
  const raw = readFileSync(p);
  const offenders = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] > 127) offenders.push(`字节 ${i} = 0x${raw[i].toString(16)}`);
    if (offenders.length >= 5) break;
  }
  if (offenders.length) {
    bad(`build.ps1 里有非 ASCII 字节（PS 5.1 按 ANSI 解析会出错）：${offenders.join(', ')}`);
  } else {
    ok('build.ps1 是纯 ASCII（PS 5.1 能安全解析）');
  }
}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
