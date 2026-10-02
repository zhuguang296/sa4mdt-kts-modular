// 画布：自由摆放 + 贝塞尔连线（SVG 覆盖层）+ 拖拽 + 平移 + 缩放
import * as M from './model.js';
import { defOf, CATEGORY_LABEL } from './catalog/index.js';
import * as store from './store.js';
import * as S from './settings.js';
import { log } from './log.js';

const NS = 'http://www.w3.org/2000/svg';
export const NODE_W = 260;
const HEAD_H = 34;
const ROW_H = 22;
const PAD = 8;

/** 缩放范围：25% ~ 250% */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2.5;

// ---------------- 坐标换算（纯函数，便于单测） ----------------
// 屏幕坐标 = viewport 左上角 + pan + 世界坐标 * zoom；两侧必须严格互逆，
// 否则连线会与节点错位。

export function worldToScreenPt(wx, wy, view, panX, panY, zoom) {
  return {
    x: view.left + panX + wx * zoom,
    y: view.top + panY + wy * zoom,
  };
}

export function screenToWorldPt(sx, sy, view, panX, panY, zoom) {
  return {
    x: (sx - view.left - panX) / zoom,
    y: (sy - view.top - panY) / zoom,
  };
}

/** 缩放时保持光标下的世界点不动，返回新的 pan */
export function panForZoomAt(cursorX, cursorY, view, panX, panY, oldZoom, newZoom) {
  const before = screenToWorldPt(cursorX, cursorY, view, panX, panY, oldZoom);
  // 解 screenToWorldPt(...newZoom) === before
  return {
    panX: cursorX - view.left - before.x * newZoom,
    panY: cursorY - view.top - before.y * newZoom,
  };
}

/** 计算「适应视野」的 pan/zoom */
export function fitTransform(bounds, viewW, viewH, pad = 60, maxZoom = 1.2, minZoom = 0.3) {
  if (!bounds || !isFinite(bounds.minX)) {
    return { zoom: 1, panX: 40, panY: 40 };
  }
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min((viewW - pad * 2) / w, (viewH - pad * 2) / h)));
  const panX = pad - bounds.minX * zoom + Math.max(0, (viewW - pad * 2 - w * zoom) / 2);
  const panY = pad - bounds.minY * zoom;
  return { zoom, panX, panY };
}

export class CanvasView {
  constructor(root) {
    this.root = root;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.drag = null;        // 拖动节点
    this.panning = null;     // 平移画布
    this.linking = null;     // 拉线
    this.snapTarget = null;  // 拉线时吸附到的圆圈（第 15 轮：两端精准对准）
    this.lastConnectReason = ''; // 上一次报过的连接失败原因（避免 mousemove 刷屏）
    this.hoverNode = null;
    this.draggingDef = '';   // 正在从控件库拖入的控件 key
    this.onConnectError = null;  // 连线失败回调（右侧面板展示原因）
    this.onOpenInspector = null; // 双击控件 → 打开参数弹窗（第 17 轮）
    this.build();
    this.bindEvents();
  }

  build() {
    this.root.innerHTML = `
      <div class="cv-viewport" tabindex="0">
        <svg class="cv-edges" xmlns="${NS}"></svg>
        <div class="cv-nodes"></div>
        <div class="cv-dropzone" hidden></div>
        <div class="cv-hint" hidden></div>
      </div>`;
    this.viewport = this.root.querySelector('.cv-viewport');
    this.svg = this.root.querySelector('.cv-edges');
    this.nodesLayer = this.root.querySelector('.cv-nodes');
    this.dropEl = this.root.querySelector('.cv-dropzone');
    this.hintEl = this.root.querySelector('.cv-hint');
    this.defs = document.createElementNS(NS, 'defs');
    // 与 CSS 里的 --line-2 / --accent 保持一致（箭头在 SVG 里，取不到 CSS 变量）
    this.defs.innerHTML = `
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa3b8"/>
      </marker>
      <marker id="arrow-hi" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb"/>
      </marker>`;
    this.svg.appendChild(this.defs);
    this.edgeLayer = document.createElementNS(NS, 'g');
    this.svg.appendChild(this.edgeLayer);
    this.tempEdge = document.createElementNS(NS, 'path');
    this.tempEdge.setAttribute('class', 'cv-temp-edge');
    this.tempEdge.style.display = 'none';
    this.svg.appendChild(this.tempEdge);

    // 视口尺寸变了要同步 SVG 的 viewBox，否则连线会错位
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.applyTransform());
      this.ro.observe(this.viewport);
    }
  }

  // ---------------- 坐标换算 ----------------

  toWorld(clientX, clientY) {
    const r = this.viewport.getBoundingClientRect();
    return screenToWorldPt(clientX, clientY, r, this.panX, this.panY, this.zoom);
  }

  applyTransform() {
    // SVG 与节点层都用 translate(pan) scale(zoom)，原点在左上角。SVG 的 viewBox
    // 必须和它的像素尺寸 1:1（下面按视口尺寸设置），这样路径里的世界坐标 x 才会
    // 落在与节点相同的屏幕位置 panX + x*zoom。
    const r = this.viewport.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));

    this.nodesLayer.style.transformOrigin = '0 0';
    this.nodesLayer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;

    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.style.width = w + 'px';
    this.svg.style.height = h + 'px';
    this.svg.style.transformOrigin = '0 0';
    this.svg.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;

    this.applyGrid();
  }

  /** 背景网格：格点间距按缩放换算成屏幕像素，background-position 用 panX/panY 跟着平移走。 */
  applyGrid() {
    const on = !!S.get('showGrid');
    this.viewport.classList.toggle('show-grid', on);
    if (!on) return;
    const size = Math.max(4, S.get('gridSize') || 20) * this.zoom;
    this.viewport.style.setProperty('--grid-size', size + 'px');
    this.viewport.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
  }

  /** 拖动时吸附到格点（只在设置打开时生效）。吸附节点左上角，同列控件自然对齐。 */
  snap(x, y) {
    if (!S.get('snapToGrid')) return { x, y };
    const g = Math.max(4, S.get('gridSize') || 20);
    return { x: Math.round(x / g) * g, y: Math.round(y / g) * g };
  }

  // ---------------- 拖入落点提示 ----------------

  /** 拖放中 dataTransfer.getData() 返回空字符串，所以 dragstart 时要把 key 记在实例上。 */
  dragDefKey() {    return this.draggingDef || '';
  }

  /** 在鼠标位置显示一块「将要生成的卡片」虚影 */
  showDropHint(clientX, clientY, key) {
    const d = defOf(key);
    if (!d || !this.dropEl) return;
    const p = this.toWorld(clientX, clientY);
    const r = this.viewport.getBoundingClientRect();
    // 与 drop 时的落点保持一致：节点左上角 = (p.x - NODE_W/2, p.y - 20)
    const sx = r.left + this.panX + (p.x - NODE_W / 2) * this.zoom;
    const sy = r.top + this.panY + (p.y - 20) * this.zoom;
    const w = NODE_W * this.zoom;
    const h = (HEAD_H + ROW_H) * this.zoom;

    this.dropEl.hidden = false;
    this.dropEl.style.left = (sx - r.left) + 'px';
    this.dropEl.style.top = (sy - r.top) + 'px';
    this.dropEl.style.width = w + 'px';
    this.dropEl.style.height = h + 'px';
    this.dropEl.dataset.cat = d.category;
    this.dropEl.textContent = d.label;
    this.dropEl.style.fontSize = Math.max(9, Math.round(11 * this.zoom)) + 'px';
  }

  clearDropHint() {
    if (this.dropEl) { this.dropEl.hidden = true; this.dropEl.textContent = ''; }
  }

  // ---------------- 渲染 ----------------

  render() {
    const canvas = store.activeCanvas();
    if (!canvas) return;
    this.applyTransform();
    this.renderNodes(canvas);
    this.renderEdges(canvas);
    this.renderHint(canvas);
  }

  nodeHeight(d) {
    const rows = (d && d.props ? d.props.length : 0);
    return HEAD_H + rows * ROW_H + PAD;
  }

  renderNodes(canvas) {
    const sel = new Set(store.store.selection);
    const existing = new Map();
    for (const el of this.nodesLayer.children) existing.set(el.dataset.id, el);

    const keep = new Set();
    for (const node of canvas.nodes) {
      keep.add(node.id);
      let el = existing.get(node.id);
      if (!el) {
        el = this.createNodeEl(node);
        // 新节点播放「弹入」动画（CSS 只用独立 scale 属性，不碰 inline transform）
        el.classList.add('cv-new');
        this.nodesLayer.appendChild(el);
      }
      el.dataset.id = node.id;
      el.style.transform = `translate(${node.x}px, ${node.y}px)`;
      el.classList.toggle('selected', sel.has(node.id));
      this.updateNodeContent(el, node, canvas);
    }
    // 删除动画：加 .cv-out 播放缩小淡出，动画结束（140ms）后再真正移除 DOM。
    // 延迟移除期间节点已从 store 删掉，只是残留一个正在消失的视觉层。
    // 已标记过 .cv-out 的元素不重复处理（否则多次 render 会叠定时器）。
    const leaving = [];
    for (const [id, el] of existing) if (!keep.has(id) && !el.classList.contains('cv-out')) leaving.push(el);
    for (const el of leaving) {
      el.classList.add('cv-out');
      setTimeout(() => { if (el.isConnected) el.remove(); }, 160);
    }
  }

  /**
   * 造一张节点卡片的骨架。
   *
   * 第 15 轮关键修正：圆点必须**按控件自己的端口定义**来画。
   * 以前不管什么控件都硬画一个入口 + 一个出口 —— 那些其实没有入口的控件
   * （比如各种「当……发生时」事件）看上去也有入口圆圈，可用户拖过去时
   * 系统又查不到这个端口，于是「拖到圆圈上什么都不发生、也不变红」
   * （用户报的第 4 条）。现在画得出就一定认得出。
   */
  createNodeEl(node) {
    const el = document.createElement('div');
    el.className = 'cv-node';
    const d = defOf(node.def);
    const inPorts = (d && d.inPorts) || [];
    const outPorts = (d && d.outPorts) || [];
    const inHtml = inPorts.length
      ? '<div class="cv-port cv-port-in" data-port="in" title="入口"></div>' : '';
    // 多个出口（「如果……就 / 否则」）上下错开，各自带 data-port，方便精准取位
    const outHtml = outPorts.map((p, i) => {
      const off = outPorts.length > 1 ? (i === 0 ? -1 : 1) * 16 : 0;
      const style = off ? ` style="margin-top:${off * 2}px"` : '';
      const label = outPorts.length > 1 ? `（${p.label || p.id}）` : '';
      return `<div class="cv-port cv-port-out" data-port="${esc(p.id)}"`
        + ` title="拖这里连到下一个控件${label}"${style}></div>`;
    }).join('');
    el.innerHTML = `
      <div class="cv-node-head">
        <span class="cv-node-cat"></span>
        <span class="cv-node-title"></span>
        <button class="cv-node-del" title="删除">×</button>
      </div>
      <div class="cv-node-body"></div>
      ${inHtml}${outHtml}`;
    return el;
  }

  updateNodeContent(el, node, canvas) {
    const d = defOf(node.def);
    const head = el.querySelector('.cv-node-head');
    const cat = el.querySelector('.cv-node-cat');
    const title = el.querySelector('.cv-node-title');
    const body = el.querySelector('.cv-node-body');

    el.dataset.cat = d ? d.category : 'unknown';
    el.classList.toggle('is-root', !!(d && (d.isRoot || d.category === 'event' || d.canBeRoot)));
    el.classList.toggle('has-error', this.errorNodes && this.errorNodes.has(node.id));

    cat.textContent = d ? (CATEGORY_LABEL[d.category] || d.category) : '未知';
    title.textContent = d ? d.label : node.def;
    title.title = d ? d.codeHint : node.def;

      // 参数摘要
    const rows = [];
    if (d) {
      // 第 15 轮：节点卡片上不再显示「生成：xxx」那行代码提示（用户要求删掉），
      // 只留用户自己填的参数。代码提示仍留在控件库卡片和右侧参数面板里。
      for (const p of d.props || []) {
        if (p.type === 'rules') {
          const n = ((node.props && node.props.rules) || []).length;
          rows.push({ k: p.label, v: n ? `${n} 条` : '（未设置）', cls: n ? '' : 'muted' });
          continue;
        }
        if (p.showIf && !visible(node, p)) continue;
        let v = node.props ? node.props[p.key] : undefined;
        if (p.type === 'select') {
          const opt = (p.options || []).find(o => o[0] === v);
          v = opt ? opt[1] : (v || '');
        } else if (p.type === 'boolean') {
          v = v ? '是' : '否';
        }
        if (v == null || v === '') v = '（未填）';
        rows.push({ k: p.label, v: String(v), cls: (node.props && node.props[p.key] != null && node.props[p.key] !== '') ? '' : 'muted' });
      }
    }
    // 第 15 轮：没有参数可显示时，**整块 body 收起来**。
    // 以前不管有没有内容都留着 padding，卡片标题下面就是一条空白带，
    // 看着像坏了（用户反馈第 1 条）。现在没内容 = 卡片只有标题那一行。
    if (!rows.length) {
      body.hidden = true;
      body.innerHTML = '';
      el.classList.add('no-body');
      return;
    }
    body.hidden = false;
    el.classList.remove('no-body');
    body.innerHTML = rows.slice(0, 6).map(r =>
      `<div class="cv-row"><span class="cv-k">${esc(r.k)}</span><span class="cv-v ${r.cls || ''}">${esc(truncate(r.v, 34))}</span></div>`
    ).join('') + (rows.length > 6 ? `<div class="cv-row more">…还有 ${rows.length - 6} 项</div>` : '');
  }

  renderEdges(canvas) {
    const byId = new Map(canvas.nodes.map(n => [n.id, n]));
    const g = this.edgeLayer;
    g.innerHTML = '';
    for (const e of canvas.edges) {
      const a = byId.get(e.from.node), b = byId.get(e.to.node);
      if (!a || !b) continue;
      const from = this.portPos(a, 'out', e.from.port);
      const to = this.portPos(b, 'in');
      const d = bezier(from, to);

      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'cv-edge' + (e.kind === 'ref' ? ' ref' : ''));
      path.dataset.edge = e.id;

      // 加宽的隐形命中路径：1px 的线太难点中
      const hit = document.createElementNS(NS, 'path');      hit.setAttribute('d', d);
      hit.setAttribute('class', 'cv-edge-hit');
      hit.dataset.edge = e.id;

      // 悬停时浮出删除按钮。不用右键菜单：右键单击不弹菜单是本画布既有的约定
      // （右键是平移手势）。也不用双击：拖拽/连线的收尾容易误触发。
      const del = document.createElementNS(NS, 'g');
      del.setAttribute('class', 'cv-edge-del');
      del.dataset.edge = e.id;
      // 摆在贝塞尔曲线中点：按参数方程取 t=0.5
      const mid = bezierMidpoint(from, to);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', mid.x);
      c.setAttribute('cy', mid.y);
      c.setAttribute('r', 11);
      c.setAttribute('class', 'cv-edge-del-bg');
      const cross = document.createElementNS(NS, 'path');
      const s = 4;
      cross.setAttribute('d',
        `M ${mid.x - s} ${mid.y - s} L ${mid.x + s} ${mid.y + s} ` +
        `M ${mid.x + s} ${mid.y - s} L ${mid.x - s} ${mid.y + s}`);
      cross.setAttribute('class', 'cv-edge-del-x');
      del.appendChild(c);
      del.appendChild(cross);

      const remove = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        // 和节点上的 × 一样直接改 store 再重绘，不绕回调
        store.removeEdge(e.id);
        log.action('删除连线', `${a.def || a.id} → ${b.def || b.id}`);
        this.render();
        this.onSelect && this.onSelect(null);
      };
      del.addEventListener('click', remove);
      del.addEventListener('mousedown', (ev) => ev.stopPropagation());
      del.addEventListener('pointerdown', (ev) => ev.stopPropagation());

      g.appendChild(path);
      g.appendChild(hit);
      g.appendChild(del);
    }
  }

  /**
   * 端口（圆圈）中心的世界坐标。
   *
   * 第 15 轮改为**优先读真实 DOM 位置**：卡片的实际高度由 CSS 决定
   * （字号、换行、行数上限都会影响），用 HEAD_H + 行数×ROW_H 估算出来的
   * y 和圆圈真正所在的位置能差好几个像素 —— 连线就会「对不准圆圈」。
   * 现在直接量圆圈的屏幕矩形再换算回世界坐标，连线两端天然重合。
   */
  portPos(node, which, portId) {
    const d = defOf(node.def);
    const el = this.nodesLayer.querySelector(`[data-id="${node.id}"]`);
    if (el) {
      // 用 data-port 精准定位：多出口时也能一次取对（不再靠第几个圆圈猜）
      const sel = which === 'in' ? '.cv-port-in' : '.cv-port-out';
      let portEl = null;
      if (portId) portEl = el.querySelector(`${sel}[data-port="${portId}"]`);
      if (!portEl) portEl = el.querySelector(sel);
      if (portEl) {
        const r = portEl.getBoundingClientRect();
        if (r.width || r.height) {
          const vr = this.viewport.getBoundingClientRect();
          return {
            x: (r.left + r.width / 2 - vr.left - this.panX) / this.zoom,
            y: (r.top + r.height / 2 - vr.top - this.panY) / this.zoom,
          };
        }
      }
    }
    // 回退：DOM 还没渲染出来时按估算值算
    const h = this.nodeHeight(d);
    const y = node.y + h / 2;
    const x = which === 'in' ? node.x : node.x + NODE_W;
    let off = 0;
    if (which === 'out' && d && (d.outPorts || []).length > 1) {
      const idx = (d.outPorts || []).findIndex(p => p.id === portId);
      if (idx >= 0) off = (idx === 0 ? -1 : 1) * 16;
    }
    return { x, y: y + off };
  }

  renderHint(canvas) {
    if (!canvas.nodes.length) {
      this.hintEl.hidden = false;
      this.hintEl.innerHTML = `
        <div class="cv-empty">
          <div class="cv-empty-icon">＋</div>
          <div class="cv-empty-title">从左边把「当……发生时」拖进来开始</div>
          <div class="cv-empty-sub">或者点工具栏的「套用模板」直接看一个能用的例子</div>
        </div>`;
    } else {
      this.hintEl.hidden = true;
    }
  }

  setErrors(nodeIds) {
    this.errorNodes = new Set(nodeIds || []);
    this.render();
  }

  // ---------------- 事件 ----------------

  bindEvents() {
    const vp = this.viewport;

    // 从控件库拖入。dragover 必须 preventDefault，否则浏览器不会触发 drop。
    // 同时给出落点提示：空白处高亮一块「将要生成卡片」的虚影。
    vp.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const key = this.dragDefKey();
      if (key) this.showDropHint(e.clientX, e.clientY, key);
      else this.clearDropHint();
    });
    vp.addEventListener('dragleave', (e) => {
      // 只有真的离开画布才清掉提示（在子元素间移动也会触发 dragleave）
      if (!vp.contains(e.relatedTarget)) this.clearDropHint();
    });
    vp.addEventListener('drop', (e) => {
      e.preventDefault();
      this.clearDropHint();
      const key = e.dataTransfer.getData('text/kts-def') || this.dragDefKey();
      if (!key) return;
      if (!defOf(key)) { this.onToast && this.onToast('未知控件：' + key, 'error'); return; }
      const p = this.toWorld(e.clientX, e.clientY);
      const spot = this.snap(p.x - NODE_W / 2, p.y - 20);
      const node = store.addNode(key, spot.x, spot.y, defaultProps(key));
      store.store.selection = [node.id];
      this.render();
      this.onSelect && this.onSelect(node.id);
    });

    // 左键拖空白处 / 右键 / 中键 / 空格+左键 平移；滚轮缩放
    vp.addEventListener('mousedown', (e) => {
      const nodeEl = e.target.closest('.cv-node');
      const portEl = e.target.closest('.cv-port');
      const delBtn = e.target.closest('.cv-node-del');

      if (delBtn) {
        e.stopPropagation();
        const id = nodeEl.dataset.id;
        store.removeNodes([id]);
        this.render();
        this.onSelect && this.onSelect(null);
        return;
      }

      // 从出口拉线。端口 id 直接读圆点上的 data-port —— 多出口（就 / 否则）
      // 时才能从正确的那个出口开始，而不是永远拿第一个。
      if (portEl && portEl.classList.contains('cv-port-out')) {
        e.preventDefault();
        const id = nodeEl.dataset.id;
        const node = store.activeCanvas().nodes.find(n => n.id === id);
        const d = defOf(node.def);
        const ports = (d.outPorts || []).map(p => p.id);
        const startPort = portEl.dataset.port || ports[0] || 'out';
        this.linking = {
          fromId: id, fromPort: startPort, ports,
          pos: this.portPos(node, 'out', startPort),
        };
        this.tempEdge.style.display = '';
        return;
      }

      // 从入口拉线（反向）
      if (portEl && portEl.classList.contains('cv-port-in')) {
        e.preventDefault();
        const id = nodeEl.dataset.id;
        const node = store.activeCanvas().nodes.find(n => n.id === id);
        this.linking = { toId: id, toPort: 'in', pos: this.portPos(node, 'in', 'in') };
        this.tempEdge.style.display = '';
        return;
      }

      // 平移画布：左键拖空白处（主方式）、右键、中键、Alt+左键、空格+左键。
      // 要同时选多个节点就按住 Ctrl 逐个点。
      const onEmpty = !nodeEl;

      // 右键按在节点上：记下候选菜单但不立刻弹出 —— 右键拖拽是平移手势，按下就
      // 弹会让每次平移都先闪一个菜单；等 mouseup 确认「没拖动过」才真的弹。
      if (e.button === 2 && nodeEl) {
        this.pendingNodeMenu = { id: nodeEl.dataset.id, x: e.clientX, y: e.clientY };
      } else if (e.button === 2) {
        this.pendingNodeMenu = null;   // 空白处右键不弹菜单
      }

      const isPanButton = (e.button === 2) || (e.button === 1) ||
        (e.button === 0 && (onEmpty || e.altKey || this.spaceDown));
      if (isPanButton) {
        // 左键点空白处顺便取消选中：拖动了就是平移，没拖动就是「点了下空白」。
        if (e.button === 0 && onEmpty && !e.ctrlKey && !e.metaKey) {
          store.store.selection = [];
          this.render();
          this.onSelect && this.onSelect(null);
        }
        this.panning = { x: e.clientX, y: e.clientY, px: this.panX, py: this.panY, moved: false };
        vp.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      // 拖动节点
      if (nodeEl && e.button === 0) {
        const id = nodeEl.dataset.id;
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          const set = new Set(store.store.selection);
          if (set.has(id)) set.delete(id); else set.add(id);
          store.store.selection = [...set];
        } else if (!store.store.selection.includes(id)) {
          store.store.selection = [id];
        }
        this.render();
        // 第 17 轮：单击只**选中**（高亮 + 允许拖动），不弹参数窗。
        // 弹窗改由双击触发（见下面的 dblclick）——拖控件时老是弹窗很烦。
        this.onSelect && this.onSelect(id);

        const start = this.toWorld(e.clientX, e.clientY);
        const moving = store.activeCanvas().nodes.filter(n => store.store.selection.includes(n.id))
          .map(n => ({ id: n.id, ox: n.x, oy: n.y }));
        this.drag = { start, moving, moved: false };
        e.preventDefault();
      }
    });

    // 第 17 轮：**双击**控件卡片才弹出参数窗（单击只选中）。
    // 双击空白处 = 适应视野（顺手给的一个便利，和多数画布工具一致）。
    vp.addEventListener('dblclick', (e) => {
      const nodeEl = e.target.closest('.cv-node');
      if (!nodeEl) { this.fit(); return; }
      if (e.target.closest('.cv-port') || e.target.closest('.cv-node-del')) return;
      e.preventDefault();
      const id = nodeEl.dataset.id;
      store.store.selection = [id];
      this.render();
      this.onSelect && this.onSelect(id);
      this.onOpenInspector && this.onOpenInspector(id);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.panning) {
        const dx = e.clientX - this.panning.x;
        const dy = e.clientY - this.panning.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.panning.moved = true;
        this.panX = this.panning.px + dx;
        this.panY = this.panning.py + dy;
        this.applyTransform();
        return;
      }
      if (this.drag) {
        const now = this.toWorld(e.clientX, e.clientY);
        const dx = now.x - this.drag.start.x;
        const dy = now.y - this.drag.start.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this.drag.moved = true;
        for (const m of this.drag.moving) {
          const node = store.activeCanvas().nodes.find(n => n.id === m.id);
          if (node) { node.x = Math.round(m.ox + dx); node.y = Math.round(m.oy + dy); }
        }
        this.render();
        return;
      }
      if (this.linking) {
        const hit = this.highlightDropTarget(e);
        // 第 15 轮：靠近可连接的圆圈时，临时线的末端**吸附到圆心**，
        // 让「松手就连到这里」一眼可见；没靠近就跟着鼠标走。
        let w = this.toWorld(e.clientX, e.clientY);
        if (hit && hit.ok) w = { x: hit.x, y: hit.y };
        else if (this.snapTarget) w = { x: this.snapTarget.x, y: this.snapTarget.y };
        const from = this.linking.fromId ? this.linking.pos : w;
        const to = this.linking.toId ? this.linking.pos : w;
        this.tempEdge.setAttribute('d', this.linking.fromId ? bezier(from, to) : bezier(to, from));
        return;
      }
    });

    window.addEventListener('mouseup', (e) => {
      // 右键「点」在节点上（没拖动过）= 弹菜单。
      // 判断依据是 panning.moved：右键拖动是平移，不能既平移又弹菜单。
      if (e.button === 2 && this.pendingNodeMenu) {
        const p = this.pendingNodeMenu;
        const moved = this.panning ? this.panning.moved : false;
        this.pendingNodeMenu = null;
        if (!moved) {
          if (this.panning) { this.panning = null; vp.style.cursor = ''; }
          this.openNodeMenu(p.id, p.x, p.y);
          return;
        }
      }

      if (this.panning) { this.panning = null; vp.style.cursor = this.spaceDown ? 'grab' : ''; return; }

      if (this.drag) {
        if (this.drag.moved) {
          // 吸附在松手时做（而不是拖动中），否则鼠标会有「被格点拽着走」的黏滞感
          if (S.get('snapToGrid')) {
            const canvas = store.activeCanvas();
            for (const m of this.drag.moving) {
              const node = canvas.nodes.find(n => n.id === m.id);
              if (!node) continue;
              const s = this.snap(node.x, node.y);
              node.x = s.x; node.y = s.y;
            }
            this.render();
          }
          store.autoSave();
          // 挪动会改变存盘内容（x/y 也在序列化里），所以要让状态栏重算「未保存」。
          // 用 'moved' 这个轻量事件，别用 'node' —— 后者会触发整个界面重绘。
          store.emit('moved');
        }
        this.drag = null;
        return;
      }

      if (this.linking) {
        // 优先用拖动过程中吸附到的圆圈：用户已经看到「吸附在这里」，
        // 松手就应该连到它，而不是再按鼠标最后几像素重新判定一次。
        const near = this.findPortAt(e.clientX, e.clientY);
        const st = this.snapTarget;
        const target = st
          ? { id: st.id, dir: st.dir, port: st.port }
          : (near ? { id: near.id, dir: near.dir, port: near.port } : null);
        const lk = this.linking;
        this.linking = null;
        this.snapTarget = null;
        this.tempEdge.style.display = 'none';
        this.clearHighlights();
        this.onConnectError && this.onConnectError('');
        if (target) {
          const canvas = store.activeCanvas();
          let from, to;
          if (lk.fromId) {
            from = { node: lk.fromId, port: lk.fromPort };
            to = { node: target.id, port: target.port };
          } else {
            from = { node: target.id, port: target.port };
            to = { node: lk.toId, port: lk.toPort };
          }
          const fd = defOf((canvas.nodes.find(n => n.id === from.node) || {}).def);
          const td = defOf((canvas.nodes.find(n => n.id === to.node) || {}).def);
          const check = M.checkConnect(canvas, from, to, { defOf });
          if (!check.ok) {
            this.toast(check.reason, 'error');
            // 右侧面板也要显示为什么不能连（用户第 3 条要求）
            this.onConnectError && this.onConnectError(check.reason);
          } else if (lk.fromId && (fd.outPorts || []).length > 1) {
            // 多出口控件：询问走哪个口
            this.choosePort(lk.fromId, target).then((port) => {
              if (!port) return;
              store.connect({ node: from.node, port }, to);
              this.render();
            });
            return;
          } else {
            const r = store.connect(from, to);
            this.render();
            if (!r.replaced && check.reason) this.toast(check.reason, 'warn');
          }
        }
        this.render();
        return;
      }
    });

    // 滚轮缩放（任何情况下都是缩放，以鼠标位置为中心）。
    // 触控板的横向滚动（deltaX）也走缩放，避免两指横滑时画布乱跳。
    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      // 触控板一次可能只给几像素的增量，做一点非线性放大
      const dy = e.deltaY;
      if (!dy) return;
      // 步长可以在设置里调（默认每格 10%）
      const step = Math.max(0.02, (S.get('wheelSpeed') || 10) / 100);
      const factor = dy < 0 ? 1 + step : 1 / (1 + step);
      const before = this.toWorld(e.clientX, e.clientY);
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * factor));
      if (newZoom === this.zoom) return;
      const r = this.viewport.getBoundingClientRect();
      const np = panForZoomAt(e.clientX, e.clientY, r, this.panX, this.panY, this.zoom, newZoom);
      this.panX = np.panX;
      this.panY = np.panY;
      this.zoom = newZoom;
      this.applyTransform();
      const after = this.toWorld(e.clientX, e.clientY);
      // 自检：光标下的世界点必须没动（差一点点是浮点误差）
      if (Math.abs(after.x - before.x) > 0.01 || Math.abs(after.y - before.y) > 0.01) {
        console.warn('缩放锚点偏移', before, after);
      }
      if (this.onZoom) this.onZoom(this.zoom);
    }, { passive: false });

    // 空格 + 拖动 = 平移画布
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.code === 'Space') { this.spaceDown = true; vp.style.cursor = 'grab'; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.store.selection.length) {
          e.preventDefault();
          store.removeNodes([...store.store.selection]);
          this.render();
          this.onSelect && this.onSelect(null);
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { this.spaceDown = false; vp.style.cursor = ''; }
    });

    // 右键删除线
    vp.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  /**
   * 拖线过程中：判断当前鼠标下的端口能不能接。
   *
   * 第 15 轮修两个问题（用户第 4、5 条）：
   *   1. 能接 → 绿色高亮；不能接 → **红色高亮 + 立刻弹出原因**
   *      （不再因为「没命中端口」就什么都不做，用户看不到任何反馈）。
   *   2. 鼠标靠近某个圆圈时，临时连线**吸附到那个圆圈的圆心**，
   *      让用户直观看到「松手就会连到这里」。
   * @returns {{id:string,dir:string,port:string,ok:boolean,reason:string,x:number,y:number}|null}
   */
  highlightDropTarget(e) {
    this.clearHighlights();
    const t = this.findPortAt(e.clientX, e.clientY);
    const lk = this.linking;
    if (!t) {
      // 没靠近任何圆圈：临时线跟着鼠标走，并清掉之前的错误提示
      this.snapTarget = null;
      if (this.lastConnectReason) {
        this.lastConnectReason = '';
        this.onConnectError && this.onConnectError('');
      }
      return null;
    }
    const el = this.nodesLayer.querySelector(`[data-id="${t.id}"]`);
    const canvas = store.activeCanvas();
    let ok = true, reason = '';
    if (lk && (lk.fromId || lk.toId)) {
      let from, to;
      if (lk.fromId) { from = { node: lk.fromId, port: lk.fromPort }; to = { node: t.id, port: t.port }; }
      else { from = { node: t.id, port: t.port }; to = { node: lk.toId, port: lk.toPort }; }
      const c = M.checkConnect(canvas, from, to, { defOf });
      ok = c.ok; reason = c.reason || '';
    } else {
      // 还没开始拉线：只有入口算是「可落点」
      ok = t.dir === 'in';
      if (!ok) reason = '这里不是入口：入口是控件左侧的小圆点';
    }
    // 圆圈着色：ok = 绿，bad = 红（CSS .cv-port.ok / .bad）
    if (el) {
      const portEl = el.querySelector(t.dir === 'in' ? '.cv-port-in' : '.cv-port-out');
      if (portEl) portEl.classList.add(ok ? 'ok' : 'bad');
    }
    this.snapTarget = ok ? { id: t.id, dir: t.dir, port: t.port, x: t.x, y: t.y } : null;
    // mousemove 每帧都会走到这里：同一个原因只提示一次，别刷屏
    if (ok) {
      if (this.lastConnectReason) {
        this.lastConnectReason = '';
        this.onConnectError && this.onConnectError('');
      }
    } else if (reason) {
      if (this.lastConnectReason !== reason) {
        this.lastConnectReason = reason;
        this.toast(reason, 'error', true);
        this.onConnectError && this.onConnectError(reason);
      }
    }
    // 返回坐标（世界坐标）——调用方要拿它把临时线的末端吸到圆心。
    // 这里以前只返回 {id,dir,port,ok,reason}，于是调用方 w = {x: hit.x, y: hit.y}
    // 拿到的是 undefined，临时线的路径算出来是 NaN；SVG 画不出 NaN 路径，
    // 表现就是「快连上时连线突然不见了，松手后又出现」（用户报的第 2 条）。
    return { id: t.id, dir: t.dir, port: t.port, ok, reason, x: t.x, y: t.y };
  }

  clearHighlights() {
    for (const el of this.nodesLayer.querySelectorAll('.cv-port')) el.classList.remove('ok', 'bad');
  }

  /**
   * 节点的右键菜单，只有一项「断开所有连线」。删单条连线是悬停到线上点 ×，
   * 一个节点连了七八条时给一个批量断线的入口。
   */
  openNodeMenu(nodeId, clientX, clientY) {
    this.closeNodeMenu();
    const canvas = store.activeCanvas();
    const node = canvas.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const linked = canvas.edges.filter((e) => e.from.node === nodeId || e.to.node === nodeId);
    const d = defOf(node.def);

    const menu = document.createElement('div');
    menu.className = 'cv-menu';
    menu.id = 'cvNodeMenu';

    const title = document.createElement('div');
    title.className = 'cv-menu-title';
    title.textContent = (d && d.label) || node.def;
    menu.appendChild(title);

    const item = document.createElement('button');
    item.className = 'cv-menu-item';
    item.id = 'cvMenuDisconnect';
    item.textContent = linked.length ? `断开所有连线（${linked.length} 条）` : '没有连线可断开';
    item.disabled = !linked.length;
    item.addEventListener('click', (ev) => {
      ev.stopPropagation();
      store.removeEdgesOf([nodeId]);
      log.action('断开节点全部连线', `${title.textContent} — ${linked.length} 条`);
      this.closeNodeMenu();
      this.render();
    });
    menu.appendChild(item);

    // 菜单要挂在画布容器里（绝对定位相对它），并且不能被裁掉
    const r = this.root.getBoundingClientRect();
    menu.style.left = Math.round(clientX - r.left) + 'px';
    menu.style.top = Math.round(clientY - r.top) + 'px';
    this.root.appendChild(menu);
    this.nodeMenu = menu;

    // 点别处就关掉。用捕获阶段，免得被画布的 mousedown 抢先处理。
    this.menuCloser = (ev) => {
      if (!menu.contains(ev.target)) this.closeNodeMenu();
    };
    setTimeout(() => document.addEventListener('mousedown', this.menuCloser, true), 0);
  }

  closeNodeMenu() {
    if (this.menuCloser) {
      document.removeEventListener('mousedown', this.menuCloser, true);
      this.menuCloser = null;
    }
    if (this.nodeMenu) {
      this.nodeMenu.remove();
      this.nodeMenu = null;
    }
  }

  /**
   * 找鼠标下的端口。判定半径第 15 轮放宽到 34px（并按缩放换算），
   * 因为原来的 26px 太小：用户明明已经拖到目标圆圈附近，却因为差几像素
   * 判成「没有目标」—— 于是既不判红也没有错误提醒（用户第 4 条反馈）。
   * @returns {{id:string, dir:'in'|'out', port:string, x:number, y:number}|null}
   */
  findPortAt(clientX, clientY) {
    const canvas = store.activeCanvas();
    if (!canvas) return null;
    const radius = Math.max(26, 34 * this.zoom);
    let best = null, bestD = radius;
    for (const n of canvas.nodes) {
      const d = defOf(n.def);
      const cands = [];
      if ((d.inPorts || []).length) {
        const p = this.portPos(n, 'in', 'in');
        cands.push({ dir: 'in', port: 'in', x: p.x, y: p.y });
      }
      for (const p of d.outPorts || []) {
        const pos = this.portPos(n, 'out', p.id);
        cands.push({ dir: 'out', port: p.id, x: pos.x, y: pos.y });
      }
      for (const c of cands) {
        const s = this.worldToScreen(c.x, c.y);
        const dist = Math.hypot(s.x - clientX, s.y - clientY);
        if (dist < bestD) {
          bestD = dist;
          best = { id: n.id, dir: c.dir, port: c.port, x: c.x, y: c.y };
        }
      }
    }
    return best;
  }

  worldToScreen(x, y) {
    const r = this.viewport.getBoundingClientRect();
    return worldToScreenPt(x, y, r, this.panX, this.panY, this.zoom);
  }

  /** 多出口控件选哪个口 */
  choosePort(nodeId, target) {
    return new Promise((resolve) => {
      const canvas = store.activeCanvas();
      const node = canvas.nodes.find(n => n.id === nodeId);
      const d = defOf(node.def);
      const menu = document.createElement('div');
      menu.className = 'cv-port-menu';
      menu.innerHTML = `<div class="pm-title">从哪个出口连过去？</div>` +
        (d.outPorts || []).map(p =>
          `<button class="pm-item" data-port="${p.id}">
             <span class="pm-label">${esc(p.label || p.id)}</span>
           </button>`).join('');
      document.body.appendChild(menu);
      const r = this.nodesLayer.querySelector(`[data-id="${nodeId}"]`).getBoundingClientRect();
      menu.style.left = (r.right + 8) + 'px';
      menu.style.top = r.top + 'px';
      menu.addEventListener('click', (ev) => {
        const b = ev.target.closest('.pm-item');
        if (!b) return;
        menu.remove();
        resolve(b.dataset.port);
      });
      setTimeout(() => {
        const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); resolve(null); document.removeEventListener('mousedown', off); } };
        document.addEventListener('mousedown', off);
      }, 0);
    });
  }

  toast(msg, kind, transient) {
    this.onToast && this.onToast(msg, kind, transient);
  }

  /** 视图自适应：把所有节点框进视野 */
  fit() {
    const canvas = store.activeCanvas();
    const r = this.viewport.getBoundingClientRect();
    if (!canvas || !canvas.nodes.length) {
      // 空画布没有内容可框，用设置里的初始缩放，而不是硬算一个 1.0
      const t = fitTransform(null, r.width, r.height);
      const want = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(S.get('defaultZoom') || 100) / 100));
      this.zoom = want;
      this.panX = t.panX;
      this.panY = t.panY;
      this.applyTransform();
      if (this.onZoom) this.onZoom(this.zoom);
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of canvas.nodes) {
      const h = this.nodeHeight(defOf(n.def));
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + h);
    }
    const t = fitTransform({ minX, minY, maxX, maxY }, r.width, r.height);
    this.zoom = t.zoom; this.panX = t.panX; this.panY = t.panY;
    this.applyTransform();
  }

  /** 按钮缩放：以视口中心为锚点 */
  zoomBy(f) {
    const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * f));
    if (nz === this.zoom) return;
    const r = this.viewport.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const np = panForZoomAt(cx, cy, r, this.panX, this.panY, this.zoom, nz);
    this.panX = np.panX;
    this.panY = np.panY;
    this.zoom = nz;
    this.applyTransform();
    if (this.onZoom) this.onZoom(this.zoom);
  }
}

// ---------------- 工具 ----------------

function bezier(a, b) {
  // NaN 兜底：坐标一旦是 undefined/NaN，路径里出现 NaN 时 SVG 会**整条不画**
  // —— 用户看到的是「连线凭空消失」，极难定位（第 15 轮真踩过：临时线在
  // 吸附瞬间变 NaN）。这里退化成一条零长度线段，至少线还在、也看得出异常。
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y)
      || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    const x = Number.isFinite(a.x) ? a.x : 0;
    const y = Number.isFinite(a.y) ? a.y : 0;
    return `M ${x} ${y} L ${x} ${y}`;
  }
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/** 贝塞尔曲线的中点（t = 0.5），用来摆那条线的删除按钮。必须和 bezier() 用同一组
 *  控制点，否则按钮会飘在线的旁边。三次贝塞尔在 t=0.5 时正好是 (P0+3P1+3P2+P3)/8。 */
function bezierMidpoint(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  const p1 = { x: a.x + dx, y: a.y };
  const p2 = { x: b.x - dx, y: b.y };
  return {
    x: (a.x + 3 * p1.x + 3 * p2.x + b.x) / 8,
    y: (a.y + 3 * p1.y + 3 * p2.y + b.y) / 8,
  };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function visible(node, p) {
  if (!p.showIf) return true;
  for (const [k, v] of Object.entries(p.showIf)) {
    if ((node.props || {})[k] !== v) return false;
  }
  return true;
}

/** 拖入时的默认参数 */
export function defaultProps(defKey) {
  const d = defOf(defKey);
  const out = {};
  if (!d) return out;
  for (const p of d.props || []) {
    if (p.default !== undefined) out[p.key] = p.default;
  }
  if (d.category === 'event') {
    // 事件默认变量名就用 contexts 里的名字
  }
  return out;
}
