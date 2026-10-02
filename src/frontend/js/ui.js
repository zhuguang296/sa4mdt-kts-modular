// 界面主干：工具栏 / 画布标签页 / 控件库 / 参数面板 / 代码预览 / 状态栏 / 弹窗
import * as store from './store.js';
import * as M from './model.js';
import { defOf, catalogFlat, searchDefs, CATEGORY_LABEL } from './catalog/index.js';
import { TEMPLATES } from './catalog/templates.js';
import { CanvasView } from './canvas.js';
import { Inspector } from './inspector.js';
import { FileManager } from './filemgr.js';
import { highlightWithLines } from './highlight.js';
import { validateProject, selfCheck } from './validate.js';
import { generatePlugin } from './generate.js';
import * as exporter from './export.js';
import { parseKts, looksLikeOurKts } from './anchor.js';
import * as ktsimport from './ktsimport.js';
import * as S from './settings.js';
import { SettingsPage } from './settingspage.js';
import { HomePage } from './home.js';
import { reportError } from './crashguard.js';
import { log } from './log.js';

// IPC 命令的统一入口：是 exporter.api，不是 exporter 本身 ——
// 文件 IO / 日志 / 全屏都挂在 api 对象里（export.js 里 `export const api = {...}`）。
const api = exporter.api;

// 代码生成超过这个毫秒数就记一条 WARN
const SLOW_RENDER_MS = 50;

// 界面图标统一用内联 SVG（不用 emoji）。颜色继承 currentColor。
const IC = {
  dot: '<svg viewBox="0 0 8 8" class="ic-dot" width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="3.2" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 12 12" class="ic-check" width="12" height="12" aria-hidden="true"><path d="M2 6.5 4.8 9 10 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 12 12" class="ic-cross" width="12" height="12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  bang: '<svg viewBox="0 0 12 12" class="ic-bang" width="12" height="12" aria-hidden="true"><path d="M6 2v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="6" cy="9.6" r="1" fill="currentColor"/></svg>',
  warn: '<svg viewBox="0 0 16 16" class="ic-warn" width="14" height="14" aria-hidden="true"><path d="M8 1.5 15 14.5H1z" fill="currentColor"/><path d="M7.2 5.5h1.6v4.4H7.2z" fill="#fff"/><circle cx="8" cy="12" r="1" fill="#fff"/></svg>',
  chev: '<svg viewBox="0 0 10 10" class="ic-chev" width="10" height="10" aria-hidden="true"><path d="M2.2 3 5 6.2 7.8 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export class App {
  constructor() {
    this.el = {
      toolbar: document.getElementById('toolbar'),
      tabs: document.getElementById('tabs'),
      lib: document.getElementById('lib'),
      libSearch: document.getElementById('libSearch'),
      canvas: document.getElementById('canvas'),
      inspector: document.getElementById('inspector'),
      inspDialog: document.getElementById('inspDialog'),
      filemgr: document.getElementById('filemgr'),
      status: document.getElementById('status'),
      modal: document.getElementById('modal'),
      app: document.getElementById('app'),
      settings: document.getElementById('settings'),
      home: document.getElementById('home'),
    };
    this.canvasView = new CanvasView(this.el.canvas);
    this.inspector = new Inspector(this.el.inspector);
    // 第 15 轮：右栏 = 插件文件管理器（每个画布 = 一个 .kts 文件）
    this.fileManager = new FileManager({
      root: this.el.filemgr,
      onNewCanvas: () => this.newCanvasFromMgr(),
      onRenameCanvas: (id) => this.renameCanvasFromMgr(id),
      onDeleteCanvas: (id) => this.deleteCanvasFromMgr(id),
      onDuplicateCanvas: (id) => this.duplicateCanvasFromMgr(id),
      onToast: (m, k) => this.toast(m, k),
    });
    this.problems = { errors: [], warnings: [] };
    this.toastTimer = null;
    this.lastGen = null;
    this.inspDialogOpen = false;   // 控件参数弹窗开着吗
    this.settingsPage = new SettingsPage({
      root: this.el.settings,
      onBack: () => this.closeSettings(),
      onPickDir: async () => {
        try { return await exporter.api.pickFolder('选择默认导出目录'); } catch (_) { return null; }
      },
      // 版本/协议/版权人由 Rust 报（编译期常量），保证和 exe 属性一致
      appInfo: { version: window.__APP_VERSION__ || '' },
      // 日志页要读文件/开文件夹/清空，这些都得走 IPC。
      // 注入而不是让 settingspage 直接依赖 Tauri：设置页在浏览器里也能看。
      logApi: {
        read: () => (exporter.isTauri && exporter.isTauri()
          ? exporter.api.readLog(256 * 1024) : Promise.resolve('')),
        openFolder: () => {
          const p = exporter.api.logPath ? exporter.api.logPath() : Promise.resolve('');
          return p.then((path) => (path ? exporter.api.reveal(path) : null));
        },
        clear: () => (exporter.isTauri && exporter.isTauri()
          ? exporter.api.clearLog() : Promise.resolve()),
      },
      // 致谢页的「跳转 / 快捷注册」：交给系统浏览器（Rust open_external）
      onOpenLink: (url) => {
        if (exporter.isTauri && exporter.isTauri() && exporter.api.openExternal) {
          return exporter.api.openExternal(url);
        }
        window.open(url, '_blank', 'noopener');
        return Promise.resolve();
      },
      toast: (msg, kind) => this.toast(msg, kind),
    });
    this.homePage = new HomePage({
      root: this.el.home,
      onOpenCanvas: (modId) => this.enterModule(modId),
      onSettings: () => this.openSettings(),
      onOpenProject: () => this.openProject(),
      onImportKts: () => this.importKtsDialog(),
      onNewProject: async () => { if (await this.confirmUnsaved('新建工程')) this.newProjectDialog(); },
      onDeleteModule: (modId) => this.deleteModuleFromHome(modId),
      onRenameModule: (modId) => this.renameModuleFromHome(modId),
      // 第 15 轮：新建插件组也走弹窗（填名字 + 选模板）
      onNewModule: () => this.newModuleFromHome(),
    });
    this.loadAppInfo();
  }

  /**
   * 取一次版本号等「关于」信息。异步、不阻塞启动；拿不到就显示「未知」。
   */
  async loadAppInfo() {
    if (!exporter.isTauri || !exporter.isTauri()) return;
    try {
      // 别把这个变量命名成 api —— 那会遮住模块顶部的 api 别名。
      const call = exporter.api;
      const [version, license, author, logPath] = await Promise.all([
        call.appVersion ? call.appVersion() : Promise.resolve(''),
        call.appLicense ? call.appLicense() : Promise.resolve(''),
        call.appAuthor ? call.appAuthor() : Promise.resolve(''),
        call.logPath ? call.logPath().catch(() => '') : Promise.resolve(''),
      ]);
      window.__APP_VERSION__ = version;
      this.settingsPage.setAppInfo({ version, license, author, logPath });
    } catch (_) { /* 版本拿不到不影响使用 */ }
  }

  start() {
    // 设置要先读并 apply，否则第一帧会用浅色闪一下再变深色
    S.loadSettings();
    S.apply();
    S.onChange(() => this.canvasView.applyGrid());

    store.loadUiPrefs();
    store.initProject();
    this.bindToolbar();
    this.bindLibrary();
    this.bindGlobalKeys();
    this.bindInspDialog();

    // 第 17 轮：单击控件只选中（不弹窗），**双击**才弹出「控件设置」窗。
    this.canvasView.onSelect = (id) => { this.selectNode(id); };
    this.canvasView.onOpenInspector = (id) => { this.openNodeInspector(id); };
    this.canvasView.onToast = (m, k, t) => this.toast(m, k, t);
    this.canvasView.onZoom = (z) => this.renderZoomBadge(z);
    // 连线失败：除了 toast，右侧面板也要说明为什么不能连
    this.canvasView.onConnectError = (msg) => this.inspector.showConnectError(msg);
    this.inspector.onChange = () => { this.refresh(); };
    this.inspector.onCanvasRefresh = () => { this.canvasView.render(); };

    store.on((what) => {
      // 'props' 只改参数值：绝不能整体重绘，否则右侧输入框会失去焦点
      if (what === 'props') {
        this.canvasView.render();   // 只更新画布上节点里的参数摘要
        this.refresh();             // 重新生成 + 刷新预览/状态栏
        return;
      }
      // 'moved'：只有 x/y 变了，生成结果不受影响，所以只重算「未保存」标记
      if (what === 'moved') {
        this.renderStatus();
        return;
      }
      if (what === 'load' || what === 'canvas' || what === 'node' || what === 'edge' || what === 'module') {
        this.renderAll();
      }
      if (what === 'load' || what === 'canvas') {
        this.inspector.show(null);
      }
      // 首页开着时，插件组列表（名字/数量/当前项）也要跟着变
      if (this.homePage) this.homePage.refresh();
    });

    this.renderAll();
    // 启动进首页，而不是直接进画布：先让用户选/建插件组。
    // （以前这里弹一个「新建/打开/模板」的欢迎弹窗，现在整件事都归首页管。）
    this.openHome();
    // 第 15 轮：第一次进来（本地没有任何存档）时，摆一个「示例插件组」出来，
    // 让新用户一进来就有东西看、能点开研究，而不是面对一张空画布。
    // 不阻塞首屏：先让首页显示出来，再异步去扫 scripts 目录。
    this.maybeAddSamples();
  }

  /**
   * 首次进入：把 exe 旁边 `scripts\` 里的真实插件做成「示例插件组」。
   *
   * 每个示例都必须是**控件画布**（用户明确要求：要让玩家直观理解怎么工作的），
   * 所以：
   *   - 有锚点的（本工具导出的脚本）→ parseKts 精确还原；
   *   - 手写脚本 → ktsimport 的保守识别器翻成画布（标注「自动解析」）；
   *   - scripts 目录不存在 → 用内置模板兜底，同样摆成示例插件组。
   * 只在**首次**做（本地存档为空），之后不再打扰。
   */
  async maybeAddSamples() {
    try {
      if (localStorage.getItem('kts-builder.samples.v1')) return;   // 已经摆过
      if (store.store.project.modules.length > 1) return;           // 用户已经有多个插件组了
      const first = store.store.project.modules[0];
      const firstEmpty = first && (first.canvases || []).every(c => !c.nodes.length);
      const isFresh = (store.store.project.modules.length === 1) && firstEmpty
        && (first.canvases || []).length <= 1 && !localStorage.getItem('kts-builder.project.v1');
      if (!isFresh) return;

      const samples = await this.collectSamples();
      if (!samples.length) return;
      this.buildSampleModule(samples);
      localStorage.setItem('kts-builder.samples.v1', '1');
      this.homePage.refresh();
      log.action(`首次进入：已生成示例插件组（${samples.length} 个示例）`);
    } catch (e) {
      log.warn('生成示例插件组失败: ' + e);   // 示例只是锦上添花，失败不打扰用户
    }
  }

  /**
   * 收集示例：优先读 exe 旁边的 scripts\；读不到就用内置模板。
   * @returns {Promise<Array<{title:string, canvas:object}>>}
   */
  async collectSamples() {
    const out = [];
    let scan = null;
    try {
      if (exporter.isTauri && exporter.isTauri() && exporter.api.scanScripts) {
        scan = await exporter.api.scanScripts();
      }
    } catch (e) { log.warn('扫描 scripts 目录失败: ' + e); }

    if (scan && scan.files && scan.files.length) {
      // 读文本（并发上限 4，避免一次性打开太多文件）
      const files = [];
      for (let i = 0; i < scan.files.length; i += 4) {
        const chunk = scan.files.slice(i, i + 4);
        const texts = await Promise.all(chunk.map(async (f) => {
          try { return { ...f, text: await exporter.api.readTextFile(f.path) }; }
          catch (_) { return null; }
        }));
        for (const t of texts) if (t && t.text) files.push(t);
      }
      const picked = ktsimport.pickSamples(files, 12);
      for (const f of picked) {
        try {
          // 本工具导出的脚本：锚点精确还原（内容和参数都回得来）
          if (looksLikeOurKts(f.text)) {
            const p = parseKts(f.text);
            if (p.ok && p.canvas.nodes.length) {
              p.canvas.title = f.name.replace(/\.kts$/i, '');
              out.push({ title: p.canvas.title, canvas: p.canvas, from: f.name });
              continue;
            }
          }
          // 手写脚本：保守识别成控件画布
          const r = ktsimport.ktsSourceToCanvas(f.text, f.name);
          out.push({ title: f.name.replace(/\.kts$/i, ''), canvas: r.canvas, from: f.name });
        } catch (e) { log.warn('解析示例失败 ' + f.name + ': ' + e); }
      }
    }

    // scripts 里没凑够（或没有该目录）：用内置示例补齐到 10 个
    // （用户要求「可以选取 10-12 个事例」）
    if (out.length < 10) {
      const used = new Set(out.map(o => o.title));
      for (const s of ktsimport.builtinSamples(12)) {
        if (out.length >= 10) break;
        if (used.has(s.title)) continue;
        out.push({ title: s.title, canvas: s.canvas, from: '内置示例' });
        used.add(s.title);
      }
    }
    // 还是不够（理论上不会）：再拿模板凑
    if (out.length < 10) {
      const used = new Set(out.map(o => o.title));
      for (const t of TEMPLATES) {
        if (out.length >= 10) break;
        if (used.has(t.title)) continue;
        try {
          const b = t.build();
          if (b && b.canvas) {
            b.canvas.title = t.title;
            out.push({ title: t.title, canvas: b.canvas, from: '内置模板' });
            used.add(t.title);
          }
        } catch (e) { /* 单个模板坏了跳过 */ }
      }
    }
    return out.slice(0, 12);
  }

  /** 把收集到的示例装成一个「示例插件组」 */
  buildSampleModule(samples) {
    // 第一个插件组若是空的（全新工程），直接改造成示例组；否则新增一个
    const p = store.store.project;
    const first = p.modules[0];
    const firstEmpty = first && (first.canvases || []).every(c => !c.nodes.length);
    let mod;
    if (firstEmpty) {
      mod = first;
      // 名字和 store.addModule 规范化后的结果保持一致（全小写）
      mod.id = 'sciptsexamples';
      mod.canvases = [];
    } else {
      mod = store.addModule('sciptsExamples');
      mod.canvases = [];
    }
    const used = new Set();
    for (const s of samples) {
      const c = s.canvas;
      c.file = M.toFileName(c.title || c.file, 'sample');
      let f = c.file, i = 2;
      while (used.has(f)) { f = c.file + i++; }
      used.add(f);
      c.file = f;
      mod.canvases.push(c);
    }
    if (!mod.canvases.length) {
      mod.canvases.push(M.newCanvas('示例', 'main'));
    }
    p.activeCanvas = mod.canvases[0].id;
    store.store.activeCanvasId = mod.canvases[0].id;
    store.emit('module');
    store.markSaved();   // 示例是「本来就有的」，不该顶着「未保存」
    this.renderAll();
  }

  // ---------------- 首页（主界面） ----------------

  openHome() {
    if (this.settingsPage && this.settingsPage.isOpen()) this.settingsPage.close();
    // 和设置页一样是「整窗替换」：首页盖住工作区，同时把 #app 也藏起来。
    // 只靠 z-index 盖住不够 —— 画布还在下面，键盘快捷键（Ctrl+Z 等）
    // 和焦点仍然会打到看不见的工作区上。
    this.el.app.hidden = true;
    this.homePage.open();
  }

  closeHome() {
    this.homePage.close();
    this.el.app.hidden = false;
    // 回来时重新量一次：首页期间窗口尺寸可能变过
    this.canvasView.applyTransform();
    this.canvasView.applyGrid();
  }

  /** 从首页点某个插件组：切到它的第一个画布并进入工作区 */
  enterModule(modId) {
    const m = store.store.project.modules.find(x => x.id === modId);
    if (!m) return;
    const first = (m.canvases && m.canvases[0]) || null;
    if (!first) return;
    this.closeHome();
    store.setActiveCanvas(first.id);
    log.action('进入插件组: ' + modId);
    this.renderAll();
  }

  /** 首页上删插件组。删完留在首页（列表里那个就没了） */
  async deleteModuleFromHome(modId) {
    const m = store.store.project.modules.find(x => x.id === modId);
    if (!m) return;
    if (store.store.project.modules.length <= 1) {
      this.toast('至少要留一个插件组', 'warn');
      return;
    }
    if (!(await this.confirm('删除插件组「' + modId + '」',
      '里面的画布和连线都会一起删掉，撤销可以找回来。确定吗？', '删除'))) return;
    store.removeModule(modId);
    log.action('删除插件组: ' + modId);
    this.homePage.render();
  }

  /** 首页上改插件组名字（改名 = 导出后的文件夹名） */
  async renameModuleFromHome(modId) {
    await this.modal({
      title: '改插件组名字',
      body: `<div class="form">
        <label class="fl">新名字（会成为文件夹名，也是脚本的包名）</label>
        <input id="rmId" type="text" value="${esc(modId)}">
        <div class="fhint">只能用字母、数字、下划线。</div>
      </div>`,
      buttons: [
        { label: '取消', value: null },
        {
          label: '改名', kind: 'primary', onClick: (m) => {
            const clean = m.querySelector('#rmId').value.trim();
            if (!clean || clean === modId) return true;
            store.setModuleId(modId, clean);
            log.action('插件组改名: ' + modId + ' -> ' + clean);
            this.renderAll();
            return true;
          },
        },
      ],
    });
  }

  /**
   * 首页「新建插件组」——第 15 轮改成弹窗（和新建画布 / 新建模块一致）：
   * 填名字 + 选一个模板（也可选「空插件组」）。建完留在首页看列表。
   */
  async newModuleFromHome() {
    const tplOptions = [['', '空插件组（什么都不放）']]
      .concat(TEMPLATES.map(t => [t.key, t.title]));
    const r = await this.modal({
      title: '新建插件组',
      body: `<div class="form">
        <label class="fl">插件组名字（会成为文件夹名，也是脚本的包名）</label>
        <input id="nmName" type="text" placeholder="例如 shop" autocomplete="off">
        <div class="fhint">只能用字母、数字、下划线。导出后是一个独立文件夹。</div>
        <label class="fl">顺带套一个模板（可留空）</label>
        <select id="nmTpl" class="set-select">
          ${tplOptions.map(([v, l]) =>
            `<option value="${esc(v)}">${esc(l)}</option>`).join('')}
        </select>
        <div class="fhint">选模板的话，新插件组里会直接多出一张配好的画布。</div>
      </div>`,
      buttons: [
        { label: '取消', value: null },
        {
          label: '创建', kind: 'primary', onClick: (m) => {
            const name = (m.querySelector('#nmName').value || '').trim();
            // 返回 undefined = 不关窗（modal() 的约定），让用户把名字填上
            if (!name) { m.querySelector('#nmName').focus(); this.toast('请先填插件组名字', 'warn'); return undefined; }
            const tplKey = m.querySelector('#nmTpl').value;
            const mod = store.addModule(name);
            if (tplKey) {
              try {
                const t = TEMPLATES.find(x => x.key === tplKey);
                if (t) {
                  const built = t.build();
                  built.canvas.file = M.toFileName(built.canvas.file, 'main');
                  mod.canvases.push(built.canvas);
                }
              } catch (e) { log.warn('套用模板失败: ' + e); }
            }
            store.emit('module');
            log.action('新建插件组: ' + mod.id + (tplKey ? '（含模板）' : ''));
            // 留在首页：用户通常要连着建好几个
            this.homePage.render();
            this.toast(`插件组「${mod.id}」已创建`, 'ok');
            return true;
          },
        },
      ],
    });
    return r;
  }

  // ---------------- 插件文件管理器（右栏，第 15 轮） ----------------

  /** 文件管理器里「新建文件」= 新建一张画布（= 一个新的 .kts） */
  async newCanvasFromMgr() {
    const mod = store.activeRef() ? store.activeRef().module : null;
    if (!mod) { this.toast('先进入一个插件组', 'warn'); return; }
    const used = mod.canvases.map(c => c.file).join('、');
    const r = await this.modal({
      title: '新建 .kts 文件',
      body: `<div class="form">
        <label class="fl">文件名（英文，导出后就是它）</label>
        <input id="ncFile" type="text" value="newFile" autocomplete="off">
        <div class="fhint">只能用字母、数字、下划线。当前已有：${esc(used)}</div>
        <label class="fl">标题（给自己看的，随便写）</label>
        <input id="ncTitle" type="text" value="新画布" autocomplete="off">
      </div>`,
      buttons: [
        { label: '取消', value: null },
        {
          label: '创建', kind: 'primary', onClick: (m) => {
            const file = M.toFileName(m.querySelector('#ncFile').value, 'newFile');
            const title = (m.querySelector('#ncTitle').value || '').trim() || file;
            if (mod.canvases.some(c => c.file === file)) {
              this.toast(`已经有叫 ${file}.kts 的文件了`, 'warn');
              return undefined;   // 不关窗，让用户改个名
            }
            store.addCanvas(mod.id, title, file);
            log.action('新建文件: ' + file + '.kts');
            return true;
          },
        },
      ],
    });
    if (r) this.renderAll();
  }

  /** 改文件名 / 标题 */
  async renameCanvasFromMgr(canvasId) {
    const ref = store.activeRef();
    const mod = ref ? ref.module : null;
    const c = mod && mod.canvases.find(x => x.id === canvasId);
    if (!c) return;
    await this.modal({
      title: '改文件',
      body: `<div class="form">
        <label class="fl">文件名</label>
        <input id="rcFile" type="text" value="${esc(c.file)}" autocomplete="off">
        <div class="fhint">改名后导出的是 <b>改名后的名字</b>.kts。</div>
        <label class="fl">标题</label>
        <input id="rcTitle" type="text" value="${esc(c.title)}" autocomplete="off">
      </div>`,
      buttons: [
        { label: '取消', value: null },
        {
          label: '保存', kind: 'primary', onClick: (m) => {
            const file = M.toFileName(m.querySelector('#rcFile').value, c.file);
            const title = (m.querySelector('#rcTitle').value || '').trim() || file;
            if (mod.canvases.some(x => x.id !== c.id && x.file === file)) {
              this.toast(`已经有叫 ${file}.kts 的文件了`, 'warn');
              return undefined;
            }
            store.renameCanvas(c.id, title, file);
            log.action('改文件: ' + file + '.kts');
            return true;
          },
        },
      ],
    });
    this.renderAll();
  }

  /** 删除一个 .kts（= 一张画布）。至少留一个 */
  async deleteCanvasFromMgr(canvasId) {
    const ref = store.activeRef();
    const mod = ref ? ref.module : null;
    const c = mod && mod.canvases.find(x => x.id === canvasId);
    if (!c) return;
    if (mod.canvases.length <= 1) { this.toast('至少要留一个文件', 'warn'); return; }
    const nodes = (c.nodes || []).length;
    if (!(await this.confirm(`删除 ${c.file}.kts？`,
      nodes ? `里面有 ${nodes} 个控件，会一起删掉（撤销可以找回来）。` : '这个文件是空的，删掉没影响。',
      '删除'))) return;
    if (!store.removeCanvas(canvasId)) this.toast('至少要留一个文件', 'warn');
    log.action('删除文件: ' + c.file + '.kts');
    this.renderAll();
  }

  /** 复制一个 .kts（画布内容 + 连线一起复制，id 重新生成） */
  duplicateCanvasFromMgr(canvasId) {
    const ref = store.activeRef();
    const mod = ref ? ref.module : null;
    const src = mod && mod.canvases.find(x => x.id === canvasId);
    if (!src) return;
    const copy = M.cloneCanvas ? M.cloneCanvas(src) : JSON.parse(JSON.stringify(src));
    copy.id = M.newId('c');
    copy.nodes = (src.nodes || []).map(n => ({ ...n, id: M.newId('n') }));
    const map = {};
    (src.nodes || []).forEach((n, i) => { map[n.id] = copy.nodes[i].id; });
    copy.edges = (src.edges || []).map(e => ({
      id: M.newId('e'),
      from: { node: map[e.from.node], port: e.from.port },
      to: { node: map[e.to.node], port: e.to.port },
      kind: e.kind,
    }));
    let f = src.file + 'Copy', i = 2;
    const used = new Set(mod.canvases.map(c => c.file));
    while (used.has(f)) { f = src.file + 'Copy' + i++; }
    copy.file = f;
    copy.title = src.title + ' 副本';
    mod.canvases.push(copy);
    store.store.activeCanvasId = copy.id;
    store.emit('canvas');
    store.autoSave();
    log.action('复制文件: ' + f + '.kts');
    this.renderAll();
  }

  // ---------------- 控件参数弹窗（第 15 轮：右栏让给文件管理器） ----------------

  /**
   * 单击控件：只做「选中」。
   * 弹窗已经开着的话顺势切到新选中的控件（用户看着参数窗去点另一个控件，
   * 期望的是切过去，而不是弹窗停在旧的上面）。
   */
  selectNode(id) {
    this.selectedNodeId = id || null;
    if (this.inspDialogOpen) {
      if (id) this.inspector.show(id);
      else this.closeNodeInspector();
    }
  }

  /** 点画布上的控件：弹出设置窗口（id 为空则关闭） */
  openNodeInspector(id) {
    if (!id) { this.closeNodeInspector(); return; }
    this.el.inspDialog.hidden = false;
    this.inspector.show(id);
    // 焦点给弹窗，Esc 才能被它接住
    const box = this.el.inspDialog.querySelector('.inspdlg-box');
    if (box) box.focus();
    this.inspDialogOpen = true;
  }

  closeNodeInspector() {
    if (!this.el.inspDialog || this.el.inspDialog.hidden) return;
    this.el.inspDialog.hidden = true;
    this.inspector.show(null);
    this.inspDialogOpen = false;
  }

  bindInspDialog() {
    const dlg = this.el.inspDialog;
    if (!dlg) return;
    dlg.querySelector('.inspdlg-mask').addEventListener('click', () => this.closeNodeInspector());
    dlg.querySelector('.inspdlg-close').addEventListener('click', () => this.closeNodeInspector());
    dlg.querySelector('.inspdlg-ok').addEventListener('click', () => this.closeNodeInspector());
    // Esc 关窗。放在捕获阶段：编辑输入框时按 Esc 也该关，而不是被输入框吃掉
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.inspDialogOpen) {
        e.preventDefault();
        e.stopPropagation();
        this.closeNodeInspector();
      }
    }, true);
  }

  renderAll() {
    // 每一步单独兜底：任何一个渲染环节出问题，都不能让剩下的界面不更新、
    // 或者变成「点哪个按钮都弹同一个错」。
    const step = (name, fn) => {
      try { fn(); } catch (e) { this.renderFailures.push(name + ': ' + (e && (e.message || e))); reportError('render/' + name, e); }
    };
    this.renderFailures = [];
    step('标签页', () => this.renderTabs());
    step('控件库', () => this.renderLibrary());
    step('画布', () => this.canvasView.render());
    step('文件管理器', () => this.fileManager.render());
    step('参数面板', () => {
      // 弹窗开着才重绘参数面板（关着的时候没必要算）
      if (!this.inspDialogOpen) return;
      if (!this.inspector.nodeId || !store.activeCanvas() ||
          !store.activeCanvas().nodes.some(n => n.id === this.inspector.nodeId)) {
        // 选中的控件被删了：直接关掉弹窗，别让它停在那儿显示别人的参数
        this.closeNodeInspector();
      } else {
        this.inspector.render();
      }
    });
    step('状态栏', () => this.refresh());
  }

  /** 把「此刻工程有多大」交给崩溃记录。crashguard.js 不能 import 业务模块。 */
  captureSnapshot() {
    try {
      return log.snapshot(store.store.project);
    } catch (_) {
      return '';
    }
  }

  refresh() {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const gen = generatePlugin(store.store.project);
    this.lastGen = gen;
    const v = validateProject(store.store.project);
    const prev = this.problems || { errors: [], warnings: [] };
    this.problems = { errors: v.errors, warnings: v.warnings };

    // 自己生成出来的代码也要配平（这属于工具 bug）
    const sc = selfCheck(gen.files);
    for (const s of sc) {
      this.problems.errors.push({ level: 'error', message: `内部错误：${s.file} 第 ${s.line} 行 ${s.message}` });
    }

    const errNodes = new Set(this.problems.errors.map(e => e.nodeId).filter(Boolean));
    this.canvasView.setErrors(errNodes);

    // refresh 在几乎每次交互后都会跑，所以不每次记耗时 —— 否则日志会被
    // 上千条「生成 3ms」淹掉。只在明显变慢时记一笔。
    const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    if (ms >= SLOW_RENDER_MS) {
      log.warn(`生成代码偏慢：${ms}ms（${gen.files.length} 个文件，${store.store.project.modules.length} 个模块）`);
    }

    // 校验问题逐条记，但只在「问题集合变了」时记：填参数时每个字符都会
    // 触发 refresh，同一批错误会被重复写上几十遍。用签名去重。
    const problems = [...this.problems.errors, ...this.problems.warnings];
    const sig = problems.map(p => `${p.level}|${p.module}|${p.canvas}|${p.nodeId}|${p.message}`).join('\n');
    if (sig !== this._problemsSig) {
      this._problemsSig = sig;
      if (problems.length) {
        log.info(`校验：${this.problems.errors.length} 个错误、${this.problems.warnings.length} 个提醒`);
        log.problems(this.problems.errors, '错误');
        log.problems(this.problems.warnings, '提醒');
      } else if (prev.errors.length || prev.warnings.length) {
        log.info('校验：已全部通过（错误和提醒都清掉了）');
      }
    }

    this.renderStatus();
  }

  renderStatus() {
    const { errors, warnings } = this.problems;
    const fileCount = this.lastGen ? this.lastGen.files.length : 0;
    const cls = errors.length ? 'bad' : (warnings.length ? 'warn' : 'ok');
    const dirty = store.isDirty();
    this.el.status.innerHTML = `
      <span class="st-dot ${cls}"></span>
      <span class="st-text">已生成 ${fileCount} 个文件 · ${errors.length} 个错误 · ${warnings.length} 个提醒 · 未导出</span>
      <span class="st-dirty ${dirty ? 'on' : ''}" title="${dirty
        ? '有改动还没保存成 .saproj 文件（Ctrl+S 保存）'
        : '当前内容和上次保存的一致'}">${dirty ? IC.dot + ' 未保存' : IC.check + ' 已保存'}</span>
      <span class="st-zoom" id="stZoom" title="鼠标滚轮缩放；左键拖动空白处平移画布（右键拖 / 空格+左键拖也可以）"></span>
      <button class="st-problems" id="stProblems" ${errors.length + warnings.length ? '' : 'disabled'}>
        查看问题${errors.length + warnings.length ? ` (${errors.length + warnings.length})` : ''}
      </button>`;
    const btn = this.el.status.querySelector('#stProblems');
    if (btn) btn.addEventListener('click', () => this.showProblems());
    this.renderZoomBadge(this.canvasView ? this.canvasView.zoom : 1);
  }

  /** 状态栏右下角显示当前缩放比例 */
  renderZoomBadge(z) {
    const el = this.el.status && this.el.status.querySelector('#stZoom');
    if (el) el.textContent = Math.round((z || 1) * 100) + '%';
  }

  renderTabs() {
    const p = store.store.project;
    const active = store.store.activeCanvasId;
    const parts = [];
    for (const m of p.modules) {
      for (const c of m.canvases) {
        parts.push(`<div class="tab${c.id === active ? ' active' : ''}" data-canvas="${c.id}" title="${esc(m.id)}/${esc(c.file)}.kts">
          <span class="tab-title">${esc(c.title)}</span>
          <span class="tab-file">${esc(c.file)}.kts</span>
          <button class="tab-close" data-close="${c.id}" title="关闭这张画布">×</button>
        </div>`);
      }
    }
    parts.push(`<button class="tab-add" id="tabAdd" title="新建一张画布">+</button>`);
    this.el.tabs.innerHTML = parts.join('');

    this.el.tabs.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close')) return;
        store.setActiveCanvas(t.dataset.canvas);
      });
      t.addEventListener('dblclick', () => this.renameCanvasDialog(t.dataset.canvas));
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); this.canvasMenu(t.dataset.canvas, e); });
    });
    this.el.tabs.querySelectorAll('.tab-close').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = b.dataset.close;
        // 关掉一张画布 = 删掉它，是最容易误触的破坏性操作（× 就贴在标签上）
        if (!await this.confirmUnsaved('关闭这张画布')) return;
        if (!store.removeCanvas(id)) this.toast('至少要留一张画布', 'warn');
        else this.renderAll();
      });
    });
    const add = this.el.tabs.querySelector('#tabAdd');
    if (add) add.addEventListener('click', () => this.newCanvasDialog());
  }

  /** 控件库。分类默认折叠，展开状态不持久化；搜索时强制展开。 */
  renderLibrary() {
    const q = this.el.libSearch.value.trim();
    const parts = [];

    if (q) {
      const hits = searchDefs(q);
      // 搜索结果也走双排，和折叠分类里的观感保持一致
      parts.push(`<div class="lib-group"><div class="lib-group-title">搜索「${esc(q)}」找到 ${hits.length} 个</div><div class="lib-grid">`);
      for (const d of hits) parts.push(this.libItem(d));
      parts.push(`</div></div>`);
    } else {
      // 第 14 轮：不再按「入门 / 高级」分段 —— 所有控件按分类直接混排。
      // 折叠状态的键就是分类本身（如 `event`），不掺等级。
      for (const g of catalogFlat()) {
        const key = g.cat;
        const open = store.isGroupOpen(key);
        const n = g.items.length;
        parts.push(`<div class="lib-group${open ? ' open' : ''}" data-group="${esc(key)}">
          <button class="lib-group-head" data-toggle="${esc(key)}" aria-expanded="${open ? 'true' : 'false'}">
            <span class="lg-arrow">${IC.chev}</span>
            <span class="lg-label">${esc(g.label)}</span>
            <span class="lg-count">${n}</span>
          </button>
          <div class="lib-group-body"${open ? '' : ' hidden'}>
            ${g.items.map(d => this.libItem(d)).join('')}
          </div>
        </div>`);
      }
    }
    this.el.lib.innerHTML = parts.join('');

    this.el.lib.querySelectorAll('[data-toggle]').forEach((h) => {
      h.addEventListener('click', () => {
        const key = h.dataset.toggle;
        const open = store.toggleGroup(key);
        const group = h.closest('.lib-group');
        group.classList.toggle('open', open);
        h.setAttribute('aria-expanded', open ? 'true' : 'false');
        const arrow = h.querySelector('.lg-arrow');
        if (arrow) arrow.innerHTML = IC.chev;
        const body = group.querySelector('.lib-group-body');
        if (body) body.hidden = !open;
      });
    });

    // 拖入画布。Tauri 默认开着 dragDropEnabled，会把 HTML5 拖放事件整个吃掉
    // （连 dragstart 都不触发），所以 tauri.conf.json 里必须关掉它。
    // 每个 draggable 元素的 dragstart 必须 setData。
    this.el.lib.querySelectorAll('.lib-card').forEach(c => {
      c.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/kts-def', c.dataset.def);
        e.dataTransfer.effectAllowed = 'copy';
        // 源卡片「抬起」效果（CSS: .lib-card.dragging）
        c.classList.add('dragging');
        // dragover 里读不到 dataTransfer 的内容，记一份
        this.canvasView.draggingDef = c.dataset.def;
        // 半透明幽灵卡片：用控件卡片本身做快照，跟着鼠标走
        const ghost = c.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = c.offsetWidth + 'px';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, 22);
        // 浏览器截完图才能移除，否则快照是空的
        setTimeout(() => ghost.remove(), 0);
      });
      c.addEventListener('dragend', () => {
        c.classList.remove('dragging');
        this.canvasView.draggingDef = '';
        this.canvasView.clearDropHint();
      });
    });
  }

  libItem(d) {
    const isComposite = d.produces && d.produces.length;
    // 第 15 轮：卡片上不再标「入门 / 高级」（用户要求彻底不分等级）。
    // 名字超长时仍用省略号收窄，但 title 属性保证鼠标悬停能看到全名。
    return `<div class="lib-card" draggable="true" data-def="${esc(d.key)}" data-cat="${esc(d.category)}">
      <div class="lc-top">
        <span class="lc-name" title="${esc(d.label)}">${esc(d.label)}</span>
        ${isComposite ? '<span class="lc-badge">带输出</span>' : ''}
      </div>
      <div class="lc-code" title="${esc(d.codeHint || '')}">${esc(d.codeHint || '')}</div>
    </div>`;
  }

  // ---------------- 工具栏 ----------------

  bindToolbar() {
    this.el.toolbar.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      // 按钮的处理函数一律兜底：某个功能坏了就只坏那一个，不能让异常冒到
      // 顶层变成「点哪个按钮都没反应」。
      try {
        await this.dispatch(act);
      } catch (err) {
        reportError('按钮/' + act, err);
      }
    });
  }

  /**
   * 工具栏动作分派。抽出来是为了能被 try/catch 包住、方便测试直接调；
   * 每个动作都记一条日志，日志里能看到是哪一个按钮。
   */
  async dispatch(act) {
    {
      // 计时包住整个 dispatch 且放在最前面，这样即使动作本身抛异常，也已经
      // 留下了「用户点了 X」。
      log.action('按钮: ' + act);
      const t = log.begin('按钮 ' + act);
      let done = '';
      try {
        if (act === 'newModule') { if (await this.confirmUnsaved('新建一个模块')) this.newModuleDialog(); }
        else if (act === 'home') this.openHome();
        else if (act === 'template') { if (await this.confirmUnsaved('套用模板')) this.templateDialog(); }
        else if (act === 'modules') this.moduleManagerDialog();
        else if (act === 'preview') this.codeModeDialog();
        else if (act === 'export') await this.doExport();
        else if (act === 'undo') { store.undo(); this.renderAll(); }
        else if (act === 'redo') { store.redo(); this.renderAll(); }
        else if (act === 'fit') this.canvasView.fit();
        else if (act === 'zin') this.canvasView.zoomBy(1.2);
        else if (act === 'zout') this.canvasView.zoomBy(1 / 1.2);
        else if (act === 'save') await this.saveProject();
        else if (act === 'open') await this.openProject();
        else if (act === 'newProject') { if (await this.confirmUnsaved('新建工程')) this.newProjectDialog(); }
        else if (act === 'importKts') await this.importKtsDialog();
        else if (act === 'help') this.helpDialog();
        else if (act === 'fullscreen') await this.toggleFullscreen();
        else if (act === 'settings') this.openSettings();
      } catch (e) {
        done = '失败';
        throw e;
      } finally {
        // 有些按钮会弹对话框（选目录、确认框），那段时间是人在操作而不是工具卡，
        // 超过 3 秒就补一句说明。
        const ms = t.end(done);
        if (ms >= 3000) {
          log.info(`  ↑ 「按钮 ${act}」耗时较长：如果中途有对话框/确认框在等你操作，`
            + `那是人的时间，不是工具卡住。真卡住时界面会完全不响应。`);
        }
      }
    }
  }

  // ---------------- 全屏 ----------------

  /**
   * 切换真全屏（无边框、盖住任务栏）。F11 和工具栏按钮共用这一条路径。
   * 不记住状态：真全屏下没有标题栏，退出得靠 F11/Esc。
   */
  async toggleFullscreen(force) {
    try {
      const next = typeof force === 'boolean' ? force : !(await api.isFullscreen());
      await api.setFullscreen(next);
      this.syncFullscreenButton(next);
      log.action(next ? '进入全屏' : '退出全屏');
      return next;
    } catch (e) {
      reportError('全屏', e);
      return false;
    }
  }

  /** 让工具栏按钮的文字跟着实际状态变（不然会显示成反的） */
  syncFullscreenButton(on) {
    const b = document.getElementById('tbFullscreen');
    if (!b) return;
    b.textContent = on ? '退出全屏' : '全屏';
    b.classList.toggle('on', !!on);
    b.title = on ? '退出全屏（F11 或 Esc）' : '全屏（F11）';
  }

  // ---------------- 设置页 ----------------

  /**
   * 用户点了窗口右上角的 X。由 Rust 侧 prevent_close() 后 eval 调用。
   * 每一步都必须保证「要么关掉、要么明确不关」，不能出现对话框关掉了、
   * 窗口也关不掉的中间状态。
   */
  async onCloseRequested() {
    // 防重入：连点 X 不该叠出好几个对话框。
    // 但**必须重新报到一次** —— Rust 那边每次点 X 都会重置「已报到」标记
    // 并重新起一个 2 秒看门狗；要是不报到，一个活着的前端也会被判超时强杀，
    // 用户会看到询问框莫名其妙消失、程序自己关了。
    if (this.closing) {
      try { await exporter.api.closeGuardAck(); } catch (_) {}
      return;
    }
    this.closing = true;

    // 先向 Rust 报平安，取消那边的 2 秒看门狗。必须在弹框之前调：报完到用户
    // 想多久都没关系；要是这里之后抛异常，看门狗会兜住。
    try { await exporter.api.closeGuardAck(); } catch (_) {}

    try {
      // 设置页开着时先退回主界面，否则询问框会被盖在下面看不见
      if (this.settingsPage && this.settingsPage.isOpen()) this.closeSettings();

      const go = await this.confirmUnsaved('关闭本工具');
      if (!go) {
        log.action('取消关闭');
        log.flushNow();          // 取消也要把「他点了取消」写下去
        return;                  // 窗口留着
      }

      // 关之前把日志刷完，不然最后几条（包括这条「应用关闭」）可能还在缓冲里
      log.action('确认关闭');
      log.flushNow();
      try { await exporter.api.logShutdown(); } catch (_) {}
      await exporter.api.confirmClose();
    } catch (e) {
      console.error('关窗确认失败', e);
      // 出错时不要卡住用户：直接放行关闭，至少本地存档还在
      try { await exporter.api.confirmClose(); } catch (_) {}
    } finally {
      this.closing = false;
    }
  }

  openSettings() {
    // 设置页永远是整窗替换：不管从哪进来（首页或画布），都先把 #app 藏起来
    this.el.app.hidden = true;
    this.settingsPage.open();
  }

  closeSettings() {
    this.settingsPage.close();
    // 设置页可能是从首页进来的（首页 → 设置）。那种情况下「返回」应该回首页，
    // 而不是把工作区露出来 —— 否则首页和工作区会同时可见。
    if (this.homePage && this.homePage.isOpen()) {
      this.el.app.hidden = true;
      return;
    }
    this.el.app.hidden = false;
    // 改过主题/字号/网格都要让画布重新量一次尺寸
    this.canvasView.applyTransform();
    this.canvasView.applyGrid();
    this.renderAll();
  }

  async doExport() {
    const t = log.begin('导出插件');
    const { errors, warnings } = this.problems;
    if (errors.length) {
      t.end('有错误，已中止');
      this.showProblems('有错误，先修好才能导出');
      return;
    }
    if (warnings.length) {
      const go = await this.confirm('还有 ' + warnings.length + ' 条提醒', '这些提醒不影响导出，确定继续吗？', '继续导出');
      if (!go) { t.end('用户取消（有提醒）'); return; }
    }

    // 设置里填了默认导出目录就直接写进去，不再每次弹选择框
    const savedDir = S.get('exportDir');

    const r = await exporter.exportPlugin(store.store.project, savedDir ? { outDir: savedDir } : {});
    if (!r.ok) {
      if (r.error !== '已取消') { t.end('失败: ' + r.error); this.toast(r.error, 'error'); }
      else t.end('用户取消');
      return;
    }
    if (r.mode === 'dir') {
      const dir = (r.paths && r.paths[0]) ? r.paths[0].replace(/[\\/][^\\/]+$/, '') : '';
      if (S.get('revealAfterExport')) {
        if (dir) { try { await exporter.api.reveal(dir); } catch (_) {} }
        this.toast(`已导出 ${r.paths.length} 个文件`, 'ok');
      } else {
        const open = await this.confirm('导出成功', `已写入 ${r.paths.length} 个文件到：\n${dir}\n\n要打开文件夹看看吗？`, '打开文件夹');
        if (open && dir) { try { await exporter.api.reveal(dir); } catch (_) {} }
      }
      // 这次是弹框选的目录，记下来当默认值，下次就能直接导出
      if (!savedDir && dir) S.set('exportDir', dir);
    } else {
      this.toast('已下载 ZIP，解压后把里面的文件夹放进游戏的 scripts 目录即可', 'ok');
    }
    t.end(`写了 ${r.paths ? r.paths.length : 0} 个文件`);
    this.renderStatus();
  }

  /**
   * 保存工程。返回 true = 确实存下去了，false = 用户取消了对话框。
   * 调用方（尤其是关窗询问）必须区分这两种结果：用户点了取消就绝不能继续
   * 往下走，否则「取消」会变成「不保存」。
   */
  async saveProject() {
    const t = log.begin('保存工程');
    const name = (store.store.project.modules[0] || {}).id || 'plugin';
    const r = await exporter.saveProjectFile(store.store.project, name + '.saproj');
    if (r.ok) {
      store.markSaved();
      t.end('已保存');
      this.toast('工程已保存', 'ok');
      this.renderStatus();
      return true;
    }
    if (r.error !== '已取消') { t.end('失败: ' + r.error); this.toast(r.error, 'error'); }
    else t.end('用户取消');
    return false;
  }

  /**
   * 安全重载（第 15 轮，配合 F5 / Ctrl+R 拦截）。
   *
   * 裸刷新会让界面跳回首页、正在编的画布消失（用户报的「异常跳转」）。
   * 这里先把工程写进 localStorage（自动存档），再 location.reload() ——
   * 刷新后 store 恢复的还是同一份工程，视觉上只是「界面重画了一遍」。
   * 如果真的存不进去（配额满等），先问一句再刷新，别把改动直接冲掉。
   */
  async safeReload() {
    if (store.saveNow()) {
      log.action('安全重载界面（工程已先落盘）');
      this.toast('正在重新加载界面…', 'ok', true);
      setTimeout(() => location.reload(), 120);
      return;
    }
    log.warn('重载前保存失败（本地存档写不进去）');
    const go = await this.confirm('重新加载界面？',
      '刚才的改动没能写进本地存档（可能空间不足），重新加载后可能丢失。要继续吗？', '重新加载');
    if (go) location.reload();
  }

  /**
   * 「有没保存的改动，先处理一下」。返回 true = 可以继续；false = 用户取消，
   * 调用方必须中止当前操作。
   * 用三个按钮而不是两个：两个按钮里的「取消」既可能是「取消保存」又可能是
   * 「取消这个操作」，说不清楚。
   * 关窗时主进程会先把关闭拦下来（见 main.rs），所以可以放心 await。
   */
  async confirmUnsaved(actionLabel) {
    if (!store.isDirty()) return true;

    const choice = await this.modal({
      title: '有改动还没保存',
      body: `<div class="modal-text">
        当前工程有改动还没保存成 <b>.saproj</b> 文件。<br><br>
        将要${esc(actionLabel || '继续')}。
        <br><br>
        <span class="muted">（改动本身已经自动存进本地，下次打开本工具还能恢复；
        但只有保存成文件才能换台电脑用、或者发给别人。）</span>
      </div>`,
      buttons: [
        { label: '取消', value: 'cancel' },
        { label: '不保存', value: 'discard' },
        { label: '保存并继续', kind: 'primary', value: 'save' },
      ],
    });

    if (choice === 'cancel' || choice === null) return false;
    if (choice === 'discard') return true;
    // 选了「保存并继续」：另存为对话框被取消的话，整体就当取消处理
    return await this.saveProject();
  }

  async openProject() {
    if (!await this.confirmUnsaved('打开另一个工程')) return;
    const t = log.begin('打开工程');
    const r = await exporter.openProjectFile();
    if (!r.ok) { t.end(r.error === '已取消' ? '用户取消' : '失败: ' + r.error); if (r.error !== '已取消') this.toast(r.error, 'error'); return; }
    try {
      const p = M.parse(r.text);
      const bad = collectUnknown(p);
      store.replaceProject(p);
      store.markSaved();          // 刚打开的工程就是「已保存」状态
      this.closeHome();           // 从首页点进来的：开完就进画布
      this.renderAll();
      t.end(`${p.modules.length} 个模块${bad.length ? `，${bad.length} 个不认识的控件` : ''}`);
      this.toast(bad.length ? `工程已打开，但有 ${bad.length} 个不认识的控件` : '工程已打开', bad.length ? 'warn' : 'ok');
    } catch (e) {
      t.end('解析失败: ' + e.message);
      this.toast('打开失败：' + e.message, 'error');
    }
  }

  async importKtsDialog() {
    const t = log.begin('从代码还原');
    const r = await exporter.openKtsFile(); // 只允许 .kts（选择器过滤 + 后缀校验）
    if (!r.ok) { t.end(r.error === '已取消' ? '用户取消' : '失败: ' + r.error); if (r.error !== '已取消') this.toast(r.error, 'error'); return; }
    if (!looksLikeOurKts(r.text)) {
      t.end('文件里没有本工具的标记');
      this.toast('这个 .kts 文件里没有本工具留下的标记，无法还原成画布', 'error');
      return;
    }
    const p = parseKts(r.text);
    if (!p.ok) { t.end('解析失败: ' + p.error); this.toast(p.error, 'error'); return; }
    const mod = store.activeModule();
    store.pushUndo();
    const c = { ...p.canvas, file: M.toFileName(r.path ? r.path.split(/[\\/]/).pop().replace(/\.kts$/, '') : 'imported', 'imported') };
    mod.canvases.push(c);
    store.store.activeCanvasId = c.id;
    store.emit('canvas');
    this.closeHome();             // 还原出来的画布就是用户要看的东西
    this.renderAll();
    t.end(`还原出 ${c.nodes.length} 个功能块` + (p.unknown.length ? `，${p.unknown.length} 个认不出` : ''));
    // 认不出的控件会被跳过。必须说出来 —— 否则用户只看到「还原出 3 个」，
    // 不知道文件里本来是 5 个、剩下 2 个去哪了。
    const lost = p.unknown.length
      ? `；有 ${p.unknown.length} 个功能块这个版本认不出、已跳过：${[...new Set(p.unknown)].slice(0, 3).join('、')}`
      : '';
    this.toast('已从代码还原出 ' + c.nodes.length + ' 个功能块' + lost + '；' + p.warning,
      p.unknown.length ? 'error' : 'warn');
  }

  // ---------------- 控件库搜索 ----------------

  bindLibrary() {
    this.el.libSearch.addEventListener('input', () => this.renderLibrary());
  }

  bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      const mod = e.ctrlKey || e.metaKey;

      // 切全屏。F11 不是输入字符，打字时也允许。
      if (e.key === 'F11') {
        e.preventDefault();
        this.toggleFullscreen();
        return;
      }

      // 第 15 轮：F5（以及 Ctrl+R）在 WebView2 里会**整个页面重载** ——
      // 界面直接跳回首页、正在编辑的画布也没了，用户看到的就是「异常跳转」。
      // 这里拦下来，改成「安全重载」：先把工程落盘，再刷新。
      if (e.key === 'F5' || (mod && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        this.safeReload();
        return;
      }

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (typing) return;
        e.preventDefault(); store.undo(); this.renderAll();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        if (typing) return;
        e.preventDefault(); store.redo(); this.renderAll();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault(); this.saveProject();
      } else if (mod && e.key === 'Enter') {
        e.preventDefault(); this.doExport();
      } else if (e.key === 'Escape') {
        // Esc 是对全屏的通用预期。有弹窗时优先关弹窗，否则全屏退了、弹窗还开着
        // 更让人迷惑。
        if (!this.el.modal.hidden || !this.el.settings.hidden) {
          this.closeModal();
        } else {
          this.exitFullscreenIfOn();
        }
      }
    });
  }

  /** 只有在全屏时才退出（避免每次按 Esc 都白跑一次 IPC） */
  async exitFullscreenIfOn() {
    try {
      if (await api.isFullscreen()) await this.toggleFullscreen(false);
    } catch (_) { /* 查询失败就当没在全屏 */ }
  }

  // ---------------- 弹窗 ----------------

  /**
   * 弹窗。返回 Promise，resolve 成被点按钮的 value。
   * 只有 [data-btn] 上的按钮会被自动挂事件；body 里的自定义可点元素（比如
   * 欢迎页卡片）必须自己挂，否则点了没反应。
   * 关掉弹窗（关闭/蒙层/Esc）必须 resolve，否则 await 它的调用方会永远卡住。
   */
  modal({ title, body, buttons, wide }) {    this.el.modal.hidden = false;
    this.el.modal.innerHTML = `
      <div class="modal-mask"></div>
      <div class="modal-box${wide ? ' wide' : ''}">
        <div class="modal-title">${esc(title)}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${(buttons || []).map((b, i) =>
          `<button class="btn ${b.kind || ''}" data-btn="${i}">${esc(b.label)}</button>`).join('')}</div>
      </div>`;
    return new Promise((resolve) => {
      let finished = false;
      const done = (v) => {
        if (finished) return;
        finished = true;
        this.closeModal();
        resolve(v);
      };
      this.el.modal.querySelector('.modal-mask').addEventListener('click', () => done(null));
      this.el.modal.querySelectorAll('[data-btn]').forEach(b => {
        b.addEventListener('click', () => {
          const spec = buttons[Number(b.dataset.btn)];
          if (spec.onClick) { const r = spec.onClick(this.el.modal); if (r !== undefined) done(r); }
          else done(spec.value);
        });
      });
      // Esc 也走 done()，这样 await modal() 的地方不会挂住
      this.modalDone = () => done(null);
      const first = this.el.modal.querySelector('input,textarea,select');
      if (first) setTimeout(() => first.focus(), 30);
    });
  }

  closeModal() {
    this.el.modal.hidden = true;
    this.el.modal.innerHTML = '';
    this.modalDone = null;
  }

  confirm(title, text, okLabel) {
    return this.modal({
      title,
      body: `<div class="modal-text">${esc(text).replace(/\n/g, '<br>')}</div>`,
      buttons: [{ label: '取消', value: false }, { label: okLabel || '确定', kind: 'primary', value: true }],
    }).then(v => v === true);
  }

  /**
   * 欢迎弹窗已经删掉了。以前一进来弹一个「新建/打开/模板」的三选一，
   * 但它盖在画布上、还看不到自己的模块列表。现在启动直接进首页（js/home.js），
   * 三件事都在首页上，而且能一眼看到所有插件组。
   */

  templateDialog() {
    const body = `<div class="tpl-list">${TEMPLATES.map(t => `
      <button class="tpl-card" data-tpl="${esc(t.key)}">
        <div class="tpl-t">${esc(t.title)}</div>
        <div class="tpl-d">${esc(t.desc)}</div>
        <div class="tpl-l">${esc(t.learn)}</div>
      </button>`).join('')}</div>`;
    setTimeout(() => {
      this.el.modal.querySelectorAll('[data-tpl]').forEach(b => {
        b.addEventListener('click', () => {
          const t = TEMPLATES.find(x => x.key === b.dataset.tpl);
          const built = t.build();
          const mod = store.activeModule();
          store.pushUndo();
          built.canvas.file = M.toFileName(built.canvas.file, 'main');
          const used = new Set(mod.canvases.map(c => c.file));
          if (used.has(built.canvas.file)) built.canvas.file = built.canvas.file + '2';
          mod.canvases.push(built.canvas);
          store.store.activeCanvasId = built.canvas.id;
          store.emit('canvas');
          this.closeModal();
          this.renderAll();
          setTimeout(() => this.canvasView.fit(), 60);
          this.toast(built.tip || '模板已套用', 'ok');
        });
      });
    }, 0);
    return this.modal({
      title: '套用一个模板',
      body,
      wide: true,
      buttons: [{ label: '取消', value: null }],
    });
  }

  newCanvasDialog() {
    return this.modal({
      title: '新建画布',
      body: `<div class="form">
        <label class="fl">这张画布是做什么的</label>
        <input id="ncTitle" type="text" placeholder="例如：进服欢迎" value="">
        <label class="fl">导出成什么文件名</label>
        <input id="ncFile" type="text" placeholder="例如：welcome（留空自动生成）" value="">
        <div class="fhint">一个画布 = 一个 .kts 文件</div>
      </div>`,
      buttons: [
        { label: '取消', value: null },
        {
          label: '创建', kind: 'primary', onClick: (m) => {
            const t = m.querySelector('#ncTitle').value.trim() || '新画布';
            let f = m.querySelector('#ncFile').value.trim();
            if (!f) f = /^[A-Za-z_]/.test(M.toModuleId(t, 'canvas')) ? M.toModuleId(t, 'canvas') : 'canvas';
            store.addCanvas(store.activeModule().id, t, f);
            this.renderAll();
            return true;
          },
        },
      ],
    });
  }

  renameCanvasDialog(canvasId) {
    const ref = M.findCanvas(store.store.project, canvasId);
    if (!ref) return;
    return this.modal({
      title: '重命名画布',
      body: `<div class="form">
        <label class="fl">名字</label>
        <input id="rcTitle" type="text" value="${esc(ref.canvas.title)}">
        <label class="fl">文件名</label>
        <input id="rcFile" type="text" value="${esc(ref.canvas.file)}">
        <div class="fhint">文件名只能用字母、数字、下划线</div>
      </div>`,
      buttons: [
        { label: '取消', value: null },
        {
          label: '保存', kind: 'primary', onClick: (m) => {
            const t = m.querySelector('#rcTitle').value.trim() || ref.canvas.title;
            const f = m.querySelector('#rcFile').value.trim() || ref.canvas.file;
            store.renameCanvas(canvasId, t, f);
            this.renderAll();
            return true;
          },
        },
      ],
    });
  }

  canvasMenu(canvasId, ev) {
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = `
      <button data-m="rename">重命名</button>
      <button data-m="dup">复制一张</button>
      <button data-m="del">删除</button>`;
    document.body.appendChild(menu);
    menu.style.left = ev.clientX + 'px';
    menu.style.top = ev.clientY + 'px';
    menu.addEventListener('click', async (e) => {
      const m = e.target.closest('[data-m]');
      if (!m) return;
      const act = m.dataset.m;
      menu.remove();
      const ref = M.findCanvas(store.store.project, canvasId);
      if (act === 'rename') this.renameCanvasDialog(canvasId);
      else if (act === 'dup') {
        store.pushUndo();
        const copy = JSON.parse(JSON.stringify(ref.canvas));
        copy.id = M.newId('c');
        copy.title = ref.canvas.title + ' 副本';
        copy.nodes = copy.nodes.map(n => ({ ...n, id: M.newId('n') }));
        const map = {}; ref.canvas.nodes.forEach((n, i) => map[n.id] = copy.nodes[i].id);
        copy.edges = copy.edges.map(e => ({
          id: M.newId('e'),
          from: { node: map[e.from.node], port: e.from.port },
          to: { node: map[e.to.node], port: e.to.port },
          kind: e.kind,
        }));
        let f = copy.file + 'Copy', i = 2;
        const used = new Set(ref.module.canvases.map(c => c.file));
        while (used.has(f)) { f = copy.file + 'Copy' + i++; }
        copy.file = f;
        ref.module.canvases.push(copy);
        store.store.activeCanvasId = copy.id;
        store.emit('canvas');
        this.renderAll();
      } else if (act === 'del') {
        if (!await this.confirmUnsaved('删除这张画布')) return;
        if (!store.removeCanvas(canvasId)) this.toast('至少要留一张画布', 'warn');
        else this.renderAll();
      }
    });
    setTimeout(() => {
      const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', off); } };
      document.addEventListener('mousedown', off);
    }, 0);
  }

  newModuleDialog() {
    return this.modal({
      title: '新建模块',
      body: `<div class="form">
        <label class="fl">模块名（会成为目录名，也是脚本的包名）</label>
        <input id="nmId" type="text" value="myPlugin">
        <div class="fhint">只能用字母、数字、下划线。一个模块 = 一个目录。</div>
        <label class="fl">依赖</label>
        <div class="deps">
          <label><input type="checkbox" value="coreMindustry" checked> coreMindustry（推荐：带来玩家/单位/方块等一切）</label>
          <label><input type="checkbox" value="coreLibrary"> coreLibrary（基础库）</label>
          <label><input type="checkbox" value="wayzer"> wayzer（管理功能）</label>
          <label><input type="checkbox" value="mapScript"> mapScript（地图脚本）</label>
          <label><input type="checkbox" value="coreLibrary/extApi/KVStore"> KVStore（键值存储）</label>
        </div>
      </div>`,
      buttons: [
        { label: '取消', value: null },
        {
          label: '创建', kind: 'primary', onClick: (m) => {
            const id = m.querySelector('#nmId').value.trim() || 'myPlugin';
            const deps = [...m.querySelectorAll('.deps input:checked')].map(x => x.value);
            const mod = store.addModule(id);
            mod.deps = deps.length ? deps : ['coreMindustry'];
            store.emit('module');
            this.renderAll();
            return true;
          },
        },
      ],
    });
  }

  /**
   * 模块管理。一个模块 = 导出后的一个目录，里面是 module.kts 加若干画布脚本；
   * 删除模块也是「退出前提醒」的触发点之一。
   */
  moduleManagerDialog() {
    const p = store.store.project;

    const rows = p.modules.map((m) => {
      const n = m.canvases.length;
      const deps = (m.deps && m.deps.length) ? m.deps.join(', ') : '（无）';
      // 只剩一个模块时不给删：整个插件至少要有一个模块，否则导出没有目录可建
      const canDel = p.modules.length > 1;
      return `<div class="mod-row" data-mod="${esc(m.id)}">
        <div class="mod-main">
          <div class="mod-name">${esc(m.id)}</div>
          <div class="mod-meta">${n} 张画布 · 依赖：${esc(deps)}</div>
        </div>
        <button class="btn mod-del" data-del="${esc(m.id)}"
          ${canDel ? '' : 'disabled title="至少要留一个模块"'}>删除</button>
      </div>`;
    }).join('');

    const pr = this.modal({
      title: '模块管理',
      body:
        `<div class="modal-text">一个模块导出后就是一个目录，里面有 <b>module.kts</b> 和这个模块下所有画布生成的脚本。</div>
         <div class="mod-list">${rows}</div>
         ${p.modules.length <= 1
          ? '<div class="fhint">至少要留一个模块，所以现在不能删。</div>'
          : ''}`,
      buttons: [{ label: '关闭', value: null }],
    });

    // modal() 是单例，在它上面再叠确认框会把管理窗口顶掉、那个 Promise 就
    // 永远悬着。所以先抓住「关掉自己」的句柄，删之前先把管理窗口正常收掉。
    const closeManager = this.modalDone;

    // 删除按钮是 body 里的自定义元素，modal() 只自动挂 [data-btn]，这里自己接
    this.el.modal.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.dataset.del;
        const ref = p.modules.find((m) => m.id === id);
        if (!ref) return;
        const n = ref.canvases.length;
        if (closeManager) closeManager();   // 先收起管理窗口，让确认框独占

        // 没有未保存改动时这一句会直接放行，只有真的有改动才弹
        if (!await this.confirmUnsaved(`删除模块「${id}」`)) return;

        const okGo = await this.confirm(
          '删除模块',
          `确定删除模块「${id}」吗？\n它下面的 ${n} 张画布会一起删掉。这个操作可以撤销（Ctrl+Z）。`,
          '删除',
        );
        if (!okGo) return;
        if (!store.removeModule(id)) { this.toast('至少要留一个模块', 'warn'); return; }
        this.renderAll();
        this.toast(`已删除模块「${id}」`, 'ok');
      });
    });

    return pr;
  }

  newProjectDialog() {    return this.modal({
      title: '新建工程',
      body: `<div class="form">
        <label class="fl">插件名字</label>
        <input id="npName" type="text" value="我的插件">
        <label class="fl">作者</label>
        <input id="npAuthor" type="text" value="">
        <label class="fl">模块名（目录名）</label>
        <input id="npMod" type="text" value="myPlugin">
      </div>`,
      buttons: [
        { label: '取消', value: null },
        {
          label: '创建', kind: 'primary', onClick: (m) => {
            const p = M.newProject(m.querySelector('#npName').value.trim() || '我的插件');
            p.plugin.author = m.querySelector('#npAuthor').value.trim();
            p.modules[0].id = M.toModuleId(m.querySelector('#npMod').value.trim(), 'myPlugin');
            store.replaceProject(p);
            store.markSaved();   // 全新工程 = 干净状态，不该顶着「未保存」
            // 留在首页：新工程就一个插件组，直接显示出来让用户接着建/进去
            this.renderAll();
            return true;
          },
        },
      ],
    });
  }

  codeModeDialog() {
    const mod = store.activeModule();
    const r = generatePlugin({ ...store.store.project, modules: [{ ...mod, canvases: [store.activeCanvas()] }] });
    const f = r.files.find(x => !x.path.endsWith('module.kts'));
    const text = f ? f.content : '';
    const body = `<div class="codemode code-dark">
      <div class="cm-hint">这是这张画布导出的完整代码。<b>只读预览</b>——想改结构请回到画布上改。</div>
      <pre class="cm-code">${highlightWithLines(text)}</pre>
    </div>`;
    return this.modal({
      title: '代码预览',
      body,
      wide: true,
      buttons: [
        { label: '关闭', value: null },
        {
          label: '复制代码', onClick: () => {
            navigator.clipboard.writeText(text).then(
              () => this.toast('代码已复制到剪贴板', 'ok'),
              () => this.toast('复制失败', 'error'));
            return undefined;
          },
        },
        {
          label: '从代码还原画布', kind: 'primary', onClick: () => {
            this.closeModal();
            const p = parseKts(text);
            if (!p.ok) { this.toast(p.error, 'error'); return; }
            this.toast('这张画布本来就是从这里生成的，内容和现在一致', 'ok');
          },
        },
      ],
    });
  }

  showProblems(prefix) {
    const { errors, warnings } = this.problems;
    const list = (arr, cls) => arr.map(e => `
      <div class="prob ${cls}" ${e.nodeId ? `data-node="${esc(e.nodeId)}"` : ''}>
        <span class="prob-icon">${cls === 'err' ? IC.cross : IC.bang}</span>
        <span class="prob-text">${esc(e.message)}</span>
        ${e.canvasTitle ? `<span class="prob-where">${esc(e.canvasTitle)}</span>` : ''}
      </div>`).join('');
    const body = `<div class="prob-list">
      ${prefix ? `<div class="prob-prefix">${esc(prefix)}</div>` : ''}
      ${errors.length ? `<div class="prob-head">错误（必须先修好）</div>${list(errors, 'err')}` : ''}
      ${warnings.length ? `<div class="prob-head">提醒（不影响导出）</div>${list(warnings, 'warn')}` : ''}
      ${!errors.length && !warnings.length ? `<div class="prob-none">${IC.check}没有任何问题</div>` : ''}
    </div>`;
    setTimeout(() => {
      this.el.modal.querySelectorAll('[data-node]').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.dataset.node;
          const found = M.findCanvas(store.store.project, store.store.activeCanvasId);
          if (found && found.canvas.nodes.some(n => n.id === id)) {
            store.store.selection = [id];
            this.closeModal();
            this.renderAll();
            this.inspector.show(id);
          } else {
            for (const m of store.store.project.modules) {
              for (const c of m.canvases) {
                if (c.nodes.some(n => n.id === id)) {
                  store.setActiveCanvas(c.id);
                  store.store.selection = [id];
                  this.closeModal();
                  this.renderAll();
                  this.inspector.show(id);
                  return;
                }
              }
            }
          }
        });
      });
    }, 0);
    return this.modal({ title: '问题清单', body, wide: true, buttons: [{ label: '知道了', kind: 'primary', value: null }] });
  }

  helpDialog() {
    return this.modal({
      title: '怎么用',
      body: `<div class="help">
        <div class="help-step"><b>1.</b> 从左边 <span class="k">当……发生时</span> 分类里拖一个到画布</div>
        <div class="help-step"><b>2.</b> 再拖一个 <span class="k">要做的事</span> 进来，把第一个右边的小圆点拖到它左边的圆点上</div>
        <div class="help-step"><b>3.</b> 点中方块，在右边把参数填好</div>
        <div class="help-step"><b>4.</b> 看右下角的代码预览确认是你想要的，然后点 <span class="k">导出插件</span></div>
        <div class="help-tip">
          <div>· 一个画布 = 一个 .kts 文件；多个画布组成一个插件</div>
          <div>· 连线表示「包含」：动作会写进事件的花括号里</div>
          <div>· 条件控件有两个出口：「就」和「否则」</div>
          <div>· 左键拖动方块可以移动它；<b>左键拖动空白处就是平移画布</b></div>
          <div>· 滚轮缩放（以鼠标位置为中心）；右键拖 / 空格+左键拖也能平移</div>
          <div>· 要同时改多个方块，按住 Ctrl 逐个点是另一种选法</div>
          <div>· Ctrl+Z 撤销，Ctrl+S 保存工程，Ctrl+Enter 导出</div>
          <div>· 导出的文件夹放进服务器的 scripts 目录，再用 /sa scan 加载</div>
        </div>
      </div>`,
      buttons: [{ label: '知道了', kind: 'primary', value: null }],
    });
  }

  toast(msg, kind = 'ok', transient) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.className = 'toast ' + kind;
    el.textContent = msg;
    el.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; }, transient ? 1800 : 4200);
  }
}

function collectUnknown(p) {
  const bad = [];
  for (const m of p.modules) for (const c of m.canvases) for (const n of c.nodes) {
    if (!defOf(n.def)) bad.push(n.def);
  }
  return bad;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
