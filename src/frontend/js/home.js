// 首页（主界面）：整窗替换工作区，启动时进入。
//
// 为什么要有首页：以前一进来就是画布，用户得先想「我在哪个模块里」，
// 还要自己去工具栏找「新建模块 / 打开 / 设置」。首页把「选一个插件组开工」
// 这件事摆到台面上，画布只负责「编这一个插件组」。
//
// 它和画布是**两个视图**，不是两回事：首页 = 选插件组，画布 = 编插件组。
//
// 用法：
//   const home = new HomePage({ root, onOpenCanvas, onSettings, onOpenProject, onImportKts });
//   home.open();    // 显示首页（同时隐藏工作区）
//   home.close();   // 回到工作区
//
// 注：它不直接 import ui.js（会成环），所有动作都由外面注入回调。

import * as store from './store.js';
import { VERSION } from './version.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 一个插件组里一共放了多少个控件（所有画布相加） */
function nodeCount(mod) {
  let n = 0;
  for (const c of mod.canvases || []) n += (c.nodes || []).length;
  return n;
}

/** 一个插件组里一共有几条连线 */
function edgeCount(mod) {
  let n = 0;
  for (const c of mod.canvases || []) n += (c.edges || []).length;
  return n;
}

export class HomePage {
  constructor(opts = {}) {
    this.root = opts.root;
    // 这些动作都在外面（ui.js）实现，首页只负责「点哪个」。
    this.onOpenCanvas = opts.onOpenCanvas || (() => {});     // 进入某个插件组的画布
    this.onSettings = opts.onSettings || (() => {});         // 打开设置
    this.onOpenProject = opts.onOpenProject || (() => {});   // 打开 .saproj
    this.onImportKts = opts.onImportKts || (() => {});       // 从代码还原
    this.onNewProject = opts.onNewProject || (() => {});     // 新建工程
    this.onDeleteModule = opts.onDeleteModule || (() => {}); // 删插件组（由外面确认）
    this.onRenameModule = opts.onRenameModule || (() => {}); // 改插件组名
    // 第 15 轮：新建插件组要走**弹窗**（填名字 + 选模板），和其它新建入口一致，
    // 所以具体弹窗实现放在 ui.js，首页只负责发起。
    this.onNewModule = opts.onNewModule || (() => {});
    this.open_ = false;
  }

  isOpen() { return this.open_; }

  open() {
    this.open_ = true;
    this.root.hidden = false;
    this.render();
  }

  close() {
    this.open_ = false;
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  /** 工程变了（新建/删除插件组、改了内容）就重画一次列表 */
  refresh() {
    if (this.open_) this.render();
  }

  render() {
    const p = store.store.project;
    if (!p) return;
    const mods = p.modules || [];
    // 当前画布属于哪个插件组，用来在列表里标「上次编辑」
    const cur = store.activeModule();
    const curId = cur ? cur.id : null;

    const cards = mods.map((m) => {
      const nc = (m.canvases || []).length;
      const nodes = nodeCount(m);
      const edges = edgeCount(m);
      const file = (m.canvases && m.canvases[0] && m.canvases[0].file) || 'main';
      return `
        <div class="hm-card${m.id === curId ? ' is-cur' : ''}" data-mod="${esc(m.id)}" role="button" tabindex="0">
          <div class="hm-card-main">
            <div class="hm-card-top">
              <span class="hm-card-name">${esc(m.id)}</span>
              ${m.id === curId ? '<span class="hm-cur">上次编辑</span>' : ''}
            </div>
            <div class="hm-card-meta">
              ${nc} 个画布 · ${nodes} 个控件 · ${edges} 条连线 · ${esc(file)}.kts
            </div>
          </div>
          <div class="hm-card-acts">
            <button class="hm-mini" data-ren="${esc(m.id)}" title="改插件组名字">改名</button>
            ${mods.length > 1 ? `<button class="hm-mini hm-del" data-del="${esc(m.id)}" title="删掉这个插件组">删除</button>` : ''}
          </div>
        </div>`;
    }).join('');

    // 第 15 轮：新建插件组改成**弹窗**（填名字 + 选模板），
    // 不再在首页就地展开输入行 —— 和「新建画布 / 新建模块」保持一致的交互。
    const newRow = `<button class="hm-newbtn" id="hmNewBtn">＋ 新建插件组</button>`;

    this.root.innerHTML = `
      <div class="hm-wrap">
        <header class="hm-head">
          <div class="hm-logo">KTS</div>
          <div class="hm-titles">
            <h1>KTS 插件工坊</h1>
            <p>拖控件 → 生成 .kts 插件 · v${esc(VERSION)}</p>
          </div>
          <div class="hm-head-acts">
            <button class="btn" data-hact="open">打开工程</button>
            <button class="btn" data-hact="import">从代码还原</button>
            <button class="btn" data-hact="newProject">新建工程</button>
            <button class="btn" data-hact="settings">设置</button>
          </div>
        </header>

        <section class="hm-body">
          <div class="hm-sec-head">
            <h2>插件组</h2>
            <span class="hm-sec-note">${mods.length} 个 · 每个插件组导出后是一个独立文件夹</span>
          </div>
          <div class="hm-list">${cards || '<div class="hm-empty">还没有插件组</div>'}</div>
          ${newRow}
        </section>

        <footer class="hm-foot">
          选中一个插件组进入画布，或新建一个。工程会自动保存在本机。
        </footer>
      </div>`;

    this.bind();
  }

  bind() {
    const q = (s) => this.root.querySelector(s);
    const qa = (s) => [...this.root.querySelectorAll(s)];

    // 顶部四个入口
    qa('[data-hact]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.hact;
      if (a === 'settings') this.onSettings();
      else if (a === 'open') this.onOpenProject();
      else if (a === 'import') this.onImportKts();
      else if (a === 'newProject') this.onNewProject();
    }));

    // 点卡片进画布；点「改名 / 删除」不要顺带进画布
    qa('[data-mod]').forEach((card) => {
      const enter = () => this.onOpenCanvas(card.dataset.mod);
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-ren],[data-del]')) return;
        enter();
      });
      card.addEventListener('keydown', (e) => {
        if (e.target.closest('[data-ren],[data-del]')) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enter(); }
      });
    });
    qa('[data-ren]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onRenameModule(b.dataset.ren);
    }));
    qa('[data-del]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onDeleteModule(b.dataset.del);
    }));

    // 新建插件组：交给 ui.js 弹窗（填名字 + 选模板）
    const nb = q('#hmNewBtn');
    if (nb) nb.addEventListener('click', () => this.onNewModule());
  }

  /** 建完之后刷新首页列表（弹窗里已经调用 store.addModule） */
  refresh() { if (this.open_) this.render(); }
}
