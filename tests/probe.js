// 人工核对生成代码的小工具。
//
// 自动化测试只能证明「不报错、括号配平、API 存在」，证明不了「这段 Kotlin
// 读起来是对的」。改完控件实现后，用这个把真实产物打出来看一眼，比盯着
// 生成器源码想象要可靠得多。
//
// 用法：
//   node tests/probe.js                 # 跑 tests/probe-cases.json 里的用例
//   node tests/probe.js my-cases.json   # 跑自己的用例
//
// 用例格式（JSON 数组），chain 是从事件往下的上游链：
//   [{
//     "title": "说明",
//     "def":   "要测的控件 key",
//     "chain": [{ "def": "event.PlayerJoin", "props": {} }],
//     "props": { ... 这个控件的参数 ... }
//   }]
//
// 每个用例会额外给 then / else / skip / out 四个出口各挂一个「发消息」子节点，
// 这样带分支的控件（条件 / 循环）也能把展开路径走到。
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const u = (p) => pathToFileURL(p).href;

const M = await import(u(join(ROOT, 'src/frontend/js/model.js')));
const G = await import(u(join(ROOT, 'src/frontend/js/generate.js')));

/** 按用例描述拼一张单画布工程 */
function build(title, defKey, props, chain) {
  const p = M.newProject(title);
  p.modules[0].id = 'probe';
  p.modules[0].canvases = [];
  const c = M.newCanvas(title, 'main');
  const nodes = [], edges = [];
  let prev = null, y = 0;

  for (const step of chain) {
    const n = M.newNode(step.def, 0, y, { ...step.props });
    nodes.push(n);
    if (prev) {
      edges.push({ id: M.newId('e'), from: { node: prev, port: 'out' }, to: { node: n.id, port: 'in' }, kind: 'flow' });
    }
    prev = n.id;
    y += 300;
  }

  const target = M.newNode(defKey, 400, y, { ...props });
  nodes.push(target);
  if (prev) {
    edges.push({ id: M.newId('e'), from: { node: prev, port: 'out' }, to: { node: target.id, port: 'in' }, kind: 'flow' });
  }

  // 每个可能的出口都挂个子节点，把 expand 分支也走一遍
  for (const port of ['then', 'else', 'skip', 'out']) {
    const b = M.newNode('action.broadcast', 800, y + 300,
      { target: 'all', text: '子节点', msgType: 'MsgType.Message' });
    nodes.push(b);
    edges.push({ id: M.newId('e'), from: { node: target.id, port }, to: { node: b.id, port: 'in' }, kind: 'flow' });
  }

  c.nodes = nodes;
  c.edges = edges;
  p.modules[0].canvases.push(c);
  return p;
}

const casesFile = process.argv[2] || join(__dir, 'probe-cases.json');
if (!existsSync(casesFile)) {
  console.log(`找不到用例文件：${casesFile}`);
  console.log('用法： node tests/probe.js [用例.json]');
  process.exit(1);
}

const CASES = JSON.parse(readFileSync(casesFile, 'utf8'));
if (!CASES.length) {
  console.log('用例文件是空的');
  process.exit(0);
}

/** 只打印正文（跳过依赖声明和 package 行），看起来更清爽 */
function bodyOnly(text) {
  const lines = text.split('\n');
  const i = lines.findIndex(l => l.startsWith('package '));
  return (i >= 0 ? lines.slice(i + 1) : lines).join('\n').replace(/^\n+/, '');
}

let bad = 0;
for (const cs of CASES) {
  const p = build(cs.title || cs.def, cs.def, cs.props, cs.chain || []);
  const g = G.generatePlugin(p);
  console.log('='.repeat(70));
  console.log('## ' + (cs.title || cs.def));
  if (g.errors.length) {
    for (const e of g.errors) { console.log('  !! ' + e.message); }
    bad++;
  }
  for (const f of g.files) {
    console.log('--- ' + f.path);
    console.log(bodyOnly(f.content));
  }
}

console.log('='.repeat(70));
console.log(bad ? `${bad} 个用例生成时报错` : `${CASES.length} 个用例都没有报错`);
process.exit(bad ? 1 : 0);
