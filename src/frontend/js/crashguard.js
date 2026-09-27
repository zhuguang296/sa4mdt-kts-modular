// 全局防崩溃：把任何未捕获的错误变成「看得懂 + 有出路」的提示，绝不留下
// 「点哪个按钮都弹报错 / 界面卡死」的状态。
//
// 单独一个文件的两个原因：必须**最先**加载（在 App 之前），否则 App 初始化
// 时抛的错拦不到；兜底逻辑要能在 App 已经坏掉时独立工作，所以不 import 业务
// 模块，只用原生 DOM。
//
// 设计要点：同一个错只报一次（避免刷屏盖死界面）；报错框给三条出路（继续用 /
// 另存工程抢救数据 / 复制详细信息）；出过错后打开「降级模式」，后续未捕获错误
// 只记进日志，不再弹窗。

import { log, getLogPath } from './log.js';

const MAX_SAME = 3;          // 同一个错误最多提示几次
const seen = new Map();      // message -> count
let fatalEl = null;
let boxShown = false;

// 出错记录。三个入口（window error / unhandledrejection / reportError）都往
// 这里写，所以它是一份完整的「这次运行出了哪些错」；测试和「复制详细信息」都靠它。
// 记录必须放在 handleError 里做，而不是各监听器各自 push —— 否则 reportError
// 这条路（按钮/render 里被 catch 的异常）就不会被记下来。
const errorLog = [];

/** 把任意值变成一行能读的文字 */
function describe(v) {
  if (v == null) return String(v);
  if (typeof v === 'string') return v;
  if (v instanceof Error) return (v.stack || (v.name + ': ' + v.message) || String(v));
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** 规范化：去掉行号列号这种每次都不同的部分，好做去重 */
function normalize(msg) {
  return String(msg)
    .replace(/:\d+:\d+/g, ':#:#')
    .replace(/at .*?\(.*?\)/g, '')
    .slice(0, 400);
}

function ensureFatalEl() {
  if (fatalEl && fatalEl.isConnected) return fatalEl;
  fatalEl = document.getElementById('fatal');
  if (!fatalEl) {
    fatalEl = document.createElement('div');
    fatalEl.id = 'fatal';
    document.body.appendChild(fatalEl);
  }
  return fatalEl;
}

/** 用安全的 DOM API 构建报错框（不用 innerHTML 拼错误文本，避免二次注入） */
function showFatal(title, detail) {
  const el = ensureFatalEl();
  el.textContent = '';
  el.hidden = false;
  boxShown = true;

  const head = document.createElement('div');
  head.className = 'fatal-head';
  const strong = document.createElement('b');
  strong.textContent = '⚠ ' + title;
  head.appendChild(strong);

  const pre = document.createElement('pre');
  pre.className = 'fatal-detail';
  pre.textContent = String(detail).slice(0, 2000);

  const note = document.createElement('div');
  note.className = 'fatal-note';
  note.textContent = '你的画布内容还在。可以「另存工程」把进度存下来，再重启工具。';

  // 告诉用户日志在哪 —— 出问题时他只要把这个文件发过来就够了
  const logLine = document.createElement('div');
  logLine.className = 'fatal-note fatal-log';
  logLine.textContent = logLineText();

  const bar = document.createElement('div');
  bar.className = 'fatal-btns';

  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };

  bar.appendChild(mk('关掉提示继续用', () => { el.hidden = true; boxShown = false; }));
  bar.appendChild(mk('另存工程', () => {
    try {
      if (window.__app && typeof window.__app.saveProject === 'function') {
        window.__app.saveProject();
      } else if (window.__app && typeof window.__app.act === 'function') {
        window.__app.act('save');
      } else {
        const btn = document.querySelector('#toolbar [data-act="save"]');
        if (btn) btn.click();
      }
    } catch (e) {
      pre.textContent += '\n（另存也失败了：' + describe(e) + '）';
    }
  }));
  const copyBtn = mk('复制详细信息', () => {
    // 「复制」要带上这次运行里所有错误，只复制当前这一条信息就不完整了。
    const lines = errorLog.map((x, i) =>
      `#${i + 1} [${x.kind}]${x.count > 1 ? ` (×${x.count})` : ''} ${x.detail}`);
    const text = `KTS 插件工坊 —— 错误记录\n${title}\n\n${lines.join('\n\n')}`;
    try {
      navigator.clipboard.writeText(text);
      const old = copyBtn.textContent;
      copyBtn.textContent = `已复制 ${errorLog.length} 条`;
      setTimeout(() => { copyBtn.textContent = old; }, 1500);
    } catch {
      // 剪贴板不可用就选中文字让用户自己 Ctrl+C
      const r = document.createRange();
      r.selectNodeContents(pre);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  });
  bar.appendChild(copyBtn);
  bar.appendChild(mk('隐藏', () => { el.hidden = true; boxShown = false; }));
  // 「打开日志文件夹」—— 用户不用自己去翻 exe 目录。
  // 路径是启动时就问回来的；万一这次还没拿到，按钮点了也会兜住。
  bar.appendChild(mk('打开日志文件夹', () => {
    const p = getLogPath();
    if (!p) return;
    try {
      const core = window.__TAURI__.core || window.__TAURI__.tauri;
      core.invoke('reveal_in_explorer', { path: p });
    } catch (_) { /* 打不开就算了，路径已经写在上面 */ }
  }));

  el.append(head, pre, note, logLine, bar);
  return el;
}

/** 统一的错误处理入口。所有错误最终都走这里 —— 记录、控制台、落盘、提示一处不少。 */
function handleError(kind, err) {
  const detail = describe(err);
  const key = normalize(detail);
  const n = (seen.get(key) || 0) + 1;
  seen.set(key, n);

  // 1. 记录（无论如何都记，供测试与「复制详细信息」用）
  errorLog.push({ kind, detail, count: n, at: new Date().toISOString() });

  // 2. 控制台永远记全，方便 F12 排查
  console.error('[' + kind + ']', err);

  // 3. 落盘到 exe 旁边的 logs\kts-builder-YYYY-MM-DD.txt（异步、失败也不影响用户）
  writeToLog(kind, detail, n);

  // 4. 同一个错误只打扰几次；已经被反复命中就不再弹（但上面三步照做）
  if (n > MAX_SAME) return;

  const title = kind === 'promise' ? '有一步操作没做完' : '出了个问题';
  const suffix = n > 1 ? `（第 ${n} 次，同样的错误只会提示 ${MAX_SAME} 次）` : '';
  showFatal(title + suffix, detail);
}

// ---------------- 落盘 ----------------
// 崩溃日志和普通日志写进**同一个** .txt，排查时不用在两处对时间。真正的写入
// 在 log.js 里（它负责合并、限流、失败兜底）。

/**
 * 把一条错误写进日志 —— 带完整现场。现场信息（breadcrumb）平时只在内存里转，
 * 只有真出错时才把最近 40 步打印出来。
 * 用 log.error 而不是自己 invoke：那条路径已有「写失败不抛异常」的兜底，且会
 * 顺手进内存缓冲 —— 磁盘写不进去时「复制详细信息」仍拿得到内容。
 */
function writeToLog(kind, detail, count) {
  try {
    // 现场快照：工程规模 + 崩溃前用户干了什么。
    // 两者都各自 try/catch —— 崩溃处理路径里绝不能再因为取信息而二次出错。
    let snapshot = '';
    try {
      if (window.__app && typeof window.__app.captureSnapshot === 'function') {
        snapshot = window.__app.captureSnapshot() || '';
      }
    } catch (_) { /* 工程对象已损坏时就算了，堆栈才是主要线索 */ }

    let trail = '';
    try {
      trail = log.breadcrumbText ? log.breadcrumbText() : '';
    } catch (_) { /* 同上 */ }

    const head = count > 1 ? `[${kind}] (第 ${count} 次)\n` : `[${kind}]\n`;
    const parts = [head + detail];
    if (snapshot) parts.push(`当时的工程：${snapshot}`);
    if (trail) parts.push(`崩溃前的操作：\n${trail}`);

    log.error(parts.join('\n'));
    log.flushNow();
  } catch (_) {
    /* 日志本身出问题也不该影响用户 */
  }
}

/** 报错框里那行「已记到日志：…」的当前内容 */
function logLineText() {
  const p = (typeof getLogPath === 'function' ? getLogPath() : '') || '';
  if (p) return '已记到日志：' + p;
  return '（日志写在 exe 旁边的 logs 文件夹里）';
}

/** 若报错框正开着，把日志那行刷新成最新状态 */
function refreshLogLine() {
  const el = document.querySelector('#fatal .fatal-log');
  if (el) el.textContent = logLineText();
}

/**
 * 启动时先把日志路径取回来，不能等第一次出错才去问 —— 那时报错框已经建好，
 * 用户第一眼看到的会是「（正在写日志…）」，而第一次出错最需要看到路径。
 */
export function primeCrashLog() {
  // 路径的获取由 log.js 负责（它同时服务普通日志和崩溃日志）
  try { refreshLogLine(); } catch (_) { /* 界面还没建好就算了 */ }
}

/** 日志文件的路径（供界面显示） */
export function crashLogPath() {
  return getLogPath();
}

/** 装上全局拦截。重复调用是安全的。 */
export function installCrashGuard() {
  window.addEventListener('error', (e) => {
    // 资源加载失败（img/script）没有 error 对象，单独描述
    if (e.target && e.target !== window && e.target.tagName) {
      handleError('资源', `加载失败：<${e.target.tagName.toLowerCase()}> ${e.target.src || e.target.href || ''}`);
      return;
    }
    handleError('error', e.error || e.message || e);
  });

  window.addEventListener('unhandledrejection', (e) => {
    handleError('promise', e.reason || e);
  });

  window.__crashGuard = {
    // 直接暴露同一个数组实例，测试读到的一定是最新的
    errors: errorLog,
    // 方便测试断言「记录的是哪几条」
    messages: () => errorLog.map((x) => x.detail),
    shown: () => boxShown,
    reset: () => { seen.clear(); boxShown = false; errorLog.length = 0; },
  };

  return true;
}

/** 供业务代码主动上报（比如 catch 到不该发生的错误） */
export function reportError(where, err) {
  handleError('catch@' + where, err);
}

export { showFatal };
