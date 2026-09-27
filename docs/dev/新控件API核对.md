> **开发 / 设计文档** —— 看代码、改代码才需要；**用这个工具不需要看它**。返回 [文档索引](../README.md)。
> 本文是逐个控件的 API 离线核对记录，属于历史研究笔记。核对结论已经落到 `src/frontend/js/catalog/` 里，**以代码为准**。

# ScriptAgent4MindustryExt 3.4.0 — API 事实核对报告

> **语料根目录**：`F:\deepseek\mdt\ScriptAgent4MindustryExt-3.4.0-scripts\`（156 个 `.kt`/`.kts` 文件 + `README.md` 948 行）
> **方法**：全部结论来自本地文件的实际使用点（file:line）。**未使用网络**。
> **图例**：
> - `[VERIFIED]` = 语料中存在具体 file:line 证据
> - `[NOT FOUND]` = 语料中检索不到，**未猜测**
> - `[INFERRED - not in corpus]` = 基于 Kotlin/Java 常识的外推，语料无证据
>
> **重要元信息**：本语料是**脚本插件集合，不含 Mindustry 引擎源码**（无 `mindustry*.jar`、无 `.java`）。
> 因此事件的"完整字段表"无法从语料穷举 —— 只能给出**语料中确实被访问过的字段**。
> 事件对象的其它字段属于引擎范畴，本报告不臆测。

---

## 0. 默认导入基线（推导 imports 表的依据）

`coreMindustry/module.kts:1-11`：

```kotlin
@file:Depends("coreLibrary")
@file:Import("arc.Core", libraryByClass = true)
@file:Import("mindustry.Vars", libraryByClass = true)
@file:Import("arc.Core", defaultImport = true)          // 4
@file:Import("mindustry.Vars.*", defaultImport = true)  // 5
@file:Import("mindustry.content.*", defaultImport = true)   // 6
@file:Import("mindustry.gen.Player", defaultImport = true)  // 7
@file:Import("mindustry.gen.Call", defaultImport = true)    // 8
@file:Import("mindustry.gen.Groups", defaultImport = true)  // 9
@file:Import("mindustry.game.EventType", defaultImport = true) // 10
@file:Import("coreMindustry.lib.*", defaultImport = true)   // 11
```

`coreLibrary/module.kts:6-10`：

```kotlin
@file:Import("coreLibrary.lib.*", defaultImport = true)
@file:Import("coreLibrary.lib.event.*", defaultImport = true)
@file:Import("coreLibrary.lib.util.*", defaultImport = true)
@file:Import("-Xcontext-parameters", compileArg = true)
@file:Import("cf.wayzer.placehold.*", defaultImport = true)
```

`mapScript/module.kts:1-4` / `wayzer/module.kts:1-3` 在此基础上追加：

```kotlin
@file:Import("mapScript.lib.*", defaultImport = true)   // mapScript/module.kts:4
@file:Import("wayzer.lib.*", defaultImport = true)      // wayzer/module.kts:3
```

**关键推论（有反证支撑）**：
- `mindustry.content.*` 默认导入 ⇒ **`Blocks` / `Items` / `UnitTypes` / `StatusEffects` / `Fx` 都不需要显式 import**。
  反证：`wayzer/reGrief/history.kts:3-8` 只 import 了 `Color / with / Item / Block / CoreBlock / java.util.*`，却在 `history.kts:142` 直接用 `Fx.placeBlock`。
- `Team` **不在**默认导入里。反证：23 个文件显式 `import mindustry.game.Team`（`999.kts:9`、`maps.kts:6`、`restart.kts:5` …）。
- `Color` **不在**默认导入里。反证：`helpfulCmd.kts:3`、`pixelPicture.kts:3`、`history.kts:3` 都显式 `import arc.graphics.Color`。
- 默认导入会**跨模块按依赖传播**。反证：`mapScript/tags/towerDefend.kts` 无 `Player`/`Blocks`/`Call` import，却直接用 `Blocks.armoredConveyor`、`Call.deconstructFinish`、`it.player.sendMessage`；`wayzer/` 下也没有任何文件 `import mindustry.Vars`，却普遍用 `state.rules`。

---

## GROUP A — Events

### A.1 监听语法（先确认这几种形态都真实存在）

```
[VERIFIED] listen<T> { }  —— 按类型监听
  syntax: listen<EventType.WorldLoadEvent> { }           // 块内 it = 事件对象
          listen<EventType.PlayerChatEvent> { it.message } // it 可用
          listen<EventType.BlockDestroyEvent> { e -> e.tile } // 也支持显式命名参数
  evidence: variables.kts:103 (it 隐式) ; history.kts:155 (event ->) ; TDDrop.kts:144 (e ->)
  notes: coreMindustry/lib/ListenExt.kt:86 `inline fun <reified T:Any> Script.listen(insert:Boolean=false, noinline handler:(T)->Unit)`；
         脚本 disable 时自动反注册（ListenExt.kt:26-34,60-75）

[VERIFIED] listen(eventObj) { } —— 按事件对象监听（用于 Trigger 这类单例事件）
  syntax: listen(EventType.Trigger.update) { }
  evidence: variables.kts:107 ; towerDefend.kts:97 ; limitFire.kts:8 ; limitLogicPacket.kts:59 ; 14562.kts:67
  notes: ListenExt.kt:92 `fun <T:Any> Script.listen(v:T, insert:Boolean=false, handler:(T)->Unit)`

[VERIFIED] listen<T>(insert = true) { } —— 插到监听链最前面
  evidence: maps.kts:122 `listen<EventType.DataPatchLoadEvent>(insert = true) {`
  notes: ListenExt.kt:86；`insert` 语义见 ListenExt.kt:28
```

### A.2 玩家事件

```
[VERIFIED] EventType.PlayerConnect  （连接早期，可踢人）
  event object fields used: it.player
  syntax/evidence: wayzer/user/ban.kts:28-34
      listen<EventType.PlayerConnect> {
          launch(Dispatchers.IO) {
              val ban = findBan(PlayerData[it.player]) ?: return@launch
              withContext(Dispatchers.game) { it.player.kick(ban) }
          }
      }
  evidence2: wayzer/user/nameExt.kts:39-43
      listen<EventType.PlayerConnect> { val p = it.player; realName[p.uuid()] = p.name; p.updateName() }
  notes: 语料 2 处，全部通过 `it.player`。`kick` 有重载 `kick(String, Int)` → ban.kts:14-26

[VERIFIED] EventType.PlayerJoin
  event object fields used: it.player
  evidence: mapScript/tags/limitAir.kts:25-27 ; wayzer/ext/welcomeMsg.kts:21 ; wayzer/map/mapInfo.kts:60 (e.player)
           wayzer/reGrief/limitFire.kts:16-19 ; wayzer/cmds/restart.kts:15-19 ; wayzer/vote.kts:12
  notes: mapInfo.kts:60-62 显示 `Groups.player` 已可用，但仍不宜直接操作世界（用 Core.app.post 包了一层）

[VERIFIED] EventType.PlayerLeave
  event object fields used: it.player
  evidence: wayzer/user/suffix.kts:9 `cache.remove(it.player.uuid())`
            wayzer/user/suffix.kts:25 ; wayzer/lib/.. module.kts:67 ; wayzer/map/betterTeam.kts:51
            wayzer/ext/observer.kts:23 ; wayzer/user/shortID.kts:35
  notes: betterTeam.kts:51 在 Leave 时保存 `savedTeams[it.player.uuid()] = it.player.team()`

[VERIFIED] EventType.PlayerChatEvent
  event object fields used: it.player, it.message (String)
  evidence: wayzer/cmds/gatherTp.kts:61-63
      listen<EventType.PlayerChatEvent> {
          if (it.message.equals("go", true)) { it.player.unit()?.apply { ... } }
      }
  evidence2: wayzer/vote.kts:23-31
      listen<EventType.PlayerChatEvent> {
          val action = when (it.message.lowercase()) { "y","1" -> ... ; else -> return@listen }
          (VoteEvent.active.get() ?: return@listen it.player.sendMessage("...")).vote(it.player, action)
      }
  notes: 语料**只有** `player` 和 `message` 两个字段被访问。其它字段（如 chat 目标选择）无证据。
```

### A.3 方块/建筑事件

```
[VERIFIED] EventType.BlockBuildBeginEvent   （建造/拆除开始前置，可取消建筑）
  event object fields used: it.tile (Tile), it.unit (Unit), it.breaking (Boolean)
  evidence: mapScript/tags/towerDefend.kts:70-76
      listen<EventType.BlockBuildBeginEvent> {
          if (it.breaking) return@listen
          if (it.tile.floor() in floors) {
              if (it.unit.isPlayer) return@listen
              it.tile.remove()
          }
      }
  notes: 语料 1 处。`it.unit` 非空（无 `?`），`it.tile` 是 `Tile`

[VERIFIED] EventType.BlockBuildEndEvent
  event object fields used: it.tile (Tile), it.unit (Unit?), it.breaking (Boolean), it.team (Team)
  evidence(breaking/unit/tile): wayzer/reGrief/history.kts:65-71
      listen<EventType.BlockBuildEndEvent> {
          val player = it.unit?.player ?: return@listen     // ← unit 可空
          if (it.breaking) log(it.tile.array(), Log.Break(player.uuid()))
          else log(it.tile.array(), Log.Place(player.uuid(), it.tile.block()))
      }
  evidence(team): wayzer/pvp/pvpAlert.kts:42-49
      listen<EventType.BlockBuildEndEvent> {
          if (!state.rules.pvp || it.breaking) return@listen
          val data = it.team.myData                        // ← 独立的 team 字段
          val block = it.tile.block()
      }
  evidence(tile+breaking): mapScript/tags/limitAir.kts:19-22 ; mapScript/14562.kts:40-43
  notes: ⚠ `it.unit` 可空（history.kts:66 用 `?.`），而 BlockBuildBeginEvent 的 `it.unit` 不可空（towerDefend.kts:73 直接 `.isPlayer`）→ 两者可空性不同
         ⚠ 有独立 `team` 字段，不要只依赖 `it.tile.team()`

[VERIFIED] EventType.BlockDestroyEvent
  event object fields used: it.tile (Tile)
  evidence: mapScript/shared/hexed.kts:10-16 ; wayzer/reGrief/history.kts:79-82 ; 155-156 ; wayzer/pvp/pvpAlert.kts:75-78
      listen<EventType.BlockDestroyEvent> {
          val core = it.tile.build as? CoreBuild ?: return@listen
          core.items = ItemModule()   // 防止爆炸
      }
  notes: history.kts:80 有 `if (it.tile == emptyTile) return@listen` —— 存在"空 tile"哨兵值

[VERIFIED] EventType.TileChangeEvent
  event object fields used: it.tile (Tile)
  evidence: coreMindustry/util/trackBuilding.api.kt:23-27 ; mapScript/shared/posMark.kts:34-36 ;
            mapScript/tags/towerDefend.kts:77-79 ; wayzer/map/mapSnap.kts:71-73
      listen<EventType.TileChangeEvent> { val tile = it.tile; if (tile.block() == Blocks.air) return@listen }
  notes: 语义 = 方块**变化后**（trackBuilding 用它 onAdd）

[VERIFIED] EventType.TilePreChangeEvent
  event object fields used: it.tile (Tile)
  evidence: coreMindustry/util/trackBuilding.api.kt:18-22
      listen<EventType.TilePreChangeEvent> {
          val build = it.tile.build
          if (build?.tile == it.tile && build is B && filter(build)) tracker.onRemove(build)
      }
  notes: 语义 = 方块**变化前**。语料仅 1 处。⚠ `it.tile.build` 在 pre 阶段可能已失效 → 官方用法会 `build?.tile == it.tile` 二次校验
```

### A.4 单位事件

```
[VERIFIED] EventType.UnitCreateEvent
  event object fields used: it.unit (Unit) — .team / .type / .flag / .spawnedByCore
  evidence: mapScript/tags/towerDefend.kts:91-94
      listen<EventType.UnitCreateEvent> {
          if (it.unit.team == state.rules.waveTeam) it.unit.flag = specialFlag
      }
  evidence2: wayzer/pvp/pvpAlert.kts:66-72
      listen<EventType.UnitCreateEvent> {
          if (!state.rules.pvp || it.unit.spawnedByCore) return@listen
          val team = it.unit.team ; val type = it.unit.type
      }

[VERIFIED] EventType.UnitDestroyEvent
  event object fields used: it.unit (Unit) — .team / .type
  evidence: mapScript/tags/TDDrop.kts:144-146
      listen<EventType.UnitDestroyEvent> { e ->
          if (e.unit.team == state.rules.waveTeam || tdMode == "all")
              handleDrop(e.unit, dropMap[e.unit.type])
      }
  notes: 语料仅 1 处，字段为 unit

[VERIFIED] EventType.UnitSpawnEvent
  event object fields used: it.unit (Unit) — .team
  evidence: wayzer/reGrief/unitLimit.kts:49-53
      listen<EventType.UnitSpawnEvent> { e ->
          if (e.unit.team.data().unitCount > 5000 && !state.gameOver) {
              state.gameOver = true
              Events.fire(EventType.GameOverEvent(state.rules.waveTeam))
          }
      }

[VERIFIED] EventType.UnitUnloadEvent
  event object fields used: it.unit (Unit) — .team
  evidence: wayzer/reGrief/unitLimit.kts:14-16
      listen<EventType.UnitUnloadEvent> { e ->
          if (e.unit.team == state.rules.waveTeam && state.rules.waves && ...) return@listen
          val count = e.unit.team.data().unitCount
      }
  notes: 语义 = 单位被"卸载/移除"（含满编驱逐），不是玩家主动卸载

[NOT FOUND] EventType.UnitControlEvent
  tried: grep 'ControlEvent|UnitCommandEvent|UnitEnteredPayload|UnitTransport' over all *.kt/*.kts → 0 hit
  notes: 语料中**不存在**该事件的任何使用或 import。不要猜字段。
```

### A.5 地图/世界/游戏流程事件

```
[VERIFIED] EventType.WorldLoadEvent
  event object fields used: 无（阻塞体不使用参数）
  evidence: coreMindustry/variables.kts:103-106 ; mapScript/module.kts:59 ; wayzer/map/betterTeam.kts:43
            wayzer/map/mapInfo.kts:52 ; wayzer/map/mapSnap.kts:68 ; wayzer/reGrief/unitLimit.kts:77
            wayzer/reGrief/history.kts:51 ; wayzer/pvp/autoGameover.kts:44 ; wayzer/map/pvpProtect.kts:21
  notes: 语料 10 处，**没有任何一处访问事件对象的字段**（如 `it.map`）→ 「WorldLoadEvent 有哪些字段」在本语料中**无证据**。
         需要地图信息时都转而使用 `state.map`（e.g. `variables.kts:28`、`mapInfo.kts:22`）

[VERIFIED] EventType.WorldLoadEndEvent
  event object fields used: 无
  evidence: wayzer/ext/observer.kts:88-92
      listen<EventType.WorldLoadEndEvent> {
          world.tiles.iterator().forEach { if (it.team().id == 255) it.setAir() }
      }
  notes: 语料 2 处（另一处是 maps.manager.kt:119 的注释）

[VERIFIED] EventType.WorldLoadBeginEvent （仅 import，未监听）
  evidence: wayzer/maps.kts:4 `import mindustry.game.EventType.WorldLoadBeginEvent`
  notes: ⚠ maps.kts:4 只是 import，**全文件未使用**；maps.manager.kt:118 是注释 `// EventType.WorldLoadBeginEvent : do set state.rules`
         → 该事件**名字真实存在**（能被 import 通过编译），但语料**没有任何可用用法示例**，字段完全无证据

[VERIFIED] EventType.ResetEvent
  event object fields used: 无（多处显式忽略：`{ _ -> }`）
  evidence: mapScript/module.kts:18 `listen<EventType.ResetEvent> { _ -> ... }`
            coreMindustry/../wayzer/ext/observer.kts:22 ; wayzer/map/betterTeam.kts:46 ; mapScript/tags/limitAir.kts:75
            wayzer/pvp/autoGameover.kts:47 ; wayzer/cmds/gatherTp.kts:75 ; wayzer/reGrief/limitFire.kts:7 …（共 17 处）
  notes: 用途是清空每局状态。**注意** restart.kts:21-22 明确注释 「Don't using ResetEvent, as Groups.player is cleared」
         → ResetEvent 触发时 Groups.player 已被清空

[VERIFIED] EventType.GameOverEvent
  event object fields used: it.winner / event.winner (Team)
  evidence: wayzer/maps.kts:87-104
      listen<EventType.GameOverEvent> { event ->
          state.gameOver = true
          Call.updateGameOver(event.winner)
          ... if (state.rules.pvp) "...${event.winner.name}..." else "..."
      }
  evidence2(构造并 fire): wayzer/cmds/restart.kts:54 `Events.fire(EventType.GameOverEvent(Team.derelict))`
                         wayzer/maps.kts:155 `Events.fire(EventType.GameOverEvent(winner))`
                         wayzer/reGrief/unitLimit.kts:53,82 `Events.fire(EventType.GameOverEvent(state.rules.waveTeam))`
                         wayzer/map/betterTeam.kts:60-61
  notes: 构造签名 = `GameOverEvent(Team)` ✔（4 处独立佐证）。需要 `arc.Events` 才能 fire（restart.kts:3 import arc.Events）
         ⚠ 与 wayzer 自己定义的 `class GameOverEvent(val winner: Team)`（maps.kts:80-86，SA Event）**同名不同物**，注意区分

[VERIFIED] EventType.WaveEvent
  event object fields used: 无（代码用的是 `state.wave`）
  evidence: wayzer/reGrief/unitLimit.kts:78-85
      listen<EventType.WaveEvent> {
          if (gameOverWave > 0 && state.wave > gameOverWave && !state.gameOver) { ... }
          checkNextWave()
      }
  notes: ⚠⚠ **波数不在事件对象上**！语料里取波数一律用 `state.wave`
         （variables.kts:42 `registerVar("state.wave", ...) { state.wave }`；unitLimit.kts:74,79）
         「WaveEvent.wave」在本语料中**不存在证据** → 若要写 `it.wave` 属于臆测

[VERIFIED] EventType.StateChangeEvent
  event object fields used: it.to (GameState.State)
  evidence: wayzer/cmds/restart.kts:23-26
      listen<EventType.StateChangeEvent> {
          if (it.to == GameState.State.menu) doRestart()
      }
  notes: ⚠ 需要 `import mindustry.core.GameState`（restart.kts:4）。语料**只有 `to` 被访问**，`from` 无证据

[VERIFIED] EventType.PlayEvent
  event object fields used: 无
  evidence: wayzer/reGrief/autoChangeMap.kts:38-42
      listen<EventType.PlayEvent> {
          if (content.blocks().filterIsInstance<LogicBlock>().any { it.maxInstructionsPerTick > 1000 }) MapManager.loadMap()
      }
  notes: 另一处是 maps.manager.kt:132 注释 `Vars.logic.play() // EventType.PlayEvent`

[VERIFIED] EventType.CoreChangeEvent
  event object fields used: e.core (CoreBlock.CoreBuild) — 访问了 `.team`
  evidence: wayzer/map/betterTeam.kts:65-72
      listen<EventType.CoreChangeEvent> { e ->
          val team = e.core.team
          launch(Dispatchers.gamePost) { ... it.lastDamage == team ... }
      }
  notes: 语义是「核心易主」。需要 `import mindustry.world.blocks.storage.CoreBlock`（betterTeam.kts:8）才能用 `.team` 之外的类型；这里只用 .team 也可以

[VERIFIED] EventType.ConnectPacketEvent
  event object fields used: 无
  evidence: wayzer/reGrief/autoChangeMap.kts:33-36
      listen<EventType.ConnectPacketEvent> {
          //Someone request connect, maybe want to play
          newMap = false
      }
  notes: ⚠ 若需要 packet/con/net 字段，请改用 `listenPacket2ServerAsync<ConnectPacket>` —— 见 wayzer/module.kts:45-58（那里用的是 `con`、`packet.uuid`、`packet.usid`、`packet.name`）

[VERIFIED] EventType.ContentInitEvent
  evidence: coreMindustry/lib/ContentExt.kt:92 （KDoc 注释 `auto re[init] when [EventType.ContentInitEvent]`）
  notes: ⚠ 仅出现在注释中，**没有任何监听示例** → 名字存在但用法无证据

[VERIFIED] EventType.SaveLoadEvent
  evidence: wayzer/maps.manager.kt:121 （注释 `// Not generator: EventType.SaveLoadEvent`）
  notes: ⚠ 仅注释，无用法

[VERIFIED] EventType.TapEvent
  event object fields used: it.player (Player), it.tile (Tile)
  evidence: wayzer/reGrief/history.kts:139-143
      listen<EventType.TapEvent> {
          val p = it.player
          Call.effect(p.con, Fx.placeBlock, it.tile.worldx(), it.tile.worldy(), 0.5f, Color.green)
      }
  evidence2: wayzer/ext/observer.kts:25-29 (`it.tile.build is CoreBlock.CoreBuild && it.player in obTeam`)
             mapScript/999.kts:156 (`val player = event.player; val tile = event.tile`)
             mapScript/13545.kts:47
  notes: TapEvent 属于**客户端点击**事件（Client 侧），服务端慎用
```

### A.6 配置 / 菜单 / 载荷 / 投递

```
[VERIFIED] EventType.ConfigEvent
  event object fields used: it.player (Player?), it.value (Any?), it.tile (Building — 注意要 .tile.tile)
  evidence: wayzer/reGrief/history.kts:72-75
      listen<EventType.ConfigEvent> {
          val log = Log.Config(it.player?.uuid(), it.value?.toString() ?: "null")
          log(it.tile.tile.array(), log)
      }
  notes: ⚠⚠ 此事件的 `it.tile` 是 **Building**（所以 history.kts 写 `it.tile.tile` 才能拿 Tile）；
         这与 BlockBuildEndEvent/BlockDestroyEvent/TileChangeEvent 的 `it.tile` 是 **Tile** 不同！
         `it.player` 可空、`it.value` 可空

[VERIFIED] EventType.MenuOptionChooseEvent
  event object fields used: it.player, it.menuId (Int), it.option (Int)
  evidence: coreMindustry/menu.kts:6-10
      listen<EventType.MenuOptionChooseEvent> {
          MenuChooseEvent(it.player, it.menuId, it.option).launchEmit(coroutineContext + Dispatchers.game) { e ->
              if (!e.received && it.menuId < 0) Call.hideFollowUpMenu(e.player.con, e.menuId)
          }
      }
  notes: ⚠ 字段名是 **`option`**（不是 `value`）；menuId 为负 = followUpMenu（menu.kts:8 用 `it.menuId < 0` 判断）

[VERIFIED] EventType.TextInputEvent
  event object fields used: it.player, it.textInputId (Int), it.text (String)
  evidence: coreMindustry/util/textInput.kts:3-7
      import mindustry.game.EventType.TextInputEvent
      listen<TextInputEvent> {
          OnTextInputResult(it.player, it.textInputId, it.text).launchEmit(coroutineContext + Dispatchers.game)
      }
  notes: ⚠ 字段名是 **`textInputId`**（不是 id）；配套封装见 textInput.api.kt:17-29

[VERIFIED] EventType.PayloadDropEvent
  event object fields used: it.build (Building?), it.carrier (Unit — 用了 .player)
  evidence: wayzer/reGrief/history.kts:88-91
      listen<EventType.PayloadDropEvent> {
          val build = it.build ?: return@listen
          log(build.tile.array(), Log.PickDown(it.carrier.player?.uuid(), build.block))
      }
  notes: `build` 可空；`carrier.player` 可空

[VERIFIED] EventType.PickupEvent
  event object fields used: it.build (Building?), it.carrier (Unit — 用了 .player)
  evidence: wayzer/reGrief/history.kts:83-87
      listen<EventType.PickupEvent> {
          val build = it.build ?: return@listen
          //As the build has removed when pickup, use tileOn instead
          log(build.tileOn().array(), Log.PickUp(it.carrier.player?.uuid()))
      }
  notes: ⚠ 注释明示：pickup 时方块已被移除，`build.tile` 不再代表原位置，要用 `build.tileOn()`

[VERIFIED] EventType.DepositEvent
  event object fields used: it.player (Player?), it.item (Item), it.amount (Int), it.tile (Building → .tile)
  evidence: wayzer/reGrief/history.kts:76-78
      listen<EventType.DepositEvent> {
          log(it.tile.tile.array(), Log.Deposit(it.player?.uuid(), it.item, it.amount))
      }
  notes: 同 ConfigEvent，`it.tile` 是 Building
```

### A.7 EventType.Trigger.* 的确切形态

```
[VERIFIED] EventType.Trigger.update  （唯一的 Trigger 成员在语料中被使用的）
  syntax(两种等价写法):
      listen(EventType.Trigger.update) { }
      import mindustry.game.EventType.Trigger
      listen(Trigger.update) { }
  evidence(第一种): coreMindustry/variables.kts:107 ; mapScript/tags/towerDefend.kts:97 ;
                   wayzer/reGrief/limitFire.kts:8 ; wayzer/reGrief/limitLogicPacket.kts:59
  evidence(第二种): mapScript/tags/autoExchange.kts:3 `import mindustry.game.EventType.Trigger` + :74 `listen(Trigger.update)`
                   mapScript/14562.kts:4 `import mindustry.game.EventType.Trigger` + :67 `listen(Trigger.update)`
  notes:
    - ⚠ 这是**事件对象**（单例），不是类型 → 必须用 `listen(obj)` 的重载，**不能**写 `listen<EventType.Trigger.update> {}`
    - 语料 6 处全为 `Trigger.update`；`Trigger.` 的其它成员在全语料中 **0 次出现**
    - 每 tick 执行：limitLogicPacket.kts:59 在其中做限速；variables.kts:107-110 用它累计暂停时间

[NOT FOUND] EventType.Trigger 的其它成员（Trigger.draw / Trigger.uiDraw 等）
  tried: grep 'Trigger\.' → 仅 `Trigger.update`（6 次，其中 2 次是 import 语句 `import mindustry.game.EventType.Trigger`）
  notes: 语料无法证明存在其它成员。不要写 `Trigger.xxx`。
```

### A.8 本语料出现过的 EventType 成员全清单（供交叉核对）

`EventType.<member>` 出现次数（`Select-String` 统计）：

| 次数 | 成员 | 次数 | 成员 |
|---|---|---|---|
| 17 | `ResetEvent` | 1 | `DepositEvent` |
| 10 | `WorldLoadEvent` | 1 | `PickupEvent` |
| 8 | `GameOverEvent` | 1 | `WaveEvent` |
| 8 | `PlayerLeave` | 1 | `UnitSpawnEvent` |
| 7 | `PlayerJoin` | 1 | `UnitUnloadEvent` |
| 5 | `BlockBuildEndEvent` | 1 | `SaveLoadEvent`（仅注释） |
| 5 | `BlockDestroyEvent` | 1 | `PayloadDropEvent` |
| 4 | `Trigger.update` | 1 | `ConfigEvent` |
| 4 | `TapEvent` | 1 | `MenuOptionChooseEvent` |
| 4 | `TileChangeEvent` | 1 | `UnitDestroyEvent` |
| 3 | `DataPatchLoadEvent` | 1 | `TextInputEvent` |
| 2 | `UnitCreateEvent` | 1 | `TilePreChangeEvent` |
| 2 | `WorldLoadEndEvent` | 1 | `BlockBuildBeginEvent` |
| 2 | `PlayerConnect` | 1 | `CoreChangeEvent` |
| 2 | `PlayerChatEvent` | 1 | `ConnectPacketEvent` |
| 2 | `WorldLoadBeginEvent` | 1 | `ContentInitEvent`（仅注释） |
| 2 | `PlayEvent` | 1 | `StateChangeEvent` |

**明确不在语料中**：`UnitControlEvent`、`UnitCommandEvent`、`PayloadDropEvent` 之外的 payload 事件、`UnitEnteredPayloadEvent`、`BlockBuildBeginEvent` 之外的 build 事件。

---

## GROUP B — 世界 / 单位 / 玩家 操作

### B.1 传送 / 位置

```
[VERIFIED] Unit.set(x: Float, y: Float)   —— 世界像素坐标
  syntax: unit.set(x, y)
  evidence: wayzer/cmds/gatherTp.kts:49-52
      player.unit()?.apply {
          set(player.mouseX, player.mouseY)
          snapInterpolation()
      }
  evidence2: wayzer/cmds/spawnMob.kts:31 `if (unit != null) set(unit.x, unit.y)`（在 `type.create(team).apply{}` 内）
             coreMindustry/util/spawnAround.api.kt:15 `set(pos)`（Posc 重载）

[VERIFIED] Unit.set(pos: Posc) / Uni t.set(tile: Tile)   —— 对象重载
  syntax: unit.set(tile) / unit.set(pos)
  evidence: wayzer/cmds/gatherTp.kts:69 `set(tile)`（tile 是 `mindustry.world.Tile`，gatherTp.kts:8 import）
            coreMindustry/util/spawnAround.api.kt:15 `set(pos)`（pos: Posc）
            wayzer/user/ext/skills.kts:22-24 `UnitTypes.mono.create(player.team()).also { it.set(player) }.add()`

[VERIFIED] Unit.snapInterpolation()  —— 传送后必须调用，否则客户端插值会"飞过去"
  evidence: wayzer/cmds/gatherTp.kts:51 ; :70 ; wayzer/map/pvpProtect.kts:38

[VERIFIED] Player.mouseX / Player.mouseY (Float)  —— 玩家鼠标世界坐标
  evidence: wayzer/cmds/gatherTp.kts:50 `set(player.mouseX, player.mouseY)`
            wayzer/cmds/helpfulCmd.kts:37-38 `player!!.x, player!!.y` 对比（那里用的是 Player.x/y）
  notes: 语料仅 1 处。`player.x / player.y` 是 Player 自身坐标（helpfulCmd.kts:37）

[NOT FOUND] 直接把单位传送到另一个玩家（`unit.set(player)`）在语料中**没有独立用法**，但
             `skills.kts:23 it.set(player)` 正是 `set(Posc)` 且 Player 实现 Posc → 等价成立
             [INFERRED - not in corpus] Player 实现 Posc 这一点语料未显式声明，仅由 skills.kts:23 编译可用反推

[NOT FOUND] Player.unit() 的扩展定义
  tried: grep 'val.*Player.*\.unit\(\)|fun.*Player.*unit' → 0 hit
  notes: `player.unit()` / `player.dead()` / `player.team()` / `player.team(Team)` 全部来自 **Mindustry 引擎**
         （`mindustry.gen.Player` → `Unitc`/`Playerc` 接口），不在本语料内。
         证据：gatherTp.kts:30 `player.dead() || !player.unit().type.targetable`
               gatherTp.kts:49 `player.unit()?.apply {}`（可空！）
               betterTeam.kts:99 `p.clearUnit()` ; 999.kts:159 `player.team(Team.sharded)` ; 999.kts:158 `player.clearUnit()`
```

### B.2 击杀 / 伤害 / 血量

```
[VERIFIED] Unit.kill()
  evidence: wayzer/cmds/clearUnit.kts:7 `Groups.unit.toList().forEach { it.kill() }`
            mapScript/tags/limitAir.kts:13 ; wayzer/vote.kts:28 ; wayzer/pvp/autoGameover.kts:21
            wayzer/reGrief/unitLimit.kts:34 `m[it].kill()` ; :38 `e.unit.kill()` ; :55 `.forEach(Unit::kill)`
            wayzer/cmds/vote.kts:34 `Time.run(Random.nextFloat()*60*3, it::kill)`（方法引用）
  notes: 无参、返回 Unit（可链式）。无参数版本是语料中唯一出现的 kill

[VERIFIED] Unit.health / Unit.maxHealth / Unit.shield (Float)  —— 属性读取
  evidence: coreMindustry/variables.kts:96-98
      registerChild("health", "当前血量") { it.health }
      registerChild("maxHealth", "最大血量") { it.maxHealth }
      registerChild("shield", "护盾值") { it.shield }
  evidence2: wayzer/reGrief/unitLimit.kts:28-30
      Groups.unit.filter { it.team == e.unit.team && it.maxHealth < 1000f && !it.isPlayer }.sortedBy { it.health }
  evidence3: wayzer/reGrief/autoChangeMap.kts:16 `!it.dead() && it.unit().health > 0`

[NOT FOUND] Unit.damage(amount)  /  Unit.heal(...)
  tried: grep '\.damage\('  → 0 hit（`damage` 只作为规则字段出现：`unitDamageMultiplier`、`blockDamageMultiplier`）
         grep '\.heal\('    → 0 hit（`heal` 只作为数据补丁键出现：`1005.kts:79 "unit.aegires.abilities.0.healPercent"`）
  notes: ⚠⚠ 语料中**没有**任何 `unit.damage(x)` / `unit.heal(x)` 调用。不要凭 Mindustry 常识写。
         若需造成伤害，语料中出现的替代路径是：
           - `Call.transferItemTo(...)`（TDDrop.kts:130）
           - `Unit.kill()`
           - 直接改 `lastDamage`（betterTeam.kts:70 `it.lastDamage = Team.derelict`，autoGameover.kts:20）
           - 用 `apply(StatusEffects.x, 秒)` 施加状态（13545.menu.kt:108-109）
```

### B.3 建筑 / 方块

```
[VERIFIED] Tile.setBlock(block: Block)   /  Tile.setBlock(block, team: Team)
  syntax: tile.setBlock(Blocks.x)  |  tile.setBlock(Blocks.x, Team.y)
  evidence(单参): 1004.kts:59 ; 14562.api.kt:21,32,55 ; 999.kts:55,114 ; hexed.HexedGenerator.kt:52,62
                 hexed.GeneratorHelper.kt:46 `tile.setBlock(blocks[temp][elev])`
  evidence(双参): 999.kts:120 `tiles[it.center.x, it.center.y].setBlock(Blocks.coreShard, it.team)`
                999.kts:127 `tiles.get(it.x, it.y).setBlock(Blocks.coreShard, Team.sharded)`
  notes: ⚠ **没有** rotation 参数出现在语料中。
         需要 rotation 时语料用的是 `setNet`（见下）。

[VERIFIED] Tile.removeNet()   —— 移除方块但**同步到客户端**（网络方块）
  evidence: hexed.HexData.kt:59 `if (tile.block() != Blocks.air) tile.removeNet()`
            mapScript/shared/posMark.kts:41 `tile.removeNet()`
  notes: 与 `Tile.remove()` 的区别（语料中两者都出现）：
           - `removeNet()` = 网络同步移除，HexData/posMark 用于世界生成/动态标记
           - `remove()`    = 无网络同步：towerDefend.kts:74 `it.tile.remove()`、999.kts:126 `tiles.get(...).remove()`、posMark.kts:26 `it.remove()`

[VERIFIED] Tile.setAir()   —— 清空该格（去掉方块与地面覆盖物）
  evidence: mapScript/14562.kts:31 `it.tile.setAir()` ; wayzer/ext/observer.kts:90 `it.setAir()`
            mapScript/14562.api.kt:23,35,43,57

[VERIFIED] Tile.setNet(block: Block, team: Team, rotation: Int)   —— 带旋转的网络放置
  syntax: tile.setNet(st.block, team, st.rotation.toInt())
  evidence: mapScript/shared/hexed.HexData.kt:60
      tile.setNet(st.block, team, st.rotation.toInt())
  evidence2: wayzer/cmds/pixelPicture.kts:39 `setNet(Blocks.sorter, Team.crux, 0)`
  notes: ✅ 这是语料中**唯一**能放带旋转方块的方式（schematic 放置）。
         `1505.kts`/`999.kts` 等地图生成用 `setBlock` 无 rotation。

[VERIFIED] Tile.block() / Tile.floor() / Tile.overlay()   —— 查询
  evidence: tile.block(): posMark.kts:8 ; towerDefend.kts:59,79,81 ; limitAir.kts:20 ; hexed.HexData.kt:59
            tile.floor(): towerDefend.kts:52,72 ; hexed.GeneratorHelper.kt:77
            tile.overlay(): wayzer/map/mapSnap.kts:63 `tile.overlay() != Blocks.air`
  notes: 都是**方法调用带括号**

[VERIFIED] Tile.build  —— 取该格的 Building（可空）
  evidence: hexed.kts:11 `it.tile.build as? CoreBuild` ; trackBuilding.api.kt:19 `it.tile.build` ;
            towerDefend.kts:82 `val building = tile.build` ; posMark.kts:9 `tile.build.config().toString()`
  notes: ⚠ 可空（1001.kts:121 `coreTile.build?.items ?: return`）。`tile.build` 是**属性**（无括号），
         `tile.block()` 是**方法**（有括号）—— 这一点语料中 100% 一致

[VERIFIED] Tile.setFloor(floor: Floor)
  evidence: hexed.GeneratorHelper.kt:45 `tile.setFloor(floors[temp][elev] as Floor)` ; 1001.kts:69 ; 1002.kts:42 ;
            1003.kts:63,70,71,72,83 ; 1004.kts:58 ; 14562.kts:25 (`Blocks.deepwater.asFloor()`)

[VERIFIED] Tile.array() / Tile.x / Tile.y / Tile.worldx() / Tile.worldy() / Tile.getX() / Tile.getY()
  evidence: array(): history.kts:68,70,81 `it.tile.array()`（索引 = x + y*width）
            x/y: history.kts:159-160 `event.tile.x` / `event.tile.y`（Tile 坐标）
            worldx/worldy: history.kts:142-143 `it.tile.worldx(), it.tile.worldy()`（世界像素）
            getX/getY: limitAir.kts:21 `it.tile.getX(), it.tile.getY()`
  notes: ⚠ `getX()/getY()` 与 `worldx()/worldy()` 在语料中**都出现**；`x/y` 是格子坐标。

[VERIFIED] Tile.circle(radius) { x, y -> } / Tile.getLinkedTiles { } / Tile.nearby(dx, dy)
  evidence: 14562.kts:29 `it.tile.circle(blocksToOpen[it.block]!!) { x, y -> ... }`
            mapSnap.kts:72 `it.tile.getLinkedTiles(MapRenderer::update)`
            towerDefend.kts:36 `tile.nearby(dx, dy)?.floor()`
  14562.kts:46 `tile.getLinkedTiles { if (IslandTile.tiles[it.array()].discover()) any = true }`

[VERIFIED] Building.items  (ItemModule) 及其操作
  evidence: 13545.menu.kt:41 `private fun Building.getResource() = items.get(item)`
            :42 `private fun Building.removeResource(v: Int) = items.remove(item, v)`
            13545.menu.kt:131-136
                build.items.apply {
                    arrayOf(Items.lead, Items.scrap, Items.sand, Items.coal).forEach {
                        add(Items.copper, get(it))
                        set(it, 0)
                    }
                }
            1004.kts:89-92 `controller.core()?.items?.apply { add(...) }`
  notes: ✅ 核心资源操作 = `build.items.get(item) / add(item, n) / remove(item, n) / set(item, n)`
         可空：autoExchange.kts:62 `team.data().core()?.items ?: return`

[VERIFIED] Building.acceptStack(item, amount, source)  → Int
  evidence: mapScript/tags/TDDrop.kts:128 `val accept = core.acceptStack(it.item, amount, null)`

[VERIFIED] Building.handleStack(item, amount, source: Building?)
  evidence: 1004.kts:117 `produce.forEach { it.key.core()?.handleStack(Items.copper, it.value, null) }`
            1005.kts:106 同型
  notes: 第三参传 `null`

[VERIFIED] Building.configureAny(value)  /  Building.config()
  evidence: hexed.HexData.kt:61 `st.config?.let { tile.build.configureAny(it) }`
            posMark.kts:9 `tile.build.config().toString().lines()`
            coreMindustry/util/packetHelper.api.kt:41 `dataBuffer.writes.s(it.block.id.toInt())`

[VERIFIED] 解构一个方块到空气：Call.deconstructFinish(tile, Blocks.air, null)
  syntax: Call.deconstructFinish(tile, Blocks.air, null)  |  Call.deconstructFinish(tile, block, null)
  evidence: towerDefend.kts:84 `Call.deconstructFinish(tile, Blocks.air, null)`
            14562.kts:50 `Call.deconstructFinish(tile, block, null)`
            14562.kts:62 同型
  notes: ⚠ 三参，第三参为 `null`（Building?/Unit?）。语料 3 处全带 `null`

[VERIFIED] Building.kill()   （Building 也有 kill）
  evidence: wayzer/pvp/autoGameover.kts:19-22
      team.cores().toArray().forEach { it.lastDamage = Team.derelict; it.kill() }
      wayzer/cmds/vote.kts:27-28 `team.data().cores.toArray().forEach { if (it.team == team) it.kill() }`
  notes: 核心方块被 kill 前先改 `lastDamage` 是本语料的惯用套路

[VERIFIED] Building.tileOn()  —— 取 Building 当前所在的 Tile
  evidence: history.kts:86 `log(build.tileOn().array(), ...)`
```

### B.4 声音

```
[NOT FOUND] Sounds.X.play(...)
  tried: grep -i 'sound' over all *.kt/*.kts  → 0 hit（连 `Sounds` 这个标识符都不存在）
         grep '\.play\('  → 仅 1 hit，且是 `maps.manager.kt:132 Vars.logic.play() // EventType.PlayEvent`
  notes: ⚠⚠ 语料中**完全没有**播放音效的代码。`mindustry.content.Sounds` 虽然位于
         `mindustry.content.*`（在默认导入范围内），但**没有任何使用证据**。
         若需要播放声音，可用路径是 `Call.sound`/`Call.soundAt` 之类的 `Call.*`
         —— 但语料中也没有出现，**不要写**。
         语料里"给玩家反馈"一律用：`Call.label` / `Call.effect` / `Call.infoToast` / `sendMessage`
```

### B.5 给玩家发菜单（MenuBuilder DSL / MenuV2 DSL）

```
[VERIFIED] MenuBuilder<T>  —— 旧版菜单 DSL（coreMindustry 包，需 import + Depends）
  class 定义: coreMindustry/menu.lib.kt:24-140
      open class MenuBuilder<T : Any>(
          open val followup: Boolean,
          private val block: suspend MenuBuilder<T>.() -> Unit = { }
      ) {
          @DslMarker annotation class MenuBuilderDsl        // :34-35
          var title: String   // :62-63  @MenuBuilderDsl
          var msg: String     // :65-66  @MenuBuilderDsl
          fun newRow()                                        // :72-73
          fun option(name: String, body: suspend () -> T)     // :76-79
          suspend fun lazyOption(body: suspend FlagOptionBuilder.() -> T)  // :81-94
          fun refresh(): Nothing                              // :98-101  (抛 RefreshReturn)
          suspend fun sendTo(player: Player, timeoutMillis: Int = 60_000): T?  // :106
          fun close()                                         // :136-139
      }
  ⚠ 注意：`MenuBuilderDsl` 是**嵌套在 MenuBuilder 内的注解类**（menu.lib.kt:34-35），
     引用时要写 `@MenuBuilderDsl`（在继承类内部可直接用）或 `@MenuBuilder.MenuBuilderDsl`。
     它**不是**顶层注解。

  完整可用示例（照抄 13545.menu.kt 的模式）：
      // 文件头
      @file:Depends("coreMindustry/menu", "调用菜单")
      package myPackage

      import coreMindustry.MenuBuilder

      class MyMenu(val player: Player) : MenuBuilder<Unit>(followup = true) {
          @MenuBuilderDsl
          suspend fun costOption(title: String, cost: () -> Int, body: () -> Boolean) = lazyOption {
              val costV = cost()
              option("$title 花费$costV")            // lazyOption 里必须先 option 再返回
              if (costV > 100) return@lazyOption
              if (!body()) return@lazyOption
              refresh()                               // 重发菜单
          }

          override suspend fun build() {              // 覆盖 build() 是官方用法
              title = "标题"
              msg   = "提示文字"
              costOption("升级", { 100 }) { true }
              newRow()
              option("关闭") {}
          }
      }

      // 调用点（必须在协程里，sendTo 是 suspend）
      MyMenu(player).sendTo(player, 60_000)

  evidence(完整实例): mapScript/13545.menu.kt:38-233（class CoreWarMenu : MenuBuilder<Unit>(followup = true)）
                      mapScript/13545.kts:52 `CoreWarMenu(player, core).sendTo(player, 60_000)`
                      wayzer/ext/observer.kts:72-82
                          MenuBuilder {
                              title = "观战系统"
                              msg = "By [gold]WayZer\n选择队伍观战"
                              teams.allTeam.forEach { option(it.coloredName()) { setObTeam(player, it) }; newRow() }
                              option("退出观战/重新投胎") { setObTeam(player, null) }
                              newRow()
                              option("关闭菜单") { }
                          }.sendTo(player)
                      wayzer/vote.lib.kt:139-156 `MenuBuilder<Unit>("投票") { ... }.sendTo(p, 60_000)`
                      mapScript/13545.menu.kt:57-62 （在菜单回调里嵌套开子菜单：`MenuBuilder<Unit>("温馨提示") { ... }.sendTo(player, 60_000)`）
  notes:
    - ✅ 泛型参数 T 是 option 回调返回类型；`MenuBuilder<Unit>` 最常用
    - ✅ 构造：`MenuBuilder { }`、`MenuBuilder("标题") { }`、`MenuBuilder<Unit>(followup = true)`
    - ✅ `followup = true` 时用 `Call.followUpMenu`（menu.lib.kt:113-114），否则 `Call.menu`（:116）
    - ✅ 回调里调 `refresh()` 会重发菜单（抛 `RefreshReturn`，menu.lib.kt:99-101,126）
    - ⚠ `sendTo` 是 **suspend**，且超时只针对玩家选择，不含回调执行时间（:105 KDoc）

[VERIFIED] MenuV2  —— 新版菜单 DSL（推荐，支持子菜单/分页/状态）
  class 定义: coreMindustry/menu.new.kt:19-210
      open class MenuV2(val player: Player, val followup: Boolean = false, private val block: suspend MenuV2.() -> Unit = { })
          @DslMarker annotation class MenuBuilderDsl          // :24-25
          var title / var msg                                  // :57-61
          fun stateKey<T>(default: T, keyPrefix: String = "")  // :64-80   (跨 refresh 保存状态)
          var columnPreRow                                     // :82-83
          fun column(num: Int, body: () -> Unit)               // :87-95
          fun newRow()                                          // :97-106
          fun option(name: String, body: suspend () -> Unit)    // :108-114
          fun subMenu(title: String, chooseTimeout: Duration? = 60.seconds, builder: suspend MenuV2.() -> Unit)  // :116-131
          suspend fun lazyOption(body: suspend FlagOptionBuilder.() -> Unit)  // :133-146
          fun refresh(): Nothing                                // :150-153
          suspend fun send(rebuild: Boolean = true): MenuV2     // :157-171
          suspend fun await()                                   // :173-184
          suspend fun awaitWithTimeout(chooseTimeout: Duration = 60.seconds)  // :187-199
          fun close()                                           // :201-205
          var onCancel: suspend () -> Unit = {}                 // :54
      inline fun <T> MenuV2.renderPaged(list, initialPage=1, prePage=9, key="", itemRender: (T)->Unit)  // :213-232

  evidence(完整实例): coreMindustry/menu.kts:23-43（help 菜单，含 renderPaged + send + awaitWithTimeout）
                      wayzer/user/ext/whiteList.kts:56-89（含 column(2)、close()、subMenu 式用法；
                          :87-89 `}.let { launch(Dispatchers.game) { it.send().awaitWithTimeout(10.minutes) } }`）
                      wayzer/cmds/mapsCmd.kts:25（MenuV2(player) { ... }）
  notes: ✅ **必须** `import coreMindustry.MenuV2`（mapsCmd.kts:7、whiteList.kts:8）+ `@file:Depends("coreMindustry/menu")`
         ✅ `MenuV2(player) { ... }.send().awaitWithTimeout()`
         ✅ `renderPaged(list, page) { item -> option(...) { ... } }`（menu.kts:26-42）
         ⚠ `MenuV2` 的 `MenuBuilderDsl` 同样是**嵌套注解**（menu.new.kt:24-25）

[VERIFIED] PagedMenuBuilder<T>  —— 分页菜单
  class: coreMindustry/menu.lib.kt:142-161
  evidence: wayzer/cmds/share.api.kt:38-43
      PagedMenuBuilder(Groups.player.toList()) {
          option(it.name) { result = it }
      }.apply {
          title = "选择目标玩家"
          sendTo(player, 60_000)
      }
  notes: 构造 `PagedMenuBuilder(items) { option(...) }`；`title` 是属性；继承 `MenuBuilder<Unit>(true)`

[NOT FOUND] `Call.menu(...)` 作为"手写菜单"的推荐用法
  tried: 语料中 `Call.menu` 只出现 2 次，都在库内部：
         coreMindustry/menu.lib.kt:116  `Call.menu(player.con, _menuId, title, msg, options)`
         coreMindustry/menu.new.kt:169  同上
  notes: ✅ 签名（由库内调用推出）：`Call.menu(con: NetConnection, menuId: Int, title: String, msg: String, options: Array<Array<String>>)`
         ⚠ **不要**直接调 `Call.menu`，用 MenuBuilder/MenuV2 封装（它们负责 menuId 分发与事件回传）
         相关：`Call.followUpMenu(con, id, title, msg, options)`（:114/:167）、`Call.hideFollowUpMenu(con, id)` / `Call.hideFollowUpMenu(id)`（menu.kts:9 / menu.lib.kt:138 / menu.new.kt:204）
```

### B.6 设置玩家的单位

```
[NOT FOUND] player.unit(unit)   /  直接 setUnit
  tried: grep 'player\.unit\(unit\)|setUnit|player\.unit *='  → 0 hit
  notes: ⚠⚠ 语料中**不存在** `player.unit(unit)` 这个调用。
         语料中真实存在的相关能力：
           - `player.unit()`   读（gatherTp.kts:30 等）
           - `player.clearUnit()` 清除（betterTeam.kts:99、999.kts:158,185）
           - `UnitType.create(team).apply{ set(player)/set(x,y) }.add()` 生成并自动归属（skills.kts:22-24、spawnMob.kts:29-36）
           - `CoreBlock.playerSpawn(tile, player)` 让玩家在核心复活（999.kts:160,187）
             —— 这是语料中唯一"把玩家放到某位置"的正规做法
```

### B.7 Call.* 全清单（语料中实际出现的每一个）

| `Call.*` | 次数 | 一个具体示例（file:line） |
|---|---|---|
| `Call.sendMessage(con, msg, null, null)` | 1 | `coreMindustry/lib/ContentHelper.kt:61` |
| `Call.infoMessage(con, msg)` | 1 | `ContentHelper.kt:62` |
| `Call.infoToast(con, msg, time: Float)` | 1 | `ContentHelper.kt:63` |
| `Call.warningToast(con, iconId: Int, msg)` | 1 | `ContentHelper.kt:64`（`Iconc.warning.code`） |
| `Call.announce(con, msg)` | 2 | `ContentHelper.kt:65` |
| `Call.menu(con, id, title, msg, options)` | 2 | `coreMindustry/menu.lib.kt:116` |
| `Call.followUpMenu(con, id, title, msg, options)` | 2 | `menu.lib.kt:114` |
| `Call.hideFollowUpMenu(con, id)` / `(id)` | 3 | `menu.kts:9` / `menu.lib.kt:138` |
| `Call.textInput(con, id, title, msg, lenLimit, default, isNumeric)` | 1 | `coreMindustry/util/textInput.api.kt:27` |
| `Call.label(msg, duration, x, y)` | 5 | `mapScript/tags/limitAir.kts:21` |
| `Call.label(con, msg, duration, x, y)` | 1 | `wayzer/reGrief/history.kts:99-103` |
| `Call.labelReliable(msg, duration, x, y)` | 1 | `mapScript/lib/PosMark.kt:14` |
| `Call.effect(effect, x, y, rotation, color)` | 1 | `wayzer/cmds/helpfulCmd.kts:37` |
| `Call.effect(con, effect, x, y, rotation, color)` | 2 | `wayzer/cmds/helpfulCmd.kts:38`；`history.kts:142` |
| `Call.deconstructFinish(tile, block, entity)` | 3 | `mapScript/tags/towerDefend.kts:84` |
| `Call.transferItemTo(null, item, amount, x, y, build)` | 1 | `mapScript/tags/TDDrop.kts:130-133` |
| `Call.tileConfig(null, build, value)` | 1 | `wayzer/cmds/pixelPicture.kts:40` |
| `Call.setRules(rules)` | 1 | `mapScript/13545.kts:59` |
| `Call.updateGameOver(team)` | 1 | `wayzer/maps.kts:89` |
| `Call.setHudTextReliable(con, text)` | 2 | `mapScript/1004.kts:109`、`1005.kts:114` |
| `Call.infoPopup(con, msg, align, width, height, x, y, duration)` | 2 | `coreMindustry/scoreboard.kts:54`、`mapScript/13545.kts:74` |
| `Call.openURI(con, url)` | 4 | `wayzer/cmds/mapsCmd.kts:31` |
| `Call.openURI(con, url, ...)` | 1 | `whiteList.kts:74-77` |
| `Call.blockSnapshot(sent: Short, data: ByteArray)` | 2 | `coreMindustry/util/packetHelper.api.kt:44,49` |
| `Call.worldDataBegin(con)` | 1 | `wayzer/maps.manager.kt`（`Vars.netServer.sendWorldData` 附近）/ `packetHelper` 相关 |
| `Call.connect(...)` | 1 | 见 `wayzer/ext/goServer.kts`（跨服） |

**玩家侧的封装（比直接调 Call 更常用）**：
```
[VERIFIED] broadcast(text, type, time, quite, players)
  signature: coreMindustry/lib/ContentHelper.kt:38-52
      fun broadcast(text: PlaceHoldString, type: MsgType = MsgType.Message, time: Float = 10f,
                    quite: Boolean = false, players: Iterable<Player> = Groups.player)
  evidence: wayzer/map/betterTeam.kts:117-119 ; unitLimit.kts:19 `broadcast(text, MsgType.InfoToast, 4f, true, e.unit.team.data().players)`
            pvpAlert.kts:35-39 ; history.kts 无
  notes: `quite = true` 则不写服务器控制台（ContentHelper.kt:45）。内部用 `MindustryDispatcher.runInMain` 自动切主线程

[VERIFIED] Player?.sendMessage(text, type, time)   —— 注意有 @Deprecated String 重载
  signature: ContentHelper.kt:54-69 (PlaceHoldString 版，推荐) ; :77-78 (String 版，已废弃)
  evidence: mapScript/tags/limitAir.kts:26 `it.player.sendMessage("[yellow]...")`
            towerDefend.kts:53 `it.player.sendMessage("...".with(), MsgType.InfoToast, 3f)`
            mapScript/999.kts:164 ；observer.kts:59 `player.sendMessage("[green]再次输入指令...")`
  notes: ✅ receiver 可空（可空版会把内容打到控制台，ContentHelper.kt:55）；`con == null` 时直接 return（:57）
         ✅ 推荐写法：`"...{var}...".with("var" to v)`（PlaceHoldString），不要用废弃的 String 版
         ✅ `fun PlaceHoldString.toPlayer(player: Player): String`（ContentHelper.kt:71）
```

### B.8 传送/坐标相关（补全 GROUP B.1）

```
[VERIFIED] CoreBlock.playerSpawn(tile: Tile, player: Player)
  evidence: mapScript/999.kts:160 `CoreBlock.playerSpawn(tile, player)` ; :187 `CoreBlock.playerSpawn(world.tile(...), player)`
  notes: ⚠ `CoreBlock` 需要 `import mindustry.world.blocks.storage.CoreBlock`（999.kts:14）
         前置惯例：`player.clearUnit()` 然后 `player.team(t)`（999.kts:158-159）

[VERIFIED] Player.team(team: Team)   /   player.team(): Team
  evidence: 999.kts:159,186 `player.team(Team.sharded)` ; betterTeam.kts:99 `p.team(team)`
            vote.kts:19 `player!!.team()` ; betterTeam.kts:51 `it.player.team()`
  notes: ⚠ `player.team` 是方法（带括号），与 Unit 的 `unit.team` 属性（无括号）不同！
         Unit: `e.unit.team`（TDDrop.kts:147）；Player: `it.team()`（vote.kts:19）

[VERIFIED] Player.clearUnit()
  evidence: betterTeam.kts:99 ; 999.kts:158,185
```

---

## GROUP C — 条件判断

### C.1 权限

```
[VERIFIED] Player.admin  (Boolean 属性)
  evidence: coreMindustry/lib/PermissionExt.kt:9 `if (admin) add("@admin")`
            wayzer/maps.manager.kt:137-139 `it.admin.let { was -> it.reset(); it.admin = was }`
  notes: ⚠ 语料中**没有**任何脚本直接写 `player.admin`；它只出现在库里（PermissionExt.kt:9 内部）
         和 maps.manager.kt（重置玩家时的存取）。可以直接读，但语料内无"业务判断"示例。

[VERIFIED] player.hasPermission(node: String): Boolean   —— suspend 函数！
  signature: coreMindustry/lib/PermissionExt.kt:6-12
      suspend fun Player.hasPermission(permission: String): Boolean {
          val groups = buildList { add(uuid()); if (admin) add("@admin") }
          return PermissionApi.handleThoughEvent(this, permission, groups).has
      }
  evidence: wayzer/cmds/mapsCmd.kts:35 `if (!player.hasPermission("wayzer.vote.map")) {`
            wayzer/cmds/voteKick.kts:27 `if (target.hasPermission("wayzer.admin.skipKick"))`
            wayzer/cmds/voteOb.kts:34
            wayzer/user/suffix.kts:14 `hasPermission("suffix.admin") -> "${Iconc.admin}"`（在 suspend 上下文中）
  notes: ⚠⚠ 是 **suspend** → 只能在挂起上下文（命令 body / 协程）里调
         ⚠ `Player.hasPermission` 与 `CommandContext.hasPermission` 是**两个不同的东西**：
             CommandContext.hasPermission 定义在 coreLibrary/lib/CommandApi.kt:19（`suspend fun hasPermission(node: String): Boolean`），
             在命令里可以直接裸写 `hasPermission("x")`（configCmd.kts:69、helpfulCmd.kts:36）

[VERIFIED] PermissionApi.registerDefault(vararg permission, group = "@default")
  signature: coreLibrary/lib/PermissionApi.kt:67-69
  evidence: wayzer/user/ban.kts:90 `PermissionApi.registerDefault("wayzer.admin.ban", "wayzer.admin.unban", group = "@admin")`
            wayzer/ext/observer.kts:86 `PermissionApi.registerDefault("wayzer.ext.observer")`
            wayzer/reGrief/history.kts:37 ; mapScript/tags/mapRule.kts 无 ; 共 20+ 处

[VERIFIED] command DSL: requirePermission(node) / permission = node
  evidence: requirePermission: ban.kts:66 `requirePermission("wayzer.admin.ban")` ; gatherTp.kts:28 ; helpfulCmd.kts:36
            permission =: clearUnit.kts:4 `permission = dotId` ; maps.kts:129 `permission = "wayzer.maps.host"`
            CommandApi.kt:439 `fun CommandInfo.requirePermission(permission: String)`
  notes: `dotId` 是脚本 id 把 `/` 换成 `.`（spawnMob.kts:11 `permission = id.replace("/", ".")`，用变量 `dotId` 更简洁）

[VERIFIED] PermissionApi.Global / PermissionApi.default 直接操作
  evidence: mapScript/tags/mapRule.kts:14-17
      PermissionApi.default.groups.remove(group)
      PermissionApi.default.registerPermission(group, permissions)
      permissionCmd.kts:4 `onEnable { PermissionApi.Global.ByGroup.add(0, handler) }`
  notes: `mapRule` 用来把地图 tag 里的权限临时注册成一组
```

### C.2 数值 / 字符串比较

```
[VERIFIED] 普通 Kotlin 运算符（无语料自定义封装）
  evidence: 数值: 13545.menu.kt:52 `if (build.getResource() < costV)` ; towerDefend.kts:47 `core.dst(it.tile) < 80`
            字符串: gatherTp.kts:63 `it.message.equals("go", true)`  ← 忽略大小写
                    vote.kts:24 `it.message.lowercase()` + `when`
                    towerDefend.kts:57 `it.tile.block() == Blocks.itemSource`
  notes: `equals(x, ignoreCase = true)` 是语料中唯一的忽略大小写比较法（gatherTp.kts:63）

[VERIFIED] 区间/包含判断
  evidence: TDDrop.kts:147 `it.amount - it.amount / 2, it.amount + it.amount * 2`（Random.nextInt 的 bound）
            history.kts `while (size >= historyLimit)`
            mapScript/tags/towerDefend.kts:79 `tile.block() in allowBlocks`
            14562.kts:44 `in blocksToOpen ->`（when 的 in 分支）
```

### C.3 单位类型 / 队伍判断

```
[VERIFIED] unit.type == UnitTypes.x
  evidence: mapScript/13545.kts:41 `if (it.unit.type == UnitTypes.mono)`
            TDDrop.kts:148 `dropMap[e.unit.type]`（Map<UnitType, ...> 查找）
            pvpAlert.kts:69 `val type = it.unit.type`
  notes: ⚠ `unit.type` 是**属性**（无括号），与 Player 的 `player.unit()`、Tile 的 `tile.block()` 不同
         ⚠ `UnitTypes` 来自 `mindustry.content.*`（默认导入），无需 import；TDDrop.kts:4 之所以写
            `import mindustry.content.UnitTypes.*` 是为了用**非限定名** `dagger`、`mace` 等

[VERIFIED] unit.type.xxx 属性查询
  evidence: limitAir.kts:11 `it.type().flying`（⚠ 见下）
            towerDefend.ai.kt:25 `unit.type.flying` ; :31 `unit.type.range` ; :34 `unit.type.circleTarget`
            gatherTp.kts:30 `player.unit().type.targetable`
            spawnMob.kts:14 `content.getBy<UnitType>(ContentType.unit).filterNot { it.internal }`
  notes: ⚠⚠ **不一致**：limitAir.kts:11 写 `it.type()`（**带括号**，且 it 是 Unit），
         towerDefend.ai.kt:25 写 `unit.type`（无括号）。Mindustry 的 Unitc 同时有 `type` 字段和 `type()` 方法
         （`type` 是字段，Kotlin 中字段访问不带括号）。两处都能编译，说明两者都可用。
         **推荐**按多数的写法：`unit.type`（无括号）；`it.type()` 只在 limitAir.kts 出现 1 次。

[VERIFIED] unit.team == Team.x   /  unit.team == state.rules.waveTeam
  evidence: TDDrop.kts:147 `e.unit.team == state.rules.waveTeam`
            towerDefend.kts:94 `it.unit.team == state.rules.waveTeam`
            unitLimit.kts:15,55 ; vote.kts:28 `if (it.team == team)`
            1003.kts / 1001.kts 里 `player.team()`（Player 是方法）
  notes: ⚠ Unit 的 `team` 是**属性**（无括号），Player 的 `team()` 是**方法**（有括号）

[VERIFIED] Team 判断与取用
  evidence: `Team.all`（List<Team>，可用 `.getOrNull(id)` / `.first { }` / `.size`）：
             spawnMob.kts:20 `Team.all.getOrNull(it)` ; 999.kts:160 ; autoExchange.kts:39 `IntArray(Team.all.size)`
             maps.kts:153 `Team.all.firstOrNull { t -> t.name == it }`
            `Team.get(id)`：betterTeam.kts:108 `Team.get(it)`
            `Team.baseTeams`：spawnMob.kts:22
            常用常量：`Team.sharded`(999.kts:125) / `Team.derelict`(restart.kts:54) / `Team.crux`(pixelPicture.kts:39)
                       / `Team.all[255]`(betterTeam.api.kt:19 观战队伍)
            `team.active()`：betterTeam.kts:68 ; `team.cores()`：vote.kts:34 ; `team.data()`：多处
            `team.rules()`：13545.menu.kt:27
            `state.teams.getActive()`：betterTeam.kts:14 ; `state.teams.active`：hexed.HexData.kt:95
            `state.teams.isActive(team)` / `state.teams.get(team)!!`：vote.kts:20
```

### C.4 布尔组合

```
[VERIFIED] 直接用 Kotlin 运算符 `!` / `&&` / `||`，**没有任何 not/and/or 辅助函数**
  evidence: `!`  : gatherTp.kts:30 `if (player.dead() || !player.unit().type.targetable)`
            `&&` : towerDefend.kts:49 `it.block in allowBlocks && it.player.team().cores().any { ... }`
            `||` : TDDrop.kts:147 `e.unit.team == state.rules.waveTeam || tdMode == "all"`
            混用: unitLimit.kts:15 `... && state.rules.waves && state.rules.defaultTeam != state.rules.waveTeam`
  notes: 检索 `fun not(` / `fun .*if.{0,3}(True|Else|Not)` → **0 命中**
         ⇒ 语料中不存在 `not { }` / `ifTrue { }` / `and(a,b)` / `or(a,b)` 这类 helper

[VERIFIED] `.not()` 是 Kotlin 标准库 Boolean 扩展（不是自定义）
  evidence: mapScript/tags/towerDefend.ai.kt:14-22
      override fun invalid(target: Teamc?) = when (target) { ... }.not()
  用途就是把 when 结果取反，无 AI 语义

[VERIFIED] 空安全的布尔式写法
  evidence: spawnAround.api.kt:18 `(!canDrown() || floorOn()?.isDeep == false)`
            pvpProtect.kts（`it.closestEnemyCore()?.within(...) == true`）
            mapScript/tags/limitAir.kts:11 `it.closestEnemyCore()?.within(it, ...) == true`
  notes: `x?.pred() == true` 是语料中处理可空布尔的惯用法
```

### C.5 if / else 辅助

```
[NOT FOUND] ifTrue { } / ifElse { } 之类的 DSL
  tried: grep 'ifTrue|ifElse|ifNot|whenTrue' → 0 hit
  tried: grep '^fun .*if' 在 coreLibrary+coreMindustry 所有 .kt 定义 → 0 hit
  notes: ⚠ 语料中**不存在**任何条件流 helper。条件一律用原生 `if/else/when`。

[VERIFIED] 提前退出用 `return@listen` / `returnReply(...)` / `CommandInfo.Return()`
  evidence: `return@listen`: 遍布（history.kts:66 `?: return@listen`）
            `returnReply`: CommandApiExt.kt:17 `fun returnReply(msg: VarString): Nothing`（抛 CommandInfo.Return）
                用法: gatherTp.kts:31 `returnReply("[red]...".with())`
            `CommandInfo.Return()`: CommandApi.kt:225-231 `data object Return : CancellationException("Direct return command")`
                用法: menu.lib.kt:44 `CommandInfo.Return()` ; skills.lib.kt:39
            `replyUsage()`: CommandApi.kt:215-218
            `replyNoPermission()`: CommandApi.kt:209-212（已 @Deprecated，改用 requirePermission）

[VERIFIED] 语料中自定义的条件/流程 helper（真实存在的 .kt 里定义的 fun）
  - `fun CommandInfo.skillBody(body: suspend context(SkillCommandScope) CommandContext.() -> Unit)`
      evidence: wayzer/user/ext/skills.lib.kt:88-94（用 `@CommandInfo.CommandBuilder` 注解）
  - `object SkillPrecheck : CommandHandler` / `SkillNoPvp` / `class SkillCooldown`
      evidence: skills.lib.kt:12-26 / :31-68
  - `fun CommandContext.readArg(): String?`  evidence: share.api.kt:15
  - `suspend fun CommandContext.getTarget(): Player`  evidence: share.api.kt:17-47
  - `fun CommandInfo.requirePermission(permission: String)`  evidence: CommandApi.kt:439
  - `fun CommandHandler.canHandle()` / `suspend fun CommandHandler.handle()`  evidence: CommandApiExt.kt:41-43
  - `fun Iterable<String>.autoPage(lines: Int = 10): List<String>`  evidence: mapInfo.kts:72-86
  - `fun String.autoWrapLine(limit: Int = 25): String`  evidence: mapInfo.kts:88-102
  - `fun ShopBuilder.xxx` / `patch[T] = ...`  evidence: 1005.kts（数据补丁 DSL）
```

---

## GROUP D — 循环与查询

### D.1 Groups.* （语料全集）

| `Groups.*` | 次数 | 证据 |
|---|---|---|
| `Groups.player` | 33 | `Groups.player.forEach { }`、`Groups.player.count { }`、`Groups.player.filter { }`、`Groups.player.size()`、`Groups.player.any { }`、`Groups.player.map { }`、`Groups.player.mapTo(mutableSetOf()) { it.team() }`(13545.kts:62)、`Groups.player.toList()`(share.api.kt:38)、`Groups.player.getByID(int)`(share.api.kt:21)、`Groups.player.associateBy { }`(share.api.kt:23) |
| `Groups.unit` | 6 | `Groups.unit.size()`(variables.kts:39)、`Groups.unit.forEach { }`(limitAir.kts:10)、`Groups.unit.filter { }`(unitLimit.kts:28,55)、`Groups.unit.toList()`(clearUnit.kts:7) |
| `Groups.build` | 2 | `Groups.build.filter { it.block in blocksToOpen }`(14562.kts:30)、`Groups.build.filterIsInstance<CoreBuild>()`(betterTeam.kts:69) |
| `Groups.fire` | 1 | `Groups.fire.size()`(limitFire.kts:5) |

```
[VERIFIED] Groups.player / Groups.unit / Groups.build / Groups.fire  —— 全是 EntityGroup，支持 Seq 风格 API
  evidence(各方法):
      .size()           变量.kts:39,41 ; limitFire.kts:5 `Groups.fire.size()`
      .forEach {}       limitAir.kts:10 ; restart.kts:34 ; mapInfo.kts:54
      .filter {}        unitLimit.kts:28 ; betterTeam.kts:69 ; 14562.kts:30
      .filterIsInstance<T>()  betterTeam.kts:69
      .count {}         autoChangeMap.kts:16 ; betterTeam.kts:93
      .any {}           vote.kts:39 ; module.kts:50
      .map {}           autoGameover.kts:12 `Groups.player.map { it.team() }.toSet()`
      .mapTo(mutableSetOf()) {}  13545.kts:62
      .toList()         clearUnit.kts:7 ; share.api.kt:38
      .toArray()        vote.kts:34 ; autoGameover.kts:19
      .associateBy {}   share.api.kt:23
      .getByID(Int)     share.api.kt:21
  notes: ⚠ `Groups.X` 是 arc 的 `Seq`，不是 Kotlin List —— `.size()` 是**方法**（带括号），
         但扩展函数 `.filter/.map/.forEach/.count/.any/.toList` 都可用（Kotlin 集合扩展作用于 Iterable）
         ⚠ `Groups.player.size()` 有括号，而 `Team.all.size` 无括号（List 属性）—— 语料中两者都出现

[NOT FOUND] Groups 的其它成员（Groups.block / Groups.unitGroup / Groups.buildings / Groups.all / Groups.bullet …）
  tried: grep 'Groups\.[a-zA-Z]+' 全语料 → 只有上面 4 个
  notes: ⚠ 不要写 `Groups.block`（不存在于语料）、`Groups.bullet` 等。想遍历方块用 `Groups.build`。
```

### D.2 带索引遍历

```
[NOT FOUND] forEachIndexed
  tried: grep 'forEachIndexed|withIndex\(\)' over all *.kt/*.kts → 0 hit

[VERIFIED] mapIndexed { index, item -> }   （语料中唯一出现的带索引导航）
  evidence: maps.kts:19 `maps.defaultMaps().mapIndexed { i, map -> MapInfo(this, i + 1, Gamemode.survival, map) }`
            maps.kts:23 同型
            hexed.HexData.kt:79 `hexes = hex.mapIndexed { index, point2 -> Data(index, ...) }`
            999.kts:74 `generator.chunkCenters.filter{...}.mapIndexed { i, center -> ... }`
            spawnMob.kts:17 `list.mapIndexed { i, type -> "[yellow]$i[green]($type)" }.joinToString()`

[VERIFIED] 用 `repeat(n) { i -> }` 做固定次数循环（含索引）
  evidence: 14562.kts:68 `repeat(5) { ... }` ; unitLimit.kts:33 `repeat(min(toKill, m.size)) { m[it].kill() }`
            spawnMob.kts:28 `repeat(num) { type.create(team)... }`
            mapSnap.kts:16-20 `repeat(world.width()) { x -> ... }`
            1005.kts `repeat(prePage) { ... }`
  notes: `it` 即索引（0 起）

[VERIFIED] 传统 for / while / forEach
  evidence: history.kts:159-160 `for (x in event.tile.x.let { it - 10..it + 10 }) for (y in ...)`
            autoSave.kts `for (...)` ; unitLimit.kts:18 `inner fun`
            while: history.kts:60 `while (size >= historyLimit)` ; vote.kts:51 `while (state.enemies > max(...))`
```

### D.3 半径查询

```
[VERIFIED] Units.count(x, y, radius) { predicate } -> Int      ⚠ 第三参是 **Float（世界像素半径）**
  syntax: Units.count(tile.worldx(), tile.worldy(), unit.physicSize()) { it.isGrounded && it.hitSize > 14.0F }
  evidence: wayzer/cmds/gatherTp.kts:59
      return unit.canPass(tile.x.toInt(), tile.y.toInt()) &&
              Units.count(tile.worldx(), tile.worldy(), unit.physicSize()) { it.isGrounded && it.hitSize > 14.0F } > 0
  notes: ⚠ 语料中 **只有 1 处** `Units.count`。
         ⚠ `Units.count` 需要 `import mindustry.entities.Units`（gatherTp.kts:6）
         ⚠ 传入 `unit.physicSize()`（Float）—— 语料未展示它是否要求 int；按字面是 Float/世界像素，x/y 用 worldx()/worldy()

[VERIFIED] Units.closestEnemy(team, x, y, range) { predicate } -> Teamc?
  syntax: Units.closestEnemy(unit.team, x, y, range) { !invalid(it) }
  evidence: mapScript/tags/towerDefend.ai.kt:26（`import mindustry.entities.Units` at :4）
  notes: 4 参 + 谓词；返回可空

[NOT FOUND] Units.nearby(...)
  tried: grep 'Units\.nearby' → 0 hit
  notes: ⚠⚠ 语料中**不存在** `Units.nearby`。不要写。
         要取附近的方块/单位，语料中的替代做法：
           - `Geometry.circle(cx, cy, radius) { x, y -> }`（spawnAround.api.kt:17，`import arc.math.geom.Geometry`）
           - `tile.circle(radius) { x, y -> }`（14562.kts:29）
           - `Groups.unit.filter { ... }` + `dst/within`
           - `Units.closestEnemy(...)` / `Units.count(...)`

[VERIFIED] Unit.closestEnemyCore() / Unit.canPass(x, y) / Unit.within(target, range) / Unit.dst(target)
  evidence: closestEnemyCore: limitAir.kts:11 ; TDDrop.kts:126 ; towerDefend.ai.kt:25,30
            canPass: gatherTp.kts:58 `unit.canPass(tile.x.toInt(), tile.y.toInt())` ; spawnAround.api.kt:18
                     towerDefend.ai.kt:32 `unit.within(core, range)`
            dst: towerDefend.kts:49 `core.dst(it.tile) < 80` ; mapScript 中 `it.dst(centerChunk)`
            dst2: pvpProtect.kts:15 `it.cores.minByOrNull(this::dst2)`

[VERIFIED] Geometry.circle(cx, cy, radius) { x, y -> }
  evidence: coreMindustry/util/spawnAround.api.kt:17
      Geometry.circle(tileX(), tileY(), Vars.world.width(), Vars.world.height(), radius) { x, y -> ... }
  notes: ⚠ 这是 **6 参**重载（cx, cy, width, height, radius, consumer）——spawnAround 用它把生成点限制在地图内
         4 参版本 `Geometry.circle(0, 0, 4) { dx, dy -> }` 见 mapScript/tags/towerDefend.kts:35

[VERIFIED] 附近可通行点生成：UnitType.spawnAround(pos, team, radius=10): Unit?
  signature: coreMindustry/util/spawnAround.api.kt:13 `fun UnitType.spawnAround(pos: Posc, team: Team, radius: Int = 10): mindustry.gen.Unit?`
  evidence: 13545.menu.kt:107 `type.spawnAround(build, build.team)?.apply { ... } != null`
            :141 `UnitTypes.mono.spawnAround(build, build.team)?.apply { controller(MonoAI()) ... } != null`
  notes: 需 `@file:Depends("coreMindustry/util/spawnAround")`（13545.kts:2）
```

### D.4 Teams

```
[VERIFIED] Team.all   （List<Team>，索引 = team id）
  evidence: hexed.HexData.kt:107 `Team.all.first { ... }`
            autoExchange.kts:39 `val score = IntArray(Team.all.size)` ; :73 `Team.all.forEach { }`
            spawnMob.kts:20 `Team.all.getOrNull(it)`
            observer.kts:67 `Team.all.getOrNull(it)`
            betterTeam.api.kt:19 `Team.all[255]!!`
            betterTeam.kts:78-79 `.mapNotNull { Team.all.getOrNull(it.toIntOrNull() ?: -1) }.toSet()`
            autoGameover.kts:10 `IntArray(Team.all.size)`
            pvpAlert.kts:24 `arrayOfNulls<TeamData>(Team.all.size)`
            maps.kts:153 `Team.all.firstOrNull { t -> t.name == it }`
  notes: 需要 `import mindustry.game.Team`

[VERIFIED] Team.baseTeams   （List<Team>）
  evidence: spawnMob.kts:22 `Team.baseTeams.mapIndexed { i, type -> ... }`

[NOT FOUND] 顶层 `Teams.all`
  tried: grep '\bTeams\.' → 0 hit（`Teams` 只作为 `TeamData`/`teams` 局部变量出现）
  notes: ⚠ 语料中没有 `Teams` 这个类。有的是：
           - `state.teams`（Vars.state.teams，TeamData 管理器）：`state.teams.getActive()`(betterTeam.kts:14)、
             `state.teams.active`(hexed.HexData.kt:95)、`state.teams.isActive(t)`(vote.kts:20)、`state.teams.get(t)!!`(vote.kts:20)
           - `Team.all` / `Team.baseTeams`
           - wayzer 的 `TeamService.allTeam`（`val teams by Services.get<TeamService>().notNull` → `teams.allTeam`）
             evidence: observer.kts:13,75 ; autoGameover.kts:8,13
```

### D.5 过滤 / 辅助（语料中真实使用的）

```
[VERIFIED] Kotlin 标准库集合操作（无自定义封装）
  .filter/.filterNot/.filterIsInstance<T>()/.map/.mapTo/.mapIndexed/.mapNotNull/.flatMap/.associateBy
  .any/.all/.none/.count/.sumOf/.find/.first/.firstOrNull/.singleOrNull/.minByOrNull/.maxByOrNull
  .sortedBy/.sortedByDescending/.shuffled()/.toSet()/.toList()/.toArray()/.distinct()
  证据示例:
      .filterNot {}    unitLimit.kts:29 ; spawnMob.kts:14 ; backCompatibility.kts:14
      .filterIsInstance<CoreBuild>()  betterTeam.kts:69
      .mapNotNull {}   CommandApi.kt 相关 ; betterTeam.kts:79
      .flatMap {}      mapScript/module.kts:43
      .any {} / .all {} / .none {}  towerDefend.kts:49 / CommandApi.kt:364 / pvpAlert.kts:78
      .count {}        autoChangeMap.kts:16 ; hexed.HexData.kt:121 ; betterTeam.kts:93 ; vote.lib.kt:121-123
      .sumOf {}        autoExchange.kts:63 `content.items().sumOf { item -> ... }`
      .find {}         mapScript/module.kts:31 ; spawnAround.api.kt 无
      .firstOrNull {}  maps.kts:153 ; configCmd.kts:20
      .singleOrNull {} betterTeam.kts:58 `allTeam.singleOrNull()?.let { ... }`
      .minByOrNull {}  betterTeam.kts:93 ; pvpProtect.kts:15
      .sortedBy {}     unitLimit.kts:30 `sortedBy { it.health }` ; 1005.kts:109
      .shuffled()      betterTeam.kts:92 `allTeam.shuffled()`
      .randomOrNull()  spawnAround.api.kt:21 ; hexed.HexData.kt:102 ; pvpProtect.kts:35 ; maps.registry.kt:102
      .random()        maps.registry.kt:102 `maps.random()`
      .getOrNull(i)    spawnMob.kts:20 ; observer.kts:67 ; configCmd.kts:41
      .takeIf {}       helpful.kts:10 ; hexed.HexData.kt:117 ; 999.kts:163
      .also {}         many
      .let {}          many
      .runCatching {}  pixelPicture.kts:64 ; variables.kts:40 ; autoUpdate.kts:45
      .removeIf {}     betterTeam.kts:16 ; vote.lib.kt:130
      .removeAll {}    helpful.kts:33 ; betterTeam.kts:17（within apply on MutableSet）
      .joinToString()  ban.kts:72 ; spawnMob.kts:17 ; configCmd.kts:93
      .isEmpty()/.isNotEmpty()  遍布
      .contains(x) / `x in list`  scoreboard.kts:52 ; towerDefend.kts:49,79
      size / indices / subList  `menu.kt:17 subList(...)` ; 1005.kts:110
  notes: ✅ 没有任何语料自定义的 filter/query helper —— 全部走 Kotlin 标准库

[VERIFIED] `content.getBy<T>(ContentType.x)` / `content.blocks()` / `content.items()` / `content.units()`
  evidence: spawnMob.kts:14 `content.getBy<UnitType>(ContentType.unit)`
            autoExchange.kts:24 `blocks().filterIsInstance<CoreBlock>()`
            autoExchange.kts:61,66 `content.items().sumOf {} / .forEach {}`
            1005.kts:49 `content.units().select { it.buildSpeed > 0 && it.flying }`
            14562.kts:24 `content.getByName(ContentType.block, it) as? Floor`
  notes: `content` 来自 `mindustry.Vars.*`（默认导入）。需 `import mindustry.ctype.ContentType`
```

---

## GROUP E — 数据操作

### E.1 跨脚本共享可变状态

```
[VERIFIED] @Savable / @Savable(false) / @Savable(serializable = false)  —— 脚本级持久化变量注解
  evidence: mapScript/tags/mapRule.kts:11-12
      @Savable(false)
      var permissions: List<String> = emptyList()
  evidence2: wayzer/ext/observer.kts:15-16
      @Savable(serializable = false)
      val obTeam = mutableMapOf<Player, Team>()
  evidence3: wayzer/user/ext/whiteList.kts:17-18 `@Savable(false) var serverId = UUID.randomUUID().toString()`
             wayzer/user/suffix.kts:22 `@Savable`（无参 → 序列化开启）
             wayzer/user/nameExt.kts:6 `@Savable(serializable = false)`
             wayzer/map/mapInfo.kts:3 `@Savable(false)`
             wayzer/cmds/voteOb.kts:15 `@Savable(false)`
  notes: ⚠⚠ 语料中**没有** `import ...Savable` —— 它由 SA 框架默认导入（`cf.wayzer.scriptAgent.*` 一类），
         脚本里直接 `@Savable` 即可。
         ⚠ 两种写法并存：`@Savable(false)`（位置参数）与 `@Savable(serializable = false)`（命名参数）
           → 参数名是 `serializable`，第一个构造参数即它。
         ⚠ 语义（由用法推断）：`@Savable(false)` = 标记为"不参与跨局序列化"，用 `customLoad` 手工恢复。

[VERIFIED] customLoad(::property) { loaded -> }   —— 反序列化回调
  evidence: wayzer/ext/observer.kts:15-19
      @Savable(serializable = false)
      val obTeam = mutableMapOf<Player, Team>()
      customLoad(::obTeam) {
          obTeam.putAll(it.filterKeys { p -> p.con != null })
      }
  evidence2: wayzer/user/nameExt.kts:6-8 `@Savable(serializable = false) val realName = ...; customLoad(::realName) { realName.putAll(it) }`
             wayzer/cmds/voteOb.kts:15-17 `customLoad(::limitPlayers) { limitPlayers.putAll(it) }`
             wayzer/user/suffix.kts:22-24 `@Savable; customLoad(::clientType) { clientType.putAll(it) }`
             wayzer/map/mapInfo.kts:3-5 `@Savable(false) val customModeIntroduce = mutableListOf<String>(); customLoad(::customModeIntroduce, customModeIntroduce::addAll)`
  notes: ✅ 两种重载：
           `customLoad(::prop) { value -> ... }`           （observer / nameExt / voteOb / suffix）
           `customLoad(::prop, prop::addAll)`              （mapInfo.kts:5，第二参是 setter 函数引用）
         ⚠ 形参 `it` 就是被反序列化出来的值

[VERIFIED] export(::fn)   —— 把本脚本的函数导出，供依赖方通过 depends()?.import<FnType>("name") 调用
  evidence: 定义方: wayzer/map/betterTeam.kts:102 `export(::changeTeam)`
                    wayzer/cmds/restart.kts:44 `export(::scheduleRestart)`
                    mapScript/shared/posMark.kts 无 ; wayzer/map/mapInfo.kts:11 `export(::addModeIntroduce)`
                    wayzer/ext/observer.kts:21 `export(::getObTeam)`
                    coreMindustry/util/nextChat.kts:8 `export(::nextChat)`
                    wayzer/cmds/voteMap.kts:25 `export(::voteMap)`
            消费方: wayzer/cmds/mapsCmd.kts:39
                        depends("wayzer/cmds/voteMap")?.import<(Player, MapInfo) -> Unit>("voteMap")
                    wayzer/ext/autoUpdate.kts:94
                        depends("wayzer/cmds/restart")?.import<(String, Runnable) -> Unit>("scheduleRestart")
                    wayzer/map/ContentExt.kt:13
                        depends("wayzer/map/mapInfo")?.import<(String, String) -> Unit>("addModeIntroduce")
  notes: ✅ 语法：`depends("<scriptId>")?.import<函数类型>("导出名")`；`?.` 因为可能是软依赖
         ✅ 对应 `@file:Depends("<scriptId>", soft = true)`

[VERIFIED] autoInit { }   —— 懒初始化（首次使用时执行，可访问游戏世界）
  evidence: wayzer/user/lang.kts:11-13 `val settings by autoInit { Services.get<KVStore>().get().open("langSettings", StringDataType.INSTANCE) }`
            wayzer/store/whileListCache.kts:38-41 `val localCache by autoInit { ... }`
            mapScript/shared/posMark.kts:21-30 `val posMap by autoInit { world.tiles.forEach { ... } }`
  notes: ⚠ `by autoInit { ... }` 是**委托**；`posMap` 在 `world` 可用后才构造（地图脚本初始化顺序敏感）

[VERIFIED] KVStore（coreLib.extApi）—— 简单 KV 持久化
  接口: coreLibrary/extApi/lib/KVStore.kt:8-11
      package coreLib.extApi
      interface KVStore {
          fun <V> open(name: String, type: DataType<V>) = open(name, type, StringDataType.INSTANCE)
          fun <K, V> open(name: String, key: DataType<K>, type: DataType<V>): MVMap<K, V>
      }
  实现: coreLibrary/extApi/KVStore.kts:1-23（H2 MVStore，文件 `data/kvStore.mv`）

  ✅ **精确的 @file:Depends 字符串**：`"coreLibrary/extApi/KVStore"`
     evidence: wayzer/user/lang.kts:2 `@file:Depends("coreLibrary/extApi/KVStore", "储存语言设置")`
               wayzer/store/whileListCache.kts:2 `@file:Depends("coreLibrary/extApi/KVStore", "储存记录")`

  ✅ **完整可用示例（wayzer/user/lang.kts:1-24）**：
      @file:Depends("coreLibrary/lang", "多语言支持-核心")
      @file:Depends("coreLibrary/extApi/KVStore", "储存语言设置")

      package wayzer.user

      import coreLib.extApi.KVStore
      import org.h2.mvstore.type.StringDataType

      val settings by autoInit {
          Services.get<KVStore>().get().open("langSettings", StringDataType.INSTANCE)
      }

      var PlayerData.lang: String
          get() = settings[id] ?: player?.locale ?: "zh"
          set(v) {
              if (lang == v) return
              if (v == player?.locale) settings.remove(id)
              else settings[id] = v
          }

  ✅ 第二个示例（wayzer/store/whileListCache.kts:38-41）：
      val localCache by autoInit {
          val map = Services.get<KVStore>().get().open("authCache", StringDataType.INSTANCE)
          CacheImpl(map) as AuthCache
      }

  notes:
    - ⚠ 需要 3 个 import：`import coreLib.extApi.KVStore`、`import org.h2.mvstore.type.StringDataType`
      （以及可选 `import coreLib.extApi.get` / `register` —— whileListCache.kts:7-8 有，实际用的是 `RpcService` 的）
    - ⚠ 包名是 **`coreLib.extApi`**（不是 `coreLibrary.extApi`），而 `@file:Depends` 的脚本路径用 `coreLibrary/extApi/KVStore`
    - ⚠ 取服务：`Services.get<KVStore>().get()`（ServicesExt.kt:7 `fun <T> Services.Registry<T>.get(): T`）
    - ⚠ 返回值是 `MVMap<K,V>`（`org.h2.mvstore.MVMap`），可读不可为 MutableMap 接口任意类型；
      `KVStore.kt` 返回类型写死 `MVMap<K,V>`，但 `whileListCache.kts:39-40` 把它当 `MutableMap<String,String>` 用
      （`CacheImpl(private val map: MutableMap<String, String>)`）→ MVMap 实现 Map 接口
    - ⚠ `extApi` **没有 module.kts**（README:323 明确说明）→ 必须逐脚本 `@file:Depends`
```

### E.2 列表操作

```
[VERIFIED] mutableListOf / mutableMapOf / mutableSetOf / IntArray / Array / buildList / listOf / emptyList
  evidence: mutableListOf: varsCmd.kts:13 ; history.kts:158 ; spawnAround.api.kt:16 ; posMark.kts? 
            mutableMapOf: betterTeam.kts:44 ; posMark.kts:45 ; 1001.kts 相关 ; observer.kts:16
            mutableSetOf: history.kts:117 `val enabledPlayer = mutableSetOf<String>()` ; 13545.menu.kt:24 ;
                          towerDefend.kts:26 `mutableSetOf<Floor>()` ; pvpAlert.kts:19-21
            IntArray: autoExchange.kts:37 `IntArray(Team.all.size)` ; autoGameover.kts:10
            Array: history.kts:43 `Array(world.width() * world.height()) { emptyList() }` ;
                   mapSnap.kts:15 ; history.kts:149 `arrayOf(Blocks.thoriumReactor, ...)`
            buildList: mapScript/module.kts:38 ; PermissionApi 内部 ; posMark.kts:22
            emptyList/emptySet: mapInfo.kts:12 ; betterTeam.kts:21,46
  notes: `arrayOfNulls<TeamData>(Team.all.size)`（pvpAlert.kts:24）

[VERIFIED] add / remove / contains / size / isEmpty / clear / joinToString
  逐条证据：
    add          : history.kts:62 `add(log)` ; posMark.kts:16 ; towerDefend.kts:29-32 `add(Blocks.arc)`
                   也用于列表 +=（posMark.kts:26 `addAll(parsed)`；mapInfo.kts:9 `customModeIntroduce += "..."`）
    remove       : history.kts:61 `remove()`（LinkedList 无参，移除头部）; :130 `enabledPlayer.remove(...)`
                   betterTeam.kts:87 `savedTeams.remove(player.uuid())` ; towerDefend.kts:40 `floors.clear()`
    contains     : scoreboard.kts:52 `if (disabled.contains(it.uuid())) return@forEach`
                   autoUpdate.kts:43 `source.contains("MindustryX")`
                   也常用 `x in list`：towerDefend.kts:79 `tile.block() in allowBlocks`
    size         : history.kts:60 `while (size >= historyLimit)` ; ban.kts:68 `if (arg.size < 3)`
                   Groups 上是 `.size()`（方法）
    isEmpty      : history.kts:58 `logs[pos].isEmpty()` ; control.kts:102 `arg.isEmpty()`
    isNotEmpty   : CommandApi.kt:130 ; mapInfo.kts:15,43
    clear        : towerDefend.kts:40 `floors.clear()` ; vote.kts:64 `team.data().plans.clear()`
                   mapInfo.kts:12 ; betterTeam.kts:47 `savedTeams.clear()` ; PermissionApi.kt:126 `groups.clear()`
    joinToString : ban.kts:72 `arg.slice(2 until arg.size).joinToString(" ")`
                   TDDrop.kts:126 `drop.joinToString(" ") { ... }`
                   spawnMob.kts:17 `.joinToString()` ; configCmd.kts:93
    removeFirstOrNull : 14562.kts:69 `IslandTile.discoverQueue.removeFirstOrNull()`
    removeLast / lastOrNull : history.kts:161 `.lastOrNull { it is Log.Place }`
    putAll       : observer.kts:18 `obTeam.putAll(it.filterKeys { ... })`
    LinkedList   : history.kts:58-59 `LinkedList(listOf(log))` + `while (size >= historyLimit) remove()`
  notes: ✅ 全部是 Kotlin 标准库，无语料自定义容器
```

### E.3 数字操作

```
[VERIFIED] 随机数 —— 语料中出现 4 种，**都真实可用**
  (a) kotlin.random.Random.nextInt(from, until) / nextInt() / nextFloat()
      evidence: textInput.api.kt:26 `val id = Random.nextInt(Int.MIN_VALUE, 0)`
                menu.lib.kt:103 `private val _menuId = Random.nextInt()`
                menu.new.kt:155 同
                TDDrop.kts:129 `Random.nextInt(it.amount - it.amount / 2, it.amount + it.amount * 2)`
                TDDrop.kts:134,138 `Random.nextFloat()`
                vote.kts:34 `Time.run(Random.nextFloat() * 60 * 3, it::kill)`
      notes: 需要 `import kotlin.random.Random`（menu.lib.kt:12、TDDrop.kts:8、vote.kts:12）

  (b) arc 的 Mathf.random(min, max)   ⚠ 不是 Mathf.rand
      evidence: hexed.GeneratorHelper.kt:34-35
          val seed1 = Mathf.random(0, 10000)
          val seed2 = Mathf.random(0, 10000)
      notes: 需要 `import arc.math.Mathf`（hexed.GeneratorHelper.kt:3）

  (c) 集合的 .random() / .randomOrNull()
      evidence: maps.registry.kt:102 `maps.filter { ... }.randomOrNull() ?: maps.random()`
                spawnAround.api.kt:21 `valid.randomOrNull() ?: return null`
                hexed.HexData.kt:102 ; pvpProtect.kts:35

  (d) Mathf.chance(probability)
      evidence: hexed.GeneratorHelper.kt:75 `if (tile.block() === air && Mathf.chance(0.03))`

  [NOT FOUND] `Mathf.rand(...)` 或裸 `rand()`
    tried: grep 'Mathf\.rand[^o]|\brand\(' → 0 hit
    notes: ⚠⚠ 语料中**没有** `Mathf.rand`。随机数请用 `Random.nextInt/nextFloat` 或 `Mathf.random`。

[VERIFIED] 取整 / 舍入
  evidence: 13545.menu.kt:82 `fun Float.fix() = (this * 100).roundToInt() / 100f`
            :85 `((value.get() - 1) / delta).roundToInt()`
            :105-106,140 `${electrifiedTime.roundToInt()}`、`{ cost().roundToInt() }`
            variables.kts:15 `import kotlin.math.roundToLong` ; :47 `pauseTime.roundToLong()`
            history.kts:94-95 `val x = xf.toInt() / 8`（截断）
  notes: ✅ 需要 `import kotlin.math.roundToInt` / `roundToLong`（13545.menu.kt:21、variables.kts:15）
         ⚠ 语料中**没有** `Mathf.round(...)`。要四舍五入用 Kotlin 的 `roundToInt()`。

[VERIFIED] min / max / 夹紧
  min : unitLimit.kts:33 `repeat(min(toKill, m.size))`（`import kotlin.math.min` at unitLimit.kts:8）
         1005.kts 等
  max : lang.kts:85 `this.lastUse = max(this.lastUse, lastUse)`（`import kotlin.math.max`）
         vote.kts:51 `while (state.enemies > max(before, (after - before) * 3 / 10))`（vote.kts:11 import）
  clamp — 用 coerceIn 而非 clamp：
        hexed.GeneratorHelper.kt:41 `.coerceIn(0, blocks.size - 1)` ; :44
        vote.kts:42 `(arg.firstOrNull()?.toIntOrNull() ?: 10).coerceIn(1, 50)`
  coerceAtMost / coerceAtLeast:
        menu.kt:11 `page.coerceAtMost(totalPage).coerceAtLeast(1)`
        menu.kt:17 `(newPage * prePage).coerceAtMost(list.size)`
        variables.kts:21 `Core.graphics.framesPerSecond.coerceAtMost(255)`
        towerDefend.ai.kt:31 `(unit.type.range * 0.8f).coerceAtMost(80f)`
        autoExchange.kts:58 `(this / item.score).coerceAtLeast(0)`
        limitLogicPacket.kts:24 `... .coerceAtLeast(0.0)`
  notes: ⚠ 语料中**没有** `Mathf.clamp(...)` / `.clamp(...)`。夹紧一律 `coerceIn/coerceAtMost/coerceAtLeast`。

[VERIFIED] 其它数学
  Mathf.sqrt : 13545.menu.kt:101 `Mathf.sqrt(baseCost.toFloat())`
  Mathf.sqrt3: hexed.HexedGenerator.kt:49 ; 1003.kts:68 ; 999.kts:52 `(spacing - wallWidth) * 2 / Mathf.sqrt3`
  `.pow(x)`  : 13545.menu.kt:94,95,96 `(count * 0.1).pow(3)`（`import kotlin.math.pow` at :20）
  kotlin.math.sqrt : 999.kts:16 import
  `.toInt()/.toFloat()/.toLong()/.toIntOrNull()/.toFloatOrNull()/.toDouble()`
      evidence: spawnMob.kts:15,20,26,27 ; maps.kts:131 ; vote.kts:42 ; observer.kts:67
```

### E.4 时间

```
[VERIFIED] arc.util.Time.time         （Float，游戏时间，秒；暂停时不增长）
  evidence: wayzer/reGrief/limitLogicPacket.kts:18 `private var lastTime = Time.time`
            :22 `val delta = Time.time - lastTime`  :25 `lastTime = Time.time`
            wayzer/map/autoSave.kts:41 `val nextTime = nextSaveTime.time`（⚠ 这里是 java.util.Date.time，不是 arc Time）
  notes: 需要 `import arc.util.Time`；用于帧间 delta 计算

[VERIFIED] arc.util.Time.delta        （Float，上一帧耗时）
  evidence: coreMindustry/variables.kts:109 `pauseTime += Time.delta / 60`

[VERIFIED] arc.util.Time.millis()     （Long，游戏运行毫秒）
  evidence: mapScript/1004.kts:86 `val startTime = Time.millis()`

[VERIFIED] arc.util.Time.timeSinceMillis(startTime)   （Float/Long，秒）
  evidence: mapScript/1004.kts:88 `val seconds = (Time.timeSinceMillis(startTime) / 1000).toInt()`
            1004.kts:99 同型

[VERIFIED] arc.util.Time.toSeconds / Time.toSeconds 常量
  evidence: wayzer/reGrief/limitLogicPacket.kts:24 `... * Time.toSeconds`

[VERIFIED] arc.util.Time.run(delay, runnable)   —— 延时执行（游戏时间）
  evidence: wayzer/cmds/vote.kts:34 `Time.run(Random.nextFloat() * 60 * 3, it::kill)`

[VERIFIED] arc.util.Interval   —— 冷却计时器（配合 Trigger.update）
  evidence: wayzer/reGrief/unitLimit.kts:13 `val interval = Interval(1)` ; :18 `if (interval[0, 2 * 60f])`
            coreMindustry/util/../../lib/DispatcherExt.kt:21 `private val warnTimer = Interval()`
            wayzer/reGrief/limitLogicPacket.kts:31 `val interval = Interval()`
            wayzer/ext/autoUpdate.kts:26 `val logInterval = Interval()`
  notes: `interval[index, seconds]` 返回 Boolean（到期为 true）。需 `import arc.util.Interval`

[VERIFIED] 真实时间
  System.currentTimeMillis() : history.kts:157,167 ; 999.kts:167,171 ; skills.lib.kt:49,52,64
                               vpAlert.kts 无 ; ban.kts 用 Instant
  java.time.Instant.now()    : wayzer/cmds/gatherTp.kts:20,32,38 `lastTime: Instant = Instant.MIN`
                               coreMindustry/variables.kts:101,104 ; vote.kts:44
  Instant.MIN                : gatherTp.kts:20
  java.time.Duration         : gatherTp.kts:32 `Duration.between(lastTime, Instant.now()) < Duration.ofSeconds(10)`
                               variables.kts:47 `Duration.ofSeconds(...)`
                               skills.lib.kt:52 `Duration.ofMillis(...)`
                               ban.kts:48 `Duration.ofMinutes(time.toLong())`
  java.util.Date()           : history.kts:12 `val time = Date()` ; variables.kts:71 `it.lastKicked.let(::Date)`
  DateFormat.getDateTimeInstance().format(Date.from(instant))  : ban.kts:15
  SimpleDateFormat("YYYYMMdd-hhmm").format(Date())             : mapSnap.kts:89
  Calendar.getInstance() + t.set/t.add/t.time                   : autoSave.kts:32-36
  kotlin.time.Duration.Companion.minutes/seconds               : hexed.kts:30 `delay(1.minutes)`
                               autoChangeMap.kts:14 `delay(1.seconds)`（import kotlin.time.Duration.Companion.seconds at :7）
  kotlin.time.Duration + `it.send().awaitWithTimeout(10.minutes)` : whiteList.kts:88
  `state.tick`               : variables.kts:50 `Duration.ofMillis((state.tick / 60 * 1000).toLong())`
  `state.gameTime`（mapScript 扩展）: mapScript/lib/util.kt:27 `val GameState.gameTime get() = (Vars.state.tick / 60).seconds`

[VERIFIED] 延时
  kotlinx.coroutines.delay(ms: Long)      : autoGameover.kts:36 `delay(30000)` ; :39 `delay(1000)`
                                            ban.kts:29 ; loop 内 delay(3_000)（limitAir.kts:9）
  delay(kotlin.time.Duration)             : hexed.kts:30 `delay(1.minutes)` ; autoChangeMap.kts:14 `delay(1.seconds)`
                                            maps.kts:116 `delay(waitingTime.toMillis())`（java Duration → Long）
  nextTick()（coreMindustry 扩展）        : pixelPicture.kts:82 `nextTick()`（import? DispatcherExt 同包）
  Core.app.post { }                        : mapInfo.kts:61 ; unitLimit.kts:54 ; restart.kts:42
  自定义按游戏时间调度: mapScript/lib/util.kt:30-49
      suspend fun delayUntil(gameTime: Duration)
      fun CoroutineScope.schedule(time: Duration, context: CoroutineContext = EmptyCoroutineContext, body: suspend CoroutineScope.() -> Unit)
  `loop {}`（coreLibrary.lib.util）       : limitAir.kts:8 `loop(Dispatchers.game) { delay(3_000); ... }`
                                            autoChangeMap.kts:13 ; autoSave.kts:40 ; autoGameover.kts:35-41
      signature: coreLibrary/lib/util/coroutine.kt:13
          fun Script.loop(context: CoroutineContext = EmptyCoroutineContext, block: suspend CoroutineScope.() -> Unit)
      notes: 异常自动捕获 + sleep 10s 重试（coroutine.kt:18-22）
  `launch(Dispatchers.game) { delay(...) }` : autoGameover.kts:35-41 ; hexed.kts:29-32 ; 14562.kts:48-51
```

---

## GROUP F — 工具（随机 / 时间 / 属性）

### F.1 随机数（精确调用）

```
[VERIFIED] kotlin.random.Random.nextInt(until) / nextInt(from, until) / nextFloat()
  syntax: Random.nextInt()                       // 全 Int 范围，可作菜单 id
          Random.nextInt(Int.MIN_VALUE, 0)       // 负数 id（文本输入）
          Random.nextInt(a, b)                   // [a, b)
          Random.nextFloat()                     // [0, 1)
  evidence: menu.lib.kt:103 ; menu.new.kt:155 ; textInput.api.kt:26 ; TDDrop.kts:129,134,138 ; vote.kts:34
  notes: `import kotlin.random.Random`

[VERIFIED] Mathf.random(min, max)
  evidence: hexed.GeneratorHelper.kt:34-35 `Mathf.random(0, 10000)`
  notes: `import arc.math.Mathf`

[VERIFIED] collection.random() / collection.randomOrNull()
  evidence: maps.registry.kt:102 ; spawnAround.api.kt:21 ; hexed.HexData.kt:102 ; pvpProtect.kts:35

[VERIFIED] Mathf.chance(p: Float): Boolean
  evidence: hexed.GeneratorHelper.kt:75 `Mathf.chance(0.03)`
```

### F.2 当前时间 / 格式化时间

```
[VERIFIED] Date() + SimpleDateFormat        : mapSnap.kts:89 `SimpleDateFormat("YYYYMMdd-hhmm").format(Date())`
[VERIFIED] Date() + DateFormat              : ban.kts:15 `DateFormat.getDateTimeInstance().format(Date.from(instant))`
[VERIFIED] Date 作为占位变量参与 `{date hh:mm}` : autoSave.kts:18 `.with("date" to file.lastModified().let(::Date))`
[VERIFIED] Duration 占位格式化 `{time 秒}` / `{time HH:mm:ss}` :
            skills.lib.kt:52 `"[red]技能冷却，还剩{time 秒}".with("time" to Duration.ofMillis(...))`
            history.kts:26,31 `"[red]{time HH:mm:ss}..."` with `"time" to time`（java.util.Date）
            variables.kts:47 注释 & README:299 说明 Duration 的 `{x 秒}/{x 分钟}` 格式化由 coreLibrary/variables.kts 注册
[VERIFIED] 游戏内时间 : state.tick（variables.kts:50）, `state.gameTime` 扩展（mapScript/lib/util.kt:27）
[VERIFIED] 进程运行时间 : variables.kts:42 `Duration.between(startTime, Instant.now())`
[VERIFIED] 本局开始时间 : variables.kts:101 `var startTime = Instant.now()!!` + :103-106 WorldLoadEvent 时重置
```

### F.3 读取玩家名/坐标/单位

```
[VERIFIED] player.name  (String, 属性)
  evidence: coreMindustry/variables.kts:57 `registerChild("name", "名字") { it.name }`
            nameExt.kts:41 `realName[p.uuid()] = p.name`
            999.kts:180 `text = player.name`
  notes: ⚠ `player.name` 是**属性**（无括号）；`PlayerInfo.lastName` 才是"可能带颜色"的名字（variables.kts:68）

[VERIFIED] player.tileX() / player.tileY()   —— 玩家所在格子坐标（Int）
  evidence: wayzer/cmds/pixelPicture.kts:79 `draw(p.tileX() - img.width / 2 + x, p.tileY() + img.height / 2 - y, ...)`
  notes: ⚠ 是**方法**（带括号）。语料仅 1 处使用（pixelPicture）。
         另可对比 Unit 的 `unit.tileX()/tileY()`（spawnAround.api.kt:17 `Geometry.circle(tileX(), tileY(), ...)`，在 `UnitType.create(team).apply{}` 里）
         `variables.kts:94-95` 注册的 `{unit.x}` / `{unit.y}` 实际取的是 `it.tileX()` / `it.tileY()`

[VERIFIED] player.x / player.y   —— 玩家自身坐标（Float）
  evidence: wayzer/cmds/helpfulCmd.kts:37-38 `Call.effect(type, player!!.x, player!!.y, arg1, arg2)`
  notes: 语料 1 处

[VERIFIED] player.unit()  / player.dead() / player.team() / player.team(t) / player.clearUnit() / player.uuid()
  evidence: player.unit(): gatherTp.kts:30,49 ; spawnMob.kts:25 ; variables.kts:61
            player.dead(): gatherTp.kts:30 ; 13545.kts:50 ; skills.lib.kt:18 ; autoChangeMap.kts:16
            player.team(): vote.kts:19 ; betterTeam.kts:51,87 ; variables.kts:60 ; 13545.menu.kt:50
            player.team(t): 999.kts:159,186 ; betterTeam.kts:99
            player.clearUnit(): 999.kts:158,185 ; betterTeam.kts:99
            player.uuid(): ban.kts:16,30 ; suffix.kts:9 ; shortID.kts:36 ; 999.kts:163 ; betterTeam.kts:51,87
            player.con / player.con()  : history.kts:100 `con` ; whiteList.kts:70 `player.con()` ; ContentHelper.kt:48 `it.con != null`
            player.usid()              : whiteList.kts:62 `player.usid()` ; PlayerData.kt:48
            player.locale              : lang.kts:16 `player?.locale`
            player.lastText            : whiteList.kts:65 `player.lastText = "[Silent_Leave]"`
            player.reset()             : maps.manager.kt:138 `it.reset()`
            player.kick(reason, time)  : ban.kts:16-25 `kick("...", 0)`
            player.kick(KickReason)    : restart.kts:35 ; module.kts:51
            player.isPlayer (Unit 属性) : towerDefend.kts:73 ; unitLimit.kts:28
  notes: ⚠⚠ 语料中**没有任何** `import mindustry.gen.Player` 之外的"自定义"玩家扩展；
         `player.unit()/dead()/team()` 全部来自 Mindustry 引擎（`mindustry.gen.Player`）
         唯一的自定义玩家扩展是 `Player.hasPermission`（PermissionExt.kt:6）
```

### F.4 倒计时 / 定时任务

```
[VERIFIED] launch + delay（协程）—— 最常用
  evidence: wayzer/pvp/autoGameover.kts:33-42
      fun check() {
          if (!state.rules.pvp) return
          launch(Dispatchers.game) {
              delay(30000)
              while (true) { doCheck(); delay(1000) }
          }
      }
  evidence2: wayzer/reGrief/autoChangeMap.kts:12-27（loop(Dispatchers.game) { delay(1.seconds); ... }）
            mapScript/tags/towerDefend.kts:83-85 `launch(Dispatchers.gamePost) { Call.deconstructFinish(...) }`
            14562.kts:48-51 `launch(Dispatchers.game) { delay(100); Call.deconstructFinish(tile, block, null) }`
            mapInfo.kts:52-58 `launch(Dispatchers.gamePost) { Groups.player.forEach { it.showInfo() } }`

[VERIFIED] loop { }  —— 无限循环（coreLibrary.lib.util.coroutine，默认导入）
  syntax: loop(Dispatchers.game) { delay(3000); ... }   /   loop { ... }
  evidence: mapScript/tags/limitAir.kts:8-16 ; autoChangeMap.kts:13 ; autoSave.kts:40 ;
            reGrief/limitLogicPacket.kts:54 ; user/ext/nameExt.kts:45 ; remoteEventApi.kts:54
  notes: 捕获异常后 sleep 10s 继续（coroutine.kt:18-22）；对脚本 disable 会自动取消（协程 scope）

[VERIFIED] mapScript/lib/util.kt 的游戏时间调度
  evidence: mapScript/lib/util.kt:30-49
      suspend fun delayUntil(gameTime: Duration)                 // 支持暂停
      fun CoroutineScope.schedule(time: Duration, context: CoroutineContext = EmptyCoroutineContext,
                                  body: suspend CoroutineScope.() -> Unit)
      fun Script.delayBroadcast(msg: VarString)                   // = launch(Dispatchers.gamePost){ broadcast(msg) }
  notes: 需 `@file:Depends("coreMindustry")` 等；`mapScript.lib.*` 是 mapScript 模块默认导入

[VERIFIED] 按"下一次整十分钟"调度（墙钟）
  evidence: wayzer/map/autoSave.kts:30-37 (nextSaveTime) + :39-65 (onEnable { loop { delay(nextTime - System.currentTimeMillis()); ... } })
      val nextSaveTime: Date
          get() {
              val t = Calendar.getInstance()
              t.set(Calendar.SECOND, 0)
              val mNow = t.get(Calendar.MINUTE)
              t.add(Calendar.MINUTE, (mNow + 10) / 10 * 10 - mNow)
              return t.time
          }
      onEnable { loop { val nextTime = nextSaveTime.time; delay(nextTime - System.currentTimeMillis()); ... } }
  notes: ⚠ `delay(...)` 的参数是 Long（`nextTime - System.currentTimeMillis()`）

[VERIFIED] 计划重启（延到本局结束）
  evidence: wayzer/cmds/restart.kts:28-43
      fun scheduleRestart(msg: String, beforeExit: Runnable = {}) {
          lastMsg = msg
          broadcast("...".with("msg" to msg))
          doRestart = { ...; exitProcess(2) }
          if (state.isMenu) Core.app.post(doRestart)
      }
      export(::scheduleRestart)
  notes: 用 `StateChangeEvent` 监听 `GameState.State.menu` 触发（restart.kts:23-26）
```

---

## 附：imports 对照表

**基线（默认导入，无需显式 import）**：`arc.Core`、`mindustry.Vars.*`（→ `state`/`world`/`content`/`netServer`/`logic`/`spawner`）、
`mindustry.content.*`（→ `Blocks`/`Items`/`UnitTypes`/`StatusEffects`/`Fx`/`Sounds` 名字可解析）、
`mindustry.gen.Player`、`mindustry.gen.Call`、`mindustry.gen.Groups`、`mindustry.game.EventType`、
`coreMindustry.lib.*`（→ `listen`/`broadcast`/`sendMessage`/`hasPermission`/`MsgType`/`Dispatchers.game`/`ClientOnly`/`NotForClient`/`nextTick`/`ContentHelper`）、
`coreLibrary.lib.*`、`coreLibrary.lib.event.*`、`coreLibrary.lib.util.*`（→ `loop`/`nextEvent`/`calPage`/`Services`）、
`cf.wayzer.placehold.*`（→ `with`/`DynamicVar`/`PlaceHold`）
（来源：`coreMindustry/module.kts:4-11`，`coreLibrary/module.kts:6-10`，README:339）

### 需要**显式 import**（或在 `@file:Depends` 的模块里被默认导入）的项

| API / 类型 | 需要的 import | 证据（谁 import 了） | 备注 |
|---|---|---|---|
| `Team`（`Team.all`, `Team.sharded`, `team()`…） | `import mindustry.game.Team` | `999.kts:9`、`maps.kts:6`、`restart.kts:5`、`observer.kts:7`、`pvpAlert.kts:3`（共 23 文件） | **不在默认导入** |
| `Color`（`Color.green`, `Color.valueOf`） | `import arc.graphics.Color` | `history.kts:3`、`helpfulCmd.kts:3`、`pixelPicture.kts:3` | **不在默认导入** |
| `EventType.*` 子类（`Trigger` 等） | `import mindustry.game.EventType.Trigger` | `autoExchange.kts:3`、`14562.kts:4` | 仅当你写 `Trigger.update` 而非 `EventType.Trigger.update` |
| `TextInputEvent` | `import mindustry.game.EventType.TextInputEvent` | `coreMindustry/util/textInput.kts:3` | 用包路径 `EventType.TextInputEvent` 则不需要 |
| `arc.Events`（`Events.fire(...)`） | `import arc.Events` | `maps.kts:3`、`restart.kts:3`、`vote.kts:5`、`betterTeam.kts:5`、`unitLimit.kts:3` | **不在默认导入** |
| `Time`（`Time.delta/millis/timeSinceMillis/run`） | `import arc.util.Time` | `variables.kts:4`、`vote.kts:6`、`limitLogicPacket.kts`、`1004.kts` | **不在默认导入** |
| `Interval` | `import arc.util.Interval` | `unitLimit.kts:4`、`DispatcherExt.kt:4`、`autoUpdate.kts:26 区`、`limitLogicPacket.kts:31 区` | |
| `Mathf` | `import arc.math.Mathf` | `hexed.GeneratorHelper.kt:3`、`13545.menu.kt:3`、`999.kts:3` | |
| `Geometry` | `import arc.math.geom.Geometry` | `spawnAround.api.kt:3`、`towerDefend.kts:5`、`999.kts:4` | |
| `Point2` | `import arc.math.geom.Point2` | `spawnAround.api.kt:4`、`999.kts:6` | |
| `Units`（`Units.count`, `Units.closestEnemy`） | `import mindustry.entities.Units` | `gatherTp.kts:6`、`towerDefend.ai.kt:4` | **不在默认导入** |
| `Tile` | `import mindustry.world.Tile` | `gatherTp.kts:8`、`posMark.kts:5`、`towerDefend.ai.kt:8` | |
| `Building` | `import mindustry.gen.Building` | `13545.menu.kt:16`、`trackBuilding.api.kt:7` | |
| `Unit` | `import mindustry.gen.Unit` | `gatherTp.kts:7`、`TDDrop.kts:5`、`unitLimit.kts:7`、`variables.kts:9` | |
| `Item` / `ItemStack` / `UnitType` | `import mindustry.type.Item` / `.ItemStack` / `.UnitType` | `history.kts:5`、`TDDrop.kts:6`、`spawnMob.kts:5` | |
| `Block` | `import mindustry.world.Block` | `history.kts:6`、`pvpAlert.kts:6` | |
| `CoreBlock`（`.CoreBuild`, `playerSpawn`, `is CoreBlock`） | `import mindustry.world.blocks.storage.CoreBlock` | `history.kts:7`、`betterTeam.kts:8`、`hexed.kts:5`、`999.kts:14`、`pvpAlert.kts:9` | |
| `Floor` | `import mindustry.world.blocks.environment.Floor` | `towerDefend.kts:8`、`towerDefend.ai.kt:9`、`hexed.GeneratorHelper.kt:10` | |
| `ContentType` | `import mindustry.ctype.ContentType` | `spawnMob.kts:3`、`14562.kts:3` | |
| `GameState`（`StateChangeEvent.to`） | `import mindustry.core.GameState` | `restart.kts:4`、`autoSave.kts:6` | |
| `Gamemode` | `import mindustry.game.Gamemode` | `maps.kts:5`、`999.kts:7`、`1001.kts:8` | |
| `Rules` | `import mindustry.game.Rules` | `999.kts:8`、`1005.kts:5` | |
| `Packets` / `Packets.ConnectPacket` / `Packets.KickReason` | `import mindustry.net.Packets` | `restart.kts:6`、`module.kts:7`、`whiteList.kts:9` | |
| `Administration`（`ActionFilter`, `ActionType`, `Config`） | `import mindustry.net.Administration` | `towerDefend.kts:6`、`welcomeMsg.kts:4`、`ContentExt.kt:13` | |
| `NetConnection` | `import mindustry.net.NetConnection` | `ConnectAsyncEvent.kt:4`、`ContentExt.kt:15` | |
| `Vars` | 默认导入（`mindustry.Vars.*`）；显式写 `Vars.x` 也可 | `module.kts:3` | `Vars.state` 与 `state` 都可用 |
| `netServer` / `logic` / `spawner` / `content` / `state` / `world` | 默认（`mindustry.Vars.*` 的静态字段） | `variables.kts:40`、`ContentExt.kt:83`、`vote.kts:48` | |
| `Random` | `import kotlin.random.Random` | `menu.lib.kt:12`、`TDDrop.kts:8`、`vote.kts:12`、`textInput.api.kt:9` | **不在默认导入** |
| `kotlin.math.*`（`min`,`max`,`ceil`,`sqrt`,`pow`,`roundToInt`,`roundToLong`） | `import kotlin.math.min` 等 | `unitLimit.kts:8`、`vote.kts:10,11`、`13545.menu.kt:20,21`、`variables.kts:15`、`999.kts:15,16` | |
| `Dispatchers` | **无需 import**（`Dispatchers.game`/`gamePost` 是 coreMindustry.lib 的扩展；`Dispatchers.IO`/`Default` 来自 kotlinx，SA 默认可见） | 全语料 0 个 `import kotlinx.coroutines.Dispatchers`，但 `Dispatchers.IO` 被大量使用 | ⚠ 这是默认导入链的一环 |
| `delay` / `launch` / `withContext` / `Job` / `CoroutineScope` | 无需 import（`cf.wayzer.scriptAgent` 脚本基类 + 默认导入提供） | `autoGameover.kts:36`、`hexed.kts:29`、`mapScript/lib/util.kt:12,13` | |
| `Services` | 默认（`coreLibrary.lib.util.*` → `ServicesExt.kt`）；也有 `import cf.wayzer.scriptAgent.util.Services` | `ban.kts:5`、`Mongo.kt:3`、`h2db.kts:3` | |
| `PlaceHoldString` / `VarString` / `with` | 默认（`cf.wayzer.placehold.*`）；也有显式 `import cf.wayzer.placehold.PlaceHoldApi.with` | `history.kts:4`、`gatherTp.kts:5`、`share.api.kt:3` | |
| `PermissionApi` | 默认（`coreLibrary.lib.*`） | 全语料 0 个 `import coreLibrary.lib.PermissionApi`，但 `ban.kts:90` 等直接用 | ⚠ 默认导入 |
| `CommandInfo` / `CommandContext` / `Commands` / `command` / `Permission` / `Hidden` | 默认（`coreLibrary.lib.*`） | `menu.kts:3` `import coreLibrary.lib.Commands.Hidden`（只有嵌套类需要） | |
| `CommandType` / `ClientOnly` / `NotForClient` | 默认（`coreMindustry.lib.*`） | `CommandImpl.kt:155,176,180` 定义 | |
| `MenuBuilder` | `import coreMindustry.MenuBuilder` + `@file:Depends("coreMindustry/menu")` | `observer.kts:2,6`、`13545.menu.kt:5`、`vote.lib.kt:9` | ⚠ 必须在 Depends 里声明，否则拿不到 |
| `MenuV2` | `import coreMindustry.MenuV2` + `@file:Depends("coreMindustry/menu")` | `mapsCmd.kts:2,7`、`whiteList.kts:2,8` | |
| `PagedMenuBuilder` | `import coreMindustry.PagedMenuBuilder` + `@file:Depends("coreMindustry/menu")` | `share.api.kt:8` | |
| `MenuBuilderDsl` / `MenuBuilder.MenuBuilderDsl` / `MenuV2.MenuBuilderDsl` | 随 `MenuBuilder`/`MenuV2` 一起 import；在子类内部可直接 `@MenuBuilderDsl` | `13545.menu.kt:45,76,99`、`observer.kts` | ⚠ 是**嵌套注解类**，不是顶层 |
| `textInput` | `@file:Depends("coreMindustry/util/textInput")` + `import coreMindustry.util.textInput` | `share.kts:1`、`share.api.kt:10` | |
| `spawnAround` | `@file:Depends("coreMindustry/util/spawnAround")` + `import coreMindustry.util.spawnAround` | `13545.kts:2`、`13545.menu.kt:8` | |
| `nextChat` | `@file:Depends("coreMindustry/util/nextChat")` | `nextChat.kts:8 export(::nextChat)` | |
| `newContent` | `@file:Depends("coreMindustry/util/newContent")` | `newContent.api.kt:12,20` | |
| `trackBuilding` | `@file:Depends("coreMindustry/util/trackBuilding")` | `trackBuilding.api.kt:14` | |
| `listenPacket2Server` / `listenPacket2ServerAsync` / `registerActionFilter` / `onEnableForGame` | 默认（`coreMindustry.lib.*` → `ContentExt.kt`） | `module.kts:45`、`towerDefend.kts:44`、`autoExchange.kts:38` | |
| `@Savable` / `customLoad` / `export` / `autoInit` / `onEnable` / `onDisable` / `onUnload` / `listenTo` / `config` / `dotId` / `id` / `name` / `logger` / `script` / `coroutineContext` / `launchEmit` / `emitAsync` / `thisContextScript` | 无需 import（SA 脚本基类成员 / 默认导入） | 全语料 0 import，大量使用 | |
| `KVStore` | `import coreLib.extApi.KVStore` + `@file:Depends("coreLibrary/extApi/KVStore")` | `lang.kts:2,6`、`whileListCache.kts:2,5` | ⚠ 包名 `coreLib.extApi` |
| `StringDataType` | `import org.h2.mvstore.type.StringDataType` | `lang.kts:7`、`whileListCache.kts:9` | |
| `Services.get<T>().notNull` / `.nullable` / `.get()` | 默认 | `ban.kts:12`、`observer.kts:13`、`whileListCache.kts:39` | |
| `reflectDelegate` | `import coreLibrary.lib.util.reflectDelegate` | `ContentExt.kt:7`、`limitLogicPacket.kts:58` | |
| `withContextClassloader` | 默认（`coreLibrary.lib.util.*`） | `coroutine.kt:32` | |
| `MsgType` / `broadcast` / `ContentHelper` | 默认（`coreMindustry.lib.*`） | `ContentHelper.kt:36,38` | |
| `Iconc` | `import mindustry.gen.Iconc` | `13545.menu.kt:17`、`14562.kts:5`、`history.kts 无关` | **不在默认导入** |
| `StatusEffects` | `import mindustry.content.StatusEffects`（或直接用，因 `mindustry.content.*` 默认导入） | `13545.menu.kt:13` | 用全名可省 |
| `LogicBlock` | `import mindustry.world.blocks.logic.LogicBlock` | `autoChangeMap.kts:5` | |
| `ConstructBlock` | `import mindustry.world.blocks.ConstructBlock` | `towerDefend.kts:7`、`999.kts:12` | |
| `AIController`（自定义 AI） | `import mindustry.entities.units.AIController` | `towerDefend.ai.kt:5`、`13545.menu.kt` 的 `MinerAI` 用 `import mindustry.ai.types.MinerAI` | |
| `Pathfinder` | `import mindustry.ai.Pathfinder` | `towerDefend.ai.kt:3` | |
| `Fx` 的**具名** effect（`Fx.placeBlock`） | 无需 import（`mindustry.content.*` 默认） | `history.kts:142`（文件头无 Fx import） | ✅ 关键反证 |
| `Blocks` / `Items` / `UnitTypes` | 无需 import（`mindustry.content.*` 默认） | `towerDefend.kts` 无 import 却用 `Blocks.armoredConveyor` | ✅ 关键反证 |
| `ItemModule` | `import mindustry.world.modules.ItemModule` | `hexed.kts:6` | |
| `Map`（`mindustry.maps.Map`） | `import mindustry.maps.Map` 或别名 | `variables.kts:10`、`maps.kts:9`（`as MdtMap` 避免与 kotlin.Map 冲突） | ⚠ 有命名冲突风险 |
| `SaveIO` / `SaveOptions` | `import mindustry.io.SaveIO` / `.SaveOptions` | `autoSave.kts:7,8`、`maps.kts:7` | |
| `Vars` 也可显式 import | `@file:Import("mindustry.Vars", libraryByClass = true)` | `module.kts:3` | 模块级 |
| `arc.Core` | `@file:Import("arc.Core", defaultImport = true)` | `module.kts:4` | 模块级 |
| `ContentLoader`（`mapSnap` 用） | `import mindustry.core.ContentLoader` | `mapSnap.kts:3` | |
| `World`（`mindustry.core.World`） | `import mindustry.core.World` | `mapSnap.kts:4` | |
| `Tiles` | `import mindustry.world.Tiles` | `999.kts:11`、`hexed.GeneratorHelper.kt:9` | |
| `Posc` | `import mindustry.gen.Posc` | `spawnAround.api.kt:7` | |
| `Seq` / `ObjectMap`（arc 容器） | `import arc.struct.Seq` / `.ObjectMap` | `ListenExt.kt:5,6`、`autoSave.kts:4` | |
| `Fi`（arc 文件） | `import arc.files.Fi` | `autoSave.kts:3` | |

### 常见"看起来该有但其实需要 import"的坑（速查）

| 想用 | 必须写 |
|---|---|
| `Team.all` | `import mindustry.game.Team` |
| `Color.green` | `import arc.graphics.Color` |
| `Events.fire(...)` | `import arc.Events` |
| `Time.delta` | `import arc.util.Time` |
| `Units.count(...)` | `import mindustry.entities.Units` |
| `Random.nextInt()` | `import kotlin.random.Random` |
| `Mathf.sqrt/pow` | `import arc.math.Mathf` |
| `roundToInt()` / `min()` / `max()` | `import kotlin.math.roundToInt` / `min` / `max` |
| `Interval()` | `import arc.util.Interval` |
| `Iconc.warning.code` | `import mindustry.gen.Iconc` |
| `GameState.State.menu` | `import mindustry.core.GameState` |
| `MenuBuilder {}` | `import coreMindustry.MenuBuilder` **且** `@file:Depends("coreMindustry/menu")` |
| `KVStore` | `import coreLib.extApi.KVStore` **且** `@file:Depends("coreLibrary/extApi/KVStore")` |
| 用 `Trigger.update` | `import mindustry.game.EventType.Trigger`（否则写全名 `EventType.Trigger.update`） |

### 明确**不需要** import 的（默认导入，语料反证）

`Blocks`、`Items`、`UnitTypes`、`StatusEffects`、`Fx`、`Sounds`（名字可解析，但语料未使用）、
`Player`、`Call`、`Groups`、`EventType`、`state`、`world`、`content`、`netServer`、`logic`、`spawner`、`Vars`、`Core`、
`listen`、`broadcast`、`sendMessage`、`hasPermission`（Player 扩展）、`MsgType`、`Dispatchers.game`、`Dispatchers.gamePost`、
`nextTick`、`ClientOnly`、`NotForClient`、`command`、`CommandInfo`、`CommandContext`、`Commands`、`PermissionApi`、
`loop`、`nextEvent`、`calPage`、`Services`、`with`、`registerVar`、`registerVarForType`、`lookup`（placehold）、
`onEnable`、`onDisable`、`onUnload`、`listenTo`、`config`、`dotId`、`id`、`name`、`logger`、`script`、`launch`、`delay`、`withContext`。

---

## 汇总：NOT FOUND 清单（明确不存在于语料，禁止臆测）

| 候选特性 | 检索方式 | 结论 |
|---|---|---|
| `EventType.UnitControlEvent` | grep `ControlEvent\|UnitCommandEvent\|UnitEnteredPayload\|UnitTransport` | 0 hit |
| `EventType.Trigger.*` 除 `update` 外 | grep `Trigger\.` → 仅 `.update` | 仅 update |
| `WaveEvent` 上的波数字段 | unitLimit.kts:78-85 用 `state.wave`，未访问事件字段 | 无证据 |
| `WorldLoadEvent` 的字段 | 10 处监听全部不用 `it` | 无证据 |
| `unit.damage(amount)` | grep `\.damage\(` | 0 hit |
| `unit.heal(...)` | grep `\.heal\(` | 0 hit |
| `Sounds.X.play(...)` | grep -i `sound` | 0 hit |
| `player.unit(unit)`（设置单位） | grep `player\.unit\(unit\)\|setUnit` | 0 hit |
| `Units.nearby(...)` | grep `Units\.nearby` | 0 hit |
| `Mathf.rand(...)` / 裸 `rand()` | grep `Mathf\.rand[^o]\|\brand\(` | 0 hit（只有 `Mathf.random`） |
| `Mathf.round(...)` | grep `Mathf\.round` | 0 hit |
| `Mathf.clamp(...)` / `.clamp(...)` | grep `clamp` | 0 hit（用 `coerceIn`） |
| `forEachIndexed` | grep `forEachIndexed\|withIndex\(\)` | 0 hit（只 `mapIndexed`、`repeat`） |
| 顶层 `Teams.all` | grep `\bTeams\.` | 0 hit（用 `state.teams` / `Team.all`） |
| `not {}` / `and {}` / `or {}` 辅助 | grep `fun not\(\|fun .*if.{0,3}(True\|Else\|Not)` | 0 hit |
| `ifTrue {}` / `ifElse {}` | grep `ifTrue\|ifElse\|ifNot\|whenTrue` | 0 hit |
| `Groups.block` / `Groups.bullet` / `Groups.all` | grep `Groups\.[a-zA-Z]+` → 只有 player/unit/build/fire | 仅 4 个 |
| `Teams` 类 | 同上 | 不存在 |
| 语料中的 Mindustry 引擎源码 / 事件全字段表 | glob `mindustry*.jar`、`*.java` | 语料**不含引擎源码** |

---

## 一句话结论（给调用方的注意事项 Top 10）

1. **`WaveEvent` 没有波数字段**——波数一律 `state.wave`（unitLimit.kts:74,79）。
2. **`ConfigEvent` / `DepositEvent` 的 `it.tile` 是 `Building`**，要 Tile 得写 `it.tile.tile`（history.kts:74,77）；其它 `*Build*`/`TileChangeEvent` 的 `it.tile` 才是 `Tile`。
3. **`BlockBuildBeginEvent.unit` 非空，`BlockBuildEndEvent.unit` 可空**（towerDefend.kts:73 vs history.kts:66）。
4. **`MenuOptionChooseEvent` 的字段是 `option`，`TextInputEvent` 的字段是 `textInputId`**（menu.kts:7、textInput.kts:6）。
5. **`Trigger.update` 是事件对象**，用 `listen(EventType.Trigger.update) {}`，不能写 `listen<...>()`（variables.kts:107）。
6. **`unit.damage()/heal()` 和 `Sounds` 在语料中不存在**——别写。
7. **`Team`/`Color`/`Events`/`Time`/`Units`/`Random`/`Mathf`/`Iconc`/`GameState` 都要显式 import**；`Blocks`/`Items`/`Fx` 不用。
8. **random 用 `Random.nextInt/nextFloat` 或 `Mathf.random`**（不是 `Mathf.rand`）；夹紧用 `coerceIn`（不是 `clamp`）；四舍五入用 `roundToInt()`（不是 `Mathf.round`）。
9. **菜单用 `MenuBuilder<T>` / `MenuV2` DSL**，都要 `@file:Depends("coreMindustry/menu")` + `import coreMindustry.MenuBuilder`/`MenuV2`；`sendTo`/`send` 是 suspend。
10. **KVStore 的 `@file:Depends` 字符串是 `"coreLibrary/extApi/KVStore"`，import 包名是 `coreLib.extApi`**（lang.kts:2,6）。

---

## 附二：用真实 jar 复核（javap），修正上面靠语料推断的部分

上面 §0~附 的结论全部来自 **脚本语料**（166 个文件）。语料能证明「某人这么写过」，
但不能证明「只有这一种写法」，也看不出字段的真实类型。实现第二批控件时，
本机发现了一个真实的 Mindustry 服务端 jar，于是用 `javap` 把每个签名核实了一遍。

**复核手段**：`tests/dump-api.ps1`（javap 转储）→ `tests/verify-api.js`（58 项断言，已并入构建）。
jar 本身不进版本库（23 MB 第三方产物），转储缺失时测试自动跳过。

### 修正记录（语料没看出来 / 看错的）

| # | 我原先的写法 | javap 核实结果 | 影响 |
|---|---|---|---|
| 1 | `import mindustry.entities.Fx` | **不存在这个类**；`Fx` 在 `mindustry.content.*` 里，已被 defaultImport 覆盖 | 多写一个错 import，直接编译不过 |
| 2 | `import mindustry.world.Building` | 真正的包名是 **`mindustry.gen.Building`** | 同上 |
| 3 | `tile.x` 直接当 Int 传给 `Geometry.circle(int,int,int)` | `Tile.x` 是 **`short`**，Kotlin 不会自动加宽 | 必须写 `.toInt()`（语料 gatherTp.kts:58 正是这么写的） |
| 4 | `Team.players` | **Team 上没有 players**；玩家列表在 `Team.data().players`（`TeamData.players`） | 写 `team.players` 编译不过 |
| 5 | `player.hasPermission(node)` | 它是 **suspend** 扩展函数（PermissionExt.kt:6），而 `listen{}` 的 lambda 是 `(T)->Unit` | 事件体里根本不能调；改用非挂起的 `PermissionApi.check(subject, node)`（PermissionApi.kt:77） |
| 6 | `unit.flag = 1024` | `flag` 是 **`double`**，Kotlin 不接受整数字面量 | 必须写 `1024.0` |
| 7 | `val x = mutableListOf()` | Kotlin 推断不出元素类型 | 必须写 `mutableListOf<String>()` |
| 8 | 「记住一个值」生成 `val count = 0`，而「改变一个值」生成 `count += 1` | `val` 不能重新赋值 | 前者改 `var` |

### 得到确认、可以放心用的（javap 有据）

| 调用 | 核实到的签名 |
|---|---|
| `unit.kill()` | `Healthc.kill()` / `Unitc.kill()` |
| `unit.set(x, y)` + `snapInterpolation()` | `Posc.set(float,float)`；`Syncc.snapInterpolation()` |
| `unit.tileX()/tileY()` | `Posc.tileX()` → `int` |
| `unit.isGrounded/isFlying()` | `Unitc` |
| `tile.setNet(block, team, rotation)` | `Tile.setNet(Block, Team, int)` |
| `tile.setAir()` | `Tile.setAir()` |
| `world.tile(x, y)` | 返回**可空**，必须 `?.` |
| `Building.items.add(Item,int)` / `.set(Item,int)` / `.clear()` | `ItemModule` |
| `Units.count(x,y,r){pred}` | `Units.count(float,float,float,Boolf<Unit>)` |
| `Units.closestEnemy(team,x,y,r){pred}` | `Units.closestEnemy(Team,float,float,float,Boolf<Unit>)` |
| `Call.setHudTextReliable(con,str)` / `infoToast(con,str,float)` / `warningToast(con,int,str)` / `announce(con,str)` | `Call` 全部对得上 |
| `Iconc.warning` | `Iconc.warning` 存在（`char`） |
| `Groups.player/unit/build/fire` | `EntityGroup<T> implements Iterable<T>` —— 所以 `forEach`/`filter`/`filterIsInstance` 可用 |
| `Team.data()` / `Team.core()` / `Team.cores()` | 都在 `Team` 上 |

### 仍然只能靠语料、jar 查不到的

- `PermissionApi.check(subject, permission)` 的**行为**（是否等价于 `hasPermission`）：
  两者都走同一套 `Global.find/query`，`hasPermission` 只是多包了一层
  `handleThoughEvent`（会发 `RequestPermissionEvent` 让插件有机会覆盖结果）。
  所以 `PermissionApi.check` **不会**触发权限事件——这是取舍，换来的是能在非挂起上下文里用。
- `ListenExt` / `CommandApi` 这类**框架自身**的类：不在 Mindustry jar 里，
  只能读语料源码（已逐行读过，见正文）。
