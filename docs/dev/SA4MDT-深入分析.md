> **开发 / 设计文档** —— 看代码、改代码才需要；**用这个工具不需要看它**。返回 [文档索引](../README.md)。
> 本文是对第三方 Mod（ScriptAgent4MindustryExt）的只读分析，与本工具的使用无关，属于历史研究笔记。

# ScriptAgent4MindustryExt 3.4.0 —— 插件实现深入分析

> 本文**只依据**工作区 `ScriptAgent4MindustryExt-3.4.0-scripts/` 内的文件（166 个文件，420 KB，全量通读）。
> 凡是工作区代码里没有直接出现的 `cf.wayzer.scriptAgent.*` / `cf.wayzer.placehold.*` 内部实现，本文只描述**代码中可观察到的行为契约**，不做臆测；必要时标注"（推断）"。
> 引用格式 `路径:行号`。

---

## 0. 文件清单与分层

| 模块 | 文件数 | 说明 |
|------|--------|------|
| `README.md` | 1 | 作者自己的结构文档（948 行） |
| `bootStrap/` | 3 | 入口与打包入口 |
| `coreLibrary/` | 41 | 平台无关库：命令/配置/权限/变量/服务/DB/extApi |
| `coreMindustry/` | 27 | Mindustry 桥接：主线程调度/事件/菜单/控制台/包拦截 |
| `mapScript/` | 29 | 与地图生命周期绑定的脚本 + 地图生成器 + 标签 |
| `wayzer/` | 65 | 服务器功能插件（地图/投票/用户/反作弊/持久化） |

---

## 1. 脚本单元的构成规则（README 未讲）

### 1.1 同一个"脚本单元"可以由多个文件组成

`.metadata` 是唯一的权威证据。`wayzer/.metadata` 里**没有** `wayzer/maps/manager`、`wayzer/vote/lib`、`wayzer/cmds/share/api` 这些 ID，但文件确实存在：

```
wayzer/maps.kts + maps.manager.kt + maps.registry.kt   ->  ID wayzer/maps
wayzer/vote.kts + vote.lib.kt                          ->  ID wayzer/vote
wayzer/cmds/share.kts + share.api.kt                   ->  ID wayzer/cmds/share
wayzer/user/ban.kts + ban.api.kt + ban.store.kt        ->  ID wayzer/user/ban
wayzer/user/ext/skills.kts + skills.lib.kt             ->  ID wayzer/user/ext/skills
mapScript/shared/hexed.kts + hexed.HexData.kt + hexed.HexedGenerator.kt + hexed.GeneratorHelper.kt
                                                       ->  ID mapScript/shared/hexed
mapScript/13545.kts + 13545.menu.kt                    ->  ID mapScript/13545
coreMindustry/menu.kts + menu.lib.kt + menu.new.kt     ->  ID coreMindustry/menu
```

**规则（强证据，非文档）**：文件名中**第一个 `.` 之前的部分**决定所属脚本单元 —— `name.kts` 是该单元的主文件，同目录下 `name.<任意>.kt` 是**同一编译单元的附加源码**。
证据：`mapScript/13545.kts` 直接用 `CoreWarMenu(player, core)`（`mapScript/13545.kts:51`），既无 import 也无 `@file:Import`，而 `CoreWarMenu` 定义在 `13545.menu.kt`，且 `mapScript` 包下同包可见 —— 只有"合并编译"能解释。

`.api.kt` / `.lib.kt` / `.store.kt` / `.manager.kt` / `.registry.kt` / `.ai.kt` / `.cache.kt` 全是**命名约定**，不具有编译语义。

### 1.2 脚本 ID

- ID = 相对 `Config.rootDir` 的路径去掉扩展名，如 `wayzer/maps`、`coreLibrary/commands/control`（`coreLibrary/commands/control.kts` 里用 `Commands.controlCommand`）。
- `Config.idSeparator` 用于把 ID 切成"模块名"：`it.id.substringBefore(Config.idSeparator)`（`coreLibrary/commands/control.kts:34,63,69`）—— 分隔符是 `/`（推断，因为结果被当作模块目录用）。
- `Config.scriptSuffix` 用于热重载识别：`file.toString().endsWith(Config.scriptSuffix)`（`coreLibrary/commands/hotReload.kts:27`）。
- 目录嵌套即模块嵌套：`wayzer/store` 是一个子模块（`wayzer/store/module.kts` 只有一行 `@file:Depends("coreLibrary/db", ...)`）。

### 1.3 `module.kts` = 目录级"继承声明"

`module.kts` 的注解对目录内**所有**脚本生效，子脚本无需重复。典型例子 `coreLibrary/module.kts:1-10`：

```kotlin
@file:Import("https://www.jitpack.io/", mavenRepository = true)
@file:Import("com.github.way-zer:PlaceHoldLib:v7.3", mavenDependsSingle = true)
@file:Import("io.github.config4k:config4k:0.7.0", mavenDepends = true)
@file:Import("org.slf4j:slf4j-jdk14:2.0.16", mavenDependsSingle = true)
@file:Import("coreLibrary.lib.*", defaultImport = true)
@file:Import("coreLibrary.lib.util.*", defaultImport = true)
@file:Import("-Xcontext-parameters", compileArg = true)
```

效果证据：`coreLibrary/commands/*.kts`、`coreLibrary/lang.kts` 里直接写 `with(...)`、`menu(...)`、`Commands()`、`PlaceHoldString`，全无 import —— 全部来自上面的 `defaultImport`。
`-Xcontext-parameters` 是让 `context(ctx: CommandContext)` 语法（`coreLibrary/lib/CommandApiExt.kt:6-45`、`wayzer/user/ext/skills.lib.kt:78-79`、`coreMindustry/util/textInput.api.kt:16`）能编译的前提。

`coreMindustry/module.kts` 是 Mindustry 侧最关键的继承声明：

```kotlin
@file:Depends("coreLibrary")
@file:Import("arc.Core", libraryByClass = true)      // 把运行中的 arc.Core 类所在 classloader 纳入编译 classpath
@file:Import("mindustry.Vars", libraryByClass = true)
@file:Import("mindustry.Vars.*", defaultImport = true)
@file:Import("mindustry.content.*", defaultImport = true)
@file:Import("coreMindustry.lib.*", defaultImport = true)
```

`libraryByClass` 的含义在代码里有印证：`wayzer/ext/profiler.kts:16` 用 `Config.cacheDir.resolve(...)`，`mindustry`/`arc` 这些类并不来自 Maven，而是来自宿主 jar —— 用类引用反查所在 jar 作为库依赖。

### 1.4 `.metadata` = 编译期依赖快照

字段（`coreLibrary/.metadata`、`mapScript/.metadata`、`wayzer/.metadata`、`coreMindustry/.metadata` 全量比对后）：

```
ID        <脚本 id>
FQ_NAME   <Kotlin 顶层类名，如 mapScript._1001>     // 数字开头文件名会被加下划线
+DEPENDS  <id> [描述]
+SOFT_DEPENDS <id> [描述]
+IMPORT   DefaultImport <包.*>
+IMPORT   MavenDepends <坐标>          / MavenDependsSingle
+IMPORT   MavenRepository <url>
+IMPORT   LibraryByClass <类名>
+IMPORT   CompileArg <参数>
+IMPORT   SourceFile <相对路径>
```

三个可直接读出的结论：

1. **描述会进入 metadata**：`coreLibrary/.metadata` 无描述，而 `mapScript/.metadata:4` 是 `+DEPENDS wayzer/maps 获取地图信息` —— 对应 `mapScript/module.kts:2` 的第二个参数。
2. **`.kt` 不产生独立条目**，只作为所属单元的一部分（见 1.1）。
3. **`SOURCE_MD5` 被刻意剔除**：`coreLibrary/commands/helpful.kts:36-38`

```kotlin
val meta = ScriptCache.asMetadata(info)
meta.id to MetadataFile(meta.id, meta.attr - "SOURCE_MD5", meta.data)   // 不需要 SOURCE_MD5
```

说明 `SOURCE_MD5` 是宿主维护的**源码指纹**（用于判断缓存编译结果是否过期），而 `.metadata` 是给开发者/CI 用的可提交物，指纹必须随源码变动，因此不能固化进仓库。

### 1.5 元数据生成与打包（`/sa genMetadata`、`/sa packModule`）

`coreLibrary/commands/helpful.kts`：

- `scanModules()`：遍历 `rootDir` 找所有 `.metadata` 的父目录 = 模块；再并入命令行给的额外目录（`:13-25`）。
- `getModuleScripts()`：只取 `it.id == module || it.id.startsWith("$module/")` 的**已编译**脚本（`compiledScript`），并**排除子模块**避免重复（`:31-34`）。
- 保留已有的 `.metadata` 条目：`merged = existed + metas`（`:66`）—— 所以已删除的脚本不会自动清理，需要人工删。
- 文件名由 `Config.metadataV3(dir)` 决定（`:59`），即工作区里的 `.metadata` 文件。
- `packModule` 把模块打成 CAS 包：`CASScriptPacker(Config.cacheDir.resolve("$module.packed.zip").outputStream())`（`:85-86`）。
  **注意**：README §9.1 说的是 `$module.packed.zip`，实际落在 `Config.cacheDir` 下。
- `bootStrap/generate.kts` 走另一条路：`prepareBuiltin(File("build/tmp/builtin.packed.zip"))`（`:11`），把所有 `scriptState.loaded` 的脚本打进 builtin 包；触发条件是系统属性 `ScriptAgent.PreparePack`（`:43`）。它还用 `DependencyManager` 现拉 `com.github.TinyLake.MindustryX:core:92c614c3a3` 并 `loadToClassLoader(Config.mainClassloader)`（`:25-29`），然后用 `compileOnly("")` 只编译不运行（`:35-38`），最后 `exitProcess(fail.size)` —— 这是一个**CI/命令行编译入口**，与 `default.kts`（运行入口）互斥，两者都用 `if (Config.mainScript != id) disableScript(...)` 保护（`bootStrap/default.kts:19`、`generate.kts:20`）。

---

## 2. 注解 = 编译期契约

| 注解 | 位置 | 语义（由用法反推） |
|------|------|--------------------|
| `@file:Depends(id, desc?, soft?)` | 文件头 | 硬依赖建立加载顺序；`soft = true` 允许缺失 |
| `@file:Import(..., defaultImport)` | 文件头/module | 批量默认导入 |
| `@file:Import(..., mavenDepends)` | | 拉 Maven 依赖（递归传递） |
| `@file:Import(..., mavenDependsSingle)` | | 只拉这一个（不传递） |
| `@file:Import(..., mavenRepository)` | | 追加仓库 |
| `@file:Import(..., libraryByClass)` | | 按类定位运行中 jar |
| `@file:Import(..., sourceFile)` | | 把同目录 `.kt` 并入（`KVStore.kts:3`、`rpcService.kts:2`、`mongoApi.kts:3`） |
| `@file:Import(..., compileArg)` | | 传 Kotlin 编译器参数 |
| `@file:Implement(IFace::class)` | 文件头 | 声明"本脚本是某接口实现"，用于 `depends(...)?.import` 和 IDE/工具识别 |
| `@Savable(serializable = false)` | 属性 | 参与脚本状态持久化；`false` 表示"要持久化但不走 Java 序列化" |

`@Savable` + `customLoad` 的成对用法给出持久化语义：

```kotlin
// wayzer/ext/observer.kts:15-19
@Savable(serializable = false)
val obTeam = mutableMapOf<Player, Team>()
customLoad(::obTeam) { obTeam.putAll(it.filterKeys { p -> p.con != null }) }
```

`Player` 不可反序列化，所以标 `serializable = false`，由 `customLoad` 手动做"载入后过滤"。对照 `wayzer/user/nameExt.kts:6-8`（`Map<String,String>`，直接 `putAll`）、`wayzer/user/suffix.kts:22-24`、`wayzer/cmds/voteOb.kts:15-17`（`@Savable(false)` 简写）。

`OptIn` 类注解在代码里出现两处，说明宿主通过 Kotlin `@RequiresOptIn` 控制 API 稳定性：
`@OptIn(SAExperimentalApi::class)`（`wayzer/user/ban.kts:11`）、`@OptIn(LoaderApi::class)`（`coreMindustry/console.kts:62`）。

---

## 3. 依赖图与加载事务

### 3.1 默认入口的真实流程

`bootStrap/default.kts` 全文只有 24 行，但包含两阶段事务：

```kotlin
suspend fun boot() = ScriptManager.transactionV2 {
    enable("kcp/")
    execute().printResult()          // 第一阶段：先只起 kcp，并把结果打出来

    enable(ScriptRegistry.allScripts())
    exclude("@")                     // 以 @ 开头的脚本
    exclude("bootStrap/")
    exclude("coreLibrary/extApi/")   // 注释明确写着 lazy load
    exclude("scratch")
    exclude("mirai")                 // Deprecated

    load("mapScript/")               // 注意是 load 不是 enable
}.printResult()
```

三个关键信息：

1. `kcp/` 必须在**独立事务**里先 `execute()` —— 它是网络层（KCP 协议），后续脚本的编译/运行依赖它。
2. `extApi/` 被排除且**没有 `module.kts`**（`coreLibrary/extApi/README:1-4` 明确写"这个文件夹虽然有 lib 目录，但是没有 module.kts。lib 只是集中存放 kt 文件，由各脚本单独 Import。使用必须依赖各实现脚本"）。所以 `KVStore.kts`、`mongoApi.kts` 等只在被 `@file:Depends` 时才加载。
3. `mapScript/` 用 `load`（加载但**不启用**），启用时机完全交给 `mapScript/module.kts` 的 `WorldLoadEvent`。

`ScriptManager.afterTransaction { boot() }` 说明事务执行与"事务后回调"是分离的，`boot()` 必须在第一个事务结束后才能开新事务。

### 3.2 事务 API 的可见面

从 `coreLibrary/commands/control.kts` 与 `bootStrap/generate.kts` 汇总：

```
transactionV2 { ... }              返回带 conditions / printResult() 的结果对象
  enable(prefix: String)           前缀匹配
  enable(script: ScriptInfo)
  enable(List<ScriptInfo>)
  disable(script) / disable(List)
  load(x) / reload(script) / compile(script) / compileOnly(prefix) / exclude(prefix)
  execute()                        解算顺序并执行
execute().printResult()
ScriptManager.disableScript(this, reason)    脚本自禁用（onEnable 里常见）
ScriptManager.unloadScript(script)
ScriptManager.disableAll()
ScriptManager.enableScript(script)
ConditionState.Status.Success     失败判据：status != Success
```

**`exclude` 的语义很特别**：`bootStrap/default.kts:7-8` 的注释写"add 添加需要加载的脚本(前缀判断) exclude 排除脚本(**可以作为依赖被加载**)"。即 `enable(allScripts()) + exclude("coreLibrary/extApi/")` 之后，`wayzer/store/whileListCache` 仍然能通过 `@file:Depends("coreLibrary/extApi/KVStore")` 把 KVStore 拉起来。

### 3.3 硬依赖 / 软依赖 / 函数导出

**硬依赖**：`@file:Depends("mapScript/shared/hexed")`（`mapScript/1001.kts:1`）—— 缺失即失败。

**软依赖**：`soft = true` + 运行期显式取用，全项目共 6 处，模式完全一致：

```kotlin
// mapScript/lib/ContentExt.kt:13
depends("wayzer/map/mapInfo")?.import<(String, String) -> Unit>("addModeIntroduce")?.invoke(mode, introduce)

// wayzer/cmds/mapsCmd.kts:39
depends("wayzer/cmds/voteMap")?.import<(Player, MapInfo) -> Unit>("voteMap")?.invoke(player, it)

// wayzer/ext/autoUpdate.kts:94
depends("wayzer/cmds/restart")?.import<(String, Runnable) -> Unit>("scheduleRestart")?.invoke("新版本更新 $version") { ... }
```

`export(::fn)` 是提供端：`wayzer/cmds/voteMap.kts:25`、`wayzer/ext/goServer` 无、`mapScript/shared/posMark` 无、`wayzer/cmds/share` 无 —— 实际出现的 export 点：`mapScript/13545.kts` 无、`wayzer/user/ext/whiteList` 无、`wayzer/map/mapInfo.kts:11 export(::addModeIntroduce)`、`wayzer/map/betterTeam.kts:103 export(::changeTeam)`、`wayzer/cmds/restart.kts:44 export(::scheduleRestart)`、`wayzer/cmds/voteMap.kts:25 export(::voteMap)`、`mapScript/shared/posMark`（interface）无、`coreMindustry/util/nextChat.kts:8 export(::nextChat)`、`wayzer/ext/observer.kts:21 export(::getObTeam)`。

**注意**：`dependency.import<T>("name")` 拿到的是**函数引用**，因此接口稳定性完全靠函数签名 + 字符串名，编译器无法校验。这是本框架最脆的一环。

### 3.4 反向依赖查询（mapScript 的核心）

`mapScript/module.kts:16`：

```kotlin
val children get() = ScriptRegistry.allScripts { it != scriptInfo && it.dependsOn(scriptInfo) }
```

两个 API：`ScriptInfo.dependsOn(other, includeSoft = false)`（`:44` 用 `includeSoft = true`）与 `ScriptRegistry.allScripts { predicate }`。
`getToLoadMapScripts()`（`:28-47`）把"命中的地图脚本" 扩展成"它 + 所有依赖它的未启用脚本"：

```kotlin
}.flatMap {
    listOf(it) + ScriptRegistry.allScripts { dep -> !dep.enabled && it.dependsOn(dep, includeSoft = true) }
}.toSet().toList()
```

即 `mapScript/shared/hexed`（共享组件）本身不绑定地图，是被 `1001.kts` 等**反向拉进来**的。

---

## 4. 生命周期与清理契约

### 4.1 DSL 收集

`onEnable` / `onDisable` / `onUnload` 由框架的 `DSLBuilder` 收集，脚本运行期可通过 `enabled`、`scriptInfo.enabled` 查询（`coreMindustry/console.kts:82 if (!enabled) break`）。

`onEnable` 里 `return@onEnable` 是常见的提前退出（`postgres.kts:17`、`h2db.kts:15`、`redisApi.kts:11`、`mongoApi.kts:23`），配合 `ScriptManager.disableScript(this, reason)` 实现"配置不满足就不启用"，且 `reason` 会进入 `script.failReason`（`mapScript/lib/util.kt:57`）。

### 4.2 协程作用域绑定脚本

- `launch(...)` 在脚本内直接可用（来自 `Script` 的 CoroutineScope）。
- `loop(ctx) {}` 是 `Script.loop`（`coreLibrary/lib/util/coroutine.kt:13-25`）：包 `while(true)` + 捕异常 + 睡 10 秒。`limitAir.kts:8`、`autoSave.kts:40`、`pvpProtect.kts:24`、`scoreboard.kts:49`、`alert.kts:18`、`autoUpdate.kts:54`、`reGrief/autoChangeMap.kts:14`、`reGrief/limitLogicPacket` 无、`mapScript/1001.kts:45`(schedule)、`mapScript/1005.kts:103`、`coreLibrary/lang.kts:168` 都在用。
- 取消写在 `ResetEvent`/`onDisable` 里：
  `pvpProtect.kts:61-67 thisScript.coroutineContext.cancelChildren()`（换图取消保护计时）
  `autoGameover.kts:47-50 coroutineContext[Job]?.cancelChildren()`
  `wayzer/ext/observer` 无、`coreLibrary/lang.kts:136-138` 还原 `templateHandler`。

**注意 `pvpProtect.kts` 的一个真实缺陷**：`onEnable` 之外的 `loop` 里做 `launch(Dispatchers.game) { ...; thisScript.coroutineContext.cancelChildren() }`（`:47-62`）会连带取消监听器自身所在的协程，靠 `ResetEvent` 兜底 —— 属于"用 cancelChildren 当停止键"的取巧写法。

### 4.3 全局副作用的成对契约

框架不提供"自动反注册"，因此全项目都是 `onEnable { 加 }` + `onDisable { 减 }`：

```kotlin
// coreMindustry/lib/ContentExt.kt:49-60
inline fun <reified T : Packet> Script.listenPacket2Server(crossinline handle: (NetConnection, T) -> Boolean) {
    onEnableForGame {
        val old = getPacketHandle<T>()
        Vars.net.handleServer(T::class.java) { con, p -> if (handle(con, p)) old.get(con, p) }
        onDisableForGame { Vars.net.handleServer(T::class.java, old) }   // 恢复旧 handler
    }
}
```

同类：`pvpChat.kts:29-34`（chatFilters add/remove）、`chatPing.kts:30-31`、`suffix.kts:43-47`（packetHandlers clear）、`betterTeam.kts:28-42`（assigner 备份/还原）、`menu.kts:14-15`（helpOverwrite 备份/还原）、`lang.kts:125-138`（templateHandler 备份/还原）、`CommandImpl.kt:111-119`（卸载时恢复原生命令 handler）、`rpcService.kts:16-27,53-56`（unexport）。

**`Listener` 是唯一自动化的一环**（`coreMindustry/lib/ListenExt.kt`）：
- 监听器挂在 `Script.listener`（DSLBuilder DataKey）上，不立即注册；
- 静态 `init` 里注册 `ScriptEnableEvent(After)` → `register()`，`ScriptDisableEvent(Before)` → `unregister()`，都 `withContext(Dispatchers.game)`（`:61-74`）；
- `get()` 时再判一次 `script?.enabled != false`（`:38`）作为双保险；
- `insert = true` 插到列表头（`maps.kts:123 listen<EventType.DataPatchLoadEvent>(insert = true)`，用于在数据补丁应用**之前**设置 `state.rules`）。

### 4.4 `ServiceRegistry` 的自动复位

`coreLibrary/lib/util/ServiceRegistry.kt:25-35`：`provide` 时把 `this to inst` 记到 `script.providedService`，并挂 `script.onDisable { if (getOrNull() == inst) impl.resetReplayCache() }` —— 提供者脚本被禁用时服务自动失效。

`DBApi` 用了同一手法记录表：`private var Script.registeredTable by DSLBuilder.dataKey()`（`coreLibrary/db/lib/DBApi.kt:22`），`initDB` 从所有 `inst != null` 的脚本收集（`:99-100`）。

### 4.5 卸载时的清理

`onUnload` 用于**永久移除**（相对"临时禁用"）：
`mapScript/lib/TagSupport.kt:22 onUnload { TagSupport.knownTags.remove(name) }`、
`mapScript/lib/ScriptMapGenerator.kt:127-129 onUnload { knownMaps.remove(mapId) }`、
`ConfigBuilder` 的 `ScriptStateChangeEvent` 监听（`ConfigApi.kt:191-197`）在 `loaded && !next.loaded` 时把该脚本的配置项从全局 `all` 里删掉。

---

## 5. 线程模型（本项目最硬的技术点）

`coreMindustry/lib/DispatcherExt.kt` 完整实现了一个 Mindustry 主线程调度器。

### 5.1 `MindustryDispatcher`

```kotlin
object MindustryDispatcher : CoroutineDispatcher() {
    private var mainThread: Thread? = null
    private var blockingQueue = ConcurrentLinkedQueue<Runnable>()
    init { Core.app.post { mainThread = Thread.currentThread() } }        // :23-27
    override fun isDispatchNeeded(c) = Thread.currentThread() != mainThread && mainThread?.isAlive == true
    override fun dispatch(c, block) { if (inBlocking) blockingQueue.add(block) else Core.app.post(block) }
    override fun dispatchYield(c, block) { /* 10 分钟一次警告：用 nextTick */ Core.app.post(block) }
}
```

- 主线程身份不是启动时取的，而是**第一帧 post 时**取的（`init` 块），这是为了兼容"插件在 Mindustry 初始化早期加载"。
- `dispatchYield` 会打警告日志并 `Exception()` 打栈（`:42-48`），提示应该用 `nextTick`。

### 5.2 `safeBlocking` —— 主线程同步等待协程

```kotlin
fun <T> safeBlocking(block: suspend () -> T): T {
    check(Thread.currentThread() == mainThread) { "safeBlocking only for mainThread" }
    if (inBlocking) return runBlocking(Dispatchers.game) { block() }
    inBlocking = true
    return runBlocking {
        launch { while (inBlocking || blockingQueue.isNotEmpty()) blockingQueue.poll()?.run() ?: yield() }
        try { withContext(Dispatchers.game) { block() } } finally { inBlocking = false }
    }
}
```

这是**唯一能在 Mindustry 同步事件回调里"等"协程**的机制：事件在主线程触发 → `safeBlocking` → 内部协程 post 回主线程（此时主线程被 `runBlocking` 占住，正常 `Core.app.post` 永远不会执行）→ 所以 `dispatch` 把 block 塞进 `blockingQueue`，由并行 launch 的排空循环就地执行 → 完成后 `inBlocking = false` 让残余任务走正常 post。

使用点：
- `mapScript/module.kts:63`：`WorldLoadEvent` 里 `safeBlocking { transactionV2 { enable(toLoad) } }` —— 地图加载是同步事件，必须在这里把脚本编译+启用做完。
- `mapScript/module.kts:19`：`ResetEvent` 里 disable 全部 + `load(keys)`。
- `ScriptMapGenerator.kt:63`：生成完地图后 `enableScript`。
- `betterTeam.kts:90`：`Dispatchers.game.safeBlocking { AssignTeamEvent(player, group, bak).emitAsync() }.team` —— 分配队伍发生在主线程同步路径上，却要等异步事件监听者。
- 废弃重载 `safeBlocking { coroutineScope { ... } }`（`:75-84`）保留 HIDDEN，注释解释了为什么不能传 CoroutineScope。

### 5.3 `nextTick`

```kotlin
suspend fun nextTick() {
    val context = coroutineContext
    context.ensureActive()
    if (context[ContinuationInterceptor] !is MindustryDispatcher) { suspendCoroutine { Core.app.post { it.resume(Unit) } }; return }
    suspendCoroutineUninterceptedOrReturn<Unit> sc@{ cont ->
        val co = cont.intercepted() as? Runnable ?: return@sc Unit
        Core.app.post(co); COROUTINE_SUSPENDED
    }
}
```

对已在 game 调度器上的协程，直接复用 continuation 的 `Runnable` 视图 post（零分配）；否则退回 `suspendCoroutine`。
使用点：`wayzer/cmds/pixelPicture.kts:82`（每画 10 个像素让一帧）、`maps.manager.kt:105`（`world.resize(0,0)` 后让旧任务跑完）。

### 5.4 `Dispatchers.gamePost`

`MindustryDispatcher.Post`（`:105-112`）：无视 blocking 状态，永远 `Core.app.post`。语义是"下一帧执行"，用于"当前帧末尾再动世界"：
`mapScript/shared/posMark.kts:39`、`hexed.kts:13,19`、`command/` 无、`maps.kts` 无、`towerDefend.kts:85`、`unitLimit.kts:26`、`betterTeam.kts:57,68`、`restart.kts:17`、`mapInfo.kts:53`、`mapScript/lib/util.kt:22 delayBroadcast`。

### 5.5 线程纪律的落实

- 命令 body 全在 `Dispatchers.game` 下（`CommandImpl.kt:85 withContext(Dispatchers.game)`），所以 `spawnMob.kts`、`clearUnit.kts` 直接改游戏对象是安全的。
- 阻塞 IO 显式切走：`ban.kts:29 launch(Dispatchers.IO)`、`resourceHelper.kts:39 withContext(Dispatchers.IO)`、`whiteList.kts:23 withContext(Dispatchers.IO)`、`helpful.kts:45 withContext(Dispatchers.Default)`、`pixelPicture.kts:69,71`。
- `readLine` 用 `runInterruptible`（`console.kts:76`）、下载用 `runInterruptible`（`autoUpdate.kts:23`）以便响应取消。

---

## 6. 命令系统（三层结构）

### 6.1 `CommandInfo`

`coreLibrary/lib/CommandApi.kt:102-208`：

- 同时实现 `DSLBuilder`（收集 dataKey）、`CommandHandler`、`TabCompleter`。
- `attrs: List<CommandHandler>` 是**前置拦截链**，`handle()` 里 `attrs.forEach { it.handle() }` 然后 `body.handle()`（`:194-195`）。
- `freeze()`：设置 `body` 后冻结（`:164-168`），此后 `attr()` 报错 "This command is already frozen, you must add attr before body"（`:140`）。`permission` 兼容字段在 `freeze()` 时转成 `Commands.Permission` attr（`:127-133`）。
- 补全逻辑优先级（`:173-188`）：显式 `onComplete` > 新式 `body.canHandle()` > 旧式 `TabCompleter`。
- 异常处理（`:190-205`）：`CancellationException` 中 `CommandInfo.Return` 静默；其他 `CancellationException` 打 WARNING 并提示"You should not cancel command. If you need exit, using CommandInfo.Return()"；普通异常 reply 并打栈。

`Commands` 树（`:283-339`）：`nameMap`（小写名 + 别名 → CommandInfo）、`watchers`、`addSub/removeSub/removeAll(script)`、`addWatcher`（`fireOnRegister` 时把已有指令回灌给 watcher，并在脚本 disable 时移除并回撤）。

### 6.2 `/sa` 根与 help

```kotlin
// CommandApi.kt:373-398
object Root : Commands() {
    init {
        this += CommandInfo(thisContextScript(), "ScriptAgent", "ScriptAgent 控制指令".with(), listOf("sa")).apply {
            requirePermission("scriptAgent.admin")
            body(controlCommand)
        }
        thisContextScript().listenTo<ScriptDisableEvent> { removeAll(script) }
    }
    var subCommandOverwrite: ((Map<String, CommandInfo>) -> Map<String, CommandInfo>)? = null
    override fun subCommands(): Map<String, CommandInfo> = subCommandOverwrite?.invoke(super.subCommands()) ?: super.subCommands()
}
```

`helpCommand`（`:341-371`）在 body 里 `prefix = prefix.removeSuffix("help ")` 实现递归 help；`helpOverwrite` 钩子（`:416`）被 `coreMindustry/menu.kts:16-45` 接管，把 help 变成可点击菜单并 `CommandInfo.Return()`。

### 6.3 桥接到原版命令系统

`CommandImpl.kt`：

1. `RootCommands.init` 先从原版 handler 里 `removeCommand("help")`（`:27-29`）。
2. `subCommandOverwrite` 把 **原版** `clientCommands` / `serverCommands` 全部包装成 `CommandInfo` 注入 help：客户端指令加 `ClientOnly`，服务端加 `NotForClient`（`:30-54`）；body 里转发给原 handler（`cmds.handleMessage(cmds.prefix + it.text + " " + arg.joinToString(" "), player)`）。
3. `hookGameHandler()`（`:111-119`）把 `netServer.clientCommands` 字段和 `ServerControl.handler` 字段（用 `Core.app.listeners.find { it.javaClass.simpleName == "ServerControl" }` 定位）替换为 `MyCommandHandler`，原对象作为 `origin` 委托 —— **只覆写 `handleMessage`，注册/删除/列表全转发**（`:122-153`）。
4. `MyCommandHandler.handleMessage` 用 `trimInput` 规整空白，命中前缀则 `launch(Dispatchers.game) { RootCommands.handleInput(...) }` 并返回 `ResponseType.valid`（原版不会再处理）。
5. `coreMindustry/module.kts:16-18`：`onEnable { RootCommands.hookGameHandler() }`；`onDisable` 在 `hookGameHandler` 内部注册，恢复原 handler。

### 6.4 权限与可见性

- `Commands.Hidden` 接口 + `ClientOnly` / `NotForClient`（`CommandImpl.kt:176-182`）通过 `receiver` 类型决定 help 是否展示。
- `CommandContext.IReceiver.hasPermission` 抽出了权限来源：`PlayerCommandReceiver` → `player.hasPermission(node)`（`:162-166`）；控制台 receiver 走另一套。
- `CommandContext.reply` 有重载（`:190-192`）：有 `player` 就 sendMessage，否则走原始 reply。
- 默认权限用 `dotId`：`profile.kts` 无，实际使用 `permission = dotId`（`helpfulCmd.kts:14`、`clearUnit.kts:4`、`jsCmd.kts:6`、`spawnMob.kts:11`、`pixelPicture.kts:59`、`restart.kts:49`、`profiler.kts:35`、`limitLogicPacket.kts:70`）或 `id.replace("/", ".")`（`spawnMob.kts:11` 注释版、`pixelPicture.kts:59`）。这解释了为什么 `/sa permission` 里的节点形如 `wayzer.cmds.clearUnit`。

### 6.5 高级模式

- **前置拦截当"守卫"**：`vote.kts:49-52` 用 `attr { if (VoteEvent.active.get() != null) returnReply("[red]投票进行中") }` 在 body 之前拦截；`skills.lib.kt:12-68` 把 `SkillPrecheck`/`SkillNoPvp`/`SkillCooldown` 做成可复用 attr，并用 `skillBody {}` 在 body 后自动 `setCoolDown()`（`:88-94`）。
- **`runIgnoreCancel`**（`control.kts:6-11`）：`launch(Job())` 切断父子 Job —— 因为命令可能**重载自己**，若沿用原 Job 会被连带取消。注释写得很清楚："Need new Job, as it may restart this script."
- **控制台专用**：`onCompleteArg` / `onComplete(index) {}`（`CommandApiExt.kt:22-37`）用 `context` 参数把补全逻辑写成"只在 TabComplete 且参数位匹配时执行"。
- **子命令树复用**：`Commands.controlCommand` 是所有 `/sa xxx` 的父；`VoteEvent.VoteCommands` 是 `/vote` 的子命令树（`voteKick.kts:12 commands = VoteEvent.VoteCommands`）；`SkillCommands` 同理。
- **`removeAll` 时机**：`vote.kts:55-57 listenTo<ScriptDisableEvent> { VoteEvent.VoteCommands.removeAll(script) }` —— 投票子命令由多个脚本注册，各自 disable 时清理自己那份。

### 6.6 控制台（`coreMindustry/console.kts`）

- JLine `LineReader` + 自定义 `Completer`，补全走 `runBlocking(Dispatchers.game) { Commands.Root.tabComplete { arg = cmd } }`（`:48-60`）。
- `System.setOut(MyPrintStream { reader.printAbove(...) })`：把服务端 stdout 重定向到 JLine 的"行上方输出"，并特殊处理 `\r\n`（`:17-46,124-133`），退出时还原。
- 替换 `ServerControl.serverInput` 字段（`:138-144`），接管原版控制台输入循环。
- Ctrl-C 两次 `exitProcess(255)`；EOF 两次 `ScriptManager.disableAll(); exitProcess(1)`（`:74-99`）—— 保证脚本能拿到 `onDisable`。
- `@OptIn(LoaderApi::class)` 说明这个替换用了非稳定 API。

---

## 7. 事件系统

### 7.1 两套事件并存

**arc 事件**（Mindustry 原生）：`listen<EventType.Xxx> { }` / `listen(EventType.Trigger.update) { }`，经 `Listener` 反射映射。
**SA 事件**（框架 + 项目自建）：`class XxxEvent(...) : Event`，监听用 `listenTo<XxxEvent>(Event.Priority.X) { }`。

项目自建 SA 事件清单（含语义）：

| 事件 | 定义 | 用途 |
|------|------|------|
| `RequestPermissionEvent` | `coreLibrary/lib/event/RequestPermissionEvent.kt` | 权限查询链；`directReturn()` 短路；`cancelled` 即 `directReturn != null` |
| `ServiceProvidedEvent<T>` | `coreLibrary/lib/event/ServiceProvidedEvent.kt` | 谁提供了什么服务 |
| `ScriptEnableEvent` / `ScriptDisableEvent` / `ScriptStateChangeEvent` | 框架 | 生命周期钩子 |
| `ConnectAsyncEvent` | `wayzer/lib/ConnectAsyncEvent.kt` | ConnectPacket 之前，可 `reject(reason)`；`cancelled` 只读（`error("Can't cancel,please use kick")`） |
| `MapChangeEvent` | `wayzer/maps.manager.kt:30-44` | 换图前，持有 `rules` 可改；`cancelled` 可阻止 |
| `GetNextMapEvent` | `wayzer/maps.registry.kt:61-66` | 可改 `mapInfo` |
| `GameOverEvent` | `wayzer/maps.kts:80-86` | 自定义结算，`cancelled` 则不播报不换图 |
| `VoteEvent` | `wayzer/vote.lib.kt:23-217` | 自带 `awaitResult()` |
| `AssignTeamEvent` | `wayzer/map/betterTeam.api.kt` | 分配队伍，可拦截（`voteOb.kts:70`、`whiteList.kts:105` 用 `Priority.Intercept`） |
| `MenuChooseEvent` | `coreMindustry/menu.lib.kt:15-21` | 菜单点击，实现 `ReceivedEvent` |
| `OnTextInputResult` | `coreMindustry/util/textInput.api.kt:11-13` | 文本输入回包 |
| `OnChat` | `coreMindustry/util/nextChat.api.kt:10-14` | 下一句聊天，实现 `ReceivedEvent` |
| `NewSentenceEvent` | `coreLibrary/lang.kts:21-23` | 出现新待翻译句子 |
| `RemoteEvent` | `coreLibrary/extApi/lib/RemoteEvent.kt` | 跨服事件基类，`handler` 被禁用必须用 `emit()` |

### 7.2 优先级

代码中出现的 `Event.Priority`：`After`（`Listener` 注册 `ScriptEnableEvent`、`mapRule.kts:20`）、`Before`（`Listener` 注销 `ScriptDisableEvent`、`backCompatibility.kts:11`）、`Intercept`（`voteOb.kts:70`、`whiteList.kts:105`）、`Watch`（`permissionCmd.kts:86` 只观察不改）。

### 7.3 `emitAsync` 与 `nextEvent`

```kotlin
// 用法一：取结果
val event = ConnectAsyncEvent(con, packet).emitAsync()            // wayzer/module.kts:54
if (event.emitAsync().cancelled) return                            // maps.manager.kt:96
MapChangeEvent(info, map).emitAsync()
GetNextMapEvent(previous, next).emitAsync().mapInfo                // maps.registry.kt:103
RequestPermissionEvent(subject, permission, defaultGroup).emitAsync()  // PermissionApi.kt:75

// 用法二：带 body，body 内可 cancel()
emitAsync {
    ...; if (!active.compareAndSet(null, this@VoteEvent)) return@emitAsync cancel()
}                                                                  // vote.lib.kt:55-66
```

`nextEvent<T>{}`（`coreLibrary/lib/util/nextEvent.kt:13-24`）把"事件"变成"挂起函数"：

```kotlin
suspend inline fun <reified T : Event> Script.nextEvent(crossinline filter: (T) -> Boolean): T =
    suspendCancellableCoroutine {
        lateinit var listen: Event.Listen<T>
        listen = listenTo { if (filter(this)) { if (this is ReceivedEvent) received = true; listen.unregister(); it.resume(this) } }
        it.invokeOnCancellation { listen.unregister() }
    }
```

特点：一次性的（命中即 `unregister`）、可取消（自动注销）、配合 `ReceivedEvent` 记录"是否有人接"（`menu.kts:7-10` 用 `received` 判断菜单是否被处理，否则主动隐藏 follow-up 菜单）。

基于它的封装：`textInput()`（带 `withTimeoutOrNull` + 随机负数 id 防碰撞）、`nextChat()`、`MenuV2.await()`、`CommandApi` 无。

### 7.4 `RemoteEvent` 的特殊处理

`coreLibrary/extApi/lib/RemoteEvent.kt:12`：

```kotlin
final override val handler: Event.Handler get() = error("You should use RemoteEvent.emit()")
```

即远程事件**禁止本地 emit**，必须走 `launchEmit()` → `service.remoteEmit(this)`；`Handler` 的 `init` 里用 `javaClass.enclosingClass` 自动 `registerType`（`:22-27`）—— 要求 Handler 必须写在事件类内部作为 `companion object`。

反序列化在 `remoteEventApi.kts:28-41` 用自定义 `ObjectInputStream.resolveClass`：优先查 `classMap`（`Class.name → WeakReference<Class>`）拿到**脚本 classloader 里的类**，否则退回"用上次解析出的 classloader 加载"。这是绕开"脚本类加载器隔离"的必需手段。

---

## 8. 变量 / 占位符系统

### 8.1 延迟求值链

```kotlin
// coreLibrary/lib/PlaceHoldApi.kt:117-124
fun String.with(vararg arg: Pair<String, Any>): VarString =
    VarString("{text}", mapOf(*arg, "text" to DynamicVar {
        val template = PlaceHold.templateHandler(this, this@with)     // ← i18n 钩子在这里
        PlaceHoldApi.getVarString(template, arg.toMap())
    }))
```

- `with()` 不解析，只构造 `VarString` 描述；解析发生在 `toString()` / `toPlayer()`。
- `templateHandler` 是 `VarString.(String) -> String`（`:111`），被 `lang.kts:126-135` 劫持：

```kotlin
PlaceHold.templateHandler = h@{
    val str = bak(it)
    val lang = VarToken("receiver.lang").get()?.toString() ?: return@h str
    data.getOrPut(str) { needSave = true; Sentence(str).also { launch { NewSentenceEvent(it).emitAsync() } } }.get(lang)
}
```

即：先跑原 handler 得到**原始句子**，再按 receiver 的语言查表；没见过的句子自动登记 + 广播 `NewSentenceEvent` + 标记待保存。`Sentence.get()` 逐级 fallback（`fallbackMap[lang] ?: fallbackMap["*"] ?: "@raw"`，`:29-38`）。
`lang.ini` 的手写序列化（`save()`/`load()`，`:44-120`）支持 `\n` 转义与引号包裹，"非完整 ini"是明说的。

### 8.2 注册形式

```kotlin
registerVar("state.wave", "当前波数", DynamicVar { state.wave })              // 全局变量
registerVarForType<Player>().apply {                                        // 类型命名空间
    registerChild("name", "名字") { it.name }
    registerToString("玩家名(name)") { resolveVarChild(it, "name")?.unwrap()?.toString() }
}
```

`registerChild`（`PlaceHoldApi.kt:58-64`）的实现揭示了**挂载时机**：

```kotlin
fun registerChildAny(key: String, desc: String, body: Any?) {
    script.registeredVars["$namePrefix.$key"] = desc
    script.onEnable { binder.registerChildAny(key, body) }        // 启用时才真正注册
    if (body != null) script.onDisable { binder.registerChildAny(key, null) }
}
```

`registeredVars` 同时被 `/sa vars` 使用（`coreLibrary/commands/varsCmd.kts:15 script.inst?.registeredVars`），即**描述信息在脚本加载时就有，实际变量在启用时才有**。

### 8.3 名字前缀/后缀的"注册点拼接"（很巧的扩展设计）

`wayzer/user/nameExt.kts:10-29`：

```kotlin
val TypeBinder<*>.tree: Map<String, Any> by reflectDelegate()      // 反射读内部 map

registerChild("prefix", "名字前缀,可通过prefix.xxx变量注册") { p ->
    PlaceHoldApi.typeBinder<Player>().run {
        tree.keys.filter { it.startsWith("prefix.") }.sorted().joinToString("") { k ->
            resolve(this@registerChild, p, k)?.let { resolveVarForString(it) }.orEmpty()
        }
    }
}
```

于是任何脚本只需 `registerChild("prefix.1-notAuth", ...)`（`whiteList.kts:50`）、`registerChild("suffix.s3-computer", ...)`（`suffix.kts:53`）、`registerChild("suffix.9shortID", ...)`（`shortID.kts:56`）就自动出现在玩家名里 —— **字典序即显示顺序**。
`Player.updateName()` 用 `"[white]{player.prefix}[]{name}[white]{player.suffix}"` 重建名字（`:32-37`），并有 5 秒定时刷新循环（`:44-52`）。

### 8.4 颜色与输出

`ColorApi.handle(raw, handler)` 用 `Regex("\\[([!a-zA-Z_]+)]")` 替换；`[!x]` 前缀表示"转义，原样输出"（`ColorApi.kt:54-59`）。
`ContentHelper`（`coreMindustry/lib/ContentHelper.kt`）区分三种输出：
- `broadcast(text, type, time, quite, players)` → 用 `MindustryDispatcher.runInMain` 包住发送（`:46-51`），`quite=true` 时不打控制台。
- `Player.sendMessage(text, MsgType, time)` 按 `MsgType` 分发到 `Call.sendMessage/infoMessage/infoToast/warningToast/announce`（`:54-69`）。
- `logToConsole(text)` 用 `receiver = CommandContext.ConsoleReceiver` 渲染后 `Strings.stripColors(ColorApi.handle(text, ColorApi::consoleColorHandler))`。
- `mindustryColorHandler` 把 `LIGHT_YELLOW→[gold]` 这类跨平台色名做映射（`:21-33`）。

`MsgType` 定义在 `coreMindustry/lib/ContentHelper.kt:36`：`Message / InfoMessage / InfoToast / WarningToast / Announce`。

### 8.5 内置变量清单（节选）

`coreMindustry/variables.kts`：`tps`、`heapUse`、`map`（+ `Map` 的 name/desc/author/width/height/size/fileName）、`state.allUnit/allBan/playerSize/wave/enemies/gameMode/startTime/gameTime/mapTime`、`game.version`、`team`、`Player`(colorHandler/name/uuid/ip/team/unit/info)、`PlayerInfo`(name/uuid/lastIP/lastBan)、`Team`(name/color/colorizeName)、`UnlockableContent`(emoji/name)、`Unit`(x/y/health/maxHealth/shield)。
`coreLibrary/variables.kts`：`\n`、`joinLines`、`Duration` 的自定义格式化（带单位参数：`{delta 分钟}`）、`state.uptime`，并注册 config4k 的 `CustomType` 把 `java.time.Duration` 写成 `1h`/`30m`。
扩展点：`scoreboard.kts:10` 的 `{listPrefix scoreboard.ext|joinLines}` —— 用**变量前缀**把其他脚本注册的行拼起来（`vote.kts:36 scoreboard.ext.vote`、`mapInfo.kts:14 scoreboard.ext.customMode`、`scoreboard.kts:43 scoreboard.ext.patches-count`）。

---

## 9. 服务注册与依赖注入

### 9.1 两套并存

| | 框架级 `cf.wayzer.scriptAgent.util.Services` | 脚本级 `coreLibrary.lib.util.ServiceRegistry<T>` |
|---|---|---|
| 提供 | `Services.provide(inst)`（`postgres.kts:27`、`h2db.kts:27`、`mongoApi.kts:18`、`redisApi.kts:15`） | `registry.provide(script, inst)`（`ServiceRegistry.kt:25`） |
| 获取 | `Services.get<T>()` 返回 `Registry<T>`；`coreLibrary/lib/ServicesExt.kt` 提供 `getOrNull()/get()/provided/nullable/notNull/all` | `by Services.get<X>().notNull` 是**框架版**的委托；`ServiceRegistry` 自带的 `nullable/notNull` |
| 观察 | `current()` / `observe()`（Flow） | `MutableSharedFlow` + `awaitInit()` + `subscribe(scope, async)` |
| 代理 | — | `createProxy(cls)` 用 `java.lang.reflect.Proxy`，未注册直接抛错（`:56-63`） |

判断依据：`by Services.get<TeamService>().notNull`（`voteOb.kts:13`）用的是 `ServicesExt.kt` 的扩展属性；而 `PlayerData.IGetUidByShortId : ServiceRegistry<...>`（`PlayerData.kt:32`）走脚本级。两种模式在同一项目里各司其职。

**注意 `wayzer/user/ban.kts:12` 标了 `@OptIn(SAExperimentalApi::class)`**，而它用的是 `Services.get<PlayerBanStore>().notNull` —— 说明框架版 API 当时标记为实验性。

### 9.2 接口定义 / 实现 / 消费三段式

接口放 `.api.kt` 或 `lib/*.kt`，且文件里常带一行注释指向实现脚本（这是**文档约定**，不是编译指令）：

```kotlin
// coreLibrary/extApi/lib/KVStore.kt:7
//@file:Depends("coreLibrary/extApi/KVStore")
interface KVStore { ... }
```

实现脚本用 `@file:Implement(...)` + `Services.provide`：

```kotlin
// coreLibrary/extApi/KVStore.kts:2-3
@file:Implement(coreLib.extApi.KVStore::class)
@file:Import("./lib/KVStore.kt", sourceFile = true)
```

消费端：`val store: PlayerBanStore by Services.get<PlayerBanStore>().notNull`（`ban.kts:12`）、`val teams by Services.get<TeamService>().notNull`（`voteOb.kts:13`）。
项目出现 `notNull` 的地方都写着 `by`（延迟取值），因此"提供者晚于消费者加载"不会崩。

### 9.3 一个完整的服务实现链：封禁

```
wayzer/user/ban.api.kt      interface BanService
wayzer/user/ban.store.kt    data class PlayerBan + interface PlayerBanStore     ← 并入 wayzer/user/ban 单元
wayzer/user/ban.kts         @file:Implement(BanService::class) + 命令 /banX /unbanX
wayzer/store/banStore.kts   @file:Depends("wayzer/user/ban") + @file:Implement(wayzer.user.PlayerBanStore::class)
                            + DBApi.registerTable(Table)   ← 依赖方向：store 实现 -> user 接口
```

`ban.kts:37-42` 的 `findBan` 有一个业务细节：**已登录玩家跳过 uuid 匹配**（`if (id == player.uuid && player.authed) return null`），避免小号封禁误伤同 uuid。

### 9.4 多服共享：RPC 装饰器模式

`wayzer/store/whileListCache.kts`：

```kotlin
class CacheImpl(private val map: MutableMap<String,String>) : UnicastRemoteObject(), AuthCache { ... }   // 本地 KVStore 后端
class WithCache(private val cache: AuthCache, private val fallback: AuthCache) : AuthCache {             // 读穿装饰器
    override fun get(...) = cache.get(...) ?: fallback.get(...)?.also { cache.put(...) }
    override fun put(...) { cache.put(...); fallback.put(...) }
}
onEnable {
    val rpcService = Services.get<RpcService>().get()
    rpcService.register { localCache }
    var store = rpcService.get<AuthCache>()
    if (!rpcService.isMaster) store = WithCache(localCache, store)   // 从服：本地优先，主服兜底
    Services.provide(localCache)
}
```

`rpcService.kts` 用 `System.getenv("RPC_MASTER_HOST")` 区分主/从（`:12-13`），主服 `LocateRegistry.createRegistry(port)`，从服连远端；`get()` 时用 `withContextClassloader(inf.classLoader) { registry.lookup(...) }`（`:34-36`）——**RMI 反序列化必须切到脚本 classloader**，与 `RemoteEvent` 是同一类问题。
缓存键有两个：`"$uid/$usid"` 与 `"IP/$uid/$ip"`（`whileListCache.kts:15,21-22`），实现"换设备免登录 IP 快速登录"。

---

## 10. 持久化

### 10.1 ORM 层（Exposed）

`coreLibrary/db/lib/DBApi.kt`：

- `val db = Services.get<Database>()`（`:20`）—— 数据库是**服务**，由 `h2db.kts` 或 `postgres.kts` 提供。
- `TableVersion` 表（`:24-69`）：主键是表名，`check(table)` 比较 `WithUpgrade.version`（默认 1）与库中版本，低则 `onUpgrade(oldVersion)`（默认实现是 `createMissingTablesAndColumns`）并 `update`；异常被捕获并记 log（不中断启动）。
- `registerTable` 是 `context(script: Script)`（`:86-94`），因此调用点靠 context 推断脚本：`wayzer/store/banStore.kts:20 DBApi.registerTable(Table)`。
- `initDB(db)`（`:96-108`）在 `module.kts:12-23` 的 Flow collect 里被调用；遍历所有 `inst != null` 的脚本收集表 → `SchemaUtils.sortTablesByReferences` 排依赖 → 逐个 `check`，并统计耗时。

`banStore.kts` 的存储技巧（`:14-19,52-55`）：

```kotlin
val ids = text("ids", eagerLoading = true)     // "…$uuid$usid$ip$…" 单字段存多 ID
Table.selectAll().where { (Table.ids like "%$${id}$%") and Table.endTime.greater(CurrentTimestamp) }
```

用 `$` 包裹 + `like` 做"集合包含"查询，避免建关联表；代价是全表扫描。

### 10.2 KV 层（H2 MVStore）

`coreLibrary/extApi/KVStore.kts`：`store by lazy { MVStore.Builder().fileName(Config.dataDir.resolve("kvStore.mv")) ... }`，`onDisable { it.close() }`（`:10-17`）——**懒打开 + 脚本禁用即关**。
使用点：`wayzer/user/lang.kts:11-13`（`langSettings`）、`whileListCache.kts:38-41`（`authCache`）。都是 `by autoInit { ... }`。

### 10.3 脚本状态持久化

`@Savable` + `customLoad` 机制（见 §2），由框架负责把脚本"可序列化字段"存盘/载入。项目里出现 5 处：`voteOb.kts`、`observer.kts`、`nameExt.kts`、`suffix.kts`、`mapInfo.kts`。

---

## 11. 权限系统

### 11.1 查询链

```
Player.hasPermission(node)
  -> groups = [uuid(), "@admin"?]                               coreMindustry/lib/PermissionExt.kt:6-12
  -> PermissionApi.Global.handleThoughEvent(player, node, groups)
       -> RequestPermissionEvent(subject, permission, defaultGroup).emitAsync()   PermissionApi.kt:71-78
            ← wayzer/module.kts:60       group = PlayerData.ids + group          （多 ID 合并）
            ← whiteList.kts:113          group += "@authed" 或 forceAuth 时直接 Reject
            ← mapRule.kts:20 (Priority.After) 把 "@mapRule" 插到第一个 "@" 之前
       -> find(event.group, permission).query().asResult()
```

`find`（`:60-63`）：对 subject 里每个组逐个查，**最后追加 `@default`**；`ByGroup`（`:48-57`）是处理器列表，`permissionCmd.kts:4` 把自己 `add(0, handler)` 插到最前，实现"文件配置优先于代码默认"。

`findNode`（`:82-90`）实现通配：精确名 → 逐级去掉最后一段再试 `prefix.*`。
`query()`（`:97-102`）过滤 `expire` 与 `context`；`asResult()`（`:104-107`）把 null → `Default`、true → `Has`、false → `Reject`。
`Result.fallback {}`（`:28`）用于串联多处理器。

### 11.2 组定义

`PermissionGroup.add(node)`（`:163-172`）：`@x` → `extend`，`-x` → 负权限节点，其他 → 正权限。
`StringPermissionHandler.findAll/find` 会把 `extend` 递归到 `Global.ByGroup`（`:129-147`）—— 支持组继承。
`allKnownSubject`（`:117`）把 extend 也算作"已知组"，供 `/sa permission` 补全。

### 11.3 默认权限与配置持久化

- 代码侧：`PermissionApi.registerDefault("wayzer.maps.host", "wayzer.maps.load", group = "@admin")`（`maps.kts:160`）等约 20 处，把默认归属写进 `PermissionApi.default`。
- `permissionCmd.kts:7-15` 用 `config.key("groups", mapOf("@default" to emptyList<String>()), ...) { onChange }` —— **配置变更回调重建 handler**，实现 `data/config.conf` 持久化。
- `permissionCmd.kts:86-89` 用 `Priority.Watch` 监听 `RequestPermissionEvent` 做调试输出。

---

## 12. 地图脚本系统（本项目最有特色的设计）

### 12.1 三级匹配 + 依赖闭包

`mapScript/module.kts:28-47`：

```kotlin
val byId  = children.find { it.id.endsWith("/${MapManager.current.id}") }                 // ① 文件名 = 地图 id
val byTag = state.rules.tags.get("@mapScript")?.let { tag -> ... it.id.endsWith("/$tagId") }  // ② @mapScript 标签
return buildList {
    if (byId != null) add(byId)
    if (byTag != null && byTag != byId) add(byTag)
    addAll(TagSupport.findTags(state.rules).values)                                        // ③ registerMapTag 注册过的标签
}.flatMap { listOf(it) + ScriptRegistry.allScripts { dep -> !dep.enabled && it.dependsOn(dep, includeSoft = true) } }
 .toSet().toList()
```

② 的失败路径有反馈：`delayBroadcast("[red]该服务器不存在对应地图脚本，请联系管理员: {id}")`（`:35`）。

### 12.2 生命周期挂钩

```kotlin
listen<EventType.ResetEvent> { ... }        // 换图/重置：先把上一局的 mapScript 全 disable，再 load(keys)
listen<EventType.DataPatchLoadEvent> { }    // 收集 mapAssets / mapPatches
listen<EventType.WorldLoadEvent> { }        // enable(toLoad) + checkEnabled
onEnable { MapRegistry.register(this, ScriptMapGenerator.Provider) }
```

`ResetEvent` 里用的是 `load(keys.toList())`（`:23`）而不是 enable —— `keys` 是脚本自己的 dataKey（框架提供，代表"本脚本 DSL 里声明的 keys"）。

### 12.3 脚本生成地图

`mapScript/lib/ScriptMapGenerator.kt`：

- 构造时预置 `genRound("init") { it.fill() }`（`:31-33`）→ **`genRounds` 是 LinkedHashMap，注册顺序即执行顺序**（`:28`）。
- `load()`（`:39-69`）的顺序很讲究：
  1. 手动 fire `DataPatchLoadEvent` 并 `Vars.state.data.load(patches)` —— 注释说明原因："MDT don't do this with loadGenerator"；
  2. `Vars.world.loadGenerator(width, height) { tiles -> genRounds.forEach { 计时 } }`；
  3. 失败 → `MapManager.loadMap()` 换图兜底；
  4. `if (script.enabled) return` —— 因为 `WorldLoadEvent` 已经启用过它了；
  5. `MindustryDispatcher.safeBlocking { ScriptManager.enableScript(script) }`；
  6. `if (!checkEnabled(...)) MapManager.loadMap()` —— **脚本启用失败就换图**，避免玩家卡在坏地图。
- `Provider.lazyGetMap`（`:84-95`）造一个假 `Map(Vars.customMapDirectory.child("unknown"), w, h, StringMap{name/author/description/rules=JsonIO.write(generator.rules)}, true)` —— 把内存里的 `Rules` 序列化进 tags，这样原版换图流程能"看见"这张地图。
- 地图 ID 从文件名取：`id.split('/').last().toIntOrNull() ?: error("MapScript must named as {id}.kts")`（`:117`）。

### 12.4 地图标签

```kotlin
fun Script.registerMapTag(name: String) { TagSupport.knownTags[name] = scriptInfo; onUnload { knownTags.remove(name) } }
fun Script.mapTag(name: String): ReadOnlyProperty<Any?, String> = ... { Vars.state.rules.tags.get(name).orEmpty() }
```

`knownTags` 是 `tag → ScriptInfo`；`findTags(rules)` 取交集（`TagSupport.kt:14-17`）。
`mapTag("@TDDrop")` 在读值时**顺带注册**（`:25-28`），所以 `TDDrop.kts:141 val tdMode by mapTag("@TDDrop")` 一行完成"注册 + 读取"。
`TDDrop.kts:143-144` 展示了运行时自禁用：`if (tdMode == "false" || tdMode == "off") ScriptManager.disableScript(this, "@TDDrop=$tdMode")`。

`mapRule.kts` 把地图标签变成权限：读 `@permission`（`;` 分隔）→ 过滤白名单 → `PermissionApi.default.registerPermission(group, permissions)`，并确保 `group` 列表里 `@mapRule` 排在其他 `@` 组之前（`:20-27`）。

### 12.5 位置标记（PosMark）

`mapScript/shared/posMark.kts`：地图里放"世界信息板"（`Blocks.worldMessage`），每行 `@type k=v`。
- 静态：`val posMap by autoInit { world.tiles.forEach { parse(it)?.also { it.remove() } } ; groupBy { type } }` —— **解析后把方块删掉**（`:22-31`）。
- 动态：`listen<TileChangeEvent>` → `launch(Dispatchers.gamePost) { tile.removeNet(); parsed.forEach { commands[type]?.invoke(it) } }`（`:36-46`）。
- `PosMark.error(msg)` 用 `Call.labelReliable` 在坐标上打提示（`lib/PosMark.kt:13-15`）。

### 12.6 游戏时间调度

`mapScript/lib/util.kt:30-49`：

```kotlin
val GameState.gameTime get() = (Vars.state.tick / 60).seconds        // 按 tick，暂停不计
suspend fun delayUntil(gameTime: Duration) { while (true) { val left = gameTime - Vars.state.gameTime; if (left.isNegative()) break; delay(left) } }
fun CoroutineScope.schedule(time: Duration, context, body) { if (Vars.state.gameTime > time) return; launch(Dispatchers.game + context) { delayUntil(time); body() } }
```

注意与 `variables.kts:46-48` 的 `{state.gameTime}` 变量不同：那个是 `Duration.between(startTime, now) - pauseTime`（挂钟时间减暂停），这个是纯 tick 推导。`delayUntil` 的 `while(true)` + `delay(left)` 会在暂停时无限循环（`left` 不变），实际靠 `delay` 让出而不忙等。

`schedule(20.minutes) { ... }` 在 `1001/1002/1003/1004/1009.kts` 大量用于"随时间发物资"。

---

## 13. Hexed 六边形 PVP 地图组件

### 13.1 网格几何

`hexed.HexedGenerator.kt`：

- 尺寸反推：`width = ceil(((wNum-1)/2*sqrt(3)+1)*spacing)`，`height = hNum*spacing`（`:22-23`）—— 六边形蜂窝的包围盒公式。
- `chunkCenters`：奇偶行交错（`cy = dy*(1+y*2+x%2)`），忽略最上一排交错（`:31-45`）。
- `genHex`：`d = (spacing-wallWidth)*2/sqrt3`（外接圆半径），用 `Geometry.circle` 粗筛 + `Intersector.isInsideHexagon` 精确判定 → `setBlock(air)`（`:48-55`）。
- `genPath`：`Bresenham2.line` 连线 + 圆形笔刷挖通道（`:58-66`）。
- `applyRules`：`tags["hexed"]="true"`、`canGameOver=false`、`polygonCoreProtection=true`、`cleanupDeadTeams=true`（`:24-29`）。

不同地图通过不同参数得到不同玩法：`1001`(默认 5/7/76/3，过道 5)、`1002`(4/5/144/34)、`1003`(spacing 88, wall 5)、`1004`(4/5/78)、`1005`(88/5)、`1009`(4/5/96/11/9)。

### 13.2 两阶段队伍分配

`hexed.HexData.kt:88-130`：

- **阶段 1**：优先复用玩家上次的队伍（若仍 active 且无人在内）→ 若某队已占 ≥4 区块则进入阶段 2 → 否则随机取空区块，找第一个 `id > 6 && !active` 的队伍，`occupy` + `giveLoadOut`。
- **阶段 2**：复用有核心的队伍 → 否则取"人数*3 + 区块数"最小的活队伍均衡，兜底 `Team.get(255)`（观察者）。
- 广播"巨头出现，进入第二阶段"/"所有区块分配完毕"。

`occupy(team)`（`:44-63`）把 schematic 平移到区块中心逐个 `setNet`/`configureAny`，并维护 `TeamData.hexes` 集合；`coreTile` 从 `Vars.world.tile(x,y)` 实时取。

`hexed.kts` 把核心破坏/建造接到区块归属：

```kotlin
listen<BlockDestroyEvent> { val core = it.tile.build as? CoreBuild ?: return@listen
    core.items = ItemModule()                                    // 清空物品，防止爆炸连锁
    launch(Dispatchers.gamePost) { HexData.pos2hex[core.pos()]?.occupy(core.lastDamage) } }   // 归属给破坏者
listen<BlockBuildEndEvent> { ... HexData.pos2hex[core.pos()]?.occupy(core.team) }
listenTo<AssignTeamEvent> { team = HexData.assignTeam(player, group) }
onEnable { launch(Dispatchers.game) { delay(1.minutes); state.rules.canGameOver = true } }
```

`core.lastDamage` 是 Team 类型，直接用作用户队 —— 借用了 Mindustry 的字段语义。
`onDisable { HexData.reset() }`（`:35-37`）清空全部状态，符合地图脚本"一局一清"。

### 13.3 生成辅助

`hexed.GeneratorHelper.kt`：`genTopography`（双 Simplex 噪声决定 floor/block，5 个气候带 x 6 个海拔）、`genOres`（构造 `GenerateFilter.GenerateInput` 手动驱动 `OreFilter`）、`genRandomStone`（3% 概率放巨石，按 floor 选类型）。

---

## 14. wayzer 关键实现精读

### 14.1 地图管理系统（`maps.kts` / `maps.registry.kt` / `maps.manager.kt`）

**反原版逻辑的 hack**（`maps.kts:66-75`）：

```kotlin
val control = Core.app.listeners.find { it.javaClass.simpleName == "ServerControl" }
val field = control.javaClass.getDeclaredField("inGameOverWait")
field.isAccessible = true
logger.info("inExtraRound:" + get(control))
setBoolean(control, true)
```

把原版"游戏结束后等待"的标志常置为 true，从而**完全接管** GameOver 流程（自己播报、选图、延时换图）。`logger.info("inExtraRound:" + get(control))` 是作者留下的调试痕迹。

**`loadMapSync` 的时序控制**（`maps.manager.kt:88-145`）：

```kotlin
val event = MapChangeEvent(info, map).apply {
    rules.idInTag = info.id
    Regex("\\[(@[a-zA-Z0-9]+)(=[^=\\]]+)?]").findAll(map.description()).forEach {   // 地图描述 → rules.tags
        rules.tags.put(it.groupValues[1], it.groupValues[2].takeIf(String::isNotEmpty) ?: "true")
    }
}
if (event.emitAsync().cancelled) return
Call.worldDataBegin(); Vars.logic.reset()
Vars.world.resize(0, 0)      // Hack: Some old tasks have posted, so we let they run.
nextTick()                   // 让上一帧残留任务跑完再继续
current = info
tmpVarSet = block@{
    if (map == MapRegistry.GeneratorMap) { Vars.state.rules.idInTag = info.id; return@block }
    Vars.state.map = map; Vars.state.rules = event.rules
}
info.provider.loadMap(info)  // ResetEvent → WorldLoadBegin → WorldLoadEnd → WorldLoad
```

`tmpVarSet` 之所以延迟到 `DataPatchLoadEvent` 才执行（`maps.kts:123-126`），是因为 `DataPatchLoadEvent` 是加载地图/存档时的**第一个事件**，必须在那之前把 `state.rules` 设好，补丁才能应用到正确的 rules 上。

**`idInTag`**（`:165-170`）把地图 ID 存进 `rules.tags["id"]`，使 `SaveProvider`（存档）也能还原出 `MapInfo.id`。

**多 Provider 聚合**（`maps.registry.kt:68-112`）：`searchMaps` 用 `coroutineScope { providers.map { async { it.searchMaps(search) } }.flatMap { it.await() } }` 并发查询；`GeneratorMap` 是一个空 `Map` 哨兵（`:70`）；`nextMapInfo` 优先同模式随机、`GetNextMapEvent` 可改。

`maps.kts:16-45` 的本地 Provider 用**文件名首字母**判模式（`A→attack`/`P→pvp`/`S→survival`/`C→sandbox`/`E→editor`）—— 不需要读地图内容，极快。

`resourceHelper.kts` 是第三个 Provider（远程资源站），带 Guava 1 小时搜索缓存、3 次重试、`findById` 限定 id ∈ 10000..99999、`lazyGetMap` 用匿名 `Fi` 覆写 `read()` 从内存字节构建地图（`:110-118`）。

### 14.2 投票系统

`vote.lib.kt` 的 `VoteEvent` 是一个"自带协程任务的事件"：

```kotlin
suspend fun awaitResult(): Boolean { mainJob.join(); return succeed }
val mainJob = scope.launch(Dispatchers.game + CoroutineName("Vote Service"), CoroutineStart.LAZY) main@{   // :50
    ...
    emitAsync { ... }         // 发射事件（监听者可 cancel → mainJob.cancel()）
    ...
    select { actionHandler.onJoin {}; onTimeout(voteTime.toMillis()) { ...统计... } }   // :97-110
}
```

要点：
- `active.compareAndSet(null, this)` 保证**同一时刻只有一个投票**（`:64-73`），并用 `awaitCancellation` + `finally` 保证结束即释放。
- 投票动作通过 `Channel<Pair<Player,Action>>(UNLIMITED)` 串行处理（`:159-199`），避免并发改 `voted`；`fastSuccess` 时一旦满足阈值立即 `return@coroutineScope`。
- 单人快速投票：所有人都不在时，且距上次离开/成功 > 60 秒才通过（`:56-63`）。
- 弹窗投票对每个未投票玩家 `delay(menuDelay*1000)` 后 `openMenu`（`:88-93`），菜单"待定"还会 20 秒后重开（`:149-155`）。
- 冷却：失败时记 `coolDowns[starter.uuid()]`（`:112`）。
- 统计输出用 Mindustry 图标码 `\uE804\uE853\uE805\uE88F`（`:126`）。
- 注册接口 `VoteService.addSubVote(desc, usage, vararg aliases) {}`（`:222-229`）自动给子命令套 `wayzer.vote.<name>` 权限。
- 文字投票监听在 `vote.kts:23-32`（`赞成/y/1`、`反对/n/0`、`中立/.`），并在积分板注册 `scoreboard.ext.vote`。

### 14.3 队伍分配（`betterTeam.kts`）

解决"一群人同时连入导致分配不均"：

```kotlin
netServer.assigner = NetServer.TeamAssigner { p, g ->
    val g2 = if (g == Groups.player) {                       // 只有"全部玩家"场景才特殊处理
        if (!p.con.isConnected) connectingPlayers.add(p)
        checkConnectingPlayers() + g
    } else g
    randomTeam(p, g2)
}
```

`checkConnectingPlayers()` 清掉已连上的，剩下的（正在握手的）也算进"人数"参与均衡（`:23-26,32-38`）。
`randomTeam` 顺序：`savedTeams`（离队前队伍）→ 当前队伍（未死时）→ `AssignTeamEvent` 可覆盖 → `allTeam.shuffled().minByOrNull { group.count { p -> p.team() == it && player != p } }`（`:86-96`）。
额外修正：`CoreChangeEvent` 时把 `lastDamage == team` 的建筑改判 `derelict`，修"诈尸"（`:66-74`）；`BlockDestroyEvent` 里 `allTeam.singleOrNull()` 时自定义 GameOver（`:54-64`）。

### 14.4 反作弊 / 防卡服（`reGrief/`）

**`history.kts`**：`lateinit var logs: Array<List<Log>>`，索引 `tile.array()`；`log()` 用 `LinkedList` 截断到 `historyLimit`；`sealed class Log` 的每个子类自带 `PlaceHoldString` 描述（`:11-35`），`descLog()` 用 `{time HH:mm:ss}` 和 `netServer.admins.getInfo(uid)` 渲染。
**核心爆炸溯源**：`BlockDestroyEvent` 里若核心被拆且距上次 > 5 秒，扫描周边 21×21 找 `dangerBlock`（钍反应堆/各类管道容器）的最后一条放置记录（`:149-169`）—— 把"谁在核心旁放了炸药"直接呈现在 `/history core`。
**`limitLogicPacket.kts`**：`RateKeeper` 滑动平均（`:17-28`）、监听 MindustryX 的 `SendPacketEvent`（`event.con == null` 判断是世界处理器）、反射读 `NetServer.buildHealthChanged`（`:58`）、超 2000/s 直接 `state.rules.disableWorldProcessors = true`；启动时用 `LogicBlock::class.java.getDeclaredField("running")` 做**版本探测**并 `error("本脚本依赖MindustryX v143.102 或更新版本")`（`:10-14`）。
**`bugFixer.kts`**：`Pools.typePools` 反射清空（mod 图内存泄漏）；`Version.build == 146` 时特判 StorageBlock 合并刷物品（`:26-34`）。
**`unitLimit.kts`**：`TimedKillc`/`BuildingTetherc` 排除（自杀单位和建筑挂载单位不该被杀）、按血量升序杀、`SpecialFlag=1024` 标记工厂产物、下一波预计算 `sum >= 3000` 触发终结波（`:62-85`）。

### 14.5 用户系统

**`PlayerData`**（`wayzer/lib/PlayerData.kt`）：三份表 —— `preOnline`（握手阶段用 `usid` 索引，`forAuth`）、`online`（`Player → PlayerData`）、`history`（Guava 1 天）。
`authed` 的定义是 `id !== uuid`（`:14`），即"主 ID 被换成了登录站点返回的 gid"。`get(player)` 时自动 `addId("ip:${con.address}")`（`:49`）。
`shortId` 通过服务查（`IGetUidByShortId.getOrNull()?.getShortId(this) ?: id`），服务缺失时退化成全 uuid。

**`shortID.kts`** 的算法值得注意：`md5(md5(bs) + bs)` 双重摘要 + Base64 取前 3 字符 + 字符替换（`k→K`、`S→s`、`l→L`、`+→A`、`/→B`）规避易混淆字符与 URL 特殊字符（`:11-29`），并在 `PlayerLeave` 时检测 3 位 ID 碰撞并告警（`:35-42`）。

**`suffix.kts`**：`@Savable clientType: MutableMap<String,Char>` 记录客户端类型；通过自定义包名 `ARC`/`MDTX`/`fooCheck` 识别客户端（`:27-42`）—— 说明这些是客户端 mod 的握手包名。`onDisable` 里 `netServer.getPacketHandlers("ARC").clear()` **清空整个 handler 列表**（`:44-47`），属于粗糙但有效的做法。

**`whiteList.kts`**：三种模式 `Silent/Menu/Force/Auto`；`Auto` 时按在线人数自动启用（`:100-104`）；`auth()` 调 `https://api.mindustry.top/servers/auth/check` 并用 `serverId`（进程级 UUID）作为 state 防 CSRF；登录成功后**踢出重进**（`player.lastText = "[Silent_Leave]"; kick(serverRestarting)`）以免热更新权限（`:64-72`）—— 配合 `welcomeMsg.kts:28` 的 `lastText != "[Silent_Leave]"` 不播报离开消息。

### 14.6 其它值得记录的实现细节

- **`autoUpdate.kts`**：用 `BeControl::class.java.protectionDomain.codeSource.location.toURI().path` 定位**当前运行的 server jar**（`:85`），下载到 `.tmp` 后在重启前覆盖。`isNewVersion` 对 MindustryX 用反射读 `Version.mdtXBuild`（`:44-51`）。
- **`autoSave.kts`**：`nextSaveTime` 算出下一个整 10 分钟（`t.add(MINUTE, (mNow+10)/10*10 - mNow)`）；存档槽位 `100 until 106` 按分钟取模选号（`:46`），`SaveIO.write` 到临时文件再 `moveTo`（原子替换），`extraTags` 写入 `[回档$id]` 前缀。
- **`mapSnap.kts`**：自研 `MapRenderer` 逐 tile 取色，颜色来源是**jar 内置资源** `/block_colors.png`（`:34`，工作区里确实有 `wayzer/map/mapSnap.block_colors.png`）；`registerVar("wayzer.ext.mapSnap._get", ..., { MapRenderer.img })` 把图片对象直接暴露成变量。
- **`pixelPicture.kts`**：`argb8888ToColor` 手写位运算（`:23-30`），最近色用平方距离取 `content.items().min`，绘制时每 10 像素 `nextTick()`（`:80-83`），用 `setNet(Blocks.sorter, Team.crux, 0)` + `Call.tileConfig` 让分类器"显示"物品颜色。
- **`14562.kts`（填海造陆）**：`IslandTile` 在构造时把非 spawn 的地块**变成深水并隐藏**（`discoverInit` 用于初始爆发扩张，不做网络同步；`discover` 用 `setFloorNet` 做同步）；`world.packArray(x,y)` 做索引；`discoverQueue` 每 tick 处理 5 个（`:70-74`）。
- **`999.kts`（合影图）**：`resources` 全开、`unitDamageMultiplier = 0f`、`unitCap = 1 - coreShard.unitCapModifier`；`TapEvent` 点核心 → 用 `PlayerData[uuid].id` 认领区块，3 秒内重复点击视为"找回自己的地"直接传送（`:170-177`）。
- **`13545.menu.kt`（CoreWar）**：`CoreWarTeamData` 用 `by team.rules()::blockDamageMultiplier` 把队伍规则变成可变属性委托（`:27-30`）；`costOption` 在花费 > 10% 资源时弹二次确认菜单（`:55-65`）；`MonoAI : MinerAI` 覆写 `updateMovement` 关掉自动切换矿种（`:225-232`）。
- **`scoreboard.kts`**：`Call.infoPopup` 每 2 秒刷新，按 `con.mobile` 调整宽度（`:53-57`）；`{magic}` = `[#FEBBEF][]` 是给 MDTX 客户端识别积分板的暗号（`:23`）。
- **`voteOb.kts`**：`@Savable(false) val limitPlayers` 记录强制观战；`Priority.Intercept` 拦截 `AssignTeamEvent` 直接改 `team = spectateTeam`；并**重定义 `/votekick`** 为 `arg = listOf("ob", *arg); VoteEvent.VoteCommands.handle()` 转发（`:85-93`），实现"旧命令名兼容"。
- **`profiler.kts`**：`DisposableHandle` 保存"停止采样"闭包，`onDisable` 时若还在采样则自动 stop（`:29-32`）—— 避免脚本重载导致 profiler 悬挂。
- **`console.kts`** 的自定义 `Completer` 用 `runBlocking(Dispatchers.game)` 回到主线程补全（`:51`），因为补全需要读游戏状态。

---

## 15. 全项目复用的八种扩展手法（可迁移的"设计模式"）

1. **反射当扩展点**
   `ReflectHelper.reflectDelegate()`（`coreLibrary/lib/util/ReflectHelper.kt`）被用于读 `Net.serverListeners`、`NetServer.buildHealthChanged`、`TypeBinder.tree`；
   直接 `getDeclaredField` 的有：`ServerControl.inGameOverWait`、`ServerControl.serverInput`、`ServerControl.handler`、`NetServer.clientCommands`、`LogicBlock.running`、`Pools.typePools`、`Version.mdtXBuild`、`Events.events`。
   **共同点**：先 `isAccessible = true`，且多数放在 `onEnable` 里（并在 `onDisable` 还原）。

2. **事件当扩展点**
   权限（`RequestPermissionEvent`）、队伍（`AssignTeamEvent`）、地图（`MapChangeEvent`/`GetNextMapEvent`）、投票、服务（`ServiceProvidedEvent`）、翻译（`NewSentenceEvent`）。
   惯例：**可取消事件继承 `Event.Cancellable`，可改数据的事件直接暴露可变字段**（`MapChangeEvent.rules`、`GetNextMapEvent.mapInfo`、`RequestPermissionEvent.group`）。

3. **DSLBuilder dataKey 挂载脚本状态**
   出现点：`Script.listener`、`Script.configs`、`Script.registeredVars`、`Script.providedService`、`Script.registeredTable`、`Script.mapPatches`/`mapAssets`、`MenuV2.stateKey`。
   语义：**状态属于脚本实例**，脚本卸载即回收；`dataKeyWithDefault` 提供默认值；`DSLBuilder.lateInit` 用于延迟绑定（`Config.clientCommands`/`serverCommands`）；`DSLBuilder.NameGet` 用于拿到属性名（`ReflectHelper`、`stateKey`）。

4. **成对注册 / 反注册**
   凡 `onEnable` 里动了全局对象，必须有 `onDisable` 复原（见 §4.3 清单）。`Listener` 是唯一被框架自动化的一环。

5. **`by` 委托做懒加载**
   `by config.key(...)`（配置）、`by autoInit { }`（懒初始化，重载重算：`posMap`、`settings`、`localCache`）、`by mapTag()`、`by Services.get<>().notNull`、`by PlaceHold.reference<T>()`、`by reflectDelegate()`、`by DSLBuilder.lateInit()`。

6. **接口 + 实现脚本分离**
   接口在 `.api.kt` / `lib/*.kt`（带 `//@file:Depends(...)` 注释指向实现），实现加 `@file:Implement`，消费用 `by Services.get<IFace>().notNull`。方向恒定：**接口在底层模块，实现在上层模块**（`ban.api.kt` 在 user，`banStore.kts` 在 store）。

7. **软依赖 + `export`/`import` 做可选功能**
   `soft = true` 的依赖不参与加载顺序，运行时 `depends("id")?.import<Fn>("name")?.invoke(...)`，功能缺失只是少一个入口（`/maps` 没有 voteMap 时提示"请手动换图"）。

8. **用变量系统做 UI 扩展总线**
   `registerVar` 注册数据，`{listPrefix xxx|joinLines}` 聚合（积分板），`registerChild("prefix./suffix.*")` 自动拼名字 —— 新脚本不改动任何已有文件就能往界面上加东西。

---

## 16. 写一个新插件的落地清单

按代码中反复出现的模式，最小可用流程：

```
myPlugin/
  module.kts                     @file:Depends("coreMindustry")
                                 @file:Import("myPlugin.lib.*", defaultImport = true)
  myFeature.kts                  命令 + 事件监听 + 配置
  myFeature.api.kt               跨脚本接口（可选，同名合并进 myFeature 单元）
  lib/Helper.kt                  纯工具（被 module 的 defaultImport 覆盖）
```

要点（每条都能在现有代码里找到范例）：

1. 依赖写 `@file:Depends`，可选功能写 `soft = true` 并用 `depends(id)?.import<Fn>("name")`。
2. 命令默认权限用 `permission = dotId`（自动变成 `myPlugin.myFeature`）。
3. 阻塞 IO 必须 `withContext(Dispatchers.IO)`；耗时主线程操作拆 `nextTick()` 或 `launch(Dispatchers.gamePost)`。
4. 全局副作用成对写 `onEnable`/`onDisable`；长期任务在 `onDisable`/`ResetEvent` 里 `cancelChildren()`。
5. 资源不满足时用 `ScriptManager.disableScript(this, "原因")` + `return@onEnable`，原因会显示在 `/sa fail`。
6. 跨脚本通信用 `Services`（对象）或 `export/import`（函数），不要直接引用别人的顶层属性。
7. 给玩家看的字符串一律 `"...".with(...)`，控制台输出用 `ContentHelper.logToConsole`。
8. 数据表用 `DBApi.registerTable(Table)`（需 `@file:Depends("coreLibrary/db")`），简单 KV 用 `KVStore`。
9. 想被地图启用就放 `mapScript/` 下，文件名 = 地图 id 或 `registerMapTag("@xxx")`；用 `mapPatches`/`mapAssets` 改数值。
10. 开发期 `/sa genMetadata` 生成 `.metadata`；发布/加速用 `/sa packModule <module>`（产物在 `Config.cacheDir`）。

### 常见坑（源自代码里的注释与写法）

- `CommandInfo.attr` 必须在 `body` **之前**（`freeze` 后报错）。
- `returnReply` 抛 `CommandInfo.Return`；在协程里不要用普通 `cancel()` 退出（框架会打警告）。
- `safeBlocking` 只能在主线程调用，且不能传 `CoroutineScope`。
- 不要在 `Dispatchers.game` 上用 `yield()`（会被记警告），用 `nextTick()`。
- `Services.get<T>().notNull` 用 `by` 延迟取值，别在脚本顶层 `=` 直接取。
- `@Savable` 的集合若含不可序列化元素（如 `Player`），必须 `serializable = false` + `customLoad` 过滤。
- 数字开头的 `.kts` 文件名（`999.kts`）在 Kotlin 侧会变成 `_999`（见 `.metadata` 的 `FQ_NAME`）。
- `registerGenerator` 要求文件名是纯数字（`ScriptMapGenerator.kt:117`）。
- `.metadata` 的合并策略是"保留旧的"，删除脚本后需手工清理条目。

---

## 17. 与 README 的差异 / 补充点汇总

| README 说法 | 代码实际 |
|---|---|
| §6.2 "内置 `genRound("init") { it.fill() }`" | 正确（`ScriptMapGenerator.kt:32`） |
| `/sa packModule` 产出 `$module.packed.zip` | 落在 `Config.cacheDir` 下（`helpful.kts:85`） |
| 未提及 `.kt` 与 `.kts` 的合并规则 | §1.1：同名前缀 `.kt` 并入同一脚本单元（`.metadata` 证据） |
| 未提及 `safeBlocking` / `blockingQueue` | §5.2：这是 mapScript 能在同步事件里加载脚本的关键 |
| 未提及 `templateHandler` 劫持做 i18n | §8.1：`lang.kts` 包装原 handler，按 `receiver.lang` 查表 |
| 未提及 `subCommandOverwrite` 把原版命令注入 help | §6.3：`CommandImpl.kt:30-54` |
| 未提及 `tmpVarSet` / `inGameOverWait` / `resize(0,0)` 三个 hack | §14.1 |
| 未提及 `nameExt` 的前后缀注册点拼接 | §8.3 |
| 未提及 `WithCache` 读穿装饰器与 RPC classloader 处理 | §9.4 |
| §8.13 提到的坑 | 与代码一致，另外补充 §16 末尾 9 条 |
