// 动作控件目录（第二批）：对世界 / 单位 / 玩家做事
//
// 每一条 API 都在工作区 ScriptAgent4MindustryExt-3.4.0-scripts 里找到过真实
// 用法。凡是语料里查不到的写法（如 unit.damage / unit.heal / Sounds.*）一律不做。

import { POS_PROPS, posExpr } from './actions.js';

const TEAM_OPTIONS = [
  ['sharded', '蓝队 (sharded)'],
  ['crux', '红队 (crux)'],
  ['green', '绿队 (green)'],
  ['purple', '紫队 (purple)'],
  ['derelict', '中立 (derelict)'],
];

/** 取一个单位表达式；on='spawned' 时用上游「生成单位」产出的 newUnit */
function unitExpr(n, ctx, label) {
  if ((n.props.on || 'ctx') === 'spawned') {
    const u = ctx.varOf('newUnit');
    if (!u) return { error: `「${label}」选择「下面新生成的单位」，但上游没有「生成单位」` };
    return { expr: u };
  }
  const u = ctx.varOfType('Unit');
  if (!u) return { error: `「${label}」需要一个单位，但这条链上没有单位来源（挂到「单位死亡」「玩家点击方块」等下面，或先用「找出符合条件的单位」/「对每个单位做」）` };
  return { expr: u };
}

const UNIT_SOURCE_PROP = {
  key: 'on', type: 'select', label: '对哪个单位', required: true, default: 'ctx',
  options: [['ctx', '上游的单位'], ['spawned', '下面新生成的单位']],
};

export const ACTIONS2 = [
  // ---------------- 传送到指定位置 ----------------
  {
    key: 'action.teleport',
    category: 'action',
    level: 'basic',
    label: '传送单位到某处',
    terms: 'set snapInterpolation 传送 瞬移 移动 teleport 位置',
    codeHint: 'unit.set(x, y); unit.snapInterpolation()',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [UNIT_SOURCE_PROP, ...POS_PROPS],
    emit(n, ctx) {
      const u = unitExpr(n, ctx, '传送单位');
      if (u.error) return u;
      const pos = posExpr(n, ctx);
      if (!pos) return { error: '「传送单位」需要位置，但选的位置来源在这条链上不存在' };
      // 传送后必须 snapInterpolation()，否则画面会从上个位置插值过去（工作区里 3 处都这么写）
      return {
        lines: [
          `${u.expr}.set(${pos.x}, ${pos.y})`,
          `${u.expr}.snapInterpolation()`,
        ],
      };
    },
  },

  // ---------------- 杀死单位 ----------------
  {
    key: 'action.killUnit',
    category: 'action',
    level: 'basic',
    label: '消灭单位',
    terms: 'kill 杀死 消灭 清除 移除 unit',
    codeHint: 'unit.kill()',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      UNIT_SOURCE_PROP,
      {
        key: 'scope', type: 'select', label: '消灭范围', required: true, default: 'one',
        options: [['one', '就这一个'], ['team', '某个队伍的全部单位']],
      },
      { key: 'team', type: 'select', label: '哪个队伍', default: 'crux', showIf: { scope: 'team' }, options: TEAM_OPTIONS },
    ],
    emit(n, ctx) {
      if ((n.props.scope || 'one') === 'team') {
        const t = `Team.${n.props.team || 'crux'}`;
        return { lines: [`Groups.unit.each { if (it.team == ${t}) it.kill() }`] };
      }
      const u = unitExpr(n, ctx, '消灭单位');
      if (u.error) return u;
      return { lines: [`${u.expr}.kill()`] };
    },
  },

  // ---------------- 改单位血量 ----------------
  {
    key: 'action.setHealth',
    category: 'action',
    level: 'advanced',
    label: '设置单位血量',
    terms: 'health 血量 回血 治疗 加血 残血',
    codeHint: 'unit.health = 100f',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      UNIT_SOURCE_PROP,
      {
        key: 'mode', type: 'select', label: '怎么设', required: true, default: 'set',
        options: [['set', '设成固定值'], ['full', '回满血'], ['ratio', '设成最大血量的百分之几'], ['add', '加上/减去一些']],
      },
      { key: 'value', type: 'number', label: '数值', default: 100, showIf: { mode: 'set' } },
      { key: 'percent', type: 'number', label: '百分比', default: 50, min: 0, showIf: { mode: 'ratio' } },
      { key: 'delta', type: 'number', label: '加减多少（负数为扣血）', default: -50, showIf: { mode: 'add' } },
    ],
    emit(n, ctx) {
      const u = unitExpr(n, ctx, '设置单位血量');
      if (u.error) return u;
      const e = u.expr;
      const mode = n.props.mode || 'set';
      if (mode === 'full') return { lines: [`${e}.health = ${e}.maxHealth`] };
      if (mode === 'ratio') {
        const p = Number(n.props.percent);
        if (!Number.isFinite(p)) return { error: '「设置单位血量」的百分比要填数字' };
        return { lines: [`${e}.health = ${e}.maxHealth * ${ctx.num(p / 100)}f`] };
      }
      if (mode === 'add') {
        const d = Number(n.props.delta);
        if (!Number.isFinite(d)) return { error: '「设置单位血量」的加减值要填数字' };
        return { lines: [`${e}.health = (${e}.health + ${ctx.num(d)}f).coerceIn(0f, ${e}.maxHealth)`] };
      }
      const v = Number(n.props.value);
      if (!Number.isFinite(v)) return { error: '「设置单位血量」的数值要填数字' };
      return { lines: [`${e}.health = ${ctx.num(v)}f`] };
    },
  },

  // ---------------- 给单位打标记 ----------------
  {
    key: 'action.setFlag',
    category: 'action',
    level: 'advanced',
    label: '给单位打标记',
    terms: 'flag 标记 标签 识别 分类',
    codeHint: 'unit.flag = 1.0',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      UNIT_SOURCE_PROP,
      { key: 'flag', type: 'number', label: '标记编号', required: true, default: 1, min: 0 },
    ],
    emit(n, ctx) {
      const u = unitExpr(n, ctx, '给单位打标记');
      if (u.error) return u;
      const f = Number(n.props.flag);
      if (!Number.isFinite(f)) return { error: '「给单位打标记」的编号要填数字' };
      // flag 是 Double：towerDefend.kts:92 写的就是 val specialFlag = 1024.0，
      // 赋整数会类型不匹配，所以必须带小数点。
      const lit = Number.isInteger(f) ? `${f}.0` : String(f);
      return { lines: [`${u.expr}.flag = ${lit}`] };
    },
  },

  // ---------------- 放置 / 移除方块 ----------------
  {
    key: 'action.setBlock',
    category: 'action',
    level: 'advanced',
    label: '放置 / 移除方块',
    terms: 'setBlock setNet setAir removeNet 方块 建筑 放置 拆除',
    codeHint: 'tile.setNet(Blocks.titaniumWall, Team.sharded, 0)',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'op', type: 'select', label: '做什么', required: true, default: 'place',
        options: [['place', '放一个方块'], ['remove', '把这个方块移除']],
      },
      {
        key: 'block', type: 'select', label: '放什么方块', default: 'titaniumWall', showIf: { op: 'place' },
        options: [
          ['titaniumWall', '钛墙'], ['copperWall', '铜墙'], ['thoriumWall', '钍墙'],
          ['router', '路由器'], ['sorter', '分类器'], ['unloader', '装卸器'],
          ['mender', '修理器'], ['battery', '电池'], ['combustionGenerator', '内燃发电机'],
          ['coreShard', '核心：碎片'], ['air', '空气（等于移除）'],
        ],
      },
      {
        key: 'team', type: 'select', label: '属于哪个队伍', default: 'ctx', showIf: { op: 'place' },
        options: [['ctx', '上游的队伍 / 方块所属队伍'], ...TEAM_OPTIONS],
      },
      {
        key: 'rotation', type: 'number', label: '朝向（0-3）', default: 0, min: 0, max: 3,
        showIf: { op: 'place' },
      },
    ],
    emit(n, ctx) {
      const t = ctx.varOfType('Tile');
      if (!t) return { error: '「放置 / 移除方块」需要一个方块位置，但这条链上没有方块来源（挂到「玩家点击方块」等下面）' };
      if ((n.props.op || 'place') === 'remove') {
        // 工作区里有 removeNet() / setAir() / remove() 三种，setAir 最保险
        return { lines: [`${t}.setAir()`] };
      }
      let teamExpr;
      if ((n.props.team || 'ctx') === 'ctx') {
        teamExpr = ctx.varOfType('Team') || `${t}.team()`;
      } else teamExpr = `Team.${n.props.team}`;
      const rot = Math.max(0, Math.min(3, Math.round(Number(n.props.rotation) || 0)));
      // setBlock 没有旋转参数，要带朝向必须用 setNet
      if (rot === 0) return { lines: [`${t}.setNet(Blocks.${n.props.block || 'titaniumWall'}, ${teamExpr}, 0)`] };
      return { lines: [`${t}.setNet(Blocks.${n.props.block || 'titaniumWall'}, ${teamExpr}, ${rot})`] };
    },
  },

  // ---------------- 给核心物品 ----------------
  {
    key: 'action.coreItems',
    category: 'action',
    level: 'advanced',
    label: '操作核心里的物品',
    terms: 'items core add remove 核心 物品 资源 清空 扣除',
    codeHint: 'team.data().core()?.items?.add(Items.copper, 100)',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'op', type: 'select', label: '做什么', required: true, default: 'add',
        options: [['add', '增加物品'], ['set', '直接设成某个数量'], ['clear', '清空全部物品']],
      },
      {
        key: 'item', type: 'select', label: '哪种物品', default: 'copper', showIf: { op: 'add' },
        options: [
          ['copper', '铜'], ['lead', '铅'], ['graphite', '石墨'], ['silicon', '硅'],
          ['titanium', '钛'], ['thorium', '钍'], ['metaglass', '钢化玻璃'],
          ['plastanium', '塑钢'], ['surgeAlloy', ' surge 合金'], ['phaseFabric', '相织物'],
        ],
      },
      { key: 'amount', type: 'number', label: '数量', default: 100, min: 0, showIf: { op: 'add' } },
      {
        key: 'to', type: 'select', label: '哪个队伍的核心', required: true, default: 'team',
        options: [['team', '上游队伍的核心'], ['playerTeam', '上游玩家所在队伍的核心'], ['fixed', '指定队伍的核心']],
      },
      { key: 'team', type: 'select', label: '指定队伍', default: 'sharded', showIf: { to: 'fixed' }, options: TEAM_OPTIONS },
    ],
    emit(n, ctx) {
      let teamExpr;
      const to = n.props.to || 'team';
      if (to === 'playerTeam') {
        const p = ctx.varOfType('Player');
        if (!p) return { error: '选择「上游玩家所在队伍的核心」，但这条链上没有玩家' };
        teamExpr = `${p}.team()`;
      } else if (to === 'fixed') {
        teamExpr = `Team.${n.props.team || 'sharded'}`;
      } else {
        const t = ctx.varOfType('Team');
        if (!t) return { error: '「操作核心里的物品」需要队伍，但这条链上没有队伍来源' };
        teamExpr = t;
      }
      if ((n.props.op || 'add') === 'clear') {
        // CoreBuild.items 是 ItemModule，clear() 清空
        return { lines: [`${teamExpr}.data().core()?.items?.clear()`] };
      }
      const amt = Math.max(0, Math.round(Number(n.props.amount) || 0));
      const item = `Items.${n.props.item || 'copper'}`;
      if ((n.props.op || 'add') === 'set') {
        return { lines: [`${teamExpr}.data().core()?.items?.set(${item}, ${amt})`] };
      }
      return { lines: [`${teamExpr}.data().core()?.items?.add(${item}, ${amt})`] };
    },
  },

  // ---------------- 显示常驻信息板 ----------------
  {
    key: 'action.hudText',
    category: 'action',
    level: 'advanced',
    label: '显示常驻信息板',
    terms: 'setHudTextReliable HUD 信息板 常驻 计分板 显示',
    codeHint: 'Call.setHudTextReliable(player.con, "文字")',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'text', type: 'template', label: '显示什么', required: true, default: '当前波数：{wave}', placeholder: '可用 {player.name} 这样的占位符' },
      {
        key: 'target', type: 'select', label: '给谁看', required: true, default: 'all',
        options: [['all', '全服所有人'], ['player', '上游的那个玩家']],
      },
    ],
    emit(n, ctx) {
      // setHudTextReliable 显示在屏幕左上，会一直留着直到被覆盖
      const text = ctx.msgTemplate(n.props.text || '', ['player', 'message', 'unit']);
      if ((n.props.target || 'all') === 'player') {
        const p = ctx.varOfType('Player');
        if (!p) return { error: '选择「上游的那个玩家」，但这条链上没有玩家' };
        return { lines: [`Call.setHudTextReliable(${p}.con, ${text})`] };
      }
      return { lines: [`Groups.player.forEach { Call.setHudTextReliable(it.con, ${text}) }`] };
    },
  },

  // ---------------- 弹出一行公告（大字） ----------------
  {
    key: 'action.announceBig',
    category: 'action',
    level: 'advanced',
    label: '弹公告 / 大字提示',
    terms: 'announce infoPopup warningToast 公告 大字 弹窗 提示',
    codeHint: 'Call.announce(player.con, "文字")',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'kind', type: 'select', label: '用哪种', required: true, default: 'toast',
        options: [
          ['toast', '屏幕上方小提示'],
          ['warn', '警告提示'],
          ['announce', '公告横幅（全屏）'],
        ],
      },
      { key: 'text', type: 'template', label: '显示什么', required: true, default: '注意！', placeholder: '可用 {player.name} 这样的占位符' },
      {
        key: 'target', type: 'select', label: '给谁看', required: true, default: 'all',
        options: [['all', '全服所有人'], ['player', '上游的那个玩家'], ['team', '上游的队伍']],
      },
    ],
    emit(n, ctx) {
      const text = ctx.msgTemplate(n.props.text || '', ['player', 'message', 'unit']);
      const kind = n.props.kind || 'toast';
      const target = n.props.target || 'all';

      // Call.* 第一个参数都是 NetConnection（con）
      let playersExpr;
      if (target === 'player') {
        const p = ctx.varOfType('Player');
        if (!p) return { error: '选择「上游的那个玩家」，但这条链上没有玩家' };
        playersExpr = `listOf(${p})`;
      } else if (target === 'team') {
        const t = ctx.varOfType('Team');
        if (!t) return { error: '选择「上游的队伍」，但这条链上没有队伍' };
        // Team 上没有 players 字段（javap 核实过），只能从 Groups.player 里筛
        playersExpr = `Groups.player.filter { it.team() == ${t} }`;
      } else {
        playersExpr = 'Groups.player';
      }

      if (kind === 'announce') {
        return { lines: [`${playersExpr}.forEach { Call.announce(it.con, ${text}) }`] };
      }
      if (kind === 'warn') {
        // 工作区里是 Call.warningToast(this.con, Iconc.warning.code, msg)
        return { lines: [`${playersExpr}.forEach { Call.warningToast(it.con, Iconc.warning.code, ${text}) }`] };
      }
      return { lines: [`${playersExpr}.forEach { Call.infoToast(it.con, ${text}, 3f) }`] };
    },
  },

  // ---------------- 停止运行（提前结束这段逻辑） ----------------
  {
    key: 'action.returnNow',
    category: 'action',
    level: 'advanced',
    label: '到此为止（不再往下执行）',
    terms: 'return return@listen 提前 结束 中止 停止',
    codeHint: 'return@listen',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [],
    props: [],
    emit(n, ctx) {
      // 标签取决于当前处在哪个 lambda 里：事件体 return@listen / return@onEnable、
      // 指令体 return@body、循环 return@repeat / return@forEach / return@loop、
      // 延时块 return@launch
      const label = ctx.returnLabel && ctx.returnLabel();
      if (!label) {
        return { error: '「到此为止」只能放在事件、指令、循环或延时的里面（它要提前跳出那一段）' };
      }
      return { lines: [`return@${label}`] };
    },
  },
];
