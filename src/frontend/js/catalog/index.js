// 控件目录聚合 + 搜索索引
import { EVENTS } from './events.js';
import { ACTIONS } from './actions.js';
import { ACTIONS2 } from './actions2.js';
import { CONDITIONS } from './conditions.js';
import { CONDITIONS2 } from './conditions2.js';
import { DATAS, LOOPS, TIMERS, QUERIES } from './others.js';
import { DATAS2, LOOPS2, QUERIES2, UTILS } from './others2.js';
import { INTERACTS } from './interact.js';
import { SERVERS } from './server.js';

export const ALL_DEFS = [
  ...EVENTS,
  ...ACTIONS, ...ACTIONS2,
  ...CONDITIONS, ...CONDITIONS2,
  ...DATAS, ...DATAS2,
  ...LOOPS, ...LOOPS2,
  ...TIMERS,
  ...QUERIES, ...QUERIES2,
  ...UTILS,
  ...INTERACTS,
  ...SERVERS,
];

const BY_KEY = new Map(ALL_DEFS.map(d => [d.key, d]));

export function defOf(key) {
  return BY_KEY.get(key) || null;
}

export function allDefs() {
  return ALL_DEFS;
}

/** 分组：用于左侧控件库 */
export const GROUPS = [
  { level: 'basic', title: '入门', cats: ['event', 'action', 'condition', 'loop', 'timer', 'query', 'data', 'util', 'interact', 'server'] },
  { level: 'advanced', title: '高级', cats: ['event', 'action', 'condition', 'data', 'loop', 'timer', 'query', 'util', 'interact', 'server'] },
];

export const CATEGORY_LABEL = {
  event: '当……发生时',
  action: '要做的事',
  condition: '如果……就',
  data: '记住一个值',
  loop: '重复执行',
  timer: '定时执行',
  query: '查找对象',
  util: '小工具',
  interact: '交互',
  server: '服务器',
};

/** 按分组返回控件（供 UI 渲染左侧列表） */
export function catalogFor(level) {
  const g = GROUPS.find(x => x.level === level);
  if (!g) return [];
  return g.cats
    .map(cat => ({ cat, label: CATEGORY_LABEL[cat], items: ALL_DEFS.filter(d => d.category === cat && d.level === level) }))
    .filter(s => s.items.length);
}

/**
 * 不分档：所有控件按分类直接混排（入门 + 高级在一个分类里）。
 * 第 14 轮：去掉「入门 / 高级」分段标题 —— 用户不要被等级挡在门外。
 * 控件的 level 字段仍保留（卡片上照常标注），只是不再分区展示。
 */
export function catalogFlat() {
  const seen = [];
  for (const g of GROUPS) for (const cat of g.cats) if (!seen.includes(cat)) seen.push(cat);
  return seen
    .map(cat => ({ cat, label: CATEGORY_LABEL[cat], items: ALL_DEFS.filter(d => d.category === cat) }))
    .filter(s => s.items.length);
}

/** 搜索：匹配中文名 / 关键词 / 代码提示 */
export function searchDefs(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return [];
  return ALL_DEFS.filter(d =>
    d.label.toLowerCase().includes(s) ||
    (d.terms || '').toLowerCase().includes(s) ||
    (d.codeHint || '').toLowerCase().includes(s) ||
    d.key.toLowerCase().includes(s)
  );
}

/** 该控件能否作为根节点 */
export function isRootDef(d) {
  return !!d && (d.isRoot || d.category === 'event' || d.canBeRoot);
}

/** 该控件是否自带代码块（子节点缩进进去） */
export function opensBlock(d, portId) {
  if (!d) return false;
  const p = (d.outPorts || []).find(x => x.id === portId);
  return !!(p && (p.opensBlock || p.childIndent > 0));
}
