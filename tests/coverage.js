// 全覆盖回归测试：为每一个控件都构造一个最小可用场景，验证：
//   1) 生成过程不抛异常
//   2) 每个控件在「参数填好」时都能生成代码（不报错）
//   3) 生成出来的 Kotlin 括号/引号配平
// 运行： node tests/coverage.js

import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const u = (p) => pathToFileURL(p).href;

const M = await import(u(join(ROOT, 'src/frontend/js/model.js')));
const G = await import(u(join(ROOT, 'src/frontend/js/generate.js')));
const CAT = await import(u(join(ROOT, 'src/frontend/js/catalog/index.js')));
const V = await import(u(join(ROOT, 'src/frontend/js/validate.js')));

// ---------------- 每个控件的「理想参数」 ----------------
// 说明：这里的值模拟「用户在界面上认真填好」的结果

const GOOD = {
  // 事件
  'event.Trigger.update': {},
  'event.PlayerJoin': {},
  'event.PlayerLeave': {},
  'event.PlayerChatEvent': {},
  'event.BlockBuildEndEvent': {},
  'event.BlockDestroyEvent': {},
  'event.UnitDestroyEvent': {},
  'event.UnitCreateEvent': {},
  'event.WorldLoadEvent': {},
  'event.GameOverEvent': {},
  'event.TapEvent': {},
  'event.WaveEvent': {},
  'event.onEnable': {},
  'event.onDisable': {},
  // 第二批事件
  'event.PlayerConnect': {},
  'event.BlockBuildBeginEvent': {},
  'event.TileChangeEvent': {},
  'event.UnitSpawnEvent': {},
  'event.UnitUnloadEvent': {},
  'event.WorldLoadEndEvent': {},
  'event.ResetEvent': {},
  'event.StateChangeEvent': {},
  'event.CoreChangeEvent': {},
  'event.ConfigEvent': {},
  'event.PlayEvent': {},
  'event.TextInputEvent': {},

  // 动作
  'action.broadcast': { target: 'all', text: '你好 {player.name}', msgType: 'MsgType.Message', quite: false },
  'action.applyStatus': { status: 'slow', seconds: 5, on: 'ctx' },
  'action.spawnUnit': { unitType: 'dagger', team: 'wave', pos: 'fixed', px: 10, py: 20 },
  'action.giveItem': { item: 'copper', amount: 100, to: 'team' },
  'action.setRule': { rule: 'fire', value: 'false' },
  'action.setRuleNum': { rule: 'unitCap', numValue: 50 },
  'action.effect': { kind: 'label', text: '看这里', seconds: 5, pos: 'fixed', px: 1, py: 2 },
  'action.playerControl': { op: 'kick', reason: '测试' },
  'action.delayed': { ms: 3000 },
  'action.registerCommand': { name: 'hello', desc: '打招呼', aliases: '你好', playerOnly: true, permission: '' },
  'action.config': { name: 'amount', valueType: 'Int', default: '1', desc: '说明' },
  'action.permission': { node: 'my.plugin.use', group: '@admin' },
  'action.savable': { name: 'counter', dataType: 'Int', init: '0' },
  'action.kvStore': { name: 'myStore' },
  // 第二批动作
  'action.teleport': { on: 'ctx', pos: 'fixed', px: 10, py: 20 },
  'action.killUnit': { on: 'ctx', scope: 'one' },
  'action.setHealth': { on: 'ctx', mode: 'set', value: 100 },
  'action.setFlag': { on: 'ctx', flag: 1 },
  'action.setBlock': { op: 'place', block: 'titaniumWall', team: 'ctx', rotation: 0 },
  'action.coreItems': { op: 'add', item: 'copper', amount: 100, to: 'team' },
  'action.hudText': { text: '当前波数 {player.name}', target: 'all' },
  'action.announceBig': { kind: 'toast', text: '注意', target: 'all' },
  'action.returnNow': {},

  // 条件
  'condition.if': {
    joiner: 'and',
    rules: [{ var: 'player', type: 'Player', field: 'name', op: '==', valueSource: 'literal', value: 'x' }],
  },
  'condition.isAdmin': { who: 'ctx' },
  'condition.guard': {
    joiner: 'and',
    rules: [{ var: 'player', type: 'Player', field: 'name', op: '==', valueSource: 'literal', value: 'x' }],
    elseMode: 'return',
  },

  // 数据 / 循环 / 定时 / 查询
  'data.value': { name: 'count', source: 'number', value: '1' },
  'loop.repeat': { times: 3 },
  'loop.forEach': { listVar: 'targets', itemName: 'unit' },
  'timer.every': { ms: 30000, firstDelay: true },
  'query.units': { name: 'targets', scope: 'enemy', healthy: true },
  // 第二批：数据 / 循环 / 查询 / 小工具
  'data.set': { name: 'count', op: 'add', value: 1 },
  'data.list': { name: 'names', itemType: 'String', item: 'a, b' },
  'data.listOp': { op: 'add', list: 'names', value: 'x' },
  'data.map': { name: 'scores' },
  'data.mapOp': { op: 'put', map: 'scores', key: '{player.uuid()}', value: 5 },
  'loop.while': {
    joiner: 'and',
    rules: [{ var: 'count', type: 'Number', field: 'self', op: '<', valueSource: 'literal', value: '10' }],
  },
  'loop.repeatTimes': { times: 3, itemName: 'i' },
  'loop.forEachPlayer': { itemName: 'p', filter: 'all' },
  'loop.forEachBuild': { itemName: 'b', filter: 'all' },
  'loop.forEachIndexed': { list: 'names', idxName: 'i', itemName: 'v' },
  'query.players': { name: 'players', scope: 'all', nameContains: '' },
  'query.blocks': { name: 'tiles', radius: 5, at: 'tile' },
  'query.countUnits': { name: 'unitCount', radius: 80, at: 'tile', what: 'enemy' },
  'query.closestEnemy': { name: 'target', range: 200, at: 'unit' },
  'util.random': { name: 'rand', min: 1, max: 100 },
  'util.chance': { percent: 30 },
  'util.currentTime': { name: 'gameTime', kind: 'seconds' },
  'util.log': { text: '调试 {player.name}' },
  'util.returnList': { name: 'joined', list: 'names', sep: ', ', field: '' },
  'util.waitSeconds': { seconds: 1 },

  // 交互（第三批）
  'interact.openMenu': {
    menuId: 1, title: '请选择', msg: '选一个', options: '选项一\n选项二', followup: false,
  },
  'interact.onMenuChoose': { menuId: 1 },
  'interact.closeMenu': { menuId: 1 },
  'interact.openURI': { url: 'https://example.com' },

  // 服务器（第三批）
  'server.disableSelf': { reason: '配置无效' },
  'server.loadMap': { mode: 'next' },
  'server.teamRule': { team: 1, field: 'cheat', value: 'true' },
  'server.registerVar': { name: 'my.plugin.value', desc: '自定义变量', preset: 'players' },
};

// 需要「上游有某类型变量」的控件：给它们配一个能提供该变量的前置链
const NEEDS = {
  'action.applyStatus': ['unit'],
  'action.giveItem': ['team'],
  'action.playerControl': ['player'],
  'action.effect': ['tile'],
  'action.spawnUnit': ['tile'],
  'loop.forEach': ['targets'],
  'condition.if': ['player'],
  // 第二批
  'action.teleport': ['unit'],
  'action.killUnit': ['unit'],
  'action.setHealth': ['unit'],
  'action.setFlag': ['unit'],
  'action.setBlock': ['tile'],
  'action.coreItems': ['team'],
  'action.hudText': [],
  'action.announceBig': [],
  'condition.isAdmin': ['player'],
  'condition.guard': ['player'],
  'loop.while': ['count'],
  'query.blocks': ['tile'],
  'query.countUnits': ['tile'],
  'query.closestEnemy': ['unit'],
  'util.log': ['player'],
  'util.returnList': ['names'],
  'data.set': ['count'],
  'data.listOp': ['names'],
  'data.mapOp': ['scores', 'player'],
  'loop.forEachIndexed': ['names'],
  'util.waitSeconds': ['suspend'],
  // 「到此为止」必须待在某个 lambda 里才有东西可跳出
  'action.returnNow': ['listen'],
  // 交互：菜单/链接都要有玩家
  'interact.openMenu': ['player'],
  'interact.closeMenu': ['player'],
  'interact.openURI': ['player'],
};

const PROVIDER = {
  unit: { def: 'event.UnitDestroyEvent' },
  team: { def: 'event.BlockBuildEndEvent' },
  player: { def: 'event.PlayerJoin' },
  tile: { def: 'event.TapEvent' },
  targets: {
    def: 'event.PlayerJoin',
    child: { def: 'query.units', props: { name: 'targets', scope: 'enemy', healthy: true } },
  },
  // 第二批需要的上游
  count: { def: 'event.PlayerJoin', child: { def: 'data.value', props: { name: 'count', source: 'number', value: '0' } } },
  names: { def: 'event.PlayerJoin', child: { def: 'data.list', props: { name: 'names', itemType: 'String', item: 'a' } } },
  scores: { def: 'event.PlayerJoin', child: { def: 'data.map', props: { name: 'scores' } } },
  players: { def: 'event.PlayerJoin', child: { def: 'query.players', props: { name: 'players', scope: 'all' } } },
  // 需要一个挂起上下文才能用 delay
  suspend: { def: 'event.PlayerJoin', child: { def: 'timer.every', props: { ms: 30000, firstDelay: true } } },
  // 需要一个普通的事件体（listen），让「到此为止」有 lambda 可跳出
  listen: { def: 'event.PlayerJoin' },
};

// ---------------- 变体用例 ----------------
//
// 一个控件往往有好几种模式（比如「设置单位血量」有 设值/回满/百分比/加减）。
// 这些变体不是独立的 def，所以不能进上面的主循环，但同样必须能生成代码。
// 这里显式列出「变体名 -> { 真正的 def, 参数 }」。

const VARIANTS = {
  'action.killUnit/team': ['action.killUnit', { on: 'ctx', scope: 'team', team: 'crux' }],
  'action.setHealth/full': ['action.setHealth', { on: 'ctx', mode: 'full' }],
  'action.setHealth/ratio': ['action.setHealth', { on: 'ctx', mode: 'ratio', percent: 50 }],
  'action.setHealth/add': ['action.setHealth', { on: 'ctx', mode: 'add', delta: -30 }],
  'action.setBlock/rot': ['action.setBlock', { op: 'place', block: 'router', team: 'sharded', rotation: 2 }],
  'action.setBlock/remove': ['action.setBlock', { op: 'remove' }],
  'action.coreItems/set': ['action.coreItems', { op: 'set', item: 'silicon', amount: 50, to: 'fixed', team: 'sharded' }],
  'action.coreItems/clear': ['action.coreItems', { op: 'clear', to: 'team' }],
  'action.hudText/player': ['action.hudText', { text: '你好', target: 'player' }],
  'action.announceBig/warn': ['action.announceBig', { kind: 'warn', text: '警告', target: 'player' }],
  'action.announceBig/announce': ['action.announceBig', { kind: 'announce', text: '公告', target: 'team' }],
  'condition.isAdmin/fixed': ['condition.isAdmin', { who: 'fixed', name: 'Alice' }],
  'condition.guard/run': ['condition.guard', {
    joiner: 'or',
    rules: [{ var: 'player', type: 'Player', field: 'dead', op: '==', valueSource: 'literal', value: 'true' }],
    elseMode: 'run',
  }],
  'data.value/string': ['data.value', { name: 'title', source: 'string', value: 'hi' }],
  'data.value/boolean': ['data.value', { name: 'flag', source: 'boolean', value: 'true' }],
  'data.value/time': ['data.value', { name: 't', source: 'time' }],
  'data.value/field': ['data.value', { name: 'hp', source: 'field', var: 'unit', field: 'health' }],
  'data.set/sub': ['data.set', { name: 'count', op: 'sub', value: 2 }],
  'data.set/mul': ['data.set', { name: 'count', op: 'mul', value: 3 }],
  'data.set/set': ['data.set', { name: 'count', op: 'set', value: 9 }],
  'data.listOp/remove': ['data.listOp', { op: 'remove', list: 'names', value2: 'x' }],
  'data.listOp/clear': ['data.listOp', { op: 'clear', list: 'names' }],
  'data.listOp/contains': ['data.listOp', { op: 'contains', list: 'names', value3: 'x' }],
  'data.listOp/size': ['data.listOp', { op: 'size', list: 'names' }],
  'data.mapOp/get': ['data.mapOp', { op: 'get', map: 'scores', key: '{player.uuid()}' }],
  'data.mapOp/remove': ['data.mapOp', { op: 'remove', map: 'scores', key: '{player.uuid()}' }],
  'data.mapOp/has': ['data.mapOp', { op: 'has', map: 'scores', key: '{player.uuid()}' }],
  'loop.forEachPlayer/alive': ['loop.forEachPlayer', { itemName: 'p', filter: 'alive' }],
  'loop.forEachPlayer/admins': ['loop.forEachPlayer', { itemName: 'p', filter: 'admins' }],
  'loop.forEachPlayer/team': ['loop.forEachPlayer', { itemName: 'p', filter: 'team', team: 'crux' }],
  'loop.forEachBuild/cores': ['loop.forEachBuild', { itemName: 'b', filter: 'cores' }],
  'loop.forEachBuild/myTeam': ['loop.forEachBuild', { itemName: 'b', filter: 'myTeam' }],
  'query.players/alive': ['query.players', { name: 'players', scope: 'alive', nameContains: 'a' }],
  'query.players/admins': ['query.players', { name: 'players', scope: 'admins', nameContains: '' }],
  'query.players/team': ['query.players', { name: 'players', scope: 'team', team: 'sharded', nameContains: '' }],
  'query.countUnits/all': ['query.countUnits', { name: 'n', radius: 60, at: 'player', what: 'all' }],
  'query.countUnits/ground': ['query.countUnits', { name: 'n', radius: 60, at: 'tile', what: 'ground' }],
  'query.countUnits/flying': ['query.countUnits', { name: 'n', radius: 60, at: 'unit', what: 'flying' }],
  'util.currentTime/millis': ['util.currentTime', { name: 't', kind: 'millis' }],
  'util.currentTime/realClock': ['util.currentTime', { name: 't', kind: 'realClock' }],
  'util.returnList/field': ['util.returnList', { name: 'joined', list: 'players', sep: '/', field: 'name' }],
  // 指令冷却（body 前置检查 + 顶层记录表）
  'action.registerCommand/cooldown': ['action.registerCommand', {
    name: 'daily', desc: '签到', aliases: '', playerOnly: true, permission: '', cooldownSec: 30,
  }],
  'action.registerCommand/cooldownNoPlayer': ['action.registerCommand', {
    name: 'serverop', desc: '管理员用', aliases: '', playerOnly: false, permission: 'x.y', cooldownSec: 5,
  }],
  // 交互 / 服务器（第三批）
  'interact.openMenu/followup': ['interact.openMenu', {
    menuId: 7, title: '菜单', msg: '', options: 'A\nB\nC', followup: true,
  }],
  'interact.openMenu/single': ['interact.openMenu', {
    menuId: 0, title: '只有一个', msg: '说明', options: '确定', followup: false,
  }],
  'server.loadMap/byId': ['server.loadMap', { mode: 'id', mapId: 3 }],
  'server.teamRule/float': ['server.teamRule', { team: 2, field: 'unitHealthMultiplier', value: '2.5' }],
  'server.teamRule/int': ['server.teamRule', { team: 1, field: 'rtsMaxSquad', value: '10' }],
  'server.teamRule/false': ['server.teamRule', { team: 3, field: 'cheat', value: 'false' }],
  'server.registerVar/wave': ['server.registerVar', { name: 'p.wave', desc: '波数', preset: 'wave' }],
  'server.registerVar/tps': ['server.registerVar', { name: 'p.tps', desc: 'TPS', preset: 'tps' }],
  'server.registerVar/mapName': ['server.registerVar', { name: 'p.map', desc: '地图', preset: 'mapName' }],
  'server.registerVar/heap': ['server.registerVar', { name: 'p.heap', desc: '内存', preset: 'heap' }],
  'server.registerVar/enemies': ['server.registerVar', { name: 'p.enemies', desc: '敌人', preset: 'enemies' }],
  'server.registerVar/custom': ['server.registerVar', {
    name: 'p.mine', desc: '自定', preset: 'custom', expr: 'Groups.unit.size()',
  }],
};

/** 变体名 -> 它需要的上游变量 */
const VARIANT_NEEDS = {
  'action.killUnit/team': [],
  'action.setHealth/full': ['unit'],
  'action.setHealth/ratio': ['unit'],
  'action.setHealth/add': ['unit'],
  'action.setBlock/rot': ['tile'],
  'action.setBlock/remove': ['tile'],
  'action.coreItems/set': ['team'],
  'action.coreItems/clear': ['team'],
  'condition.isAdmin/fixed': [],
  'condition.guard/run': ['player'],
  'data.value/field': ['unit'],
  'data.set/sub': ['count'],
  'data.set/mul': ['count'],
  'data.set/set': ['count'],
  'data.listOp/remove': ['names'],
  'data.listOp/clear': ['names'],
  'data.listOp/contains': ['names'],
  'data.listOp/size': ['names'],
  'data.mapOp/get': ['scores', 'player'],
  'data.mapOp/remove': ['scores', 'player'],
  'data.mapOp/has': ['scores', 'player'],
  'action.hudText/player': ['player'],
  'action.announceBig/warn': ['player'],
  'action.announceBig/announce': ['team'],
  'query.countUnits/all': ['player'],
  'query.countUnits/flying': ['unit'],
  'util.returnList/field': ['players'],
  // 交互：菜单/链接都要有玩家
  'interact.openMenu/followup': ['player'],
  'interact.openMenu/single': ['player'],
  // 注册显示变量自带根起点，不需要上游
  'server.registerVar/wave': [],
  'server.registerVar/tps': [],
  'server.registerVar/mapName': [],
  'server.registerVar/heap': [],
  'server.registerVar/enemies': [],
  'server.registerVar/custom': [],
};

// ---------------- 构造并运行 ----------------

let pass = 0, fail = 0;
const failures = [];
const defs = CAT.allDefs();

/** 跑一个「控件 + 参数 + 上游需求」的场景，返回错误列表 */
function runCase(defKey, props, needs) {
  const p = M.newProject('覆盖测试');
  p.modules[0].id = 'cov';
  p.modules[0].canvases = [];
  const c = M.newCanvas(defKey, 'main');
  const nodes = [];
  const edges = [];
  // 上游链统一放在 y=0 一带，被测控件放到 y=2000，保证「上游先执行」的顺序
  let prev = null;
  let slot = 0;

  for (const need of needs) {
    const prov = PROVIDER[need];
    if (!prov) continue;
    const ev = M.newNode(prov.def, 0, slot * 300);
    nodes.push(ev);
    slot++;
    let tail = ev.id;
    if (prov.child) {
      const q = M.newNode(prov.child.def, 300, (slot - 1) * 300, { ...prov.child.props });
      nodes.push(q);
      edges.push({ id: M.newId('e'), from: { node: ev.id, port: 'out' }, to: { node: q.id, port: 'in' }, kind: 'flow' });
      tail = q.id;
    }
    if (prev) edges.push({ id: M.newId('e'), from: { node: prev, port: 'out' }, to: { node: ev.id, port: 'in' }, kind: 'flow' });
    prev = tail;
  }

  const n = M.newNode(defKey, 400, 2000, { ...props });
  nodes.push(n);
  if (prev) {
    // 前面有链就接上去；没有的话它自己必须能当根
    edges.push({ id: M.newId('e'), from: { node: prev, port: 'out' }, to: { node: n.id, port: 'in' }, kind: 'flow' });
  }

  // 这几个控件有分支/子块出口，各挂一个子节点，把 expand 路径也走到
  const childDefs = {
    'condition.if': ['then', 'else'],
    'condition.isAdmin': ['then', 'else'],
    'condition.guard': ['skip'],
    'condition.guard/run': ['skip', 'out'],
    'action.registerCommand': ['out'],
    'loop.forEachPlayer': ['out'],
    'loop.forEachBuild': ['out'],
    'loop.forEachIndexed': ['out'],
    'loop.while': ['out'],
    'loop.repeatTimes': ['out'],
    'util.chance': ['out'],
  };
  const ports = childDefs[defKey];
  if (ports) {
    for (const port of ports) {
      const b = M.newNode('action.broadcast', 800, slot * 300, { target: 'all', text: 'x', msgType: 'MsgType.Message' });
      nodes.push(b);
      edges.push({ id: M.newId('e'), from: { node: n.id, port }, to: { node: b.id, port: 'in' }, kind: 'flow' });
      slot++;
    }
  }
  // 「不满足就跳过」在 return 模式下没有块，但 out 口要继续往下走
  if (defKey === 'condition.guard') {
    const b = M.newNode('action.broadcast', 800, slot * 300, { target: 'all', text: 'x', msgType: 'MsgType.Message' });
    nodes.push(b);
    edges.push({ id: M.newId('e'), from: { node: n.id, port: 'out' }, to: { node: b.id, port: 'in' }, kind: 'flow' });
  }

  c.nodes = nodes;
  c.edges = edges;
  p.modules[0].canvases.push(c);

  const errs = [];
  try {
    const g = G.generatePlugin(p);
    for (const e of g.errors) errs.push(e.message);
  } catch (e) {
    errs.push('抛出异常：' + e.message);
  }
  return errs;
}

for (const d of defs) {
  const props = GOOD[d.key];
  if (props === undefined) {
    failures.push([d.key, '测试用例缺失：test/coverage.js 里没有为它准备参数']);
    fail++;
    continue;
  }
  const errs = runCase(d.key, props, NEEDS[d.key] || []);
  if (errs.length) {
    fail++;
    failures.push([d.key, errs.join(' | ')]);
  } else {
    pass++;
  }
}

// 变体也要全部跑通
let vPass = 0, vFail = 0;
for (const [vname, [defKey, props]] of Object.entries(VARIANTS)) {
  const errs = runCase(defKey, props, VARIANT_NEEDS[vname] || NEEDS[defKey] || []);
  if (errs.length) {
    vFail++;
    failures.push([vname, errs.join(' | ')]);
  } else {
    vPass++;
  }
}

console.log(`控件覆盖：${defs.length} 个`);
console.log(`  ✅ 能正常生成：${pass}`);
// 没问题时别用 ❌（看着像失败，实际是 0 个问题）
console.log(`  ${fail ? '❌' : '✅'} 有问题：${fail}`);
console.log(`\n变体覆盖（一个控件的多种模式）：${Object.keys(VARIANTS).length} 个`);
console.log(`  ✅ 能正常生成：${vPass}`);
console.log(`  ${vFail ? '❌' : '✅'} 有问题：${vFail}`);
if (vFail) fail += vFail;
if (failures.length) {
  console.log('');
  for (const [k, m] of failures) console.log(`  ❌ ${k}\n       ${m}`);
}

// ---------------- 配平自检：把所有控件拼进一个大画布 ----------------
{
  const p = M.newProject('大画布');
  p.modules[0].id = 'big';
  p.modules[0].canvases = [];
  const c = M.newCanvas('全部', 'all');
  let y = 0;
  const nodes = [], edges = [];
  for (const d of defs) {
    if (d.category !== 'event' && !d.isRoot) continue;
    const ev = M.newNode(d.key, 0, y, { ...(GOOD[d.key] || {}) });
    nodes.push(ev);
    let x = 300, prev = ev.id;
    for (const d2 of defs) {
      const pr = GOOD[d2.key];
      if (pr === undefined) continue;
      if (d2.category === 'event') continue;
      if (NEEDS[d2.key]) continue;          // 需要特定上游的就不塞了
      if (d2.key === 'condition.if') continue;
      if (d2.isRoot) continue;
      const nn = M.newNode(d2.key, x, y, { ...pr });
      nodes.push(nn);
      edges.push({ id: M.newId('e'), from: { node: prev, port: 'out' }, to: { node: nn.id, port: 'in' }, kind: 'flow' });
      prev = nn.id;
      x += 300;
    }
    y += 300;
  }
  c.nodes = nodes; c.edges = edges;
  p.modules[0].canvases.push(c);
  const g = G.generatePlugin(p);
  console.log(`\n大画布配平自检：${g.errors.length} 个生成错误`);
  for (const e of g.errors) console.log(`  · [${e.canvasTitle}] ${e.message}`);
  const bal = V.selfCheck(g.files);
  if (bal.length) {
    console.log('  ❌ 配平问题：');
    for (const b of bal) console.log(`     ${b.file}:${b.line} ${b.message}`);
    fail++;
  } else {
    console.log('  ✅ 所有生成文件的括号/引号都配平');
  }
}

process.exit(fail ? 1 : 0);
