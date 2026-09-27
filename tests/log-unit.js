// 日志模块的单元测试：直接 import log.js，用一个假的 window.__TAURI__ 接住
// 它发出来的 IPC，检查**到底写了什么**。
//
// 为什么要单独测：log-file.js 是端到端（真的启动 exe、读回文件），跑一次要
// 几十秒，不适合验证「同一批日志会不会记重」这种纯逻辑。这里毫秒级跑完。
//
// 踩过的坑（就是本文件存在的理由）：
//   action() 记的是「按钮: fit」（带冒号），而计时用的 key 是「按钮 fit」
//   （不带冒号）。第一版的轨迹合并直接比字符串，于是**永远匹配不上** ——
//   每次点击都占两条轨迹，40 条的缓冲一半是重复的。

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const eq = (a, b, m) => (a === b ? ok(`${m}（${JSON.stringify(a)}）`) : bad(`${m}：期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));

// ---------- 假的运行环境 ----------
// log.js 只看 window.__TAURI__ 和 document，两个都给它造出来。
const sent = [];
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        if (cmd === 'append_log') { sent.push({ level: args.level, message: args.message }); return 'C:\\fake\\logs\\kts-builder-2026-01-01.txt'; }
        if (cmd === 'log_path') return 'C:\\fake\\logs\\kts-builder-2026-01-01.txt';
        if (cmd === 'log_dir_path') return 'C:\\fake\\logs';
        return null;
      },
    },
  },
};
const listeners = {};
globalThis.document = {
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  dispatchEvent: (e) => { (listeners[e.type] || []).forEach((fn) => fn(e)); },
};
globalThis.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } };

const { log, initLog, logStartup } = await import('../src/frontend/js/log.js');

const drain = () => { log.flushNow(); return sent.splice(0); };
const allText = () => { log.flushNow(); return sent.map((s) => s.message).join('\n'); };

console.log('=== 日志模块单元测试 ===\n');

// ---------- 1. 轨迹合并 ----------
console.log('--- 1. 操作轨迹：点一次按钮只占一条 ---');
{
  log.reset();
  log.action('按钮: fit');           // 记「点了什么」
  log.begin('按钮 fit').end();        // 记「花了多久」（名字差一个冒号）
  const trail = log.breadcrumbText();
  const lines = trail.split('\n').filter(Boolean);

  eq(lines.length, 1, '一次点击合并成一条轨迹');
  if (/按钮: fit/.test(trail) && /ms/.test(trail)) ok('轨迹里同时有「点了什么」和耗时');
  else bad('轨迹里缺内容：' + trail);
  if (/^\s*01\./.test(lines[0])) ok('轨迹带序号（崩溃记录里好读）');
  else bad('轨迹没有序号');
}

// ---------- 2. 不误合并 ----------
console.log('\n--- 2. 两个操作交叉时不会互相张冠李戴 ---');
{
  // 真实场景：两个异步操作重叠，A 还没结束 B 就开始了。
  // 这时 A 的耗时绝不能贴到 B 那条轨迹上。
  log.reset();
  const a = log.begin('按钮 alpha');
  log.action('按钮: beta');     // B 插在 A 结束之前
  const b = log.begin('按钮 beta');
  a.end();                      // A 先结束，但最后一条轨迹是 beta
  b.end();
  const lines = log.breadcrumbText().split('\n').filter(Boolean);
  // 注意用 filter 不是 find：交叉场景下 beta 会有两条（action 一条、
  // 耗时一条），find 只会拿到第一条（没有耗时的那条），测不出问题。
  const alphaLines = lines.filter((l) => /alpha/.test(l));
  const betaLines = lines.filter((l) => /beta/.test(l));

  eq(lines.length, 3, '重叠的两个操作各留各的轨迹');
  if (alphaLines.length === 1 && /ms/.test(alphaLines[0])) ok('alpha 的耗时记在 alpha 那条上');
  else bad('alpha 的耗时没记上：' + JSON.stringify(alphaLines));
  if (betaLines.some((l) => /ms/.test(l))) ok('beta 的耗时也记上了');
  else bad('beta 的耗时没记上：' + JSON.stringify(betaLines));
  if (alphaLines.every((l) => !/beta/.test(l))) ok('alpha 那条没被 beta 污染');
  else bad('alpha 被 beta 污染了：' + JSON.stringify(alphaLines));
}

// ---------- 2b. 只有用户操作进轨迹 ----------
console.log('\n--- 2b. 普通 info/debug 日志不进操作轨迹（否则缓冲被灌满）---');
{
  log.reset();
  log.info('一条普通信息');
  log.warn('一条警告');
  log.debug('一条调试');
  eq(log.breadcrumbs().length, 0, '普通日志不占轨迹');
  log.action('按钮: fit');
  eq(log.breadcrumbs().length, 1, '用户操作才进轨迹');
}

// ---------- 3. 名字不同不互相污染 ----------
console.log('\n--- 3. 名字不同的操作不会互相污染 ---');
{
  log.reset();
  log.action('按钮: save');
  log.begin('按钮 fit').end();
  const t = log.breadcrumbText();
  const lines = t.split('\n').filter(Boolean);
  eq(lines.length, 2, '两个不同操作各占一条');
  if (!/save（/.test(lines[0])) ok('第一条没被加上别人的耗时');
  else bad('第一条被污染了：' + lines[0]);
}

// ---------- 4. 轨迹上限 ----------
console.log('\n--- 4. 轨迹是环形缓冲（不会无限长） ---');
{
  log.reset();
  for (let i = 1; i <= 60; i++) log.action('按钮: b' + i);
  const n = log.breadcrumbs().length;
  if (n <= 40) ok(`60 次操作只留最近 ${n} 条（上限 40）`);
  else bad(`轨迹没有上限，累积了 ${n} 条`);
  // 留的必须是最新的
  if (/b60/.test(log.breadcrumbText())) ok('留下的是最新的操作');
  else bad('留下的不是最新的');
}

// ---------- 5. 不记代码（用户要求） ----------
console.log('\n--- 5. 不记录生成的 Kotlin 代码（用户明确要求）---');
{
  log.reset();
  if (typeof log.code === 'function') bad('log.code 还在（用户要求删掉）');
  else ok('log.code 已删除');
}

// ---------- 6. 校验问题逐条记 + 带定位 ----------
console.log('\n--- 6. 校验错误/警告逐条记录，带定位 ---');
{
  log.reset();
  log.problems([
    { level: 'error', module: 'myPlugin', canvasTitle: '主流程', nodeId: 'n7', message: '「发送消息」的「内容」还没填' },
  ], '错误');
  const t = allText();
  if (/校验错误:/.test(t)) ok('带「校验错误」前缀（好过滤）');
  else bad('没有前缀：' + t);
  if (/模块 myPlugin/.test(t) && /画布「主流程」/.test(t) && /控件 n7/.test(t)) {
    ok('带模块/画布/控件定位（不用靠猜是哪一个）');
  } else {
    bad('缺少定位信息：' + t);
  }
  if (/发送消息/.test(t)) ok('带上了具体是哪条问题');
  else bad('没写清是什么问题');
}

// ---------- 7. 工程规模快照 ----------
console.log('\n--- 7. 工程规模快照（崩溃时看得出工程多大）---');
{
  const project = {
    activeCanvasId: 'c2',
    modules: [
      { id: 'm1', canvases: [{ id: 'c1', title: 'A', nodes: [1, 2], edges: [1] }, { id: 'c2', title: 'B', nodes: [1] }] },
      { id: 'm2', canvases: [{ id: 'c3', title: 'C', nodes: [1, 2, 3] }] },
    ],
  };
  const s = log.snapshot(project);
  if (/2 个模块/.test(s) && /3 个画布/.test(s) && /6 个控件/.test(s) && /1 条连线/.test(s)) {
    ok('统计准确：' + s);
  } else {
    bad('统计不对：' + s);
  }
  if (/当前画布：B/.test(s)) ok('标出了当前画布');
  else bad('没标当前画布：' + s);
  // 工程对象损坏时不能抛 —— 这里是崩溃处理路径
  eq(log.snapshot(null), '', '工程对象为空时返回空串而不是抛异常');
  eq(log.snapshot({ get modules() { throw new Error('坏了'); } }), '', '工程对象损坏时也不抛异常');
}

// ---------- 8. 日志级别与内容 ----------
console.log('\n--- 8. 级别、写入、开关 ---');
{
  log.reset();
  sent.length = 0;
  log.info('测试 INFO');
  log.warn('测试 WARN');
  log.error('测试 ERROR');
  log.flushNow();
  const got = sent.splice(0);
  eq(got.length, 3, '三条都发出去了');
  if (got[0].level === 'INFO' && got[1].level === 'WARN' && got[2].level === 'ERROR') ok('级别正确');
  else bad('级别不对：' + JSON.stringify(got.map((g) => g.level)));

  // 关掉之后不该再发
  document.dispatchEvent(new CustomEvent('kts:log-enabled', { detail: false }));
  log.info('关掉之后不该出现');
  log.flushNow();
  eq(sent.length, 0, '关掉日志后不再写入');
  document.dispatchEvent(new CustomEvent('kts:log-enabled', { detail: true }));
}

// ---------- 9. 启动记录 ----------
console.log('\n--- 9. 启动记录 ---');
{
  log.reset();
  sent.length = 0;
  await logStartup({ version: '9.9.9', userAgent: 'FakeAgent/1.0' });
  const t = sent.map((s) => s.message).join('\n');
  if (/==== 应用启动 v9\.9\.9 ====/.test(t)) ok('记了版本号');
  else bad('没记版本：' + t);
  if (/FakeAgent/.test(t)) ok('记了 userAgent（排查环境相关问题时有用）');
  else bad('没记 userAgent');
  if (/日志文件:/.test(t)) ok('记了日志文件位置');
  else bad('没记日志文件位置');
}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
