// 端到端验证日志文件：真的让工具写日志，然后读回 exe 旁边的
// logs\kts-builder-YYYY-MM-DD.txt，确认内容**能用来定位问题**。
//
// 为什么不能只验「IPC 返回成功」：用户报「有几个按钮一点就崩溃」时，
// 我们复现不出来 —— 发过来的那个日志文件就是唯一的线索。
// 它必须带时间戳、版本号、真实堆栈、当时的工程规模，否则等于没有。
//
// 这里验这些：
//   ① 文件真的落在 exe 旁边的 logs\ 里，文件名带日期
//   ② 启动信息、操作、耗时都在
//   ③ 崩溃写进去了，带栈 + 工程规模 + 崩溃前的操作轨迹
//   ④ 第二条日志是**追加**的，没有覆盖第一条
//   ⑤ **不记录生成的 Kotlin 代码**（用户明确要求）

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = join(ROOT, 'KTS-Plugin-Workshop.exe');
const PORT = 9348;

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close: () => ws.close(),
    }));
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });
  });
}

async function evaluate(cdp, expr, ms = 20000) {
  const r = await Promise.race([
    cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no debug target');
}

/**
 * 等界面真的启动完，而不是睡一个固定秒数。
 *
 * 机器空闲时够；构建到这一步时后台还有别的活儿，启动会明显变慢，
 * 后面的 querySelector / dispatch 就会打到还没建好的界面上，
 * 报出看不懂的 null 错误 —— 假失败，工具其实没问题。
 */
async function waitBoot(cdp, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const ready = await evaluate(cdp, `(() => {
        const skip = document.getElementById('obSkip');
        if (skip) skip.click();            // 关掉欢迎页
        return !!(window.__app && document.getElementById('toolbar'));
      })()`);
      if (ready) { await new Promise((r) => setTimeout(r, 400)); return true; }
    } catch { /* 还没就绪 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('启动后 15 秒内界面仍未就绪');
}

// exe 复制到临时目录 —— 日志写在它旁边，不能污染仓库
const work = mkdtempSync(join(tmpdir(), 'kts-logtest-'));
const runExe = join(work, 'KTS-Plugin-Workshop.exe');
copyFileSync(EXE, runExe);
const logsDir = join(work, 'logs');

const child = spawn(runExe, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    WEBVIEW2_USER_DATA_FOLDER: join(work, 'profile'),
  },
  stdio: 'ignore',
});

/** 找到今天那个日志文件（按日期命名，测试不该假设具体日期） */
function findLogFile() {
  if (!existsSync(logsDir)) return '';
  const files = readdirSync(logsDir).filter((f) => /^kts-builder-\d{4}-\d{2}-\d{2}\.txt$/.test(f));
  return files.length ? join(logsDir, files[0]) : '';
}

try {
  const target = await findTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await waitBoot(cdp);

  console.log('=== 日志文件端到端 ===\n');

  // ---- ① 启动就该写出一条「应用启动」 ----
  await new Promise((r) => setTimeout(r, 1200));
  const f1 = findLogFile();
  if (f1) ok(`日志落在 exe 旁的 logs\\ 里：${f1.split(/[\\/]/).pop()}`);
  else bad('logs 文件夹里没有 kts-builder-YYYY-MM-DD.txt');

  let startText = f1 ? readFileSync(f1, 'utf8') : '';
  if (/应用启动/.test(startText)) ok('启动时写了「应用启动」记录');
  else bad('启动没有写日志（默认开启却没记）');
  if (/v\d+\.\d+\.\d+/.test(startText)) ok('日志里带版本号（能对上哪个版本）');
  else bad('日志里没有版本号');
  if (/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(startText)) ok('日志里带本地时间戳');
  else bad('日志里没有时间戳');

  // ---- ② 操作日志 + 耗时 ----
  await evaluate(cdp, `(async () => { await window.__app.dispatch('fit'); return true; })()`);
  await evaluate(cdp, `(async () => { await window.__app.dispatch('zin'); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  let text = readFileSync(f1, 'utf8');
  if (/操作: 按钮: fit/.test(text) && /操作: 按钮: zin/.test(text)) {
    ok('按钮操作都记下来了（用户说「点了个按钮」时能定位是哪个）');
  } else {
    bad('按钮操作没有被记录');
  }
  // 耗时：用户要「耗时详细」—— 每个按钮响应多久
  if (/耗时: 按钮 fit \d+ms/.test(text)) ok('按钮响应耗时记下来了');
  else bad('没有记按钮耗时（用户说「点了要等好久」时查不出来）');
  // 「校验错误逐条记」：日志里要能看到汇总行
  if (/校验：\d+ 个错误、\d+ 个提醒/.test(text)) ok('校验结果有汇总记录');
  else bad('没有记校验汇总');

  // ---- ③ 崩溃写进同一份日志，且带栈 ----
  const primed = await evaluate(cdp, `(async () => {
    window.__origRenderLibrary = window.__app.renderLibrary.bind(window.__app);
    window.__app.renderLibrary = function () { throw new Error('日志验证：刻意制造的错误'); };
    window.__app.renderAll();
    await new Promise(r => setTimeout(r, 1200));
    const el = document.querySelector('#fatal .fatal-log');
    return { logLine: el ? el.textContent : '', fatalShown: (() => { const f=document.getElementById('fatal'); return !!f && !f.hidden; })() };
  })()`);

  console.log('  报错框里的日志行:', primed.logLine);
  if (/logs/.test(primed.logLine)) ok('报错框里直接写明了日志位置');
  else bad('报错框里没告诉用户日志在哪：' + primed.logLine);
  if (primed.fatalShown) ok('报错框显示出来了');
  else bad('报错框没显示');

  await new Promise((r) => setTimeout(r, 1500));
  text = readFileSync(f1, 'utf8');

  console.log('\n  ---- 日志内容（末尾 22 行）----');
  console.log(text.split('\n').filter(Boolean).slice(-22).map((l) => '  | ' + l).join('\n'));
  console.log('  ------------------------------\n');

  if (text.includes('日志验证：刻意制造的错误')) ok('崩溃被写进同一个日志文件');
  else bad('崩溃没有被写进日志');
  if (/\[ERROR\]/.test(text)) ok('崩溃被标成 [ERROR]（好过滤）');
  else bad('崩溃没有级别标记');
  if (/at .*renderLibrary|renderLibrary/.test(text)) ok('带调用栈（能定位到函数）');
  else bad('没有调用栈，定位不了');
  if (/操作: 按钮: fit/.test(text) && /日志验证/.test(text)) {
    ok('操作与崩溃在同一个文件里（不用在两处对时间）');
  } else {
    bad('操作和崩溃没有写进同一个文件');
  }

  // ---- ③b 崩溃现场：工程规模 + 崩溃前的操作轨迹 ----
  // 这是「用户发来一份日志就能定位」的关键：光有堆栈只知道崩在哪，
  // 不知道他当时在编辑多大的工程、崩溃前点了什么。
  if (/当时的工程：\d+ 个模块 \/ \d+ 个画布 \/ \d+ 个控件/.test(text)) {
    ok('崩溃记录附上了工程规模');
  } else {
    bad('崩溃记录没有工程规模');
  }
  if (/崩溃前的操作：/.test(text)) ok('崩溃记录附上了崩溃前的操作轨迹');
  else bad('崩溃记录没有操作轨迹');
  if (/崩溃前的操作：[\s\S]{0,400}按钮: fit/.test(text)) {
    ok('操作轨迹里能看到崩溃前点过的按钮');
  } else {
    bad('操作轨迹里没有崩溃前的按钮');
  }

  // ---- ④ 追加而不是覆盖 ----
  await evaluate(cdp, `(async () => {
    window.__app.renderLibrary = function () { throw new Error('日志验证：第二个不同的错误'); };
    window.__app.renderAll();
    await new Promise(r => setTimeout(r, 1200));
    window.__app.renderLibrary = window.__origRenderLibrary;
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 1500));
  const after = readFileSync(f1, 'utf8');
  if (after.includes('刻意制造的错误') && after.includes('第二个不同的错误')) {
    ok('两条错误都在（追加写入，前一条没被覆盖）');
  } else {
    bad('追加写入有问题：前一条不见了');
  }
  if (after.includes('应用启动') && after.length > text.length) ok('启动记录也还在（文件只增不减）');
  else bad('早期记录被覆盖了');

  // ---- ⑤ 不该记生成的 Kotlin 代码（用户明确要求）----
  //
  // 反向断言：日志里不许出现源码特征。用 @file: 和有花括号的 Kotlin 语句
  // 当特征 —— 这些只会出现在生成的代码里，不会出现在日志自己的说明文字里。
  const codeTell = [
    /@file:Depends/,
    /@file:Import/,
    /^\s*listen\s*\{/m,
    /^\s*command\s*\(/m,
    /package\s+[a-zA-Z_][\w.]*\s*$/m,
  ].filter((re) => re.test(after));
  if (codeTell.length === 0) {
    ok('日志里没有生成的 Kotlin 代码（按用户要求去掉了）');
  } else {
    bad(`日志里仍有生成的代码特征：${codeTell.map(String).join(' , ')}`);
  }

  // ---- 恢复 ----
  await evaluate(cdp, `(() => { window.__app.renderLibrary = window.__origRenderLibrary; document.getElementById('fatal').hidden = true; window.__app.renderAll(); return true; })()`);
  const recovered = await evaluate(cdp, `(() => { try { window.__app.renderAll(); return 'ok'; } catch(e) { return 'threw'; } })()`);
  if (recovered === 'ok') ok('恢复后一切正常');
  else bad('恢复失败');

  cdp.close();
} catch (e) {
  bad('验证异常：' + e.message);
} finally {
  try { child.kill(); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 1200));
  try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
