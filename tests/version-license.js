// 版本号与开源协议的一致性检查。
//
// 目的：版本号只有一个手写的地方（仓库根 VERSION），其它地方都是派生的；
// 谁要是绕过同步脚本手改了某一处，这里就会报出来。协议文件同理 ——
// 「设置里显示的协议」必须和 LICENSE 文件真的是同一个。

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

// ---------- 1. VERSION 存在且合法 ----------
console.log('=== 1. VERSION 是唯一真源 ===');
const vPath = join(ROOT, 'VERSION');
if (!existsSync(vPath)) {
  bad('缺少 VERSION 文件（版本号的唯一来源）');
} else {
  const ver = readFileSync(vPath, 'utf8').trim();
  if (/^\d+\.\d+\.\d+$/.test(ver)) ok(`VERSION = ${ver}`);
  else bad(`VERSION 内容非法：'${ver}'（应形如 1.2.3）`);

  // ---------- 2. 派生处是否都跟上了 ----------
  console.log('\n=== 2. 派生处与 VERSION 一致 ===');
  const r = spawnSync('node', ['tests/sync-version.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status === 0) {
    ok('Cargo.toml / tauri.conf.json / src/frontend/js/version.js 都跟 VERSION 一致');
  } else {
    bad('有地方和 VERSION 不一致：\n      ' + out.split('\n').filter(l => l.includes('❌')).join('\n      '));
  }

  // 硬断言：三处文件里真的出现了这个号码
  const cargo = readFileSync(join(ROOT, 'src/backend/Cargo.toml'), 'utf8');
  const conf = readFileSync(join(ROOT, 'src/backend/tauri.conf.json'), 'utf8');
  const vjs = readFileSync(join(ROOT, 'src/frontend', 'js', 'version.js'), 'utf8');
  for (const [what, text] of [['Cargo.toml', cargo], ['tauri.conf.json', conf], ['src/frontend/js/version.js', vjs]]) {
    if (text.includes(ver)) ok(`${what} 含 ${ver}`);
    else bad(`${what} 里没有 ${ver}`);
  }

  // 不该有第二个手写的版本号：搜其它文件里的 version 字面量
  const confJson = JSON.parse(conf);
  if (confJson.version === ver) ok('tauri.conf.json 的 version 字段正确');
  else bad(`tauri.conf.json 的 version 是 ${confJson.version}，应为 ${ver}`);
}

// ---------- 3. 协议文件 ----------
console.log('\n=== 3. LICENSE 与设置里显示的一致 ===');
const licPath = join(ROOT, 'LICENSE');
if (!existsSync(licPath)) {
  bad('缺少 LICENSE 文件');
} else {
  const lic = readFileSync(licPath, 'utf8');
  if (/^MIT License/m.test(lic)) ok('LICENSE 是 MIT');
  else bad('LICENSE 不是 MIT 协议');

  // 版权行必须有年份和名字
  const m = lic.match(/Copyright\s+\(c\)\s+(\d{4})\s+(.+)/);
  if (m) ok(`版权行：Copyright (c) ${m[1]} ${m[2].trim()}`);
  else bad('LICENSE 里缺少 Copyright (c) 年份 名字 这一行');

  // 设置页「关于」里展示的协议名必须和 LICENSE 对得上
  const sp = readFileSync(join(ROOT, 'src/frontend', 'js', 'settingspage.js'), 'utf8');
  if (/MIT License/.test(sp)) ok('设置页显示 MIT License，与 LICENSE 一致');
  else bad('设置页没显示协议名（或与 LICENSE 不一致）');

  // Rust 侧的 app_license 也要一致
  const rs = readFileSync(join(ROOT, 'src/backend', 'src', 'main.rs'), 'utf8');
  if (/fn app_license[\s\S]{0,200}?MIT License/.test(rs)) ok('Rust 的 app_license 返回 MIT License');
  else bad('Rust 的 app_license 与 LICENSE 不一致');

  // 版权人要和 LICENSE 里的一致
  const name = m ? m[2].trim() : null;
  if (name) {
    const rsAuthor = rs.match(/fn app_author[\s\S]{0,200}?"([^"]+)"/);
    if (rsAuthor && rsAuthor[1] === name) ok(`Rust 的 app_author 与 LICENSE 一致（${name}）`);
    else bad(`Rust 的 app_author（${rsAuthor ? rsAuthor[1] : '找不到'}）与 LICENSE 的版权人（${name}）不一致`);
  }
}

// ---------- 4. 关于页真的要显示这些 ----------
console.log('\n=== 4. 设置里确实有「关于」且接上了线 ===');
const settings = readFileSync(join(ROOT, 'src/frontend', 'js', 'settings.js'), 'utf8');
if (/id:\s*'about'/.test(settings)) ok('设置里有「关于」分类');
else bad('设置里没有「关于」分类');
if (/__version/.test(settings) && /版本/.test(settings)) ok('关于里有「版本」项');
else bad('关于里没有版本项');
if (/__license/.test(settings) && /开源协议/.test(settings)) ok('关于里有「开源协议」项');
else bad('关于里没有协议项');
// info 项不能进 localStorage（否则会被当成用户设置读回来）
if (/isInfo\(it\)\)\s*o\[it\.key\]/.test(settings) || /if\s*\(!isInfo\(it\)\)\s*o\[it\.key\]/.test(settings)) {
  ok('info 项被排除在默认值之外（不会写进 localStorage）');
} else {
  bad('info 项会进 state —— 只读项不该被存盘');
}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
