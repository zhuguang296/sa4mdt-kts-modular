// 把一份**手写的** .kts 脚本（没有本工具锚点的那种）粗略翻译成控件画布。
//
// 为什么需要它（第 15 轮）：首次进入时要展示 exe 旁边 scripts\ 里的真实插件，
// 让玩家**直观看到每个插件是怎么搭起来的**。scripts 里绝大多数脚本是别人写的
// —— 没有锚点，parseKts 还原不了。于是这里做一次「保守的结构识别」：
// 认出事件监听、条件、循环、常见动作调用，按画布上控件的样子摆出来。
//
// 设计原则：
//   1. **宁可少认，不可乱认**。认不出来就少放一个控件，绝不硬塞错的，
//      否则用户学到的就是错的。
//   2. 识别结果只是「结构近似」：参数尽量填进去，但标注「自动解析」，
//      并且原文件路径记在画布标题里，方便对照。
//   3. 纯函数、无副作用，方便离线测试。

import { newCanvas, newId, toFileName } from './model.js';
import { defOf, allDefs } from './catalog/index.js';

/** 事件：listen<EventType.XXX> / listen(EventType.Trigger.update) */
const EVENT_MAP = {
  PlayerJoin: 'event.PlayerJoin',
  PlayerLeave: 'event.PlayerLeave',
  PlayerChatEvent: 'event.PlayerChatEvent',
  BlockBuildEndEvent: 'event.BlockBuildEndEvent',
  BlockDestroyEvent: 'event.BlockDestroyEvent',
  UnitDestroyEvent: 'event.UnitDestroyEvent',
  UnitCreateEvent: 'event.UnitCreateEvent',
  UnitSpawnEvent: 'event.UnitSpawnEvent',
  UnitUnloadEvent: 'event.UnitUnloadEvent',
  WorldLoadEvent: 'event.WorldLoadEvent',
  WorldLoadEndEvent: 'event.WorldLoadEndEvent',
  GameOverEvent: 'event.GameOverEvent',
  TapEvent: 'event.TapEvent',
  WaveEvent: 'event.WaveEvent',
  PlayerConnect: 'event.PlayerConnect',
  BlockBuildBeginEvent: 'event.BlockBuildBeginEvent',
  TileChangeEvent: 'event.TileChangeEvent',
  ResetEvent: 'event.ResetEvent',
  StateChangeEvent: 'event.StateChangeEvent',
  CoreChangeEvent: 'event.CoreChangeEvent',
  ConfigEvent: 'event.ConfigEvent',
  PlayEvent: 'event.PlayEvent',
  TextInputEvent: 'event.TextInputEvent',
};

/** 常见动作调用 → 控件 key（按出现顺序匹配，先具体后笼统） */
const ACTION_PATTERNS = [
  [/\.sendMessage\s*\(/, 'action.broadcast'],
  [/\bbroadcast\s*\(/, 'action.broadcast'],
  [/\bCall\.announce\s*\(/, 'action.announceBig'],
  [/\bCall\.setHudText/, 'action.hudText'],
  [/\bCall\.effect\s*\(/, 'action.effect'],
  [/\bplayer\.kick\s*\(/, 'server.disableSelf'],
  [/\bunit\.kill\s*\(\s*\)/, 'action.killUnit'],
  [/\bunit\.health\s*=/, 'action.setHealth'],
  [/\bunit\.set\s*\(/, 'action.teleport'],
  [/\bunit\.apply\s*\(/, 'action.applyStatus'],
  [/\bUnitTypes\.\w+\.spawn\s*\(/, 'action.spawnUnit'],
  [/\bcommand\s*\(/, 'action.registerCommand'],
  [/Items\.\w+.*\.add\s*\(/, 'action.coreItems'],
  [/\btile\.setNet\s*\(/, 'action.setBlock'],
  [/\bdelay\s*\(/, 'util.waitSeconds'],
  [/\blogger\.(info|warn|err)/, 'util.log'],
  [/\bMathf\.chance\s*\(/, 'util.chance'],
  [/\bRandom\.nextInt\s*\(/, 'util.random'],
  [/\bPermissionApi\.registerDefault/, 'server.registerVar'],
  [/\bMapManager\.loadMap/, 'server.loadMap'],
];

/** 循环 / 条件 / 查询的结构识别 */
const LOOP_PATTERNS = [
  [/\brepeat\s*\(/, 'loop.repeatTimes'],
  [/\bwhile\s*\(/, 'loop.while'],
  [/Groups\.player\.forEach/, 'loop.forEachPlayer'],
  [/Groups\.build\.forEach/, 'loop.forEachBuild'],
  [/\bloop\s*\(\s*Dispatchers/, 'loop.while'],
];
const QUERY_PATTERNS = [
  [/Groups\.player\.filter/, 'query.players'],
  [/Groups\.build\.filter/, 'query.blocks'],
  [/Units\.count\s*\(/, 'query.countUnits'],
  [/Units\.closestEnemy\s*\(/, 'query.closestEnemy'],
];

/** 取一行里出现的字符串字面量（拿来当广播文本之类的参数） */
function firstStringLiteral(line) {
  const m = line.match(/"((?:[^"\\]|\\.)*)"/);
  return m ? m[1].replace(/\\"/g, '"') : '';
}

/**
 * 粗略解析一份 .kts 源码，产出画布。
 * @param {string} text 源码
 * @param {string} [fileName] 原文件名（写进画布标题，便于对照）
 * @returns {{canvas:object, recognized:number, note:string}}
 */
export function ktsSourceToCanvas(text, fileName = '') {
  const lines = String(text || '').split('\n');
  const title = fileName ? `${fileName}（自动解析）` : '自动解析的画布';
  const canvas = newCanvas(title, toFileName(fileName ? fileName.replace(/\.kts$/i, '') : 'sample', 'sample'));

  /** 记录每个事件行对应的节点与「当前父节点」，缩进决定层级 */
  const placed = [];   // {node, indent}
  let recognized = 0;
  let roots = 0;

  const push = (defKey, indent, props) => {
    if (!defOf(defKey)) return null;
    // 层级：比它浅的最近一个节点就是它的父
    let parent = null;
    for (let i = placed.length - 1; i >= 0; i--) {
      if (placed[i].indent < indent) { parent = placed[i].node; break; }
    }
    const y = parent ? parent.y + 120 : 80 + roots * 150;
    const x = parent ? parent.x + 340 : 80;
    const node = { id: newId('n'), def: defKey, x, y, props: props || {} };
    if (parent) {
      canvas.edges.push({
        id: newId('e'),
        from: { node: parent.id, port: defOf(parent.def).outPorts && defOf(parent.def).outPorts[0] ? defOf(parent.def).outPorts[0].id : 'out' },
        to: { node: node.id, port: 'in' },
        kind: 'flow',
      });
    } else {
      roots++;
    }
    canvas.nodes.push(node);
    placed.push({ node, indent });
    recognized++;
    return node;
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');
    const body = line.trim();
    // 跳过注释与空行
    if (!body || body.startsWith('//') || body.startsWith('*') || body.startsWith('/*')) continue;
    // 文件头（@file:xxx）与 package 不算逻辑
    if (body.startsWith('@file:') || body.startsWith('package ') || body.startsWith('import ')) continue;
    const indent = line.length - line.trimStart().length;

    // 1) 事件监听
    const ev = body.match(/listen<\s*EventType\.(\w+)\s*>/) || body.match(/listen\s*\(\s*EventType\.Trigger\.(\w+)\s*\)/);
    if (ev) {
      // 每帧更新（Trigger.update）在目录里叫 event.Trigger.update
      const key = ev[1] === 'update' ? 'event.Trigger.update' : EVENT_MAP[ev[1]];
      push(key || 'event.Trigger.update', indent, {});
      continue;
    }
    // 2) 循环
    let hit = null;
    for (const [re, key] of LOOP_PATTERNS) if (re.test(body)) { hit = key; break; }
    if (hit) { push(hit, indent, {}); continue; }
    // 3) 条件
    if (/^\s*if\s*\(/.test(body) || /\bif\s*\(/.test(body)) {
      // 简单条件：能把 message == "x" / player.admin 之类认出来就填
      const props = { joiner: 'and', rules: [] };
      const m = body.match(/\bif\s*\(\s*([^)]{1,80})\)/);
      if (m) {
        const cond = m[1].trim();
        const varName = /player\.admin/.test(cond) ? 'player' : 'message';
        const field = /\.admin\b/.test(cond) ? 'admin' : 'content';
        props.rules = [{
          var: varName, type: 'String', field,
          op: '==', valueSource: 'literal',
          value: (cond.match(/"([^"]*)"/) || [, ''])[1], arg: (cond.match(/"([^"]*)"/) || [, ''])[1],
        }];
      }
      push('condition.if', indent, props);
      continue;
    }
    // 4) 查询
    hit = null;
    for (const [re, key] of QUERY_PATTERNS) if (re.test(body)) { hit = key; break; }
    if (hit) { push(hit, indent, {}); continue; }
    // 5) 动作
    hit = null;
    for (const [re, key] of ACTION_PATTERNS) if (re.test(body)) { hit = key; break; }
    if (hit) {
      const props = {};
      const s = firstStringLiteral(body);
      if (s && (hit === 'action.broadcast' || hit === 'action.announceBig' || hit === 'action.hudText')) props.text = s;
      if (hit === 'action.broadcast') props.target = 'all';
      push(hit, indent, props);
      continue;
    }
  }

  // 一个都没认出来：至少给一个「每帧更新」的空壳，让用户能看着改
  if (!recognized) {
    const key = defOf('event.Trigger.update') ? 'event.Trigger.update' : 'event.PlayerJoin';
    push(key, 0, {});
  }

  const note = '这个画布是从脚本源码自动解析出来的结构，只保证「大致对应」，'
    + '细节（参数、分支）可能和原脚本不完全一样 —— 具体以原文件为准。';
  return { canvas, recognized, note };
}

/**
 * 从一批脚本里挑出适合当示例的若干份（10~12 个）。
 * 规则：去重同名、跳过过大/过小的、优先有事件监听的（结构更清楚）。
 * @param {Array<{name:string,path:string,size:number,text:string}>} files
 * @param {number} [want] 想要几个（默认 10）
 */
export function pickSamples(files, want = 10) {
  const out = [];
  const seen = new Set();
  const scored = files.map((f) => {
    const t = String(f.text || '');
    const listenCount = (t.match(/listen\s*[<(]/g) || []).length;
    return { f, listenCount, len: t.length };
  }).filter((x) => {
    const name = x.f.name.toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
    return x.len > 40 && x.len < 200000;   // 太短没内容、太大不像示例
  }).sort((a, b) => (b.listenCount - a.listenCount) || (a.len - b.len));

  for (const s of scored) {
    if (out.length >= want) break;
    out.push(s.f);
  }
  return out;
}

/**
 * 内置示例脚本（scripts 目录不存在或不够时用）。
 *
 * 第 15 轮用户要求「可以选取 10-12 个示例」。真实 scripts 里有多少算多少，
 * 不够就用这些补足。它们刻意写成**真实插件的样子**（和 scripts 里手写脚本
 * 同构），再交给上面的识别器翻成控件画布 —— 这样：
 *   1. 示例不会和识别器脱节（识别器退化了，这些示例也会跟着塌，测试能发现）；
 *   2. 用户看到的画布和「从自己脚本翻出来的」是同一种东西，不是特制的假数据。
 */
export const BUILTIN_SAMPLE_SOURCES = [
  {
    name: 'welcome.kts',
    text: [
      'package welcome',
      '',
      'listen<EventType.PlayerJoin> {',
      '  broadcast("[green]欢迎 ${player.name} 来到服务器")',
      '}',
    ].join('\n'),
  },
  {
    name: 'leaveMsg.kts',
    text: [
      'package leaveMsg',
      '',
      'listen<EventType.PlayerLeave> {',
      '  broadcast("[yellow]${player.name} 离开了服务器")',
      '}',
    ].join('\n'),
  },
  {
    name: 'chatCmd.kts',
    text: [
      'package chatCmd',
      '',
      'listen<EventType.PlayerChatEvent> {',
      '  if (message == "签到") {',
      '    broadcast("${player.name} 签到了")',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    name: 'adminGuard.kts',
    text: [
      'package adminGuard',
      '',
      'listen<EventType.PlayerChatEvent> {',
      '  if (player.admin) {',
      '    p.sendMessage("管理员你好")',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    name: 'coreAlert.kts',
    text: [
      'package coreAlert',
      '',
      'listen<EventType.BlockBuildEndEvent> {',
      '  if (tile.block() == Blocks.coreNucleus) {',
      '    Call.announce("有人放了核心！")',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    name: 'tickLog.kts',
    text: [
      'package tickLog',
      '',
      'listen(EventType.Trigger.update) {',
      '  logger.info("每帧跑一次")',
      '}',
    ].join('\n'),
  },
  {
    name: 'unitKill.kts',
    text: [
      'package unitKill',
      '',
      'listen<EventType.UnitDestroyEvent> {',
      '  Call.effect(Fx.coreExplosion, unit.x, unit.y, 0f)',
      '}',
    ].join('\n'),
  },
  {
    name: 'waveMsg.kts',
    text: [
      'package waveMsg',
      '',
      'listen<EventType.WaveEvent> {',
      '  Call.announce("第 ${wave} 波来了")',
      '}',
    ].join('\n'),
  },
  {
    name: 'playerLoop.kts',
    text: [
      'package playerLoop',
      '',
      'listen(EventType.Trigger.update) {',
      '  Groups.player.forEach { p ->',
      '    p.sendMessage("在线提示")',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    name: 'chanceDrop.kts',
    text: [
      'package chanceDrop',
      '',
      'listen<EventType.UnitDestroyEvent> {',
      '  if (Mathf.chance(0.3)) {',
      '    broadcast("掉落触发")',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    name: 'worldLoad.kts',
    text: [
      'package worldLoad',
      '',
      'listen<EventType.WorldLoadEvent> {',
      '  broadcast("[green]地图已加载，欢迎游玩")',
      '}',
    ].join('\n'),
  },
  {
    name: 'gameOver.kts',
    text: [
      'package gameOver',
      '',
      'listen<EventType.GameOverEvent> {',
      '  Call.announce("本局结束")',
      '}',
    ].join('\n'),
  },
];

/**
 * 兜底示例：把内置示例源码翻成控件画布（scripts 目录不存在或不够时用）。
 * @param {number} [want] 最多给几个
 * @returns {Array<{name:string, title:string, canvas:object}>}
 */
export function builtinSamples(want = 10) {
  const out = [];
  for (const s of BUILTIN_SAMPLE_SOURCES) {
    if (out.length >= want) break;
    try {
      const r = ktsSourceToCanvas(s.text, s.name);
      const title = s.name.replace(/\.kts$/i, '');
      r.canvas.title = title;
      out.push({ name: s.name, title, canvas: r.canvas });
    } catch (_) { /* 单个示例坏了不影响其它 */ }
  }
  return out;
}

/** 所有控件 key（识别器自检用） */
export function knownDefs() { return allDefs().map((d) => d.key); }
