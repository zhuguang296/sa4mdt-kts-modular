// 决定性验证：证明 exe 里嵌入的前端资源，就是当前 src/frontend/ 目录的内容。
//
// 原理：cargo 构建时，Tauri 的 proc macro 会把前端资源（文本类用 brotli 压缩）
// 写到 target/<profile>/build/kts-builder-<hash>/out/tauri-codegen-assets/。
// 因此做法是：把这些资源全部解压，与本地 src/frontend/ 文件按「内容 sha256」比对。
//
// 这个脚本还能发现一个很隐蔽的问题：**exe 是不是用旧版前端构建的**
// （改了 src/frontend/ 但忘了重新编译，界面就还是老的）。
//
// 用法： node tests/verify-embed.js [--profile release|debug]

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { brotliDecompressSync, inflateSync, inflateRawSync } from 'node:zlib';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

const args = process.argv.slice(2);
const pi = args.indexOf('--profile');
const profile = pi >= 0 ? args[pi + 1] : 'release';

const SRC = join(ROOT, 'src/frontend');
const BUILD = join(ROOT, 'src/backend/target', profile, 'build');

if (!existsSync(BUILD)) {
  console.error(`找不到构建目录：${BUILD}\n请先运行 cargo build。`);
  process.exit(1);
}

const sha = (b) => createHash('sha256').update(b).digest('hex');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---------------- 本地 src/frontend/ 内容 ----------------

const local = walk(SRC).map((p) => {
  const raw = readFileSync(p);
  return { rel: relative(SRC, p).replace(/\\/g, '/'), raw, hash: sha(raw) };
});
const localByHash = new Map(local.map((f) => [f.hash, f]));

// ---------------- 解压所有 codegen 资源 ----------------

function tryDecompress(buf) {
  for (const [name, fn] of [
    ['brotli', () => brotliDecompressSync(buf)],
    ['zlib', () => inflateSync(buf)],
    ['deflateRaw', () => inflateRawSync(buf)],
  ]) {
    try {
      const out = fn();
      if (out && out.length) return { name, data: out };
    } catch { /* 试下一种 */ }
  }
  return null;
}

const assetDirs = [];
for (const d of readdirSync(BUILD)) {
  if (!d.startsWith('kts-builder-')) continue;
  const a = join(BUILD, d, 'out', 'tauri-codegen-assets');
  if (existsSync(a)) assetDirs.push({ dir: a, mtime: statSync(a).mtime });
}
if (!assetDirs.length) {
  console.error('找不到 tauri-codegen-assets（Tauri 未处理前端资源？）');
  process.exit(1);
}
// 用最新的那个（旧的构建目录会残留上一代资源）
assetDirs.sort((a, b) => b.mtime - a.mtime);
const assetsDir = assetDirs[0].dir;

// 每个资源 -> 原始内容（压缩的解开，得到 Tauri 实际嵌入的那份字节）
const embedded = new Map();   // 原始内容 hash -> 资源信息
let assetCount = 0;
for (const f of readdirSync(assetsDir)) {
  const p = join(assetsDir, f);
  if (!statSync(p).isFile()) continue;
  const buf = readFileSync(p);
  assetCount++;

  const dec = tryDecompress(buf);
  // 压缩成功说明原始内容是解压后的；否则原样
  const original = dec ? dec.data : buf;
  const how = dec ? dec.name : '明文';
  const h = sha(original);
  if (!embedded.has(h)) {
    embedded.set(h, { file: f, size: original.length, how });
  }
}

console.log(`profile    : ${profile}`);
console.log(`资源目录   : ${relative(ROOT, assetsDir)}`);
console.log(`本地 src/frontend/: ${local.length} 个文件`);
console.log(`codegen    : ${assetCount} 个资源\n`);

// ---------------- 比对 ----------------

let hit = 0;
const rows = [];
for (const f of local) {
  const e = embedded.get(f.hash);
  if (e) {
    hit++;
    rows.push([f.rel, f.raw.length, e.how, '✅ 内容一致']);
  } else {
    rows.push([f.rel, f.raw.length, '—', '❌ 未嵌入 / 内容不同']);
  }
}

console.log('=== 逐文件验证 ===');
for (const [rel, size, how, verdict] of rows) {
  console.log(`  ${verdict.padEnd(14)} ${rel.padEnd(34)} ${String(size).padStart(7)} B  ${how}`);
}

console.log(`\n命中：${hit} / ${local.length}`);

// ---------------- 新旧检查：exe 是不是用旧版前端构建的 ----------------
//
// 注意：tauri-codegen-assets 目录会跨多次构建累积文件，所以「找不到对应本地文件」
// 并不代表 exe 里是旧内容（可能只是上一轮的残留）。可靠的做法是比时间戳。

const exePath = join(ROOT, 'src/backend/target', profile, 'kts-builder.exe');
let staleBy = null;
if (existsSync(exePath)) {
  const exeTime = statSync(exePath).mtimeMs;
  let newest = 0, newestFile = '';
  for (const f of walk(SRC)) {
    const t = statSync(f).mtimeMs;
    if (t > newest) { newest = t; newestFile = relative(ROOT, f).replace(/\\/g, '/'); }
  }
  const asetsTime = statSync(assetsDir).mtimeMs;
  console.log(`\n=== 时间戳 ===`);
  console.log(`  exe            : ${new Date(exeTime).toLocaleString()}`);
  console.log(`  最新 src/frontend/ 文件: ${new Date(newest).toLocaleString()}  (${newestFile})`);
  console.log(`  codegen 资源   : ${new Date(asetsTime).toLocaleString()}`);

  if (newest > exeTime) {
    staleBy = newestFile;
    console.log(`\n  ⚠️ ${newestFile} 比 exe 还新 —— exe 是旧版前端构建的`);
  } else {
    console.log(`\n  ✅ 所有 src/frontend/ 文件都不比 exe 新`);
  }
} else {
  console.log(`\n⚠️ 找不到 ${relative(ROOT, exePath)}，跳过时间戳检查`);
}

const allGood = hit === local.length && !staleBy;
console.log(allGood
  ? '\n✅ exe 嵌入的前端资源与当前 src/frontend/ 逐字节一致，且构建时间不落后'
  : `\n❌ ${local.length - hit} 个文件未嵌入` + (staleBy ? `；exe 落后于 ${staleBy}` : ''));

process.exit(allGood ? 0 : 1);
