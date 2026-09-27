// 条件控件（第二批）
// 硬约束：listen { } 的 lambda 是 (T) -> Unit，**不是 suspend**，所以 suspend 的
// player.hasPermission(...)（PermissionExt.kt:6）不能直接写在事件体里。因此权限
// 判断提供两种：非挂起的 admin 判断，和包一层 launch 的权限判断。

import { buildExpr } from './conditions.js';

export const CONDITIONS2 = [
  // ---------------- 如果是管理员 ----------------
  {
    key: 'condition.isAdmin',
    category: 'condition',
    level: 'basic',
    label: '如果是管理员',
    terms: 'admin 管理员 权限 op 管理',
    codeHint: 'if (player.admin) { ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [
      { id: 'then', type: 'flow', label: '就', opensBlock: true },
      { id: 'else', type: 'flow', label: '否则', opensBlock: true },
    ],
    closers: { then: '}', else: '}' },
    props: [
      {
        key: 'who', type: 'select', label: '判断谁', required: true, default: 'ctx',
        options: [['ctx', '上游的那个玩家'], ['fixed', '指定玩家名']],
      },
      { key: 'name', type: 'text', label: '玩家名', default: '', showIf: { who: 'fixed' } },
    ],
    emit(n, ctx) {
      let expr;
      if ((n.props.who || 'ctx') === 'fixed') {
        const nm = String(n.props.name || '').trim();
        if (!nm) return { error: '「如果是管理员」选了指定玩家名，但名字是空的' };
        expr = `Groups.player.find { it.name == ${ctx.lit(nm)} }?.admin == true`;
      } else {
        const p = ctx.varOfType('Player');
        if (!p) return { error: '「如果是管理员」需要一个玩家，但这条链上没有玩家（挂到「玩家进服」这类事件下面）' };
        // admin 是属性，工作区 PermissionExt.kt:9 就是直接读 player.admin
        expr = `${p}.admin`;
      }
      return { lines: [`if (${expr}) {`] };
    },
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

  // ---------------- 如果没满足条件就跳过 ----------------
  {
    key: 'condition.guard',
    category: 'condition',
    level: 'advanced',
    label: '不满足就跳过（提前退出）',
    terms: 'return guard 提前 退出 跳过 守卫 如果 否则 不满足',
    codeHint: 'if (!(...)) return@listen',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [
      { id: 'out', type: 'flow', label: '满足时继续' },
      { id: 'skip', type: 'flow', label: '不满足时', opensBlock: true },
    ],
    closers: { skip: '}' },
    props: [
      { key: 'rules', type: 'rules', label: '条件', required: true, minItems: 1 },
      {
        key: 'joiner', type: 'select', label: '多个条件之间', default: 'and',
        options: [['and', '全部满足（并且）'], ['or', '满足任意一个（或者）']],
      },
      {
        key: 'elseMode', type: 'select', label: '不满足时', required: true, default: 'return',
        options: [['return', '直接不再往下执行'], ['run', '执行一小段别的，然后继续']],
      },
    ],
    emit(n, ctx) {
      // 复用「如果……就」那套规则渲染，保证两边对条件的理解完全一致
      const rules = n.props.rules || [];
      if (!rules.length) return { error: '「不满足就跳过」还没有添加条件' };
      const built = buildExpr(rules, n.props.joiner || 'and', ctx);
      if (built.error) return { error: built.error };

      if ((n.props.elseMode || 'return') === 'return') {
        const label = ctx.returnLabel && ctx.returnLabel();
        if (!label) return { error: '「不满足就跳过」要放在事件 / 指令 / 循环里面才能提前退出' };
        // 没有开新块，子节点就写在当前这一层，所以缩进增量为 0
        return { lines: [`if (!(${built.expr})) return@${label}`], childIndentDelta: 0 };
      }
      // run 模式：不满足时走 else 分支，然后继续往下
      return { lines: [`if (!(${built.expr})) {`], childIndentDelta: 1 };
    },
    expand(n, res, api) {
      if ((n.props.elseMode || 'return') === 'return') {
        // 关键：必须用 api.childIndent（= api.depth）而不是 api.depth + 1，
        // 否则「满足时继续」的那串节点会多缩进一级，虽然还能编译但很难看。
        return [...api.childrenOf('out', api.ctx, api.childIndent)];
      }
      const inner = api.depth + 1;
      const out = [...api.childrenOf('skip', api.ctx, inner)];
      out.push(api.ind + '}');
      // 「然后继续」接在整块后面，回到当前层
      out.push(...api.childrenOf('out', api.ctx, api.depth));
      return out;
    },
  },
];
