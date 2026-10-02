// 「服务器」类控件：直接影响服务端本身的东西（自禁用 / 换图 / 队伍属性 / 显示变量）。
//
// emit 里的写法逐条核实过：
//   * ScriptManager.disableScript(script, "原因") —— 9 个真实调用点全在挂起上下文里
//     （bootStrap/default.kts:20、h2db.kts:15、redisApi.kts:11/23、TDDrop.kts:144 等），
//     所以包一层 launch(Dispatchers.game) 最稳。包进去之后 `this` 变成 CoroutineScope，
//     不能再把 this 当脚本传，改用 thisContextScript()。
//     关于这个 import：`cf.wayzer.scriptAgent.*` 是 SA 给脚本的默认导入
//     （bootStrap/default.kts 零 import 却用 ScriptManager 即为证），
//     语料里的 .kts 用 thisContextScript() 时也不写 import。
//     但 .kt 库有 9 个文件都写了 `import cf.wayzer.scriptAgent.thisContextScript`
//     （CommandApi.kt:10、maps.manager.kt:9、vote.lib.kt:7 …），说明这个路径是真实存在的。
//     显式写出来在语法上完全合法（和默认导入是同一个声明，不会冲突），
//     而且不依赖「默认导入恰好覆盖了它」这个假设，所以这里保留。
//   * wayzer/maps.manager.kt:46 object MapManager；:57 fun loadMap(info: MapInfo? = null)
//     是非挂起的（内部自己 launch），:63 suspend fun loadMapSync 才是挂起的。
//     真实用法 wayzer/reGrief/autoChangeMap.kts:24 直接 MapManager.loadMap()。
//     wayzer/maps.registry.kt:44 MapProvider.findById 是 open suspend。
//   * mindustry.core.GameState.rules: Rules（javap 确认字段名是 rules，不在 Vars 上），
//     Rules.teams: Rules$TeamRules，TeamRules.get(Team): Rules$TeamRule。
//     mapScript/1001.kts:57 的 `teams[Team.get(n)].cheat = true` 就是这个。
//     Rules$TeamRule 的 23 个可写字段类型由 javap 逐个核对（float 要带 f 后缀！）。
//   * coreLibrary/lib/PlaceHoldApi.kt:133 registerVar(name, desc, v)（无需 import）；
//     DynamicVar 要 import cf.wayzer.placehold.DynamicVar（variables.kts:5）。

// Rules$TeamRule 的可写字段，[字段名, 中文, 类型]，类型由 javap 得出
export const TEAM_FIELDS = [
  ['cheat', '作弊模式（无限资源、秒建）', 'boolean'],
  ['infiniteResources', '无限资源', 'boolean'],
  ['fillItems', '核心自动补满物品', 'boolean'],
  ['aiCoreSpawn', 'AI 自动造核心', 'boolean'],
  ['protectCores', '保护核心', 'boolean'],
  ['checkPlacement', '检查建筑放置位置', 'boolean'],
  ['prebuildAi', 'AI 预先建造', 'boolean'],
  ['buildAi', 'AI 自动建造', 'boolean'],
  ['buildAiTier', 'AI 建造等级', 'float'],
  ['rtsAi', 'RTS 模式 AI', 'boolean'],
  ['rtsMinSquad', 'RTS 最小队伍规模', 'int'],
  ['rtsMaxSquad', 'RTS 最大队伍规模', 'int'],
  ['rtsMinWeight', 'RTS 最小权重', 'float'],
  ['unitFactoryActivationDelay', '工厂激活延迟', 'float'],
  ['unitBuildSpeedMultiplier', '单位建造速度倍率', 'float'],
  ['unitDamageMultiplier', '单位伤害倍率', 'float'],
  ['unitCrashDamageMultiplier', '单位坠落伤害倍率', 'float'],
  ['unitMineSpeedMultiplier', '单位采矿速度倍率', 'float'],
  ['unitCostMultiplier', '单位造价倍率', 'float'],
  ['unitHealthMultiplier', '单位生命倍率', 'float'],
  ['blockHealthMultiplier', '建筑生命倍率', 'float'],
  ['blockDamageMultiplier', '建筑伤害倍率', 'float'],
  ['buildSpeedMultiplier', '建造速度倍率', 'float'],
  ['extraCoreBuildRadius', '核心额外建造范围', 'float'],
];

const FIELD_TYPE = new Map(TEAM_FIELDS.map(([k, , t]) => [k, t]));

/** 按字段类型把界面上的文本转成 Kotlin 字面量（导出供测试对照 jar 校验） */
export function teamValue(field, raw) {
  const t = FIELD_TYPE.get(field) || 'float';
  const s = String(raw == null ? '' : raw).trim();
  if (t === 'boolean') {
    const on = /^(true|1|是|开|on)$/i.test(s);
    return on ? 'true' : 'false';
  }
  const n = Number(s);
  const v = Number.isFinite(n) ? n : 0;
  if (t === 'int') return String(Math.round(v));
  return `${v}f`; // float 字段不带 f 后缀编译不过
}

export const SERVERS = [
  // ---------------- 脚本自禁用 ----------------
  {
    key: 'server.disableSelf',
    category: 'server',
    level: 'advanced',
    label: '停用这个插件自己',
    terms: 'disableScript 自禁用 关闭 停用 卸载 退出 条件不满足',
    codeHint: 'ScriptManager.disableScript(脚本, "原因")',
    note: '让这个插件把自己关掉，并往日志里写一句原因。适合「配置不对就别跑」这种情况',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'reason', type: 'text', label: '原因（会写进日志）', default: '配置无效，已停用' },
    ],
    emit(n, ctx) {
      ctx.need('cf.wayzer.scriptAgent.thisContextScript');
      const reason = ctx.lit(String(n.props.reason || '已停用'));
      // 用 let 把脚本实例先抓出来：进了 launch 之后 this 就是 CoroutineScope 了
      return {
        lines: [
          `thisContextScript().let { s -> launch(Dispatchers.game) { ` +
          `ScriptManager.disableScript(s, ${reason}) } }`,
        ],
      };
    },
  },

  // ---------------- 换一张地图 ----------------
  {
    key: 'server.loadMap',
    category: 'server',
    level: 'advanced',
    label: '换一张地图',
    terms: 'loadMap MapManager 换图 轮换 下一张 地图 maps',
    codeHint: 'MapManager.loadMap()',
    note: '换下一张地图，或换到指定编号的地图。需要 maps 模块',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      {
        key: 'mode', type: 'select', label: '换成哪张', required: true, default: 'next',
        options: [['next', '下一张（轮换）'], ['id', '指定编号']],
      },
      {
        key: 'mapId', type: 'number', label: '地图编号', default: 1, min: 0,
        showIf: { mode: 'id' }, hint: '服务器里每张地图的编号，编号错了会静默不换',
      },
    ],
    emit(n, ctx) {
      ctx.need('wayzer.MapManager');
      if ((n.props.mode || 'next') === 'next') {
        // loadMap 本身不挂起，直接调
        return { lines: ['MapManager.loadMap()'], extraDeps: ['wayzer/maps'] };
      }
      ctx.need('wayzer.MapRegistry');
      const id = Math.round(Number(n.props.mapId));
      return {
        lines: [
          'launch(Dispatchers.game) {',
          `    MapRegistry.findById(${Number.isFinite(id) ? id : 1})?.let { MapManager.loadMap(it) }`,
          '}',
        ],
        extraDeps: ['wayzer/maps'],
      };
    },
  },

  // ---------------- 设置队伍属性 ----------------
  {
    key: 'server.teamRule',
    category: 'server',
    level: 'advanced',
    label: '设置某个队伍的属性',
    terms: 'teams rules TeamRule cheat 队伍 属性 倍率 无限资源 作弊 AI',
    codeHint: 'state.rules.teams.get(Team.get(1)).cheat = true',
    note: '改一个队伍的整体属性：作弊模式、无限资源、各种倍率。上面 23 项都能调',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'team', type: 'number', label: '队伍编号', required: true, default: 1, min: 0,
        hint: 'Team.get(编号)，例如 1 是第一个队伍' },
      {
        key: 'field', type: 'select', label: '改哪一项', required: true, default: 'cheat',
        options: TEAM_FIELDS.map(([k, label]) => [k, label]),
      },
      { key: 'value', type: 'text', label: '设成什么', default: 'true',
        hint: '开关类填 true / false，数字类直接填数字' },
    ],
    emit(n, ctx) {
      const field = String(n.props.field || 'cheat');
      const t = Math.round(Number(n.props.team));
      const team = Number.isFinite(t) ? t : 1;
      const lines = [
        `state.rules.teams.get(Team.get(${team})).${field} = ${teamValue(field, n.props.value)}`,
      ];
      return { lines };
    },
  },

  // ---------------- 注册一个显示变量 ----------------
  {
    key: 'server.registerVar',
    category: 'server',
    level: 'advanced',
    label: '注册一个显示变量',
    terms: 'registerVar DynamicVar 变量 占位符 placehold 计分板 显示 排行榜',
    codeHint: 'registerVar("名字", "说明", DynamicVar { 值 })',
    note: '注册一个 {名字} 占位符，之后在任何消息里都能用。计分板和广播都认它',
    isRoot: true,
    inPorts: [],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'name', type: 'text', label: '变量名字', required: true, default: 'my.plugin.value',
        noSpace: true, hint: '消息里写 {这个名字} 就能取到值' },
      { key: 'desc', type: 'text', label: '说明', default: '自定义变量' },
      {
        key: 'preset', type: 'select', label: '显示什么', required: true, default: 'players',
        options: [
          ['players', '当前玩家数量'],
          ['wave', '当前波数'],
          ['enemies', '当前剩余敌人数'],
          ['mapName', '当前地图名'],
          ['tps', '服务器 TPS'],
          ['heap', '内存占用(MB)'],
          ['custom', '自己写表达式'],
        ],
      },
      {
        key: 'expr', type: 'text', label: '表达式', default: 'Groups.player.size()',
        showIf: { preset: 'custom' },
        hint: '能被 Kotlin 直接算出来的表达式',
      },
    ],
    emit(n, ctx) {
      const name = String(n.props.name || '').trim();
      if (!name) return { error: '「注册一个显示变量」还没填变量名字' };
      const desc = ctx.lit(String(n.props.desc || ''));
      const preset = n.props.preset || 'players';
      // 这些表达式都抄自 coreMindustry/variables.kts 的真实写法
      const PRESET = {
        players: 'Groups.player.size()',
        wave: 'state.wave',
        enemies: 'state.enemies',
        mapName: 'state.map.name()',
        tps: 'Core.graphics.framesPerSecond.coerceAtMost(255)',
        heap: 'Core.app.javaHeap / 1024 / 1024',
      };
      const expr = preset === 'custom'
        ? String(n.props.expr || '').trim()
        : PRESET[preset];
      if (!expr) return { error: '「注册一个显示变量」的表达式是空的' };
      ctx.need('cf.wayzer.placehold.DynamicVar');
      return {
        lines: [`registerVar(${ctx.lit(name)}, ${desc}, DynamicVar { ${expr} })`],
      };
    },
  },
];
