// 导出：把生成的文件表写到磁盘
// - Tauri 桌面版：调用 Rust IPC，直接写目录 + 可选打开资源管理器
// - 浏览器版：退路为下载 ZIP

import { generatePlugin } from './generate.js';
import { makeZip, downloadBytes, downloadText } from './zip.js';

/** 是否运行在 Tauri 里 */
export function isTauri() {
  return !!(window.__TAURI__ && (window.__TAURI__.core || window.__TAURI__.tauri));
}

function invoke(cmd, args) {
  const core = window.__TAURI__.core || window.__TAURI__.tauri;
  return core.invoke(cmd, args);
}

export const api = {
  pickFolder: (title) => invoke('pick_folder', { title }),
  pickSaveFile: (title, defaultName) => invoke('pick_save_file', { title, defaultName }),
  pickOpenFile: (title, ktsOnly) => invoke('pick_open_file', { title, ktsOnly: !!ktsOnly }),
  exportPlugin: (outDir, files) => invoke('export_plugin', { outDir, files }),
  readTextFile: (path) => invoke('read_text_file', { path }),
  writeTextFile: (path, content) => invoke('write_text_file', { path, content }),
  reveal: (path) => invoke('reveal_in_explorer', { path }),
  appDir: () => invoke('app_dir'),
  /** 用系统浏览器打开 http(s) 链接（致谢页的「跳转 / 快捷注册」） */
  openExternal: (url) => invoke('open_external', { url }),
  /** 扫描 exe 旁边 scripts\ 里的 .kts（首次进入的示例插件组） */
  scanScripts: () => invoke('scan_scripts', {}),
  /** 版本号（Rust 编译期常量，来自仓库根 VERSION → Cargo.toml） */
  appVersion: () => invoke('app_version', {}),
  appLicense: () => invoke('app_license', {}),
  appAuthor: () => invoke('app_author', {}),
  // ---- 日志（exe 旁边的 logs\kts-builder-YYYY-MM-DD.txt）----
  logPath: () => invoke('log_path', {}),
  logDirPath: () => invoke('log_dir_path', {}),
  appendLog: (level, message) => invoke('append_log', { level, message }),
  readLog: (maxBytes) => invoke('read_log', { maxBytes }),
  clearLog: () => invoke('clear_log', {}),
  logShutdown: () => invoke('log_shutdown', {}),
  // ---- 全屏 ----
  setFullscreen: (on) => invoke('set_fullscreen', { on }),
  isFullscreen: () => invoke('is_fullscreen', {}),
  /**
   * 告诉 Rust 侧「这次关闭已经问过用户了，可以真的关」。Rust 收到 CloseRequested
   * 时会 prevent_close() 再反过来让前端弹询问框；被拦下的那一次不会被系统重试，
   * 所以前端问完必须回一个信号，否则窗口永远关不掉。
   */
  confirmClose: () => invoke('confirm_close', {}),
  /**
   * 告诉 Rust 侧「前端活着，正在处理关窗询问」。Rust 那边有个 2 秒看门狗：万一
   * 前端脚本坏了（window.__app 不存在、或处理时抛异常），prevent_close 之后没人
   * 回应，窗口就彻底关不掉了。这个 ack 给看门狗报平安 —— 必须在**弹框之前**调，
   * 这样用户盯着询问框想多久都不会被误判成卡死。
   */
  closeGuardAck: () => invoke('close_guard_ack', {}),
};

/**
 * 导出插件
 * @returns {{ok:boolean, mode:'dir'|'zip', paths?:string[], zipPath?:string, error?:string}}
 */
export async function exportPlugin(project, opts = {}) {
  const gen = generatePlugin(project);
  const files = gen.files.map(f => ({ path: f.path, content: f.content }));
  const pluginDirName = pluginFolderName(project);

  if (!files.length) {
    return { ok: false, error: '没有任何可以导出的内容（工程里没有画布）' };
  }

  // ---- 桌面版：直接写目录 ----
  if (isTauri() && opts.outDir) {
    try {
      const paths = await api.exportPlugin(opts.outDir, files);
      return { ok: true, mode: 'dir', paths, gen };
    } catch (e) {
      return { ok: false, error: '写入失败：' + (e && e.message ? e.message : String(e)) };
    }
  }

  if (isTauri() && !opts.outDir) {
    try {
      const dir = await api.pickFolder('选择导出到哪里（会在这里创建 ' + pluginDirName + ' 文件夹）');
      if (!dir) return { ok: false, error: '已取消' };
      const paths = await api.exportPlugin(dir, files);
      return { ok: true, mode: 'dir', paths, gen, outDir: dir };
    } catch (e) {
      return { ok: false, error: '导出失败：' + (e && e.message ? e.message : String(e)) };
    }
  }

  // ---- 浏览器退路：下载 ZIP ----
  try {
    const zip = makeZip(files);
    downloadBytes(zip, pluginDirName + '.zip');
    return { ok: true, mode: 'zip', gen };
  } catch (e) {
    return { ok: false, error: '打包失败：' + e.message };
  }
}

export function pluginFolderName(project) {
  const m = project.modules[0];
  return (m && m.id) || 'plugin';
}

/** 导出单个画布的代码为 .kts 文件（浏览器退路） */
export function exportSingleFile(fileName, content) {
  downloadText(content, fileName);
}

export async function saveProjectFile(project, suggestName) {
  const text = JSON.stringify(project, null, 2);
  if (isTauri()) {
    const p = await api.pickSaveFile('保存工程文件', suggestName || 'my-plugin.saproj');
    if (!p) return { ok: false, error: '已取消' };
    await api.writeTextFile(p, text);
    return { ok: true, path: p };
  }
  downloadText(text, suggestName || 'my-plugin.saproj');
  return { ok: true, mode: 'download' };
}

export async function openProjectFile() {
  if (isTauri()) {
    const p = await api.pickOpenFile('打开工程文件', false);
    if (!p) return { ok: false, error: '已取消' };
    const text = await api.readTextFile(p);
    return { ok: true, text, path: p };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.saproj,.json';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return resolve({ ok: false, error: '已取消' });
      resolve({ ok: true, text: await f.text() });
    };
    input.click();
  });
}

const KTS_EXT = /\.kts$/i;

/**
 * 从代码还原：只能选 .kts 文件（选择器过滤 + 读完后校验后缀双保险）。
 * @returns {{ok:boolean, text?:string, path?:string, error?:string}}
 */
export async function openKtsFile() {
  if (isTauri()) {
    const p = await api.pickOpenFile('选择要还原的 .kts 文件', true);
    if (!p) return { ok: false, error: '已取消' };
    if (!KTS_EXT.test(p)) return { ok: false, error: `只能导入 .kts 文件（你选的是：${basename(p)}）` };
    const text = await api.readTextFile(p);
    return { ok: true, text, path: p };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.kts';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return resolve({ ok: false, error: '已取消' });
      if (!KTS_EXT.test(f.name)) return resolve({ ok: false, error: `只能导入 .kts 文件（你选的是：${f.name}）` });
      resolve({ ok: true, text: await f.text() });
    };
    input.click();
  });
}

function basename(p) {
  const parts = String(p).replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}
