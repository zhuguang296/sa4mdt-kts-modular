> **开发 / 设计文档** —— 看代码、改代码才需要；**用这个工具不需要看它**。返回 [文档索引](../README.md)。
> 本文是开发期的 API 核对记录，属于历史研究笔记。文中引用的行号对应当时的文档与代码，**以现在的 `src/frontend/js/` 为准。**

# SA4MDT 生成器 API 核对报告

- 核对对象：`详细设计.md` §2/§5/§7/§11 中声称的 API，以及 `kts-builder/README.md` 的"零 import 即可"结论。
- 证据来源（只读，全离线）：`ScriptAgent4MindustryExt-3.4.0-scripts/`（166 个 `.kt`/`.kts`）。所有路径均相对该根目录。
- 说明：源码内中文注释在控制台读取时呈乱码（编码问题），因此引用行只保留 ASCII 代码部分。查无实据一律写 `未找到证据`。

---

## 1. `listen<T>{}` 与 `listen(EventType.Trigger.update){}`

**✅ 正确**

两族重载真实存在，且分工与生成器设计一致（`coreMindustry/lib/ListenExt.kt`）：

- `coreMindustry/lib/ListenExt.kt:86` — `inline fun <reified T : Any> Script.listen(insert: Boolean = false, noinline handler: (T) -> Unit)`（按 `T::class.java` 作为 key，接 `arc.Events`）
- `coreMindustry/lib/ListenExt.kt:92` — `fun <T : Any> Script.listen(v: T, insert: Boolean = false, handler: (T) -> Unit)`（按"事件对象本身"作为 key）
- `coreMindustry/lib/ListenExt.kt:87` — `listener.add(Listener(this, T::class.java, insert, handler))`
- `coreMindustry/lib/ListenExt.kt:93` — `listener.add(Listener(this, v, insert, handler))`
- `coreMindustry/lib/ListenExt.kt:79-83` — `@Deprecated("hidden", level = DeprecationLevel.HIDDEN) fun <T : Any> Script.listen(v: T, handler: (T) -> Unit)`（单参数旧重载已隐藏，不要再生成）
- 另有 `listenTo<T>` 用于 SA 自定义事件：`coreMindustry/lib/ListenExt.kt:62` — `listenTo<ScriptEnableEvent>(Event.Priority.After) {`

**关键事实：`EventType.Trigger.update` 是"值"，不是"类"，只能用非泛型形式。** 脚本树内 6 处 Trigger 监听全部用非泛型形式，0 处用 `listen<EventType.Trigger.update>`：

- `wayzer/reGrief/limitFire.kts:8` — `listen(EventType.Trigger.update) {`
- `wayzer/reGrief/limitLogicPacket.kts:59` — `listen(EventType.Trigger.update) {`
- `coreMindustry/variables.kts:107` — `listen(EventType.Trigger.update) {`
- `mapScript/tags/towerDefend.kts:97` — `listen(EventType.Trigger.update) {`
- `mapScript/tags/autoExchange.kts:74` — `listen(Trigger.update) {`（该文件 `:3` `import mindustry.game.EventType.Trigger`）
- `mapScript/14562.kts:70` — `listen(Trigger.update) {`（该文件 `:4` `import mindustry.game.EventType.Trigger`）

**真实存在的事件类（按树内出现次数，均为 `EventType.X` 且用泛型形式监听）：**

| 次数 | 事件 | 代表位置 |
|---|---|---|
| 14 | `EventType.ResetEvent` | `wayzer/reGrief/limitFire.kts:7` |
| 9 | `EventType.WorldLoadEvent` | `wayzer/map/pvpProtect.kts:21` |
| 8 | `EventType.PlayerLeave` | `wayzer/ext/welcomeMsg.kts:27` |
| 7 | `EventType.PlayerJoin` | `wayzer/ext/welcomeMsg.kts:21` |
| 5 | `EventType.BlockDestroyEvent` | `wayzer/map/betterTeam.kts:53` |
| 5 | `EventType.BlockBuildEndEvent` | `mapScript/tags/limitAir.kts:19` |
| 4 | `EventType.TapEvent` | `wayzer/reGrief/history.kts:138` |
| 3 | `EventType.TileChangeEvent` | — |
| 2 | `EventType.UnitCreateEvent` / `PlayerConnect` / `GameOverEvent` / `PlayerChatEvent` / `DataPatchLoadEvent` | `wayzer/user/ban.kts:28`、`wayzer/vote.kts:23`、`mapScript/module.kts:49` |
| 1 | `PayloadDropEvent`、`PickupEvent`、`DepositEvent`、`ConfigEvent`、`WaveEvent`、`MenuOptionChooseEvent`、`UnitUnloadEvent`、`UnitSpawnEvent`、`BlockBuildBeginEvent`、`UnitDestroyEvent`、`StateChangeEvent`、`ConnectPacketEvent`、`PlayEvent`、`WorldLoadEndEvent`、`CoreChangeEvent`、`TextInputEvent` | `coreMindustry/menu.kts:6`（`MenuOptionChooseEvent`）、`coreMindustry/util/textInput.kts:5`（`TextInputEvent`） |

非 `EventType` 的自定义事件（需各自 `import`，不属默认导入）：
- `wayzer/reGrief/limitLogicPacket.kts:8` — `import mindustryX.events.SendPacketEvent`
- `coreMindustry/util/textInput.kts:3` — `import mindustry.game.EventType.TextInputEvent`

> 生成器注意：设计文档 §5.1 的 12 个事件控件里，`event.Trigger.update` 生成 `listen(EventType.Trigger.update) {` 正确；其余 11 个生成 `listen<EventType.X> {` 正确。

---

## 2. `defaultImport = true` 是否让生成脚本可以省略"全部" import

**⚠️ 需修改**（大方向对，但"零 import"是错的；`kts-builder/README.md:146` 声称的 `Team`/`Color`/`Fx` 全部默认导入不成立或未找到证据）

### 2.1 真实默认导入链（有据可查）

`coreMindustry/module.kts:1-11`（原文）：

```
@file:Depends("coreLibrary")
@file:Import("arc.Core", libraryByClass = true)
@file:Import("mindustry.Vars", libraryByClass = true)
@file:Import("arc.Core", defaultImport = true)
@file:Import("mindustry.Vars.*", defaultImport = true)
@file:Import("mindustry.content.*", defaultImport = true)
@file:Import("mindustry.gen.Player", defaultImport = true)
@file:Import("mindustry.gen.Call", defaultImport = true)
@file:Import("mindustry.gen.Groups", defaultImport = true)
@file:Import("mindustry.game.EventType", defaultImport = true)
@file:Import("coreMindustry.lib.*", defaultImport = true)
```

同内容已固化在 `coreMindustry/.metadata:1-14`（`+IMPORT DefaultImport ...`），可机器校验。

`coreLibrary/module.kts:6-10`：

```
@file:Import("coreLibrary.lib.*", defaultImport = true)
@file:Import("coreLibrary.lib.event.*", defaultImport = true)
@file:Import("coreLibrary.lib.util.*", defaultImport = true)
@file:Import("-Xcontext-parameters", compileArg = true)
@file:Import("cf.wayzer.placehold.*", defaultImport = true)
```

目录级还会追加：`wayzer/module.kts:3` — `@file:Import("wayzer.lib.*", defaultImport = true)`；`mapScript/module.kts:4` — `@file:Import("mapScript.lib.*", defaultImport = true)`；`wayzer/.metadata` 里还多一条 `+IMPORT DefaultImport wayzer.user.ext.*`。

**逐符号结论**（判定方式：全树扫描"使用该符号但不 import"的 `.kts` 数 / "使用且 import"的 `.kts` 数）：

| 符号 | 结论 | 证据 |
|---|---|---|
| `EventType` | ✅ 默认导入覆盖 | 4 处 `listen<EventType.X>` 所在文件带了**成员级** import（`wayzer/reGrief/bugFixer.kts:6` — `import mindustry.game.EventType.ResetEvent`、`coreMindustry/util/textInput.kts:3` — `import mindustry.game.EventType.TextInputEvent`），但都是冗余的；其余全部裸用 `EventType.X` 且无 import（`wayzer/ext/welcomeMsg.kts:21`、`wayzer/map/pvpProtect.kts:21`、`coreMindustry/scoreboard.kts` 等） |
| `Groups` | ✅ 覆盖 | 27 个 `.kts` 裸用 `Groups`，0 个 import（`coreMindustry/scoreboard.kts:51`） |
| `MsgType` | ✅ 覆盖（`coreMindustry.lib`） | 11 个裸用，0 import（`wayzer/ext/welcomeMsg.kts:10`） |
| `UnitTypes` | ✅ 覆盖（`mindustry.content.*`） | 7 个裸用，0 import（`mapScript/1001.kts:90`） |
| `Items` | ✅ 覆盖（`mindustry.content.*`） | 7 个裸用，0 import（`mapScript/1004.kts:90`） |
| `StatusEffects` | ✅ 覆盖（`mindustry.content.*`） | `wayzer/map/pvpProtect.kts:42` 裸用，该文件无 StatusEffects import |
| `state` | ✅ 覆盖（`mindustry.Vars.*`） | 全树裸用，0 import |
| `Call` | ✅ 覆盖（`mindustry.gen.Call`） | 全树裸用，0 import（`mapScript/tags/limitAir.kts:21`） |
| `Dispatchers` | ✅ 覆盖（框架级 `kotlinx.coroutines.*`） | 32 个 `.kts` 裸用 `Dispatchers`，0 个 `import kotlinx`；`wayzer/ext/autoUpdate.kts:23` 裸用 `runInterruptible(Dispatchers.IO)`，`:30` 裸用 `isActive` |
| `launch` / `delay` | ✅ 覆盖（同上，`Script` 自身是 `CoroutineScope`） | `wayzer/user/ban.kts:29` — `launch(Dispatchers.IO) {` |
| `loop` | ✅ 覆盖（`coreLibrary.lib.util.*`） | `coreLibrary/lib/util/coroutine.kt:13` — `fun Script.loop(context: CoroutineContext = EmptyCoroutineContext, block: suspend CoroutineScope.() -> Unit)`；调用处 `mapScript/tags/limitAir.kts:3` — `import coreLibrary.lib.util.loop`（显式重复导入，亦证明其包路径） |
| `command/CommandInfo/Commands/requirePermission` | ✅ 覆盖（`coreLibrary.lib.*`） | `coreLibrary/lib/CommandApi.kt:421` |
| `config` | ✅ 覆盖（`coreLibrary.lib.*`） | `coreLibrary/lib/ConfigApi.kt:229` — `val Script.config get() = ConfigBuilder(id.replace('/', '.'), this)` |
| `with/VarString/PlaceHoldString` | ✅ 覆盖（`coreLibrary.lib` + `cf.wayzer.placehold.*`） | `coreLibrary/lib/PlaceHoldApi.kt:22-26` typealias |
| `ClientOnly` / `NotForClient` | ✅ 覆盖（`coreMindustry.lib`） | 定义 `coreMindustry/lib/CommandImpl.kt:176,180`；5 个裸用文件（`coreMindustry/scoreboard.kts:31`） |
| `CommandType` | ✅ 覆盖（`coreMindustry.lib`） | 定义 `coreMindustry/lib/CommandImpl.kt:155` |
| `PermissionApi` | ✅ 覆盖（`coreLibrary.lib`） | 14 个裸用，0 import（`wayzer/reGrief/history.kts:37`） |
| `Savable` / `customLoad` / `autoInit` / `export` / `Services` | ✅ 可用但有保留：**定义不在本树内**（框架 SA 提供），用法有据 | `autoInit` 3 处裸用（`wayzer/user/lang.kts:11`）；`customLoad` 5 处；`@Savable` 7 处；`export` 6 处；`Services` 8 处裸用（`wayzer/user/lang.kts:12`）。但 `wayzer/user/ban.kts:5` — `import cf.wayzer.scriptAgent.util.Services` 说明其来源包为 `cf.wayzer.scriptAgent.util`。`Savable`/`customLoad` 的**声明位置未找到证据** |
| **`Team`** | ❌ **不覆盖，必须 import** | 18 个使用 `Team` 的 `.kts` **全部**显式 import；裸用 0 个。例：`wayzer/map/betterTeam.kts:7` — `import mindustry.game.Team`；`mapScript/1001.kts:11` 同。`wayzer/cmds/vote.kts`、`wayzer/pvp/pvpAlert.kts` 同 |
| **`Color`** | ❌ **不覆盖，必须 import** | 3 个使用 `Color` 的 `.kts` 全部 import（`wayzer/cmds/helpfulCmd.kts:3`、`wayzer/cmds/pixelPicture.kts:3`、`wayzer/reGrief/history.kts:3` 均为 `import arc.graphics.Color`） |
| **`Fx`** | ⚠️ **机制未找到证据** | 2 处使用均**未** import（`wayzer/reGrief/history.kts:142` — `Call.effect(p.con, Fx.placeBlock, ...)`；`wayzer/cmds/helpfulCmd.kts:23` — `Fx::class.java.fields`），但 10 条 DefaultImport 中没有 `mindustry.entities.*`。生成 `Fx.x` 与工作区惯例一致，但无法从本树证明其来源 |
| **`Packets`** | ❌ 需 import | 3/3 使用处均 import（`wayzer/cmds/restart.kts:6` — `import mindustry.net.Packets`） |
| **`Tile`** | ❌ 需 import | 3/3 import（`wayzer/cmds/gatherTp.kts:8` — `import mindustry.world.Tile`） |
| **`UnitType`/`Item`/`Block`/`Gamemode`/`ItemStack`/`Duration`/`Administration`** | ❌ 需 import | `wayzer/reGrief/history.kts:5-6`（`Item`/`Block`）、`wayzer/map/pvpProtect.kts:5,7`（`Gamemode`、`java.time.Duration`）、`wayzer/ext/welcomeMsg.kts:4`（`Administration`） |
| **`KVStore`** | ❌ 需 `@file:Depends` + import | `wayzer/user/lang.kts:2,6` — `@file:Depends("coreLibrary/extApi/KVStore", ...)` + `import coreLib.extApi.KVStore`（注意包名是 **`coreLib.extApi`**，不是 `coreLibrary.extApi`） |
| **`StringDataType`** | ❌ 需 import | 2/2 import（`wayzer/user/lang.kts:7`、`wayzer/store/whileListCache.kts:9` — `import org.h2.mvstore.type.StringDataType`） |

### 2.2 必须修改的地方

`kts-builder/README.md:146` 的清单里 **`Team`、`Color`、`Fx` 三项错误或未证实**。建议生成器策略改为：

- 只生成 `@file:Depends("coreMindustry")`（+ 模块自身依赖），**不写** `import`；
- 一旦节点用到大写 `Team`（如 `UnitTypes.dagger.spawn(state.rules.waveTeam, ...)` 不需要 Team 字面量，但 `Team.sharded` 需要）、`Color.xxx`、`Packets.xxx`、`Items.xxx` 之外的 `Tile`/`Gamemode` 等类型名，**按需追加显式 import**；
- 最稳的做法：模板里凡是出现类型名（非 `mindustry.content`/`mindustry.gen`/`mindustry.Vars`/`EventType` 的成员），一律显式 import——树内大量"冗余 import"（如 `mapScript/tags/TDDrop.kts:3-4` 已默认导入仍写 `import mindustry.content.Items.*`）证明显式 import 不会出错。

---

## 3. `command(name, description){}` DSL

**✅ 正确**（签名、别名、attr、权限、body、接收者、`player` 可空性全部与真实 API 一致）

- `coreLibrary/lib/CommandApi.kt:420-431`：
  ```
  @ScriptDsl
  inline fun Script.command(
      name: String,
      description: VarString,
      commands: Commands = Commands.Root,
      init: CommandInfo.() -> Unit
  )
  ```
- `coreLibrary/lib/CommandApi.kt:433-436`：`inline fun Script.command(name: String, description: String, init: CommandInfo.() -> Unit) { command(name, description.with()) { init() } }` → **`command("名字","中文说明")` 双 String 形式合法**
- `aliases`：`coreLibrary/lib/CommandApi.kt:106` — `var aliases: List<String> = emptyList()`（`var`，可赋值）；真实用例 `coreMindustry/scoreboard.kts:30` — `aliases = listOf("broad", "scoreboard")`
- `attr(ClientOnly)`：`coreLibrary/lib/CommandApi.kt:138-142` — `@CommandBuilder fun attr(beforeBody: CommandHandler)`；`ClientOnly` 定义 `coreMindustry/lib/CommandImpl.kt:176` — `data object ClientOnly : Commands.Hidden`；真实用例 `coreMindustry/scoreboard.kts:31` — `attr(ClientOnly)`
- `requirePermission(x)`：`coreLibrary/lib/CommandApi.kt:438-441` — `@CommandInfo.CommandBuilder fun CommandInfo.requirePermission(permission: String) { attr(Commands.Permission(permission)) }`
- `body {}`：`coreLibrary/lib/CommandApi.kt:163-168` — `fun body(body: CommandHandler)`；`coreLibrary/lib/CommandApi.kt:86-91` — `fun interface CommandHandler { fun CommandContext.canHandle() = context is CommandContext.Command; suspend fun CommandContext.handle() }` → **body 内接收者是 `CommandContext`**，且在 `Dispatchers.game` 上执行（`coreMindustry/lib/CommandImpl.kt:85` — `withContext(Dispatchers.game)`）
- `body` 必须在 `attr` 之后（`coreLibrary/lib/CommandApi.kt:140` — `if (frozen) error("This command is already frozen, you must add attr before body")`，`:165-167` 的 `freeze()`）。**生成器必须保证 `attr(...)`/`requirePermission(...)` 出现在 `body { }` 之前**
- 裸 `player`：`coreMindustry/lib/CommandImpl.kt:187-188` — `val CommandContext.player get() = (receiver as? PlayerCommandReceiver)?.player` → **类型是 `Player?`，控制台下为 null**；`coreMindustry/lib/CommandImpl.kt:190-191` — `fun CommandContext.reply(text: VarString, type: MsgType = MsgType.Message, time: Float = 10f)`
- 真实完整样例：`wayzer/user/lang.kts:31-39`（`requirePermission` + `attr(ClientOnly)` + `body { ... }`）、`coreMindustry/scoreboard.kts:29-37`

**建议修正（非错误，但在校验规则里应升级为 error）：**
- `coreMindustry/lib/CommandImpl.kt:168-174` — `@Deprecated("use CommandAttr") var CommandInfo.type: CommandType`，setter 里才转成 `attr(ClientOnly)/attr(NotForClient)`；`coreLibrary/lib/CommandApi.kt:121-122` — `@Deprecated("use requirePermission(permission)") var permission: String`。生成器应继续用 `attr(ClientOnly)` / `requirePermission(...)`（设计文档 §5.2 已如此），不要生成 `type = CommandType.Client` / `permission = "..."`。
- 用 `player` 前必须先判空：树内两种写法均有（`player!!` 见 `coreMindustry/scoreboard.kts:33`；`val player = player ?: returnReply(...)` 见 `README.md:677`）。设计文档 §5.2 "勾选仅玩家可用时生成 `player!!`" 与 `attr(ClientOnly)` 组合是安全的；未勾选时必须生成 `player?.let { }`。

---

## 4. `broadcast(...)` 与 `Player.sendMessage(...)`

**✅ 正确**

`coreMindustry/lib/ContentHelper.kt:38-44`（原文参数表）：

```
fun broadcast(
    text: PlaceHoldString,
    type: MsgType = MsgType.Message,
    time: Float = 10f,
    quite: Boolean = false,
    players: Iterable<Player> = Groups.player
)
```

- 第 1 个形参是 `PlaceHoldString`（= `VarString`），**不是 `String`** → 生成裸 `"文本"` 实参时会被 `:76-78` 的 `@Deprecated` `String` 重载接住（`Player?.sendMessage(text: String, ...)` 存在，但 `broadcast` 没有 String 重载）→ **`broadcast` 必须写成 `"...".with()` 或 `"...".asPlaceHoldString()`**。树内所有单行 `broadcast("...")` 均带 `.with()`（`wayzer/reGrief/limitFire.kts:12` — `broadcast("[yellow]...".with())`）
- 第 4 个形参名是 **`quite`**（框架内拼写，不是 `quiet`）：真实具名调用 `wayzer/reGrief/unitLimit.kts:19` — `broadcast(text, MsgType.InfoToast, 4f, true, e.unit.team.data().players)`、`wayzer/ext/observer.kts:48` — `.with("player" to player), type = MsgType.InfoToast, quite = true`
- `Player?.sendMessage`：`coreMindustry/lib/ContentHelper.kt:54` — `fun Player?.sendMessage(text: PlaceHoldString, type: MsgType = MsgType.Message, time: Float = 10f)`；接收者**可空**，null 时打控制台（`:55`）。真实具名调用 `wayzer/ext/welcomeMsg.kts:22` — `it.player.sendMessage(template.with(), type)`
- `MsgType`：`coreMindustry/lib/ContentHelper.kt:36` — `enum class MsgType { Message, InfoMessage, InfoToast, WarningToast, Announce }` → **`MsgType.Message` 与 `MsgType.InfoMessage` 都存在**；映射见 `:60-66`（Message→`Call.sendMessage`，InfoMessage→`Call.infoMessage`，InfoToast→`Call.infoToast`，WarningToast→`Call.warningToast`，Announce→`Call.announce`）
- 注意 `broadcast` 内部已 `MindustryDispatcher.runInMain { }`（`:46`），在任意线程调用都安全。

---

## 5. `"...".with("k" to v)`

**✅ 正确**（vararg `Pair`；`.with()` 空参合法且是工作区惯例）

- `coreLibrary/lib/PlaceHoldApi.kt:116-120`：`fun String.with(vararg arg: Pair<String, Any>): VarString`
- `coreLibrary/lib/PlaceHoldApi.kt:122-123`：`fun VarString.with(vararg arg: Pair<String, Any>): VarString = "".with(*arg).createChild(text, vars)`（**`VarString` 上也有同名重载**，所以对已 `with` 过的字符串可再次 `with`，生成器不必担心类型）
- `coreLibrary/lib/PlaceHoldApi.kt:126`：`fun String.asPlaceHoldString() = "{text}".with("text" to this)`
- `vararg` ⇒ **`.with()` 无参合法**；全树出现 121 处 `.with()`（`wayzer/reGrief/limitFire.kts:12`、`coreMindustry/scoreboard.kts:35` — `reply("[green]...".with())`），设计文档 §7.3 "无 `{}` 也生成 `.with()`" 与树一致。
- 生成样例里的 `"欢迎 {player.name} 来到服务器".with("player" to player)` 形状正确（对照 `README.md:649` — `broadcast("[green]{player.name} 加入了游戏".with("player" to it.player))`）。

---

## 6. `@Savable` + `customLoad`

**⚠️ 需修改**（注解名与两种写法正确；但"注解/函数声明"在本树内查无实据，且样例 `@Savable(false) val counter = 0` 与树内所有用法形状不符，落盘后无法恢复）

**注解名与参数（用法有据，声明未找到证据）：**
- 位置参数简写：`mapScript/tags/mapRule.kts:11` — `@Savable(false)`；`wayzer/cmds/voteOb.kts:15`、`wayzer/map/mapInfo.kts:3`、`wayzer/user/ext/whiteList.kts:17` 同
- 具名参数：`wayzer/user/nameExt.kts:6` — `@Savable(serializable = false)`；`wayzer/ext/observer.kts:15` 同
- 无参形式：`wayzer/user/suffix.kts:22` — `@Savable`（下一行 `val clientType = mutableMapOf<String, Char>()`）
- **`annotation class Savable` 的声明在本树内 `未找到证据`**（全树 `annotation class` 只找到 `coreLibrary/lib/CommandApi.kt:234` 的 `CommandBuilder` 与菜单的 `MenuBuilderDsl`）。同理 `customLoad`/`autoInit` 的声明也不在本树（属 SA 框架；`wayzer/user/ban.kts:5` 的 `import cf.wayzer.scriptAgent.util.Services` 说明框架 API 在 `cf.wayzer.scriptAgent.*` 下，而 `ScriptExtKt.customLoad(Script, KProperty, Function1)` 的签名仅见于 `详细设计.md:120` 的常量池摘录，本树无法复核）

**`customLoad` 两种真实形式（均存在）：**
- 单参 + lambda：`wayzer/user/suffix.kts:24` — `customLoad(::clientType) { clientType.putAll(it) }`；`wayzer/user/nameExt.kts:8` — `customLoad(::realName) { realName.putAll(it) }`；`wayzer/cmds/voteOb.kts:17` 同；`wayzer/ext/observer.kts:17-19` — `customLoad(::obTeam) { obTeam.putAll(it.filterKeys { p -> p.con != null }) }`
- 双参（KProperty + setter 引用）：`wayzer/map/mapInfo.kts:5` — `customLoad(::customModeIntroduce, customModeIntroduce::addAll)`

**样例 `@Savable(false) val counter = 0` 的问题：**
- 树内 7 处 `@Savable` 目标**全是 `val` + 可变集合**（`mutableMapOf`/`mutableListOf`）**或 `var`**：
  - `val` + 集合 + `customLoad`：`wayzer/user/suffix.kts:22-24`、`wayzer/user/nameExt.kts:6-8`、`wayzer/ext/observer.kts:15-19`、`wayzer/cmds/voteOb.kts:15-17`、`wayzer/map/mapInfo.kts:3-5`
  - `var` + 无 `customLoad`：`mapScript/tags/mapRule.kts:11-12` — `@Savable(false)` / `var permissions: List<String> = emptyList()`；`wayzer/user/ext/whiteList.kts:17-18` — `@Savable(false)` / `var serverId = UUID.randomUUID().toString()`
- `val counter = 0`（`Int`）既不能 `putAll` 也不能赋值，`customLoad(::counter) { ... }` 无法把读回的值写进 `val`；**没有任何证据表明框架能靠反射 set 一个 `val` 字段**。
- 修正形式（与树内形状一致）：
  - 要"存盘且能改"：`@Savable var counter = 0` + `customLoad(::counter) { counter = it }`
  - 只要标记不落盘：`@Savable(false) var counter = 0`（对应 `mapScript/tags/mapRule.kts:11-12` 的既有用法）
  - 设计文档 §5.2 第 344 行写的 `@Savable var x = 0` + `customLoad(::x) { x = it }` 是正确的，但 §5.2 的 `action.savable` 若对 `Int/Long/String/Boolean` 生成 `val`，必须改成 `var`。§5.2 第 349 行的 `MutableMap` 生成 `customLoad(::x) { x.putAll(it) }` 与 `wayzer/user/nameExt.kts:8` 完全一致 ✅。

---

## 7. `config.key(default, vararg desc)` 与裸 `config`

**✅ 正确**

- `coreLibrary/lib/ConfigApi.kt:229` — `val Script.config get() = ConfigBuilder(id.replace('/', '.'), this)` → **接收者是 `Script` 的扩展属性**，`.kts` 顶层的隐式 Script 接收者让裸 `config` 可用
- `coreLibrary/lib/ConfigApi.kt:228` — `val globalConfig = ConfigBuilder("global", null)`
- `coreLibrary/lib/ConfigApi.kt:152-153` — `inline fun <reified T : Any> key(default: T, vararg desc: String) = KeyProvider(ClassContainer<T>(), default, desc)` → **`val x by config.key(默认值, "说明")` 形式正确**，路径 = `脚本id` 的 `/` 换成 `.`
- `coreLibrary/lib/ConfigApi.kt:159-167` — 带回调重载 `key(name: String, default: T, vararg desc: String, noinline onChange: (T) -> Unit)`
- 文档样例 `coreLibrary/lib/ConfigApi.kt:148-150` — `val port by config.key(8080,"示例配置项")`
- 真实用例（含 vararg 多段说明）：`wayzer/reGrief/limitFire.kts:3` — `val limit by config.key(500, "...")`；`coreMindustry/scoreboard.kts:15-19`（3 段 desc）；`wayzer/ext/autoUpdate.kts:19` — `val onlyInNight by config.key(false, "...", "...")`
- 样例 `val amount by config.key(1, "服务器管理员可以用 /sa config 修改")` ✅ 正确（`/sa config` 命令实存于 `coreLibrary/commands/configCmd.kts:6`）

---

## 8. `loop(Dispatchers.game){}` 与 `launch(Dispatchers.game){}`

**✅ 正确**

- `loop`：`coreLibrary/lib/util/coroutine.kt:13` — `fun Script.loop(context: CoroutineContext = EmptyCoroutineContext, block: suspend CoroutineScope.() -> Unit)`；内部 `while (true)` + 吞异常 + `delay(10000)` 后重试（`:15-23`）。真实调用 8 处：`mapScript/tags/limitAir.kts:8`、`coreMindustry/scoreboard.kts:49`、`wayzer/map/pvpProtect.kts:24`、`wayzer/reGrief/autoChangeMap.kts:14`、`wayzer/user/nameExt.kts:45`、`mapScript/1004.kts:98`、`mapScript/1005.kts:103`、`mapScript/13545.kts:60`
- 调度器名：`coreMindustry/lib/DispatcherExt.kt:116-117` — `val Dispatchers.game get() = MindustryDispatcher`；`:120-121` — `val Dispatchers.gamePost get() = MindustryDispatcher.Post`（`Dispatchers.gamePost` 真实用例 `mapScript/shared/hexed.kts:13`）。**名称为 `game` / `gamePost`，无 `MindustryDispatcher` 直呼的必要**（`mapScript/module.kts:19` 有 `MindustryDispatcher.safeBlocking { }` 的直用）
- `launch(Dispatchers.game) { }`：真实调用 14+ 处，如 `wayzer/maps.kts:96`、`wayzer/ext/alert.kts:18`、`wayzer/pvp/autoGameover.kts:35`、`mapScript/13545.kts:51`、`wayzer/map/pvpProtect.kts:47`；`withContext(Dispatchers.game)` 见 `wayzer/user/ban.kts:31`
- `delay(3000L)` / `delay(30_000L)` 形状：`wayzer/map/pvpProtect.kts:55` — `delay(60_000)`、`wayzer/cmds/vote.kts:52` — `delay(1000L)`、`mapScript/tags/limitAir.kts:9` — `delay(3_000)`
- 额外：`coreMindustry/lib/DispatcherExt.kt:124` — `suspend fun nextTick()`；`mapScript/lib/util.kt:39-49` — `fun CoroutineScope.schedule(time: Duration, ...)`（仅 `mapScript` 模块默认导入，见 `mapScript/module.kts:4`）

---

## 9. 逐条 API 核对

| 生成样例 | 判定 | 证据（file:line + 原文关键片段） |
|---|---|---|
| `Groups.unit.filter { it.team == state.rules.waveTeam && it.health > 0 }` | ✅ | `wayzer/reGrief/unitLimit.kts:28` — `val m = Groups.unit.filter { it.team == e.unit.team && it.maxHealth < 1000f && !it.isPlayer }`；`it.health` 见 `wayzer/reGrief/autoChangeMap.kts:16` — `it.unit().health > 0`；`state.rules.waveTeam` 见 `wayzer/reGrief/unitLimit.kts:15`。注意 `Unit.team` 是**属性**（非 `team()`），`Player.team()` 才是方法（`wayzer/map/betterTeam.kts:50`） |
| `Groups.unit.forEach { unit -> ... }` | ✅ | `mapScript/tags/limitAir.kts:10` — `Groups.unit.forEach {`；带显式参数名的同族写法 `mapScript/1004.kts:108` — `Groups.player.forEach { p ->`、`mapScript/1002.kts:39` — `generator.chunkCenters.forEach { chunk ->`；`Groups.unit.filter{}.forEach(Unit::kill)` 见 `wayzer/reGrief/unitLimit.kts:55` |
| `unit.apply(StatusEffects.slow, 5f * 60f)` | ⚠️ 形状正确，**`slow` 未找到证据** | 形状：`wayzer/map/pvpProtect.kts:42` — `it.apply(StatusEffects.unmoving, (leftTime - 60) * 60f)`；`mapScript/13545.menu.kt:108-109,143` — `apply(StatusEffects.electrified, ...)` / `disarmed` / `invincible`。树内出现过的常量仅 `unmoving`/`electrified`/`disarmed`/`invincible`，**无 `slow`**。`slow` 的真实性无法离线证明（`未找到证据`）；生成器若把 `slow` 放进下拉框，应保留"未在本工作区验证"的标注，或改用已验证的 4 个常量 |
| `UnitTypes.dagger.spawn(state.rules.waveTeam, 10f, 20f)` | ⚠️ 形状正确，**`dagger` 未找到证据** | 形状：`mapScript/1001.kts:90` — `UnitTypes.mono.spawn(controller, x * tileSize, y * tileSize).apply {`，其中 `controller` 是 `Team`（`mapScript/shared/hexed.HexData.kt:35` — `var controller: Team = Team.derelict`）⇒ **`UnitType.spawn(Team, Float, Float)` 成立**。树内用过的单位仅 `mono`/`mega`/`poly`/`vela`（`mapScript/1002.kts:74`），**`dagger` 未找到证据** |
| `team.data().core()?.items?.add(Items.copper, 100)` | ✅ | `mapScript/1004.kts:89-90` — `controller.core()?.items?.apply {` / `add(Items.copper, seconds * 6)`；`mapScript/tags/autoExchange.kts:60` — `val items = team.data().core()?.items ?: return`；`wayzer/cmds/spawnMob.kts:32` — `team.data().core()?.let {`。`TeamData.core()` 返回**可空**，必须 `?.` |
| `player.kick("测试", 0)` | ✅ | `wayzer/user/ban.kts:16-25` — `kick("""...""".trimIndent(), 0)` ⇒ `kick(String, Int)`；单参形式 `wayzer/module.kts:56` — `con.kick("[red]...")`；枚举形式 `wayzer/cmds/restart.kts:35` — `it.kick(Packets.KickReason.serverRestarting)` |
| `player.team(team)` / `Player.team()` | ✅ | setter：`wayzer/map/betterTeam.kts:99` — `p.team(team)`；getter：`wayzer/map/betterTeam.kts:50` — `it.player.team()`；另 `mapScript/999.kts:162` — `player.team(Team.sharded)` |
| `Call.label(text, time, x, y)` | ✅ | `mapScript/tags/limitAir.kts:21` — `Call.label("[yellow]...", 60f, it.tile.getX(), it.tile.getY())`；`mapScript/tags/TDDrop.kts:138` — `Call.label(msg, drop.size * 0.3f, unit.x + ..., unit.y + ...)`。带玩家定向的重载：`wayzer/map/mapInfo.kts:49` — `Call.label(con, msg, 2 * 60f, core()?.x ?: 0f, core()?.y ?: 0f)`；`wayzer/reGrief/history.kts:99-102,105-111` |
| `Call.effect(fx, x, y, rotation, color)` | ✅ | `wayzer/cmds/helpfulCmd.kts:37` — `Call.effect(type, player!!.x, player!!.y, arg1, arg2)`（`arg1: Float`、`arg2: Color`，`:33-34`）；定向重载 `:38` — `Call.effect(player!!.con, type, player!!.x, player!!.y, arg1, arg2)`；`wayzer/reGrief/history.kts:142` — `Call.effect(p.con, Fx.placeBlock, it.tile.worldx(), it.tile.worldy(), 0.5f, Color.green)`。**`Color` 需显式 import**（`history.kts:3`） |
| `state.rules.*`（含 `state.rules.fire = false`） | ✅ | `wayzer/reGrief/limitFire.kts:9-11` — `if (state.rules.fire && fireCount > limit) {` / `state.rules.fire = false`；其它：`state.rules.pvp`（`wayzer/pvp/pvpAlert.kts:43`）、`state.rules.waveTeam`（`mapScript/tags/TDDrop.kts:147`）、`state.rules.loadout`（`mapScript/1001.kts:96`）、`state.rules.tags`（`mapScript/module.kts:32`）、`state.rules.mode()`（`wayzer/map/pvpProtect.kts:23`） |
| `Tile.worldx()` / `worldy()` | ✅ | `wayzer/cmds/gatherTp.kts:59` — `Units.count(tile.worldx(), tile.worldy(), unit.physicSize())`；`wayzer/reGrief/history.kts:141-142`。注意与地形坐标 `tile.getX()/getY()`（`mapScript/tags/limitAir.kts:21`）是两套 API |

---

## 10. `package demo` + `demo/module.kts` 的包/模块方案

**⚠️ 需修改**（包名规则与自动收集正确；"每个目录都有 module.kts"与"锚点注释"两点与真实仓库不符）

**包名规则 ✅ 有据**：
- 包名 = 目录路径按 `.` 连接，且**出现在 `@file:` 注解之后**是合法的：
  - `mapScript/tags/limitAir.kts:1,3` — `package mapScript.tags`；`metadata` 的 `FQ_NAME mapScript.tags.LimitAir`（`mapScript/.metadata:72-74`）
  - `wayzer/user/ext/whiteList.kts:3` — `package wayzer.user.ext`；`FQ_NAME wayzer.user.ext.WhiteList`
  - `mapScript/module.kts:1-10` — 四条 `@file:` 注解在 `package mapScript` **之前**，仍正常（Kotlin 允许）
  - `wayzer/user/ext/skills.kts:1-3` — `@file:Import("wayzer.user.ext.*", defaultImport = true)` 之后才是 `package wayzer.user.ext`
- 数字文件名可用（`mapScript/1001.kts` → `FQ_NAME mapScript._1001`，`mapScript/.metadata:8-9`），说明生成器对文件名/类名做了净化；`demo/welcome.kts` 这类命名无风险。

**模块目录 ✅ 有据，但不是"每个目录一个 module.kts"**：
- 全树**只有 6 个 `module.kts`**：`coreLibrary/module.kts`、`coreLibrary/db/module.kts`、`coreMindustry/module.kts`、`mapScript/module.kts`、`wayzer/module.kts`、`wayzer/store/module.kts`
- 模块的判定按 `+DEPENDS <dir> module` 与"目录前缀"自动生成：`coreLibrary/commands/helpful.kts:28` — `ScriptRegistry.allScripts { it.id == module || it.id.startsWith("$module/") }`；`:14-17` 用 `Config.rootDir.walkTopDown().filter { it.name == ".metadata" }` 找模块
- **`demo/module.kts` 里写 `@file:Depends("coreMindustry")` 正确**（对照 `wayzer/module.kts:1`、`mapScript/module.kts:1`，且 `README.md:659-663` 给出同样范式）
- **子脚本无需声明 `@file:Depends("demo")`**：真实反例 `wayzer/cmds/clearUnit.kts:1-2` 只有 `package wayzer.cmds`，却裸用 `broadcast(...)`/`.with()`（来自 coreMindustry↔coreLibrary 链）；`wayzer/user/lang.kts` 只声明了无关的 `coreLibrary/lang`、`coreLibrary/extApi/KVStore`，同样裸用 `Services`/`config`。若生成器额外加 `@file:Depends("demo")` 也不报错（`mapScript/.metadata` 里确实有 `+DEPENDS mapScript module`，是自动生成的），但非必需。

**自动收集 ✅ 有据**：
- `bootStrap/default.kts:8-15` — `enable(ScriptRegistry.allScripts())` / `exclude("@")` / `exclude("bootStrap/")` / `exclude("coreLibrary/extApi/")` / `exclude("scratch")` / `exclude("mirai")` / `load("mapScript/")` → 新的顶层目录 `demo/` 不在排除名单中，**放进脚本根目录即可随 `/sa scan` 被启用**（`README.md:147` 也说明 `mapScript/` 是唯一特例）
- **`.metadata` 不是必需**：`coreLibrary/commands/helpful.kts:42-77` 的 `/sa genMetadata` 是"供开发使用"的加速手段，`README.md:666` — "开发期用 `/sa genMetadata` 生成 `.metadata` 加速加载"。设计文档 §11 不写 `.metadata` 可行。
- `module.kts` 里可以有可执行代码：`coreMindustry/module.kts:15-18` — `Listener` + `onEnable { RootCommands.hookGameHandler() }`；`coreLibrary/db/module.kts` 亦有 `onEnable { launch { ... } }`；纯声明的例子 `wayzer/store/module.kts`（仅 1 行 `@file:Depends`，**无 `package` 行**）→ 生成器给 `module.kts` 写 `package demo` 与 `wayzer/store` 反例并存，均合法。

**需要修改的两点：**
1. **"每个目录是一个模块、目录下建 `module.kts`"（`README.md:657`/设计文档 §7.1）表述过强**：真实仓库仅模块根有 `module.kts`，子目录（`wayzer/cmds/`、`wayzer/user/ext/`、`mapScript/tags/`）都没有。生成器的 `demo/module.kts`（模块根）+ `demo/*.kts` 结构正确，但**不应**为 `demo/sub/` 自动再造一个 `module.kts`，除非确实需要不同依赖。`wayzer/store/module.kts` 证明"只为了挂依赖"也可以建子模块。
2. **`// @sa:file id=... module=... title=...` 锚点注释在本树内 `未找到证据`**：全树 0 个 `.kts`/`.kt` 含 `@sa:`。它是合法 Kotlin 行注释、不影响运行（设计文档 §7.1 第 459 行亦如此声明），但"与工作区真实脚本比对"的验收标准下它没有先例；若导出物要求"与仓库风格一致"，这一点需要在工具里明确标注为自定义约定。同理 `// @sa:node ...` 亦无先例。

   > **后记（格式已换）**：锚点后来改成更紧凑的 `//@<控件编码> <x> <y> [嵌套层级]`（见 `src/frontend/js/anchor.js`），注释占比从约 40% 降到约 10%。上面这条结论依然成立 —— 两种写法在本树里都没有先例，都属本工具的自定义约定。老的 `// @sa:` 写法仍然能被解析（用户已有的 `.kts` 不报废）。

---

## 附：三项与设计文档不符、建议回改设计文档的结论

1. `详细设计.md:104-111` 的默认导入清单基本正确，但结论句"生成的脚本首行只需 `@file:Depends("coreMindustry")`，其余无需 import"**必须加限制**：涉及 `Team` / `Color` / `Packets` / `Tile` / `UnitType` / `Item` / `Block` / `Gamemode` / `ItemStack` / `Duration` / `Administration` / `KVStore` / `StringDataType` 时必须显式 import（见 §2 表）。
2. `详细设计.md:97-98` 声称 `kotlinx.coroutines.*` 为框架级默认导入 ✅ **成立**：`wayzer/ext/autoUpdate.kts` 无任何 kotlinx import，却在 `:23` 用 `runInterruptible(Dispatchers.IO)`、`:30` 用 `isActive`、`:79` 用 `delay(...)`；全树 32 个 `.kts` 裸用 `Dispatchers`。（对照：框架自身的 `.kt` lib 文件则显式 `import kotlinx.coroutines.*`，见 `coreLibrary/lib/util/coroutine.kt:5-7`、`coreMindustry/lib/DispatcherExt.kt:6`、`mapScript/lib/util.kt:10-13`。）
3. `详细设计.md:344/349` 的 `action.savable` 生成 `@Savable var x = 0` + `customLoad(::x) { x = it }` ✅ 与树内形状一致；但若引用样例中出现 `@Savable(false) val counter = 0`，必须改为 `var`，否则落盘值无法回写（见 §6）。
