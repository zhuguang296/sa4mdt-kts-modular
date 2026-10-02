// 锚点：写进导出文件里的注释，用来把代码反解回画布。
//
// 格式（v2）：
//   //@2 28 28         <- 控件编码 2，画布坐标 x=80 y=80（base36）
//   //@1x 1c 1c 1      <- 末位是嵌套层级（0 层省略不写）
//
// v1.2.0（第 14 轮）起，锚点行尾可以带参数段，做到「完全恢复」：
//   //@2 28 28 | text=%E6%AC%A2%E8%BF%8E&msgType=MsgType.Message
//   -- 参数段以 ` | ` 起头，多个 key=value 用 `&` 分隔；
//   -- value 做 encodeURIComponent（可含空格 / 中文 / 特殊字符，解析时还原）；
//   -- 只写「非默认值」参数（和控件定义里的 default 不同才写），默认值不占空间。
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

// v2（紧凑）：`//@<编码> <x> <y> [层级] [| 参数段]`
//
// 编码有两种写法：
//   //@2 bo 28 1                表内控件 —— 1~3 位 base36 短码
//   //@?action.someNew 28 28    表外控件 —— `?` 后跟完整 key
//
// 短码限 1~3 位不只是为了短：不限的话，用户手写的 `//@TODO fix 42`
// （`fix` 和 `42` 恰好都是合法 base36）会被当成锚点。
// `?` 也不是装饰 —— 有了它，才能在保住这条防误判的同时，
// 让「新控件忘了加进 codes.js」仍然能正常往返。
//
// 参数段（可选）：` | k1=v1&k2=v2`。v 是 encodeURIComponent 过的，
// 所以不包含 `|` / `&` / 空白，正则匹配稳定；`//@kts 1.2.0` 之类的
// 识别标记仍然匹配不上（点号不在 base36 里）。
const RE2_NODE = /^\s*\/\/@(?:\?([A-Za-z_][A-Za-z0-9_.]*)|([0-9a-z]{1,3}))\s+(-?[0-9a-z]+)\s+(-?[0-9a-z]+)(?:\s+(\d+))?(?:\s+\|\s+([^|]*))?$/;

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
  // v1.2.0+：文件底部识别块的固定标记（//@kts 1.2.0）。只认带点号的版本串，
  // 避免和 //@TODO 之类的手写注释混淆。
  if (/^\s*\/\/@kts\s+\d+\.\d+\.\d+\s*$/m.test(text)) return true;
  // 表内短码，或 `?完整key`
  return /^\s*\/\/@(?:\?[A-Za-z_][A-Za-z0-9_.]*|[0-9a-z]{1,3})\s+-?[0-9a-z]+\s+-?[0-9a-z]+/m.test(text);
}

/** 解析锚点里的参数段（`k1=v1&k2=v2`）为 props 对象。解析失败返回 null。 */
function parseAnchorParams(paramStr) {
  if (!paramStr || !paramStr.trim()) return null;
  const out = {};
  for (const seg of paramStr.split('&')) {
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    const k = seg.slice(0, eq);
    let v;
    try { v = decodeURIComponent(seg.slice(eq + 1)); } catch (e) { v = seg.slice(eq + 1); }
    // 对象值（rules 等）编码时带 json: 前缀，这里还原回对象
    if (v.indexOf('json:') === 0) {
      try { v = JSON.parse(v.slice(5)); } catch (e) { /* 还原不了就当字符串留 */ }
    }
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 解析一个 .kts 文本，还原出画布模型（锚点信息 + 嵌套关系 + 参数）。
 * v1 / v2（含参数段）两种锚点都支持。
 * @returns {{ok:boolean, canvas?, error?, unknown?:string[], warning?:string}}
 */
export function parseKts(text) {
  const nodeLines = []; // { depth, def, x, y, params }

  for (const line of text.split('\n')) {
    // ---- 老格式 ----
    if (RE1_FILE.test(line)) continue; // 文件头只用来判断类型，内容不再需要
    const m1 = RE1_NODE.exec(line);
    if (m1) {
      const info = parseKv(m1[1]);
      if (!info.def) continue;
      const ind = (line.match(/^(\s*)/) || ['', ''])[1].replace(/\t/g, '    ').length;
      nodeLines.push({ depth: ind / 4, def: fullDef(info.def), x: Number(info.x) || 0, y: Number(info.y) || 0, params: null });
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
        params: parseAnchorParams(m2[6]),
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
    const node = { id: newId('n'), def: nl.def, x: nl.x, y: nl.y, props: nl.params || {} };
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
    // 第 14 轮起，锚点里写了非默认参数（v1.2.0 新导出的文件）。
    // 老文件（没有参数段）仍只有位置和嵌套，参数需要重新填。
    warning: '这是新格式文件：位置、嵌套和参数都已还原；老文件则只还原位置和嵌套，参数需要重新确认',
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
 * @param {{def:string, x:number, y:number, props?:object}} node
 * @param {number} [depth] 嵌套层级；0 层省略不写，省 2 个字节
 * @param {object} [def] 控件定义（有 props 定义时，用它判定「非默认值」）
 */
export function nodeAnchor(node, depth = 0, def = null) {
  const head = `//@${defCode(node.def)} ${encodeXY(node.x)} ${encodeXY(node.y)}`;
  const pos = depth > 0 ? `${head} ${depth}` : head;
  const params = nonDefaultParams(node, def);
  return params ? `${pos} | ${params}` : pos;
}

/**
 * 收集「非默认值」参数，编码成锚点参数段（`k1=v1&k2=v2`，v 做 URI 编码）。
 * 没设过的键不写（等于没动过）；设了但和 default 相同的也不写（省空间）。
 * 对象值（rules 等）带 `json:` 前缀，保证解析时能完整还原成对象。
 */
function nonDefaultParams(node, def) {
  const props = node.props || {};
  const keys = Object.keys(props);
  if (!keys.length) return null;
  const out = [];
  for (const k of keys) {
    const v = props[k];
    if (v === undefined || v === null) continue;
    let s;
    if (typeof v === 'object') s = 'json:' + JSON.stringify(v);
    else s = String(v);
    if (def && def.props) {
      const p = def.props.find(x => x.key === k);
      if (p && p.default !== undefined && String(p.default) === s) continue; // 和默认一致，不写
    }
    out.push(`${k}=${encodeURIComponent(s)}`);
  }
  return out.length ? out.join('&') : null;
}
