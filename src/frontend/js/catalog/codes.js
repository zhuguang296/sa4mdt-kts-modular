// 控件编码表：把 def 名压成 1~2 个字符，让导出的 .kts 注释更短。
//
// 例：action.broadcast -> "2"、event.PlayerJoin -> "1a"、util.waitSeconds -> "23"
//
// 编码 = 下标转 base36。所以**顺序就是编码**。
//
// 注意：这张表只允许「往后追加」：
//   * 加新控件：在数组**末尾**追加，用掉下一个没被用过的下标。
//   * 不要改顺序、不要在中间插、不要删条目 ——
//     用户已经导出的 .kts 里存的是编码，一动就会认成别的控件。
//   * 新控件忘了加进表也没关系：defCode() 会写成 `?完整key`，
//     读得回来，只是那个控件的注释长一点。
//   * tests/anchor.js 会核对这张表和控件目录是否一致。

/** 下标即编码（base36）：0 -> "0"，35 -> "z"，36 -> "10" */
export const DEF_CODES = [
  // action
  'action.announceBig',
  'action.applyStatus',
  'action.broadcast',
  'action.config',
  'action.coreItems',
  'action.delayed',
  'action.effect',
  'action.giveItem',
  'action.hudText',
  'action.killUnit',
  'action.kvStore',
  'action.permission',
  'action.playerControl',
  'action.registerCommand',
  'action.returnNow',
  'action.savable',
  'action.setBlock',
  'action.setFlag',
  'action.setHealth',
  'action.setRule',
  'action.spawnUnit',
  'action.teleport',
  // condition
  'condition.guard',
  'condition.if',
  'condition.isAdmin',
  // data
  'data.list',
  'data.listOp',
  'data.map',
  'data.mapOp',
  'data.set',
  'data.value',
  // event
  'event.BlockBuildBeginEvent',
  'event.BlockBuildEndEvent',
  'event.BlockDestroyEvent',
  'event.ConfigEvent',
  'event.CoreChangeEvent',
  'event.GameOverEvent',
  'event.PlayEvent',
  'event.PlayerChatEvent',
  'event.PlayerConnect',
  'event.PlayerJoin',
  'event.PlayerLeave',
  'event.ResetEvent',
  'event.StateChangeEvent',
  'event.TapEvent',
  'event.TextInputEvent',
  'event.TileChangeEvent',
  'event.Trigger.update',
  'event.UnitCreateEvent',
  'event.UnitDestroyEvent',
  'event.UnitSpawnEvent',
  'event.UnitUnloadEvent',
  'event.WaveEvent',
  'event.WorldLoadEndEvent',
  'event.WorldLoadEvent',
  'event.onDisable',
  'event.onEnable',
  // loop
  'loop.forEach',
  'loop.forEachBuild',
  'loop.forEachIndexed',
  'loop.forEachPlayer',
  'loop.repeat',
  'loop.repeatTimes',
  'loop.while',
  // query
  'query.blocks',
  'query.closestEnemy',
  'query.countUnits',
  'query.players',
  'query.units',
  // timer
  'timer.every',
  // util
  'util.chance',
  'util.currentTime',
  'util.log',
  'util.random',
  'util.returnList',
  'util.waitSeconds',
  // interact
  'interact.openMenu',
  'interact.onMenuChoose',
  'interact.closeMenu',
  'interact.openURI',
  // server
  'server.disableSelf',
  'server.loadMap',
  'server.teamRule',
  'server.registerVar',
];

const CODE_TO_KEY = new Map();
const KEY_TO_CODE = new Map();
DEF_CODES.forEach((key, i) => {
  const code = i.toString(36);
  CODE_TO_KEY.set(code, key);
  KEY_TO_CODE.set(key, code);
});

/**
 * 控件 -> 锚点里写的编码。
 *
 * 表里有就返回 1~3 位短码；表里没有（新控件忘了登记）返回 `?完整key`。
 * 那个 `?` 不是装饰：短码限定为 1~3 位 base36 是为了不把用户手写的
 * `//@TODO fix 42` 误认成锚点，而 `?` 让「表外控件」和「短码」在语法上
 * 泾渭分明 —— 既守住了防误判，又保证表外控件写出去还能读回来。
 */
export function defCode(key) {
  const code = KEY_TO_CODE.get(key);
  if (code) return code;
  const k = String(key || '');
  return k ? '?' + k : '';
}

/**
 * 锚点编码 -> 控件；认不出来返回 null。
 * 接受两种写法：表内短码，和 `?完整key`（后者把前缀去掉直接返回）。
 */
export function defFromCode(code) {
  const s = String(code == null ? '' : code);
  if (s.startsWith('?')) {
    const k = s.slice(1);
    return k || null;
  }
  return CODE_TO_KEY.get(s) || null;
}

/** 表里所有编号（测试用） */
export function allCodes() {
  return [...CODE_TO_KEY.keys()];
}
