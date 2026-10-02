// 界面结构回归：样式完整性 + 用户报过的界面 bug
//
// 这些检查是「源码级」的——本机没有浏览器 provider，交互本身要人来验，
// 但下面这些问题都能从源码里看出来，所以钉在测试里防止改回去。
//
// 运行： node tests/ui-structure.js
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const uiSrc = readFileSync(join(ROOT, 'src/frontend/js/ui.js'), 'utf8');
const css = readFileSync(join(ROOT, 'src/frontend/css/app.css'), 'utf8');
const html = readFileSync(join(ROOT, 'src/frontend/index.html'), 'utf8');
const storeSrc = readFileSync(join(ROOT, 'src/frontend/js/store.js'), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

// ---------------- 1. 浅色是默认；深色只出现在该出现的地方 ----------------

console.log('=== 1. 主题色值检查 ===');
{
  // #16181d 现在是深色主题的正式底色（[data-theme="dark"] 里的 --bg），
  // 不再是「残留」。其余这些是浅色化之前用过、且至今不该复活的深色值。
  const stale = ['#1c1f26', '#22262f', '#2a2f3a', '#10131a',
    '#4a3030', '#333a47', '#eef1f8', '#cfd6e6', '#303748', '#5d6678', '#262b34',
    'rgba(0,0,0,.6)', '0 20px 60px'];
  const hit = stale.filter((c) => css.includes(c));
  if (hit.length) bad(`还残留旧的深色硬编码色值：${hit.join(', ')}`);
  else ok(`${stale.length} 个旧深色硬编码色值全部清除`);

  // 默认必须是浅色：#16181d 只能出现在 [data-theme="dark"] 块里。
  // 先剥掉注释 —— 文件开头的说明里就提到了 [data-theme="dark"]，
  // 直接 indexOf 会定位到那句注释上。
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const darkStart = cssCode.indexOf('[data-theme="dark"]');
  const rootStart = cssCode.indexOf(':root');
  if (darkStart < 0) bad('找不到 [data-theme="dark"] 变量块');
  else if (rootStart < 0) bad('找不到 :root 变量块');
  else {
    if (rootStart > darkStart) bad(':root 定义在深色块之后，顺序不对');
    else ok(':root（浅色）在前，[data-theme="dark"] 在后，符合覆盖顺序');
    const lightPart = cssCode.slice(rootStart, darkStart);
    if (lightPart.includes('#16181d')) bad('浅色默认块里出现了深色底色 #16181d');
    else ok('默认（未指定 data-theme）仍是浅色，深色只在 [data-theme="dark"] 里');
  }

  // 代码预览永远是深色，且只有一处定义
  const darkBlocks = [...css.matchAll(/--cd-bg:\s*(#[0-9a-fA-F]{6})/g)];
  if (darkBlocks.length !== 1) bad(`深色代码区变量应只有 1 处定义，实际 ${darkBlocks.length} 处`);
  else ok('代码预览固定深色（--cd-bg 单点定义）');
}

// ---------------- 2. JS/HTML 用到的 class 必须都有样式 ----------------

console.log('\n=== 2. class 完整性 ===');
{
  const classes = new Set();
  // 只取静态 class 名：含 ${ 的是模板表达式，跳过
  for (const src of [uiSrc, html]) {
    for (const m of src.matchAll(/class="([^"]*)"/g)) {
      if (m[1].includes('${')) {
        // 模板串里仍可能有静态部分，如 class="lib-group${open ? ' open' : ''}"
        // 取 ${ 之前的那一段就够（后面的动态值由别的断言覆盖）
        const head = m[1].split('${')[0].trim();
        if (head) for (const c of head.split(/\s+/)) if (c && /^[a-z][\w-]*$/i.test(c)) classes.add(c);
        continue;
      }
      for (const c of m[1].split(/\s+/)) if (c && /^[a-z][\w-]*$/i.test(c)) classes.add(c);
    }
  }
  // 动态拼接出来的关键 class 手动补上
  for (const c of ['open', 'wide', 'code-dark', 'primary', 'active']) classes.add(c);

  // 必须按选择器边界匹配：单纯 includes('.foo') 会被 '.foo-bar' 骗过
  // （改名前缀时测试会误判为「还有定义」）。
  const hasRule = (c) => new RegExp('\\.' + c.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\w-])').test(css);
  const missing = [...classes].filter((c) => !hasRule(c)).sort();
  if (missing.length) bad(`这些 class 在 CSS 里没有定义：${missing.map((c) => '.' + c).join(', ')}`);
  else ok(`${classes.size} 个 class 都有样式定义`);
}

// ---------------- 3. 控件库折叠 ----------------

console.log('\n=== 3. 控件库折叠 ===');
{
  if (!/lib-group-head/.test(uiSrc) || !/data-toggle=/.test(uiSrc)) bad('控件库分类头没有折叠开关');
  else if (!/toggleGroup/.test(uiSrc)) bad('折叠没调用 store.toggleGroup');
  else if (!/openGroups: \[\]/.test(storeSrc)) bad('展开状态默认值不是空数组（应默认全折叠）');
  else ok('分类可折叠、默认全折叠');

  // 展开状态刻意**不**持久化：用户反馈「一进来分类全是开的」就是它造成的
  // （上次点开过的分类被记住了）。这条断言防止将来有人「顺手加回持久化」。
  if (/localStorage\.setItem\(LS_UI/.test(storeSrc)) {
    bad('展开状态又被写进 localStorage 了 —— 会导致下次启动时分类残留展开');
  } else if (/localStorage\.getItem\(LS_UI/.test(storeSrc)) {
    bad('还在读 localStorage 里的展开状态 —— 老用户升级后会看到「默认全展开」');
  } else {
    ok('展开状态不持久化（每次启动都是干净的折叠态）');
  }

  // 搜索时必须强制平铺，否则搜到了却因折叠看不见
  if (/if \(q\) \{/.test(uiSrc) && /searchDefs\(q\)/.test(uiSrc)) ok('搜索时平铺结果，不走折叠');
  else bad('搜索路径可能受折叠影响');

  // 折叠头要能键盘操作
  if (/aria-expanded/.test(uiSrc)) ok('折叠按钮带 aria-expanded（可访问性）');
  else bad('折叠按钮缺 aria-expanded');
}

// ---------------- 4. 首页（主界面） ----------------

console.log('\n=== 4. 首页 ===');
{
  const homeSrc = readFileSync(join(ROOT, 'src/frontend/js/home.js'), 'utf8');

  // 欢迎弹窗已经删掉，整件事都归首页
  if (/showOnboarding/.test(uiSrc)) bad('ui.js 里还留着 showOnboarding（应由首页接管）');
  else ok('欢迎弹窗已删除，启动进首页');

  // 首页必须是整窗视图，不能是弹窗
  if (/#home\s*\{[^}]*position:\s*fixed/.test(css)) ok('#home 是整窗视图');
  else bad('#home 不是整窗视图（position: fixed）');
  if (/<div id="home"/.test(html)) ok('index.html 里有 #home 容器');
  else bad('index.html 缺少 #home 容器');

  // 启动就进首页
  if (/this\.openHome\(\)/.test(uiSrc)) ok('start() 启动进首页');
  else bad('启动没有进首页');

  // 能回到首页 + 能进画布
  if (/data-act="home"/.test(html)) ok('工具栏有「主页」按钮');
  else bad('工具栏没有回主页的入口');
  if (/enterModule/.test(uiSrc) && /onOpenCanvas/.test(homeSrc)) ok('点插件组能进画布');
  else bad('首页没有「进入插件组」的入口');

  // 首页三件事：新建插件组 / 设置 / 打开工程
  if (/新建插件组/.test(homeSrc)) ok('首页能新建插件组');
  else bad('首页没有「新建插件组」');
  if (/data-hact="settings"/.test(homeSrc)) ok('首页能进设置');
  else bad('首页没有设置入口');

  // 新建完必须留在首页（用户明确要求），不能跳画布。
  // 第 15 轮：新建插件组改走 ui.js 的弹窗（填名字 + 选模板），
  // 所以这里改查「首页发起 → 弹窗建组 → 不调 enterModule/closeHome」。
  if (/onNewModule/.test(homeSrc) && /newModuleFromHome/.test(uiSrc)) {
    // 从**方法定义**处匹配（97 行的回调只是引用，不含方法体）
    const fn = uiSrc.match(/async newModuleFromHome\(\)[\s\S]*?\n  \}\n/);
    const bodyText = fn ? fn[0] : '';
    // 「不跳走」= 弹窗里不调 closeHome / enterModule（建完仍停在首页列表）
    if (/store\.addModule/.test(bodyText) && !/closeHome|enterModule/.test(bodyText)) {
      ok('新建插件组后留在首页（弹窗建完直接出现在列表里）');
    } else {
      bad('新建插件组的弹窗要么没建组，要么建完跳走了');
    }
  } else {
    bad('首页的「新建插件组」没有接到 ui.js 的弹窗上');
  }

  // 首页要能显示每个插件组的规模
  if (/nodeCount|edgeCount/.test(homeSrc)) ok('首页列出每个插件组的画布/控件数量');
  else bad('首页没有显示插件组规模');

  // 首页不直接依赖 ui.js（会成环），动作靠注入
  if (!/from '\.\/ui\.js'/.test(homeSrc)) ok('home.js 不反向依赖 ui.js（无循环）');
  else bad('home.js 反向 import 了 ui.js，会成环');
}

// ---------------- 4b. 每个控件分类都要有配色 ----------------
//
// 新增一个分类时最容易漏掉 CSS：控件卡片还是灰的、画布上节点也没有配色，
// 但界面**不报错**，只是「看着不对」。两类漏法都查：
//   * 有 .lib-card 规则、没有 .cv-node / .cv-dropzone 规则
//   * 两套主题里漏了 --nc-<cat> 或 --nc-line-<cat>
console.log('\n=== 4b. 分类配色完整 ===');
{
  const idxSrc = readFileSync(join(ROOT, 'src/frontend/js/catalog/index.js'), 'utf8');
  const labelBlock = idxSrc.slice(idxSrc.indexOf('CATEGORY_LABEL'));
  const catKeys = [...labelBlock.matchAll(/^\s{2}([a-z][a-z0-9]*):\s*'/gm)].map(m => m[1]);
  if (!catKeys.length) bad('没能从 CATEGORY_LABEL 里读出分类');

  // 浅色 :root 和深色 [data-theme="dark"] 两块
  const rootStart = css.indexOf(':root');
  const block = (from) => {
    const s = css.indexOf('{', from);
    let d = 0, j = s;
    for (; j < css.length; j++) {
      if (css[j] === '{') d++;
      else if (css[j] === '}') { d--; if (!d) break; }
    }
    return css.slice(s + 1, j);
  };
  const light = block(rootStart);
  const dark = block(css.indexOf('[data-theme="dark"]'));

  const missing = [];
  for (const c of catKeys) {
    for (const sel of [`.lib-card[data-cat="${c}"]`, `.cv-node[data-cat="${c}"]`, `.cv-dropzone[data-cat="${c}"]`]) {
      if (!css.includes(sel)) missing.push(sel);
    }
    for (const v of [`--nc-${c}`, `--nc-line-${c}`]) {
      if (!new RegExp(v + '\\s*:').test(light)) missing.push(`${v}（浅色）`);
      if (!new RegExp(v + '\\s*:').test(dark)) missing.push(`${v}（深色）`);
    }
  }
  if (missing.length) {
    bad(`${catKeys.length} 个分类里缺 ${missing.length} 处配色：`);
    for (const m of missing) console.log('       · ' + m);
  } else {
    ok(`${catKeys.length} 个分类（${catKeys.join('/')}）的卡片/节点/落点 + 两套主题配色都齐`);
  }

  // 反向：CSS 里写了配色，但分类已经不存在了（改名/删除后的残留）
  const stray = [];
  for (const m of css.matchAll(/data-cat="([a-z][a-z0-9]*)"/g)) {
    if (!catKeys.includes(m[1]) && !stray.includes(m[1])) stray.push(m[1]);
  }
  if (stray.length) bad(`CSS 里有已不存在的分类配色：${stray.join(', ')}`);
  else ok('没有残留的废弃分类配色');
}

// ---------------- 5. 代码预览不重复 ----------------

console.log('\n=== 5. 代码预览 ===');
{
  if (/id="preview"/.test(html) || /id="previewBody"/.test(html)) {
    bad('index.html 里还有右下角常驻预览面板（与工具栏按钮重复）');
  } else if (/#preview\b|#previewBody|\.pv-head/.test(css)) {
    bad('CSS 里还残留常驻预览面板样式');
  } else {
    ok('只有工具栏一个「代码预览」入口');
  }
  // 代码弹窗必须是深色
  if (/class="codemode code-dark"/.test(uiSrc)) ok('代码预览弹窗用深色容器');
  else bad('代码预览弹窗没用 .code-dark');
}

// ---------------- 6. 画布交互 ----------------

console.log('\n=== 6. 画布交互 ===');
{
  const canvasSrc = readFileSync(join(ROOT, 'src/frontend/js/canvas.js'), 'utf8');
  const tauriConf = JSON.parse(readFileSync(join(ROOT, 'src/backend/tauri.conf.json'), 'utf8'));
  // 下面几节（删连线 / 全屏）要用到的源码
  const storeSrc = readFileSync(join(ROOT, 'src/frontend/js/store.js'), 'utf8');
  const exportSrc = readFileSync(join(ROOT, 'src/frontend/js/export.js'), 'utf8');
  const rsMain0 = readFileSync(join(ROOT, 'src/backend/src/main.rs'), 'utf8');
  const setSrc0 = readFileSync(join(ROOT, 'src/frontend/js/settings.js'), 'utf8');

  // 6.1 Tauri 必须关掉它自己的拖放拦截，否则 HTML5 拖放事件根本不触发
  //     （这就是「拖不进画布，只能双击」的根因）
  const win = (tauriConf.app && tauriConf.app.windows && tauriConf.app.windows[0]) || {};
  if (win.dragDropEnabled !== false) {
    bad('tauri.conf.json 没有设 dragDropEnabled: false —— 拖放会被 Tauri 吃掉，控件拖不进画布');
  } else {
    ok('Tauri 已关闭自带的拖放拦截（dragDropEnabled: false），HTML5 拖放可用');
  }

  // 6.2 只保留拖入：双击添加控件已删除
  if (/addEventListener\('dblclick'[\s\S]{0,200}?store\.addNode/.test(uiSrc)) {
    bad('控件库还留着双击添加控件（用户要求只保留拖入）');
  } else {
    ok('双击添加控件已删除，只保留拖入');
  }
  // 但拖入必须真的在
  if (!/dragstart/.test(uiSrc) || !/setData\('text\/kts-def'/.test(uiSrc)) {
    bad('控件卡片没有正确的 dragstart / setData，拖放不会生效');
  } else {
    ok('控件卡片 dragstart 正确设置 text/kts-def');
  }
  // drop 处理必须存在且 preventDefault
  if (!/addEventListener\('drop'/.test(canvasSrc)) bad('画布没有 drop 处理');
  else if (!/addEventListener\('dragover'[\s\S]{0,120}?preventDefault\(\)/.test(canvasSrc)) {
    bad('dragover 没有 preventDefault —— 浏览器不会触发 drop');
  } else {
    ok('画布 drop / dragover 处理正确');
  }
  // 幽灵卡片 + 落点虚影
  if (/setDragImage/.test(uiSrc) && /drag-ghost/.test(css)) ok('拖动时有半透明幽灵卡片');
  else bad('拖动时没有幽灵卡片（setDragImage / .drag-ghost 缺失）');
  if (/showDropHint/.test(canvasSrc) && /cv-dropzone/.test(css)) ok('画布上有落点虚影提示');
  else bad('缺少落点虚影提示');

  // 6.3 滚轮任何时候都是缩放（不再有滚轮平移）
  if (/if \(!e\.ctrlKey && !e\.metaKey\)/.test(canvasSrc) && /this\.panX -= e\.deltaX/.test(canvasSrc)) {
    bad('滚轮仍然是平移（用户要求任何情况下都缩放）');
  } else if (!/addEventListener\('wheel'/.test(canvasSrc) || !/panForZoomAt/.test(canvasSrc)) {
    bad('滚轮缩放没有以鼠标位置为锚点');
  } else {
    ok('滚轮任何时候都缩放，且以鼠标位置为中心');
  }
  // 缩放范围 25%~250%
  if (/ZOOM_MIN = 0\.25/.test(canvasSrc) && /ZOOM_MAX = 2\.5/.test(canvasSrc)) {
    ok('缩放范围锁定 25% ~ 250%');
  } else {
    bad('缩放范围不是 25%~250%');
  }

  // 6.4 右键拖动 = 平移
  if (!/e\.button === 2/.test(canvasSrc)) bad('右键没有接到平移');
  else if (!/this\.panning = \{/.test(canvasSrc)) bad('平移状态没有建立');
  else ok('右键拖动 = 平移画布');

  // 右键单击不该弹菜单（用户选了「什么都不做」）
  const cmHandler = canvasSrc.match(/addEventListener\('contextmenu'[\s\S]{0,200}?\}\);/);
  if (cmHandler && /canvasMenu|ctx-menu|nodeMenu/.test(cmHandler[0])) {
    bad('画布右键单击弹了菜单（用户要求什么都不做）');
  } else {
    ok('画布右键单击不弹菜单');
  }

  // 中键 / 空格 平移仍然保留
  if (/e\.button === 1/.test(canvasSrc) && /this\.spaceDown/.test(canvasSrc)) {
    ok('中键与空格+拖 仍可平移');
  } else {
    bad('中键/空格平移被误删');
  }

  // 左键：拖节点 + 拖空白处平移；框选已按用户要求整块删除
  if (/this\.drag = \{ start/.test(canvasSrc)) ok('左键仍用于拖动节点');
  else bad('左键拖节点被破坏');
  if (/e\.button === 0 && \(onEmpty/.test(canvasSrc)) ok('左键拖空白处 = 平移画布');
  else bad('左键拖空白处没有接到平移');
  if (/marquee|cv-marquee/i.test(canvasSrc) || /cv-marquee/i.test(css)) {
    bad('框选（划框多选）应该已彻底删除，但代码里还有残留');
  } else {
    ok('划框多选已彻底删除（代码与样式都没有残留）');
  }

  // --- 删除连线（用户要求）---
  // 鼠标移到连线上浮出 ×，点它删除。
  if (/cv-edge-del/.test(canvasSrc) && /cv-edge-del/.test(css)) {
    ok('连线上有删除按钮（悬停浮出 ×）');
  } else {
    bad('连线没有删除入口');
  }
  // 按钮必须挂在贝塞尔曲线中点，否则会飘在线旁边
  if (/bezierMidpoint/.test(canvasSrc)) ok('删除按钮摆在连线中点');
  else bad('删除按钮位置没跟着曲线算，会飘');
  // 删连线要能撤销（和删节点一致）
  if (/removeEdge\(/.test(canvasSrc)) ok('删连线走 store.removeEdge（可撤销）');
  else bad('删连线没走 store，撤销不回来');
  // 批量断线
  if (/removeEdgesOf/.test(canvasSrc) && /export function removeEdgesOf/.test(storeSrc)) {
    ok('节点右键菜单能「断开所有连线」');
  } else {
    bad('缺少批量断线功能');
  }
  // 批量断线只能产生**一个**撤销点（循环调 removeEdge 会塞十个）
  const bulk = storeSrc.match(/export function removeEdgesOf[\s\S]*?\n\}/);
  const pushCount = bulk ? (bulk[0].match(/pushUndo\(\)/g) || []).length : 0;
  if (pushCount === 1) ok('批量断线只记一个撤销点（Ctrl+Z 一次退回）');
  else bad(`批量断线记了 ${pushCount} 个撤销点，Ctrl+Z 要按好几次`);

  // --- 全屏（用户要求）---
  const htmlSrc = readFileSync(join(ROOT, 'src/frontend/index.html'), 'utf8');
  if (/data-act="fullscreen"/.test(htmlSrc)) ok('工具栏有「全屏」按钮');
  else bad('工具栏没有全屏按钮');
  if (/toggleFullscreen/.test(uiSrc) && /F11/.test(uiSrc)) ok('F11 与按钮都能切全屏');
  else bad('全屏没有接 F11');
  if (/setFullscreen|set_fullscreen/.test(exportSrc) && /fn set_fullscreen/.test(rsMain0)) {
    ok('全屏走 Rust 命令（不受 ACL 限制）');
  } else {
    bad('全屏没有接上 Rust 命令');
  }
  if (/exitFullscreenIfOn/.test(uiSrc) && /Escape/.test(uiSrc)) ok('Esc 能退出全屏');
  else bad('Esc 退不出全屏');
  // 用户选了「不记住」：不能把全屏状态写进设置
  if (/fullscreen/i.test(setSrc0)) bad('全屏状态被存进设置了（用户要求每次普通窗口）');
  else ok('全屏状态不记忆（每次都以普通窗口启动）');
}

// ---------------- 7. 生成代码不能调挂起函数 ----------------
//
// listen { } 的 lambda 类型是 (T) -> Unit，**不是 suspend**
// （coreMindustry/lib/ListenExt.kt:24）。而 player.hasPermission(...) 是
// suspend 的（coreMindustry/lib/PermissionExt.kt:6），写在事件体里编译不过。
// 这个坑很隐蔽：本工具只做静态检查，不会报错，要到游戏里加载插件才炸。
console.log('\n=== 7. 不在事件体里生成挂起调用 ===');
{
  const typesSrc = readFileSync(join(ROOT, 'src/frontend/js/catalog/types.js'), 'utf8');
  const genSrc = readFileSync(join(ROOT, 'src/frontend/js/generate.js'), 'utf8');

  // 控件目录里不能出现 player.hasPermission( 这种调用。
  // 先剥掉注释再查，否则解释「为什么不能用它」的注释会被误判。
  const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const codeOnly = stripComments(typesSrc);

  if (/\.hasPermission\(/.test(codeOnly)) {
    bad('控件目录里仍在生成 player.hasPermission(...)：它是挂起函数，事件体里不能用');
  } else {
    ok('没有生成 suspend 的 player.hasPermission(...)（注释里的说明不算）');
  }

  // 「拥有权限」必须走非挂起的 PermissionApi.check
  // （coreLibrary/lib/PermissionApi.kt:77 是普通 fun）
  if (/PermissionApi\.check\(/.test(codeOnly)) {
    ok('「拥有权限」改用非挂起的 PermissionApi.check');
  } else {
    bad('「拥有权限」没有改用 PermissionApi.check，事件体里会编译失败');
  }

  // delay 只能在挂起上下文（loop / launch）里出现，控件要自己拦住
  const others2 = readFileSync(join(ROOT, 'src/frontend/js/catalog/others2.js'), 'utf8');
  if (/label !== 'loop' && label !== 'launch'/.test(others2)) {
    ok('「等几秒」会拦住非挂起上下文，不会生成裸 delay');
  } else {
    bad('「等几秒」没有检查挂起上下文，可能在事件体里生成裸 delay');
  }

  // 标签栈机制：每个开 lambda 的控件都要自带 labelName，
  // 否则「到此为止」会生成错的 return@xxx
  const withLabel = (src) => (src.match(/labelName:\s*'/g) || []).length;
  const n = withLabel(readFileSync(join(ROOT, 'src/frontend/js/catalog/events.js'), 'utf8')) +
    withLabel(readFileSync(join(ROOT, 'src/frontend/js/catalog/others.js'), 'utf8')) +
    withLabel(readFileSync(join(ROOT, 'src/frontend/js/catalog/actions2.js'), 'utf8')) +
    withLabel(readFileSync(join(ROOT, 'src/frontend/js/catalog/others2.js'), 'utf8'));
  if (n >= 10) ok(`${n} 个控件声明了 lambda 标签（供「到此为止」用）`);
  else bad(`只有 ${n} 个控件声明了 lambda 标签，偏少`);
}

// ---------------- 8. 关窗提醒 / 设置页 / 网格 ----------------

console.log('\n=== 8. 关窗提醒 · 设置页 · 网格 ===');
{
  const mainSrc = readFileSync(join(ROOT, 'src/frontend/js/main.js'), 'utf8');
  const storeSrc = readFileSync(join(ROOT, 'src/frontend/js/store.js'), 'utf8');
  const canvasSrc = readFileSync(join(ROOT, 'src/frontend/js/canvas.js'), 'utf8');
  const rsSrc = readFileSync(join(ROOT, 'src/backend/src/main.rs'), 'utf8');
  const uiSrc2 = readFileSync(join(ROOT, 'src/frontend/js/ui.js'), 'utf8');

  // --- 关窗二次提醒 ---
  // 必须由 Rust 拦 CloseRequested 再回问前端：事件插件要走 ACL，
  // 而本工程没有 capabilities 清单，插件命令会被拒。
  if (/CloseRequested\s*\{/.test(rsSrc) && /prevent_close\(\)/.test(rsSrc)) {
    ok('Rust 拦住了关窗（CloseRequested + prevent_close），不会被 ACL 挡住');
  } else {
    bad('Rust 没有拦 CloseRequested，关窗提醒不会触发');
  }
  if (/fn confirm_close/.test(rsSrc) && /confirm_close/.test(rsSrc)) {
    ok('前端问完用户后能回调 confirm_close 真正关闭');
  } else {
    bad('缺少 confirm_close，用户确认后窗口会关不掉');
  }
  // 看门狗：前端要是坏了（__app 不存在 / render 抛异常），prevent_close 之后
  // 就没人回应，窗口会彻底关不掉，用户只能去任务管理器强杀。
  if (/CLOSE_ACKED/.test(rsSrc) && /fn close_guard_ack/.test(rsSrc) && /win\.destroy\(\)/.test(rsSrc)) {
    ok('有看门狗兜底：前端无响应时仍会放行关闭，不会变成关不掉的窗口');
  } else {
    bad('缺少关窗看门狗 —— 前端一旦出错，窗口就关不掉了');
  }
  if (/closeGuardAck/.test(uiSrc2) && /closeGuardAck\(\)/.test(uiSrc2)) {
    ok('前端在弹框之前先报到，用户思考多久都不会被看门狗误杀');
  } else {
    bad('前端没有 closeGuardAck，看门狗会误判');
  }
  // 前端必须真的把询问接上（只定义不断线是没用的）
  if (/onCloseRequested\s*\(/.test(readFileSync(join(ROOT, 'src/frontend/js/ui.js'), 'utf8'))) {
    ok('前端实现了 onCloseRequested 询问流程');
  } else {
    bad('前端没有 onCloseRequested，Rust eval 过来会报错');
  }
  if (/window\.__app\s*&&\s*window\.__app\.onCloseRequested/.test(rsSrc)) {
    ok('Rust 通过 eval 调用前端询问（不依赖插件权限）');
  } else {
    bad('Rust 没有调用前端的 onCloseRequested');
  }

  // 三个按钮：取消 / 不保存 / 保存并继续
  for (const label of ['取消', '不保存', '保存并继续']) {
    if (!uiSrc2.includes(`'${label}'`)) bad(`关窗提醒缺少「${label}」按钮`);
  }
  if (['取消', '不保存', '保存并继续'].every(l => uiSrc2.includes(`'${l}'`))) {
    ok('关窗提醒有三个出口：取消 / 不保存 / 保存并继续');
  }
  // 「保存并继续」里若用户把另存为对话框取消掉，整体必须当取消处理
  if (/选了「保存并继续」[\s\S]{0,200}return await this\.saveProject\(\)/.test(uiSrc2)) {
    ok('「保存并继续」被取消时不会误当作「不保存」');
  } else {
    bad('「保存并继续」没有把另存为的取消结果传出去 —— 会把「取消」错当「不保存」');
  }

  // 其余破坏性动作也要问。
  // 「打开工程」的询问放在 openProject() 里面（而不是分发那一行），
  // 因为它还可能被首页等其他入口调到 —— 放在函数里才拦得住所有调用路径。
  for (const [label, re] of [
    ['新建工程', /act === 'newProject'[^\n]*confirmUnsaved/],
    ['打开工程', /async openProject\(\)[^]*?confirmUnsaved\(/],
    ['新建模块', /act === 'newModule'[^\n]*confirmUnsaved/],
    ['套用模板', /act === 'template'[^\n]*confirmUnsaved/],
    ['关闭画布', /confirmUnsaved\('关闭这张画布'\)/],
    ['删除画布', /confirmUnsaved\('删除这张画布'\)/],
    ['删除模块', /confirmUnsaved\(`删除模块/],
  ]) {
    if (!re.test(uiSrc2)) bad(`「${label}」前没有二次提醒`);
  }
  if ([/act === 'newProject'[^\n]*confirmUnsaved/, /async openProject\(\)[^]*?confirmUnsaved\(/,
    /act === 'newModule'[^\n]*confirmUnsaved/, /act === 'template'[^\n]*confirmUnsaved/,
    /confirmUnsaved\('关闭这张画布'\)/, /confirmUnsaved\('删除这张画布'\)/,
    /confirmUnsaved\(`删除模块/]
    .every(re => re.test(uiSrc2))) {
    ok('7 个破坏性动作之前都会问一句（新建/打开/新建模块/套用模板/关画布/删画布/删模块）');
  }

  // --- 模块管理窗口 ---
  // store.removeModule 以前是死代码：界面上根本没有删除模块的入口。
  if (/store\.removeModule\(/.test(uiSrc2)) ok('「删除模块」接上了 store.removeModule');
  else bad('store.removeModule 仍是死代码，界面上删不掉模块');
  if (/data-act="modules"/.test(html) && /act === 'modules'/.test(uiSrc2)) {
    ok('工具栏有「模块管理」入口');
  } else {
    bad('工具栏缺少「模块管理」入口');
  }
  if (/data-del=/.test(uiSrc2) && /\[data-del\]'\)\.forEach/.test(uiSrc2.replace(/\s+/g, ' '))) {
    ok('模块列表里的删除按钮自己挂了事件（modal 只自动挂 [data-btn]）');
  } else {
    bad('模块列表的删除按钮没挂事件 —— 会点了没反应（首页卡片踩过同样的坑）');
  }
  if (/const closeManager = this\.modalDone/.test(uiSrc2)) {
    ok('删除前先收起管理窗口，避免单例弹窗被顶掉导致 Promise 悬空');
  } else {
    bad('直接在前一个弹窗上再叠弹窗：单例 #modal 会顶掉前者，调用方永远 await 不回来');
  }
  if (/modules\.length > 1/.test(uiSrc2)) ok('只剩一个模块时禁用删除（导出至少要有一个目录）');
  else bad('没有拦住「删掉最后一个模块」');

  // --- dirty 追踪 ---
  if (/function isDirty/.test(storeSrc) && /savedSnapshot/.test(storeSrc)) {
    ok('「未保存」是拿快照比对算出来的（撤销回原样也会变回已保存）');
  } else {
    bad('缺少 isDirty / savedSnapshot，无法判断有没有未保存改动');
  }
  if (/markSaved\(\)/.test(uiSrc2) && /store\.markSaved\(\)/.test(uiSrc2)) {
    ok('保存 / 打开 / 新建之后会重置「已保存」基准');
  } else {
    bad('保存之后没有重置基准，状态栏会一直显示「未保存」');
  }

  // --- 设置页 ---
  if (/<div id="settings" hidden>/.test(html)) ok('HTML 里有设置页容器（默认 hidden）');
  else bad('index.html 缺少 #settings 容器');
  if (/id="settings"/.test(html) && /data-act="settings"/.test(html)) {
    ok('工具栏有「设置」入口');
  } else {
    bad('工具栏没有「设置」按钮');
  }
  if (/el\.app\.hidden = true/.test(uiSrc2) && /closeSettings/.test(uiSrc2)) {
    ok('设置页是整个窗口替换（主界面隐藏），而不是弹窗');
  } else {
    bad('设置页没有做成整窗替换');
  }
  const setSrc = readFileSync(join(ROOT, 'src/frontend/js/settings.js'), 'utf8');
  const SECS = ['画布与操作', '外观与主题', '导出与保存', '日志', '关于'];
  for (const sec of SECS) {
    if (!setSrc.includes(sec)) bad(`设置缺少分类「${sec}」`);
  }
  if (SECS.every(s => setSrc.includes(s))) {
    ok('设置分五类：画布与操作 / 外观与主题 / 导出与保存 / 日志 / 关于');
  }
  // 存储必须真的落到 localStorage（全局偏好）
  if (/localStorage\.setItem\(LS/.test(setSrc)) ok('设置改动会写进 localStorage（全局生效）');
  else bad('设置没有持久化');

  // --- 全局防崩溃 ---
  // 「有几个按钮一点就崩溃」的根治手段：任何未捕获异常都要变成可读提示，
  // 且渲染的每个环节互相隔离，一个坏掉不能拖垮整个界面。
  {
    const guardPath = join(ROOT, 'src/frontend/js/crashguard.js');
    if (!existsSync(guardPath)) {
      bad('缺少 src/frontend/js/crashguard.js（全局防崩溃）');
    } else {
      const guard = readFileSync(guardPath, 'utf8');
      if (/addEventListener\('error'/.test(guard) && /addEventListener\('unhandledrejection'/.test(guard)) {
        ok('崩溃拦截同时装了 error 和 unhandledrejection');
      } else {
        bad('崩溃拦截没装全（漏了 error 或 unhandledrejection）');
      }
      if (/另存工程/.test(guard)) ok('报错框提供「另存工程」出路（能抢救数据）');
      else bad('报错框没有抢救数据的出路');
      if (/MAX_SAME/.test(guard)) ok('同一错误有次数上限（不会无限刷屏）');
      else bad('同一错误会无限刷屏');
      // 崩溃日志现在和普通日志并进同一个 .txt（用户要求）
      if (/log\.error/.test(guard)) ok('崩溃会写进日志文件（和操作日志同一个文件）');
      else bad('崩溃只弹提示、不落盘 —— 用户发不出堆栈');
    }

    // --- 日志系统（用户要求：.txt、按天分、可查可清）---
    const logPath = join(ROOT, 'src/frontend/js/log.js');
    if (!existsSync(logPath)) {
      bad('缺少 src/frontend/js/log.js（日志模块）');
    } else {
      const lg = readFileSync(logPath, 'utf8');
      for (const [re, msg] of [
        [/action/, '记用户操作'],
        [/begin\(/, '给操作计时'],
        [/breadcrumb/, '记操作轨迹（崩溃时能看出干了什么）'],
        [/snapshot/, '记工程规模（崩溃时能看出工程多大）'],
        [/problems/, '逐条记校验错误/警告'],
      ]) {
        if (re.test(lg)) ok(`日志模块会${msg}`);
        else bad(`日志模块不会${msg}`);
      }
      if (/flush/.test(lg)) ok('日志有合并/刷新（不会每条都走一次 IPC）');
      else bad('日志每次写入都单独 IPC，会拖慢界面');
    }

    // 用户明确要求「不要记录每次生成的代码」——
    // 反向断言：日志模块和 ui.js 里都不许再出现记代码的调用。
    {
      const lg = readFileSync(logPath, 'utf8');
      const uiForLog = readFileSync(join(ROOT, 'src/frontend/js/ui.js'), 'utf8');
      if (/\bcode:\s*\(/.test(lg) || /log\.code\(/.test(uiForLog)) {
        bad('还在把生成的 Kotlin 代码写进日志（用户明确说不要）');
      } else {
        ok('不再记录生成的 Kotlin 代码（用户要求）');
      }
    }

    // 校验问题必须逐条记，且带上是哪个模块/画布/控件
    {
      const lg = readFileSync(logPath, 'utf8');
      if (/describeProblem/.test(lg) && /canvasTitle/.test(lg) && /nodeId/.test(lg)) {
        ok('校验问题逐条记录，带模块/画布/控件定位');
      } else {
        bad('校验问题没带上定位信息（只说「3 个错误」没法排查）');
      }
    }

    // 崩溃记录要附工程规模 + 操作轨迹
    {
      const guard = readFileSync(join(ROOT, 'src/frontend/js/crashguard.js'), 'utf8');
      if (/captureSnapshot/.test(guard)) ok('崩溃记录附上当时的工程规模');
      else bad('崩溃记录没有工程规模（不知道是多大的工程崩的）');
      if (/breadcrumbText/.test(guard)) ok('崩溃记录附上崩溃前的操作轨迹');
      else bad('崩溃记录没有操作轨迹（不知道崩溃前在干什么）');
    }

    // Rust 侧：日志命令与文件命名
    const rsMain = readFileSync(join(ROOT, 'src/backend/src/main.rs'), 'utf8');
    for (const fn of ['append_log', 'read_log', 'clear_log', 'log_path', 'log_dir_path']) {
      if (new RegExp(`fn ${fn}\\b`).test(rsMain)) ok(`Rust 提供 ${fn}`);
      else bad(`Rust 没有 ${fn} 命令`);
    }
    if (/kts-builder-\{?\}?/.test(rsMain) && /format!\("kts-builder-\{\}/.test(rsMain)) {
      ok('日志文件名是按天分的 kts-builder-YYYY-MM-DD.txt');
    } else if (/kts-builder-/.test(rsMain)) {
      ok('日志文件名带 kts-builder- 前缀');
    } else {
      bad('日志文件名不是 kts-builder-<日期>.txt');
    }
    if (/\.txt/.test(rsMain)) ok('日志用 .txt（用户要求）');
    else bad('日志不是 .txt');
    if (/OpenOptions::new\(\)[\s\S]{0,120}\.append\(true\)/.test(rsMain)) {
      ok('日志是追加写入（连续几条都不会被覆盖）');
    } else {
      bad('日志不是追加写入 —— 后来的会盖掉先前那条');
    }
    if (/join\("logs"\)/.test(rsMain)) ok('日志写在 exe 旁边的 logs 文件夹');
    else bad('日志位置不是 exe 旁的 logs\\');
    // 所有会启动 exe 的测试都必须先把它复制到临时目录 ——
    // 否则日志会落进仓库，跑一次测试就多一个 logs\ 目录。
    for (const t of ['live-ui.js', 'close-guard.js', 'log-file.js', 'dialog-freeze.js']) {
      const p = join(ROOT, 'tests', t);
      if (!existsSync(p)) continue;
      const src = readFileSync(p, 'utf8');
      // 复制写法有两种：先算好 runExe 再 copy，或直接 copyFileSync(EXE, join(work,...))
      if (!/copyFileSync\(/.test(src)) {
        bad(`${t} 直接在项目根跑 exe（会把 logs\\ 丢进仓库），应先复制到临时目录`);
      }
      // 而且运行的那个路径必须是临时目录里的，不能在根目录
      if (/spawn\(\s*EXE\b/.test(src)) {
        bad(`${t} 仍然 spawn(EXE) 直接跑仓库里的 exe`);
      }
    }
    ok('会启动 exe 的测试都先复制到临时目录（不在仓库里留 logs）');
    // 崩溃不再单独出 crash.log。
    // 查之前先剥掉注释 —— 「为什么把 crash.log 并进来」这段说明本身
    // 必须留着，不能因为提到 crash.log 就判失败。
    const rsNoComments = rsMain
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    if (/crash\.log/.test(rsNoComments)) {
      bad('还留着旧的 crash.log（用户要求并进同一个 .txt）');
    } else {
      ok('旧的 crash.log 已并入统一日志');
    }

    const mainSrc = readFileSync(join(ROOT, 'src/frontend/js/main.js'), 'utf8');
    // 拦截必须在 App 构造之前装上，否则启动期的错误没人接
    const guardAt = mainSrc.indexOf('installCrashGuard()');
    const appAt = mainSrc.indexOf('new App()');
    if (guardAt >= 0 && appAt >= 0 && guardAt < appAt) ok('拦截在 App 构造之前装上');
    else bad('拦截装晚了 —— 启动期抛错会变成白屏');

    // renderAll 必须逐环节兜底
    const renderAll = (uiSrc2.match(/renderAll\(\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
    if (/try\s*\{/.test(renderAll) && /catch/.test(renderAll)) ok('renderAll 每个环节单独兜底（一处坏不拖垮全界面）');
    else bad('renderAll 没有分环节兜底 —— 一个环节抛错会导致「点哪个按钮都没反应」');
    if (/reportError/.test(uiSrc2)) ok('业务异常会上报给拦截器');
    else bad('业务异常没上报');

    // 按钮分派要能被 try/catch 包住（抽成了 dispatch）
    if (/async dispatch\(act\)/.test(uiSrc2) && /dispatch\(act\)/.test(uiSrc2)) {
      ok('工具栏动作抽成 dispatch，可被统一兜底');
    } else {
      bad('工具栏动作没有统一兜底入口');
    }
  }

  // 每一项设置都必须真的被用上。
  // 「有个开关但没人读」比没有这个开关更糟 —— 用户以为改了有用。
  //
  // 两类消费方式都算数：
  //   1. 别处用 S.get('key') 主动读（画布网格、导出目录……）
  //   2. settings.js 自己的 apply() 里用 state.key 落到 DOM（主题、字号、换行）
  {
    const keys = [...setSrc.matchAll(/key:\s*'([A-Za-z]+)'/g)].map(m => m[1]);
    const others = ['ui.js', 'canvas.js', 'store.js', 'inspector.js', 'export.js']
      .map(f => readFileSync(join(ROOT, 'src/frontend/js', f), 'utf8')).join('\n');

    // apply() 那段单独切出来，避免把 schema 里恰好也出现的 state.xxx 算进去
    const applyBody = (setSrc.match(/export function apply\(\)[\s\S]*?\n\}/) || [''])[0];

    const unused = keys.filter((k) =>
      !new RegExp(`(S|settings)\\.get\\(['"]${k}['"]\\)`).test(others) &&
      !new RegExp(`state\\.${k}\\b`).test(applyBody));

    if (unused.length) bad(`这些设置项没人读，是摆设：${unused.join(', ')}`);
    else ok(`${keys.length} 个设置项全部接上了线（没有摆设开关）`);
  }

  // --- 网格默认关闭 ---
  if (/key: 'showGrid', type: 'bool', default: false/.test(setSrc.replace(/\s+/g, ' '))) {
    ok('背景网格默认关闭');
  } else {
    bad('背景网格的默认值不是 false');
  }
  if (/classList\.toggle\('show-grid'/.test(canvasSrc)) {
    ok('网格由 .show-grid 类控制，不是写死在 CSS 里');
  } else {
    bad('网格没有做成可开关');
  }
  if (/--grid-size/.test(canvasSrc)) ok('网格间距会跟着缩放换算成屏幕像素');
  else bad('网格间距没有跟随缩放');
  // 吸附要在松手时做，拖动中做会有黏滞感
  if (/snapToGrid/.test(canvasSrc) && /snap\(node\.x, node\.y\)/.test(canvasSrc)) {
    ok('拖动吸附在松手时生效');
  } else {
    bad('缺少拖动吸附');
  }

  // --- 默认导出目录 ---
  if (/S\.get\('exportDir'\)/.test(uiSrc2) && /outDir: savedDir/.test(uiSrc2)) {
    ok('设了默认导出目录就直接导出，不再每次弹框');
  } else {
    bad('默认导出目录没有接进导出流程');
  }
}

// ---------------- 9. 第 15 轮：用户报的界面问题 ----------------
//
// 这一节全是「用户当面提出来的毛病」，逐条钉住，防止以后改回去。
console.log('\n=== 9. 第 15 轮修复项 ===');
{
  const canvasSrc2 = readFileSync(join(ROOT, 'src/frontend/js/canvas.js'), 'utf8');
  const inspectorSrc = readFileSync(join(ROOT, 'src/frontend/js/inspector.js'), 'utf8');
  const homeSrc2 = readFileSync(join(ROOT, 'src/frontend/js/home.js'), 'utf8');
  const css2 = css;

  // 1) 控件卡片不再有等级标签（用户要求全删）
  if (!/lc-level/.test(css2) && !/lc-level/.test(uiSrc)) {
    ok('控件卡片上的等级标签已彻底删掉（JS + CSS 都没有残留）');
  } else {
    bad('控件卡片还留着等级标签');
  }

  // 2) 节点卡片里不再有「代码提示行」
  if (!/k: '生成'/.test(canvasSrc2)) ok('节点卡片里的代码提示行已删掉');
  else bad('节点卡片还在显示代码提示行');

  // 3) 名字要能完整看到（悬停气泡）
  if (/class="lc-name" title="/.test(uiSrc) && /class="lc-code" title="/.test(uiSrc)) {
    ok('控件名字挂了 title（悬停能看到全名）');
  } else {
    bad('控件名字看不到全名（没有 title 气泡）');
  }

  // 4) 连不上：必须判红 + 说明原因
  if (/classList\.add\(ok \? 'ok' : 'bad'\)/.test(canvasSrc2)) {
    ok('拖线时按「能不能接」给绿/红反馈');
  } else {
    bad('拖线没有给能不能接的颜色反馈');
  }
  if (/\.cv-port\.bad[\s\S]{0,200}?--err/.test(css2) && /\.cv-port\.bad:hover/.test(css2)) {
    ok('连不上的圆圈是红的（悬停在圆点上也不会被蓝色盖掉）');
  } else {
    bad('连不上的圆圈会被 hover 的蓝色盖住');
  }
  if (/onConnectError/.test(canvasSrc2) && /showConnectError/.test(inspectorSrc)) {
    ok('连不上时右侧面板会写明原因（不只是飘一下的提示）');
  } else {
    bad('连不上时没有在面板里说明原因');
  }

  // 5) 联线要精准对准圆圈：端口坐标取自真实 DOM，不再靠估高
  if (/getBoundingClientRect\(\)/.test(canvasSrc2) && /portPos\(node, which, portId\)/.test(canvasSrc2)) {
    ok('端口坐标读真实 DOM 位置（联线两端精准落在圆圈中心）');
  } else {
    bad('端口坐标还是估算的，连线会对不准圆圈');
  }
  if (/snapTarget/.test(canvasSrc2)) ok('拖线时吸附到目标圆圈（松手即连到这里）');
  else bad('拖线没有吸附到圆圈');

  // 6) 首次进入要有示例插件组，而且是控件画布
  if (/maybeAddSamples/.test(uiSrc) && /scanScripts/.test(uiSrc)) {
    ok('首次进入会扫描 exe 旁边的 scripts\\ 摆出示例插件组');
  } else {
    bad('没有「首次进入显示示例插件组」');
  }
  if (/ktsimport/.test(uiSrc) && existsSync(join(ROOT, 'src/frontend/js/ktsimport.js'))) {
    ok('手写脚本会被翻成控件画布（不是只丢一段代码给用户看）');
  } else {
    bad('示例没有做成控件画布');
  }
  if (/builtinSamples/.test(readFileSync(join(ROOT, 'src/frontend/js/ktsimport.js'), 'utf8'))) {
    ok('没有 scripts 目录时用内置示例兜底');
  } else {
    bad('缺 scripts 目录时没有兜底示例');
  }

  // 7) 自动保存间隔按秒显示（详见 smoke 的 2d）
  if (/scale: 1000/.test(readFileSync(join(ROOT, 'src/frontend/js/settings.js'), 'utf8'))) {
    ok('自动保存间隔：内部存毫秒、界面显示秒');
  } else {
    bad('自动保存间隔没有按秒显示');
  }
  if (/data-scale/.test(readFileSync(join(ROOT, 'src/frontend/js/settingspage.js'), 'utf8'))) {
    ok('设置页读写时会按 scale 换算，不会把 0.4 秒存成 0.4 毫秒');
  } else {
    bad('设置页没有做秒/毫秒换算');
  }

  // 8) 首页新建插件组走弹窗（详见第 4 节的新断言）
  if (/newModuleFromHome[\s\S]{0,2000}?id="nmTpl"/.test(uiSrc)) {
    ok('新建插件组的弹窗里能选模板');
  } else {
    bad('新建插件组的弹窗不能选模板');
  }

  // 9) 致谢名单：按钮只有两个，且走系统浏览器
  if (/set-thanks-btn/.test(readFileSync(join(ROOT, 'src/frontend/js/settingspage.js'), 'utf8'))
      && /\.set-thanks-btn/.test(css2)) {
    ok('致谢名单的按钮有样式（不是裸按钮）');
  } else {
    bad('致谢名单的按钮没有样式');
  }
  if (/open_external/.test(readFileSync(join(ROOT, 'src/backend/src/main.rs'), 'utf8'))) {
    ok('致谢链接用系统浏览器打开（应用内不跳走）');
  } else {
    bad('致谢链接没有走系统浏览器');
  }

  // 10) F5 不能把界面搞跳走
  if (/e\.key === 'F5'/.test(uiSrc) && /safeReload/.test(uiSrc)) {
    ok('F5 被拦截，改成「先存档再安全重载」');
  } else {
    bad('F5 没拦，刷新会把界面打回首页');
  }
  if (/export function saveNow/.test(storeSrc)) ok('重载前会同步落盘（不等自动保存的定时器）');
  else bad('重载前没有同步落盘，改动会丢');

  // 「空间底下的代码」= 节点卡片里那行代码提示，确认行数上限仍然生效
  if (/slice\(0, 6\)/.test(canvasSrc2)) ok('节点卡片仍然限制显示行数（不会撑爆卡片）');
  else bad('节点卡片的行数上限没了');
}

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
