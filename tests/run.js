// 离线回归测试：构建样例工程 -> 生成代码 -> 打印/比对
// 运行： node tests/run.js [--write]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const url = (p) => pathToFileURL(p).href;

const M = await import(url(join(ROOT, 'src/frontend/js/model.js')));
const G = await import(url(join(ROOT, 'src/frontend/js/generate.js')));
const CAT = await import(url(join(ROOT, 'src/frontend/js/catalog/index.js')));

const write = process.argv.includes('--write');

// ---------- 样例工程：4 个模板 ----------
function buildProject() {
  const p = M.newProject('演示插件');
  p.modules[0].id = 'demo';
  p.modules[0].canvases = [];

  // 1) 进服欢迎
  {
    const c = M.newCanvas('进服欢迎', 'welcome');
    const n1 = M.newNode('event.PlayerJoin', 80, 80);
    const n2 = M.newNode('action.broadcast', 420, 80, {
      target: 'player', text: '欢迎 {player.name} 来到本服务器', msgType: 'MsgType.Message',
    });
    const n3 = M.newNode('action.broadcast', 420, 240, {
      target: 'all', text: '[cyan][+] {player.name} 加入了服务器', msgType: 'MsgType.InfoMessage',
    });
    c.nodes = [n1, n2, n3];
    c.edges = [
      { id: 'e1', from: { node: n1.id, port: 'out' }, to: { node: n2.id, port: 'in' }, kind: 'flow' },
      { id: 'e2', from: { node: n1.id, port: 'out' }, to: { node: n3.id, port: 'in' }, kind: 'flow' },
    ];
    p.modules[0].canvases.push(c);
  }

  // 2) 定时公告
  {
    const c = M.newCanvas('定时公告', 'alert');
    const n1 = M.newNode('timer.every', 80, 80, { ms: 30000, firstDelay: true });
    const n2 = M.newNode('action.broadcast', 420, 120, {
      target: 'all', text: '[yellow]欢迎来到本服务器, 输入 /help 查看指令', msgType: 'MsgType.InfoMessage',
    });
    c.nodes = [n1, n2];
    c.edges = [{ id: 'e1', from: { node: n1.id, port: 'out' }, to: { node: n2.id, port: 'in' }, kind: 'flow' }];
    p.modules[0].canvases.push(c);
  }

  // 3) 自定义指令
  {
    const c = M.newCanvas('自定义指令', 'helloCmd');
    const n1 = M.newNode('action.registerCommand', 80, 80, {
      name: 'hello', desc: '打个招呼', aliases: '你好', playerOnly: true, permission: 'demo.hello',
    });
    const n2 = M.newNode('action.broadcast', 440, 140, {
      target: 'player', text: '[green]你好 {player.name}', msgType: 'MsgType.Message',
    });
    c.nodes = [n1, n2];
    c.edges = [{ id: 'e1', from: { node: n1.id, port: 'out' }, to: { node: n2.id, port: 'in' }, kind: 'flow' }];
    p.modules[0].canvases.push(c);
  }

  // 4) 聊天关键词触发
  {
    const c = M.newCanvas('聊天关键词触发', 'checkin');
    const n1 = M.newNode('event.PlayerChatEvent', 80, 80);
    const n2 = M.newNode('condition.if', 420, 80, {
      joiner: 'and',
      rules: [{
        var: 'message', type: 'String', field: 'contains', op: '==',
        valueSource: 'literal', value: '签到', arg: '签到',
      }],
    });
    const n3 = M.newNode('action.broadcast', 760, 80, {
      target: 'all', text: '[green]{player.name} 完成了签到', msgType: 'MsgType.Message',
    });
    const n4 = M.newNode('action.broadcast', 760, 300, {
      target: 'player', text: '[yellow]输入『签到』可以签到', msgType: 'MsgType.Message',
    });
    c.nodes = [n1, n2, n3, n4];
    c.edges = [
      { id: 'e1', from: { node: n1.id, port: 'out' }, to: { node: n2.id, port: 'in' }, kind: 'flow' },
      { id: 'e2', from: { node: n2.id, port: 'then' }, to: { node: n3.id, port: 'in' }, kind: 'flow' },
      { id: 'e3', from: { node: n2.id, port: 'else' }, to: { node: n4.id, port: 'in' }, kind: 'flow' },
    ];
    p.modules[0].canvases.push(c);
  }

  return p;
}

// ---------- 运行 ----------
const proj = buildProject();
const out = G.generatePlugin(proj);

// id 是随机的（每次运行都不同），比对前必须归一化，
// 否则这个测试永远不可能通过。
const norm = (s) => String(s)
  .replace(/\bid=[A-Za-z0-9]+/g, 'id=<ID>')
  .replace(/\bn[A-Za-z0-9]{6,}\b/g, '<NODE>')
  .replace(/\bc[A-Za-z0-9]{6,}\b/g, '<CANVAS>');

let fail = 0;
const results = [];

for (const f of out.files) {
  const expectPath = join(__dir, 'expected', f.path.replace(/\//g, '__'));
  if (write) {
    mkdirSync(dirname(expectPath), { recursive: true });
    // 写期望文件时也用归一化后的内容，这样它才是可重复比对的金标准
    writeFileSync(expectPath, norm(f.content), 'utf8');
    results.push(['WROTE', f.path, '']);
  } else if (existsSync(expectPath)) {
    const want = readFileSync(expectPath, 'utf8');
    const got = norm(f.content);
    if (want === got) results.push(['PASS', f.path, '']);
    else {
      results.push(['FAIL', f.path, '']);
      fail++;
      const a = want.split('\n'), b = got.split('\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          results.push(['  diff@' + (i + 1), 'want: ' + JSON.stringify(a[i]), 'got:  ' + JSON.stringify(b[i])]);
          break;
        }
      }
    }
  } else {
    results.push(['NEW', f.path, '(无期望文件)']);
  }
}

console.log('=== 生成的插件文件 ===');
for (const f of out.files) console.log('  ' + f.path + '  (' + f.content.length + ' 字符)');

if (out.errors.length) {
  console.log('\n=== 错误 ===');
  for (const e of out.errors) console.log(`  [${e.module}/${e.canvasTitle || e.canvas}] ${e.message}`);
}
if (out.warnings.length) {
  console.log('\n=== 警告 ===');
  for (const w of out.warnings) console.log(`  [${w.module}/${w.canvasTitle || w.canvas || ''}] ${w.message}`);
}
if (!out.errors.length) console.log('\n错误: 0');

console.log('\n=== 比对结果 ===');
for (const r of results) console.log('  ' + r.filter(Boolean).join('  '));
console.log(fail ? `\n❌ ${fail} 个文件不一致` : '\n✅ 全部一致');

// 打印第一个画布的完整生成结果，便于人工核对
if (process.argv.includes('--show')) {
  console.log('\n================ ' + out.files[1].path + ' ================');
  console.log(out.files[1].content);
}

process.exit(fail ? 1 : 0);
