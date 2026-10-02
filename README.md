# KTS 插件工坊 v1.2.0

拖控件 → 连线 → 导出 `.kts`。只负责写代码：不执行、不加载、不编译、不热重载。

- 版本：**1.2.0**（上一版 1.1.0）
- 目标平台：ScriptAgent4MindustryExt **3.4.0**
- 产物：`KTS-Plugin-Workshop.exe` 3.31 MB（单文件、零 DLL 依赖）、`KTS-Plugin-Workshop_1.2.0_x64-setup.exe` 1.17 MB
- 文档：`docs/使用手册.md`、`docs/控件参考.md`、`docs/README.md`、`docs/dev/`

## 怎么跑

- 免安装：双击根目录 `KTS-Plugin-Workshop.exe`
- 安装包：`KTS-Plugin-Workshop_<version>_x64-setup.exe`
- 都不需要 Java 和 Node；exe 与安装包不入库，到 GitHub Releases 下载
- 构建：`powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1`（跑测试、`cargo build --offline --release`、校验内嵌前端、复制 exe 到根目录），需要 Rust 与 Node
- 打安装包：在 `src\backend` 下 `cargo tauri bundle --bundles nsis`，需要 `tauri-cli`

## 界面

| 区域 | 说明 |
|---|---|
| 首页 | 列出所有插件组及画布数 / 控件数 / 连线数，可新建 / 改名 / 删除，点一个进画布 |
| 左栏 | 控件库 300px，按分类折叠（每次启动全折叠），两列排布，搜索时平铺 |
| 中栏 | 画布：拖入控件、连线、滚轮缩放 25%~250%、空白处左键拖平移 |
| 右栏 | 插件文件管理器，列出本插件组的每个 `.kts`，可新建 / 改名 / 复制 / 删除 |
| 弹窗 | 双击控件弹出「控件设置」改参数，Esc / 遮罩 / 完成均可关闭 |
| 工具栏 | 代码预览、从代码还原、怎么用、导出插件（`Ctrl+Enter`）、设置、全屏（`F11`/`Esc`） |

## 原理

一个画布 = 一个 `.kts`，控件是节点，连线表示这段代码写在那对花括号里；三趟生成：预扫描事件变量、生成代码、扫描正文补 import。控件目录既是表单也是生成规则（`src/frontend/js/catalog/*.js`），新增控件就是一个对象。前端纯 HTML/CSS/JS 无构建步骤，后端 `src/backend/src/main.rs` 有 21 条 IPC 命令，`VERSION` 是版本唯一真源。

## 控件库

**84 个 = 基础 45 + 进阶 39，10 个分类。**

| 分类 | 数量 | 示例 |
|---|---|---|
| 事件 | 26 | 每帧更新、玩家进服、玩家发言、单位死亡、波次开始、脚本启用时 |
| 动作 | 22 | 发消息、生成单位、修改游戏规则、做一个服务器指令、长期存储（数据库） |
| 条件 | 3 | 如果……就、如果是管理员、不满足就跳过（提前退出） |
| 数据 | 6 | 改变一个值、记住一个值、做一个列表、操作对照表 |
| 循环 | 7 | 重复 N 次、对每个单位做、只要成立就一直重复 |
| 计时 | 1 | 每隔 X 秒 |
| 查询 | 5 | 找出符合条件的单位、找出范围内的方块、找最近的敌人 |
| 小工具 | 6 | 取一个随机数、取游戏时间、往控制台写一行 |
| **交互** | **4** | 弹一个菜单、玩家选了菜单项、关掉菜单、让玩家打开一个网址 |
| **服务器** | **4** | 停用这个插件自己、换一张地图、设置某个队伍的属性、注册一个显示变量 |

完整清单见 `docs/控件参考.md`。

## 生成的代码

```kotlin
@file:Depends("coreMindustry")

package demo

listen<EventType.PlayerJoin> {
    val player = it.player
    player.sendMessage("欢迎 {player.name} 来到本服务器".with("player" to player), MsgType.Message, 10f)
}


// kts-modular 生成
// 删除后无法恢复
// 锚点（详细，可以完全恢复）
//@kts 1.2.0
//@14 28 28
//@2 bo 28 1 | target=player&text=%E6%AC%A2%E8%BF%8E...
```

- 正文零注释零锚点；空两行后是固定三行注释区；最底部是识别标记 `//@kts 1.2.0` 与全部位置锚点
- 锚点 `//@<控件代码> <x> <y> [层级] [| 参数段]` 是普通注释，用来把代码还原回画布
- 参数段只记非默认值（URI 编码），导入时连同参数一起还原；v1（`// @sa:`）与 v2 老格式仍可识别导入
- 坐标用 base36 整数，0 层省略；`catalog/codes.js` 的表只能追加，不在表里写成 `?fullKey`
- `module.kts` 同样带三行固定注释 + 识别标记，无位置锚点
- 依赖按画布实际用量自动补进文件头，无需手动勾选

## 导出结构

`<所选目录>/demo/` 下有 `module.kts`（依赖声明）以及 `welcome.kts`、`alert.kts` 等。丢进服务器 `scripts/` 用 `/sa scan` 加载，SA 会自动收集目录下所有 `.kts`。

## 加新控件

在 `src/frontend/js/catalog/` 对应文件加一个对象，含 `key`、`category`、`level`、`label`、`terms`、`codeHint`、`inPorts`/`outPorts`、`props` 和 `emit(n, ctx)`；`ctx` 提供 `varOf`、`varOfType`、`lit`、`num`、`msgTemplate`。返回 `{ error: '...' }` 表示用户填错，会进问题列表。

## 测试

11 个离线套件 + 4 个真机套件，`build.ps1` 编译前按序跑并遇错即停。

| 层级 | 套件 |
|---|---|
| 离线 | `anchor.js`、`coverage.js`、`smoke.js`、`ui-structure.js`、`css-vars.js`、`encoding.js`、`version-license.js`、`log-unit.js`、`run.js`、`verify-api.js`、`team-fields.js` |
| 真机 | `live-ui.js`、`close-guard.js`、`dialog-freeze.js`、`log-file.js` |

## 已知限制

- 不真编译，只做结构校验，仍需在游戏里 `/sa scan` 验证
- 部分下拉项标注「未验证」（`slow`/`boss`/`mapped` + 11 个单位等）
- 锚点只写非默认参数，还原后看不出用户曾显式改成默认值
- 非本工具生成的 `.kts` 为保守近似还原，认不出的逻辑会少放控件
- 示例插件组只摆一次，删掉后不会再自动出现
- `//@` 锚点是本工具自创约定，不能与真实脚本逐字比对
- 无第三方依赖：手写 ZIP 存盘，文件对话框经 windows-sys 调 COM `IFileDialog`
- `build.ps1` 保持纯 ASCII，因为 PowerShell 5.1 把无 BOM 的 `.ps1` 按 ANSI 解码
- `live-ui.js` 伸不进原生文件对话框，拖连线手感仍需人工判断
