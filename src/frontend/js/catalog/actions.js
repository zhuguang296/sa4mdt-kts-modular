// 动作控件目录
// emit(node, ctx) 返回该节点自身的代码行数组（不含子树）；未闭合的 { 由其自己负责开，
// 闭合符号用 node.def.closers 声明，由生成器在子树后输出。
//
// ctx 提供 varOf(varName)（变量表达式，不存在返回 null）、hasVar(type)、
// lit(str)（转义成 Kotlin 字面量）、msgTemplate(str, varNames)（生成
// ".with(...)" 表达式）、num(v) / bool(v)。
const MSG_TYPES = [
  ['MsgType.Message', '普通聊天'],
  ['MsgType.InfoMessage', '屏幕中央大字'],
  ['MsgType.InfoToast', '屏幕上方提示'],
  ['MsgType.WarningToast', '警告提示'],
  ['MsgType.Announce', '公告横幅'],
];

/** 位置来源的通用参数定义 */
export const POS_PROPS = [
  {
    key: 'pos', type: 'select', label: '位置', required: true, default: 'tile',
    options: [
      ['tile', '上游的方块'],
      ['unit', '上游的单位'],
      ['player', '上游的玩家'],
      ['fixed', '固定坐标'],
    ],
  },
  { key: 'px', type: 'number', label: 'X 坐标', default: 0, showIf: { pos: 'fixed' } },
  { key: 'py', type: 'number', label: 'Y 坐标', default: 0, showIf: { pos: 'fixed' } },
];

/** 生成位置表达式 */
export function posExpr(n, ctx) {
  const p = n.props.pos || 'tile';
  if (p === 'fixed') return { x: `${ctx.num(n.props.px || 0)}f`, y: `${ctx.num(n.props.py || 0)}f` };
  if (p === 'tile') {
    const t = ctx.varOfType('Tile');
    if (!t) return null;
    return { x: `${t}.worldx()`, y: `${t}.worldy()` };
  }
  if (p === 'unit') {
    const u = ctx.varOfType('Unit');
    if (!u) return null;
    return { x: `${u}.x`, y: `${u}.y` };
  }
  if (p === 'player') {
    const pl = ctx.varOfType('Player');
    if (!pl) return null;
    return { x: `${pl}.x`, y: `${pl}.y` };
  }
  return null;
}

export const ACTIONS = [
  // ---------------- 发消息 ----------------
  {
    key: 'action.broadcast',
    category: 'action',
    level: 'basic',
    label: '发消息',
    terms: 'broadcast sendMessage 消息 广播 聊天 提示 喊话 msg',
    codeHint: 'broadcast("...".with()) / player.sendMessage(...)',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'target', type: 'select', label: '发给谁', required: true, default: 'all',
        options: [['all', '全服所有人'], ['player', '上游的那个玩家'], ['team', '指定队伍的所有玩家']],
      },
      { key: 'text', type: 'template', label: '说什么', required: true, default: '欢迎来到本服务器', placeholder: '可用 {player.name} 这样的占位符' },
      { key: 'msgType', type: 'select', label: '显示方式', default: 'MsgType.Message', options: MSG_TYPES },
      { key: 'quite', type: 'boolean', label: '不在控制台打印', default: false },
    ],
    emit(n, ctx) {
      const text = ctx.msgTemplate(n.props.text || '', ['player', 'message', 'unit']);
      const mt = n.props.msgType || 'MsgType.Message';
      const target = n.props.target || 'all';
      if (target === 'player') {
        const p = ctx.varOfType('Player');
        if (!p) return { error: '选择「发给上游的那个玩家」，但这条链上没有玩家（试试挂到「玩家进服」下面）' };
        return { lines: [`${p}.sendMessage(${text}, ${mt}, 10f)`] };
      }
      if (target === 'team') {
        const t = ctx.varOfType('Team');
        if (!t) return { error: '选择「发给指定队伍」，但这条链上没有队伍' };
        return { lines: [`broadcast(${text}, ${mt}, 10f, quite = ${n.props.quite ? 'true' : 'false'}, players = ${t}.players)`] };
      }
      const args = [`${text}`, mt, '10f'];
      if (n.props.quite) args.push('quite = true');
      return { lines: [`broadcast(${args.join(', ')})`] };
    },
  },

  // ---------------- 给单位加状态 ----------------
  {
    key: 'action.applyStatus',
    category: 'action',
    level: 'basic',
    label: '给单位加状态',
    terms: 'apply StatusEffects 状态 减速 眩晕 无敌 效果 中毒',
    codeHint: 'unit.apply(StatusEffects.slow, 5f * 60f)',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'status', type: 'select', label: '加什么状态', required: true, default: 'unmoving',
        options: [
          // 以下 4 项已在工作区脚本中确认出现
          ['unmoving', '无法移动'],
          ['electrified', '通电（持续掉血）'],
          ['disarmed', '无法攻击'],
          ['invincible', '无敌'],
          // 以下是 Mindustry 自带状态，但本工作区脚本里没出现过，未验证
          ['slow', '减速（未验证）'],
          ['boss', '变成 Boss（未验证）'],
          ['mapped', '被标记（未验证）'],
        ],
      },
      { key: 'seconds', type: 'number', label: '持续几秒', required: true, default: 5, min: 0.1 },
      {
        key: 'on', type: 'select', label: '对哪个单位', required: true, default: 'ctx',
        options: [['ctx', '上游的单位'], ['spawned', '下面新生成的单位']],
      },
    ],
    emit(n, ctx) {
      // 「下面新生成的单位」= 上游「生成单位」产出的 newUnit
      let u;
      if ((n.props.on || 'ctx') === 'spawned') {
        u = ctx.varOf('newUnit');
        if (!u) return { error: '选择「下面新生成的单位」，但上游没有「生成单位」（先在上面放一个，并且把「结果叫什么」留默认的 newUnit）' };
      } else {
        u = ctx.varOfType('Unit');
        if (!u) return { error: '「给单位加状态」需要一个单位，但这条链上没有单位来源（挂到「单位死亡」「玩家点击方块」等下面，或先用「找出符合条件的单位」/「对每个单位做」）' };
      }
      const sec = ctx.num(n.props.seconds == null ? 5 : n.props.seconds);
      return { lines: [`${u}.apply(StatusEffects.${n.props.status || 'unmoving'}, ${sec}f * 60f)`] };
    },
  },

  // ---------------- 生成单位 ----------------
  {
    key: 'action.spawnUnit',
    category: 'action',
    level: 'basic',
    label: '生成单位',
    terms: 'spawn UnitTypes 生成 刷怪 出兵 单位',
    codeHint: 'UnitTypes.dagger.spawn(team, x, y)',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    produces: [{ name: 'newUnit', type: 'Unit', nameFrom: null }],
    props: [
      {
        key: 'unitType', type: 'select', label: '生成什么单位', required: true, default: 'mono',
        options: [
          // 以下 4 项已在工作区脚本的 UnitTypes.xxx 调用中出现
          ['mono', '单子（采矿机）'],
          ['poly', '多面体（修理机）'],
          ['mega', '百万（高级采矿）'],
          ['vela', '维拉'],
          // 以下是 Mindustry 原版单位，本工作区脚本里未出现，未验证
          ['dagger', '匕首（未验证）'],
          ['mace', '锤子（未验证）'],
          ['fortress', '堡垒（未验证）'],
          ['flare', 'flare（未验证）'],
          ['horizon', '地平线（未验证）'],
          ['nova', '新星（未验证）'],
          ['pulsar', '脉冲（未验证）'],
          ['crawler', '爬虫（未验证）'],
          ['spiroct', '旋螺（未验证）'],
        ],
      },
      {
        key: 'team', type: 'select', label: '属于哪个队伍', required: true, default: 'ctx',
        options: [['ctx', '上游的队伍'], ['wave', '敌人（刷怪方）'], ['sharded', '蓝队 (sharded)'], ['crux', '红队 (crux)']],
      },
      ...POS_PROPS,
    ],
    emit(n, ctx) {
      let teamExpr;
      const t = n.props.team || 'ctx';
      if (t === 'ctx') {
        const tv = ctx.varOfType('Team');
        if (!tv) return { error: '选择「上游的队伍」，但这条链上没有队伍来源' };
        teamExpr = tv;
      } else if (t === 'wave') teamExpr = 'state.rules.waveTeam';
      else teamExpr = `Team.${t}`;

      const pos = posExpr(n, ctx);
      if (!pos) return { error: '「生成单位」需要位置，但选的位置来源在这条链上不存在' };
      // 用 val 接住，这样后面的动作可以引用「刚生成的单位」
      return { lines: [`val newUnit = UnitTypes.${n.props.unitType || 'dagger'}.spawn(${teamExpr}, ${pos.x}, ${pos.y})`] };
    },
  },

  // ---------------- 给物品 ----------------
  {
    key: 'action.giveItem',
    category: 'action',
    level: 'basic',
    label: '给物品 / 资源',
    terms: 'items add Items 物品 资源 材料 给东西 核心',
    codeHint: 'team.data().core()?.items?.add(Items.copper, 100)',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'item', type: 'select', label: '给什么', required: true, default: 'copper',
        options: [
          ['copper', '铜'], ['lead', '铅'], ['graphite', '石墨'], ['silicon', '硅'],
          ['titanium', '钛'], ['thorium', '钍'], ['plastanium', '塑钢'],
          ['phaseFabric', '相织物'], ['surgeAlloy', ' surge 合金'], ['metaglass', '钢化玻璃'],
          ['sand', '沙子'], ['coal', '煤炭'], ['sporePod', '孢子荚'],
        ],
      },
      { key: 'amount', type: 'number', label: '给多少', required: true, default: 100, min: 1 },
      {
        key: 'to', type: 'select', label: '给谁', required: true, default: 'team',
        options: [['team', '上游队伍的核心'], ['playerTeam', '上游玩家所在队伍的核心']],
      },
    ],
    emit(n, ctx) {
      const amt = Math.round(n.props.amount == null ? 100 : n.props.amount);
      const item = `Items.${n.props.item || 'copper'}`;
      let teamExpr;
      if ((n.props.to || 'team') === 'playerTeam') {
        const p = ctx.varOfType('Player');
        if (!p) return { error: '选择「上游玩家所在队伍」，但这条链上没有玩家' };
        teamExpr = `${p}.team()`;
      } else {
        const t = ctx.varOfType('Team');
        if (!t) return { error: '「给物品」需要队伍，但这条链上没有队伍来源' };
        teamExpr = t;
      }
      return { lines: [`${teamExpr}.data().core()?.items?.add(${item}, ${amt})`] };
    },
  },

  // ---------------- 修改游戏规则 ----------------
  {
    key: 'action.setRule',
    category: 'action',
    level: 'advanced',
    label: '修改游戏规则',
    terms: 'state.rules 规则 设置 关闭 开启 pvp 火 蔓延 波次',
    codeHint: 'state.rules.fire = false',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'rule', type: 'select', label: '改哪条规则', required: true, default: 'fire',
        options: [
          ['fire', '火焰蔓延'],
          ['canGameOver', '允许游戏结束'],
          ['pvp', 'PvP 模式'],
          ['disableWorldProcessors', '禁用世界处理器'],
          ['unitCap', '单位上限'],
          ['waveTimer', '波次倒计时'],
          ['waveSpacing', '波次间隔'],
          ['buildSpeedMultiplier', '建造速度倍率'],
          ['unitBuildSpeedMultiplier', '单位建造速度倍率'],
          ['unitDamageMultiplier', '单位伤害倍率'],
          ['unitHealthMultiplier', '单位血量倍率'],
          ['blockDamageMultiplier', '建筑伤害倍率'],
          ['blockHealthMultiplier', '建筑血量倍率'],
        ],
      },
      {
        key: 'value', type: 'select', label: '设成', required: true, default: 'false',
        options: [['true', '开启 / 是'], ['false', '关闭 / 否']],
        showIfType: 'boolean',
      },
      { key: 'numValue', type: 'number', label: '数值', default: 1 },
    ],
    emit(n, ctx) {
      const boolRules = ['fire', 'canGameOver', 'pvp', 'disableWorldProcessors'];
      const rule = n.props.rule || 'fire';
      if (boolRules.includes(rule)) {
        return { lines: [`state.rules.${rule} = ${n.props.value === 'true' ? 'true' : 'false'}`] };
      }
      const v = ctx.num(n.props.numValue == null ? 1 : n.props.numValue);
      const isInt = ['unitCap'].includes(rule);
      return { lines: [`state.rules.${rule} = ${isInt ? Math.round(Number(v)) : v + 'f'}`] };
    },
  },

  // ---------------- 特效 / 标记 ----------------
  {
    key: 'action.effect',
    category: 'action',
    level: 'advanced',
    label: '播放特效 / 打标记',
    terms: 'effect label Fx Call 特效 标记 文字 提示 显示',
    codeHint: 'Call.effect(Fx.placeBlock, x, y, 0f, Color.red) / Call.label("文字", 5f, x, y)',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'kind', type: 'select', label: '做什么', required: true, default: 'label',
        options: [['label', '在位置上显示一行字'], ['effect', '播放一个特效']],
      },
      { key: 'text', type: 'text', label: '显示的文字', default: '看这里', showIf: { kind: 'label' } },
      { key: 'seconds', type: 'number', label: '显示几秒', default: 5, showIf: { kind: 'label' } },
      {
        key: 'fx', type: 'select', label: '特效', default: 'placeBlock', showIf: { kind: 'effect' },
        options: [
          ['placeBlock', '方块放置'], ['breakBlock', '方块破碎'], ['smoke', '烟雾'],
          ['hit', '命中'], ['explosion', '爆炸'], ['spark', '火花'], ['none', '无特效（只发声）'],
        ],
      },
      ...POS_PROPS,
    ],
    emit(n, ctx) {
      const pos = posExpr(n, ctx);
      if (!pos) return { error: '「播放特效 / 打标记」需要位置，但选的位置来源在这条链上不存在' };
      if ((n.props.kind || 'label') === 'label') {
        const txt = ctx.lit(n.props.text || '');
        const sec = ctx.num(n.props.seconds == null ? 5 : n.props.seconds);
        return { lines: [`Call.label(${txt}, ${sec}f * 60f, ${pos.x}, ${pos.y})`] };
      }
      return { lines: [`Call.effect(Fx.${n.props.fx || 'placeBlock'}, ${pos.x}, ${pos.y}, 0f, Color.white)`] };
    },
  },

  // ---------------- 玩家操作 ----------------
  {
    key: 'action.playerControl',
    category: 'action',
    level: 'advanced',
    label: '对玩家操作',
    terms: 'kick team 踢出 换队 移动 玩家 管理',
    codeHint: 'player.kick("原因", 0) / player.team(Team.sharded)',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'op', type: 'select', label: '做什么', required: true, default: 'kick',
        options: [['kick', '踢出服务器'], ['team', '换到指定队伍'], ['clearUnit', '销毁他的单位']],
      },
      { key: 'reason', type: 'text', label: '踢出理由', default: '被管理员移出', showIf: { op: 'kick' } },
      {
        key: 'team', type: 'select', label: '换到哪队', default: 'sharded', showIf: { op: 'team' },
        options: [['sharded', '蓝队 (sharded)'], ['crux', '红队 (crux)'], ['green', '绿队 (green)'], ['purple', '紫队 (purple)']],
      },
    ],
    emit(n, ctx) {
      const p = ctx.varOfType('Player');
      if (!p) return { error: '「对玩家操作」需要一个玩家，但这条链上没有玩家来源' };
      const op = n.props.op || 'kick';
      if (op === 'kick') return { lines: [`${p}.kick(${ctx.lit(n.props.reason || '')}, 0)`] };
      if (op === 'team') return { lines: [`${p}.team(Team.${n.props.team || 'sharded'})`] };
      return { lines: [`${p}.unit()?.kill()`] };
    },
  },

  // ---------------- 延时（带子节点槽） ----------------
  {
    key: 'action.delayed',
    category: 'action',
    level: 'advanced',
    label: '等一会儿再做',
    terms: 'delay launch 延时 等待 延迟 秒后',
    codeHint: 'launch(Dispatchers.game) { delay(3000L); ... }',
    labelName: 'launch',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    props: [
      { key: 'ms', type: 'number', label: '等多少毫秒', required: true, default: 3000, min: 1 },
    ],
    emit(n, ctx) {
      const ms = Math.max(1, Math.round(n.props.ms == null ? 3000 : n.props.ms));
      return { lines: [`launch(Dispatchers.game) {`, `    delay(${ms}L)`] };
    },
  },

  // ---------------- 注册指令（根节点，带子节点槽） ----------------
  {
    key: 'action.registerCommand',
    category: 'action',
    level: 'basic',
    label: '做一个服务器指令',
    terms: 'command 指令 命令 cmd 注册 自定义 权限',
    codeHint: 'command("名字", "说明") { ... body { ... } }',
    inPorts: [],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    isRoot: true,
    props: [
      { key: 'name', type: 'text', label: '指令名字', required: true, default: 'hello', placeholder: '只能字母数字，例如 hello', noSpace: true },
      { key: 'desc', type: 'text', label: '说明', default: '打个招呼' },
      { key: 'aliases', type: 'text', label: '别名（用逗号分隔）', default: '' },
      { key: 'playerOnly', type: 'boolean', label: '只有玩家能用', default: true },
      { key: 'permission', type: 'text', label: '需要的权限（留空则人人可用）', default: '' },
      { key: 'cooldownSec', type: 'number', label: '冷却（秒，0 = 不限）', default: 0, min: 0,
        hint: '同一个人在这个秒数内重复用，会被挡下来' },
    ],
    // 特殊：需要包一层 body { }
    wrapper: true,
    // body { } 里的 lambda，标签是 return@body
    labelName: 'body',
    emit(n, ctx) {
      const name = String(n.props.name || '').trim();
      if (!name) return { error: '「服务器指令」还没填指令名字' };
      if (/\s/.test(name)) return { error: `指令名字不能有空格：${name}` };
      const lines = [];
      const aliases = String(n.props.aliases || '')
        .split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const perm = String(n.props.permission || '').trim();

      // 冷却：CommandApi.kt:194 的 attrs.forEach 在 body 之前跑，但 CommandInfo.attr
      // 必须在 body 之前调用（:140 有 frozen 守卫），而我们要「检查 + 记录」两件事。
      // 真实的 SkillCooldown（wayzer/user/ext/skills.lib.kt:31）只检查、不记录 ——
      // setCoolDown() 只有 skillBody 才会调（:92），普通 body { } 里用它就会「用一次
      // 之后永远不能用」。所以这里自己维护一张表，和 vote.lib.kt:215 的
      // `internal val coolDowns = mutableMapOf<String, Long>()` 是同一套办法。
      const sec = Math.max(0, Number(n.props.cooldownSec) || 0);
      // 用节点 id 而不是指令名：同一张画布上两个指令重名时也不会撞声明
      const mapName = `cd_${String(n.id).replace(/[^A-Za-z0-9_]/g, '_')}`;
      if (sec > 0) lines.push(`val ${mapName} = mutableMapOf<String, Long>()`);

      lines.push(`command(${ctx.lit(name)}, ${ctx.lit(n.props.desc || '')}) {`);
      if (aliases.length) lines.push(`    aliases = listOf(${aliases.map(a => ctx.lit(a)).join(', ')})`);
      if (n.props.playerOnly) lines.push(`    attr(ClientOnly)`);
      if (perm) lines.push(`    requirePermission(${ctx.lit(perm)})`);
      // body { 由生成器的 wrapper 逻辑补上
      // 指令体里「当前玩家」就是 player!!（勾了「只有玩家能用」时它一定不为空）
      const sv = n.props.playerOnly
        ? [{ name: 'player', type: 'Player', expr: 'player!!' }]
        : [];

      const bodyPrelude = [];
      if (sec > 0) {
        const ms = Math.round(sec * 1000);
        // player 在这里用 CommandContext.player（CommandImpl.kt:187，可能为 null），
        // 所以加个兜底 key，非玩家执行也不会崩。
        bodyPrelude.push(`val cdKey = player?.uuid() ?: "-"`);
        bodyPrelude.push(`val cdNow = System.currentTimeMillis()`);
        bodyPrelude.push(`if (cdNow - (${mapName}[cdKey] ?: 0L) < ${ms}L) return@body reply("[yellow]冷却中，请稍后再试".with())`);
        bodyPrelude.push(`${mapName}[cdKey] = cdNow`);
      }

      return { lines, scopeVars: sv, bodyPrelude };
    },
  },

  // ---------------- 配置项（根节点） ----------------
  {
    key: 'action.config',
    category: 'action',
    level: 'advanced',
    label: '可调的设置项',
    terms: 'config key 配置 设置 参数 可调 服务器修改',
    codeHint: 'val x by config.key(默认值, "说明")',
    inPorts: [],
    outPorts: [{ id: 'out', type: 'flow' }],
    isRoot: true,
    produces: [{ name: 'value', type: 'Number', nameFrom: 'name' }],
    props: [
      { key: 'name', type: 'text', label: '设置项名字', required: true, default: 'amount', noSpace: true },
      {
        key: 'valueType', type: 'select', label: '类型', required: true, default: 'Int',
        options: [['Int', '整数'], ['Long', '长整数'], ['Boolean', '开关'], ['String', '文本'], ['Double', '小数']],
      },
      { key: 'default', type: 'text', label: '默认值', default: '1' },
      { key: 'desc', type: 'text', label: '说明', default: '服务器管理员可以用 /sa config 修改' },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || '').trim();
      if (!name) return { error: '「可调的设置项」还没填名字' };
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `设置项名字只能用字母数字下划线，且不能以数字开头：${name}` };
      const t = n.props.valueType || 'Int';
      let lit;
      const raw = String(n.props.default == null ? '' : n.props.default);
      if (t === 'Boolean') lit = raw === 'true' ? 'true' : 'false';
      else if (t === 'String') lit = ctx.lit(raw);
      else {
        const num = Number(raw);
        lit = Number.isFinite(num) ? String(num) + (t === 'Long' ? 'L' : '') : (t === 'String' ? ctx.lit(raw) : '0');
      }
      return { lines: [`val ${name} by config.key(${lit}, ${ctx.lit(n.props.desc || '')})`] };
    },
  },

  // ---------------- 权限声明（根节点） ----------------
  {
    key: 'action.permission',
    category: 'action',
    level: 'advanced',
    label: '声明一个权限',
    terms: 'PermissionApi registerDefault 权限 声明 管理员 组',
    codeHint: 'PermissionApi.registerDefault("节点", group = "@admin")',
    inPorts: [],
    outPorts: [{ id: 'out', type: 'flow' }],
    isRoot: true,
    props: [
      { key: 'node', type: 'text', label: '权限名字', required: true, default: 'my.plugin.use', noSpace: true },
      {
        key: 'group', type: 'select', label: '默认给哪个组', default: '@admin',
        options: [['@admin', '管理员 (@admin)'], ['@default', '所有人 (@default)']],
      },
    ],
    emit(n, ctx) {
      const node = String(n.props.node || '').trim();
      if (!node) return { error: '「声明权限」还没填权限名字' };
      return { lines: [`PermissionApi.registerDefault(${ctx.lit(node)}, group = ${ctx.lit(n.props.group || '@admin')})`] };
    },
  },

  // ---------------- 存盘数据（根节点） ----------------
  {
    key: 'action.savable',
    category: 'action',
    level: 'advanced',
    label: '记住数据（重启不丢）',
    terms: 'Savable customLoad 存盘 保存 持久 数据 重启',
    codeHint: '@Savable var x = ...; customLoad(::x) { ... }',
    inPorts: [],
    outPorts: [{ id: 'out', type: 'flow' }],
    isRoot: true,
    props: [
      { key: 'name', type: 'text', label: '数据名字', required: true, default: 'counter', noSpace: true },
      {
        key: 'dataType', type: 'select', label: '存什么', required: true, default: 'Int',
        options: [
          ['Int', '一个整数'],
          ['String', '一段文本'],
          ['Boolean', '一个开关'],
          ['MutableList<String>', '一串文本'],
          ['MutableMap<String, String>', '名字 → 文本 的对照表'],
        ],
      },
      { key: 'init', type: 'text', label: '初始值', default: '0' },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || '').trim();
      if (!name) return { error: '「记住数据」还没填名字' };
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `数据名字只能用字母数字下划线，且不能以数字开头：${name}` };
      const t = n.props.dataType || 'Int';
      const raw = String(n.props.init == null ? '' : n.props.init);

      // 一律用 var：存盘后要把磁盘上的值写回来，val 做不到。
      // 工作区里 7 处 @Savable 全都是 val(可变集合)+customLoad 或 var。
      if (t === 'MutableList<String>') {
        return {
          lines: [
            `@Savable(false)`,
            `val ${name} = mutableListOf<String>()`,
            `customLoad(::${name}, ${name}::addAll)`,
          ],
        };
      }
      if (t === 'MutableMap<String, String>') {
        return {
          lines: [
            `@Savable(false)`,
            `val ${name} = mutableMapOf<String, String>()`,
            `customLoad(::${name}) { ${name}.putAll(it) }`,
          ],
        };
      }

      let init;
      if (t === 'Int') init = String(Number.isFinite(Number(raw)) ? Math.round(Number(raw)) : 0);
      else if (t === 'Boolean') init = raw === 'true' ? 'true' : 'false';
      else init = ctx.lit(raw);
      return {
        lines: [
          `@Savable(false)`,
          `var ${name} = ${init}`,
          `customLoad(::${name}) { ${name} = it }`,
        ],
      };
    },
  },

  // ---------------- 键值存储（根节点） ----------------
  {
    key: 'action.kvStore',
    category: 'action',
    level: 'advanced',
    label: '长期存储（数据库）',
    terms: 'KVStore DBApi Services 数据库 键值 存储 持久',
    codeHint: 'Services.get<KVStore>().get().open("name", StringDataType.INSTANCE)',
    inPorts: [],
    outPorts: [{ id: 'out', type: 'flow' }],
    isRoot: true,
    requiresDeps: ['coreLibrary/extApi/KVStore'],
    props: [
      { key: 'name', type: 'text', label: '存储表名字', required: true, default: 'myStore', noSpace: true },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || '').trim();
      if (!name) return { error: '「长期存储」还没填表名字' };
      return {
        lines: [
          `val store = Services.get<KVStore>().get().open(${ctx.lit(name)}, StringDataType.INSTANCE)`,
        ],
        extraDeps: ['coreLibrary/extApi/KVStore'],
      };
    },
  },
];
