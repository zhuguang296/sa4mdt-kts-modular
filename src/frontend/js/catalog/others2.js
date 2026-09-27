// 数据 / 循环 / 查找 / 小工具（第二批）
// 只使用工作区脚本里核实过的写法。几条硬约束：
//   * Groups.player / Groups.unit / Groups.build / Groups.fire 是 Seq，size 是方法
//     （.size()），filter/forEach 是 Kotlin 标准库扩展。
//   * forEachIndexed 在语料里 0 处；下标必须用 mapIndexed 或 repeat(n)。
//   * Mathf.rand / Mathf.round / clamp / Teams.all 都不存在。
//   * player.hasPermission 是 suspend，不能直接写在 listen 体里。

import { buildExpr } from './conditions.js';

/**
 * 取一个当前作用域里还没被占用的名字。有些控件的中间结果名字是固定的（如
 * 「操作列表-取长度」给 listSize），同一条链上放两个就会生成两句
 * `val listSize = ...`，Kotlin 报 "Conflicting declarations"。所以接数字直到不冲突。
 */
function uniqueName(ctx, base) {
  if (!ctx.hasVar(base)) return base;
  for (let i = 2; i < 100; i++) {
    const cand = `${base}${i}`;
    if (!ctx.hasVar(cand)) return cand;
  }
  return `${base}${Date.now() % 100000}`;
}

/**
 * 把带 {占位符} 的文本转成 Kotlin 字符串模板，例如
 *   "玩家 {player.name} 进来了"  ->  "玩家 ${player.name} 进来了"
 * 给收普通 String 的函数用（如 logger.info）；收 PlaceHoldString 的函数
 * （broadcast / sendMessage）要用 ctx.msgTemplate，两者不能混。只有作用域里真实
 * 存在的名字才会被替换 —— 写错名字时原样保留 {x}，生成的代码仍合法。
 * 不能直接把替好的文本丢给 ctx.lit：那个会把 $ 转义成 \$，模板就失效了。所以按
 * 片段处理：纯文本片段走转义，变量片段保留 $ 不转义。
 */
function kotlinTemplate(text, ctx) {
  const src = String(text == null ? '' : text);
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}/g;
  const segs = [];
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (!ctx.hasVar(m[1])) continue;
    if (m.index > last) segs.push({ lit: src.slice(last, m.index) });
    segs.push({ expr: m[1] + m[2] });
    last = m.index + m[0].length;
  }
  if (!segs.some(s => s.expr)) return ctx.lit(src);
  if (last < src.length) segs.push({ lit: src.slice(last) });
  const body = segs
    .map(s => (s.expr ? '${' + s.expr + '}' : escapeInString(s.lit)))
    .join('');
  return `"${body}"`;
}

/** Kotlin 字符串字面量内部的转义（不含首尾引号） */
function escapeInString(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/\r?\n/g, '\\n');
}

// ---------------- 数据 ----------------

export const DATAS2 = [
  {
    key: 'data.set',
    category: 'data',
    level: 'basic',
    label: '改变一个值',
    terms: '变量 修改 加 减 赋值 累加 计数器 set add',
    codeHint: 'count += 1',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'name', type: 'text', label: '变量名字', required: true, default: 'count' },
      {
        key: 'op', type: 'select', label: '怎么变', required: true, default: 'add',
        options: [
          ['add', '加上一个数'],
          ['sub', '减去一个数'],
          ['set', '设成一个数'],
          ['mul', '乘上一个数'],
        ],
      },
      { key: 'value', type: 'number', label: '数值', required: true, default: 1 },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || '').trim();
      const v = ctx.varOf(name);
      if (!v) return { error: `找不到变量「${name}」，请先用「记住一个值」声明它` };
      const raw = n.props.value;
      if (!Number.isFinite(Number(raw))) return { error: '「改变一个值」的数值要填数字' };
      const num = ctx.num(raw);
      const op = n.props.op || 'add';
      if (op === 'add') return { lines: [`${v} += ${num}`] };
      if (op === 'sub') return { lines: [`${v} -= ${num}`] };
      if (op === 'mul') return { lines: [`${v} *= ${num}`] };
      return { lines: [`${v} = ${num}`] };
    },
  },

  {
    key: 'data.list',
    category: 'data',
    level: 'advanced',
    label: '做一个列表',
    terms: 'list mutableListOf 列表 数组 集合 一串 名单',
    codeHint: 'val names = mutableListOf<String>()',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'name', type: 'text', label: '列表名字', required: true, default: 'names', noSpace: true },
      { key: 'itemType', type: 'select', label: '装什么', required: true, default: 'String', options: [['String', '文本']] },
      { key: 'item', type: 'text', label: '初始内容（可留空，逗号分隔）', default: '' },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || '').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `列表名字不合法：${name}` };
      if (ctx.varOf(name)) return { error: `名字「${name}」和上游已有的名字冲突了，换一个` };
      const items = String(n.props.item || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
      // 空的 mutableListOf() 在 Kotlin 里推断不出元素类型（"Not enough information
      // to infer type variable T"），必须写明类型参数。
      const init = items.length
        ? `mutableListOf(${items.map(i => ctx.lit(i)).join(', ')})`
        : 'mutableListOf<String>()';
      return {
        lines: [`val ${name} = ${init}`],
        provides: [{ name, type: 'String', expr: name }],
      };
    },
  },

  {
    key: 'data.listOp',
    category: 'data',
    level: 'advanced',
    label: '操作列表',
    terms: 'list add remove contains size 列表 增删 包含 长度',
    codeHint: 'names.add("x") / names.remove("x") / names.contains("x")',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'op', type: 'select', label: '做什么', required: true, default: 'add',
        options: [
          ['add', '加一项'],
          ['remove', '删掉一项'],
          ['clear', '全部清空'],
          ['contains', '检查是否包含'],
          ['size', '取出长度'],
        ],
      },
      { key: 'list', type: 'text', label: '列表变量名', required: true, default: 'names' },
      { key: 'value', type: 'text', label: '内容', default: 'hello', showIf: { op: 'add' } },
      { key: 'value2', type: 'text', label: '内容', default: 'hello', showIf: { op: 'remove' } },
      { key: 'value3', type: 'text', label: '内容', default: 'hello', showIf: { op: 'contains' } },
    ],
    emit(n, ctx) {
      const listName = String(n.props.list || '').trim();
      const listExpr = ctx.varOf(listName);
      if (!listExpr) return { error: `找不到列表「${listName}」` };
      const op = n.props.op || 'add';
      if (op === 'clear') return { lines: [`${listExpr}.clear()`] };
      if (op === 'size') {
        const vn = uniqueName(ctx, 'listSize');
        return { lines: [`val ${vn} = ${listExpr}.size`], provides: [{ name: vn, type: 'Number' }] };
      }
      if (op === 'remove') {
        return { lines: [`${listExpr}.remove(${ctx.lit(n.props.value2 || '')})`] };
      }
      if (op === 'contains') {
        const vn = uniqueName(ctx, 'hasItem');
        return { lines: [`val ${vn} = ${listExpr}.contains(${ctx.lit(n.props.value3 || '')})`], provides: [{ name: vn, type: 'Boolean' }] };
      }
      return { lines: [`${listExpr}.add(${ctx.lit(n.props.value || '')})`] };
    },
  },

  {
    key: 'data.map',
    category: 'data',
    level: 'advanced',
    label: '做一个对照表',
    terms: 'map mutableMapOf 对照表 字典 键值 查表',
    codeHint: 'val scores = mutableMapOf<String, Int>()',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'name', type: 'text', label: '对照表名字', required: true, default: 'scores', noSpace: true },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || '').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `对照表名字不合法：${name}` };
      if (ctx.varOf(name)) return { error: `名字「${name}」和上游已有的名字冲突了，换一个` };
      return {
        lines: [`val ${name} = mutableMapOf<String, Int>()`],
        provides: [{ name, type: 'String', expr: name }],
      };
    },
  },

  {
    key: 'data.mapOp',
    category: 'data',
    level: 'advanced',
    label: '操作对照表',
    terms: 'map put get remove containsKey 对照表 读写 查表',
    codeHint: 'scores[key] = 1 / scores[key]',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'op', type: 'select', label: '做什么', required: true, default: 'put',
        options: [['put', '写入 / 覆盖'], ['get', '读出来'], ['remove', '删掉'], ['has', '有没有这个键']],
      },
      { key: 'map', type: 'text', label: '对照表名字', required: true, default: 'scores' },
      { key: 'key', type: 'template', label: '键', required: true, default: '{player.uuid()}', placeholder: '可以用 {player.uuid()} 这样的占位符' },
      { key: 'value', type: 'number', label: '值', default: 1, showIf: { op: 'put' } },
    ],
    emit(n, ctx) {
      const mapName = String(n.props.map || '').trim();
      const mapExpr = ctx.varOf(mapName);
      if (!mapExpr) return { error: `找不到对照表「${mapName}」` };
      // 键用消息模板渲染，这样 {player.uuid()} 这类占位符能取到真实变量；没有
      // 占位符时 msgTemplate 会生成 `"a".with()`，对着纯字面量多余，直接用字面量。
      const rawKey = String(n.props.key || '');
      const hasPlaceholder = /\{[A-Za-z_][A-Za-z0-9_]*/.test(rawKey);
      const keyExpr = hasPlaceholder
        ? ctx.msgTemplate(rawKey, ['player', 'unit', 'message'])
        : ctx.lit(rawKey);
      const op = n.props.op || 'put';
      if (op === 'put') {
        const v = Math.round(Number(n.props.value) || 0);
        return { lines: [`${mapExpr}[${keyExpr}] = ${v}`] };
      }
      if (op === 'remove') return { lines: [`${mapExpr}.remove(${keyExpr})`] };
      if (op === 'has') {
        const vn = uniqueName(ctx, 'hasKey');
        return { lines: [`val ${vn} = ${mapExpr}.containsKey(${keyExpr})`], provides: [{ name: vn, type: 'Boolean' }] };
      }
      const vn = uniqueName(ctx, 'mapValue');
      return {
        lines: [`val ${vn} = ${mapExpr}[${keyExpr}] ?: 0`],
        provides: [{ name: vn, type: 'Number' }],
      };
    },
  },
];

// ---------------- 循环 ----------------

export const LOOPS2 = [
  {
    key: 'loop.while',
    category: 'loop',
    level: 'advanced',
    label: '只要成立就一直重复',
    terms: 'while 循环 只要 一直 重复 直到',
    codeHint: 'while (count < 10) { ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    labelName: 'while',
    props: [
      { key: 'rules', type: 'rules', label: '条件', required: true, minItems: 1 },
      {
        key: 'joiner', type: 'select', label: '多个条件之间', default: 'and',
        options: [['and', '全部满足（并且）'], ['or', '满足任意一个（或者）']],
      },
    ],
    /** 复用「如果……就」的条件渲染器，保证条件语义完全一致 */
    emit(n, ctx) {
      const rules = n.props.rules || [];
      if (!rules.length) return { error: '「只要成立就一直重复」还没有添加条件' };
      const built = buildExpr(rules, n.props.joiner || 'and', ctx);
      if (built.error) return { error: built.error };
      return { lines: [`while (${built.expr}) {`] };
    },
  },
  {
    key: 'loop.repeatTimes',
    category: 'loop',
    level: 'basic',
    label: '重复执行（带序号）',
    terms: 'repeat 序号 下标 index 次数 循环',
    codeHint: 'repeat(n) { i -> ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    labelName: 'repeat',
    props: [
      { key: 'times', type: 'number', label: '重复几次', required: true, default: 3, min: 1 },
      { key: 'itemName', type: 'text', label: '序号叫什么', default: 'i', noSpace: true },
    ],
    emit(n, ctx) {
      const t = Number(n.props.times);
      if (!Number.isFinite(t) || t < 1) return { error: '「重复执行」的次数要大于 0' };
      const item = String(n.props.itemName || 'i').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(item)) return { error: `序号名字不合法：${item}` };
      // repeat(n) { i -> } 是 Kotlin 标准库的带下标重载，从 0 开始
      return {
        lines: [`repeat(${Math.round(t)}) { ${item} ->`],
        provides: [{ name: item, type: 'Number', expr: item }],
      };
    },
  },
  {
    key: 'loop.forEachPlayer',
    category: 'loop',
    level: 'basic',
    label: '对每个玩家做',
    terms: 'Groups.player forEach 玩家 循环 遍历 每个 批量 所有人',
    codeHint: 'Groups.player.forEach { p -> ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    labelName: 'forEach',
    props: [
      { key: 'itemName', type: 'text', label: '每个玩家叫什么', default: 'p', noSpace: true },
      {
        key: 'filter', type: 'select', label: '筛选', default: 'all',
        options: [['all', '所有在线玩家'], ['alive', '还活着的'], ['admins', '只要管理员'], ['team', '指定队伍的']],
      },
      {
        key: 'team', type: 'select', label: '哪个队伍', default: 'sharded', showIf: { filter: 'team' },
        options: [['sharded', '蓝队 (sharded)'], ['crux', '红队 (crux)'], ['green', '绿队 (green)'], ['purple', '紫队 (purple)']],
      },
    ],
    emit(n, ctx) {
      const item = String(n.props.itemName || 'p').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(item)) return { error: `名字不合法：${item}` };
      let src = 'Groups.player';
      const f = n.props.filter || 'all';
      if (f === 'alive') src = 'Groups.player.filter { !it.dead() }';
      else if (f === 'admins') src = 'Groups.player.filter { it.admin }';
      else if (f === 'team') src = `Groups.player.filter { it.team() == Team.${n.props.team || 'sharded'} }`;
      return {
        lines: [`${src}.forEach { ${item} ->`],
        provides: [{ name: item, type: 'Player', expr: item }],
      };
    },
  },
  {
    key: 'loop.forEachBuild',
    category: 'loop',
    level: 'advanced',
    label: '对每个建筑做',
    terms: 'Groups.build forEach 建筑 循环 遍历 每个 核心',
    codeHint: 'Groups.build.forEach { b -> ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    labelName: 'forEach',
    props: [
      { key: 'itemName', type: 'text', label: '每个建筑叫什么', default: 'b', noSpace: true },
      {
        key: 'filter', type: 'select', label: '筛选', default: 'all',
        options: [['all', '所有建筑'], ['cores', '只要核心'], ['myTeam', '只要本队（默认队）的']],
      },
    ],
    emit(n, ctx) {
      const item = String(n.props.itemName || 'b').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(item)) return { error: `名字不合法：${item}` };
      let src = 'Groups.build';
      const f = n.props.filter || 'all';
      if (f === 'cores') src = 'Groups.build.filterIsInstance<CoreBuild>()';
      else if (f === 'myTeam') src = 'Groups.build.filter { it.team == state.rules.defaultTeam }';
      return {
        lines: [`${src}.forEach { ${item} ->`],
        provides: [{ name: item, type: 'Building', expr: item }],
      };
    },
  },
  {
    key: 'loop.forEachIndexed',
    category: 'loop',
    level: 'advanced',
    label: '对列表逐项做（带序号）',
    terms: 'forEachIndexed mapIndexed 列表 序号 遍历 每一项',
    codeHint: 'list.mapIndexed { i, v -> ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    labelName: 'mapIndexed',
    props: [
      { key: 'list', type: 'text', label: '列表变量名', required: true, default: 'names' },
      { key: 'idxName', type: 'text', label: '序号叫什么', default: 'i', noSpace: true },
      { key: 'itemName', type: 'text', label: '每一项叫什么', default: 'v', noSpace: true },
    ],
    emit(n, ctx) {
      const listName = String(n.props.list || '').trim();
      const listExpr = ctx.varOf(listName);
      if (!listExpr) return { error: `找不到列表「${listName}」，请先用「做一个列表」声明它` };
      const idx = String(n.props.idxName || 'i').trim();
      const it = String(n.props.itemName || 'v').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(idx) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(it)) {
        return { error: '序号 / 每一项的名字只能用字母数字下划线' };
      }
      // 语料里没有 forEachIndexed，带下标一律用 mapIndexed（3 处真实用法）
      return {
        lines: [`${listExpr}.mapIndexed { ${idx}, ${it} ->`],
        provides: [
          { name: idx, type: 'Number', expr: idx },
          { name: it, type: 'String', expr: it },
        ],
      };
    },
  },
];

// ---------------- 查找 ----------------

export const QUERIES2 = [
  {
    key: 'query.players',
    category: 'query',
    level: 'basic',
    label: '找出符合条件的玩家',
    terms: 'Groups.player filter 玩家 查找 筛选 列表 在线',
    codeHint: 'val players = Groups.player.filter { ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    produces: [{ name: 'players', type: 'PlayerList' }],
    props: [
      { key: 'name', type: 'text', label: '结果叫什么名字', required: true, default: 'players', noSpace: true },
      {
        key: 'scope', type: 'select', label: '在哪些玩家里找', required: true, default: 'all',
        options: [['all', '所有在线玩家'], ['alive', '还活着的'], ['admins', '管理员'], ['team', '指定队伍的']],
      },
      {
        key: 'team', type: 'select', label: '哪个队伍', default: 'sharded', showIf: { scope: 'team' },
        options: [['sharded', '蓝队 (sharded)'], ['crux', '红队 (crux)'], ['green', '绿队 (green)'], ['purple', '紫队 (purple)']],
      },
      { key: 'nameContains', type: 'text', label: '名字里包含（可留空）', default: '' },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || 'players').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `结果名字不合法：${name}` };
      const conds = [];
      const scope = n.props.scope || 'all';
      if (scope === 'alive') conds.push('!it.dead()');
      else if (scope === 'admins') conds.push('it.admin');
      else if (scope === 'team') conds.push(`it.team() == Team.${n.props.team || 'sharded'}`);
      const cn = String(n.props.nameContains || '').trim();
      if (cn) conds.push(`it.name.contains(${ctx.lit(cn)})`);
      const body = conds.length ? conds.join(' && ') : 'true';
      return {
        lines: [`val ${name} = Groups.player.filter { ${body} }`],
        provides: [{ name, type: 'PlayerList' }],
      };
    },
  },
  {
    key: 'query.blocks',
    category: 'query',
    level: 'advanced',
    label: '找出范围内的方块',
    terms: 'Geometry.circle 范围 附近 方块 查找 圆形 区域',
    codeHint: 'Geometry.circle(x, y, radius) { cx, cy -> ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    produces: [{ name: 'tiles', type: 'UnitList' }],
    props: [
      { key: 'name', type: 'text', label: '结果叫什么名字', required: true, default: 'tiles', noSpace: true },
      { key: 'radius', type: 'number', label: '半径（格）', required: true, default: 5, min: 1 },
      {
        key: 'at', type: 'select', label: '以哪里为中心', required: true, default: 'tile',
        options: [['tile', '上游的方块'], ['player', '上游的玩家'], ['unit', '上游的单位']],
      },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || 'tiles').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `结果名字不合法：${name}` };
      const r = Math.max(1, Math.round(Number(n.props.radius) || 5));

      // Geometry.circle 两版都在用：3 参 Geometry.circle(cx, cy, radius) { x, y -> }
      // （1004.kts:66）和 5 参多带 world.width()/world.height()（pvpProtect.kts:31）；
      // 后者会把坐标夹在合法范围内，更安全。
      let cx, cy;
      const at = n.props.at || 'tile';
      if (at === 'tile') {
        const t = ctx.varOfType('Tile');
        if (!t) return { error: '「找出范围内的方块」需要中心位置，但这条链上没有方块来源' };
        // Tile.x / Tile.y 是 short（javap 核实），Kotlin 不会自动转 Int，必须显式
        // .toInt()：gatherTp.kts:58 写的就是 tile.x.toInt()
        cx = `${t}.x.toInt()`; cy = `${t}.y.toInt()`;
      } else if (at === 'player') {
        const p = ctx.varOfType('Player');
        if (!p) return { error: '「找出范围内的方块」需要中心位置，但这条链上没有玩家来源' };
        cx = `${p}.tileX()`; cy = `${p}.tileY()`;
      } else {
        const u = ctx.varOfType('Unit');
        if (!u) return { error: '「找出范围内的方块」需要中心位置，但这条链上没有单位来源' };
        cx = `${u}.tileX()`; cy = `${u}.tileY()`;
      }
      // 包名是 arc.math.geom.Geometry（7 处真实 import 全是这个）
      ctx.need('arc.math.geom.Geometry');
      // world.tile(x, y) 返回可空，必须处理 null
      return {
        lines: [
          `val ${name} = mutableListOf<Tile>()`,
          `Geometry.circle(${cx}, ${cy}, world.width(), world.height(), ${r}) { x, y ->`,
          `    world.tile(x, y)?.let { ${name}.add(it) }`,
          `}`,
        ],
        provides: [{ name, type: 'UnitList' }],
      };
    },
  },
  {
    key: 'query.countUnits',
    category: 'query',
    level: 'advanced',
    label: '数一数附近的单位',
    terms: 'Units.count 数量 附近 单位 统计 范围内',
    codeHint: 'Units.count(x, y, radius) { ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    produces: [{ name: 'unitCount', type: 'Number' }],
    props: [
      { key: 'name', type: 'text', label: '结果叫什么名字', required: true, default: 'unitCount', noSpace: true },
      { key: 'radius', type: 'number', label: '半径（像素）', required: true, default: 80, min: 1 },
      {
        key: 'at', type: 'select', label: '以哪里为中心', required: true, default: 'tile',
        options: [['tile', '上游的方块'], ['player', '上游的玩家'], ['unit', '上游的单位']],
      },
      {
        key: 'what', type: 'select', label: '数哪些', default: 'enemy',
        options: [['enemy', '敌方单位'], ['ground', '地面单位'], ['flying', '飞行单位'], ['all', '全部单位']],
      },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || 'unitCount').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `结果名字不合法：${name}` };
      const r = Math.max(1, Number(n.props.radius) || 80);

      // 签名来自 gatherTp.kts:59：前两个是世界像素坐标，第三个是 Float 半径
      //   Units.count(tile.worldx(), tile.worldy(), unit.physicSize()) { ... }
      let cx, cy;
      const at = n.props.at || 'tile';
      if (at === 'tile') {
        const t = ctx.varOfType('Tile');
        if (!t) return { error: '「数一数附近的单位」需要中心位置，但这条链上没有方块来源' };
        cx = `${t}.worldx()`; cy = `${t}.worldy()`;
      } else if (at === 'player') {
        const p = ctx.varOfType('Player');
        if (!p) return { error: '「数一数附近的单位」需要中心位置，但这条链上没有玩家来源' };
        cx = `${p}.x`; cy = `${p}.y`;
      } else {
        const u = ctx.varOfType('Unit');
        if (!u) return { error: '「数一数附近的单位」需要中心位置，但这条链上没有单位来源' };
        cx = `${u}.x`; cy = `${u}.y`;
      }

      const what = n.props.what || 'enemy';
      const conds = [];
      if (what === 'enemy') conds.push('it.team == state.rules.waveTeam');
      else if (what === 'ground') conds.push('it.isGrounded');
      else if (what === 'flying') conds.push('it.isFlying');
      const pred = conds.length ? conds.join(' && ') : 'true';
      ctx.need('mindustry.entities.Units');
      return {
        lines: [`val ${name} = Units.count(${cx}, ${cy}, ${ctx.num(r)}f) { ${pred} }`],
        provides: [{ name, type: 'Number' }],
      };
    },
  },
  {
    key: 'query.closestEnemy',
    category: 'query',
    level: 'advanced',
    label: '找最近的敌人',
    terms: 'Units.closestEnemy 最近 敌人 目标 锁定 附近',
    codeHint: 'Units.closestEnemy(team, x, y, range) { ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    produces: [{ name: 'target', type: 'Unit' }],
    props: [
      { key: 'name', type: 'text', label: '结果叫什么名字', required: true, default: 'target', noSpace: true },
      { key: 'range', type: 'number', label: '搜索范围（像素）', required: true, default: 200, min: 1 },
      {
        key: 'at', type: 'select', label: '以哪里为中心', required: true, default: 'unit',
        options: [['unit', '上游的单位'], ['tile', '上游的方块'], ['player', '上游的玩家']],
      },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || 'target').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `结果名字不合法：${name}` };
      const r = Math.max(1, Number(n.props.range) || 200);

      // 签名来自 towerDefend.ai.kt:26
      //   Units.closestEnemy(unit.team, x, y, range) { !invalid(it) }
      const at = n.props.at || 'unit';
      let teamExpr, cx, cy, invalidHint;
      if (at === 'unit') {
        const u = ctx.varOfType('Unit');
        if (!u) return { error: '「找最近的敌人」需要中心单位，但这条链上没有单位来源' };
        teamExpr = `${u}.team`; cx = `${u}.x`; cy = `${u}.y`;
        invalidHint = `it.team != ${u}.team`;
      } else if (at === 'tile') {
        const t = ctx.varOfType('Tile');
        if (!t) return { error: '「找最近的敌人」需要中心方块，但这条链上没有方块来源' };
        teamExpr = `${t}.team()`; cx = `${t}.worldx()`; cy = `${t}.worldy()`;
        invalidHint = `it.team != ${t}.team()`;
      } else {
        const p = ctx.varOfType('Player');
        if (!p) return { error: '「找最近的敌人」需要中心玩家，但这条链上没有玩家来源' };
        teamExpr = `${p}.team()`; cx = `${p}.x`; cy = `${p}.y`;
        invalidHint = `it.team != ${p}.team()`;
      }
      ctx.need('mindustry.entities.Units');
      return {
        lines: [`val ${name} = Units.closestEnemy(${teamExpr}, ${cx}, ${cy}, ${ctx.num(r)}f) { ${invalidHint} }`],
        provides: [{ name, type: 'Unit' }],
      };
    },
  },
];

// ---------------- 小工具 ----------------

export const UTILS = [
  {
    key: 'util.random',
    category: 'util',
    level: 'basic',
    label: '取一个随机数',
    terms: 'random Random 随机 抽 概率 运气',
    codeHint: 'val n = Random.nextInt(1, 100)',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    produces: [{ name: 'rand', type: 'Number', nameFrom: 'name' }],
    props: [
      { key: 'name', type: 'text', label: '结果叫什么名字', required: true, default: 'rand', noSpace: true },
      { key: 'min', type: 'number', label: '最小（含）', required: true, default: 1 },
      { key: 'max', type: 'number', label: '最大（不含）', required: true, default: 100 },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || 'rand').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `结果名字不合法：${name}` };
      const lo = Math.round(Number(n.props.min) || 0);
      const hi = Math.round(Number(n.props.max) || 0);
      if (hi <= lo) return { error: '「取一个随机数」的最大值要大于最小值' };
      // 语料里没有 Mathf.rand；用的是 kotlin.random.Random.nextInt(from, until)
      return {
        lines: [`val ${name} = Random.nextInt(${lo}, ${hi})`],
        provides: [{ name, type: 'Number' }],
      };
    },
  },
  {
    key: 'util.chance',
    category: 'util',
    level: 'basic',
    label: '按概率触发',
    terms: 'chance 概率 几率 百分比 随机 抽奖',
    codeHint: 'if (Mathf.chance(0.3)) { ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    labelName: null,   // if 不开 lambda，沿用外层标签
    props: [
      { key: 'percent', type: 'number', label: '概率（%）', required: true, default: 30, min: 0, max: 100 },
    ],
    emit(n, ctx) {
      const p = Number(n.props.percent);
      if (!Number.isFinite(p)) return { error: '「按概率触发」要填一个概率数字' };
      // Mathf.chance(f) 的 f 是 0~1（GeneratorHelper.kt:75 用的是 0.03）
      const f = Math.max(0, Math.min(100, p)) / 100;
      return { lines: [`if (Mathf.chance(${ctx.num(f)}f)) {`] };
    },
  },
  {
    key: 'util.currentTime',
    category: 'util',
    level: 'advanced',
    label: '取游戏时间',
    terms: 'Time.time Time.millis 时间 计时 经过 秒',
    codeHint: 'val t = Time.time',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    produces: [{ name: 'gameTime', type: 'Number', nameFrom: 'name' }],
    props: [
      { key: 'name', type: 'text', label: '结果叫什么名字', required: true, default: 'gameTime', noSpace: true },
      {
        key: 'kind', type: 'select', label: '取哪种', required: true, default: 'seconds',
        options: [['seconds', '开局至今的秒数'], ['millis', '毫秒时间戳'], ['realClock', '真实世界时间戳']],
      },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || 'gameTime').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `结果名字不合法：${name}` };
      const kind = n.props.kind || 'seconds';
      if (kind === 'millis') {
        ctx.need('arc.util.Time');
        return { lines: [`val ${name} = Time.millis()`], provides: [{ name, type: 'Number' }] };
      }
      if (kind === 'realClock') {
        return { lines: [`val ${name} = System.currentTimeMillis()`], provides: [{ name, type: 'Number' }] };
      }
      // Time.time 是属性（不是方法）：limitLogicPacket.kts:18 写的是 Time.time
      ctx.need('arc.util.Time');
      return { lines: [`val ${name} = Time.time.toInt()`], provides: [{ name, type: 'Number' }] };
    },
  },
  {
    key: 'util.log',
    category: 'util',
    level: 'advanced',
    label: '往控制台写一行',
    terms: 'logger info 日志 控制台 打印 调试 log',
    codeHint: 'logger.info("...")',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'text', type: 'template', label: '写什么', required: true, default: '调试：{player.name}', placeholder: '可用 {player.name} 这样的占位符' },
    ],
    emit(n, ctx) {
      // logger.info 收的是普通 String（maps.manager.kt:98），**不是**
      // PlaceHoldString。不能用 ctx.msgTemplate（它生成 ".with()"，返回 VarString，
      // 类型不匹配），改用 Kotlin 字符串模板。
      return { lines: [`logger.info(${kotlinTemplate(n.props.text || '', ctx)})`] };
    },
  },
  {
    key: 'util.returnList',
    category: 'util',
    level: 'advanced',
    label: '把结果合并成一段文字',
    terms: 'joinToString 拼接 合并 文字 列表 输出',
    codeHint: 'list.joinToString(", ")',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    produces: [{ name: 'joined', type: 'String', nameFrom: 'name' }],
    props: [
      { key: 'name', type: 'text', label: '结果叫什么名字', required: true, default: 'joined', noSpace: true },
      { key: 'list', type: 'text', label: '列表变量名', required: true, default: 'players' },
      { key: 'sep', type: 'text', label: '用什么分隔', default: ', ' },
      { key: 'field', type: 'text', label: '取每一项的哪个属性（可留空）', default: 'name' },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || 'joined').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `结果名字不合法：${name}` };
      const listName = String(n.props.list || '').trim();
      const listExpr = ctx.varOf(listName);
      if (!listExpr) return { error: `找不到列表「${listName}」` };
      const sep = ctx.lit(n.props.sep == null ? ', ' : n.props.sep);
      const field = String(n.props.field || '').trim();
      const lines = field
        ? [`val ${name} = ${listExpr}.joinToString(${sep}) { it.${field} }`]
        : [`val ${name} = ${listExpr}.joinToString(${sep})`];
      return { lines, provides: [{ name, type: 'String' }] };
    },
  },
  {
    key: 'util.waitSeconds',
    category: 'util',
    level: 'advanced',
    label: '等几秒（放在计时里用）',
    terms: 'delay 等待 暂停 秒 睡眠 sleep',
    codeHint: 'delay(1000)',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'seconds', type: 'number', label: '等几秒', required: true, default: 1, min: 0.1 },
    ],
    emit(n, ctx) {
      const s = Number(n.props.seconds);
      if (!Number.isFinite(s) || s <= 0) return { error: '「等几秒」的秒数要大于 0' };
      // delay 是挂起函数，只能出现在挂起上下文里。语料里只有
      // loop(Dispatchers.game) { } 和 launch(Dispatchers.game) { } 两种，「每隔 X 秒」
      // 用的就是前者。事件体 lambda 是 (T) -> Unit 不是 suspend，写 delay 编译不过，
      // 所以直接报错而不是生成坏代码。
      const label = ctx.returnLabel && ctx.returnLabel();
      if (label !== 'loop' && label !== 'launch') {
        return { error: '「等几秒」只能放在「每隔 X 秒」或「等一会儿再做」的里面（delay 是挂起函数，事件体里不能用）' };
      }
      return { lines: [`delay(${Math.round(s * 1000)}L)`] };
    },
  },
];
