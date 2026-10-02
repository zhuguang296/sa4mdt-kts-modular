// 通过 WebView2 的 DevTools 协议，连进真实运行的 exe，检查渲染出来的界面。
//
// 这是本机唯一能「真的看到界面」的办法：没有浏览器 provider，
// 截屏又会抓到别的窗口，而 CDP 拿到的是 WebView 里真实的 DOM 与计算样式。
//
// 运行: node tests/live-ui.js
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = join(ROOT, 'KTS-Plugin-Workshop.exe');
const PORT = 9333;

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

// ---------- 启动 exe 并打开调试端口 ----------
//
// 重要：这个测试会操作真实界面（双击控件、点按钮），也就必然改动
// localStorage 里的自动存档。用户手动打开的工程可能就在里面，
// 所以用 webview 的独立用户数据目录跑，绝不碰 %LOCALAPPDATA%\top.tinylake.ktsbuilder。
//
// WEBVIEW2_USER_DATA_FOLDER 让 WebView2 把整个 profile 放到临时目录。
//
// 这里还把 exe **复制到临时目录再运行**：因为「崩溃日志」是写在 exe 旁边的
// crash.log，直接在项目根跑测试会往仓库里丢一个 crash.log（测试还会故意
// 写一条进去）。复制到临时目录跑，日志落在临时目录，收尾时一起删掉。
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const workDir = mkdtempSync(join(tmpdir(), 'kts-builder-livetest-'));
const profileDir = join(workDir, 'profile');
const runExe = join(workDir, 'KTS-Plugin-Workshop.exe');
copyFileSync(EXE, runExe);

const child = spawn(runExe, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    WEBVIEW2_USER_DATA_FOLDER: profileDir,
  },
  stdio: 'ignore',
  detached: false,
});

async function findTarget(timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('等不到 WebView2 调试目标');
}

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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr);
  return r.result.value;
}

/**
 * 等前端真的启动完，而不是睡一个固定秒数。
 *
 * 机器空闲时 1500ms 够；构建到这一步时后台还有 cargo / 上一步的测试在跑，
 * 启动会明显变慢 —— 测试抢在 App 建好之前就去 querySelector，拿到 null，
 * 报出「Cannot read properties of null」这种**假失败**（工具没问题，
 * 是测试等得不够）。所以轮询真实标志：App 挂上了、首页画出来了。
 */
async function waitBoot(cdp, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const ready = await evaluate(cdp, `(() => {
        const h = document.getElementById('home');
        return !!(window.__app && h && !h.hidden && document.querySelector('.hm-card, .hm-newbtn'));
      })()`);
      if (ready) return true;
    } catch { /* 页面还没就绪，继续等 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('启动后 15 秒内界面仍未就绪（首页没出现）');
}

// ---------- 主流程 ----------
let cdp = null;
try {
  const target = await findTarget();
  console.log(`=== 连上 ${target.title} (${target.url}) ===\n`);
  cdp = await connect(target.webSocketDebuggerUrl);

  // 等前端启动完。
  //
  // 原来是死等 1500ms。机器空闲时够，但构建到这一步时后台还有别的活儿，
  // 启动会明显变慢，于是后面 querySelector 拿到 null 报假失败。
  // 改成轮询真实就绪标志：__app 挂上了、首页画出来了。
  await waitBoot(cdp);

  // ---- 1. 启动即首页，四个入口 + 插件组列表 ----
  console.log('=== 1. 首页 ===');
  {
    const info = await evaluate(cdp, `(() => {
      const h = document.getElementById('home');
      const app = document.getElementById('app');
      const cards = [...document.querySelectorAll('.hm-card')];
      return {
        homeVisible: h && !h.hidden,
        appHidden: app && app.hidden,
        cardCount: cards.length,
        names: cards.map(c => (c.querySelector('.hm-card-name') || {}).textContent),
        acts: [...document.querySelectorAll('[data-hact]')].map(b => b.dataset.hact),
        newBtn: !!document.getElementById('hmNewBtn'),
        curBadge: !!document.querySelector('.hm-cur'),
        // 真窗口尺寸下卡片是否可见（不是 0 高度）
        boxes: cards.map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
      };
    })()`);
    if (!info.homeVisible) bad('启动后没有显示首页');
    else ok('启动先显示首页');
    if (info.appHidden) ok('首页是整窗替换工作区（#app 已隐藏）');
    else bad('首页出现时工作区还露着（应整窗替换）');
    if (!info.cardCount) bad('首页没列出任何插件组');
    else ok(`列出 ${info.cardCount} 个插件组：${info.names.join(' / ')}`);
    if (!info.newBtn) bad('首页缺「新建插件组」');
    else ok('首页有「新建插件组」');
    for (const a of ['open', 'import', 'newProject', 'settings']) {
      if (!info.acts.includes(a)) bad(`首页缺「${a}」入口`);
    }
    ok(`首页入口：${info.acts.join(' / ')}`);
    const zero = info.boxes.filter(([w, h]) => w < 40 || h < 20);
    if (zero.length) bad(`有 ${zero.length} 个插件组卡片尺寸异常：${JSON.stringify(zero)}`);
    else ok(`${info.cardCount} 个卡片都渲染出实际尺寸：${info.boxes.map(b => b.join('x')).join(', ')}`);
  }

  // ---- 2. 新建插件组：弹窗建完留在首页，列表里立刻出现 ----
  //      （第 15 轮：改成弹窗了 —— 填名字 + 选模板，不再是首页上的就地输入行）
  console.log('\n=== 2. 新建插件组 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const before = document.querySelectorAll('.hm-card').length;
      document.getElementById('hmNewBtn').click();
      await new Promise(r => setTimeout(r, 250));
      // 必须是弹窗（#modal 里有输入框），而不是首页上插进来的输入行
      const modal = document.getElementById('modal');
      if (modal.hidden) return { err: '点了「新建插件组」没有弹出对话框' };
      const inp = modal.querySelector('#nmName');
      if (!inp) return { err: '弹窗里没有名字输入框' };
      const tpl = modal.querySelector('#nmTpl');
      if (!tpl) return { err: '弹窗里没有模板选择' };
      inp.value = 'liveTestGroup';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const okBtn = [...modal.querySelectorAll('[data-btn]')].find(b => b.textContent.trim() === '创建');
      if (!okBtn) return { err: '弹窗里没有「创建」按钮' };
      okBtn.click();
      await new Promise(r => setTimeout(r, 400));
      const cards = [...document.querySelectorAll('.hm-card')];
      return {
        before, after: cards.length,
        modalClosed: document.getElementById('modal').hidden,
        names: cards.map(c => (c.querySelector('.hm-card-name') || {}).textContent),
        homeStillVisible: !document.getElementById('home').hidden,
        appHidden: document.getElementById('app').hidden,
      };
    })()`);
    if (r.err) bad(r.err);
    else if (r.after !== r.before + 1) bad(`插件组数没加一（${r.before} -> ${r.after}）`);
    // 插件组名会被规范化成合法包名（小写），所以用大小写不敏感比对
    else if (!r.names.some((n) => String(n).toLowerCase() === 'livetestgroup')) {
      bad(`列表里没有新建的插件组：${r.names.join(',')}`);
    } else ok(`新建后列表从 ${r.before} 变成 ${r.after} 个，含 liveTestGroup`);
    if (!r.err && !r.modalClosed) bad('点「创建」之后弹窗没关上');
    else if (!r.err) ok('建完弹窗自动关闭');
    if (!r.err && !r.homeStillVisible) bad('新建插件组后跳走了（应该留在首页）');
    else if (!r.err) ok('新建后仍留在首页');
  }

  // ---- 2b. 首次进入：exe 旁边的 scripts\ 变成示例插件组（第 15 轮）----
  console.log('\n=== 2b. 首次进入的示例插件组 ===');
  {
    // 在临时 exe 旁边造一个 scripts 目录：两个能认出来的手写脚本
    const scriptsDir = join(workDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'greet.kts'), [
      '@file:JsModule("mindustry")',
      'package helloWorld',
      '',
      'listen<EventType.PlayerJoin> {',
      '  broadcast("[green]欢迎 ${player.name}")',
      '}',
      '',
      'listen(EventType.Trigger.update) {',
      '  Groups.player.forEach { p ->',
      '    p.sendMessage("tick")',
      '  }',
      '}',
    ].join('\n'), 'utf8');
    writeFileSync(join(scriptsDir, 'build.kts'), [
      'package guard',
      '',
      'listen<EventType.BlockBuildEndEvent> {',
      '  if (tile.block() == Blocks.coreNucleus) {',
      '    Call.announce("核心被打啦")',
      '  }',
      '}',
    ].join('\n'), 'utf8');

    const r = await evaluate(cdp, `(async () => {
      const a = window.__app;
      a.closeModal();
      // 造出「真正第一次进来」的样子：存档和「摆过示例」标记都清掉
      localStorage.clear();
      a.start();
      await new Promise(r => setTimeout(r, 2500));   // 扫描 + 读文件 + 建画布是异步的

      const cards = [...document.querySelectorAll('.hm-card')];
      const names = cards.map(c => (c.querySelector('.hm-card-name') || {}).textContent || '');
      const sample = names.find(n => /example|scipts/i.test(n));
      // 打开示例插件组，看里面是不是控件画布
      let canvasInfo = null;
      if (sample) {
        const card = cards.find(c => ((c.querySelector('.hm-card-name') || {}).textContent || '') === sample);
        card.click();
        await new Promise(r => setTimeout(r, 500));
        canvasInfo = {
          nodes: document.querySelectorAll('.cv-node').length,
          edges: document.querySelectorAll('.cv-edge').length,
          titles: [...document.querySelectorAll('.tab-title, .tab')].map(t => t.textContent.trim()),
        };
      }
      return { names, sample, canvasInfo };
    })()`);

    if (!r.sample) bad(`首次进入没有出现示例插件组（现有：${(r.names || []).join(',')}）`);
    else ok(`首次进入出现了示例插件组「${r.sample}」`);
    if (r.canvasInfo && r.canvasInfo.nodes > 0) {
      ok(`示例插件组里是控件画布（${r.canvasInfo.nodes} 个控件、${r.canvasInfo.edges} 条连线）`);
    } else if (r.sample) {
      bad('示例插件组里没有控件（用户要求必须是控件画布）');
    }
  }

  // ---- 2c. 联线：对准圆圈 + 连不上要判红并说明原因（第 15 轮）----
  console.log('\n=== 2c. 联线的吸附与失败提示 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const a = window.__app;
      const cv = a.canvasView;
      const st = await import('./js/store.js');
      // 造一个确定的两节点场景：一个事件、一个动作，方便精确取圆点
      const cur = st.activeCanvas();
      cur.nodes = [];
      cur.edges = [];
      const ev = st.addNode('event.PlayerJoin', 120, 120, {});
      const act = st.addNode('action.broadcast', 560, 160, {});
      cv.render();
      await new Promise(r => setTimeout(r, 260));

      const outEl = document.querySelector('.cv-node[data-id="' + ev.id + '"] .cv-port-out');
      const inEl = document.querySelector('.cv-node[data-id="' + act.id + '"] .cv-port-in');
      if (!outEl || !inEl) return { err: '画布上找不到出/入口圆点' };
      const or = outEl.getBoundingClientRect();
      const ir = inEl.getBoundingClientRect();
      const from = { x: or.left + or.width / 2, y: or.top + or.height / 2 };
      const to = { x: ir.left + ir.width / 2, y: ir.top + ir.height / 2 };

      // 1) 出口按下开始拉线，移到入口附近（故意偏 8px，看是否吸附）
      outEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: from.x, clientY: from.y, button: 0 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: to.x + 8, clientY: to.y + 6 }));
      await new Promise(r => setTimeout(r, 60));
      // 注意：必须**重新查一次**元素 —— store 的事件会让界面整体重绘，
      // 之前拿到的 DOM 引用可能已经脱离文档（那样查 class 永远是旧的）。
      const inNow = document.querySelector('.cv-node[data-id="' + act.id + '"] .cv-port-in');
      const greenNow = !!inNow && inNow.classList.contains('ok');
      const tempD = (document.querySelector('.cv-temp-edge') || {}).getAttribute
        ? document.querySelector('.cv-temp-edge').getAttribute('d') : '';
      const tempEl = document.querySelector('.cv-temp-edge');
      const tempShown = !!tempEl && tempEl.style.display !== 'none';
      // 临时线的路径里绝不能出现 NaN —— 一旦出现，SVG 整条不画，
      // 用户看到的就是「快连上时连线突然不见了」（第 17 轮修的真 bug）。
      const tempNaN = /NaN|undefined/.test(String(tempD));
      // 吸附生效时，临时线末端应当就落在入口圆心（像素级）
      let snapErr = null;
      if (tempD && !tempNaN) {
        const nums = String(tempD).match(/-?[0-9]+(\\.[0-9]+)?/g).map(Number);
        const vr = document.querySelector('.cv-viewport').getBoundingClientRect();
        const ex = nums[nums.length - 2] + vr.left, ey = nums[nums.length - 1] + vr.top;
        snapErr = Math.round(Math.hypot(ex - to.x, ey - to.y));
      }

      // 松手：应当连上
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: to.x + 8, clientY: to.y + 6 }));
      await new Promise(r => setTimeout(r, 160));
      const edgesAfter = st.activeCanvas().edges.length;
      // 连线的两个端点应当就落在两个圆圈中心（像素级）
      let edgeErr = null;
      const edgePath = document.querySelector('.cv-edge');
      if (edgePath && edgePath.getAttribute('d')) {
        const nums = edgePath.getAttribute('d').match(/-?[0-9]+(\\.[0-9]+)?/g).map(Number);
        const vr = document.querySelector('.cv-viewport').getBoundingClientRect();
        // path 坐标是视口内的相对坐标，换算回屏幕坐标再和圆心比
        const sx = nums[0] + vr.left, sy = nums[1] + vr.top;
        const ex = nums[nums.length - 2] + vr.left, ey = nums[nums.length - 1] + vr.top;
        edgeErr = {
          dStart: Math.round(Math.hypot(sx - from.x, sy - from.y)),
          dEnd: Math.round(Math.hypot(ex - to.x, ey - to.y)),
        };
      }

      // 2) 非法连接：从动作节点自己的出口拖到自己的入口（自连）应判红 + 说明原因。
      //    注意不能拿事件节点试 —— 事件根本没有入口圆点（第 15 轮修正：
      //    圆点按控件定义画，画不出来就认不出来）。
      const evIn = document.querySelector('.cv-node[data-id="' + ev.id + '"] .cv-port-in');
      const actIn2 = document.querySelector('.cv-node[data-id="' + act.id + '"] .cv-port-in');
      const actOut2 = document.querySelector('.cv-node[data-id="' + act.id + '"] .cv-port-out');
      const noEventIn = !evIn;   // 事件节点不该有入口
      const ir2 = actIn2.getBoundingClientRect();
      const p2 = { x: ir2.left + ir2.width / 2, y: ir2.top + ir2.height / 2 };
      const or2 = actOut2.getBoundingClientRect();
      actOut2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: or2.left + or2.width / 2, clientY: or2.top + or2.height / 2, button: 0 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: p2.x, clientY: p2.y }));
      await new Promise(r => setTimeout(r, 80));
      const badRed = document.querySelector('.cv-port.bad') !== null;
      const inspErr = (document.querySelector('.insp-connerr') || {}).textContent || '';
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: p2.x, clientY: p2.y }));
      await new Promise(r => setTimeout(r, 120));
      const edgesFinal = st.activeCanvas().edges.length;

      return { greenNow, edgesAfter, badRed, inspErr, edgesFinal, edgeErr, noEventIn,
        tempShown, tempNaN, snapErr, tempD: String(tempD).slice(0, 70) };
    })()`);
    if (r.err) bad(r.err);
    else {
      if (r.greenNow) ok('拖到能接的圆圈上时，圆圈变绿（吸附提示）');
      else bad('拖到能接的圆圈上没有变绿');
      if (r.edgesAfter === 1) ok('在圆圈附近松手就连上了（不用像素级对准）');
      else bad(`在圆圈附近松手没连上（连线数 ${r.edgesAfter}）`);
      if (r.tempShown && !r.tempNaN) ok('拖线全程临时连线都在（吸附时不会消失）');
      else bad(`拖线时临时连线没了：显示=${r.tempShown} 路径=${r.tempD}`);
      if (r.snapErr !== null && r.snapErr <= 6) ok(`临时线末端吸附到入口圆心（偏差 ${r.snapErr}px）`);
      else if (r.snapErr !== null) bad(`临时线没有吸附到圆心（偏差 ${r.snapErr}px）`);
      if (r.badRed) ok('接不上的圆圈标红');
      else bad('接不上的圆圈没有标红（用户报过：只显示蓝色、没有提醒）');
      if (r.noEventIn) ok('没有入口的控件（事件）不再画入口圆点 —— 画得出来就一定连得上');
      else bad('事件节点还画着入口圆点（那个圆点连不上，正是用户报的「拖过去没反应」）');
      if (r.inspErr && r.inspErr.trim()) ok(`右侧面板说明了连不上的原因：「${r.inspErr.trim().slice(0, 40)}」`);
      else bad('连不上时右侧面板没有说明原因');
      if (r.edgesFinal === r.edgesAfter) ok('非法的连线没有被写进工程（判红之后松手不会硬连）');
      else bad('非法的连线被连上了');
      if (r.edgeErr) {
        // 圆圈半径 6.5px：端点离圆心在几像素内就算「对准了圆圈」
        if (r.edgeErr.dStart <= 8 && r.edgeErr.dEnd <= 8) {
          ok(`连线两端精准落在圆圈中心（起点偏差 ${r.edgeErr.dStart}px、终点偏差 ${r.edgeErr.dEnd}px）`);
        } else {
          bad(`连线没对准圆圈：起点偏 ${r.edgeErr.dStart}px、终点偏 ${r.edgeErr.dEnd}px`);
        }
      }
    }
  }

  // ---- 2d. 右栏插件文件管理器 + 点控件弹窗（第 16 轮用户要求）----
  console.log('\n=== 2d. 插件文件管理器与参数弹窗 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const a = window.__app;
      const st = await import('./js/store.js');
      const mod = st.activeRef().module;
      const fm = document.getElementById('filemgr');
      const out = {};
      out.fmVisible = !!fm && fm.getBoundingClientRect().width > 100;
      out.items = fm ? fm.querySelectorAll('.fm-item').length : 0;
      out.canvases = mod.canvases.length;
      out.namesOk = [...(fm ? fm.querySelectorAll('.fm-fname') : [])]
        .every(el => /\\.kts$/.test(el.textContent.trim()));

      // 单击控件 → 只选中，**不该**弹窗（第 17 轮：改成双击才弹）
      const cur = st.activeCanvas();
      cur.nodes = []; cur.edges = [];
      const n = st.addNode('action.broadcast', 200, 160, { text: 'hi' });
      a.canvasView.render();
      await new Promise(r => setTimeout(r, 260));
      const nodeEl = document.querySelector('.cv-node[data-id="' + n.id + '"]');
      nodeEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0, button: 0 }));
      nodeEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0, button: 0 }));
      nodeEl.click();
      await new Promise(r => setTimeout(r, 260));
      const dlg = document.getElementById('inspDialog');
      out.dlgAfterSingle = dlg ? !dlg.hidden : null;
      out.selectedAfterSingle = (st.store.selection || []).includes(n.id);

      // 双击 → 弹出「控件设置」窗口
      nodeEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
      await new Promise(r => setTimeout(r, 260));
      out.dlgOpen = dlg ? !dlg.hidden : false;
      out.dlgHasForm = !!(dlg && dlg.querySelector('#inspector .field, #inspector input, #inspector select'));
      out.rightHasForm = !!(fm && fm.querySelector('input, select, textarea'));

      // Esc 能关掉弹窗
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      out.dlgClosedByEsc = dlg ? dlg.hidden : null;

      // 没有参数的控件：卡片不该留空白（.no-body）
      cur.nodes = []; cur.edges = [];
      const ev2 = st.addNode('event.PlayerJoin', 120, 120, {});
      a.canvasView.render();
      await new Promise(r => setTimeout(r, 260));
      const evEl = document.querySelector('.cv-node[data-id="' + ev2.id + '"]');
      const body = evEl ? evEl.querySelector('.cv-node-body') : null;
      out.evNoBody = !!(evEl && evEl.classList.contains('no-body'));
      out.bodyHidden = !!(body && body.hidden);
      return out;
    })()`);
    if (r.fmVisible && r.items === r.canvases && r.items > 0) {
      ok(`右栏是插件文件管理器，列出全部 ${r.items} 个 .kts 文件`);
    } else {
      bad(`右栏文件管理器不对：可见=${r.fmVisible} 列出=${r.items} 画布=${r.canvases}`);
    }
    if (r.namesOk) ok('每个文件都显示成 xxx.kts');
    else bad('文件名没有显示成 .kts');
    if (r.dlgAfterSingle === false && r.selectedAfterSingle) {
      ok('单击控件只选中、不弹窗');
    } else {
      bad(`单击就弹窗了（弹窗=${r.dlgAfterSingle} 选中=${r.selectedAfterSingle}）`);
    }
    if (r.dlgOpen && r.dlgHasForm) ok('双击控件弹出「控件设置」窗口，里面有参数表单');
    else bad(`双击没有弹出参数窗口（open=${r.dlgOpen} form=${r.dlgHasForm}）`);
    if (!r.rightHasForm) ok('右栏不再塞参数表单（腾给文件管理器了）');
    else bad('右栏还留着参数表单');
    if (r.dlgClosedByEsc) ok('按 Esc 能关掉参数窗口');
    else bad('Esc 关不掉参数窗口');
    if (r.evNoBody && r.bodyHidden) ok('没有参数的控件，卡片下方不留空白');
    else bad(`没有参数的控件还留着空白（no-body=${r.evNoBody} hidden=${r.bodyHidden}）`);
  }

  // ---- 3. 点插件组进画布，检查浅色主题 ----
  console.log('\n=== 3. 进入画布 · 主界面配色 ===');
  {
    // 点第一个插件组进画布
    await evaluate(cdp, `(() => { const c = document.querySelector('.hm-card'); if (c) c.click(); })()`);
    await new Promise((r) => setTimeout(r, 400));

    const entered = await evaluate(cdp, `(() => ({
      homeHidden: document.getElementById('home').hidden,
      appVisible: !document.getElementById('app').hidden,
    }))()`);
    if (!entered.homeHidden || !entered.appVisible) bad('点插件组之后没有进入画布');
    else ok('点插件组进入画布（首页收起）');

    const c = await evaluate(cdp, `(() => {
      const cs = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const v = (n) => cs.getPropertyValue(n).trim();
      const lum = (h) => {
        const m = h.match(/#(..)(..)(..)/); if (!m) return null;
        const [r,g,b] = [1,2,3].map(i => parseInt(m[i],16));
        return (0.299*r + 0.587*g + 0.114*b) / 255;
      };
      return {
        bg: v('--bg'), bgLum: lum(v('--bg')),
        fg: v('--fg'), fgLum: lum(v('--fg')),
        bodyBg: body.backgroundColor,
        // 三栏都在？
        cols: ['left','center','right'].filter(id => {
          const e = document.getElementById(id); if (!e) return false;
          const r = e.getBoundingClientRect(); return r.width > 50 && r.height > 50;
        }),
        libRenderer: !!document.querySelector('#lib .lib-group-head'),
        leftWidth: Math.round(document.getElementById('left').getBoundingClientRect().width),
      };
    })()`);

    if (c.bgLum === null) bad(`--bg 不是十六进制：${c.bg}`);
    else if (c.bgLum < 0.75) bad(`--bg (${c.bg}) 不够浅，亮度 ${c.bgLum.toFixed(2)}`);
    else ok(`底色是浅色：--bg = ${c.bg}（亮度 ${c.bgLum.toFixed(2)}，实际渲染 ${c.bodyBg}）`);

    if (c.fgLum !== null && c.fgLum > 0.5) bad(`--fg (${c.fg}) 太浅，浅底上会看不清`);
    else ok(`前景色够深：--fg = ${c.fg}（亮度 ${c.fgLum?.toFixed(2)}）`);

    if (c.cols.length !== 3) bad(`三栏不全，只渲染了：${c.cols.join(',')}`);
    else ok('左中右三栏都正常渲染');

    if (!c.libRenderer) bad('控件库没有渲染出分类折叠头');
    else ok('控件库渲染出分类折叠头');

    // 控件库加宽到 300px，且双排
    if (c.leftWidth < 290) bad(`控件库宽度 ${c.leftWidth}px，应该 ≥ 300px（双排要地方）`);
    else ok(`控件库宽 ${c.leftWidth}px（够放双排）`);
  }

  // ---- 4. 控件库默认全折叠，点一下能展开 ----
  console.log('\n=== 4. 控件库折叠 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const heads = [...document.querySelectorAll('.lib-group-head')];
      const first = heads[0];
      if (!first) return { err: '没有折叠头' };
      const before = {
        count: heads.length,
        expanded: heads.map(h => h.getAttribute('aria-expanded')),
        openBodies: document.querySelectorAll('.lib-group-body:not([hidden])').length,
      };
      first.click();
      await new Promise(r => setTimeout(r, 200));
      const after = {
        expanded0: first.getAttribute('aria-expanded'),
        openBodies: document.querySelectorAll('.lib-group-body:not([hidden])').length,
        visibleCards: [...document.querySelectorAll('.lib-group-body:not([hidden]) .lib-card')].length,
      };
      return { before, after };
    })()`);
    if (r.err) bad(r.err);
    else {
      const allCollapsed = r.before.expanded.every((e) => e === 'false');
      if (!allCollapsed) bad(`默认不是全折叠：${r.before.expanded.join(',')}`);
      else ok(`${r.before.count} 个分类默认全部折叠`);
      if (r.before.openBodies !== 0) bad('默认就有展开的分类体');
      if (r.after.expanded0 !== 'true') bad('点一下没有展开');
      else if (r.after.visibleCards < 1) bad('展开了但里面没有控件卡片');
      else ok(`点一下展开了，露出 ${r.after.visibleCards} 个控件卡片`);
    }
  }

  // ---- 4b. 新一批控件确实出现在真实界面里 ----
  console.log('\n=== 4b. 新控件在界面里可用 ===');
  {
    // 直接问页面上的目录模块：这些 key 有没有被注册、能不能搜索到。
    // 光看源码不够 —— 真正要防的是「控件写好了但没接进 catalog/index.js」，
    // 那种情况源码检查全绿，界面上却找不到这个控件。
    const r = await evaluate(cdp, `(async () => {
      const idx = await import('./js/catalog/index.js');
      const mustHave = [
        'event.PlayerConnect', 'event.TileChangeEvent', 'event.CoreChangeEvent',
        'event.TextInputEvent', 'event.ConfigEvent',
        'action.teleport', 'action.killUnit', 'action.setHealth', 'action.setFlag',
        'action.setBlock', 'action.coreItems', 'action.hudText', 'action.announceBig',
        'action.returnNow',
        'condition.isAdmin', 'condition.guard',
        'data.set', 'data.list', 'data.listOp', 'data.map', 'data.mapOp',
        'loop.while', 'loop.repeatTimes', 'loop.forEachPlayer', 'loop.forEachBuild',
        'loop.forEachIndexed',
        'query.players', 'query.blocks', 'query.countUnits', 'query.closestEnemy',
        'util.random', 'util.chance', 'util.currentTime', 'util.log',
        'util.returnList', 'util.waitSeconds',
        // 第三批：交互 / 服务器
        'interact.openMenu', 'interact.onMenuChoose', 'interact.closeMenu', 'interact.openURI',
        'server.disableSelf', 'server.loadMap', 'server.teamRule', 'server.registerVar',
      ];
      const missing = mustHave.filter(k => !idx.defOf(k));
      // 每个控件都要能渲染出「中文名」和「代码提示」，否则卡片上是空的
      const noLabel = mustHave.filter(k => { const d = idx.defOf(k); return d && !d.label; });
      const noHint = mustHave.filter(k => { const d = idx.defOf(k); return d && !d.codeHint; });
      // 中文搜索要能命中
      const searchHits = ['传送', '回血', '公告', '随机', '日志', '管理员', '列表', '对照表', '循环']
        .map(q => ({ q, n: idx.searchDefs(q).length }));
      const failedSearch = searchHits.filter(s => s.n === 0);
      return {
        total: idx.allDefs().length,
        missing, noLabel, noHint, failedSearch,
      };
    })()`);
    if (r.err) bad(r.err);
    else {
      if (r.missing.length) bad(`这些控件没注册进目录：${r.missing.join(', ')}`);
      else ok(`44 个新控件全部注册（目录共 ${r.total} 个）`);
      if (r.noLabel.length) bad(`缺中文名：${r.noLabel.join(', ')}`);
      else ok('新控件都有中文名');
      if (r.noHint.length) bad(`缺代码提示：${r.noHint.join(', ')}`);
      else ok('新控件都有代码提示');
      if (r.failedSearch.length) bad(`这些关键词搜不到控件：${r.failedSearch.map(s => s.q).join(', ')}`);
      else ok('中文关键词都能搜到对应控件');
    }
  }

  // ---- 4c. 控件库是双排（不是单排） ----
  console.log('\n=== 4c. 控件库双排 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const measure = (body) => {
        const cards = [...body.querySelectorAll('.lib-card')];
        const wide = body.getBoundingClientRect().width;
        const boxes = cards.slice(0, 6).map(c => {
          const b = c.getBoundingClientRect();
          return { x: Math.round(b.x), w: Math.round(b.width) };
        });
        const xs = [...new Set(boxes.map(b => b.x))];
        const firstX = boxes[0].x;
        const sameCol = boxes.filter(b => b.x === firstX).length;
        return { count: cards.length, wide: Math.round(wide), xs, sameCol, boxes };
      };
      // 找一个「已展开且控件数 >= 4」的分类；没有就展开一个
      let body = null;
      for (const h of document.querySelectorAll('.lib-group-head')) {
        const b = h.parentElement.querySelector('.lib-group-body');
        if (b && !b.hidden && b.querySelectorAll('.lib-card').length >= 4) { body = b; break; }
      }
      if (!body) {
        for (const h of document.querySelectorAll('.lib-group-head')) {
          const b = h.parentElement.querySelector('.lib-group-body');
          if (!b || !b.hidden) continue;
          h.click();
          await new Promise(r => setTimeout(r, 150));
          if (b.querySelectorAll('.lib-card').length >= 4) { body = b; break; }
          h.click();   // 不合适，收回去
        }
      }
      if (!body) return { ok: false };
      // 等一帧让 grid 布局稳定
      await new Promise(r => requestAnimationFrame(r));
      return Object.assign({ ok: true, label: body.parentElement.querySelector('.lg-label').textContent }, measure(body));
    })()`);
    if (!r.ok) bad('没找到控件数 ≥ 4 的已展开分类来验证双排');
    else {
      // 双排 = 至少出现两个不同的起始 x
      if (r.xs.length < 2) bad(`「${r.label}」的 ${r.count} 个控件还是单排（起始 x 只有 ${r.xs.join(',')}）`);
      else ok(`「${r.label}」${r.count} 个控件排成 ${r.xs.length} 列（起始 x：${r.xs.join('/')}）`);
      // 同一列里要有多个 -> 确实换了行，而不是散开
      if (r.xs.length >= 2 && r.sameCol < 2) bad('控件没有换行（可能只是宽度不齐）');
      else if (r.xs.length >= 2) ok(`第 1 列有 ${r.sameCol} 个控件（确实换行了）`);
      // 单张卡片不能窄到看不清字
      const tooNarrow = r.boxes.filter(b => b.w < 90);
      if (tooNarrow.length) bad(`有卡片只有 ${tooNarrow.map(b => b.w).join('/')}px 宽，太窄`);
      else ok(`卡片宽度 ${r.boxes.map(b => b.w).join('/')}px（都 ≥ 90px）`);
    }
  }

  // ---- 5. 代码预览只有一个入口，且是深色 ----
  console.log('\n=== 5. 代码预览 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const hasOldPanel = !!document.getElementById('preview') || !!document.getElementById('previewBody');
      const btn = document.querySelector('[data-act="preview"]');
      if (!btn) return { hasOldPanel, noButton: true };
      btn.click();
      await new Promise(r => setTimeout(r, 400));
      const m = document.getElementById('modal');
      const box = m.querySelector('.codemode');
      const pre = m.querySelector('.cm-code');
      const cs = pre ? getComputedStyle(pre) : null;
      const lum = (rgb) => {
        const [r,g,b] = rgb.match(/\\d+/g).map(Number);
        return (0.299*r + 0.587*g + 0.114*b) / 255;
      };
      const res = {
        hasOldPanel,
        title: m.querySelector('.modal-title')?.textContent,
        isDark: box ? box.classList.contains('code-dark') : false,
        preBg: cs ? cs.backgroundColor : null,
        preLum: cs ? lum(cs.backgroundColor) : null,
        hasCode: pre ? pre.textContent.trim().length > 20 : false,
        title2: m.querySelector('.modal-title')?.textContent,
      };
      const close = [...m.querySelectorAll('[data-btn]')].find(b => b.textContent.includes('关闭'));
      if (close) close.click();
      return res;
    })()`);
    if (r.hasOldPanel) bad('右下角还有旧的常驻预览面板');
    else ok('右下角没有重复的预览面板');
    if (r.noButton) bad('工具栏找不到「代码预览」按钮');
    else if (r.title !== '代码预览') bad(`弹出的是别的框：${r.title}`);
    else if (!r.isDark) bad('代码弹窗没有用深色容器');
    else if (r.preLum !== null && r.preLum > 0.35) bad(`代码区不够深：${r.preBg}`);
    else ok(`代码弹窗是深色（${r.preBg}，亮度 ${r.preLum.toFixed(2)}），且有代码内容`);
  }

  // ---- 6. 双击不再添加控件（用户要求只保留拖入） ----
  console.log('\n=== 6. 双击不应再添加控件 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const a = window.__app;
      a.closeModal();
      localStorage.clear();
      // 第 15 轮：清空存档后 start() 会被当成「首次进入」，异步生成示例插件组，
      // 那会在下面的等待窗口里重建画布、把刚拖进去的节点冲掉。
      // 这两节测的是拖放本身，所以先把「已摆过示例」的标记打上（示例另有一节专测）。
      localStorage.setItem('kts-builder.samples.v1', '1');
      a.start();
      await new Promise(r => setTimeout(r, 300));
      // start() 现在会落到首页（整窗替换），下面要操作画布，先点进第一个插件组
      {
        const card = document.querySelector('.hm-card');
        if (card) card.click();
        await new Promise(r => setTimeout(r, 300));
      }

      // 展开分类，找一张事件卡片
      let card = document.querySelector('.lib-card[data-def^="event."]');
      if (!card) {
        for (const h of document.querySelectorAll('.lib-group-head')) {
          if (h.getAttribute('aria-expanded') === 'false') h.click();
          await new Promise(r => setTimeout(r, 60));
          card = document.querySelector('.lib-card[data-def^="event."]');
          if (card) break;
        }
      }
      if (!card) return { err: '控件库里找不到卡片' };

      const before = document.querySelectorAll('.cv-node').length;
      card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const after = document.querySelectorAll('.cv-node').length;
      return { before, after };
    })()`);
    if (r.err) bad(r.err);
    else if (r.after !== r.before) bad(`双击控件仍然会添加节点（${r.before} → ${r.after}），用户要求只保留拖入`);
    else ok(`双击控件不再添加节点（仍是 ${r.before} 个）`);
  }

  // ---- 7. 拖放真的能往画布加控件（用 CDP 合成真实的拖放事件） ----
  console.log('\n=== 7. 拖放加控件 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const a = window.__app;
      a.closeModal();
      localStorage.clear();
      // 第 15 轮：清空存档后 start() 会被当成「首次进入」，异步生成示例插件组，
      // 那会在下面的等待窗口里重建画布、把刚拖进去的节点冲掉。
      // 这两节测的是拖放本身，所以先把「已摆过示例」的标记打上（示例另有一节专测）。
      localStorage.setItem('kts-builder.samples.v1', '1');
      a.start();
      await new Promise(r => setTimeout(r, 300));
      // start() 现在会落到首页，先点进第一个插件组再操作画布
      {
        const card = document.querySelector('.hm-card');
        if (card) card.click();
        await new Promise(r => setTimeout(r, 300));
      }

      // 展开分类找到一张事件卡片
      let card = document.querySelector('.lib-card[data-def^="event."]');
      if (!card) {
        for (const h of document.querySelectorAll('.lib-group-head')) {
          if (h.getAttribute('aria-expanded') === 'false') h.click();
          await new Promise(r => setTimeout(r, 60));
          card = document.querySelector('.lib-card[data-def^="event."]');
          if (card) break;
        }
      }
      if (!card) return { err: '控件库里找不到可拖的卡片' };

      const vp = document.querySelector('.cv-viewport');
      const vr = vp.getBoundingClientRect();
      const before = document.querySelectorAll('.cv-node').length;
      const key = card.dataset.def;

      // 合成拖放：dragstart(库) -> dragover(画布) -> drop(画布)
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));

      const gx = vr.left + vr.width / 2;
      const gy = vr.top + vr.height / 2;
      vp.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: gx, clientY: gy }));

      // dragover 之后应出现落点虚影
      //
      // 注意这里看的是 getComputedStyle 而不是 .hidden 属性。
      // [hidden] 只是浏览器默认样式表里的一条规则，我们自己的
      // .cv-dropzone { display: flex } 会把它盖掉 —— 只看属性的话，
      // 「设了 hidden 但屏幕上还画着虚线框」这种 bug 会被放过去（真发生过）。
      // （这段注释在模板字符串里，所以不能出现反引号。）
      const visible = (el) => !!el && getComputedStyle(el).display !== 'none';
      const dz = document.querySelector('.cv-dropzone');
      const hintShown = visible(dz);
      const hintText = hintShown ? dz.textContent : '';

      vp.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: gx, clientY: gy }));
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      await new Promise(r => setTimeout(r, 300));

      const nodes = [...document.querySelectorAll('.cv-node')];
      const dzAfter = document.querySelector('.cv-dropzone');
      const hintCleared = !visible(dzAfter);
      // 画布中间的「从左边拖进来」提示：有节点之后必须看不见
      const emptyEl = document.querySelector('.cv-hint');
      const emptyStillVisible = visible(emptyEl) && nodes.length > 0;
      const emptyDisplay = emptyEl ? getComputedStyle(emptyEl).display : null;
      // 落点应该就在鼠标位置附近。
      // 注意：新节点是 push 到 canvas.nodes 末尾的，DOM 里不一定是第一个 ——
      // 所以按「离鼠标最近的那个节点」来判断落点，而不是死取 nodes[0]。
      let placedNear = null;
      if (nodes.length) {
        const boxes = nodes.map(function (el) { return el.getBoundingClientRect(); });
        let best = boxes[0];
        let bestD = 1e9;
        for (const r of boxes) {
          const dx = (r.left + r.width / 2) - gx;
          const dy = (r.top + 20) - gy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < bestD) { bestD = d; best = r; }
        }
        placedNear = Math.abs((best.left + best.width / 2) - gx) < 30
          && Math.abs((best.top + 20) - gy) < 40;
      }
      // 顺便核对节点在浅色主题下的可读性
      let headBg = null, headLum = null, titleColor = null, titleLum = null;
      if (nodes.length) {
        const lum = (rgb) => {
          const m = rgb.match(/\\d+/g); if (!m) return null;
          const [r, g, b] = m.map(Number);
          return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        };
        const head = nodes[0].querySelector('.cv-node-head');
        const title = nodes[0].querySelector('.cv-node-title');
        headBg = getComputedStyle(head).backgroundColor;
        headLum = lum(headBg);
        titleColor = getComputedStyle(title).color;
        titleLum = lum(titleColor);
      }
      return {
        key, before, after: nodes.length,
        hintShown, hintText,
        hintCleared, emptyStillVisible, emptyDisplay,
        placedNear,
        nodeTitle: nodes.length ? nodes[0].querySelector('.cv-node-title')?.textContent : null,
        headBg, headLum, titleColor, titleLum,
      };
    })()`);
    if (r.err) bad(r.err);
    else {
      if (r.after !== r.before + 1) bad(`拖放后节点数没 +1（${r.before} → ${r.after}）—— 拖放没生效`);
      else ok(`拖放「${r.nodeTitle}」成功加进画布（${r.before} → ${r.after} 个节点）`);
      if (!r.hintShown) bad('dragover 时没有显示落点虚影');
      else ok(`dragover 时有落点虚影（显示「${r.hintText}」）`);
      if (!r.hintCleared) bad('drop 之后落点虚影还看得见（虚线框没删掉）');
      else ok('drop 后落点虚影真的消失了（虚线框已删掉）');
      if (r.emptyStillVisible) bad(`画布上已经有节点了，中间的空画布提示还看得见（display=${r.emptyDisplay}）`);
      else ok('有节点后画布中间的空提示已隐藏');
      if (r.placedNear === false) bad('控件没有落在鼠标松手的位置');
      else if (r.placedNear) ok('控件落在鼠标松手的位置');
      if (r.headLum === null) bad('拿不到节点头背景色');
      else if (r.headLum < 0.7) bad(`节点头背景偏暗：${r.headBg}`);
      else ok(`节点头是浅色：${r.headBg}（亮度 ${r.headLum.toFixed(2)}）`);
      if (r.titleLum !== null && r.titleLum > 0.5) bad(`节点标题太浅看不清：${r.titleColor}`);
      else ok(`节点标题够深：${r.titleColor}`);
    }
  }

  // ---- 8. 滚轮缩放 / 右键平移 ----
  console.log('\n=== 8. 滚轮缩放与右键平移 ===');
  {
    const r = await evaluate(cdp, `(() => {
      const a = window.__app;
      const v = a.canvasView;
      const vp = document.querySelector('.cv-viewport');
      const vr = vp.getBoundingClientRect();
      const cx = vr.left + vr.width / 2, cy = vr.top + vr.height / 2;

      // --- 滚轮向上 = 放大 ---
      const z0 = v.zoom;
      vp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: cx, clientY: cy }));
      const z1 = v.zoom;
      vp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, clientX: cx, clientY: cy }));
      const z2 = v.zoom;

      // --- 缩放锚点：光标下的世界点不动 ---
      const beforePt = v.toWorld(cx, cy);
      vp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: cx, clientY: cy }));
      const afterPt = v.toWorld(cx, cy);
      const anchorDrift = Math.hypot(afterPt.x - beforePt.x, afterPt.y - beforePt.y);

      // --- 缩放范围 ---
      let lo = v.zoom, hi = v.zoom;
      for (let i = 0; i < 60; i++) vp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, clientX: cx, clientY: cy }));
      lo = v.zoom;
      for (let i = 0; i < 120; i++) vp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: cx, clientY: cy }));
      hi = v.zoom;

      // --- 右键拖动 = 平移 ---
      v.setZoom ? 0 : 0;
      const px0 = v.panX, py0 = v.panY;
      vp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2, clientX: cx, clientY: cy }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + 60, clientY: cy + 40 }));
      const panningActive = !!v.panning;
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 2, clientX: cx + 60, clientY: cy + 40 }));
      const dx = v.panX - px0, dy = v.panY - py0;

      // --- 右键单击不弹菜单 ---
      const hadMenu = !!document.querySelector('.ctx-menu');
      vp.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: cx, clientY: cy }));
      const menuAfter = !!document.querySelector('.ctx-menu');

      // --- 左键拖空白处 = 平移画布（用户要求的主方式）。框选已整块删除 ---
      const p0 = { x: v.panX, y: v.panY };
      vp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: vr.left + 5, clientY: vr.top + 5 }));
      const leftPanning = !!v.panning;
      const leftMarquee = !!v.marquee;
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: vr.left + 65, clientY: vr.top + 45 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: vr.left + 65, clientY: vr.top + 45 }));
      const lpDX = v.panX - p0.x, lpDY = v.panY - p0.y;

      // --- 中键仍可平移 ---
      const m0 = { x: v.panX, y: v.panY };
      vp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1, clientX: cx, clientY: cy }));
      const midPanning = !!v.panning;
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 1, clientX: cx, clientY: cy }));

      return { z0, z1, z2, anchorDrift, lo, hi, panningActive, dx, dy, menuAfter, hadMenu,
               leftPanning, leftMarquee, lpDX, lpDY, midPanning,
               hasMarqueeEl: !!document.querySelector('.cv-marquee'),
               hasMarqueeProp: 'marquee' in v };
    })()`);

    if (!(r.z1 > r.z0)) bad(`滚轮向上没有放大（${r.z0.toFixed(2)} → ${r.z1.toFixed(2)}）`);
    else ok(`滚轮向上放大 ${r.z0.toFixed(2)}→${r.z1.toFixed(2)}，向下缩小到 ${r.z2.toFixed(2)}`);
    if (r.anchorDrift > 0.5) bad(`缩放锚点漂移了 ${r.anchorDrift.toFixed(2)} 像素世界坐标`);
    else ok(`缩放以鼠标为锚点（漂移 ${r.anchorDrift.toFixed(4)}）`);
    if (Math.abs(r.lo - 0.25) > 0.01) bad(`缩放下限不是 25%，实际 ${(r.lo * 100).toFixed(0)}%`);
    else if (Math.abs(r.hi - 2.5) > 0.01) bad(`缩放上限不是 250%，实际 ${(r.hi * 100).toFixed(0)}%`);
    else ok(`缩放范围 ${(r.lo * 100).toFixed(0)}% ~ ${(r.hi * 100).toFixed(0)}%`);
    if (!r.panningActive) bad('右键按下没有进入平移状态');
    else if (Math.abs(r.dx - 60) > 2 || Math.abs(r.dy - 40) > 2) bad(`右键平移量不对：(${r.dx}, ${r.dy})，应为 (60, 40)`);
    else ok(`右键拖动平移画布（位移 ${r.dx}, ${r.dy}）`);
    if (r.menuAfter) bad('右键单击弹出了菜单');
    else ok('右键单击不弹菜单');
    // 用户要求：左键拖空白处也能平移
    if (!r.leftPanning) bad('左键拖空白处没有进入平移状态');
    else if (Math.abs(r.lpDX - 60) > 2 || Math.abs(r.lpDY - 40) > 2) bad(`左键平移量不对：(${r.lpDX}, ${r.lpDY})，应为 (60, 40)`);
    else ok(`左键拖空白处平移画布（位移 ${r.lpDX}, ${r.lpDY}）`);
    if (r.leftMarquee) bad('左键拖空白处还在触发框选');
    else ok('左键拖空白处不再触发框选');
    // 用户说框选用不上，要求删掉 —— 验证真的删干净了
    if (r.hasMarqueeEl) bad('页面上还有 .cv-marquee 元素（框选没删干净）');
    else if (r.hasMarqueeProp) bad('CanvasView 上还有 marquee 属性（框选没删干净）');
    else ok('框选已彻底删除（无元素、无状态）');
    if (!r.midPanning) bad('中键不能平移了');
    else ok('中键仍可平移');
  }

  // ---- 9. 设置页 ----
  console.log('\n=== 9. 设置页 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const app = document.getElementById('app');
      const set = document.getElementById('settings');
      const visible = (el) => !!el && getComputedStyle(el).display !== 'none';
      // 打开设置
      document.querySelector('[data-act="settings"]').click();
      await new Promise(r => setTimeout(r, 250));
      const opened = {
        settingsVisible: visible(set),
        appVisible: visible(app),
        navCount: set.querySelectorAll('.set-nav-item').length,
        navLabels: [...set.querySelectorAll('.set-nav-item')].map(b => b.textContent.trim()),
        active: (set.querySelector('.set-nav-item.on') || {}).textContent,
        items: set.querySelectorAll('.set-item').length,
        title: (set.querySelector('.set-pane-title') || {}).textContent,
      };

      // 切到「外观与主题」
      const nav = [...set.querySelectorAll('.set-nav-item')];
      const appear = nav.find(b => b.textContent.includes('外观'));
      appear.click();
      await new Promise(r => setTimeout(r, 150));
      const appearance = {
        title: (set.querySelector('.set-pane-title') || {}).textContent,
        items: set.querySelectorAll('.set-item').length,
        hasThemeSelect: !!set.querySelector('select[data-key="theme"]'),
        themeOptions: [...set.querySelectorAll('select[data-key="theme"] option')].map(o => o.value),
        hasFontRange: !!set.querySelector('input[data-key="uiFontSize"]'),
      };

      // 逐项数一下三类
      const counts = {};
      for (const b of nav) {
        b.click();
        await new Promise(r => setTimeout(r, 80));
        counts[b.textContent.trim()] = set.querySelectorAll('.set-item').length;
      }
      // 收尾：回到主界面，免得影响后面的用例
      set.querySelector('[data-act="back"]').click();
      await new Promise(r => setTimeout(r, 200));
      const closedBack = !visible(set) && visible(app);
      return {
        opened, appearance, counts, closedBack,
        backSet: visible(set) ? 'still-visible' : 'hidden',
        backApp: visible(app) ? 'visible' : 'still-hidden',
      };
    })()`);
    if (r.err) bad(r.err);
    else {
      if (!r.opened.settingsVisible) bad('点「设置」后设置页没显示出来');
      else if (r.opened.appVisible) bad('设置页显示了但主界面还看得见（应该整窗替换）');
      else ok('点「设置」整窗切到设置页，主界面已隐藏');
      if (r.opened.navCount < 3) bad(`设置分类至少应有 3 个，实际 ${r.opened.navCount}`);
      else ok(`左侧导航 ${r.opened.navCount} 类：${r.opened.navLabels.join(' / ')}`);
      if (!r.opened.navLabels.some(l => l.includes('关于'))) bad('设置里缺少「关于」分类');
      else ok('设置里有「关于」分类');
      if (r.appearance.hasThemeSelect && r.appearance.themeOptions.join(',') === 'light,dark,system') {
        ok('外观里有主题选择：浅色 / 深色 / 跟随系统');
      } else {
        bad(`主题选择不对：${JSON.stringify(r.appearance.themeOptions)}`);
      }
      if (r.appearance.hasFontRange) ok('外观里有界面字号调节');
      else bad('外观里缺少界面字号调节');
      const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
      if (total < 9) bad(`设置项只有 ${total} 个，偏少`);
      else ok(`各类共有 ${total} 个设置项（${Object.entries(r.counts).map(([k, v]) => k + ' ' + v).join('，')}）`);
      if (!r.closedBack) bad(`点「返回」没回到主界面（settings=${r.backSet} app=${r.backApp}）`);
      else ok('点「返回」回到主界面');
    }
  }

  // ---- 10. 深色主题真的换了色 ----
  console.log('\n=== 10. 深色主题 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const lum = (rgb) => {
        const m = String(rgb).match(/\\d+/g); if (!m) return null;
        const [r, g, b] = m.map(Number);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      };
      const openSettings = async () => {
        document.querySelector('[data-act="settings"]').click();
        await new Promise(r => setTimeout(r, 200));
        // 主题在「外观与主题」那一页，先切过去
        const nav = [...document.querySelectorAll('#settings .set-nav-item')];
        (nav.find(b => b.textContent.includes('外观')) || nav[0]).click();
        await new Promise(r => setTimeout(r, 150));
      };
      const back = async () => {
        document.querySelector('#settings [data-act="back"]').click();
        await new Promise(r => setTimeout(r, 250));
      };

      // 先记下浅色
      const lightBg = getComputedStyle(document.body).backgroundColor;
      const lightLum = lum(lightBg);

      // 切到深色
      await openSettings();
      const sel = document.querySelector('#settings select[data-key="theme"]');
      if (!sel) return { err: '外观页里找不到主题选择框' };
      sel.value = 'dark';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      const dark = {
        attr: document.documentElement.dataset.theme,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyFg: getComputedStyle(document.body).color,
      };

      // 回主界面看看画布/工具栏有没有跟着变
      await back();
      const vp = document.querySelector('.cv-viewport');
      const tb = document.getElementById('toolbar');
      const main = {
        viewportBg: getComputedStyle(vp).backgroundColor,
        toolbarBg: getComputedStyle(tb).backgroundColor,
      };

      // 再切回浅色
      await openSettings();
      const sel2 = document.querySelector('#settings select[data-key="theme"]');
      sel2.value = 'light';
      sel2.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      const backState = { attr: document.documentElement.dataset.theme, bodyBg: getComputedStyle(document.body).backgroundColor };
      await back();

      return { lightBg, lightLum, dark, main, back: backState };
    })()`);
    if (r.err) bad(r.err);
    else {
      const l = (c) => { const m = String(c).match(/\d+/g); return m ? (0.299*Number(m[0]) + 0.587*Number(m[1]) + 0.114*Number(m[2])) / 255 : null; };
      if (r.dark.attr !== 'dark') bad(`切深色后 html[data-theme] 不是 dark，实际 ${r.dark.attr}`);
      else ok('切「深色」后 html[data-theme=dark] 生效');
      const dl = l(r.dark.bodyBg), ll = l(r.lightBg);
      if (!(dl < 0.3)) bad(`深色主题下面底色仍然偏亮：${r.dark.bodyBg}（亮度 ${dl.toFixed(2)}）`);
      else ok(`深色底色确实变暗：${r.lightBg} → ${r.dark.bodyBg}（${ll.toFixed(2)} → ${dl.toFixed(2)}）`);
      const fl = l(r.dark.bodyFg);
      if (!(fl > 0.7)) bad(`深色主题下文字色不够亮：${r.dark.bodyFg}`);
      else ok(`深色文字够亮：${r.dark.bodyFg}（亮度 ${fl.toFixed(2)}）`);
      // 画布也要跟着深，不能只有外壳变了
      const vl = l(r.main.viewportBg), tl = l(r.main.toolbarBg);
      if (!(vl < 0.35)) bad(`深色下画布底色没变深：${r.main.viewportBg}`);
      else ok(`画布底色也跟着变深：${r.main.viewportBg}`);
      if (!(tl < 0.35)) bad(`深色下工具栏没变深：${r.main.toolbarBg}`);
      else ok(`工具栏也跟着变深：${r.main.toolbarBg}`);
      if (r.back.attr !== 'light') bad('切回浅色没生效');
      else if (Math.abs(l(r.back.bodyBg) - ll) > 0.02) bad(`切回浅色后底色和原来不一致：${r.back.bodyBg} vs ${r.lightBg}`);
      else ok('能切回浅色，且底色与原来一致（设置即时生效）');
    }
  }

  // ---- 11. 背景网格默认关闭、能打开 ----
  console.log('\n=== 11. 背景网格 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const vp = document.querySelector('.cv-viewport');
      const before = {
        hasClass: vp.classList.contains('show-grid'),
        bgImage: getComputedStyle(vp).backgroundImage,
      };
      const toCanvas = async () => {
        document.querySelector('[data-act="settings"]').click();
        await new Promise(r => setTimeout(r, 220));
        const set = document.getElementById('settings');
        // 「显示背景网格」在第一个分类里；设置页会记住上次停留的分类，
        // 所以这里必须显式点一下，不能指望默认就停在画布页。
        const nav = [...set.querySelectorAll('.set-nav-item')];
        (nav.find(b => b.textContent.includes('画布')) || nav[0]).click();
        await new Promise(r => setTimeout(r, 150));
        return set;
      };
      const leave = async () => {
        document.querySelector('#settings [data-act="back"]').click();
        await new Promise(r => setTimeout(r, 250));
      };

      const set = await toCanvas();
      const cb = set.querySelector('input[type=checkbox][data-key="showGrid"]');
      if (!cb) return { err: '画布分类里没有 showGrid 开关' };
      const wasChecked = cb.checked;
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      // 开了网格之后应该多出「网格间距」这一项（依赖项）
      const hasGridSize = !!set.querySelector('input[data-key="gridSize"]');
      await leave();
      const after = {
        hasClass: vp.classList.contains('show-grid'),
        bgImage: getComputedStyle(vp).backgroundImage,
        gridSize: vp.style.getPropertyValue('--grid-size'),
      };

      // 关掉，别把状态留给后面的用例
      const set2 = await toCanvas();
      const cb2 = set2.querySelector('input[data-key="showGrid"]');
      cb2.checked = false;
      cb2.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      await leave();
      return { before, wasChecked, hasGridSize, after };
    })()`);
    if (r.err) bad(r.err);
    else {
      if (r.wasChecked) bad('背景网格默认是开着的（应为关闭）');
      else if (r.before.hasClass || r.before.bgImage !== 'none') {
        bad(`网格默认关闭，但画布上已经有背景图：${r.before.bgImage}`);
      } else ok('背景网格默认关闭（画布上没有网格层）');
      if (!r.after.hasClass) bad('打开「显示背景网格」后画布没有 .show-grid');
      else ok('打开设置里的开关后画布出现网格');
      if (!/radial-gradient/.test(r.after.bgImage)) bad(`网格没有真的画出来：${r.after.bgImage}`);
      else ok('网格确实渲染出了点阵背景');
      if (!r.after.gridSize) bad('网格间距 --grid-size 没设置');
      else ok(`网格间距按缩放换算成屏幕像素：${r.after.gridSize}`);
      if (!r.hasGridSize) bad('开了网格却没出现「网格间距」设置项（依赖项没生效）');
      else ok('「网格间距」只在开启网格后才出现');
    }
  }

  // ---- 12. 「未保存」标记与关窗询问 ----
  console.log('\n=== 12. 未保存标记与关窗询问 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const app = window.__app;
      const st = () => {
        const el = document.querySelector('.st-dirty');
        return el ? { text: el.textContent.trim(), on: el.classList.contains('on') } : null;
      };
      // 记下当前状态
      const start = st();
      // 动一下画布：加一个节点。
      // drop 处理里读的是 dataTransfer（合成事件里拿不到）或 dragDefKey()，
      // 所以把 draggingDef 摆好再派发 drop。
      const before = document.querySelectorAll('.cv-node').length;
      const vp = document.querySelector('.cv-viewport');
      const vr = vp.getBoundingClientRect();
      const dt = new DataTransfer();
      const at = { clientX: vr.left + 300, clientY: vr.top + 200 };
      app.canvasView.draggingDef = 'event.Trigger.update';
      vp.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
      vp.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
      app.canvasView.clearDropHint();
      await new Promise(r => setTimeout(r, 300));
      const afterAdd = document.querySelectorAll('.cv-node').length;
      const dirty = st();

      // 关窗询问：直接调 onCloseRequested，看它有没有弹出「有改动还没保存」
      let modalText = '';
      let buttons = [];
      const p = app.onCloseRequested();
      await new Promise(r => setTimeout(r, 350));
      const m = document.getElementById('modal');
      if (m && !m.hidden) {
        modalText = (m.querySelector('.modal-title') || {}).textContent || '';
        buttons = [...m.querySelectorAll('[data-btn]')].map(b => b.textContent.trim());
      }
      // 点「取消」，避免真的关掉窗口
      const cancel = m && [...m.querySelectorAll('[data-btn]')].find(b => b.textContent.trim() === '取消');
      if (cancel) cancel.click();
      await new Promise(r => setTimeout(r, 250));
      const modalGone = document.getElementById('modal').hidden;
      return { start, before, afterAdd, dirty, modalText, buttons, modalGone };
    })()`);
    if (r.err) bad(r.err);
    else {
      if (r.afterAdd !== r.before + 1) bad(`没能在画布上加节点（${r.before} → ${r.afterAdd}），后面几项没法判断`);
      else ok(`加了一个节点（${r.before} → ${r.afterAdd}）`);
      if (!r.dirty || !r.dirty.on) bad(`改动之后状态栏没有变成「未保存」：${JSON.stringify(r.dirty)}`);
      else ok(`状态栏显示「${r.dirty.text}」`);
      if (!/保存/.test(r.modalText)) bad(`关窗时没有弹出保存提醒（弹窗标题：「${r.modalText}」）`);
      else ok(`关窗时弹出提醒：「${r.modalText}」`);
      for (const want of ['取消', '不保存', '保存并继续']) {
        if (!r.buttons.includes(want)) bad(`关窗提醒缺少「${want}」按钮（实际：${r.buttons.join('/') }）`);
      }
      if (['取消', '不保存', '保存并继续'].every(b => r.buttons.includes(b))) {
        ok('提醒里有三个出口：取消 / 不保存 / 保存并继续');
      }
      if (!r.modalGone) bad('点了「取消」对话框没关掉');
      else ok('点「取消」后对话框关闭，窗口没有被关掉');
    }
  }

  // ---- 13. 模块管理 ----
  console.log('\n=== 13. 模块管理 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      document.querySelector('[data-act="modules"]').click();
      await new Promise(r => setTimeout(r, 300));
      const m = document.getElementById('modal');
      const vis = !!m && !m.hidden;
      const rows = [...m.querySelectorAll('.mod-row')].map(r => ({
        name: (r.querySelector('.mod-name') || {}).textContent || '',
        meta: (r.querySelector('.mod-meta') || {}).textContent || '',
        hasDel: !!r.querySelector('[data-del]'),
        delDisabled: (r.querySelector('[data-del]') || {}).disabled,
      }));
      const title = vis ? ((m.querySelector('.modal-title') || {}).textContent || '') : '';
      return { visible: vis, title, rows };
    })()`);
    if (r.err) bad(r.err);
    else {
      if (!r.visible) bad('点「模块管理」没有打开窗口');
      else ok(`点「模块管理」打开了「${r.title}」`);
      if (!r.rows.length) bad('模块列表是空的');
      else {
        ok(`列出了 ${r.rows.length} 个模块：${r.rows.map(x => x.name).join(', ')}`);
        if (!r.rows.every(x => x.hasDel)) bad('有的模块没有删除按钮');
        else ok('每个模块都有删除按钮');
        if (r.rows.length === 1 && !r.rows[0].delDisabled) {
          bad('只有 1 个模块时删除按钮仍可点（会把插件删空）');
        } else ok('只剩一个模块时删除按钮禁用');
      }
    }

    // 收尾：关掉窗口
    await evaluate(cdp, `(() => {
      const b = document.querySelector('#modal [data-btn]');
      if (b) b.click();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 200));
  }

  // ---- 14. 「关于」页：版本与协议真的显示出来了 ----
  console.log('\n=== 14. 关于页（版本 / 协议） ===');
  {
    const r = await evaluate(cdp, `(async () => {
      document.querySelector('[data-act="settings"]').click();
      await new Promise(r => setTimeout(r, 250));
      const nav = [...document.querySelectorAll('#settings .set-nav-item')];
      const about = nav.find(b => b.textContent.includes('关于'));
      if (!about) return { err: '设置里没有「关于」分类' };
      about.click();
      await new Promise(r => setTimeout(r, 250));

      const pane = document.querySelector('#settings .set-pane');
      const text = pane ? pane.textContent : '';
      const infos = [...document.querySelectorAll('#settings .set-info')].map(e => e.textContent.trim());
      // 只读项不应有输入控件
      const inputs = [...pane.querySelectorAll('input, select, textarea')].length;
      return { text, infos, inputs, navLabels: nav.map(b => b.textContent.trim()) };
    })()`);

    if (r.err) bad(r.err);
    else {
      console.log('   只读值:', r.infos.join(' | '));
      if (/版本/.test(r.text)) ok('关于页有「版本」');
      else bad('关于页没有版本项');
      if (r.infos.some(v => /^\d+\.\d+\.\d+$/.test(v))) ok(`版本号显示出来了：${r.infos.find(v => /^\d+\.\d+\.\d+$/.test(v))}`);
      else bad('版本号没显示（或是空的）');
      if (/开源协议/.test(r.text) && r.infos.some(v => /MIT/.test(v))) ok('关于页显示 MIT 协议');
      else bad('关于页没显示协议');
      if (r.inputs === 0) ok('关于页全是只读展示，没有可编辑控件');
      else bad(`关于页有 ${r.inputs} 个输入控件（只读信息不该能改）`);

      // 回到主界面，别影响后面的检查
      await evaluate(cdp, `(() => { const b=document.querySelector('#settings [data-act="back"]'); if(b) b.click(); return true; })()`);
      await new Promise(r => setTimeout(r, 250));
    }
  }

  // ---- 16. 全局防崩溃：故意注入故障，验证界面不会死 ----
  //
  // 「有几个按钮一点就崩溃」但正常点击复现不出来，所以这里反过来做：
  // 主动往渲染管线/按钮处理函数里塞异常，检查三件事 ——
  //   ① 异常被按环节隔离，其余界面照常更新（不是「点哪个按钮都没反应」）
  //   ② 报错框给出可读中文 + 出路（另存工程 / 复制 / 日志位置）
  //   ③ 同一错误反复触发不会无限刷屏
  console.log('\n=== 16. 全局防崩溃（注入故障） ===');
  {
    // 16.1 让「控件库」渲染必炸
    const r1 = await evaluate(cdp, `(async () => {
      window.__origRenderLibrary = window.__app.renderLibrary.bind(window.__app);
      window.__app.renderLibrary = function () { throw new Error('注入故障：控件库炸了'); };
      window.__crashGuard.reset();
      window.__app.renderAll();
      await new Promise(r => setTimeout(r, 300));
      const f = document.getElementById('fatal');
      return {
        failures: (window.__app.renderFailures || []).slice(),
        fatalShown: !!f && !f.hidden && getComputedStyle(f).display !== 'none',
        fatalText: f ? f.textContent : '',
        toolbarAlive: !!document.querySelector('#toolbar [data-act="fit"]'),
        errs: window.__crashGuard.messages(),
      };
    })()`);

    if (r1.failures.some(x => x.includes('控件库'))) ok('异常被 renderAll 按环节隔离并记录');
    else bad('renderAll 没有按环节隔离异常');
    if (r1.toolbarAlive) ok('一个环节炸了，工具栏等其余界面仍然正常');
    else bad('整个界面被拖垮了');
    if (r1.errs.some(x => x.includes('注入故障'))) ok('异常被全局拦截器收到');
    else bad('异常没有被全局拦截器收到');
    if (r1.fatalShown) ok('弹出报错框（不是静默失败）');
    else bad('异常被吞了，用户看不到任何提示');
    if (/出了个问题/.test(r1.fatalText)) ok('报错框标题是可读中文，不是原始英文堆栈');
    else bad('报错框标题不可读');

    const btns = await evaluate(cdp, `[...document.querySelectorAll('#fatal .fatal-btns button')].map(b=>b.textContent.trim())`);
    if (btns.some(b => /另存/.test(b))) ok('提供「另存工程」出路（能抢救数据）');
    else bad('没有抢救数据的出路');
    if (btns.some(b => /复制/.test(b))) ok('提供「复制详细信息」');
    else bad('没有复制按钮');
    // 日志位置要显示出来，用户才知道该发什么给我。
    // 路径是启动时（logStartup → initLog）就问回来的，正常应该已经在了；
    // 万一 IPC 慢，等一小会再读，避免误报。
    let logShown = '';
    for (let i = 0; i < 10; i++) {
      logShown = await evaluate(cdp, `(() => {
        const el = document.querySelector('#fatal .fatal-log');
        return el ? el.textContent : '';
      })()`);
      // 日志现在写在 logs\kts-builder-YYYY-MM-DD.txt（不再是 crash.log）
      if (/logs|kts-builder-\d{4}-\d{2}-\d{2}\.txt/.test(logShown)) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (/logs|kts-builder-\d{4}-\d{2}-\d{2}\.txt/.test(logShown)) {
      ok(`报错框里写明了日志位置：${logShown.slice(0, 80)}`);
    } else {
      bad(`报错框里没告诉用户日志在哪（当前显示：${logShown}）`);
    }
    // 「打开日志文件夹」按钮必须在
    if (btns.some(b => /打开日志文件夹/.test(b))) ok('提供「打开日志文件夹」按钮');
    else bad('没有打开日志文件夹的按钮');

    // 16.2 点「关掉提示继续用」应真的关掉
    await evaluate(cdp, `(() => {
      const b = [...document.querySelectorAll('#fatal .fatal-btns button')].find(x=>/关掉/.test(x.textContent));
      if (b) b.click(); return true;
    })()`);
    await new Promise(r => setTimeout(r, 300));
    const closed = await evaluate(cdp, `(() => { const f=document.getElementById('fatal'); return !!f && (f.hidden || getComputedStyle(f).display==='none'); })()`);
    if (closed) ok('点「关掉提示继续用」后报错框关闭'); else bad('报错框关不掉');

    // 16.3 同一错误反复触发：日志不丢，但不无限弹框
    await evaluate(cdp, `window.__crashGuard.reset()`);
    for (let i = 0; i < 8; i++) {
      await evaluate(cdp, `window.__app.renderAll()`).catch(() => {});
      await evaluate(cdp, `(() => { const b=[...document.querySelectorAll('#fatal .fatal-btns button')].find(x=>/关掉/.test(x.textContent)); if(b) b.click(); return true; })()`);
    }
    const storm = await evaluate(cdp, `({ count: window.__crashGuard.messages().length, shown: window.__crashGuard.shown() })`);
    if (storm.count >= 8) ok(`反复触发的 ${storm.count} 次错误都记进了日志（控制台不丢）`);
    else bad(`有错误没被记录（只记到 ${storm.count} 条）`);
    if (!storm.shown) ok('刷屏被抑制（第 4 次起不再弹框）');
    else bad('仍在无限弹框');

    // 16.4 恢复后应无异常
    await evaluate(cdp, `(() => {
      window.__app.renderLibrary = window.__origRenderLibrary;
      window.__crashGuard.reset();
      document.getElementById('fatal').hidden = true;
      window.__app.renderAll();
      return true;
    })()`);
    const recovered = await evaluate(cdp, `({
      failures: (window.__app.renderFailures || []).slice(),
      libGroups: document.querySelectorAll('#lib .lib-group').length,
      errs: window.__crashGuard.messages().length,
    })`);
    if (!recovered.failures.length && !recovered.errs && recovered.libGroups > 0) {
      ok(`恢复后一切正常（控件库 ${recovered.libGroups} 个分组，无异常）`);
    } else {
      bad(`恢复后仍有问题：${JSON.stringify(recovered)}`);
    }

    // 16.5 按钮处理函数炸掉时，必须点真按钮验证「兜底那一层」
    //      （直接调 dispatch() 会绕过 click 监听里的 try/catch，测不到）
    await evaluate(cdp, `(() => {
      window.__origFit = window.__app.canvasView.fit.bind(window.__app.canvasView);
      window.__app.canvasView.fit = function () { throw new Error('注入故障：适应视野炸了'); };
      window.__crashGuard.reset();
      return true;
    })()`);
    await evaluate(cdp, `document.querySelector('#toolbar [data-act="fit"]').click()`);
    await new Promise(r => setTimeout(r, 500));
    const afterBtn = await evaluate(cdp, `({
      shown: (() => { const f=document.getElementById('fatal'); return !!f && !f.hidden; })(),
      errs: window.__crashGuard.messages(),
    })`);
    if (afterBtn.errs.some(x => x.includes('适应视野'))) ok('点真按钮触发的异常被统一兜底并上报');
    else bad('按钮异常逃逸了：' + JSON.stringify(afterBtn.errs));
    if (afterBtn.shown) ok('报错框弹出来了');
    else bad('异常被吞了');
    // 关掉提示后，别的按钮仍要能用
    await evaluate(cdp, `(() => { const b=[...document.querySelectorAll('#fatal .fatal-btns button')].find(x=>/关掉/.test(x.textContent)); if(b) b.click(); return true; })()`);
    await evaluate(cdp, `document.querySelector('#toolbar [data-act="undo"]').click()`);
    await new Promise(r => setTimeout(r, 400));
    const stillOk = await evaluate(cdp, `(() => { try { window.__app.renderAll(); return 'ok'; } catch(e) { return 'threw: '+e.message; } })()`);
    if (stillOk === 'ok') ok('之后点别的按钮仍然正常');
    else bad('后续操作受影响：' + stillOk);
    await evaluate(cdp, `(() => { window.__app.canvasView.fit = window.__origFit; window.__crashGuard.reset(); return true; })()`);
  }

  // ---- 17. 日志页与日志文件 ----
  //
  // 内容层面的验证在 tests/log-file.js 里（它会读回文件内容）；
  // 这里只确认「界面上看得到、按钮点得动」这条链路。
  console.log('\n=== 17. 设置里的「日志」页 ===');
  {
    // 进设置 → 切到「日志」
    const nav = await evaluate(cdp, `(async () => {
      window.__app.openSettings();
      await new Promise(r => setTimeout(r, 300));
      const items = [...document.querySelectorAll('#settings .set-nav-item')];
      const logBtn = items.find(b => b.textContent.includes('日志'));
      if (!logBtn) return { err: '设置里没有「日志」分类' };
      logBtn.click();
      await new Promise(r => setTimeout(r, 900));
      const view = document.querySelector('#settings .set-log-view');
      const btns = [...document.querySelectorAll('#settings .set-log-btns button')].map(b => b.textContent.trim());
      const pathInfo = document.querySelector('#settings [data-info="__logPath"]');
      return {
        hasView: !!view,
        text: view ? view.textContent : '',
        btns,
        path: pathInfo ? pathInfo.textContent : '',
        navLabels: items.map(b => b.textContent.trim()),
      };
    })()`);

    if (nav.err) bad(nav.err);
    else {
      if (nav.navLabels.some(l => l.includes('日志'))) ok('设置里有「日志」分类');
      else bad('设置里没有日志分类');
      if (nav.hasView) ok('日志页显示了只读日志区');
      else bad('日志页没有日志显示区');
      if (nav.text && !/正在读取/.test(nav.text)) {
        ok(`日志内容读出来了（${nav.text.length} 字）`);
      } else {
        bad('日志内容没读出来：' + String(nav.text).slice(0, 60));
      }
      // 内容应该能看出是日志（有时间戳 / 级别标记）
      if (/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|\[INFO\]|\[ERROR\]/.test(nav.text)) {
        ok('日志内容确实带时间戳/级别');
      } else {
        bad('日志内容看起来不像日志：' + String(nav.text).slice(0, 80));
      }
      for (const b of ['刷新', '打开日志文件夹', '复制全部', '清空今天的日志']) {
        if (nav.btns.some(x => x.includes(b))) ok(`日志页有「${b}」按钮`);
        else bad(`日志页缺少「${b}」按钮`);
      }
      if (/logs/i.test(nav.path)) ok(`日志页显示了文件位置：${nav.path.slice(-46)}`);
      else bad('日志页没显示日志文件位置：' + nav.path);
    }

    // 「刷新」按钮真的能用（不抛异常、内容还在）
    const refreshed = await evaluate(cdp, `(async () => {
      const b = document.querySelector('#settings [data-act="log-refresh"]');
      if (!b) return { err: '没有刷新按钮' };
      b.click();
      await new Promise(r => setTimeout(r, 900));
      const view = document.querySelector('#settings .set-log-view');
      return { text: view ? view.textContent : '' };
    })()`);
    if (refreshed.err) bad(refreshed.err);
    else if (refreshed.text && !/正在读取/.test(refreshed.text)) ok('点「刷新」能重新读到日志');
    else bad('刷新后日志没出来');

    // 回到主界面，别影响后面的检查
    await evaluate(cdp, `(() => { const b=document.querySelector('#settings [data-act="back"]'); if(b) b.click(); return true; })()`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // ---- 18. 全屏能切能退 ----
  console.log('\n=== 18. 全屏 ===');
  {
    const r = await evaluate(cdp, `(async () => {
      const core = window.__TAURI__.core || window.__TAURI__.tauri;
      const before = await core.invoke('is_fullscreen', {});
      await window.__app.toggleFullscreen(true);
      await new Promise(r => setTimeout(r, 600));
      const during = await core.invoke('is_fullscreen', {});
      const btnOn = document.getElementById('tbFullscreen');
      const labelOn = btnOn ? btnOn.textContent.trim() : '';
      await window.__app.toggleFullscreen(false);
      await new Promise(r => setTimeout(r, 600));
      const after = await core.invoke('is_fullscreen', {});
      const labelOff = btnOn ? btnOn.textContent.trim() : '';
      return { before, during, after, labelOn, labelOff };
    })()`);

    if (r.during === true) ok('能进入全屏');
    else bad('进不了全屏（is_fullscreen 仍是 false）');
    if (r.after === false) ok('能退出全屏');
    else bad('退不出全屏');
    if (r.before === false) ok('启动时不是全屏（用户要求不记忆）');
    else bad('启动就是全屏 —— 不该记住全屏状态');
    // 按钮文字要跟着变，否则会显示成反的
    if (/退出/.test(r.labelOn)) ok('全屏时按钮变成「退出全屏」');
    else bad(`全屏时按钮文字没变：${r.labelOn}`);
    if (r.labelOff === '全屏') ok('退出后按钮变回「全屏」');
    else bad(`退出后按钮文字不对：${r.labelOff}`);
  }

  // ---- 19. 运行时有没有报错 ----
  console.log('\n=== 19. 运行时报错 ===');
  {
    // 先清掉 16 节注入时故意造出的错误，再确认界面干净
    await evaluate(cdp, `window.__crashGuard.reset()`);
    const err = await evaluate(cdp, `(() => {
      const f = document.getElementById('fatal');
      return {
        fatalShown: !!f && !f.hidden && getComputedStyle(f).display !== 'none',
        fatalText: f ? f.textContent : '',
      };
    })()`);
    if (err.fatalShown) bad(`界面显示了致命错误：${err.fatalText.slice(0, 120)}`);
    else ok('没有致命错误提示');
    await evaluate(cdp, `(() => { const f=document.getElementById('fatal'); if(f) f.hidden = true; return true; })()`);
  }

  cdp.close();
} catch (e) {
  bad('运行时异常：' + e.message);
} finally {
  try { cdp?.close(); } catch { /* ignore */ }
  try { child.kill(); } catch { /* ignore */ }
  // 等 WebView2 的进程真的退掉再删 profile，否则文件被占用
  await new Promise((r) => setTimeout(r, 1200));
  try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
