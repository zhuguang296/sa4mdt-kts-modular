// 锚点：写进导出文件里的注释，用来把代码反解回画布。
//
// 格式（v2）：
//   //@2 28 28         <- 控件编码 2，画布坐标 x=80 y=80（base36）
//   //@1x 1c 1c 1      <- 末位是嵌套层级（0 层省略不写）
//
// 格式约束：
//   * 控件默认只写**编码**（`action.broadcast` -> `2`）。表在 catalog/codes.js。
//     表里没有的控件写成 `?完整key`。
//   * 坐标写 base36（80 -> `28`，420 -> `bo`）。画布坐标恒为整数
//     （拖动和网格吸附都会 Math.round），所以是无损的。
//   * 层级写数字，锚点一律顶格。
//   * **不写文件头**（没有 `//@c`），也**不写画布/模块 id** ——
//     画布 id 每次导入都会重发，模块 id 那一行 `package demo` 已经写明。
//
// 老格式（v1，`// @sa:file id=… / @sa:node id=… def=… x=… y=…`）仍然能解析 ——
// 用户手里已有的 .kts 必须还能还原。

import { newCanvas, newId } from './model.js';
import { defOf } from './catalog/index.js';
import { defCode, defFromCode } from './catalog/codes.js';

// v1（key=value，1.1.0 及更早导出的文件）
const RE1_FILE = /^\s*\/\/\s*@sa:file\s+(.*)$/;
const RE1_NODE = /^\s*\/\/\s*@sa:node\s+(.*)$/;

// v2（紧凑）：`//@<编码> <x> <y> [层级]`
//
// 编码有两种写法：
//   //@2 bo 28 1                表内控件 —— 1~3 位 base36 短码
//   //@?action.someNew 28 28    表外控件 —— `?` 后跟完整 key
//
// 短码限 1~3 位不只是为了短：不限的话，用户手写的 `//@TODO fix 42`
// （`fix` 和 `42` 恰好都是合法 base36）会被当成锚点。
// `?` 也不是装饰 —— 有了它，才能在保住这条防误判的同时，
// 让「新控件忘了加进 codes.js」仍然能正常往返。
const RE2_NODE = /^\s*\/\/@(?:\?([A-Za-z_][A-Za-z0-9_.]*)|([0-9a-z]{1,3}))\s+(-?[0-9a-z]+)\s+(-?[0-9a-z]+)(?:\s+(\d+))?\s*$/;

/** 坐标 -> base36（画布坐标恒为整数） */
export function encodeXY(n) {
  const v = Math.round(Number(n) || 0);
  return v.toString(36);
}

/** base36 -> 坐标 */
function decodeXY(s) {
  const v = parseInt(s, 36);
  return Number.isFinite(v) ? v : 0;
}

function parseKv(s) {
  const out = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)=(.*?)(?=\s+[A-Za-z_][A-Za-z0-9_]*=|$)/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2].trim();
  return out;
}

/** 锚点里的控件写法 -> 完整 key：先按编码查，再当成完整 key 试（v1 的写法） */
function fullDef(token) {
  if (!token) return token;
  return defFromCode(token) || token;
}

/** 判断一段文本是不是本工具导出的（导入前先看一眼，好给出人话提示） */
export function looksLikeOurKts(text) {
  if (/@sa:file\s/.test(text) || /@sa:node\s/.test(text)) return true;
  // 表内短码，或 `?完整key`
  return /^\s*\/\/@(?:\?[A-Za-z_][A-Za-z0-9_.]*|[0-9a-z]{1,3})\s+-?[0-9a-z]+\s+-?[0-9a-z]+/m.test(text);
}

/**
 * 解析一个 .kts 文本，还原出画布模型（锚点信息 + 嵌套关系）。
 * v1 / v2 两种锚点都支持。
 * @returns {{ok:boolean, canvas?, error?, unknown?:string[], warning?:string}}
 */
export function parseKts(text) {
  const nodeLines = []; // { depth, def, x, y }

  for (const line of text.split('\n')) {
    // ---- 老格式 ----
    if (RE1_FILE.test(line)) continue; // 文件头只用来判断类型，内容不再需要
    const m1 = RE1_NODE.exec(line);
    if (m1) {
      const info = parseKv(m1[1]);
      if (!info.def) continue;
      const ind = (line.match(/^(\s*)/) || ['', ''])[1].replace(/\t/g, '    ').length;
      nodeLines.push({ depth: ind / 4, def: fullDef(info.def), x: Number(info.x) || 0, y: Number(info.y) || 0 });
      continue;
    }

    // ---- 紧凑格式 ----
    const m2 = RE2_NODE.exec(line);
    if (m2) {
      // 第 1 组是 `?完整key`，第 2 组是短码；两者只会有一个匹配上
      const def = fullDef(m2[1] || m2[2]);
      if (!def) continue;
      nodeLines.push({
        depth: m2[5] === undefined ? 0 : Number(m2[5]),
        def,
        x: decodeXY(m2[3]),
        y: decodeXY(m2[4]),
      });
    }
  }

  if (!nodeLines.length) {
    return { ok: false, error: '这个文件里没有找到本工具留下的功能块标记，无法还原成画布' };
  }

  const canvas = newCanvas('导入的画布', null);

  const unknown = [];
  const nodes = []; // 与 nodeLines 一一对应；认不出的控件是 null
  for (const nl of nodeLines) {
    if (!defOf(nl.def)) {
      unknown.push(nl.def);
      nodes.push(null);
      continue;
    }
    const node = { id: newId('n'), def: nl.def, x: nl.x, y: nl.y, props: {} };
    canvas.nodes.push(node);
    nodes.push(node);
  }

  // 按「层级数字」恢复父子关系：往上找第一个层级更小的前驱节点当父节点。
  // 锚点按生成顺序（父在前、子在后）排列，所以一趟扫描就够。
  const stack = [];
  for (let i = 0; i < nodeLines.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    while (stack.length && nodeLines[stack[stack.length - 1]].depth >= nodeLines[i].depth) stack.pop();
    if (stack.length) {
      const parent = nodes[stack[stack.length - 1]];
      if (parent) {
        canvas.edges.push({
          id: newId('e'),
          from: { node: parent.id, port: guessPort(defOf(parent.def), parent, canvas) },
          to: { node: node.id, port: 'in' },
          kind: 'flow',
        });
      }
    }
    stack.push(i);
  }

  return {
    ok: true,
    canvas,
    unknown,
    warning: '只还原了功能块的位置和嵌套关系，具体填的参数需要你重新确认（导出的文件里没有保存表单内容）',
  };
}

/** 猜测父节点的哪个出端口连到这个孩子：条件控件按出现顺序依次分给 then / else */
function guessPort(pd, parent, canvas) {
  if (!pd) return 'out';
  const ports = (pd.outPorts || []).map(p => p.id);
  if (ports.length <= 1) return ports[0] || 'out';
  const n = canvas.edges.filter(e => e.from.node === parent.id).length;
  return ports[Math.min(n, ports.length - 1)];
}

/**
 * 节点锚点。
 * @param {{def:string, x:number, y:number}} node
 * @param {number} [depth] 嵌套层级；0 层省略不写，省 2 个字节
 */
export function nodeAnchor(node, depth = 0) {
  const head = `//@${defCode(node.def)} ${encodeXY(node.x)} ${encodeXY(node.y)}`;
  return depth > 0 ? `${head} ${depth}` : head;
}
