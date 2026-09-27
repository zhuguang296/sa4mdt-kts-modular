// 类型系统与字段表
// 依据：工作区 ScriptAgent4MindustryExt-3.4.0-scripts 中实际出现过的字段访问
// 所有 field.expr 里的字符串都是真实可用的 Kotlin 表达式

/** 端口类型（强类型连线校验用） */
export const PORT_TYPES = {
  flow: { id: 'flow', label: '执行' },
  Unit: { id: 'Unit', label: '单位' },
  UnitList: { id: 'UnitList', label: '单位列表' },
  Player: { id: 'Player', label: '玩家' },
  PlayerList: { id: 'PlayerList', label: '玩家列表' },
  Team: { id: 'Team', label: '队伍' },
  Tile: { id: 'Tile', label: '方块' },
  Building: { id: 'Building', label: '建筑' },
  Number: { id: 'Number', label: '数字' },
  String: { id: 'String', label: '文本' },
  Boolean: { id: 'Boolean', label: '真/假' },
};

/** 允许的隐式转换：from 能否接到 to */
const ASSIGNABLE = {
  flow: ['flow'],
  Unit: ['Unit'],
  UnitList: ['UnitList'],
  Player: ['Player'],
  PlayerList: ['PlayerList'],
  Team: ['Team'],
  Tile: ['Tile'],
  Building: ['Building'],
  Number: ['Number', 'String'],
  String: ['String'],
  Boolean: ['Boolean'],
};

export function canConnect(fromType, toType) {
  const allowed = ASSIGNABLE[fromType];
  return !!allowed && allowed.includes(toType);
}

/** 类型中文名（报错文案用） */
export function typeLabel(t) {
  return (PORT_TYPES[t] && PORT_TYPES[t].label) || t;
}

/**
 * 字段表：对象类型 -> 可选字段。path 是显示名；expr 是生成时的访问表达式，
 * {v} 替换成对象变量名；type 是端口类型（决定能与什么比较）；bool: true 表示
 * 本身是布尔（不再需要比较运算符）；ops 是可用比较运算符（不填取默认）。
 */
export const FIELDS = {
  Player: [
    { key: 'name', label: '名字', expr: '{v}.name', type: 'String' },
    { key: 'uuid', label: 'UUID', expr: '{v}.uuid()', type: 'String' },
    { key: 'admin', label: '是管理员', expr: '{v}.admin', type: 'Boolean', bool: true },
    { key: 'dead', label: '已死亡', expr: '{v}.dead()', type: 'Boolean', bool: true },
    { key: 'team', label: '所在队伍', expr: '{v}.team()', type: 'Team' },
    { key: 'unit', label: '操控的单位', expr: '{v}.unit()', type: 'Unit' },
    { key: 'x', label: 'X 坐标', expr: '{v}.x', type: 'Number' },
    { key: 'y', label: 'Y 坐标', expr: '{v}.y', type: 'Number' },
    { key: 'tileX', label: '所在格 X', expr: '{v}.tileX()', type: 'Number' },
    { key: 'tileY', label: '所在格 Y', expr: '{v}.tileY()', type: 'Number' },
    { key: 'locale', label: '语言', expr: '{v}.locale', type: 'String' },
    // 不要用 player.hasPermission(...) —— 它是 suspend 函数
    // （coreMindustry/lib/PermissionExt.kt:6），而 listen { } 的 lambda 是
    // (T) -> Unit，里面不能调挂起函数，事件体里写它根本编译不过。
    // PermissionApi.check 是同一套权限系统的非挂起入口（PermissionApi.kt:77）。
    {
      key: 'hasPermission', label: '拥有权限', type: 'Boolean', bool: true, needsArg: 'permission',
      expr: 'PermissionApi.check(buildList { add({v}.uuid()); if ({v}.admin) add("@admin") }, {arg})',
    },
  ],
  PlayerList: [
    { key: 'size', label: '有几个玩家', expr: '{v}.size', type: 'Number' },
    { key: 'isEmpty', label: '一个都没有', expr: '{v}.isEmpty()', type: 'Boolean', bool: true },
  ],
  Unit: [
    { key: 'health', label: '血量', expr: '{v}.health', type: 'Number' },
    { key: 'maxHealth', label: '最大血量', expr: '{v}.maxHealth', type: 'Number' },
    { key: 'shield', label: '护盾', expr: '{v}.shield', type: 'Number' },
    { key: 'team', label: '所在队伍', expr: '{v}.team', type: 'Team' },
    { key: 'type', label: '单位类型', expr: '{v}.type', type: 'String' },
    { key: 'flying', label: '是飞行单位', expr: '{v}.type.flying', type: 'Boolean', bool: true },
    { key: 'isPlayer', label: '是玩家操控', expr: '{v}.isPlayer', type: 'Boolean', bool: true },
    { key: 'dead', label: '已死亡', expr: '{v}.dead', type: 'Boolean', bool: true },
    { key: 'spawnedByCore', label: '由核心生成', expr: '{v}.spawnedByCore', type: 'Boolean', bool: true },
    { key: 'tileX', label: '所在格 X', expr: '{v}.tileX()', type: 'Number' },
    { key: 'tileY', label: '所在格 Y', expr: '{v}.tileY()', type: 'Number' },
  ],
  Team: [
    { key: 'id', label: '队伍编号', expr: '{v}.id', type: 'Number' },
    { key: 'name', label: '队伍名', expr: '{v}.name', type: 'String' },
    { key: 'active', label: '还存在', expr: '{v}.active()', type: 'Boolean', bool: true },
    { key: 'cores', label: '核心数量', expr: '{v}.cores().size', type: 'Number' },
    // Team 本身没有 players（javap 核实过），玩家列表在它的 TeamData 上：
    // TeamData.players 是 Seq<Player>，所以要先 .data()
    { key: 'players', label: '玩家数量', expr: '{v}.data().players.size', type: 'Number' },
  ],
  Tile: [
    { key: 'block', label: '是什么方块', expr: '{v}.block()', type: 'String' },
    { key: 'floor', label: '是什么地板', expr: '{v}.floor()', type: 'String' },
    { key: 'team', label: '所属队伍', expr: '{v}.team()', type: 'Team' },
    { key: 'hasBuild', label: '上面有建筑', expr: '{v}.build != null', type: 'Boolean', bool: true },
    { key: 'x', label: '格 X', expr: '{v}.x.toInt()', type: 'Number' },
    { key: 'y', label: '格 Y', expr: '{v}.y.toInt()', type: 'Number' },
  ],
  Building: [
    { key: 'block', label: '是什么建筑', expr: '{v}.block', type: 'String' },
    { key: 'team', label: '所属队伍', expr: '{v}.team', type: 'Team' },
    { key: 'health', label: '血量', expr: '{v}.health', type: 'Number' },
    { key: 'maxHealth', label: '最大血量', expr: '{v}.maxHealth', type: 'Number' },
    { key: 'x', label: '格 X', expr: '{v}.tile.x.toInt()', type: 'Number' },
    { key: 'y', label: '格 Y', expr: '{v}.tile.y.toInt()', type: 'Number' },
    { key: 'isCore', label: '是核心', expr: '{v} is CoreBuild', type: 'Boolean', bool: true },
  ],
  String: [
    { key: 'length', label: '长度', expr: '{v}.length', type: 'Number' },
    { key: 'isEmpty', label: '是空字符串', expr: '{v}.isEmpty()', type: 'Boolean', bool: true },
    { key: 'contains', label: '包含文字', expr: '{v}.contains({arg})', type: 'Boolean', bool: true, needsArg: 'string' },
    { key: 'equalsIgnoreCase', label: '等于(忽略大小写)', expr: '{v}.equals({arg}, true)', type: 'Boolean', bool: true, needsArg: 'string' },
  ],
  Number: [
    { key: 'self', label: '数值本身', expr: '{v}', type: 'Number' },
  ],
  Boolean: [
    { key: 'self', label: '真假本身', expr: '{v}', type: 'Boolean', bool: true },
  ],
};

/** 比较运算符：字段类型 -> 可用运算符 */
export const OPERATORS = {
  Number: [
    { op: '==', label: '等于' },
    { op: '!=', label: '不等于' },
    { op: '>', label: '大于' },
    { op: '<', label: '小于' },
    { op: '>=', label: '大于等于' },
    { op: '<=', label: '小于等于' },
  ],
  String: [
    { op: '==', label: '等于' },
    { op: '!=', label: '不等于' },
  ],
  Unit: [{ op: '==', label: '是同一个' }, { op: '!=', label: '不是同一个' }],
  Player: [{ op: '==', label: '是同一个' }, { op: '!=', label: '不是同一个' }],
  Team: [{ op: '==', label: '是同一队' }, { op: '!=', label: '不是同一队' }],
  Tile: [{ op: '==', label: '是同一格' }, { op: '!=', label: '不是同一格' }],
  Building: [{ op: '==', label: '是同一个' }, { op: '!=', label: '不是同一个' }],
  UnitList: [],
  PlayerList: [],
  Boolean: [],
  flow: [],
};

/** 取某类型的字段列表 */
export function fieldsOf(type) {
  return FIELDS[type] || [];
}

/** 取字段定义 */
export function fieldDef(type, key) {
  return fieldsOf(type).find(f => f.key === key) || null;
}

/** 取字段可用的运算符（布尔字段无运算符） */
export function operatorsOf(field) {
  if (!field || field.bool) return [];
  return OPERATORS[field.type] || [];
}

/**
 * 渲染字段访问表达式。{v} 可能出现多次（比如「拥有权限」要先取 uuid 再看
 * admin），所以必须用 replaceAll —— 用 replace 只会换掉第一个，剩下的会原样
 * 留在生成的 Kotlin 里，导致「找不到符号 {v}」。
 */
export function renderField(field, varExpr, arg) {
  let e = String(field.expr).replaceAll('{v}', varExpr);
  if (field.needsArg) e = e.replaceAll('{arg}', arg != null ? arg : '""');
  return e;
}
