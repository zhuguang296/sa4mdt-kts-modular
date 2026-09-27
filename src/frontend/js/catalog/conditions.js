// 条件控件：如果……就（then / else 两个槽）
import { fieldsOf, fieldDef, operatorsOf, renderField } from './types.js';

/** 渲染一条规则的右值 */
function renderValue(rule, fdef, ctx) {
  const src = rule.valueSource || 'literal';
  if (src === 'var') {
    const v = ctx.varOf(rule.valueVar);
    if (!v) return { error: `条件的右边用了「${rule.valueVar}」，但这个变量不存在` };
    return { expr: v };
  }
  if (src === 'field') {
    const other = ctx.varOf(rule.valueVar);
    if (!other) return { error: `条件的右边用了「${rule.valueVar}」，但这个变量不存在` };
    const of = fieldDef(rule.valueType, rule.valueField);
    if (!of) return { error: `不认识属性 ${rule.valueField}` };
    return { expr: renderField(of, other, ctx.lit(rule.arg || '')) };
  }
  const raw = rule.value;
  if (fdef.type === 'Number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { error: `「${fdef.label}」要跟数字比较，但现在填的是「${raw}」` };
    return { expr: ctx.num(n) };
  }
  if (fdef.type === 'Boolean') return { expr: raw === 'true' ? 'true' : 'false' };
  if (fdef.type === 'Team') return { expr: `Team.${raw}` };
  if (fdef.type === 'Unit' || fdef.type === 'Player' || fdef.type === 'Tile' || fdef.type === 'UnitList') {
    const v = ctx.varOf(raw);
    if (!v) return { error: `「${fdef.label}」要跟另一个对象比较，但找不到「${raw}」` };
    return { expr: v };
  }
  return { expr: ctx.lit(String(raw == null ? '' : raw)) };
}

function renderRule(rule, ctx) {
  const varExpr = ctx.varOf(rule.var);
  if (!varExpr) return { error: `条件里用了「${rule.var}」，但这个变量在这条链上不存在` };

  const fdef = fieldDef(rule.type, rule.field);
  if (!fdef) return { error: `不认识属性 ${rule.field}（${rule.type}）` };

  const arg = fdef.needsArg ? ctx.lit(rule.arg || '') : null;
  const lhs = renderField(fdef, varExpr, arg);
  if (fdef.bool) return { expr: lhs };

  const op = rule.op || '==';
  const rhs = renderValue(rule, fdef, ctx);
  if (rhs.error) return rhs;
  return { expr: `${lhs} ${op} ${rhs.expr}` };
}

/** 把一组规则拼成布尔表达式。导出给 conditions2.js 复用，保证两个控件对条件的理解一致。 */
export function buildExpr(rules, joiner, ctx) {
  const parts = [];
  for (const r of rules) {
    const got = renderRule(r, ctx);
    if (got.error) return got;
    parts.push(got.expr);
  }
  if (!parts.length) return { error: '还没有添加任何条件' };
  const j = joiner === 'or' ? ' || ' : ' && ';
  // 多个条件时加括号，避免与外面的运算混淆
  const expr = parts.join(j);
  return { expr: parts.length > 1 ? `(${expr})` : expr };
}

export const CONDITIONS = [
  {
    key: 'condition.if',
    category: 'condition',
    level: 'basic',
    label: '如果……就',
    terms: 'if else 条件 判断 如果 否则 那么 when',
    codeHint: 'if (条件) { ... } else { ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [
      { id: 'then', type: 'flow', label: '就' },
      { id: 'else', type: 'flow', label: '否则' },
    ],
    props: [
      {
        key: 'joiner', type: 'select', label: '多个条件之间', default: 'and',
        options: [['and', '全部满足（并且）'], ['or', '满足任意一个（或者）']],
      },
      { key: 'rules', type: 'rules', label: '条件', required: true, minItems: 1 },
    ],
    emit(n, ctx) {
      const rules = n.props.rules || [];
      if (!rules.length) return { error: '「如果……就」还没有添加条件' };
      const built = buildExpr(rules, n.props.joiner || 'and', ctx);
      if (built.error) return { error: built.error };
      return { lines: [`if (${built.expr}) {`] };
    },
    /** then / else 双侧展开；else 只在确实有子节点时才输出 */
    expand(n, res, api) {
      const inner = api.depth + 1;
      const out = [...api.childrenOf('then', api.ctx, inner)];
      if (api.hasChildren('else')) {
        out.push(api.ind + '} else {');
        out.push(...api.childrenOf('else', api.ctx, inner));
      }
      out.push(api.ind + '}');
      return out;
    },
  },
];

/** 供 UI 的规则编辑器用：某上下文变量有哪些可用字段 */
export function fieldOptionsFor(type) {
  return fieldsOf(type).map(f => ({
    key: f.key, label: f.label, type: f.type, bool: !!f.bool, needsArg: f.needsArg || null,
  }));
}

export { operatorsOf };
