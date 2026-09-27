# KTS 插件工坊

> 拖控件 → 连线 → 导出 `.kts`。它只负责"写代码"：不执行、不加载、不编译、不热重载。

左侧按类别拖入控件，中间连线，右侧填参数；`代码预览` 看将要生成的 Kotlin，`导出插件` 得到可直接丢到服务器的 `.kts`。启动先进欢迎页（`新建工程`/`打开工程`/`套用模板`）。文档见 `docs/使用手册.md`、`docs/控件参考.md`、`docs/README.md`、`docs/dev/`。

**1. 怎么跑。** 免安装：根目录 `KTS-Plugin-Workshop.exe` 双击即用；安装包：`KTS-Plugin-Workshop_<version>_x64-setup.exe`（约 1.1 MB）。都不需要 Java 和 Node。exe 与安装包不入库（clone 只有 1 MB 多源码和文档），到 **GitHub Releases** 下载。构建：`powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1`（跑测试、`cargo build --offline --release`、校验内嵌前端、把 exe 复制到根目录），需要 Rust（含 MSVC 链接器）和 Node（仅测试）。exe 正开着时 Windows 不允许覆盖，旧文件会被改名成 `...exe.old` 再放新的，关掉工具重开才是新版。打安装包：在 `src\backend` 下 `cargo tauri bundle --bundles nsis`，产物在 `src\backend\target\release\bundle\nsis\`，需要 `tauri-cli`，首次运行会把 NSIS 下到 `%LOCALAPPDATA%\tauri\`；若卡在 `nsis-3.11.zip` / `timeout: global`，那是 curl/TLS 吊销检查问题，手动把该 zip 和 `nsis_tauri_utils.dll` 放进去即可（`curl.exe --ssl-no-revoke`）。

**2. 原理。** 一个画布 = 一个 `.kts`，控件是节点，连线表示"这段代码写在那对花括号里"。三趟生成：(1) 预扫描，记录每个节点真正用到的事件变量；(2) 生成，只为用到的变量写 `val player = it.player`；(3) 扫描正文，只补真正需要的 import（`Team`/`Color`/`Time` 不在默认导入里，而 `Fx` 被 `defaultImport = true` 覆盖，不加）。控件目录既是表单也是生成规则：`src/frontend/js/catalog/*.js` 里每个控件同时声明界面参数和参数如何变成代码，新增控件就是一个对象，界面和生成器自动认。前端是纯 HTML/CSS/JS 无构建步骤（`main.js` 入口、`crashguard.js` 崩溃兜底、`ui.js`、`canvas.js`、`inspector.js`、`store.js`、`generate.js` ★、`anchor.js`、`export.js`、`catalog/` ★）；后端 `src/backend/src/main.rs` 有 21 条 IPC 命令、原生文件对话框和关闭看门狗；`VERSION` 是版本唯一真源。

**3. 使用。** 左侧控件库按类别折叠，**每次启动全折叠**（不记忆），搜索时命中项平铺。画布：**拖**入控件（没有双击）；滚轮缩放 25%~250% 且以鼠标位置为中心；**空白处左键拖**平移（右键/中键/空格+拖也行）；拖节点标题栏移动；`Ctrl`+点多选；鼠标移到连线上点浮出的 **×** 删除（可 Ctrl+Z）；右键节点选 `断开所有连线`（右键**拖**仍是平移）。一个画布一个标签页，`×` 删除（只剩一个不能删），右键菜单可重命名/复制/删除。工具栏有 `代码预览`（暗色、可复制）、`从代码还原`、`怎么用`、`导出插件`（`Ctrl+Enter`）、`设置`、`模块管理`、`全屏`（`F11`/`Esc`，不记忆）；状态栏显示 `● 未保存 / ✓ 已保存`，与上次存 `.saproj` 比对；主题浅/深/跟随系统，但代码预览恒为暗色。设置分五页（画布与操作、外观与主题、导出与保存、日志、关于），改动立即生效、无确定取消；设了默认导出目录后 `导出插件` 直接写进去。

日志默认开启，写在 exe 旁 `logs\kts-builder-YYYY-MM-DD.txt`、按天分文件：错误与警告会写明模块、画布、控件；各按钮耗时与保存/导出/还原的内部耗时；崩溃记完整堆栈 + 当时工程规模（N 模块/画布/控件/连线）+ 崩溃前最后 40 个操作；启动与关闭信息。生成的 Kotlin 不记（长且可由画布+参数还原），操作轨迹平时只在内存、随崩溃一起落盘。可在设置里查看，或 `打开日志文件夹` / `复制全部`。任何未捕获错误会在右下角弹可读提示、写日志、给出日志路径，并提供 `关掉提示继续用` 和 `另存工程`，同一错误最多提示 3 次。一个**模块**导出成一个目录，含 `module.kts` 和该模块每个画布的脚本，`模块管理` 可查看和删除（可撤销；只剩一个不能删）。点右上角 X 或执行 `新建`/`打开`/`套用模板`/`新建模块`/`关闭画布`/`删除画布`/`删除模块` 时，只对**尚未存进 `.saproj` 文件**的改动告警（`取消`/`不保存`/`保存并继续`）——每次改动都自动存本地，所以关窗口本身不丢工作。关窗在 Rust 侧处理并配 2 秒看门狗，前端假死也能关掉。

**4. 控件库（76 个 = 基础 42 + 进阶 34）。** 事件 26（`每帧更新`、`玩家进服`、`玩家发言`、`单位死亡`、`波次开始`、`脚本启用时`…），动作 22（`发消息`、`生成单位`、`修改游戏规则`、`做一个服务器指令`、`长期存储（数据库）`、`到此为止（不再往下执行）`…），条件 3（`如果……就`，then/else 两个出口；`如果是管理员`；`不满足就跳过（提前退出）`），数据 6，循环 7，计时 1（`每隔 X 秒`），查询 5（`找出符合条件的单位`、`找最近的敌人`…），小工具 6（`取一个随机数`、`取游戏时间`、`往控制台写一行`…）。完整清单见 `docs/控件参考.md`。

**5. 生成的代码。**

```kotlin
@file:Depends("coreMindustry")

package demo

//@14 28 28
listen<EventType.PlayerJoin> {
    val player = it.player
//@2 bo 28 1
    player.sendMessage("欢迎 {player.name} 来到本服务器".with("player" to player), MsgType.Message, 10f)
}
```

**锚点** `//@<控件代码> <x> <y> [层级]` 是普通注释（不影响执行），用来把代码还原回画布。`catalog/codes.js` 的表**只能追加**：代码是下标，一重排老导出文件就会静默解析成别的控件；不在表里写成 `?fullKey`，`?` 加 1~3 字符限制使 `//@TODO ...` 不会被误判。坐标用 base36 整数（无损），0 层省略。这么做是为了注释体积——注释随代码发给用户，现格式把注释占比从约 40% 降到约 10%（示例工程 42.4% → 9.8%，最差文件 45.9% → 11.3%）。单控件画布达不到 10%（代码本身只 70~230 字节，平均 12.0%，最差 23.7%），这是已知下限。`module.kts` 一个注释都没有。只加真正需要的 import：`defaultImport = true` 已覆盖 `arc.Core`、`mindustry.Vars.*`、`mindustry.content.*`、`mindustry.gen.Player/Call/Groups`、`mindustry.game.EventType`、`coreMindustry.lib.*`（并继承 `coreLibrary` 的），所以 `EventType`、`Groups`、`Call`、`state`、`MsgType`、`UnitTypes`、`Items`、`StatusEffects`、`Dispatchers`、`config`、`PermissionApi`、`Savable`、`ClientOnly` 都不用，而 `Team`、`Color`、`Tile`、`UnitType`、`Item`、`Block` 必须显式导入。存盘数据用 `@Savable(false) var x = 0` 配 `customLoad(::x) { x = it }`（基本类型不能用 `val`），集合用 `val` 配 `customLoad(::x, x::addAll)`。**从代码还原**能恢复控件类型、位置、嵌套关系和 then/else 分支，但**不还原表单参数**（从未存进锚点）和**画布标题**（名字取自文件名），手写 `.kts` 没有锚点无从还原。1.1.0 及更早的 `// @sa:` 格式仍可还原（有回归测试），导入会重新分配节点 id。

**6. 导出结构。** `<所选目录>/demo/` 下有 `module.kts`（依赖声明）以及 `welcome.kts`、`alert.kts` 等。丢进服务器 `scripts/` 用 `/sa scan` 加载，SA 自动收集目录下所有 `.kts`，无需注册步骤。整个工作区只有 6 个 `module.kts`，都在模块根，所以本工具只在模块根写一个，不为每个目录各建一个；子脚本也不需要 `@file:Depends("自己的模块")`。

**7. 加新控件。** 在 `src/frontend/js/catalog/` 对应文件加一个对象，含 `key`、`category`、`level`、`label`、`terms`、`codeHint`、`inPorts`/`outPorts`、`props`（自动渲染的表单）和 `emit(n, ctx)` 返回 `{ lines: [...] }`；`ctx` 提供 `varOf`、`varOfType`、`lit`、`num`、`msgTemplate`。返回 `{ error: '...' }` 表示用户填错，会进问题列表。

**8. 测试。** `node tests/` 下有：`anchor.js`（★ 锚点格式、只增不改的代码表、注释占比 ≤10%）、`coverage.js`（76 控件 + 41 模式 + 花括号配平）、`smoke.js`、`ui-structure.js`、`css-vars.js`、`encoding.js`、`version-license.js`、`log-unit.js`、`sync-version.mjs [--check]`、`run.js [--write]`、`verify-api.js`（对真实 jar 核对 API）、`verify-embed.js`（exe 内嵌前端 == `src/frontend/`）、`live-ui.js`（★ CDP 驱动真实 exe）、`close-guard.js`（★ 真实 `WM_CLOSE`）、`dialog-freeze.js`（★ 文件对话框不卡窗口）、`log-file.js`（★ 真造错误读日志）、`probe.js`、`serve.js 8099`。`build.ps1` 编译前按序跑并遇错即停，且先对每个 `.js` 跑 `node --check`。要点：`codes.js` 只能追加，因为老导出文件存的是下标；`coverage.js` 遍历每个下拉值；`verify-api.js` 会核对 `Tile.x` 是 `short` 之类的成员，缺 jar/JDK 则跳过；`live-ui.js` 读真实 DOM 与计算样式（背景确实是浅色、控件库默认折叠、代码框暗色、拖放、缩放锚点、平移、全屏），并注入故障验证崩溃兜底按步骤隔离且不刷屏，运行时用临时副本和临时 WebView2 配置；`close-guard.js` 覆盖有改动、无改动、前端假死三种关闭；`dialog-freeze.js` 守着已修的"命令同步执行 + 对话框 owner 取自全系统 `GetForegroundWindow()`"这个卡死问题。

**9. 已知限制。** 不真编译（离线没有 `kotlin-compiler-embeddable`），只做结构校验，仍需在游戏里 `/sa scan` 验证。部分下拉项未验证：`给单位加状态` 的 `unmoving`/`electrified`/`disarmed`/`invincible` 和 `生成单位` 的 `mono`/`poly`/`mega`/`vela` 确实出现在工作区脚本里，其余是 Mindustry 原生内容，标注"未验证"。权限检查用不挂起的 `PermissionApi.check` 而非挂起的 `player.hasPermission`，代价是不触发 `RequestPermissionEvent`（事件体不挂起；指令体挂起，两种写法都行）。`//@` 锚点是本工具自创约定，所以"和真实脚本逐字比对"不能作为验收标准。单控件画布注释占比达不到 10%（平均 12.0%，最差 23.7%）。还原依赖本工具的锚点，且不还原表单参数与画布标题。无第三方依赖：手写 store 模式 ZIP，文件对话框经 windows-sys 直接调 COM `IFileDialog`。`build.ps1` 刻意保持纯 ASCII，因为 PowerShell 5.1 把无 BOM 的 `.ps1` 按 ANSI 解码。`live-ui.js` 伸不进原生文件对话框，拖连线的手感仍需人工判断。
