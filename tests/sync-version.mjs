// 版本号单一来源：仓库根目录的 VERSION 文件。
//
// 这个脚本把 VERSION 里的号码写进 Cargo.toml 和 tauri.conf.json，
// 于是「设置里显示的版本」「exe 文件属性里的版本」「Cargo 记录的版本」
// 永远来自同一个地方，不会各写各的。
//
// 为什么用 node 而不是 PowerShell：tauri.conf.json 里有中文（productName
// 是「KTS 插件工坊」），而 PowerShell 5.1 的 Get-Content/Set-Content
// 会把 UTF-8 当 ANSI 解码再写回，一次往返就把中文变成乱码 —— 这个坑真
// 踩过一次（详见详细设计决策 57）。node 读写 UTF-8 是确定的。
//
// 用法：node tests/sync-version.mjs [--check]
//   --check 只检查是否一致，不修改（给测试用）。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

function fail(msg) {
  console.error('  ❌ ' + msg);
  process.exit(1);
}

// ---------- 1. 读取唯一真源 ----------
const versionPath = join(ROOT, 'VERSION');
if (!existsSync(versionPath)) fail('找不到 VERSION 文件（版本号的唯一来源）');

const version = readFileSync(versionPath, 'utf8').trim();

// 必须是合法 semver，否则 cargo 会拒绝编译，错误信息还很难懂
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`VERSION 内容不是合法版本号：'${version}'（应形如 1.2.3）`);
}
console.log(`  VERSION = ${version}`);

let changed = 0;
let mismatched = 0;

// ---------- 2. Cargo.toml ----------
{
  const p = join(ROOT, 'src/backend/Cargo.toml');
  const before = readFileSync(p, 'utf8');
  // 只改 [package] 段里的那一行 —— 依赖项也写着 version = "..."
  const m = before.match(/\[package\][\s\S]*?(?=\n\[|$)/);
  if (!m) fail('Cargo.toml 里找不到 [package] 段');

  const seg = m[0];
  const cur = seg.match(/^version\s*=\s*"([^"]*)"/m);
  if (!cur) fail('Cargo.toml 的 [package] 段里找不到 version');

  if (cur[1] === version) {
    console.log(`  ✅ Cargo.toml 已是 ${version}`);
  } else if (CHECK_ONLY) {
    console.log(`  ❌ Cargo.toml 是 ${cur[1]}，应为 ${version}`);
    mismatched++;
  } else {
    const fixedSeg = seg.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
    writeFileSync(p, before.replace(seg, fixedSeg), 'utf8');
    console.log(`  ✅ Cargo.toml：${cur[1]} -> ${version}`);
    changed++;
  }
}

// ---------- 3. tauri.conf.json ----------
{
  const p = join(ROOT, 'src/backend/tauri.conf.json');
  const before = readFileSync(p, 'utf8');
  // 只替换顶层的 "version"（第一个出现的就是它）
  const cur = before.match(/"version"\s*:\s*"([^"]*)"/);
  if (!cur) fail('tauri.conf.json 里找不到 version');

  if (cur[1] === version) {
    console.log(`  ✅ tauri.conf.json 已是 ${version}`);
  } else if (CHECK_ONLY) {
    console.log(`  ❌ tauri.conf.json 是 ${cur[1]}，应为 ${version}`);
    mismatched++;
  } else {
    const fixed = before.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${version}"`);
    writeFileSync(p, fixed, 'utf8');
    // 断言没把中文写坏（这正是用 node 的原因）
    const after = readFileSync(p, 'utf8');
    if (!after.includes('KTS 插件工坊')) {
      fail('写回 tauri.conf.json 后中文坏了 —— 立刻停止');
    }
    console.log(`  ✅ tauri.conf.json：${cur[1]} -> ${version}`);
    changed++;
  }
}

// ---------- 4. 前端也要能显示（给浏览器调试用） ----------
{
  const p = join(ROOT, 'src/frontend', 'js', 'version.js');
  const want = `// 版本号（构建时由 tests/sync-version.mjs 从仓库根 VERSION 写入）。
// 桌面版实际用的是 Rust 的 app_version（编译期常量，和 exe 属性一致）；
// 这个常量只是浏览器里打开 ui/ 调试时的兜底显示值。
export const VERSION = '${version}';
`;
  const cur = existsSync(p) ? readFileSync(p, 'utf8') : '';
  if (cur === want) {
    console.log(`  ✅ src/frontend/js/version.js 已是 ${version}`);
  } else if (CHECK_ONLY) {
    console.log(`  ❌ src/frontend/js/version.js 与 VERSION 不一致`);
    mismatched++;
  } else {
    writeFileSync(p, want, 'utf8');
    console.log(`  ✅ src/frontend/js/version.js -> ${version}`);
    changed++;
  }
}

// ---------- 5. 结果 ----------
if (CHECK_ONLY) {
  if (mismatched) {
    console.log(`\n  ❌ ${mismatched} 处不一致（跑 node tests/sync-version.mjs 可自动修正）`);
    process.exit(1);
  }
  console.log('\n  ✅ 版本号处处一致');
} else {
  console.log(changed ? `\n  ✅ 已同步 ${changed} 处` : '\n  ✅ 无需改动');
}
