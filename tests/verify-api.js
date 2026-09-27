// 用真实 jar 的 javap 转储交叉验证：生成器用到的每一处 API 是否真的存在、
// 参数类型是否对得上。
//
// 为什么需要这个：写错签名（比如把 Tile.x 当成 Int，实际是 Short；或者以为
// Team 上有 players 字段，实际没有）不会在本工具里报错，却会让生成的插件
// 在游戏里编译失败。这类错误只有对着真实 jar 才能查出来。
//
// 转储由 tests/dump-api.ps1 生成（需要一个 Mindustry 服务端 jar + JDK）。
// 转储不在版本库里，所以缺了就直接跳过，不影响常规构建。
//
// 用法： node tests/verify-api.js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const API = join(__dir, '_api');

if (!existsSync(API)) {
  console.log('=== API 交叉验证 ===');
  console.log('  ⏭  没有 tests/_api 转储，跳过。');
  console.log('     先跑 tests/dump-api.ps1（需要一个 Mindustry 服务端 jar + JDK）。');
  process.exit(0);
}

// 把 javap 转储读成一个「类名 -> 成员签名文本」的大索引
const index = new Map();
for (const f of readdirSync(API)) {
  if (!f.endsWith('.txt')) continue;
  const cls = f.replace(/\.txt$/, '');
  index.set(cls, readFileSync(join(API, f), 'utf8'));
}
const all = [...index.values()].join('\n');

if (!index.size) {
  console.log('=== API 交叉验证 ===');
  console.log('  ⏭  转储目录是空的，跳过。');
  process.exit(0);
}

// 待验证的调用： [说明, 正则, 必须出现在哪个类（null = 任意）]
const CHECKS = [
  ['unit.kill()', /\bkill\(\)/, 'mindustry.gen.Healthc'],
  ['unit.set(x,y)', /void set\(float, float\)/, 'mindustry.gen.Posc'],
  ['unit.snapInterpolation()', /snapInterpolation\(\)/, 'mindustry.gen.Syncc'],
  ['unit.tileX()/tileY()', /int tileX\(\)/, 'mindustry.gen.Posc'],
  ['unit.isGrounded/isFlying', /boolean isGrounded\(\)/, 'mindustry.gen.Unitc'],
  ['unit.health (float)', /public float health;/, 'mindustry.gen.Unit'],
  ['unit.maxHealth (float)', /public transient float maxHealth;/, 'mindustry.gen.Unit'],
  ['unit.flag (double)', /public double flag;/, 'mindustry.gen.Unit'],
  ['unit.team (field)', /public mindustry.game.Team team;/, 'mindustry.gen.Unit'],
  ['unit.x / unit.y (float)', /public float x;/, 'mindustry.gen.Unit'],

  ['Tile.setNet(block,team,rotation)', /void setNet\(mindustry\.world\.Block, mindustry\.game\.Team, int\)/, 'mindustry.world.Tile'],
  ['Tile.setAir()', /void setAir\(\)/, 'mindustry.world.Tile'],
  ['Tile.worldx()/worldy()', /float worldx\(\)/, 'mindustry.world.Tile'],
  ['Tile.block()', /mindustry\.world\.Block block\(\)/, 'mindustry.world.Tile'],
  ['Tile.floor()', /mindustry\.world\.blocks\.environment\.Floor floor\(\)/, 'mindustry.world.Tile'],
  ['Tile.team()', /mindustry\.game\.Team team\(\)/, 'mindustry.world.Tile'],
  ['Tile.build (field)', /public mindustry\.gen\.Building build;/, 'mindustry.world.Tile'],
  // Tile.x / Tile.y 是 short，不是 int！Kotlin 不自动加宽，必须 .toInt()
  ['Tile.x / Tile.y (short)', /public short x;/, 'mindustry.world.Tile'],

  ['Building.health', /public float health;/, 'mindustry.gen.Building'],
  ['Building.maxHealth', /public transient float maxHealth;/, 'mindustry.gen.Building'],
  ['Building.team', /public mindustry\.game\.Team team;/, 'mindustry.gen.Building'],
  ['Building.block', /public transient mindustry\.world\.Block block;/, 'mindustry.gen.Building'],
  ['Building.tile', /public transient mindustry\.world\.Tile tile;/, 'mindustry.gen.Building'],
  ['Building.items', /mindustry\.world\.modules\.ItemModule items;/, 'mindustry.gen.Building'],

  ['ItemModule.add(Item,int)', /void add\(mindustry\.type\.Item, int\)/, 'mindustry.world.modules.ItemModule'],
  ['ItemModule.set(Item,int)', /void set\(mindustry\.type\.Item, int\)/, 'mindustry.world.modules.ItemModule'],
  ['ItemModule.clear()', /void clear\(\)/, 'mindustry.world.modules.ItemModule'],

  ['Units.count(x,y,r,pred)', /int count\(float, float, float, arc\.func\.Boolf/, 'mindustry.entities.Units'],
  ['Units.closestEnemy(...)', /closestEnemy\(mindustry\.game\.Team, float, float, float, arc\.func\.Boolf/, 'mindustry.entities.Units'],

  ['Call.setHudTextReliable(con,str)', /setHudTextReliable\(mindustry\.net\.NetConnection, java\.lang\.String\)/, 'mindustry.gen.Call'],
  ['Call.infoToast(con,str,float)', /infoToast\(mindustry\.net\.NetConnection, java\.lang\.String, float\)/, 'mindustry.gen.Call'],
  ['Call.warningToast(con,int,str)', /warningToast\(mindustry\.net\.NetConnection, int, java\.lang\.String\)/, 'mindustry.gen.Call'],
  ['Call.announce(con,str)', /announce\(mindustry\.net\.NetConnection, java\.lang\.String\)/, 'mindustry.gen.Call'],

  ['Geometry.circle(5参)', /circle\(int, int, int, int, int, arc\.func\.Intc2\)/, 'arc.math.geom.Geometry'],
  ['Mathf.chance(double)', /boolean chance\(double\)/, 'arc.math.Mathf'],
  ['Time.time (field)', /public static float time;/, 'arc.util.Time'],
  ['Time.millis()', /long millis\(\)/, 'arc.util.Time'],
  ['Iconc.warning', /char warning;/, 'mindustry.gen.Iconc'],

  ['Groups.player', /EntityGroup<mindustry\.gen\.Player> player;/, 'mindustry.gen.Groups'],
  ['Groups.build', /EntityGroup<mindustry\.gen\.Building> build;/, 'mindustry.gen.Groups'],
  ['Groups.unit', /EntityGroup<mindustry\.gen\.Unit> unit;/, 'mindustry.gen.Groups'],

  ['Player.admin', /public boolean admin;/, 'mindustry.gen.Player'],
  ['Player.con', /public transient mindustry\.net\.NetConnection con;/, 'mindustry.gen.Player'],
  ['Player.name', /public java\.lang\.String name;/, 'mindustry.gen.Player'],
  ['Player.uuid()', /java\.lang\.String uuid\(\)/, 'mindustry.gen.Player'],
  ['Player.unit()', /mindustry\.gen\.Unit unit\(\)/, 'mindustry.gen.Player'],
  ['Player.team()', /mindustry\.game\.Team team\(\)/, 'mindustry.gen.Player'],
  ['Player.dead()', /boolean dead\(\)/, 'mindustry.gen.Healthc'],

  ['Team.data()', /mindustry\.game\.Teams\$TeamData data\(\)/, 'mindustry.game.Team'],
  ['Team.core()', /CoreBuild core\(\)/, 'mindustry.game.Team'],
  ['TeamData.players', /Seq<mindustry\.gen\.Player> players;/, 'mindustry.game.Teams$TeamData'],
];

// 反面检查：这些写法曾经写错过，确认它们确实不存在，避免又写回去
const NEGATIVE = [
  // Team 上没有 players，玩家列表在 Team.data().players 上
  ['Team 上不该有 players 字段', /Seq<mindustry\.gen\.Player>|List<mindustry\.gen\.Player>/, 'mindustry.game.Team'],
  // hasPermission 不在 Player 上 —— 它是 coreMindustry 的 suspend 扩展函数，
  // 所以事件体里根本不能调（改用非挂起的 PermissionApi.check）
  ['Player 上不该有 hasPermission', /hasPermission/, 'mindustry.gen.Player'],
];

// 正面检查：控件目录里真正会输出的表达式，必须都能在 jar 的签名里找到依据。
// 这一组比上面的「单个成员」更接近最终产物，用来防止类型链写错
// （比如把 Team 当成有 players，或者漏掉 .toInt()）。
const EXPR_CHECKS = [
  ['Team.data().players.size 链',
    (t) => /Teams\$TeamData data\(\)/.test(t.team) && /Seq<mindustry\.gen\.Player> players;/.test(t.teamData)],
  // 注意这里用 indexOf 而不是正则：签名里有 $ 和 <>，
  // 写成正则很容易被转义规则坑到（之前就误判过一次）
  ['Team.cores() 返回 Seq<CoreBuild>',
    (t) => t.team.includes('Seq<mindustry.world.blocks.storage.CoreBlock$CoreBuild> cores()')],
  ['Tile.x 是 short（用前必须 toInt）', (t) => /public short x;/.test(t.tile)],
  ['Player.admin 可直接读（PermissionExt 也这么用）', (t) => /public boolean admin;/.test(t.player)],
  ['Player.uuid() 非挂起', (t) => /java\.lang\.String uuid\(\)/.test(t.player)],
];

console.log('=== API 交叉验证（对照真实 Mindustry jar） ===');
let bad = 0;
for (const [label, re, cls] of CHECKS) {
  const text = cls ? (index.get(cls) || '') : all;
  if (!text) { console.log(`  ❓ ${label}  —— 缺少 ${cls} 的转储`); bad++; continue; }
  if (re.test(text)) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label}  —— 在 ${cls} 里没找到`); bad++; }
}

let nbad = 0;
for (const [label, re, cls] of NEGATIVE) {
  const text = index.get(cls) || '';
  if (re.test(text)) { console.log(`  ⚠ ${label} —— 竟然存在，需要复查`); nbad++; }
  else console.log(`  ✅ ${label}`);
}

const t = {
  team: index.get('mindustry.game.Team') || '',
  teamData: index.get('mindustry.game.Teams$TeamData') || '',
  tile: index.get('mindustry.world.Tile') || '',
  player: index.get('mindustry.gen.Player') || '',
};
for (const [label, fn] of EXPR_CHECKS) {
  if (fn(t)) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label}`); bad++; }
}

const total = CHECKS.length + NEGATIVE.length + EXPR_CHECKS.length;
console.log(`\nAPI 交叉验证：${total - bad - nbad}/${total} 通过`);
process.exit(bad || nbad ? 1 : 0);
