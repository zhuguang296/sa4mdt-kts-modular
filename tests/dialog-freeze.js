// 原生对话框不得让主窗口失去响应。
//
// 这个测试守的是一个真实事故：用户报「点 保存 / 从代码导入 / 导出插件 就卡住」。
// 原因有两个，都在 Rust 侧：
//
//   1. 三个命令原来是**同步**命令（ExecutionContext::Blocking → "sync"），
//      跑在 Tauri 的**主线程**上，而主线程同时负责窗口消息循环。命令体里又
//      `thread::spawn(..).join()` **死等**模态对话框结束 —— 主线程再也不派发
//      消息，Windows 判定窗口失去响应，用户看到的就是整个应用卡死。
//   2. 对话框的 owner 取的是 `GetForegroundWindow()`，而它返回**全系统**的
//      前台窗口。实测抓到 owner 是别的进程的窗口，于是文件对话框挂到了别的
//      程序底下 —— 用户根本看不见它，只觉得「点了按钮就卡住」。
//
// 判定手法用的是 Windows 自己判定「无响应」的同一套机制：给窗口发 WM_NULL
// 并等回执（SendMessageTimeout）。窗口线程若被堵住就收不到回执。
// 这三个按钮平时没人会点着玩，但每一个都可能崩掉整个应用，所以必须自动化守住。

import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9353;

// 常驻的 PowerShell 助手：反复查询窗口状态。
// 不用每次 exec 是因为每次 Add-Type 要 1~2 秒，而「无响应」是瞬时状态，等不起。
const PS_SERVER = `
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class H {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);

  public static string Hung(long hwnd) {
    IntPtr r;
    var ok = SendMessageTimeout(new IntPtr(hwnd), 0, IntPtr.Zero, IntPtr.Zero, 2, 600, out r);
    return ok != IntPtr.Zero ? "RESPONSIVE" : "HUNG";
  }
  static string FindByClass(uint want, string cls) {
    var found = "";
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != want || !IsWindowVisible(h)) return true;
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      if (c.ToString() == cls) { found = h.ToInt64().ToString(); return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  /** 主窗口 hwnd|owner|enabled */
  public static string FindMainWin(uint want) {
    var found = "";
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != want) return true;
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      if (c.ToString() == "Tauri Window") { found = h.ToInt64().ToString(); return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  /** 返回对话框的 "hwnd owner" */
  public static string Dialog(uint want) {
    var found = "";
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != want) return true;
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      if (c.ToString() == "#32770") {
        found = h.ToInt64().ToString() + " " + GetWindow(h, 4).ToInt64().ToString();
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public class P { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l); }
"@
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(' ')
  try {
    switch ($parts[0]) {
      'HUNG'   { [H]::Hung([int64]$parts[1]) }
      'MAIN'   { [H]::FindMainWin([uint32]$parts[1]) }
      'DIALOG' { [H]::Dialog([uint32]$parts[1]) }
      'CLOSE'  { [P]::PostMessage([IntPtr][int64]$parts[1], 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
    }
  } catch { 'ERR ' + $_.Exception.Message }
}
`;

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const info = (m) => console.log('    · ' + m);

// ---------- PowerShell 助手 ----------
const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_SERVER],
  { stdio: ['pipe', 'pipe', 'ignore'] });
let psBuf = '';
const psWaiters = [];
ps.stdout.on('data', (d) => {
  psBuf += d.toString();
  let i;
  while ((i = psBuf.indexOf('\n')) >= 0) {
    const line = psBuf.slice(0, i).trim();
    psBuf = psBuf.slice(i + 1);
    const w = psWaiters.shift();
    if (w) w(line);
  }
});
function psAsk(cmd) {
  return new Promise((res) => {
    psWaiters.push(res);
    ps.stdin.write(cmd + '\n');
    setTimeout(() => {
      const k = psWaiters.indexOf(res);
      if (k >= 0) { psWaiters.splice(k, 1); res('TIMEOUT'); }
    }, 10000);
  });
}
const isHung = async (h) => (await psAsk(`HUNG ${h}`)) === 'HUNG';

// ---------- CDP ----------
function connect(u) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(u);
    let id = 0;
    const p = new Map();
    ws.addEventListener('open', () => res({
      send: (m, q) => new Promise((a, b) => {
        const i = ++id; p.set(i, { a, b });
        ws.send(JSON.stringify({ id: i, method: m, params: q }));
      }),
      close: () => ws.close(),
    }));
    ws.addEventListener('error', rej);
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && p.has(m.id)) {
        const { a, b } = p.get(m.id); p.delete(m.id);
        m.error ? b(new Error(m.error.message)) : a(m.result);
      }
    });
  });
}
async function ev(cdp, expr, ms = 25000) {
  const r = await Promise.race([
    cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
    new Promise((_, j) => setTimeout(() => j(new Error('TIMEOUT')), ms)),
  ]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}
async function find() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const p = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no debug target');
}

// exe 复制到临时目录：对话框测试不该往仓库里丢任何东西
const work = mkdtempSync(join(tmpdir(), 'kts-dialog-'));
copyFileSync(join(ROOT, 'KTS-Plugin-Workshop.exe'), join(work, 'KTS-Plugin-Workshop.exe'));
const child = spawn(join(work, 'KTS-Plugin-Workshop.exe'), [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    WEBVIEW2_USER_DATA_FOLDER: join(work, 'profile'),
  },
  stdio: 'ignore',
});

// 每个用例：发起一个会弹对话框的 IPC，验证
//   ① 对话框确实出现（说明没静默失败）
//   ② 出现期间主窗口仍 RESPONSIVE ← 这就是「不再卡死」的判据
//   ③ owner 是本应用的主窗口（不是别的程序）
//   ④ 关掉对话框后 invoke 正常返回、主窗口恢复可交互
async function probeDialog(cdp, mainHwnd, label, invokeExpr) {
  console.log(`\n--- ${label} ---`);
  const pending = cdp.send('Runtime.evaluate', {
    expression: invokeExpr, returnByValue: true, awaitPromise: true,
  });

  // 等对话框出现
  let dlg = '';
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 250));
    dlg = (await psAsk(`DIALOG ${child.pid}`)).trim();
    if (dlg && !dlg.startsWith('ERR')) break;
  }
  if (!dlg || dlg.startsWith('ERR')) {
    bad(`${label}：没有弹出对话框（原生对话框创建失败？）`);
    try { await pending; } catch { /* ignore */ }
    return;
  }
  const [dlgHwnd, owner] = dlg.split(' ');
  info(`对话框 hwnd=${dlgHwnd} owner=${owner}`);
  ok(`${label}：对话框弹出来了`);

  // ② 关键判据
  const hung = await isHung(mainHwnd);
  if (hung) bad(`${label}：★ 对话框打开期间主窗口无响应 —— 就是「点一下就卡住」`);
  else ok(`${label}：对话框打开期间主窗口仍能响应`);

  // ③ owner 必须是本应用主窗口
  if (owner === String(mainHwnd)) ok(`${label}：对话框归属本应用主窗口（不会再藏到别的程序后面）`);
  else if (owner === '0') bad(`${label}：对话框没有 owner，可能弹到屏幕角落/别的程序后面`);
  else bad(`${label}：对话框 owner=${owner} 不是主窗口 ${mainHwnd}`);

  // 关掉
  await psAsk(`CLOSE ${dlgHwnd}`);
  await new Promise((r) => setTimeout(r, 1200));

  let ret = null;
  try {
    const r = await Promise.race([
      pending,
      new Promise((_, j) => setTimeout(() => j(new Error('关掉后 8 秒仍未返回')), 8000)),
    ]);
    ret = r.result?.value;
  } catch (e) { bad(`${label}：${e.message}`); }

  if (ret !== null && ret !== undefined) ok(`${label}：命令正常收尾（返回 ${JSON.stringify(ret).slice(0, 40)}）`);
  else ok(`${label}：命令正常收尾（用户取消 → null）`);

  if (await isHung(mainHwnd)) bad(`${label}：关掉之后窗口仍无响应`);
  else ok(`${label}：关掉之后窗口恢复响应`);

  // 收尾：确认界面还能用
  const usable = await ev(cdp, `(() => { try { window.__app.renderAll(); return 'ok'; } catch(e) { return 'threw'; } })()`);
  if (usable === 'ok') ok(`${label}：界面仍可操作`);
  else bad(`${label}：关掉对话框后界面坏了`);
}

try {
  const cdp = await connect((await find()).webSocketDebuggerUrl);
  // 等界面真的就绪，而不是睡一个固定秒数 —— 构建时后台还有别的活儿，
  // 启动会变慢，固定秒数会导致后面打到还没建好的界面上（假失败）。
  for (let i = 0; i < 50; i++) {
    try {
      const ready = await ev(cdp, `(() => {
        const b = document.getElementById('obSkip');
        if (b) b.click();
        return !!(window.__app && document.getElementById('toolbar'));
      })()`);
      if (ready) break;
    } catch { /* 还没就绪 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  await new Promise((r) => setTimeout(r, 1500));
  await new Promise((r) => setTimeout(r, 2500)); // 等 Add-Type 编译完

  const mainHwnd = (await psAsk(`MAIN ${child.pid}`)).trim();
  if (!mainHwnd || mainHwnd.startsWith('ERR')) { bad('找不到主窗口'); }
  else {
    console.log(`=== 原生对话框不得卡死主窗口（pid ${child.pid}, 主窗口 ${mainHwnd}）===`);

    // 基准
    console.log('\n--- 基准：空闲时 ---');
    if (await isHung(mainHwnd)) bad('空闲时就无响应，测试环境有问题');
    else ok('空闲时窗口有响应');

    const core = `const c = window.__TAURI__.core || window.__TAURI__.tauri;`;
    // 这三个正是用户报告会卡住的按钮背后的命令
    await probeDialog(cdp, mainHwnd, '导出插件（选目录）',
      `(async () => { ${core} return await c.invoke('pick_folder', { title: '导出到哪' }).then(v => v ?? null).catch(e => 'ERR:' + e); })()`);
    await probeDialog(cdp, mainHwnd, '保存工程（另存为）',
      `(async () => { ${core} return await c.invoke('pick_save_file', { title: '保存工程', defaultName: 'x.saproj' }).then(v => v ?? null).catch(e => 'ERR:' + e); })()`);
    await probeDialog(cdp, mainHwnd, '从代码还原（打开文件）',
      `(async () => { ${core} return await c.invoke('pick_open_file', { title: '选择 .kts' }).then(v => v ?? null).catch(e => 'ERR:' + e); })()`);

    // 顺带确认「对话框期间网页本身也没被冻住」
    console.log('\n--- 对话框期间渲染进程是否仍能应答 ---');
    const p = cdp.send('Runtime.evaluate', {
      expression: `(async () => { const c=window.__TAURI__.core||window.__TAURI__.tauri; c.invoke('pick_folder',{title:'并发检测'}); await new Promise(r=>setTimeout(r,1500)); return 1+1; })()`,
      returnByValue: true, awaitPromise: true,
    });
    await new Promise((r) => setTimeout(r, 600));
    const dlgNow = (await psAsk(`DIALOG ${child.pid}`)).trim();
    let v = null;
    try { v = (await p).result?.value; } catch { /* ignore */ }
    if (v === 2) ok('对话框开着时，页面还能执行脚本（渲染进程未被冻住）');
    else bad('对话框开着时页面也卡住了');
    if (dlgNow) await psAsk(`CLOSE ${dlgNow.split(' ')[0]}`);
    await new Promise((r) => setTimeout(r, 800));
  }

  cdp.close();
} catch (e) {
  bad('测试异常：' + e.message);
} finally {
  try { child.kill(); } catch { /* ignore */ }
  try { ps.kill(); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 1500));
  try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
