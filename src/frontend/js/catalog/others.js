// 数据控件：记住一个值
export const DATAS = [
  {
    key: 'data.value',
    category: 'data',
    level: 'advanced',
    label: '记住一个值',
    terms: 'val var 变量 数据 记住 保存 数值',
    codeHint: 'val x = ...',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'name', type: 'text', label: '叫什么名字', required: true, default: 'count', noSpace: true },
      {
        key: 'source', type: 'select', label: '值从哪来', required: true, default: 'number',
        options: [
          ['number', '写一个数字'],
          ['string', '写一段文字'],
          ['boolean', '真 / 假'],
          ['field', '上游对象的某个属性'],
          ['time', '当前时间'],
        ],
      },
      { key: 'value', type: 'text', label: '值', default: '1', showIf: { source: 'number' } },
      { key: 'value', type: 'text', label: '文字', default: 'hello', showIf: { source: 'string' } },
      {
        key: 'value', type: 'select', label: '真 / 假', default: 'true', showIf: { source: 'boolean' },
        options: [['true', '真'], ['false', '假']],
      },
      { key: 'var', type: 'text', label: '取哪个对象的属性', default: '', showIf: { source: 'field' } },
      { key: 'field', type: 'text', label: '属性名', default: '', showIf: { source: 'field' } },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || '').trim();
      if (!name) return { error: '「记住一个值」还没填名字' };
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `变量名字只能用字母数字下划线，且不能以数字开头：${name}` };
      if (ctx.varOf(name)) return { error: `变量名字「${name}」和上游已有的名字冲突了，换一个` };

      const src = n.props.source || 'number';
      // 一定要把变量声明出去（provides），否则下游的「发消息」等控件看不到这个
      // 名字，{名字} 占位符会原样输出。
      // 用 var 而不是 val：「改变一个值」控件要能对它 += / -= / set，val 不允许
      // 重新赋值，会报 "Val cannot be reassigned"。需要只读语义的存盘数据由那个
      // 控件自己处理成 val/customLoad。
      if (src === 'number') {
        const v = Number(n.props.value);
        if (!Number.isFinite(v)) return { error: `「${name}」要存一个数字，但填的是「${n.props.value}」` };
        return { lines: [`var ${name} = ${ctx.num(v)}`], provides: [{ name, type: 'Number' }] };
      }
      if (src === 'string') {
        return { lines: [`var ${name} = ${ctx.lit(n.props.value || '')}`], provides: [{ name, type: 'String' }] };
      }
      if (src === 'boolean') {
        const b = n.props.value === 'true' ? 'true' : 'false';
        return { lines: [`var ${name} = ${b}`], provides: [{ name, type: 'Boolean' }] };
      }
      if (src === 'time') {
        return { lines: [`var ${name} = System.currentTimeMillis()`], provides: [{ name, type: 'Number' }] };
      }
      // field
      const vExpr = ctx.varOf(n.props.var);
      if (!vExpr) return { error: `「${name}」想取「${n.props.var}」的属性，但这个变量在这条链上不存在` };
      const f = String(n.props.field || '').trim();
      if (!f) return { error: `「${name}」还没填属性名` };
      return { lines: [`var ${name} = ${vExpr}.${f}`], provides: [{ name, type: 'Number' }] };
    },
  },
];

// 循环控件
export const LOOPS = [
  {
    key: 'loop.repeat',
    category: 'loop',
    level: 'basic',
    label: '重复 N 次',
    terms: 'repeat 循环 重复 次数 for',
    codeHint: 'repeat(n) { ... }',
    labelName: 'repeat',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    props: [
      { key: 'times', type: 'number', label: '重复几次', required: true, default: 3, min: 1 },
    ],
    emit(n, ctx) {
      const t = Number(n.props.times);
      if (!Number.isFinite(t) || t < 1) return { error: '「重复 N 次」的次数要是大于 0 的整数' };
      return { lines: [`repeat(${Math.round(t)}) {`] };
    },
  },
  {
    key: 'loop.forEach',
    category: 'loop',
    level: 'basic',
    label: '对每个单位做',
    terms: 'forEach for 循环 批量 每个 遍历 单位列表',
    codeHint: 'targets.forEach { unit -> ... }',
    labelName: 'forEach',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    props: [
      { key: 'listVar', type: 'text', label: '要遍历的列表变量名', required: true, default: 'targets' },
      { key: 'itemName', type: 'text', label: '每个元素叫什么', default: 'unit', noSpace: true },
    ],
    emit(n, ctx) {
      const listVar = String(n.props.listVar || '').trim();
      const item = String(n.props.itemName || 'unit').trim();
      const listExpr = ctx.varOf(listVar);
      if (!listExpr) return { error: `找不到列表「${listVar}」，请先在上面放一个「找出符合条件的单位」` };
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(item)) return { error: `元素名字不合法：${item}` };
      return {
        lines: [`${listExpr}.forEach { ${item} ->`],
        provides: [{ name: item, type: 'Unit', expr: item }],
      };
    },
  },
];

// 定时控件
export const TIMERS = [
  {
    key: 'timer.every',
    category: 'timer',
    level: 'basic',
    label: '每隔 X 秒',
    terms: 'loop delay timer 定时 每隔 周期 反复 心跳',
    codeHint: 'loop(Dispatchers.game) { delay(ms); ... }',
    labelName: 'loop',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    canBeRoot: true,
    props: [
      { key: 'ms', type: 'number', label: '间隔多少毫秒', required: true, default: 30000, min: 1 },
      { key: 'firstDelay', type: 'boolean', label: '先等再执行', default: true },
    ],
    emit(n, ctx) {
      const ms = Number(n.props.ms);
      if (!Number.isFinite(ms) || ms < 1) return { error: '「每隔 X 秒」的间隔要大于 0' };
      const lines = [`loop(Dispatchers.game) {`];
      if (n.props.firstDelay !== false) lines.push(`    delay(${Math.round(ms)}L)`);
      return { lines };
    },
  },
];

// 查询控件：找出符合条件的单位
export const QUERIES = [
  {
    key: 'query.units',
    category: 'query',
    level: 'basic',
    label: '找出符合条件的单位',
    terms: 'Groups.unit filter 查询 找出 筛选 单位 列表 搜索',
    codeHint: 'val targets = Groups.unit.filter { ... }',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    produces: [{ name: 'targets', type: 'UnitList' }],
    props: [
      { key: 'name', type: 'text', label: '结果叫什么名字', required: true, default: 'targets', noSpace: true },
      {
        key: 'scope', type: 'select', label: '在哪些单位里找', required: true, default: 'enemy',
        options: [
          ['enemy', '敌方单位'],
          ['ally', '我方单位'],
          ['all', '所有单位'],
          ['team', '指定队伍的单位'],
        ],
      },
      {
        key: 'team', type: 'select', label: '哪个队伍', default: 'sharded', showIf: { scope: 'team' },
        options: [['sharded', '蓝队 (sharded)'], ['crux', '红队 (crux)'], ['green', '绿队 (green)'], ['purple', '紫队 (purple)']],
      },
      { key: 'healthy', type: 'boolean', label: '只要还活着的', default: true },
      { key: 'notPlayer', type: 'boolean', label: '排除玩家操控的单位', default: false },
      { key: 'flyingOnly', type: 'boolean', label: '只要飞行单位', default: false },
      { key: 'groundOnly', type: 'boolean', label: '只要地面单位', default: false },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || 'targets').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `结果名字不合法：${name}` };
      const conds = [];
      const scope = n.props.scope || 'enemy';
      if (scope === 'enemy') conds.push('it.team == state.rules.waveTeam');
      else if (scope === 'ally') {
        const p = ctx.varOfType('Player');
        if (p) conds.push(`it.team == ${p}.team()`);
        else conds.push('it.team == state.rules.defaultTeam');
      } else if (scope === 'team') conds.push(`it.team == Team.${n.props.team || 'sharded'}`);
      if (n.props.healthy !== false) conds.push('it.health > 0');
      if (n.props.notPlayer) conds.push('!it.isPlayer');
      if (n.props.flyingOnly) conds.push('it.type.flying');
      if (n.props.groundOnly) conds.push('!it.type.flying');

      const body = conds.length ? conds.join(' && ') : 'true';
      return {
        lines: [`val ${name} = Groups.unit.filter { ${body} }`],
        provides: [{ name, type: 'UnitList' }],
      };
    },
  },
];
