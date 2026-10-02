// 设置：跟具体工程无关的偏好，存在 localStorage。
// 分类：画布与操作 / 外观与主题 / 导出与保存 / 日志 / 关于。每一项都必须真的
// 接上了线，不留「有开关但没用」的摆设项；改动即时生效。

const LS = 'kts-builder.settings.v1';

/**
 * 设置项清单。type: bool | number | select。
 * showIf / disableIf 用来看依赖关系（比如网格间距只在开了网格时才有意义）。
 */
export const SECTIONS = [
  {
    id: 'canvas',
    label: '画布与操作',
    items: [
      {
        key: 'showGrid', type: 'bool', default: false,
        label: '显示背景网格',
        desc: '画布上画一层小方格，方便看清对齐关系。默认关闭。',
      },
      {
        key: 'gridSize', type: 'number', default: 20, min: 8, max: 100, step: 2, unit: 'px',
        label: '网格间距',
        desc: '方格的疏密。放大画布时间距会跟着一起放大。',
        showIf: (s) => s.showGrid,
      },
      {
        key: 'snapToGrid', type: 'bool', default: false,
        label: '拖动时吸附对齐',
        desc: '松开鼠标时把控件卡到最近的格点上，排布更整齐。',
      },
      {
        key: 'wheelSpeed', type: 'number', default: 10, min: 2, max: 30, step: 1, unit: '%',
        label: '滚轮缩放灵敏度',
        desc: '每滚一格放大/缩小的百分比。默认 10%。',
      },
      {
        key: 'defaultZoom', type: 'select', default: '100', unit: '',
        label: '新建画布的初始缩放',
        desc: '只影响之后新建的画布，不动你正在用的这张。',
        options: [['75', '75%'], ['100', '100%'], ['125', '125%'], ['150', '150%']],
      },
    ],
  },
  {
    id: 'appearance',
    label: '外观与主题',
    items: [
      {
        key: 'theme', type: 'select', default: 'light',
        label: '主题',
        desc: '「跟随系统」会跟着 Windows 的浅色/深色设置自动切换。',
        options: [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']],
      },
      {
        key: 'uiFontSize', type: 'number', default: 13, min: 11, max: 18, step: 1, unit: 'px',
        label: '界面字号',
        desc: '工具栏、控件库、参数面板的字号。',
      },
      {
        key: 'codeFontSize', type: 'number', default: 12.5, min: 10, max: 20, step: 0.5, unit: 'px',
        label: '代码预览字号',
        desc: '「代码预览」弹窗里代码的字号。',
      },
      {
        key: 'codeWrap', type: 'bool', default: false,
        label: '代码自动换行',
        desc: '关掉时过长的行会横向滚动（默认）。',
      },
    ],
  },
  {
    id: 'export',
    label: '导出与保存',
    items: [
      {
        key: 'exportDir', type: 'path', default: '',
        label: '默认导出目录',
        desc: '设好之后点「导出插件」直接写进去，不再每次都弹选择框。清空则恢复成每次询问。',
      },
      {
        key: 'revealAfterExport', type: 'bool', default: true,
        label: '导出成功后打开文件夹',
        desc: '导出完自动在资源管理器里定位到结果。',
      },
      {
        // 内部仍按毫秒存（store.autoSave 里直接用），界面按「秒」显示：
        // scale=1000 让 400ms 显示成 0.4 秒（第 15 轮用户要求单位是 s）。
        key: 'autosaveMs', type: 'number', default: 400, min: 100, max: 5000, step: 100,
        unit: 's', scale: 1000,
        label: '自动保存间隔（秒）',
        desc: '改动后多久写一次本地存档（防止意外关掉丢进度）。填 1 就是 1 秒后保存。',
      },
    ],
  },
  {
    id: 'log',
    label: '日志',
    items: [
      {
        key: 'logEnabled', type: 'bool', default: true,
        label: '记录日志',
        desc: '记录错误、警告、每次操作的耗时，以及崩溃时的完整现场'
          + '（堆栈 + 当时工程规模 + 崩溃前的操作轨迹）。'
          + '写在 exe 旁边的 logs 文件夹，按天分文件。默认开启 —— '
          + '出问题时日志已经在了，不用再复现一次。',
      },
      {
        key: '__logPath', type: 'info', label: '当前日志文件',
        desc: '今天的日志位置。也可以在下面的按钮里打开文件夹直接看。',
      },
      {
        key: '__logView', type: 'logview', label: '最近的日志',
        desc: '显示今天日志的末尾部分。',
      },
    ],
  },
  {
    id: 'about',
    label: '关于',
    items: [
      {
        key: '__version', type: 'info', label: '版本',
        desc: '当前构建的版本号。和 exe 属性里的版本一致。',
      },
      {
        key: '__license', type: 'info', label: '开源协议',
        desc: '本工具以 MIT 协议开源，可自由使用、修改、再分发。',
      },
      {
        key: '__author', type: 'info', label: '版权人',
        desc: 'Copyright (c) 2026 烛光',
      },
      {
        key: '__target', type: 'info', label: '代码生成目标',
        desc: 'ScriptAgent4MindustryExt 3.4.0（生成的 .kts 直接放进 scripts/ 用 /sa scan 加载）',
      },
      {
        // 第 15 轮：致谢名单（用户要求必须有）。
        // 按钮只显示「跳转 / 快捷注册」两个词 —— 完整 URL 单独列在下面。
        key: '__thanks', type: 'thanks', label: '致谢名单',
        desc: '本工具的开发过程得到了以下社区与平台的支持。',
        credit: 'EOCC 共创社区 - LLM 分发聚合平台提供模型协作',
        links: [
          { label: '跳转', url: 'https://ai.www.eocc.top' },
          { label: '快捷注册', url: 'https://ai.www.eocc.top/register?aff=kSPR' },
        ],
      },
    ],
  },
];

/** 所有设置项的扁平表：key -> 定义 */
export const ITEM_BY_KEY = (() => {
  const m = new Map();
  for (const s of SECTIONS) for (const it of s.items) m.set(it.key, it);
  return m;
})();

/**
 * 只读/非状态项：不进 state、不存盘、不可改。info 是纯展示一行值（版本、协议、
 * 日志路径），logview 是只读文本区。
 * 两类都必须排除在 defaults()/loadSettings() 之外，否则会被当成用户设置写进
 * localStorage，下次启动又读回来 —— 等于把日志内容也存了一份。
 */
export const isInfo = (it) => it.type === 'info' || it.type === 'logview' || it.type === 'thanks';

/**
 * 默认值（从 schema 推出来，不手写第二份）。
 * info 项不参与状态，否则会被写进 localStorage 又被当成用户设置读回来。
 */
export function defaults() {
  const o = {};
  for (const s of SECTIONS) for (const it of s.items) if (!isInfo(it)) o[it.key] = it.default;
  return o;
}

let state = defaults();
const listeners = [];

/** 读取并纠正非法值（旧版本残留、手改 localStorage 都挡得住） */
export function loadSettings() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { raw = null; }
  state = defaults();
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const def = ITEM_BY_KEY.get(k);
      if (!def) continue;               // 未知键（旧版本删掉的项）直接丢
      if (isInfo(def)) continue;        // 只读展示项不进状态
      state[k] = coerce(def, v);
    }
  }
  return state;
}

function coerce(def, v) {
  if (def.type === 'bool') return v === true;
  if (def.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return def.default;
    return Math.min(def.max, Math.max(def.min, n));
  }
  if (def.type === 'select') {
    return def.options.some(o => o[0] === String(v)) ? String(v) : def.default;
  }
  return typeof v === 'string' ? v : def.default;
}

function persist() {
  try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { /* 配额满了就算了 */ }
}

export function get(key) { return state[key]; }
export function all() { return { ...state }; }

/** 改一项：纠正 → 存盘 → 应用 → 通知 */
export function set(key, value) {
  const def = ITEM_BY_KEY.get(key);
  if (!def) return;
  const next = coerce(def, value);
  if (state[key] === next) return;
  state[key] = next;
  persist();
  apply();
  for (const fn of listeners) { try { fn(key, next); } catch (e) { console.error(e); } }
}

export function resetAll() {
  state = defaults();
  persist();
  apply();
  for (const fn of listeners) { try { fn('*', null); } catch (e) { console.error(e); } }
}

export function onChange(fn) { listeners.push(fn); }

// ---------------- 应用 ----------------

let systemMq = null;

/** 当前实际该用哪套配色（把「跟随系统」解析成一个具体值） */
export function resolvedTheme() {
  const t = state.theme;
  if (t === 'dark' || t === 'light') return t;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/** 把当前设置落到 DOM 上。启动时和每次改动后都会调。 */
export function apply() {
  const root = document.documentElement;

  root.dataset.theme = resolvedTheme();

  root.style.setProperty('--ui-font-size', state.uiFontSize + 'px');
  root.style.setProperty('--code-font-size', state.codeFontSize + 'px');

  document.body.classList.toggle('code-wrap', !!state.codeWrap);

  // 日志开关同步给 log.js。不直接 import log.js 是为了不引入耦合 ——
  // settings.js 被很多模块依赖，而测试会在没有 Tauri 的 node 里加载它。
  try {
    document.dispatchEvent(new CustomEvent('kts:log-enabled', { detail: !!state.logEnabled }));
  } catch (_) { /* node 里没有 CustomEvent，忽略 */ }

  // 「跟随系统」时监听系统切换；切到固定主题就不要再听了
  if (state.theme === 'system') {
    if (!systemMq && window.matchMedia) {
      systemMq = window.matchMedia('(prefers-color-scheme: dark)');
      systemMq.addEventListener('change', () => {
        document.documentElement.dataset.theme = resolvedTheme();
      });
    }
  } else if (systemMq) {
    systemMq = null;
  }
}
