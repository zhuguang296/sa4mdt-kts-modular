// 关窗提醒的真实链路测试。
//
// live-ui.js 里的那一节只是「直接调 app.onCloseRequested()」，验证的是前端
// 弹窗本身。这个文件验证的是**整条链路**：
//
//   真的往窗口发 WM_CLOSE（等价于点右上角 X）
//     → Rust 收到 CloseRequested 并 prevent_close()
//     → Rust eval 前端 window.__app.onCloseRequested()
//     → 前端弹「有改动还没保存」
//     → 选「取消」窗口必须活着；选「不保存」窗口必须真的关掉
//
// 最后一条尤其重要：prevent_close() 拦下的那次关闭**不会被系统重试**，
// 所以如果前端没有正确回调 confirm_close，窗口就会永远关不掉 ——
// 那是个只有真按 X 才会暴露的 bug。
//
// 还有一条容易漏的：**没有改动时不该弹任何东西**。如果拦截逻辑写成
// 「先 prevent_close 再问」，而问的那一步又因为没改动直接返回 true，
// 那每次正常关窗都会卡住一次。所以这里专门跑一个干净实例验证「无改动直接关」。

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = join(ROOT, 'KTS-Plugin-Workshop.exe');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

// ---------- 极简 CDP 客户端 ----------
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

async function evaluate(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

async function findTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('等不到 WebView2 调试目标');
}

/**
 * 给窗口发 WM_CLOSE —— 这与用户点右上角 X 是同一条消息路径。
 *
 * 用 PostMessage 而不是 taskkill：taskkill 是强杀，会绕过 CloseRequested，
 * 那样就完全测不到我们关心的拦截逻辑了。
 */
function sendWmClose(pid) {
  const ps = `
$sig = @'
using System;
using System.Runtime.InteropServices;
public class WinClose {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'@
Add-Type -TypeDefinition $sig
$p = Get-Process -Id ${pid} -ErrorAction Stop
$h = $p.MainWindowHandle
if ($h -eq 0) { Write-Output "NOHWND"; exit 2 }
$r = [WinClose]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output $(if ($r) { "SENT" } else { "FAILED" })
`;
  const f = join(tmpdir(), `wmclose-${pid}-${Date.now()}.ps1`);
  writeFileSync(f, ps, 'utf8');
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f],
      { encoding: 'utf8', timeout: 30000 });
    return (r.stdout || '').trim();
  } finally {
    try { rmSync(f, { force: true }); } catch { /* ignore */ }
  }
}

const alive = (child) => child.exitCode === null && child.signalCode === null;

/** 启动一个干净的实例并连上它的调试端口 */
async function launch(port) {
  const profileDir = mkdtempSync(join(tmpdir(), 'kts-close-'));
  // exe 也要复制到临时目录再跑：日志写在 exe 旁边的 logs\，
  // 直接在项目根启动会往仓库里丢一个 logs\ 目录。
  const runExe = join(profileDir, 'KTS-Plugin-Workshop.exe');
  copyFileSync(EXE, runExe);
  const child = spawn(runExe, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: join(profileDir, 'profile'),
    },
    stdio: 'ignore',
  });
  const target = await findTarget(port);
  const cdp = await connect(target.webSocketDebuggerUrl);
  await waitReady(cdp);
  return { child, cdp, profileDir };
}

/**
 * 等界面真的建好，而不是睡一个固定秒数。
 *
 * 原来写的是 `setTimeout(1800)`。机器空闲时够，但构建到这一步时后台还有
 * 别的活儿（cargo、上一步的测试），启动会明显变慢 —— 于是测试抢在
 * canvas.js 建出 .cv-viewport 之前就去 querySelector，拿到 null，
 * 报出 `Cannot read properties of null (reading 'getBoundingClientRect')`。
 * 那是个假失败：工具没问题，是测试等得不够。
 *
 * 改成轮询真实就绪标志（欢迎页关掉 + 画布视口存在），最多等 15 秒。
 */
async function waitReady(cdp, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const ready = await evaluate(cdp, `(() => {
        // App 挂上了、画布建好了，才算能开始操作
        const skip = document.getElementById('obSkip');
        return !!(window.__app && document.querySelector('.cv-viewport') && !skip);
      })()`);
      if (ready) {
        // 再给一帧让布局稳定（getBoundingClientRect 要有非零尺寸）
        await new Promise((r) => setTimeout(r, 250));
        return true;
      }
      // 欢迎页挡着就先关掉
      await evaluate(cdp, `(() => { const b=document.getElementById('obSkip'); if(b) b.click(); return true; })()`).catch(() => {});
    } catch { /* 页面还没就绪，继续等 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('实例启动后 15 秒内界面仍未就绪（.cv-viewport 没出现）');
}

async function shutdown({ child, cdp, profileDir }) {
  try { cdp?.close(); } catch { /* ignore */ }
  if (alive(child)) { try { child.kill(); } catch { /* ignore */ } }
  await new Promise((r) => setTimeout(r, 1200));
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** 等进程真的退出，返回是否退出 */
async function waitExit(child, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if (!alive(child)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const ADD_NODE = `(async () => {
  const app = window.__app;
  const vp = document.querySelector('.cv-viewport');
  const vr = vp.getBoundingClientRect();
  const dt = new DataTransfer();
  const at = { clientX: vr.left + 300, clientY: vr.top + 200 };
  app.canvasView.draggingDef = 'event.Trigger.update';
  vp.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
  vp.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
  app.canvasView.clearDropHint();
  await new Promise(r => setTimeout(r, 300));
  const el = document.querySelector('.st-dirty');
  return {
    nodes: document.querySelectorAll('.cv-node').length,
    dirty: el ? el.textContent.trim() : '',
    on: el ? el.classList.contains('on') : false,
  };
})()`;

const READ_MODAL = `(() => {
  const m = document.getElementById('modal');
  const vis = !!m && !m.hidden && getComputedStyle(m).display !== 'none';
  return {
    shown: vis,
    title: vis ? ((m.querySelector('.modal-title') || {}).textContent || '') : '',
    buttons: vis ? [...m.querySelectorAll('[data-btn]')].map(b => b.textContent.trim()) : [],
  };
})()`;

// ===========================================================================
// 场景 A：有未保存改动 → 点 X 应弹提醒，取消留着、不保存才关
// ===========================================================================
async function scenarioDirty() {
  const s = await launch(9336);
  try {
    console.log(`=== 场景 A：有未保存改动（pid ${s.child.pid}）===\n`);

    console.log('=== A1. 造出未保存状态 ===');
    const r = await evaluate(s.cdp, ADD_NODE);
    if (!r.on) bad(`没能造出未保存状态（节点 ${r.nodes}，标记「${r.dirty}」）`);
    else ok(`画布上有 ${r.nodes} 个节点，状态栏「${r.dirty}」`);

    console.log('\n=== A2. 点 X（WM_CLOSE）应被拦下并弹提醒 ===');
    {
      const sent = sendWmClose(s.child.pid);
      if (sent !== 'SENT') bad(`WM_CLOSE 没发出去：${sent}`);
      await new Promise((r2) => setTimeout(r2, 1500));

      const m = await evaluate(s.cdp, READ_MODAL).catch((e) => ({ err: e.message }));
      if (m.err) bad('发 WM_CLOSE 后前端失联了：' + m.err);
      else {
        if (!alive(s.child)) bad('窗口直接被关掉了 —— Rust 没有拦住（或没调 prevent_close）');
        else ok('窗口没有被直接关掉（说明 Rust 拦住了这次关闭）');
        if (!m.shown) bad('关窗时没有弹出提醒');
        else ok(`关窗时弹出提醒：「${m.title}」`);
        for (const want of ['取消', '不保存', '保存并继续']) {
          if (!m.buttons.includes(want)) bad(`提醒缺少「${want}」（实际 ${m.buttons.join('/')}）`);
        }
        if (['取消', '不保存', '保存并继续'].every((b) => m.buttons.includes(b))) {
          ok('三个出口都在：取消 / 不保存 / 保存并继续');
        }
      }
    }

    console.log('\n=== A3. 点「取消」窗口应留着 ===');
    {
      await evaluate(s.cdp, `(() => {
        const m = document.getElementById('modal');
        const b = [...m.querySelectorAll('[data-btn]')].find(x => x.textContent.trim() === '取消');
        b.click(); return true;
      })()`);
      await new Promise((r2) => setTimeout(r2, 800));

      if (!alive(s.child)) bad('点了「取消」窗口还是关掉了 —— 取消没有生效');
      else ok('点「取消」窗口留着');

      const still = await evaluate(s.cdp, `(async () => {
        const m = document.getElementById('modal');
        document.querySelector('[data-act="fit"]')?.click();
        await new Promise(r => setTimeout(r, 200));
        return { modalGone: !m || m.hidden, nodes: document.querySelectorAll('.cv-node').length };
      })()`).catch((e) => ({ err: e.message }));
      if (still.err) bad('「取消」后窗口没关但界面已经不能用了：' + still.err);
      else {
        if (!still.modalGone) bad('点「取消」后提醒框没关掉');
        else ok('提醒框已关闭');
        if (still.nodes < 1) bad('「取消」之后画布上的节点丢了');
        else ok(`「取消」后还能继续编辑（画布仍有 ${still.nodes} 个节点）`);
      }
    }

    console.log('\n=== A4. 再点 X 选「不保存」应真的关掉 ===');
    {
      const sent = sendWmClose(s.child.pid);
      if (sent !== 'SENT') bad(`第二次 WM_CLOSE 没发出去：${sent}`);
      await new Promise((r2) => setTimeout(r2, 1500));

      const m = await evaluate(s.cdp, `(() => {
        const m = document.getElementById('modal');
        const vis = !!m && !m.hidden;
        if (!vis) return { shown: false };
        const b = [...m.querySelectorAll('[data-btn]')].find(x => x.textContent.trim() === '不保存');
        if (!b) return { shown: true, noButton: true, buttons: [...m.querySelectorAll('[data-btn]')].map(x => x.textContent.trim()) };
        b.click();
        return { shown: true, clicked: true };
      })()`).catch((e) => ({ err: e.message }));

      if (m.err) bad('第二次点 X 后前端失联：' + m.err);
      else if (!m.shown) bad('第二次点 X 没弹出提醒');
      else if (m.noButton) bad(`第二次的提醒里没有「不保存」（${m.buttons.join('/')}）`);
      else ok('第二次点 X 也弹出了提醒，并点了「不保存」');

      if (!await waitExit(s.child)) {
        bad('选了「不保存」窗口却没关掉 —— 前端没有回调 confirm_close（prevent_close 后的关闭不会自动重试）');
      } else {
        ok(`选「不保存」后窗口真的关掉了（退出码 ${s.child.exitCode}）`);
      }
    }
  } finally {
    await shutdown(s);
  }
}

// ===========================================================================
// 场景 B：没有改动 → 点 X 应该直接关，不该弹任何东西
// ===========================================================================
async function scenarioClean() {
  const s = await launch(9337);
  try {
    console.log(`\n=== 场景 B：刚打开、没有改动（pid ${s.child.pid}）===\n`);

    // 欢迎页先跳过，进入主界面（这一步本来就不算改动）
    await evaluate(s.cdp, `(async () => {
      document.getElementById('obSkip')?.click();
      await new Promise(r => setTimeout(r, 500));
      return true;
    })()`);

    const state = await evaluate(s.cdp, `(() => {
      const el = document.querySelector('.st-dirty');
      return {
        dirtyOn: el ? el.classList.contains('on') : null,
        dirtyText: el ? el.textContent.trim() : '',
        nodes: document.querySelectorAll('.cv-node').length,
      };
    })()`);
    console.log('=== B1. 起始状态 ===');
    if (state.dirtyOn) bad(`刚进来就显示「${state.dirtyText}」，基准没重置`);
    else ok(`刚进来是「${state.dirtyText || '（无标记）'}」，没有误报未保存`);

    console.log('\n=== B2. 无改动点 X 应直接关闭（不该弹框卡住）===');
    const sent = sendWmClose(s.child.pid);
    if (sent !== 'SENT') bad(`WM_CLOSE 没发出去：${sent}`);

    const exited = await waitExit(s.child, 25);
    if (!exited) {
      // 没能关掉，看看是不是弹了框 —— 那就是「无改动也拦」的 bug
      const m = await evaluate(s.cdp, READ_MODAL).catch(() => null);
      if (m && m.shown) {
        bad(`没有改动却弹了提醒（「${m.title}」）—— 正常关窗被挡住了`);
      } else {
        bad('没有改动，点 X 却没能关掉窗口');
      }
    } else {
      ok(`没有改动时点 X 直接关掉了（退出码 ${s.child.exitCode}），没有多余弹框`);
    }
  } finally {
    await shutdown(s);
  }
}

// ===========================================================================
// 场景 C：前端脚本坏了 → 窗口必须还能关掉（看门狗兜底）
//
// 这是最要命的失效模式：Rust prevent_close() 之后系统不再重试关闭，
// 如果前端因为任何原因没能回应（window.__app 不存在、render 抛异常……），
// 窗口就彻底关不掉了 —— 用户只能去任务管理器强杀进程。
// 这里人为把 window.__app 抹掉，模拟「前端已死」，验证看门狗会放行。
// ===========================================================================
async function scenarioBrokenFrontend() {
  const s = await launch(9338);
  try {
    console.log(`\n=== 场景 C：前端已死，窗口仍须能关（pid ${s.child.pid}）===\n`);

    // 模拟前端坏掉：把钩子抹掉，Rust eval 过去就没人应
    await evaluate(s.cdp, `(() => {
      try { delete window.__app; } catch (e) { window.__app = undefined; }
      return typeof window.__app;
    })()`);
    const t = await evaluate(s.cdp, `typeof window.__app`);
    console.log('=== C1. 模拟前端失效 ===');
    if (t !== 'undefined') bad(`没能抹掉 window.__app（typeof = ${t}）`);
    else ok('已把 window.__app 抹掉，模拟前端脚本坏掉');

    console.log('\n=== C2. 此时点 X，看门狗须在几秒内放行 ===');
    const sent = sendWmClose(s.child.pid);
    if (sent !== 'SENT') bad(`WM_CLOSE 没发出去：${sent}`);

    // 看门狗是 2 秒，给足余量
    const exited = await waitExit(s.child, 30);
    if (!exited) {
      bad('前端已死时窗口关不掉 —— 用户只能去任务管理器强杀（看门狗没生效）');
    } else {
      ok(`前端无响应时看门狗放行了关闭（退出码 ${s.child.exitCode}）`);
    }
  } finally {
    await shutdown(s);
  }
}

// ---------- 主流程 ----------
try {
  await scenarioDirty();
  await scenarioClean();
  await scenarioBrokenFrontend();
} catch (e) {
  bad('运行时异常：' + e.message);
}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
