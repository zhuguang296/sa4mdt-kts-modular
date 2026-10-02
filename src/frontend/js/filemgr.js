// 插件文件管理器（右栏，第 15 轮新增）。
//
// 为什么要有它：一个插件组导出后是**一个文件夹**，里面每个画布 = 一个 .kts
// 文件。以前的界面只在顶部有一排标签页，用户看不出「我现在这套东西会产出
// 哪几个文件」。这里把「文件」这件事摆到右栏明面上：
//   - 列出本插件组的每一个 .kts（= 一张画布），显示文件名、控件数、连线数
//   - 点一下切过去编辑
//   - 新建 / 改名 / 复制 / 删除，都在这一处
//
// 它只是「视图 + 操作入口」：所有改动都走 store，由 store 统一触发重绘。

import * as store from './store.js';
import * as M from './model.js';
import { defOf } from './catalog/index.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 一张画布统计出「里面有多少东西」，用来在文件行里显示规模 */
function statOf(canvas) {
  const nodes = (canvas.nodes || []).length;
  const edges = (canvas.edges || []).length;
  // 有问题的地方单独标一下（有错误就无法导出）
  let errs = 0;
  for (const n of canvas.nodes || []) {
    const d = defOf(n.def);
    if (!d) { errs++; continue; }
    for (const p of d.props || []) {
      if (p.required && (n.props == null || n.props[p.key] == null || n.props[p.key] === '')) { errs++; break; }
    }
  }
  return { nodes, edges, errs };
}

export class FileManager {
  constructor(opts = {}) {
    this.root = opts.root;
    this.onNewCanvas = opts.onNewCanvas || (() => {});
    this.onRenameCanvas = opts.onRenameCanvas || (() => {});
    this.onDeleteCanvas = opts.onDeleteCanvas || (() => {});
    this.onDuplicateCanvas = opts.onDuplicateCanvas || (() => {});
    this.onToast = opts.onToast || (() => {});
    this.root.addEventListener('click', (e) => this.onClick(e));
  }

  /** 当前插件组 */
  currentModule() {
    const ref = store.activeRef();
    return ref ? ref.module : (store.store.project.modules[0] || null);
  }

  render() {
    const mod = this.currentModule();
    if (!mod) { this.root.innerHTML = '<div class="fm-empty">没有插件组</div>'; return; }
    const activeId = store.store.activeCanvasId;
    const rows = (mod.canvases || []).map((c) => {
      const s = statOf(c);
      const isCur = c.id === activeId;
      return `
        <div class="fm-item${isCur ? ' is-cur' : ''}" data-canvas="${esc(c.id)}" role="button" tabindex="0"
             title="点一下切过去编辑">
          <div class="fm-item-main">
            <div class="fm-name" title="${esc(c.file)}.kts">
              <span class="fm-dot"></span>
              <span class="fm-fname">${esc(c.file)}.kts</span>
            </div>
            <div class="fm-sub">
              <span class="fm-title" title="${esc(c.title)}">${esc(c.title)}</span>
              <span class="fm-stat">${s.nodes} 控件 · ${s.edges} 连线</span>
              ${s.errs ? `<span class="fm-err" title="有 ${s.errs} 处必填没填，导出会被拦下">${s.errs} 处待填</span>` : ''}
            </div>
          </div>
          <div class="fm-item-acts">
            <button class="fm-mini" data-act="rename" data-canvas="${esc(c.id)}" title="改文件名和标题">改名</button>
            <button class="fm-mini" data-act="dup" data-canvas="${esc(c.id)}" title="复制一份">复制</button>
            ${(mod.canvases || []).length > 1
              ? `<button class="fm-mini fm-del" data-act="del" data-canvas="${esc(c.id)}" title="删掉这个文件">删除</button>`
              : ''}
          </div>
        </div>`;
    }).join('');

    this.root.innerHTML = `
      <div class="fm-head">
        <h3>插件文件</h3>
        <button class="fm-new" data-act="new" title="再建一个 .kts 文件">＋ 新建文件</button>
      </div>
      <div class="fm-mod" title="导出后是一个同名文件夹">
        <span class="fm-mod-ic">📁</span>
        <span class="fm-mod-name">${esc(mod.id)}</span>
        <span class="fm-mod-n">${(mod.canvases || []).length} 个文件</span>
      </div>
      <div class="fm-list">${rows || '<div class="fm-empty">还没有文件</div>'}</div>
      <div class="fm-foot">一个文件 = 一张画布，导出后放进 scripts/${esc(mod.id)}/</div>`;
  }

  onClick(e) {
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      e.stopPropagation();
      const id = actBtn.dataset.canvas;
      const act = actBtn.dataset.act;
      if (act === 'new') this.onNewCanvas();
      else if (act === 'rename') this.onRenameCanvas(id);
      else if (act === 'dup') this.onDuplicateCanvas(id);
      else if (act === 'del') this.onDeleteCanvas(id);
      return;
    }
    const item = e.target.closest('[data-canvas]');
    if (item) {
      const id = item.dataset.canvas;
      if (id !== store.store.activeCanvasId) {
        store.setActiveCanvas(id);
        store.emit('canvas');
      }
    }
  }
}

/** 给外部复用的：某个画布对应的「文件名」提示文本 */
export function fileLabel(canvas) {
  return String((canvas && canvas.file) || M.toFileName('main', 'main')) + '.kts';
}
