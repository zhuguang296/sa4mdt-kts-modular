// 日志：把界面里发生的事写进 exe 旁边的 logs\kts-builder-YYYY-MM-DD.txt。
//
// 记什么：错误与警告（逐条，带模块/画布/控件）、耗时（按钮响应多久）、
// 崩溃（完整堆栈 + 工程规模 + 崩溃前的操作轨迹）。
// 不记什么：生成的 Kotlin 代码 —— 它占地方，且是「画布 + 参数」推出来的。
//
// 设计取舍：日志只在 Rust 侧落盘，这里只攒内容并发过去（前端不做文件 IO）；
// 同一毫秒内的多条日志合并成一次 IPC，逐条 invoke 会拖慢界面；写入失败
// 一律吞掉，只记在内存里备用；**操作轨迹只留内存，出错时才跟着崩溃记录落盘**。

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

/** 日志开关（设置里可关）。默认开。 */
let enabled = true;
/** 内存里的最近若干条，供「复制」和自检用；也是写盘失败时的兜底。 */
const recent = [];
const MAX_RECENT = 500;
/** 待发送缓冲：合并同一批日志，减少 IPC 次数 */
let pending = [];
let flushTimer = null;
/** 操作计时的栈：begin()/end() 配对 */
const timers = new Map();

/**
 * 操作轨迹：只进内存，不落盘。给每次点击都写一行盘太吵，所以只记在内存环形
 * 缓冲里，崩溃时由 crashguard 附到崩溃记录后面。容量 40 条。
 */
const breadcrumbs = [];
const MAX_BREADCRUMBS = 40;

let logPath = '';
let logDir = '';
let broken = false;

function core() {
  const t = typeof window !== 'undefined' ? window.__TAURI__ : null;
  return t ? (t.core || t.tauri) : null;
}

// 设置页改动「记录日志」开关时同步过来。绑定必须在**模块加载时**做，不能
// 放进异步的 initLog()：否则在它跑完之前用户改的设置会被丢掉。用事件解耦
// 是因为 settings.js 被很多模块依赖，不该反向依赖 log.js。
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('kts:log-enabled', (e) => { enabled = !!e.detail; });
}

/** 取日志文件路径（启动时调一次，供界面显示） */
export async function initLog() {
  try {
    const c = core();
    if (!c || !c.invoke) return { ok: false };
    logPath = await c.invoke('log_path', {});
    logDir = await c.invoke('log_dir_path', {});
    return { ok: true, path: logPath, dir: logDir };
  } catch (e) {
    broken = true;
    return { ok: false, error: String(e) };
  }
}

export function setLogEnabled(on) { enabled = !!on; }
export function isLogEnabled() { return enabled; }
export function getLogPath() { return logPath; }
export function getLogDir() { return logDir; }

/** 把缓冲里的日志一次性发出去 */
function flush() {
  flushTimer = null;
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  const c = core();
  if (!c || !c.invoke || broken) return;
  for (const item of batch) {
    // 逐条 invoke，但不再等结果 —— 顺序由 Rust 侧的追加写保证。
    // 失败就标记 broken，避免每条日志都白试一次。
    c.invoke('append_log', { level: item.level, message: item.message })
      .then((p) => { if (p) logPath = p; })
      .catch(() => { broken = true; });
  }
}

function enqueue(level, message) {
  if (!enabled) return;
  const lv = LEVELS.includes(level) ? level : 'INFO';
  recent.push({ at: new Date().toISOString(), level: lv, message });
  if (recent.length > MAX_RECENT) recent.shift();
  pending.push({ level: lv, message });
  // 合并 60ms 内的日志：一次操作会写好几条，逐条 IPC 会拖慢界面
  if (!flushTimer) flushTimer = setTimeout(flush, 60);
}

/** 记一条操作轨迹（只在内存，出错时随崩溃记录一起落盘） */
function crumb(text) {
  breadcrumbs.push(`${timeOfDay()} ${text}`);
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
}

/**
 * 把耗时补到最后一条轨迹上，而不是新加一条。一次点击会先 action()（记
 * 「点了什么」）再 begin().end()（记「花了多久」），各记一条的话 40 条的
 * 缓冲里一半都是重复内容。
 * 比较前要归一化：action 记的是 `按钮: fit`，计时的 key 是 `按钮 fit`，
 * 一个带冒号一个不带，直接比字符串匹配不上。仍对不上就新增一条。
 */
function crumbTimed(name, ms) {
  const stamp = timeOfDay();
  const last = breadcrumbs[breadcrumbs.length - 1];
  const norm = (s) => String(s).replace(/[:：\s]/g, '');
  if (last) {
    // last 形如 "11:01:03 按钮: fit" —— 去掉时间戳再比
    const body = last.replace(/^\d{2}:\d{2}:\d{2}\s/, '');
    if (norm(body) === norm(name)) {
      breadcrumbs[breadcrumbs.length - 1] = `${stamp} ${body}（${ms}ms）`;
      return;
    }
  }
  crumb(`${name}（${ms}ms）`);
}

function timeOfDay() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function now() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now());
}

// ---------------- 对外接口 ----------------

export const log = {
  debug: (m) => enqueue('DEBUG', String(m)),
  info: (m) => enqueue('INFO', String(m)),
  warn: (m) => enqueue('WARN', String(m)),
  error: (m) => enqueue('ERROR', String(m)),

  /**
   * 记一次「用户操作」。统一前缀 `操作:` 是为了事后好抓（工具里有几十个按钮）；
   * 同时进操作轨迹，崩溃时能看出「崩溃前在干什么」。
   */
  action: (name, detail) => {
    enqueue('INFO', detail ? `操作: ${name} — ${detail}` : `操作: ${name}`);
    crumb(detail ? `${name} — ${detail}` : String(name));
  },

  /**
   * 记一次操作耗时。用法：const t = log.begin('导出插件'); ... ; t.end('写了 12 个文件')
   * 同一名字可嵌套/重入，靠 Map 计数；end() 可不调 —— 那样只记轨迹、不写耗时。
   */
  begin(name) {
    const key = String(name);
    const start = now();
    timers.set(key, (timers.get(key) || 0) + 1);
    return {
      end(detail) {
        const n = (timers.get(key) || 1) - 1;
        if (n <= 0) timers.delete(key); else timers.set(key, n);
        const ms = Math.round(now() - start);
        const suffix = detail ? ` — ${detail}` : '';
        enqueue('INFO', `耗时: ${key} ${ms}ms${suffix}`);
        crumbTimed(key, ms);
        return ms;
      },
    };
  },

  /**
   * 把校验出的错误/警告逐条写进日志。只记「3 个错误」没用，要带上模块、
   * 画布、控件和具体说了什么。
   * @param {Array} problems validateProject 返回的 errors/warnings
   * @param {string} kind '错误' | '提醒'
   */
  problems: (problems, kind) => {
    if (!problems || !problems.length) return;
    for (const p of problems) {
      const lv = p.level === 'error' ? 'ERROR' : 'WARN';
      enqueue(lv, `校验${kind || (lv === 'ERROR' ? '错误' : '提醒')}: ${describeProblem(p)}`);
    }
    crumb(`校验：${problems.length} 个${kind || '问题'}`);
  },

  /**
   * 记录当时的工程规模 —— 崩溃时附在堆栈后面，对复现很关键。
   */
  snapshot(project) {
    if (!project) return '';
    try {
      const mods = project.modules || [];
      const canvases = mods.flatMap((m) => m.canvases || []);
      const nodes = canvases.reduce((n, c) => n + ((c.nodes || []).length), 0);
      const edges = canvases.reduce((n, c) => n + ((c.edges || []).length), 0);
      const active = canvases.find((c) => c.id === project.activeCanvasId);
      return `${mods.length} 个模块 / ${canvases.length} 个画布 / ${nodes} 个控件 / ${edges} 条连线`
        + (active ? `（当前画布：${active.title || active.file || active.id}）` : '');
    } catch (_) {
      return '';   // 工程对象已经损坏时也不能让记日志本身出错
    }
  },

  /** 最近的操作轨迹（崩溃记录用） */
  breadcrumbs: () => breadcrumbs.slice(),
  /** 轨迹的文本形式，崩溃时直接贴进日志 */
  breadcrumbText: () => (breadcrumbs.length
    ? breadcrumbs.map((b, i) => `  ${String(i + 1).padStart(2, '0')}. ${b}`).join('\n')
    : '  （这次运行还没记下操作）'),

  /** 内存里的最近日志（自检与「复制」用） */
  recent: () => recent.slice(),
  /** 立刻把缓冲发出去（关窗前调，避免丢掉最后几条） */
  flushNow: () => { if (flushTimer) { clearTimeout(flushTimer); } flush(); },
  reset: () => { recent.length = 0; pending = []; breadcrumbs.length = 0; },
};

/** 把一条校验问题写成一行能定位的文字 */
function describeProblem(p) {
  const where = [];
  if (p.module) where.push(`模块 ${p.module}`);
  if (p.canvasTitle) where.push(`画布「${p.canvasTitle}」`);
  else if (p.canvas) where.push(`画布 ${p.canvas}`);
  if (p.nodeId) where.push(`控件 ${p.nodeId}`);
  const prefix = where.length ? `[${where.join(' / ')}] ` : '';
  return prefix + String(p.message || '');
}

/** 记录启动信息 —— 版本、时间、日志位置，方便对上「哪次运行」 */
export async function logStartup(extra) {
  await initLog();
  log.info(`==== 应用启动 v${(extra && extra.version) || '?'} ====`);
  if (extra && extra.userAgent) log.debug(`userAgent: ${extra.userAgent}`);
  if (logPath) log.info(`日志文件: ${logPath}`);
  crumb('应用启动');
  log.flushNow();
}
