// 设置页：整窗切换的一个独立视图（不是弹窗）。左侧分类导航，右侧是该类下的
// 设置项。每改一项即时生效 + 立即存盘，没有「确定/取消」。//
// 用法：
//   const page = new SettingsPage({ root, onBack, onPickDir });
//   page.open();   // 显示
//   page.close();  // 回到主界面

import * as S from './settings.js';
import { VERSION } from './version.js';
import { log } from './log.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export class SettingsPage {
  constructor(opts = {}) {
    this.root = opts.root;          // 放设置页的容器
    this.onBack = opts.onBack || (() => {});
    this.onPickDir = opts.onPickDir || (async () => null);
    this.active = S.SECTIONS[0].id;
    this.open_ = false;
    // 「关于」里的版本/协议由外面注入（Rust 提供），拿不到就用网页里的兜底值
    this.appInfo = opts.appInfo || {};
    // 日志相关能力由外面注入（要调 IPC，settingspage 不该直接依赖 Tauri）
    this.logApi = opts.logApi || {};
    // 第 15 轮：致谢页的外链按钮 —— 用系统浏览器打开（Rust open_external）。
    // 注入式：非 Tauri 环境退化成 window.open。
    this.onOpenLink = opts.onOpenLink || null;
    this.toast = opts.toast || (() => {});
    this.logText = '';              // 当前显示的日志内容
    this.logLoaded = false;
  }

  /** 只读展示项的值。版本号优先用 Rust 报的编译期版本。 */
  infoValue(key) {
    const info = this.appInfo || {};
    // Rust 的 app_version 是编译期常量（和 exe 属性一致），最可信；浏览器里打开
    // ui/ 调试时拿不到，就退回构建时写进 version.js 的常量。
    if (key === '__version') return info.version || VERSION || '（未知）';
    if (key === '__license') return info.license || 'MIT License';
    if (key === '__author') return info.author || '烛光';
    if (key === '__target') return 'ScriptAgent4MindustryExt 3.4.0';
    if (key === '__logPath') return info.logPath || '（logs 文件夹）';
    return '';
  }

  /** 外部拿到版本后调它刷新，避免为了一个版本号重开设置页 */
  setAppInfo(info) {
    this.appInfo = Object.assign({}, this.appInfo, info || {});
    if (this.open_ && (this.active === 'about' || this.active === 'log')) this.render();
  }

  /** 切到「日志」页时拉一次日志内容 */
  async loadLog() {
    try {
      const text = await (this.logApi.read ? this.logApi.read() : Promise.resolve(''));
      this.logText = text || '';
    } catch (e) {
      this.logText = '（读取日志失败：' + (e && e.message ? e.message : e) + '）';
    }
    this.logLoaded = true;
    if (this.open_ && this.active === 'log') this.render();
  }

  isOpen() { return this.open_; }

  open() {
    this.open_ = true;
    this.root.hidden = false;
    this.logLoaded = false;
    this.render();
    // 日志页要读文件，不能卡住渲染，所以进来之后再拉
    if (this.active === 'log') this.loadLog();
  }

  close() {
    this.open_ = false;
    this.root.hidden = true;
  }

  render() {
    const sec = S.SECTIONS.find(s => s.id === this.active) || S.SECTIONS[0];
    const state = S.all();

    this.root.innerHTML = `
      <div class="set-head">
        <button class="set-back" data-act="back" title="回到画布">&larr; 返回</button>
        <div class="set-title">设置</div>
        <div class="set-head-spacer"></div>
        <button class="set-reset" data-act="reset" title="把所有设置恢复成出厂默认">恢复默认</button>
      </div>
      <div class="set-body">
        <nav class="set-nav">
          ${S.SECTIONS.map(s => `
            <button class="set-nav-item${s.id === this.active ? ' on' : ''}" data-sec="${esc(s.id)}">
              ${esc(s.label)}
            </button>`).join('')}
        </nav>
        <div class="set-pane">
          <h2 class="set-pane-title">${esc(sec.label)}</h2>
          ${sec.items.map(it => this.item(it, state)).join('')}
        </div>
      </div>`;

    this.bind();
  }

  item(it, state) {
    // 依赖项没满足就整条不显示（比灰着更好懂：灰着会让人以为坏了）
    if (it.showIf && !it.showIf(state)) return '';
    const v = state[it.key];
    let control = '';

    if (it.type === 'info') {
      // 只读展示（版本、协议、版权人）：没有控件，右边直接显示值；值可能来自
      // Rust（编译期版本号），拿不到就显示占位。
      control = `<div class="set-info" data-info="${esc(it.key)}">${esc(this.infoValue(it.key))}</div>`;
    } else if (it.type === 'thanks') {
      // 第 15 轮：致谢名单。链接文字本身是可读的，按钮只放「跳转 / 快捷注册」
      // （用户明确要求按钮只显示这两个词，不把长 URL 塞进按钮里）。
      const links = it.links || [];
      control = `
        <div class="set-thanks">
          <div class="set-thanks-line">${esc(it.credit || '')}</div>
          <div class="set-thanks-links">
            ${links.map((l) => `
              <button class="btn set-thanks-btn" data-link="${esc(l.url)}">${esc(l.label)}</button>
            `).join('')}
          </div>
          <div class="set-thanks-urls">
            ${links.map((l) => `<div class="set-thanks-url">${esc(l.url)}</div>`).join('')}
          </div>
        </div>`;
    } else if (it.type === 'bool') {
      control = `
        <label class="set-switch">
          <input type="checkbox" data-key="${esc(it.key)}" ${v ? 'checked' : ''}>
          <span class="set-switch-track"><span class="set-switch-thumb"></span></span>
          <span class="set-switch-text">${v ? '开启' : '关闭'}</span>
        </label>`;
    } else if (it.type === 'number') {
      // scale：存储值 ÷ scale = 界面显示值。用于「内部按毫秒存、界面按秒显示」
      // （第 15 轮用户要求：自动保存间隔的单位要是 s）。
      const sc = Number(it.scale) || 1;
      const min = Number(it.min) / sc, max = Number(it.max) / sc, step = Number(it.step) / sc;
      control = `
        <div class="set-number">
          <input type="range" data-key="${esc(it.key)}" data-kind="range" data-scale="${sc}"
                 min="${min}" max="${max}" step="${step}" value="${Number(v) / sc}">
          <input type="number" data-key="${esc(it.key)}" data-kind="num" data-scale="${sc}"
                 min="${min}" max="${max}" step="${step}" value="${Number(v) / sc}">
          <span class="set-unit">${esc(it.unit || '')}</span>
        </div>`;
    } else if (it.type === 'select') {
      control = `
        <select class="set-select" data-key="${esc(it.key)}">
          ${it.options.map(([val, label]) =>
            `<option value="${esc(val)}"${String(v) === String(val) ? ' selected' : ''}>${esc(label)}</option>`).join('')}
        </select>`;
    } else if (it.type === 'path') {
      control = `
        <div class="set-path">
          <input type="text" class="set-path-input" data-key="${esc(it.key)}"
                 value="${esc(v)}" placeholder="（未设置：每次导出都会问你）">
          <button class="btn" data-act="pickdir">选目录…</button>
          ${v ? '<button class="btn" data-act="cleardir">清空</button>' : ''}
        </div>`;
    } else if (it.type === 'logview') {
      // 只读日志文本区 + 一排操作按钮。空白时给一句人话，避免用户以为功能坏了。
      const body = this.logLoaded
        ? (this.logText || '（今天还没有日志 —— 用一会儿再回来看）')
        : '（正在读取…）';
      control = `
        <div class="set-log">
          <pre class="set-log-view" id="setLogView">${esc(body)}</pre>
          <div class="set-log-btns">
            <button class="btn" data-act="log-refresh">刷新</button>
            <button class="btn" data-act="log-open">打开日志文件夹</button>
            <button class="btn" data-act="log-copy">复制全部</button>
            <button class="btn danger" data-act="log-clear">清空今天的日志</button>
          </div>
        </div>`;
    }

    return `
      <div class="set-item">
        <div class="set-item-main">
          <div class="set-item-label">${esc(it.label)}</div>
          <div class="set-item-desc">${esc(it.desc)}</div>
        </div>
        <div class="set-item-ctl">${control}</div>
      </div>`;
  }

  bind() {
    const root = this.root;

    root.querySelector('[data-act="back"]').addEventListener('click', () => this.onBack());

    root.querySelector('[data-act="reset"]').addEventListener('click', () => {
      S.resetAll();
      this.render();
    });

    root.querySelectorAll('.set-nav-item').forEach((b) => {
      b.addEventListener('click', () => {
        this.active = b.dataset.sec;
        this.render();
        // 切到日志页才去读文件：读日志是 IPC + 磁盘操作，不该每次渲染都做一遍。
        if (this.active === 'log' && !this.logLoaded) this.loadLog();
      });
    });

    // 日志页的按钮
    const logRefresh = root.querySelector('[data-act="log-refresh"]');
    if (logRefresh) logRefresh.addEventListener('click', () => { this.logLoaded = false; this.render(); this.loadLog(); });
    const logOpen = root.querySelector('[data-act="log-open"]');
    if (logOpen) {
      logOpen.addEventListener('click', async () => {
        try {
          if (this.logApi.openFolder) await this.logApi.openFolder();
        } catch (e) { log.warn('打开日志文件夹失败: ' + e); }
      });
    }
    const logCopy = root.querySelector('[data-act="log-copy"]');
    if (logCopy) {
      logCopy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(this.logText || '');
          logCopy.textContent = '已复制';
          setTimeout(() => { logCopy.textContent = '复制全部'; }, 1500);
        } catch (e) { log.warn('复制日志失败: ' + e); }
      });
    }
    const logClear = root.querySelector('[data-act="log-clear"]');
    if (logClear) {
      logClear.addEventListener('click', async () => {
        try {
          if (this.logApi.clear) await this.logApi.clear();
          log.info('用户清空了今天的日志');
          log.flushNow();
          this.logText = '';
          this.render();
        } catch (e) { log.warn('清空日志失败: ' + e); }
      });
    }

    // 复选框
    root.querySelectorAll('input[type=checkbox][data-key]').forEach((el) => {
      el.addEventListener('change', () => {
        S.set(el.dataset.key, el.checked);
        this.render();   // 重绘，让依赖项（如网格间距）跟着出现/消失
      });
    });

    // 下拉
    root.querySelectorAll('select[data-key]').forEach((el) => {
      el.addEventListener('change', () => {
        S.set(el.dataset.key, el.value);
        this.render();
      });
    });

    // 数字：滑块和数字框互相同步。带 data-scale 的项（如自动保存间隔）
    // 界面上是「秒」，存进去要 × scale 还原成毫秒。
    const toStored = (el, shown) => String(Number(shown) * (Number(el.dataset.scale) || 1));
    root.querySelectorAll('input[type=range][data-key]').forEach((el) => {
      el.addEventListener('input', () => {
        S.set(el.dataset.key, toStored(el, el.value));
        const num = root.querySelector(`input[data-kind="num"][data-key="${el.dataset.key}"]`);
        if (num) num.value = el.value;
      });
    });
    root.querySelectorAll('input[data-kind="num"]').forEach((el) => {
      el.addEventListener('change', () => {
        S.set(el.dataset.key, toStored(el, el.value));
        this.render();
      });
    });

    // 路径
    root.querySelectorAll('.set-path-input').forEach((el) => {
      el.addEventListener('change', () => S.set(el.dataset.key, el.value.trim()));
    });
    const pick = root.querySelector('[data-act="pickdir"]');
    if (pick) {
      pick.addEventListener('click', async () => {
        const p = await this.onPickDir();
        if (p) { S.set('exportDir', p); this.render(); }
      });
    }
    const clr = root.querySelector('[data-act="cleardir"]');
    if (clr) clr.addEventListener('click', () => { S.set('exportDir', ''); this.render(); });

    // 致谢名单的外链（跳转 / 快捷注册）——一律交给系统浏览器打开。
    // 没有注入 openExternal（比如非 Tauri 环境）时退化成 window.open。
    root.querySelectorAll('.set-thanks-btn[data-link]').forEach((b) => {
      b.addEventListener('click', async () => {
        const url = b.dataset.link;
        try {
          if (this.onOpenLink) await this.onOpenLink(url);
          else window.open(url, '_blank', 'noopener');
          log.action('打开外链: ' + url);
        } catch (e) {
          log.warn('打开外链失败: ' + e);
          this.toast && this.toast('打不开浏览器，请手动访问：' + url, 'warn');
        }
      });
    });
  }
}
