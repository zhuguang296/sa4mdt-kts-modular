// 右侧参数面板：根据控件定义的 props 动态生成表单
import { defOf, CATEGORY_LABEL } from './catalog/index.js';
import { fieldOptionsFor, operatorsOf } from './catalog/conditions.js';
import { PORT_TYPES } from './catalog/types.js';
import { varsInScopeAt } from './generate.js';
import * as store from './store.js';
import * as M from './model.js';

export class Inspector {
  constructor(root) {
    this.root = root;
    this.nodeId = null;
    this.connectError = null;   // 最近的连线失败原因（右侧面板顶部红条）
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onInput(e));
    this.root.addEventListener('click', (e) => this.onClick(e));
  }

  /** 右侧面板显示「为什么不能连」；msg 为空则清除 */
  showConnectError(msg) {
    this.connectError = msg || null;
    this.render();
  }

  show(nodeId) {
    this.nodeId = nodeId;
    // 换了一个选中控件，旧连线错误提示就不贴着了
    this.connectError = null;
    this.render();
  }

  /** 收集当前画布上、位于该节点之前的可用变量（供条件/数据控件下拉）
   *  与生成器共用同一份遍历逻辑（generate.js 的 varsInScopeAt） */
  availableVars(nodeId) {
    const canvas = store.activeCanvas();
    if (!canvas) return [];
    return varsInScopeAt(canvas, nodeId);
  }

  render() {
    const canvas = store.activeCanvas();
    if (!canvas) { this.root.innerHTML = empty('没有打开的画布'); return; }
    if (!this.nodeId) { this.root.innerHTML = this.noSelection(); return; }
    const node = canvas.nodes.find(n => n.id === this.nodeId);
    if (!node) { this.root.innerHTML = this.noSelection(); return; }
    const d = defOf(node.def);
    if (!d) { this.root.innerHTML = empty(`不认识这个功能块：${node.def}`); return; }

    const vars = this.availableVars(node.id);
    const parts = [];

    // 连线失败原因（用户第 3 条：在右侧说明为什么不能连）
    if (this.connectError) {
      parts.push(`<div class="insp-connerr" role="alert">
          <span class="insp-connerr-ic">${WARN_ICON}</span>
          <span class="insp-connerr-tx">${esc(this.connectError)}</span>
        </div>`);
    }

    parts.push(`<div class="insp-head">
        <div class="insp-cat">${esc(catLabel(d.category))}</div>
        <div class="insp-title">${esc(d.label)}</div>
        <div class="insp-code">${esc(d.codeHint || '')}</div>
      </div>`);

    if (d.note) parts.push(`<div class="insp-note">${esc(d.note)}</div>`);

    // 上下文变量
    if ((d.contexts || []).length) {
      parts.push(`<div class="insp-section"><div class="insp-sec-title">这个事件带给你的变量</div>`);
      for (const c of d.contexts) {
        parts.push(`<div class="insp-ctxrow">
            <span class="ctx-name">${esc(c.name)}</span>
            <span class="ctx-type">${esc(PORT_TYPES[c.type] ? PORT_TYPES[c.type].label : c.type)}</span>
            <span class="ctx-note">可以在这后面的控件里直接选它</span>
          </div>`);
      }
      parts.push(`</div>`);
    }

    // 参数
    parts.push(`<div class="insp-section"><div class="insp-sec-title">设置</div>`);
    for (const p of d.props || []) {
      if (p.type === 'rules') {
        parts.push(this.renderRules(node, p, vars));
        continue;
      }
      if (p.showIf && !visible(node, p)) continue;
      parts.push(this.renderField(node, p, vars));
    }
    parts.push(`</div>`);

    // 提示
    if (d.category === 'event' && M.outEdges(canvas, node.id, 'out').length === 0) {
      parts.push(`<div class="insp-tip">把右边的小圆点拖到下一个控件上，就能让它「做点事」</div>`);
    }

    this.root.innerHTML = parts.join('');
  }

  noSelection() {
    const err = this.connectError ? `<div class="insp-connerr" role="alert">
      <span class="insp-connerr-ic">${WARN_ICON}</span>
      <span class="insp-connerr-tx">${esc(this.connectError)}</span>
    </div>` : '';
    return `${err}<div class="insp-empty">
      <div class="ie-title">没有选中任何功能块</div>
      <div class="ie-sub">点画布上的任何一个方块，这里就会显示它的设置</div>
    </div>`;
  }

  renderField(node, p, vars) {
    const val = node.props ? node.props[p.key] : undefined;
    const label = `<label class="fl">${esc(p.label)}${p.required ? '<span class="req">*</span>' : ''}</label>`;
    const id = `${node.id}__${p.key}`;

    if (p.type === 'select') {
      const opts = (p.options || []).map(([v, t]) =>
        `<option value="${esc(v)}"${String(val) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('');
      return `<div class="field">${label}
        <select data-key="${esc(p.key)}" id="${id}">${opts}</select>
      </div>`;
    }
    if (p.type === 'boolean') {
      const on = val === true || val === 'true';
      return `<div class="field field-bool">
        <label class="switch"><input type="checkbox" data-key="${esc(p.key)}" ${on ? 'checked' : ''}>
        <span class="slider"></span></label>
        <span class="bool-label">${esc(p.label)}</span>
      </div>`;
    }
    if (p.type === 'number') {
      return `<div class="field">${label}
        <input type="number" data-key="${esc(p.key)}" value="${val == null ? '' : esc(val)}"
          ${p.min != null ? `min="${p.min}"` : ''} step="any">
        ${p.hint ? `<div class="fhint">${esc(p.hint)}</div>` : ''}
      </div>`;
    }
    if (p.type === 'template') {
      const used = [];
      const re = /\{([A-Za-z_][A-Za-z0-9_]*)/g;
      let m;
      while ((m = re.exec(String(val || '')))) if (!used.includes(m[1])) used.push(m[1]);
      const chips = vars.length
        ? `<div class="chips">可插入：${vars.map(v =>
          `<button class="chip" data-insert="${esc(p.key)}" data-text="{${esc(v.name)}}">{${esc(v.name)}}</button>`).join('')}</div>`
        : '';
      const usedNote = used.length
        ? `<div class="fhint ok">会用到这些变量：${used.map(u => `<code>${esc(u)}</code>`).join(' ')}</div>`
        : '';
      return `<div class="field">${label}
        <textarea data-key="${esc(p.key)}" rows="3" placeholder="${esc(p.placeholder || '')}">${esc(val == null ? '' : val)}</textarea>
        ${chips}${usedNote}
      </div>`;
    }
    // text
    return `<div class="field">${label}
      <input type="text" data-key="${esc(p.key)}" value="${val == null ? '' : esc(val)}"
        placeholder="${esc(p.placeholder || '')}">
      ${p.hint ? `<div class="fhint">${esc(p.hint)}</div>` : ''}
    </div>`;
  }

  // ---------------- 条件规则编辑器 ----------------

  renderRules(node, p, vars) {
    const rules = (node.props && node.props.rules) || [];
    const out = [`<div class="field field-rules">
      <label class="fl">${esc(p.label)}${p.required ? '<span class="req">*</span>' : ''}</label>`];

    if (!vars.length) {
      out.push(`<div class="fhint warn">这条链上还没有任何可判断的东西。条件要接在「当……发生时」后面才能用它的变量。</div>`);
    } else if (!rules.length) {
      out.push(`<div class="fhint">还没有条件。点下面的按钮加一条，然后选「判断谁」「判断什么」「跟什么比」。</div>`);
    }

    rules.forEach((r, i) => {
      const varOpts = vars.map(v =>
        `<option value="${esc(v.name)}"${r.var === v.name ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
      const curVar = vars.find(v => v.name === r.var);
      const fields = curVar ? fieldOptionsFor(curVar.type) : [];
      const fOpts = fields.map(f =>
        `<option value="${esc(f.key)}"${r.field === f.key ? ' selected' : ''}>${esc(f.label)}</option>`).join('');
      const fdef = curVar ? fields.find(f => f.key === r.field) : null;
      const ops = fdef && !fdef.bool ? operatorsOf({ type: fdef.type, bool: fdef.bool }) : [];
      const opOpts = ops.map(o =>
        `<option value="${esc(o.op)}"${r.op === o.op ? ' selected' : ''}>${esc(o.label)}</option>`).join('');

      let valueHtml = '';
      if (fdef && fdef.bool) {
        valueHtml = `<span class="rv-note">（这就是判断条件本身）</span>`;
      } else if (fdef) {
        const vs = r.valueSource || 'literal';
        valueHtml = `
          <select data-rule="${i}" data-rk="valueSource" class="rv-src">
            <option value="literal"${vs === 'literal' ? ' selected' : ''}>填一个值</option>
            <option value="var"${vs === 'var' ? ' selected' : ''}>用另一个变量</option>
          </select>
          ${vs === 'var'
            ? `<select data-rule="${i}" data-rk="valueVar">${vars.map(v =>
              `<option value="${esc(v.name)}"${r.valueVar === v.name ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select>`
            : `<input type="text" data-rule="${i}" data-rk="value" value="${esc(r.value == null ? '' : r.value)}" placeholder="值">`}`;
      }

      const argHtml = fdef && fdef.needsArg
        ? `<input type="text" data-rule="${i}" data-rk="arg" value="${esc(r.arg == null ? '' : r.arg)}"
             placeholder="${fdef.needsArg === 'permission' ? '权限名字' : '要包含的文字'}">`
        : '';

      out.push(`<div class="rule">
        <div class="rule-row">
          <select data-rule="${i}" data-rk="var">${varOpts || '<option value="">（没有可用变量）</option>'}</select>
          <select data-rule="${i}" data-rk="field">${fOpts || '<option value="">（先选对象）</option>'}</select>
          ${opOpts ? `<select data-rule="${i}" data-rk="op">${opOpts}</select>` : ''}
          <button class="rule-del" data-rule-del="${i}" title="删掉这条">×</button>
        </div>
        ${valueHtml || argHtml ? `<div class="rule-row rule-row2">${argHtml}${valueHtml}</div>` : ''}
      </div>`);
    });

    if (rules.length > 1) {
      const joiner = (node.props && node.props.joiner) || 'and';
      out.push(`<div class="field"><label class="fl">上面这些条件</label>
        <select data-key="joiner">
          <option value="and"${joiner === 'and' ? ' selected' : ''}>要全部满足</option>
          <option value="or"${joiner === 'or' ? ' selected' : ''}>满足任意一个就行</option>
        </select></div>`);
    }

    if (vars.length) {
      out.push(`<button class="btn-add-rule" data-add-rule="1">${rules.length ? '+ 再加一个条件' : '+ 添加一个条件'}</button>`);
    }
    out.push(`</div>`);
    return out.join('');
  }

  // ---------------- 交互 ----------------

  onInput(e) {
    const el = e.target;
    const canvas = store.activeCanvas();
    if (!canvas) return;
    const node = canvas.nodes.find(n => n.id === this.nodeId);
    if (!node) return;

    // 规则编辑
    if (el.dataset.rule !== undefined) {
      const i = Number(el.dataset.rule);
      const rk = el.dataset.rk;
      const rules = ((node.props && node.props.rules) || []).map(r => ({ ...r }));
      if (!rules[i]) return;
      const rule = rules[i];
      rule[rk] = el.type === 'checkbox' ? el.checked : el.value;
      // 换了对象就重置属性
      if (rk === 'var') {
        const vars = this.availableVars(node.id);
        const v = vars.find(x => x.name === el.value);
        const fs = v ? fieldOptionsFor(v.type) : [];
        rule.type = v ? v.type : '';
        rule.field = fs.length ? fs[0].key : '';
        rule.value = '';
        rule.valueSource = 'literal';
      }
      if (rk === 'field') {
        const vars = this.availableVars(node.id);
        const v = vars.find(x => x.name === rule.var);
        const f = v ? fieldOptionsFor(v.type).find(x => x.key === el.value) : null;
        if (f) { rule.type = v.type; rule.bool = f.bool; }
        rule.value = '';
      }
      rules[i] = rule;
      store.setProp(node.id, 'rules', rules);
      // 只有「判断谁 / 判断什么」会改变后续可选项，需要重绘；
      // 「跟什么比 / 填什么值」只是改值，重绘会把正在输入的框干掉
      if (rk === 'var' || rk === 'field') {
        this.render();
      } else {
        this.refreshCanvas();
      }
      this.onChange && this.onChange();
      return;
    }

    if (el.dataset.key) {
      const k = el.dataset.key;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'number') v = el.value === '' ? '' : Number(el.value);
      else v = el.value;
      store.setProp(node.id, k, v);
      // 切换了影响显示的条件时重绘表单
      const d = defOf(node.def);
      const hasConditional = (d.props || []).some(pp => pp.showIf);
      if (hasConditional && e.type === 'change') this.render();
      else this.refreshCanvas();
      this.onChange && this.onChange();
      return;
    }
  }

  onClick(e) {
    const add = e.target.closest('[data-add-rule]');
    if (add) {
      const canvas = store.activeCanvas();
      const node = canvas.nodes.find(n => n.id === this.nodeId);
      if (!node) return;
      const vars = this.availableVars(node.id);
      const rules = ((node.props && node.props.rules) || []).map(r => ({ ...r }));
      const v = vars[0];
      const fs = v ? fieldOptionsFor(v.type) : [];
      rules.push({
        var: v ? v.name : '', type: v ? v.type : '',
        field: fs.length ? fs[0].key : '', bool: fs.length ? fs[0].bool : false,
        op: '==', valueSource: 'literal', value: '', arg: '',
      });
      store.setProp(node.id, 'rules', rules);
      this.render();
      this.onChange && this.onChange();
      return;
    }
    const del = e.target.closest('[data-rule-del]');
    if (del) {
      const i = Number(del.dataset.ruleDel);
      const canvas = store.activeCanvas();
      const node = canvas.nodes.find(n => n.id === this.nodeId);
      if (!node) return;
      const rules = ((node.props && node.props.rules) || []).map(r => ({ ...r }));
      rules.splice(i, 1);
      store.setProp(node.id, 'rules', rules);
      this.render();
      this.onChange && this.onChange();
      return;
    }
    const ins = e.target.closest('[data-insert]');
    if (ins) {
      const key = ins.dataset.insert;
      const text = ins.dataset.text;
      const ta = this.root.querySelector(`textarea[data-key="${key}"]`);
      if (ta) {
        const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
        ta.value = ta.value.slice(0, s) + text + ta.value.slice(s);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = s + text.length;
        const canvas = store.activeCanvas();
        const node = canvas.nodes.find(n => n.id === this.nodeId);
        if (node) {
          store.setProp(node.id, key, ta.value);
          this.refreshCanvas();
          this.onChange && this.onChange();
        }
      }
      return;
    }
  }

  refreshCanvas() {
    this.onCanvasRefresh && this.onCanvasRefresh();
  }
}

function visible(node, p) {
  if (!p.showIf) return true;
  for (const [k, v] of Object.entries(p.showIf)) {
    if ((node.props || {})[k] !== v) return false;
  }
  return true;
}

function catLabel(c) {
  // 单一出处：catalog/index.js 的 CATEGORY_LABEL。这里曾经自己抄了一份，
  // 结果新增分类时漏掉就退化成英文 key。
  return CATEGORY_LABEL[c] || c;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function empty(t) {
  return `<div class="insp-empty"><div class="ie-title">${esc(t)}</div></div>`;
}

// 内联 SVG 警告图标（界面不用 emoji，用图标工具）
const WARN_ICON = `<svg viewBox="0 0 16 16" class="ic-warn" width="14" height="14" aria-hidden="true"><path d="M8 1.5 15 14.5H1z" fill="currentColor"/><path d="M7.2 5.5h1.6v4.4H7.2z" fill="#fff"/><circle cx="8" cy="12" r="1" fill="#fff"/></svg>`;
