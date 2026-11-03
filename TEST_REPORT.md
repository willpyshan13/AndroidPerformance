# 当前验证记录（2026-11-03）

## Macrobenchmark 真机执行链路（2026-11-03）

- 在 API 25 / rk3399-all 真机上，用临时 AndroidX Macrobenchmark 工程（AGP 8.7.3、Gradle 8.9、AndroidX Macrobenchmark 1.4.1）调用产品 `/api/benchmark/gradle/run` 路由执行 `:macrobenchmark:connectedBenchmarkAndroidTest`。macOS JDK 17 自动发现后，单次冷启动 instrumentation 构建、安装和执行成功，端到端用时约 35 秒；AndroidX 生成 `dev.apw.macrobenchmark-benchmarkData.json`（经 `parseBenchmark` 解析为 1 项 TTID 指标）和 1 个 1,875,144 字节 Perfetto trace。目标 APK 加入 ProfileInstaller 1.4.1 后通过 shader-cache 清理前置步骤。
- 首轮验证发现标准报告文件名为 `dev.apw.macrobenchmark-benchmarkData.json`，而扫描器只认 `benchmarkData` 开头的文件；已改为识别包含标准 `-benchmarkData` 后缀的 JSON，并用真实设备复跑确认产品执行器自动返回解析后的报告及 trace。对应单测覆盖该 AndroidX 文件名，Macrobenchmark 单测 2/2 通过。
- 通过本机受控产物 API 下载同次真实 trace：HTTP 200、1,875,144 字节，SHA-256 与原始 trace 一致。这个验证覆盖运行、结果发现、报告解析和 trace 文件安全交付；没有把旧设备上的结果当作跨设备性能结论，也尚未核对报告和 trace 中的设备身份关联。
- 此测试同时发现内置 Temurin JRE 缺少 `javac`，无法构建 Android 工程。新增 Gradle JDK 选择：优先使用完整 `JAVA_HOME`，macOS 再查询已注册的 Java 17 / Android Studio JBR，未发现时回退到内置 runtime；Gradle 进程的 `JAVA_HOME` 与实际启动的 JDK 保持一致。
- 最新 macOS ARM64 `.app` 由 `npm run package:mac` 构建成功；`node scripts/mac-desktop-smoke.js` 通过，验证 Electron renderer、13 个主页快捷入口、16 个英文导航路由及 HPROF、布局、源码、Network Agent、50k CPU 时间线和 APK 分析 smoke。此包使用本机 ad-hoc 签名，未公证。

## Compose 编译器自动执行观测

- 新增可选 Kotlin 2.2.21 Compose 编译器插件和 `ApwComposeAutomaticProbe.kt` 运行时入口。插件识别目标模块编译的 `@Composable` 函数，将记录调用放入 Compose 编译器生成的非跳过分支；自动模式不需要在各个 Composable 手写 probe。
- 事件采用独立 `APW2`（函数体执行）与 `APW3`（Composer 跳过）格式，记录进程会话、函数名、父函数、累计函数/边计数和设备单调时钟。解析器在新版事件中构建 Logcat 窗口内的聚合调用树；旧版 APW2 和 `APW1` 显式 probe 仍兼容解析。
- 新版事件同时记录 Compose Compiler 从 `startRestartGroup` 读取的组 key；调用树显示该 key，可与 Agent 的 `CompositionData` 组合组节点 `compose-key` 对照。API 25 / Compose 1.7.6 真机结果中，`InstrumentedScreen` 的 `-345845228` 与 Agent 运行时组一致，`StaticChild` 的 `-981513431` 也一致。该关联验证的是函数调用节点到运行时组身份的匹配；它不把相邻 State 读取关系推断为因果，State Reads 仍按 RecomposeScope 单独计数。
- 界面会按相同 key 将当前 Agent 布局快照中 State-scope 关联总数显示到调用树；重复 key 显示组数，缺失或不可用状态会明确标记。此关联方便对照，不代表 State 读取由该函数直接触发。
- 插件 `gradle jar` 构建成功；真实 Compose 1.7.6 页面在 API 25 设备触发三次状态更新后，桌面 ADB snapshot 读回 16 条 APW2/APW3 记录、0 条无效，并构建三层关系 `onCreate.<anonymous> → InstrumentedScreen → StaticChild`；父项执行 4 次，静态子项执行 1 次、跳过 3 次。`javap` 确认进入/退出钩子按父子顺序嵌入字节码，正常与 skip 分支分别记录。验证使用临时 smoke APK，不代表用户目标应用已接入插件。
- 插件目前只支持匹配 Kotlin 2.2.21 编译器 API，且只插桩本次编译的目标模块，不覆盖未重编译依赖；调用树按函数名和可用组 key 聚合 Logcat 窗口内记录，不能区分同名 Composable 的多个实例，也不是完整运行时组树，不提供 State Reads 或 Jank 因果。部分 lambda 没有 restart-group key；环形日志也可能截断调用边。每次执行写一条 debug 日志，正式测量前应移除。
- 该计数和聚合调用树不提供完整 Composable 运行时实例树、State Reads 因果或 Jank 因果，也不代替完整 Compose Runtime Inspector。临时 smoke APK 在验证完成后卸载，并恢复用户原 Activity。
- 本轮完整回归：224 项，208 通过、0 失败、16 项因未配置可选外部样本而跳过；`npm run check` 与 `git diff --check` 通过。测试期间修正了 Benchmark API 测试的整秒时间夹具，避免跨秒时序造成偶发误失败。

## OkHttp Agent API 25 真机链路验证

- 使用项目内 `NetworkEvents.java` 和 `LogcatSink.java` 构建临时 OkHttp 4.12 debug 应用，通过 ADB reverse 把设备请求导向本机测试 HTTP 服务。应用实际请求了带有路径的 URL，服务端确认收到 `GET /capture-path-is-not-logged` 并返回 HTTP 200。
- 桌面端按 API 25 设备兼容路径回退到目标主进程 PID 读取 Logcat，得到 1 条有效记录、0 条无效记录：主机 `127.0.0.1:18080`、GET、状态 200、耗时及连接/等待/读取阶段；解析结果将 path 标为“未采集”，重建 URL 只保留 origin，原始请求路径未泄漏。
- 临时 APK、ADB reverse 转发均已移除，并恢复 `com.will.calendar.demo/.CalendarDemoActivity`。该结果验证已接入该 OkHttp Agent 的应用，不代表无需接入即可捕获设备全部流量；响应体未读取，因此响应读取字节显示 0。

## 应用内 Android View Debug Agent

- 新增仅供目标应用 debug 构建接入的 `LayoutAgent.java`：通过 Android 本机抽象 socket 在应用进程内读取当前 Activity View 树、属性与窗口截图；最多 10,000 节点、100 层；`FLAG_SECURE` 或超过 16,000,000 像素时不生成截图。
- 桌面端生成 24 字节随机令牌，临时执行 `adb forward tcp:0 localabstract:<socket>` 并在结束时移除转发；目标端校验共享令牌。源码包包含集成说明；未接入 Agent 的应用继续使用 UIAutomator 回退。
- 5 项集成测试覆盖转发/清理、令牌拒绝、截图不可用与截断标记、受令牌保护的 API 和源码 ZIP 内容。Java 源码以 Android 31 `android.jar` 编译通过。
- API 25 / rk3399-all 真机临时安装独立 debug fixture：实际获取 9 个 View 节点、1080×1920 PNG 和 240 dpi；验证 Button 状态、密码文本与内容描述脱敏、错误令牌拒绝及失败后移除 ADB 转发。测试 APK 已卸载，并恢复原 `com.will.calendar.demo/.CalendarDemoActivity` 前台。目标 Compose 应用本身没有接入 Agent 源码，故未声称对该应用完成 Agent 采集。
- Compose Semantics 支持：以本地缓存的 AndroidX Compose UI 1.7.6 AAR 核对 `AndroidComposeView.getSemanticsOwner()`、merged/unmerged 根、节点 bounds/config/children 与属性 key 的公开反射签名；用相同方法签名的测试宿主在 API 25 真机采集出 merged/unmerged 树、文本、TestTag 和点击状态，并验证 `Password` 文本及内容描述均已脱敏。另以独立临时 debug APK 运行真实 Compose Runtime 页面验证 probe 的重组计数；目标 Compose 应用仍须接入 Agent/probe 后验证。
- Compose Runtime 检查增量：Agent 反射读取 `AbstractComposeView` 的 `CompositionData` 组合组树，并从 `observations.asMap()` 统计各 `RecomposeScope` 关联的已观察 State 数量；不输出 State 实例或值。Compose 1.7.6 临时 fixture 在 API 25 真机返回 30 个组合组、7 条 State-scope 关联，4 个组带非零关联，兼容性警告为 0；节点嵌入同一布局 XML 并可在界面层级中查看。该树仍不是完整 Composable 函数调用树，源码标签在三次自然状态更新后仍为空，因此 Agent 不会强制重组来触发应用副作用；也没有帧关联。`View.draw` 对 Surface 等硬件层可能不完整。
- 当时完整回归：218 项，202 通过、0 失败、16 项因未配置其他外部样本而跳过；`npm run check`、`git diff --check` 通过。macOS arm64 桌面目录包成功构建，Kotlin probe 和界面已确认包含在 `app.asar` 中；`codesign --verify --deep --strict` 通过。

## Compose Runtime probe（显式插桩）

- 新增 `ApwComposeRecompositionProbe.kt`：Compose Compiler 2.2.21 + Compose Runtime/UI 1.11.1 编译通过。Probe 通过 `SideEffect` 记录每个插桩实例的调用计数、设备单调时钟与随机进程会话/实例 ID，不记录参数或 State 内容。首次设备验证发现 probe 自身可能被 Compose 编译器跳过，已加 `@NonSkippableComposable`，并添加源码包回归断言。
- 桌面端按已选包主进程 PID 读取 `APWCompose:D` main Logcat，聚合本缓冲区当前进程会话中同名实例的最高累计计数；限制返回最近 500 条事件。API 25 不支持 Logcat `--uid`，因此该功能使用 `pidof` + `logcat --pid`，不覆盖目标应用独立子进程。
- 4 项新增单测覆盖会话隔离、实例聚合、格式/大小边界、PID 命令和受令牌保护 API。另建 Compose Compiler 2.2.21 + Compose Runtime/UI 1.11.1 临时页面，在 API 25 设备对同一 `FeedScreen` 实例触发 3 次真实状态重组；Logcat 计数 1–4 连续递增，workbench 的 ADB 采集函数读回 4 条事件、1 个实例、0 条无效记录。该验证覆盖临时 Compose 应用到桌面解析链路，不代表用户目标应用已接入；APK 已卸载并恢复原 Activity。
- 同一兼容性修复还让网络 Agent 在旧版设备不支持 UID Logcat 过滤时回退到目标主进程 PID；新增一项回归测试验证该回退。

## Compose Compiler 稳定性报告导入

- 布局检查页可导入 `composables.txt`、`composables.csv` 和 `classes.txt`，分别查看 composable restartable/skippable 状态、文本报告中的不稳定参数、类及字段稳定性；支持组合搜索和分别载入两类报告。
- 解析器限制单份文件 12 MiB、最多 100,000 行/记录和 64 KiB CSV 单元格；覆盖 UTF-8 BOM、CSV 引号、CRLF 和不完整签名拒绝。5 项单元测试通过。
- 明确标注为 Compose Compiler 静态推断；不伪造运行时重组/跳过计数，静态标记也不能单独证明性能问题。尚未通过带 Compose Compiler 报告的目标 APK 做端到端目视核验。
- 全量回归：207 项，192 通过、0 失败、15 项因未配置其他外部样本而跳过。`npm run check` 与 `git diff --check` 通过。

## HAR / Agent 网络请求筛选

- 网络请求可按域名/路径、方法、状态段、HAR 连接 ID、耗时范围和本地时间区间过滤；汇总卡、域名阶段统计、接口 P50/P95、活动时间线及请求表共用同一筛选结果。
- HAR 仅保留匹配 `[A-Za-z0-9._:-]{1,128}` 的连接 ID；查询参数、凭据、请求头和正文仍丢弃。Agent 目前不提供连接 ID，连接筛选只在 HAR 含标识时显示。
- 单元测试覆盖组合筛选、失败/响应状态、时间范围、耗时边界和无效区间。该次网络真机检查时没有连接设备，因此 OkHttp 网络 Agent 的真实应用链路仍未验证。
- 当前已增加筛选结果 CSV 导出，验证字段引用/引号转义、HAR 查询凭据不泄露、公式注入前缀保护及 50,000 条上限。
- 完整回归：202 项，187 通过、0 失败、15 项因未配置其他外部样本而跳过；`npm run check` 与 `git diff --check` 通过。

## 布局触控尺寸候选检查

- UIAutomator 布局采集新增 `wm density` 读取，优先采用 Android 报告的 override density；密度查询不可用时保留截图/层级采集并显示警告，不进行 dp 判断。
- 节点线索新增可点击、长按或可勾选节点的可见 bounds 换算；任一边小于 48 dp 时显示复核候选和换算尺寸。48 dp 来自 [Android 官方可访问性指南](https://developer.android.com/guide/topics/ui/accessibility/apps)。结果只代表 UIAutomator 返回的可见边界，不能观察 padding、TouchDelegate 或 Compose 最小触控区域，不能据此确认真实触控目标过小。
- 合成层级覆盖 override density、48 dp 阈值、长按节点、禁用节点、缺失 bounds、未知密度回退；ADB 测试覆盖截图/层级可用但密度读取缺失的降级路径。
- 该次完整回归为 207 项，192 通过、0 失败、15 项因未配置其他外部样本而跳过；当时没有连接设备。后续 View Agent 真机验证见本报告首节。

## LeakCanary Shark 桌面分析器接入

- 桌面端新增当前 HPROF 会话的 Shark 2.14 分析 API 和报告对话框；使用官方 CLI 的 Android reference matchers、object inspectors、leak signatures 与 retained-size 分析。HPROF 保留在本机临时目录，替换会话或关闭服务时清理。
- 堆分析页可载入 `.map` / `.txt` R8 / ProGuard 映射文件，最大 128 MiB；API 验证 UTF-8、文件名、大小与当前会话，私有临时映射随快照一起清理或通过界面移除。回归覆盖上传、Shark 参数传递、清除、错误扩展名及会话校验。
- 官方发布包由准备脚本校验 SHA-256 后提取核心依赖，并保存 Apache-2.0 / BSD-2-Clause 许可证；打包资源包含 Java 17 runtime。
- 本轮之前已用 Android Studio 官方 `valid_leak_test.hprof`（约 96 MB / 91 MiB）手动运行 Shark 2.14 CLI，约 1.5–2 秒输出 5 条 application leak、0 条 library leak、1 个 unreachable object，以及 Android-specific leak cause、signature 和 retained size。该大样本未加入仓库。
- `npm run prepare:shark` 已成功下载并校验 Shark CLI ZIP（SHA-256 `4a1022a4610fd6a4a1306b264f95985c4210e169e2bd4b0ad19bbdcc16d6beef`），准备 10 个核心 JAR 和 Temurin 17.0.21+9 macOS arm64 JRE；Java runtime 约 130 MiB，资源未提交到源码库。
- macOS arm64 `.app` 打包成功（应用目录约 557 MiB）；检查 `app.asar` 含 Shark 服务、分析模块、映射选择器和上传界面，bundle resources 含 10 个 Shark JAR 与 Java runtime。直接使用已打包 app resources 对官方 HPROF 和测试 mapping 文件运行 Shark 成功，报告含 5 条 application leaks 与 leak signature。
- `APW_SHARK_SAMPLE=/private/tmp/android-studio-valid-leak.hprof APW_SHARK_MAPPING=/private/tmp/apw-shark-test.mapping npm test`：198 项，183 通过、0 失败、15 项因未配置其他外部样本而跳过；包含官方 HPROF + mapping 的 CLI 端到端回归。`npm run check` 与 `git diff --check` 通过。当前 `adb devices -l` 没有设备，未执行真机用例。

## LeakCanary watched-object 路径候选增量

- HPROF 解析器识别 `KeyedWeakReference` 子类，读取 `referent`、LeakCanary `key` 和可用的 `description` / `name`；已清除 referent 单独计数，索引外对象和不完整字段布局按不可用计数。
- 新增批量 GC 根路径查询，一次建立已索引的强引用图，为最多 500 个 watched object 复用路径遍历；排除可识别的 WeakReference / SoftReference / PhantomReference referent 字段。UI 可查看候选对象、key、描述和路径。
- 合成 HPROF 覆盖找到强路径、没有强路径、已清除 referent、key 字符串解析、批量路径共享和输入校验；HTTP 回归覆盖新 API、会话校验及无 marker 快照。
- 该实现不包含 Shark 的 Android reference matchers、object inspectors、leak fingerprint 或 retained-size 计算，不将根路径结果称为已确认泄漏。真机或真实 LeakCanary HPROF 样本尚未验证。
- 完整 `npm test`：194 项，179 通过、0 失败、15 项因未配置官方外部样本而跳过；`npm run check` 与 `git diff --check` 通过。

## LeakCanary 实时日志观察

- 堆分析页新增可启动 / 停止的事件轮询，读取目标应用 UID 范围内的 Logcat；旧设备不支持 UID 过滤时按目标主进程 PID 回退。显示开始观察、对象保留、堆转储、分析及对象清除等可识别事件。
- 解析器丢弃非 LeakCanary 标签和未识别日志内容，只保留匹配事件并限制单次读取与界面累计数量；UI 明确说明没有事件不代表没有泄漏，也要求应用已集成 LeakCanary。
- 单元测试覆盖事件分类、无关行丢弃、事件数量上限、UID 查询、旧设备 PID 回退和目标包校验；HTTP 测试覆盖 token 鉴权及解析结果。
- 完整 `npm test`：279 项，263 通过、0 失败、16 项因未配置可选官方样本而跳过；`npm run check` 与 `git diff --check` 通过。macOS arm64 桌面包重新构建且代码签名验证通过。当前无已连接设备，尚无真机日志验证。

## HPROF 快照对比增量

- 快照对比新增按对象数量筛选增长、减少和不变类，并显示以基线为分母的对象数变化率及记录字段 / 元素字节变化率；基线为零时不伪造百分比，显示新增状态或不可用。
- 继续按无歧义类名匹配快照，不匹配快照局部对象 ID；同名多类不比较，ID 宽度不一致时不比较字节值。字节是记录的字段 / 元素数据，不是浅大小、保留大小或泄漏证据。
- 单元测试覆盖正向变化、减少变化、零基线、同名多类及不同 ID 宽度。完整 `npm test`：193 项，178 通过、0 失败、15 项因未配置官方外部样本而跳过；`npm run check` 与 `git diff --check` 通过。

## 启动 ART 事件归因增量

- 每条追踪启动记录可按 TTID、TTFD 切成“启动至首帧”和“首帧至完全绘制”窗口，读取同一应用进程内已记录的 GC、JIT、类加载、类验证、类初始化切片及并发 dex2oat 进程切片。
- 只报告窗口重叠切片时长与名称，不代表 CPU 执行时间；跨事件存在并发，时长不能相加为启动耗时。缺失切片显示不可用，不推断为零。
- 新增 Trace Processor 合成追踪集成，实际验证六类事件分别进入正确阶段并按窗口裁切；HTTP 测试覆盖会话校验、空结果和进程 ID 注入拒绝。
- 完整 `npm test`：192 项，177 通过、0 失败、15 项因未配置官方外部样本而跳过；`npm run check` 与 `git diff --check` 通过。

## 布局移除节点历史截图回放增量

- 布局基线继续保留截图和设备实际截图尺寸；当前快照、历史基线和相邻时间线比较都可在基线截图上标出已移除节点（红色）和移动前边界（蓝色）。当前截图仍显示新增、变化和移动后边界。
- 回放仅在所选基线记录实际保存 PNG 和尺寸时显示；XML-only 导入不伪造基线图像。边界最多显示 500 个，并沿用现有 resource-id 匹配的身份限制。
- 扩展边界映射测试覆盖 before/after 两侧、移除和移动分类、无效边界和方向校验。浏览器视觉核验待本轮完成。
- 完整 `npm test`：191 项，176 通过、0 失败、15 项因未配置官方外部样本而跳过；`npm run check` 和 `git diff --check` 通过。

## simpleperf 多事件采集增量

- 采集界面支持填写 1–8 个事件；后端校验事件数量、字符、重复值后按 simpleperf 的逗号分隔格式传入 `record -e`，默认仍为 `cpu-clock:u`。
- 模拟 ADB 单元测试核对最终命令参数、保留默认调用兼容，并拒绝空列表、超过 8 项、重复事件和 shell 注入字符；HTTP API 测试核对事件列表转发及 perf.data 下载响应。
- API 25 / rk3399-all 真机验证：设备 simpleperf 返回 1,092 个事件；对前台应用执行短暂滑动操作并同时采集 6 秒 `cpu-clock:u,cpu-cycles:u`，得到 191,748 字节有效 `PERFILE2`。默认分析识别两个事件：`cpu-cycles:u` 349 个样本、`cpu-clock:u` 289 个样本；分别选择事件后，时间线样本数与折叠调用栈均按事件正确切换，返回非空调用栈。符号中可见 ART 与线程池函数；没有匹配应用 ELF 符号，因此不能把未知/运行时栈解释成应用源码热点。设备临时文件与采集锁均清理。
- 设备事件支持度由设备 simpleperf 决定；硬件计数器复用可能影响样本权重。首轮应用空闲采样虽然产出有效 perf.data，但没有调用栈；增加交互负载后才得到可分析样本，工具对无样本结果正确报错。
- `npm run check`、`git diff --check` 通过；完整 `npm test`：189 项，174 通过、0 失败、15 项因未配置官方外部样本而跳过。

## simpleperf 设备事件发现增量

- 新增设备事件读取 API：临时推送 simpleperf 后执行 `list`，解析设备支持事件，最多返回 2,000 项，并在成功或失败后删除设备临时二进制。
- CPU 页面可读取当前设备事件并从下拉列表添加到最多 8 项的采集列表；设备切换后应重新读取。
- 模拟 ADB 测试覆盖事件清单解析、`(may not supported)` 标记剥离、临时文件清理；HTTP 测试覆盖设备序列号转发与事件列表响应。
- `npm run check`、`git diff --check` 通过；完整 `npm test`：191 项，176 通过、0 失败、15 项因未配置官方外部样本而跳过。
- API 25 / rk3399-all 真机验证：事件清单返回 1,092 项，格式可读且临时推送的 simpleperf 二进制已删除；多事件实际采样与解析见上一节。

## 系统追踪自定义 SQL 查询增量

- 对当前追踪会话执行 PerfettoSQL，将 CSV 转成可读表格；限制只读 `SELECT` / `WITH`、可选标准模块声明、单条语句、16 KiB 输入、500 行和 50 列。
- 拒绝 DML / DDL、PRAGMA、文件读写、SQL 注释和过期追踪会话；输出值按 HTML 转义显示。
- Trace Processor 单元验证覆盖 CSV 引号、分号字面值、写入语句拒绝、模块语句、行截断和列数上限。追踪 HTTP 集成验证已用合成 Chrome trace 执行 `SELECT name, ts, dur FROM slice` 并收到 `render` 切片；不安全 SQL 返回 400。
- 完整 `npm test`：187 项，172 通过、0 失败、15 项因未配置官方外部样本而跳过；`npm run check` 与 `git diff --check` 通过。
- 尚未做图形界面的真实浏览器交互回归；设备 ADB 与 Perfetto 采集不是该离线 SQL 路径的前置条件。

## 布局差异截图标记增量

- `npm test`：188 项，173 通过、0 失败、15 项因未配置官方外部样本而跳过；`npm run check` 通过。
- 有基线时，当前截图可显示新增节点（绿色）、属性变化（橙色）、祖先位置或同级顺序变化（蓝色）边界；支持单独开关，不覆盖选择节点高亮或 UIAutomator 可访问性候选标记。
- 最多叠加前 500 个当前仍存在且有边界的差异；移除节点在列表中显示，因为当前截图没有可标注的位置。
- 新增边界映射单元测试，覆盖新增/属性/移动分类、缺失或无效边界过滤及 500 项绘制上限；桌面浏览器视觉核验仍待完成，不将其记为真机界面验证通过。

## Benchmark 自动回读增量

- `npm test`：186 项，171 通过、0 失败、15 项因未配置外部官方样本而跳过；`npm run check` 和 `git diff --check` 通过。
- AndroidX instrumentation 运行前后查询标准 `Android/media/<test-package>/<test-package>-benchmarkData.json` 的修改时间和大小；仅在成功运行且确认文件新鲜更新时读取报告。
- 设备不支持 `stat` 元数据查询、文件未变化、JSON 无效或超过 12 MiB 时不会把报告自动挂到本次运行；仍可在页面输入路径手动读取。
- 单元/API 回归覆盖新报告自动读取、历史文件不回读、测试参数拒绝和手动路径回读。
- 当前环境 ADB 可执行文件被系统以 SIGKILL 终止（退出码 137），因此本增量未做真实设备 instrumentation 验证。

## CPU 调用树交互增量

- 导入 `fixtures/cpu-folded.txt`，确认调用树展示每个节点相对当前范围的权重条和比例。
- 点击“展开”后调用树聚焦到选择的符号；无子节点的叶项不显示展开动作。浏览器验证 `main` 的权重为 600 / 父级 850（70.59%），展开后下一级比例按新的当前范围计算。

## CPU 采样函数时间分布增量

- 新增叶函数采样权重按时间段汇总图，展示权重最高的函数及“其他函数”，点击柱列按该时间段全部线程重新生成调用树。
- 图表明确说明数据来自已读取样本的事件周期权重，不表示 CPU 时间或包含成本。
- `node --test test/cpu-profile.test.js`：13 项通过，覆盖跨线程聚合、时间段分布、其他函数汇总及输入边界；`npm run check` 与 `git diff --check` 通过。
- 此次未连接设备；真实 perf.data 的图表显示和点击操作仍待桌面界面核验。

## 布局设计稿叠加增量

- 在已连接的 rk3399-all 设备采集 79 个 UIAutomator 节点和当前屏幕截图。
- 通过页面导入本地 PNG，确认叠加层出现；透明度控件设为 70% 后，图片 computed opacity 为 `0.7`；移除后叠加图片节点为 0。
- 缩放设为 125%、水平位置 12%、垂直位置 -8% 后，浏览器样式矩阵为 `matrix(1.25, 0, 0, 1.25, 28.8, -34.1325)`；复位后恢复 `matrix(1, 0, 0, 1, 0, 0)`。
- PNG/JPEG/WebP 支持；单图上限 24 MiB、5,000 万像素。叠加层按原始比例适配，可手动调透明度、缩放、水平和垂直位置；参考图与调整值不写入布局档案。

## 布局可访问性候选高亮

- 同一 rk3399-all 界面采集到 79 个 UIAutomator 节点；打开高亮后，56 个包含文本、描述或交互属性的节点在树和截图中标记，边界覆盖与所选节点同时显示。
- 这只是 UIAutomator 可访问性回退，不是 Compose Inspector：不会恢复合并/未合并的 Compose Semantics 树，也没有重组计数。

## 本机完整 Perfetto UI 增量

- `npm test`：185 项，170 通过、0 失败、15 项因未配置外部官方样本而跳过；新增静态资源服务、WASM MIME、本机 UI 可用状态、令牌保护的当前追踪读取测试。
- `npm run check` 与 `git diff --check`：通过。
- 浏览器导入 `fixtures/trace-sample.json` 后打开自托管 Perfetto v59.1，确认 Process 101 / main thread 及时间线内容显示；修改握手时序后控制台无错误。
- 官方 UI 压缩包固定 SHA-256：`df4433f5d8d98d2c490249870944c819ff85206f61e55e5983bbcc2338c83904`。测试确认 UI 资源通过本机 HTTP 提供，追踪内容仅从本机受令牌保护的接口送入同源 iframe。
- 当前 rk3399-all / Android 7.1.2 / API 25 不含 `perfetto`，所以此处验证导入与分析，不代表该设备已验证 Perfetto 录制。

## Perfetto 内存分配剖析增量

- 完整 `npm test`：184 项，169 通过、0 失败、15 项因未配置外部官方样本而跳过；覆盖 heapprofd API 门控与配置、清理、汇总解析，以及 Trace Processor 在普通追踪上返回空采样。
- `npm run check`：通过。`git diff --check`：通过。
- 真机页面：已连接的 rk3399 all / Android 7.1.2 / API 25 显示 Native 模式同时因低于 API 29、没有 Perfetto 而禁用；切换到 ART 模式显示需要 API 31+ 并禁用。未尝试运行设备采样。
- **真实 Native / ART heapprofd 采集尚未验证**：当前设备版本过旧且没有 Perfetto。支持设备上的系统 debuggable/profileable 条件、权限、结果样本质量仍待实机验证。

## 设备全功能回归（2026-11-03）

- 对 `X3315A41621110053`（rk3399-all、Android 7.1.2 / API 25、arm64-v8a）运行 `npm run test:device -- --serial X3315A41621110053 --package com.xmotion.sui.debug --allow-app-control`：23 项通过、2 项因设备能力不支持、0 项失败。报告位于 `/tmp/apw-device-smoke-continuation-20261103/report.json`。
- 设备发现、目标启动、battery snapshot、编译状态读取、1,092 个 CPU 事件枚举、实时监控、gfxinfo 导入、112 节点布局树与 291,868 字节截图、HPROF 分析与 Shark 2.14、冷/温/热启动、HAR 脱敏、Benchmark 比较、记录保存和 perf.data 归档完整性均通过。简单启动均有 `TotalTime`，但设备未返回 LaunchState；帧读取仅 2 帧，不能据此评价目标应用的稳定帧表现。
- simpleperf 生成 26,336 字节有效 `PERFILE2`，但短采样窗口未读到目标应用可解析调用栈；设备没有 `perfetto`，采集按 unsupported 正确返回。该结论保留为能力边界，不表示解析失败或 Perfetto 支持。
- 此次 smoke 在 `--allow-app-control` 下启动目标应用、重置 gfxinfo 计数并采集 HPROF；没有清除应用数据或卸载目标应用。设备临时文件与采集锁检查通过。

## 布局、电池与真机 HPROF 增量

- 完整 `npm test`：181 项，166 通过、0 失败、15 项因未配置外部官方样本而跳过。
- `npm run check` 和 `git diff --check`：通过。
- 布局历史页新增全量相邻版本摘要及差异载入；摘要接口只传递 XML，不传截图。新增的计数纯函数和轻量历史接口测试通过。差异精度和 UIAutomator 覆盖范围与下方限制相同。
- 电池报告支持 JSON 导出和原始 Battery Historian checkin 导出；设备原始导出会重新读取当前 checkin。设备命令封装与文本下载接口测试通过。
- 电池页现已说明导入的 checkin 会按原文导出，而设备端导出会重新读取当前统计窗口，可能与当前选中快照时间不同；中英文页面文案检查已覆盖这条说明。
- 电池页新增可停止的重复采样时间线与样本序列归档；新增 2–50 样本记录校验。

## API 25 电池重复采样界面验证

- 设备：rk3399-all，Android 7.1.2 / API 25，包名 `com.will.calendar.demo`。
- 桌面 WebView 在真机上采集 2 个 batterystats 样本，间隔约 1.1 秒；设备报告电量等级 100%、UID 估计 0.340 mAh，网络计数未提供。
- 保存后从本机档案重新载入，界面仍显示 2 个样本；导出的 JSON 包含 2 个样本，最后样本时间戳与结束快照一致。
- 这是单设备的 UI/采集/保存/导出验证，不代表 Android 版本兼容矩阵或能耗测量准确性。

## API 25 真机 HPROF 采集与对象查询

- 设备：rk3399-all，Android 7.1.2 / API 25，包名 `com.will.calendar.demo`（包含 Compose UI）。
- 从“堆转储”页采集 HPROF，下载原始文件后自动载入分析；页面识别 15.4 MiB、JAVA PROFILE 1.0.3、196,210 条对象/数组记录、84,213 条 GC root 记录，并索引 2,983 类。
- 类列表识别 `androidx.compose.ui.node.LayoutNode`、Compose Runtime、`android.graphics.Bitmap` 和目标应用的 `CalendarDemoActivity`。
- 查询 `java.lang.String`：46,604 个实例；分页浏览后打开真实实例，显示字段（`count`、`hash`、`value`）及 `zh-CN` 字符串预览。
- 该对象的引用来源查询返回一条已索引引用边；候选根路径查询如实返回未找到路径，并提示引用图覆盖不完整。
- Bitmap 查询识别 98 个实例及 Java byte[] 字段；逐字节确认重复缓冲区扫描找到 9 组，读取 1.07 MiB。重复字符串扫描、`zh-CN` 搜索及 Activity 状态查询均返回结果；后者找到 2 个 `CalendarDemoActivity` 候选。
- 首次近似支配图计算被 20 万节点上限挡住；将索引节点计算上限调整为 25 万并在页面披露后，真机图成功计算：已索引 203,329、可达 167,842、引用边 545,545；排除已识别弱/软/虚引用后排除 1,511 条边。
- 这验证的是一份 API 25 堆文件的采集、解析和交互路径；不证明跨版本兼容、精确保留大小、完整引用语义或 Compose Inspector 能力。

## 自动回归

`npm test`（外观设置增量时）：**162 项通过、0 失败、15 项跳过**。跳过项需要通过环境变量指定外部 Android 官方 HPROF、Perfetto、Benchmark、Profile 或 simpleperf 样本；普通运行未配置这些样本。最新完整回归结果见上方。

`npm run check` 和外观设置验证通过。Electron 中切换到深色主题及 120% 缩放后退出，再启动时两个选项均恢复；验证后将偏好恢复为跟随系统和 100%。

## API 25 真机回归

设备：rk3399-all，Android 7.1.2 / API 25 / arm64-v8a。完整设备 smoke **15 项通过、0 项失败，Perfetto 1 项标为 unsupported**。

| 项目 | 结果 |
| --- | --- |
| 设备与应用发现 | 通过；94 个包，包含 `com.will.calendar.demo` |
| 实时监控 | 通过；3 个连续 PSS 样本约 50.76、50.91、50.90 MiB；后两次 CPU 差值约 2.32%、2.38% |
| gfxinfo 读取与文本导入 | 通过；读取 4 个有效帧，P95 404.22 ms，所选 16.67 ms 预算下 100% 超预算 |
| 布局和截图 | 通过；79 个节点、266343 字节 PNG，无采集警告 |
| Perfetto | 不支持；API 25 设备没有 `perfetto` 可执行文件，应用正确报告不支持 |
| gfxinfo 重置 | 通过；重置后立即复读 0 帧 |
| 冷启动 | 协议通过；两次 1008、1022 ms，设备未报告 LaunchState |
| 温启动 | 协议通过；两次 610、480 ms，设备未报告 LaunchState |
| 热启动 | 协议通过；两次 286、257 ms，设备未报告 LaunchState |
| HAR 与 Benchmark | 通过；HAR 2 条记录并移除敏感字段；合成基准变化 -15% 和 +5% |
| 记录持久化 | 通过；monitor、frames、layout、startup、network 5 种记录保存后读回一致 |
| 采集清理 | 通过；设备临时 XML 已移除、采集锁已释放 |

启动数值只证明该设备接受并完成启动命令，不证明冷/温/热请求实际对应系统判定的启动模式：设备没有返回 LaunchState。设备也不支持 Perfetto，因此此处没有验证真实 FrameTimeline、TTID/TTFD、trace 或线程关联。上表所述的设备 smoke 不含 CPU profiling、GPU、实时网络和设备能耗归因；HPROF 已在上面的单独增量验证中覆盖。

# Android Performance 0.1.1 历史测试记录

日期：2026-10-30（Asia/Shanghai）。范围：当前首版已实现的全部分析模块与桌面主流程。

## 结果

- 自动测试：**23 项通过，0 失败**。
- 最终真机回归：**15 项通过，1 项设备不支持**。
- 桌面交互与发布包检查：**21 项已验证**，详细列在下方。
- 最终签名 `.app` 已实际运行，自动使用内置官方 ADB，连接真实设备连续采集 47 个样本并保存。
- **Perfetto 实际录制无法在此设备验证**：Android 7.1.2 / API 25 没有 perfetto；错误响应和禁用录制按钮的行为已验证。

这不是所有 Android 版本或所有系统平台的兼容性认证。Windows、Linux、macOS Intel 尚未验证。尚未实现的 HPROF、simpleperf 火焰图、完整 Compose Inspector 等不在测试范围。

## 环境

| 项目 | 环境 |
| --- | --- |
| 主机与桌面包 | macOS / Apple Silicon arm64 / 0.1.1 |
| 桌面与打包 | Electron 45.1.0 / electron-builder 26.18.0 |
| ADB | Google Platform Tools 37.0.1-15733141 |
| 设备 | rk3399-all / Android 7.1.2 / API 25 / arm64-v8a |
| 目标包 | com.xmotion |
| 隔离方式 | 开发测试目录独立；最后验证正式输出的 .app 和原有档案 |

## 真机与数据流程逐项结果

| 功能 | 结果 | 证据 |
| --- | --- | --- |
| 设备发现与属性 | 通过 | rk3399-all，Android 7.1.2 / API 25 / arm64-v8a |
| 应用列表 | 通过 | 发现 94 个包，包含目标应用 |
| 持续监控：内存与电池 | 通过 | 3 个连续样本；PSS 126.15, 125.80, 125.78 MB；设备电池读数可用 |
| CPU 实时差值 | 通过 | 主进程 CPU 39.46%, 39.31%；/proc 差值，单核 100% |
| 帧历史读取 | 通过 | 18 帧，P95 550.98 ms；历史缓冲区，非控制实验 |
| gfxinfo 文本导入 | 通过 | 导入后 18 帧，来源保留为 import |
| 层级与截图 | 通过 | 56 节点，PNG 100121 bytes；真实尺寸 1080×1920 |
| Perfetto 录制 | **设备不支持** | 设备没有 perfetto 可执行程序；采集请求正确返回错误；按钮禁用并解释原因 |
| 帧统计重置 | 通过 | 立即复读剩余 0 帧 |
| 冷启动协议 | 通过 | 每种 2 次；TotalTime 529, 342 ms，平均 435.5 ms；设备未报告 LaunchState |
| 温启动协议 | 通过 | 每种 2 次；TotalTime 246, 176 ms，平均 211.0 ms；设备未报告 LaunchState |
| 热启动协议 | 通过 | 每种 2 次；TotalTime 142, 129 ms，平均 135.5 ms；设备未报告 LaunchState |
| HAR 分析与脱敏 | 通过 | 2 条合成请求，敏感字段不进入分析模型 |
| Benchmark 对比 | 通过 | 两份合成 Benchmark JSON，相同指标变化 -15%、+5% |
| 五类记录保存/读回 | 通过 | monitor / frames / startup / layout / network 全部保存并读回，payload 一致 |
| 临时文件和采集锁 | 通过 | 设备 XML 已清理，采集锁已释放 |

启动数字来自操作协议验证，未控制所有运行条件；设备未提供 LaunchState，不能独立确认实际启动类型。TotalTime 不等同于 TTFD。自选帧预算超时不等同于平台 Jank，也不用于计算 FPS。电池数字属于设备上报，未独立验证硬件传感器真实性。

## 桌面交互检查

1. HAR 导入：2 请求、1 失败、平均 474 ms。
2. HAR 筛选、详情与敏感字段清理。
3. Benchmark 原生文件导入与两指标对比 -15%、+5%。
4. 错误 JSON 导入：显示错误且保留已有结果。
5. 真机 gfxinfo 文本导入：42 帧，来源为离线导入。
6. 120 Hz 帧预算切换与统计重算。
7. 真实布局采集、截图与节点属性联动。
8. 布局记录：原生保存 JSON，含截图与完整 XML。
9. 导出 JSON 再导入本机档案成功。
10. 布局记录回放：56 节点与截图恢复。
11. 原生 XML 导入：56 节点、无截图边界模式。
12. Perfetto 不支持：按钮禁用并说明原因。
13. 重启持久化：4 份记录恢复；旧布局记录按真实 1080×1920 比例回放并校正边框。
14. 布局画布点击可切换节点选中。
15. 桌面冷启动按钮→真实设备→每次耗时表成功。
16. 真实 CPU 连续采样、退出提醒、取消退出后继续保存成功。
17. 官方 ADB 副本：原生选择、版本校验、设置持久化。
18. 演示模式进入/退出与真实设备恢复。
19. 原生菜单快捷键 ⌘+1…8 全部导航正确。
20. 签名发布包 0.1.1 正常启动，自动使用内置官方 ADB，旧档案保留。
21. 最终签名 .app 使用内置 ADB 连续采集真实 CPU/内存，并保存到原有应用档案。

## 测试发现与修复

### CPU 缓存窗口不更新

该设备 cpuinfo 长期返回数分钟前的窗口，没有目标应用记录。现优先使用 `/proc/stat` 和 `/proc/<pid>/stat` 的相邻计数器差值；首个样本建立基线，PID/starttime 或在线 CPU 数改变时重新建立基线，guest 计数不重复累加。权限不足时回退 cpuinfo，超过 30 秒未更新则保留不可用。界面显示实际数据来源和统计范围。

### 布局边框偏移

原先固定预览比例，导致实际 1080×1920 截图中的标题边框落在其他位置。现保留 PNG 真实尺寸，兼容旧记录的图片自然尺寸；画布命中计算排除外框宽度。已验证标题边框对齐、画布选择和 56 节点回放。修复截图见 `data/ui-test/layout-fixed.jpg`。

### 原 SDK 路径的 ADB 被 macOS 终止

路径配置测试中，原 SDK 的 adb 被系统以 `SIGKILL (Code Signature Invalid)` / `Taskgated Invalid Signature` 终止；独立终端调用和 codesign 校验同样失败。从 Google 官方下载的独立副本验证有效、正常连接设备。**两份 adb 文件 SHA-256 相同**，因此不把现象归因于已证实的内容损坏；没有修改原 SDK，也没有关闭任何系统安全设置。

新 macOS 包携带可用的独立 ADB 与原 NOTICE；源代码也可执行 `npm run prepare:adb` 准备资源。SIGKILL 错误现会提示检查签名或更换官方程序。来源及校验和见 `tools/README.md`。

### 打包签名不完整

旧构建关闭签名，深度验证显示资源签名不完整。现完整执行本地 ad-hoc 签名，主程序、辅助进程、框架和内置 adb 验证通过；DMG 校验通过。**本地签名不是 Apple Developer 证书签名，也没有 Apple 公证。**

## 自动测试内容

覆盖 ADB 参数引用和目标校验、采集互斥、缺失证据、实时 CPU 基线/进程重启/权限回退/过期窗口、截图尺寸与损坏 PNG 降级、设备和内存/帧/电池/启动解析、HAR 脱敏、Benchmark 匹配、记录校验、Host/Origin/token 限制、持久化及帧文本导入。

## 复现

```sh
npm run check
npm test

# 会重置帧统计，并按协议停止/启动目标应用
npm run test:device -- \
  --serial YOUR_SERIAL --package YOUR_PACKAGE \
  --allow-app-control --out data/my-device-test
```

真机脚本必须显式指定设备和包名；只有带 `--allow-app-control` 才执行启动与重置。普通 `npm test` 不运行真机脚本。

## 原始证据与交付物

- 最终真机报告：`data/full-test-release-0.1.1/report.json`。
- 原始样本、gfxinfo、XML、PNG、三种启动输出及五类记录：同一目录。
- 桌面逐项结果与原生导出 JSON：`data/ui-test/`。
- 最新实机运行截图：`desktop-preview.jpg`。
- 桌面应用：`dist/v0.1.1/mac-arm64/Android Performance.app`。
- 安装包：`dist/v0.1.1/Android Performance-0.1.1-arm64.dmg`。

应用通过 `codesign --verify --deep --strict`，内置 adb 已实际执行版本查询并用于桌面采集，DMG 通过 `hdiutil verify`。Perfetto 成功录制仍需支持该工具的设备验证。

## 最近设备冒烟测试（2026-11-02）

- API 25 / rk3399-all / `com.will.calendar.demo`：设备和应用发现、三次实时监视、连续进程 CPU、gfxinfo 读取与文本导入、79 节点布局和 266,343 字节截图、HAR 脱敏、Benchmark 对比、4 类记录持久化读回、远端 XML 清理及采集锁释放均通过。
- Perfetto 录制按设备能力正确返回 unsupported（该 Android 7.1.2 设备无 `perfetto`）；设备冒烟合计 11 项通过、1 项不支持、1 项因未允许应用控制而跳过。报告写入 `/private/tmp/apw-device-smoke/report.json`，未控制目标应用启动或重置帧统计。


## GPU 追踪诊断（2026-11-03）

- 新增本机 Trace Processor 查询：GPU RenderStage、GPU 频率原始值、按进程 GPU 内存；每类数据独立报告是否可用与结果截断状态，不从空轨道推断为零。GPU RenderStage 可与同一追踪的 FrameTimeline 按 UPID 和精确纳秒区间展示重叠项。
- 以 Trace Processor v59.1 在无 GPU 数据的合成追踪中执行三类查询，确认标准查询表存在并返回空结果；另以合成 CSV 验证文本解码、进程信息、时间精度和缺失轨道处理；时间关联单测覆盖进程隔离、大纳秒时间戳和区间边界。
- 完整测试：275 项，259 通过、0 失败、16 个可选外部样本测试因未配置而跳过；`npm run check` 通过。
- 未验证真实设备驱动轨道、GPU RenderStage 与 FrameTimeline 的跨轨道关联；队列事件可能并行，累计持续时间不等于墙钟耗时。

## BatteryStats UID mAh 区间差

- 两次快照具备相同设备、包名、UID 和 since-charged 窗口时，如果 `pwi,uid` 两端估计存在且非递减，比较结果提供系统 UID mAh 估计值的区间差；缺失不按零处理，下降时返回不可用并记录重置提示。
- 界面显示当前累计值、基线值和区间估计，并说明系统模型估算可能包含共享 UID 应用，不等同于实测功耗或独立应用耗电归因。
- 回归覆盖有效小数差、估计值下降、缺少一端读数和英文说明翻译。完整 `npm test`：282 项，266 通过、0 失败、16 项因未配置可选官方样本而跳过；`npm run check` 与 `git diff --check` 通过。

## 无插桩 UID 网络流量比较

- 网络页新增独立于 OkHttp 请求 Agent 的系统流量卡片，可分别采集基线与结束快照，显示移动网络和 Wi-Fi 的 UID 字节变化；复用 BatteryStats 已有按 UID 查询及严格会话窗口对比接口。
- 共享 UID 可能包含其他应用；缺失或重置的字段不按零处理。该视图只有系统累计字节计数，不呈现请求、域名、内容或时间线；UI 和英文说明测试覆盖了这一边界。
- 新页面尚未在真机验证；当前环境没有已连接设备。完整测试为 282 项，266 通过、0 失败、16 项可选官方样本跳过；macOS arm64 `.app` 已重建、签名验证通过，`app.asar` 包含新界面。


## Compose State 变更观察关联

- 应用内 debug Agent 通过 Compose `Snapshot.registerApplyObserver` 接收已应用 State 对象集合；仅以对象身份与当前 Composition 的 State-scope 读取关联求交集，不读取值。每次 Agent 采集之间的结果写入 Composition group XML 属性，并在布局树及 Composable 调用树显示。首个采集建立观察基线。
- 缓冲最多暂存 5,000 个对象并使用弱引用；Activity 停止时尝试注销 observer。观察器不可用、缺字段或溢出时显示不可用 / 警告，不伪造为零。该交集不证明 Scope 随后重组、绘制或造成掉帧。
- Java Agent 以 `javac --release 8` 对 Android 31 与 36 SDK 编译通过；布局 Agent 端到端合成测试覆盖变更关联、首采基线、observer 不可用和缓冲溢出；英文文案检查通过。当前没有连接设备，未验证 Compose Runtime 实际 observer 回调或真机行为。
- 完整 `npm test`：282 项，266 通过、0 失败、16 项因未配置可选官方样本而跳过；`npm run check` 与 `git diff --check` 通过。

## 电池设备遥测展示

- 电池页的当前快照和重复采样时间线新增设备电量、温度、电压与充电状态；UID 网络和系统能耗估计继续单独呈现，并明确说明遥测属于设备级，不用于应用耗电归因。
- BatteryStats 解析测试验证了 32 °C、4,200 mV 和充电中状态的输入映射；English 页面文案测试与脚本语法检查通过。
- 当前无连接设备，新增界面尚未在真机逐项核对。

## Perfetto 电池与硬件功耗轨道

- 系统追踪录制新增显式勾选项；Android 10+ 时写入 `android.power` 数据源，采样电池电量 / 电荷 / 电流 / 电压并请求 `collect_power_rails`。FrameTimeline 模式可同时启用。默认录制仍不启用这些额外计数器。
- 追踪分析分别查询设备电池计数和硬件功耗轨道：电池计数显示电量、电荷（µAh）、瞬时 / 平均电流（µA）、电压（µV）、能量（µWh）及功率（mW）；功耗轨道显示设备报告的轨道、子系统、能量差（µJ）、平均功率（mW）和测量间隔。两类数据源分别显示可用状态，并说明它们属于整机 / 子系统，不归因到单应用。
- Android 29 采集配置、Android 28 门控、资源清理、数据解码 / 非法时间、单一数据源缺失处理通过测试；随包 Trace Processor v59.1 对无功耗和电池计数样本执行真实查询并分别返回空记录。
- 当前没有已连接设备，也没有具备 ODPM 轨道的本机样本；尚未真机确认设备支持情况、轨道分辨率或数据正确性。
- 扩展后全量测试：285 项，269 通过、0 失败、16 项可选官方样本跳过；`npm run check` 和 `git diff --check` 通过。


## Benchmark 独立实验组区间（2026-11-03）

- 基准对比页新增多报告组比较：分别选择至少 5 份、最多 100 份已保存运行；每份报告作为一个实验单位，报告内部迭代先聚合为指标中位数。重复指标会排除，不把单报告的多次 runs 展开成独立实验样本。
- 采用固定种子的 5,000 次独立百分位 Bootstrap 重抽样估算两组中位数相对变化的 95% 区间；样本不足、基线为零或有效报告不足时不显示区间。界面明确说明这是探索性估计，不是 p 值或因果证据，真实独立性需使用者核实。
- 新增回归覆盖确定性、最少样本、零基线、重复指标与参数边界；中英文标签和说明检查通过。`npm run check`、`git diff --check` 通过。完整 `npm test`：290 项，274 通过、0 失败、16 项因未配置可选官方样本而跳过。
- macOS arm64 `.app` 目录包重新构建成功，`codesign --verify --deep --strict` 通过，asar 包含更新后的界面与统计模块。未创建 DMG。
- 本轮 ADB 未发现设备，因此没有真机 Benchmark 实验数据；区间实现目前以合成数据测试。


## Benchmark 实验组报告导出（2026-11-03）

- 统计详情新增逐指标 JSON 导出，包含两组逐报告中位数、保存记录身份与时间、执行上下文、差异/缺失警告、95% Bootstrap 区间及解释限制，便于归档和复核。
- 新增测试覆盖报告格式、环境差异、样本身份和组规模边界；对应英文标签检查通过。`npm run check`、`git diff --check` 均通过。完整 `npm test`：291 项，275 通过、0 失败、16 项因未配置可选官方样本而跳过。
- macOS arm64 `.app` 目录包重建成功，`codesign --verify --deep --strict` 通过。本机 ADB 成功启动，但本轮设备列表为空，无法进行真机 Benchmark 报告验证。


## 原生安装包格式扩展（2026-11-03）

- Electron Builder CI 矩阵新增 macOS arm64/x64 PKG、Windows x64 MSI、Linux x64 DEB 与 RPM，并与现有 DMG、NSIS EXE、AppImage 同次上传。新增各格式打包脚本；配置回归检查脚本目标和 artifact 通配路径。
- 本机 Apple Silicon 成功执行 `npm run package:mac:installers`，生成 230 MiB arm64 PKG 和 DMG；`pkgutil --check-signature` 显示 PKG 无签名，`hdiutil verify` 验证 DMG checksum 有效。未运行 PKG 安装器；当前没有 Apple Developer Installer 证书。
- 第一轮 Linux 构建因 RPM 缺少 `author.email` 失败；添加公开 GitHub noreply 作者元数据后重跑成功。GitHub Actions 运行 [41503926815](https://github.com/willpyshan13/AndroidPerformance/actions/runs/41503926815) 的测试和四个原生平台打包 job 全部成功，上传 macOS arm64/x64、Windows x64、Linux x64 artifacts，包含新增 PKG/MSI/DEB/RPM 格式。Linux arm64 仍因未准备原生 AAPT2 而未加入。完整自动测试：291 项，275 通过、0 失败、16 个可选样本跳过。


## 首页英文状态与 Linux ARM64 AAPT2 核验（2026-11-03）

- 首页设备能力状态不在原先的英文文本节点白名单内，会在英文模式继续显示中文；改为显式走本地化，并新增首页仪表盘文案回归，覆盖状态、设备证据、统计指标和模块入口。
- 检查 Google 官方 AAPT2 文档并下载 Google Maven 最新 Linux 包样本，解包后的 ELF 架构为 x86-64。当前没有已验证的 Linux ARM64 AAPT2 方案；因此不把缺少 AAPT2 的 Linux ARM64 安装包标记为功能齐全，以免破坏 APK 分析功能。
- 完整 `npm test`：292 项，276 通过、0 失败、16 项因未配置可选官方样本跳过；`npm run check` 和 `git diff --check` 通过。


## Electron renderer startup smoke（2026-11-03）

- 原生 Windows x64 runner 构建 NSIS/MSI 后，静默安装 MSI 到临时目录，再从安装路径启动应用。Java runtime 首次解包、本机 HTTP 服务、主页面、四个 JavaScript 模块、渲染器导航与主视图均通过；完成后 MSI 卸载成功。GitHub Actions run [41517484533](https://github.com/willpyshan13/AndroidPerformance/actions/runs/41517484533) 的 Windows package、MSI install smoke 和 artifact upload steps 全部成功。NSIS 安装器尚未执行安装路径 smoke。
- smoke 暴露本机服务未开放 `/i18n.js`：入口脚本因此没有渲染导航。已补静态资源路由，并新增 HTTP 回归测试检查入口的模块依赖；当前全量测试 293 项，277 通过、0 失败、16 个可选官方样本测试跳过，`npm run check` 通过。
- 获批 host 桌面上的开发模式 Electron smoke 返回 16 个导航项，且主视图已渲染。沙盒内 Electron 的 SIGABRT 仍说明该受限运行环境不适用于可见桌面启动测试。


## Linux arm64 桌面包与 APK 工具（2026-11-03）

- GitHub Actions 增加 Ubuntu 24.04 arm64 原生打包 job。准备脚本将 Ubuntu 的 ADB、AAPT2 及非 glibc 运行库、copyright 文件加入应用资源；DEB 元数据声明 Ubuntu 24.04 的 glibc 最低版本。
- 加入真实 AAPT2 smoke：构造最小 APK 并调用现有分析器核对包名、应用标签、minSdk 与清单 ZIP 项。本机使用 Android SDK AAPT2 运行通过；解析结果为 `dev.apw.smoke`、minSdk 21。
- 加入提取 DEB 后的包内 smoke：检查 ADB/AAPT2 与许可证文件，从提取路径启动 ADB，并用包内 AAPT2 重新执行 APK 分析。该脚本须由原生 Linux arm64 CI 运行；当前执行环境无法访问 GitHub Actions 日志，故不能声称 arm64 安装包已验证。
- 本轮 `npm test`：328 项，312 通过、0 失败、16 个可选官方样本测试跳过；`npm run check` 和 `git diff --check` 通过。当前 ADB 主机权限下 `adb devices -l` 可运行，但没有列出设备，因此真机专属检查待设备重新连接。

## 跨平台安装 smoke 复核（2026-11-03）

- GitHub Actions [运行 41541268775](https://github.com/willpyshan13/AndroidPerformance/actions/runs/41541268775) 的 tests、macOS arm64/x64、Linux x64 jobs 成功；Linux arm64 在“Analyze a generated APK with the staged AAPT2”失败，DEB 构建和包内验证未执行。
- 同次运行 Windows job 在“Install Windows MSI and NSIS packages and verify desktop startup”失败。REST job 状态可读取失败步骤名称，但下载 Actions 日志的公开接口返回 `Must have admin rights to Repository`；失败原因尚未确认。需要从有权限的 GitHub 会话取得该步骤日志后修复，不能将两项失败归因于具体代码问题。

## CPU sample interaction indexing（2026-11-03）

- CPU timeline now builds per-bin and chronological sample indexes when loading up to 50,000 samples. Bin selection uses only that bin's candidates; arbitrary time-range selection uses binary search over timestamps and processes only samples inside the selected range.
- Added regression coverage for unsorted timestamps, duplicate and inclusive boundaries, thread filtering, and a guard that fails if bin/range interaction scans the full sample list. The original `timeNs` string is retained for monotonic-clock FrameTimeline correlation.
- Reverse-call-tree traversal now keeps parent pointers instead of copying an ancestor array for every visited node; a deep, highly fragmented tree fixture verifies caller weights and match totals.
- This verifies query behavior and index use, not end-to-end browser rendering performance on large or highly fragmented real profiles; that benchmark remains open.
- CPU-specific tests: 16 passed. Full suite: 295 tests, 279 passed, 0 failed, 16 optional official-sample tests skipped; `npm run check` and `git diff --check` passed.

## Packaged macOS arm64 app startup smoke（2026-11-03）

- Added a native macOS CI smoke for both arm64 and x64 package jobs. It locates the packaged `.app`, launches its bundled executable with an isolated profile, waits for renderer navigation and the main view, checks the local app modules and verifies bundled Java, Trace Processor, and Perfetto UI resources.
- Rebuilt the arm64 `.app` from current sources and ran `node scripts/mac-desktop-smoke.js` on the host. The app started, served its main page and all four JavaScript modules, reported a ready renderer, and exposed all three checked native resources. The first attempt used an older pre-smoke `.app` and timed out; it was discarded after confirming its `app.asar` lacked the current smoke hook.
- Local packaged-app smoke passed. The new Windows NSIS and macOS package smoke steps still require their latest GitHub Actions run to confirm native CI behavior.

## Localized native desktop menus（2026-11-03）

- The native Electron menu now reads the persisted `zh-CN` / `en-US` preference at startup and is rebuilt immediately when the language setting changes. Navigation actions, accelerators, platform roles, records-folder access, ADB selection, settings, and Perfetto handoff are retained.
- Pure menu tests verify Chinese and English labels, absence of untranslated Chinese in English menu labels, navigation routes, and macOS application/close roles. The latest rebuilt arm64 `.app` includes the menu module and passed the packaged renderer/resource smoke.
- Full suite: 298 tests, 282 passed, 0 failed, 16 optional official-sample tests skipped; `npm run check` and `git diff --check` passed.

## Localized native desktop dialogs（2026-11-03）

- ADB/source/AGI file pickers, capture-close confirmation, download messages, startup and common ADB/AGI errors now use the persisted Chinese or English desktop language.
- Added localization and package inclusion regression checks. Targeted desktop tests: 5 passed; full suite pending.
- Full suite after dialog localization: 299 tests, 283 passed, 0 failed, 16 optional official-sample tests skipped; syntax and whitespace checks passed.
- Rebuilt the macOS arm64 `.app`; packaged-app smoke passed with the renderer, Java runtime, Trace Processor, and Perfetto UI ready. The archive contains `desktop/main.js`, `desktop/menu.js`, and `desktop/locale.js`.

## Packaged desktop locale smoke（2026-11-03）

- Desktop smoke now seeds an `en-US` preference before launch and reads the top-level Electron menu labels from the running app. It requires English `File` and `Analyze` entries and rejects any Chinese menu label on macOS, MSI, and NSIS paths.
- Rebuilt and launched the macOS arm64 `.app`; its persisted English menu check passed alongside the renderer and bundled Java, Trace Processor, and Perfetto UI checks. Windows installer behavior awaits the next native GitHub Actions run.
- `npm test`: 299 tests, 283 passed, 0 failed, 16 optional official-sample tests skipped. `npm run check` and `git diff --check` passed.

## Home quick actions and clean-profile startup（2026-11-03）

- Added homepage cards for CPU, heap, battery, GPU, Benchmark, and source workspaces so all 13 analysis modules have direct home entry points. Added English descriptions for the new cards.
- The packaged-app smoke now waits for the actual overview cards, verifies every expected route, and captures Electron 45 renderer console errors. This caught a clean-profile crash: the first `last()` call read `state.samples.at(-1)` before `samples` existed. Initializing the collection fixes a blank home on first launch without prior device data.
- Rebuilt and launched the macOS arm64 `.app` with a clean profile and saved `en-US` preference. The smoke verified 16 navigation items, all 13 quick-action routes, English native menu labels, and bundled Java, Trace Processor, and Perfetto UI. Passed.
- Full suite: 300 tests, 284 passed, 0 failed, 16 optional official-sample tests skipped; `npm run check` and `git diff --check` passed.
- The packaged-app smoke now cycles through every navigation route, requiring the active route, a page heading, visible content, and a content change after each transition. A clean macOS arm64 packaged run passed all 16 pages with no renderer console errors.

## Demo-data route smoke and process cleanup（2026-11-03）

- Packaged macOS and Windows smoke now toggle into built-in demo mode and repeat the 16-page route sweep, in addition to the clean no-device/no-data sweep. Both sweeps require each route to activate, render a heading and content, and update content after transitions; renderer console errors fail the run.
- macOS arm64 package passed both sweeps. Added SIGKILL escalation after the graceful shutdown timeout so the desktop smoke runner and Electron child cannot remain hanging after reporting success.
- Full suite: 300 tests, 284 passed, 0 failed, 16 optional official-sample tests skipped; syntax and whitespace checks passed.

## 首页最近分析产物（2026-11-03）

- 主页最近列表统一汇总采集记录、CPU 采样档案、系统追踪档案和 GPU 产物，按时间倒序展示最多 8 项。
- 采集记录进入现有详情；CPU/Trace 点击后进入相应分析页并载入本地档案；GPU 点击后定位到对应索引项。档案已删除或载入失败会显示错误提示。
- 增加回归断言核对数据集合、排序/截断及交互目标；打包 smoke 检查首页区块与无数据状态，并扫过全部 16 个路由的空状态和演示状态。
- 全量套件：301 项，285 通过、0 失败、16 项因未配置可选官方样本而跳过；`npm run check`、相关的 30 项本地化 / 包配置测试和 `git diff --check` 通过。
- 重建 macOS arm64 `.app`；打包启动 smoke 验证首页最近产物空状态、全部 16 个路由、内置演示状态及 Java、Trace Processor、Perfetto UI 资源，通过且无渲染器错误。

## CPU 采样调用栈时间图与大数据投影（2026-11-03）

- 新增按单调时间绘制的逐样本调用栈 Canvas 图，颜色区分高频帧；点击样本展示线程、相对时间、事件周期权重和栈帧，随后可将该样本的线程 / 时间桶筛选应用到调用树。每次最多绘制 2,000 个等距抽样点，每个样本最多 32 层；仍保持独立的叶函数时间分布图。
- 内置演示模式增加确定性多线程 CPU 样例，并明确标注为非设备数据；模式切换清除先前设备 CPU 证据，避免把旧采样带入演示状态。桌面 smoke 在演示模式实际绘制 Canvas、点开样本详情并应用筛选。
- 新增 `npm run benchmark:cpu-visualization`：50,000 样本、512 种调用栈、32 个线程合成输入，索引 39.81 ms、2,000 点投影 8.41 ms、叶函数汇总 4.79 ms、单时间桶调用树 9.40 ms、58,150 个 Canvas 绘制命令生成 3.26 ms，Node heap 47.8 MiB。此结果测量本机合成数据和 Canvas 命令生成，不代表 Electron/GPU 栅格端到端时间或真实设备表现。
- 回归覆盖有序样本选择、线程筛选、深栈截断、单点边界、50,000 样本上限和 Canvas 命令。全量套件：303 项，287 通过、0 失败、16 项可选官方样本跳过；`npm run check` 与 `git diff --check` 通过。重建 macOS arm64 `.app` 后，打包 smoke 验证演示 Canvas 实际绘制、点击样本打开详情、应用线程 / 时间筛选，以及全部 16 个路由的空数据和演示数据状态；通过且无渲染器错误。

## CPU 采集器样本质量诊断（2026-11-03）

- 设备采集现在保留 simpleperf record 输出中的显式记录样本、切除样本、丢失样本、内核 / 用户态丢失及截断调用栈计数，并在 CPU 页显示。未在原始输出中提供的值显示为“未提供”，不会当成 0，也不从解析后的时间线推算；独立导入 perf.data 时这些采集诊断不可恢复。
- ADB 捕获、计数解析、下载响应 metadata 和 UI 展示有回归覆盖；全量套件：304 项，288 通过、0 失败、16 项可选官方样本跳过。`npm run check`、`git diff --check` 通过。macOS arm64 `.app` 打包成功，但本轮 packaged smoke 在 Electron 初始化期间被 Cocoa LaunchServices SIGABRT 终止，未能验证页面。当前没有可用的 ADB 设备，故真实设备输出格式尚待核对。

## CPU on/off-CPU 调度采样（2026-11-03）

- 新增设备 simpleperf `trace-offcpu` 能力探测和可选采集。该模式只允许一个 `cpu-clock` 或 `task-clock` 事件；不支持时服务端拒绝启动。转换器在有 trace-offcpu 元数据的文件中使用 `on-off-cpu` 报告模式，将 `cpu-clock` 与 `sched:sched_switch` 样本拆开，原有事件选择、调用树和时间线可分析 off-CPU 等待栈。界面说明等待区间由相邻调度记录估算，可能受丢失记录影响。
- 用假 ReportLib 生成器验证两类样本独立、off-CPU 7,000,000 ns 权重在 timeline 和 folded 输出中保留；覆盖 ADB feature 检查、无支持拒绝、单事件约束及 API 参数传递。全量套件：306 项，290 通过、0 失败、16 项可选官方样本跳过；`npm run check` 和 `git diff --check` 通过。重建的 macOS arm64 包含更新的两份 simpleperf 转换器；packaged smoke 仍在 Electron 启动早期被 Cocoa LaunchServices SIGABRT 终止。ADB 设备列表为空，尚未核对设备内核权限和实际调度轨道。

## ART method trace 导入（2026-11-03）

- CPU 页面新增独立 ART `.trace/.dmtrace` 导入入口；解析放在 module Worker 中运行，最多接受 256 MiB 文件，并限制事件、方法、线程及保留时间区间数量。支持标准 v1/v2/v3 与解析器覆盖的 v2/v3 streaming 格式，呈现线程调用时间线、调用次数、inclusive/self 时间及不完整调用提示；与 simpleperf 的 perf.data 采样证据分开展示。
- 新增 `am profile` 设备采集：目标应用须已运行且 debuggable/profileable，可设置 3–30 秒和 100 µs–1 s 抽样间隔；采集中可取消，取消后先停止设备跟踪并清理远端 / 本地临时文件。成功结果校验 SLOW magic 与大小，再自动载入分析。
- 回归覆盖嵌套调用、自身时间、v1/v2 记录宽度、unroll、streaming 内联元数据、尾部 clock summary（含 thread-cpu）、损坏头部和事件上限；模拟 ADB 与 HTTP API 测试覆盖启停命令、取消、采样设置、产物返回及清理。全量套件：318 项，302 通过、0 失败、16 项可选官方样本跳过；`npm run check` 和 `git diff --check` 通过。没有连接的 ADB 设备，尚未用真机导出文件核对格式兼容性和设备权限。新增 CPU JSON 报告导出，区分 simpleperf 权重与 ART 方法计时，报告限制 Top 函数 / 方法 1,000 行、线程 1,000 个及 ART 调用区间 2,000 条。报告结构与截断边界通过回归。历史 macOS packaged smoke 的 Electron 启动 SIGABRT 未在本功能中复测。

## simpleperf 采集取消（2026-11-03）

- CPU 采集中加入取消入口。采集任务通过唯一 PID 文件定位设备端 simpleperf，仅向本次进程发送 SIGINT；原采集请求保持等待，直到 ADB shell 退出后再清理远端二进制、perf.data、PID 文件及本机临时文件，最后释放设备锁。启动准备阶段收到取消会在开始记录前退出。
- ADB 回归验证取消信号到达指定 PID 命令、记录请求结束、临时文件清理和采集锁释放；HTTP 回归验证取消 ID 仅中止相应活动任务。定向 CPU / HTTP 测试 34 项通过；完整套件 320 项，304 通过、0 失败、16 项可选官方样本跳过。`npm run check` 和 `git diff --check` 通过。
- 当前没有连接的 ADB 设备，因此设备端 SIGINT 在不同 Android shell / simpleperf 版本上的行为仍待真机确认。

## CPU 动态库筛选（2026-11-03）

- simpleperf 时间线转换新增逐栈帧 DSO 名称，界面列出采样覆盖到的动态库，筛选后仅保留命中库的样本，并用这些样本中的对应库栈帧重建函数汇总、调用树、火焰图和时间视图；可见函数权重不会把其他库的调用帧混入所选库。
- 报告导出记录动态库筛选名。对于不包含 DSO 时间线的 folded stacks，界面不提供库筛选。说明中明确采样周期权重不是 CPU 时间，且过滤掉栈外调用者 / 被调用者会改变调用路径上下文。
- 合成 ReportLib DSO 转换、库筛选权重 / 函数汇总、空匹配、报告元数据与中英文 UI 接线回归通过。全量套件 323 项，307 通过、0 失败、16 项可选官方样本跳过；`npm run check` 和 `git diff --check` 通过。当前 ADB 设备列表为空，尚未在真实设备 perf.data 核对 DSO 路径形式。

## CPU 时间图图片导出（2026-11-03）

- CPU 调用栈时间图增加 PNG 导出，直接读取当前 Canvas，因此保留已经应用的动态库和线程筛选以及现有的绘制抽样边界；原始采样与 JSON 分析报告仍独立提供。
- 回归检查 PNG 导出按钮、Canvas 编码路径、命名和英文标签。全量套件 324 项，308 通过、0 失败、16 项可选官方样本跳过；`npm run check` 和 `git diff --check` 通过。重建 macOS arm64 `.app` 并启动实际 Electron renderer；smoke 触发 PNG 导出按钮、拦截保存动作并校验返回数据的 PNG 文件签名、类型和非零图像尺寸；全部空状态 / 演示状态 16 个路由及现有桌面资源检查通过。

## HPROF 类统计与快照对比 CSV（2026-11-03）

- 堆分析页新增 CSV 导出，当前视图中的搜索词和对象数变化筛选会作用于完整匹配结果，不受表格每页最多显示 1,000 行的限制。当前类统计和基线对比使用各自列；不兼容类匹配会标记为不可比。导出含 UTF-8 BOM、CSV 双引号转义和表格公式前缀防护，并明确字段 / 元素字节不包含对象头或对齐，不等于浅大小或保留大小。
- 两项 `heap-export` 单元回归覆盖 CSV 头、字节解释、逗号 / 引号转义、公式注入防护和不可比行。全量套件最近结果：327 项，311 通过、0 失败、16 项因未配置可选官方样本而跳过；`npm run check` 与 `git diff --check` 通过。
- 重建 macOS arm64 `.app` 并运行打包 smoke。首次 smoke 暴露新 ES module 未加入静态资源路由；加入路由后重建，renderer、16 个页面状态、Java、Trace Processor、Perfetto UI 及 CPU PNG 导出 smoke 均通过。CSV 序列化通过定向测试；打包 smoke 使用 145 字节合成 HPROF 走完文件输入、HTTP 分析、类名筛选和 CSV 下载，检查 MIME、UTF-8 BOM、命中类保留和未命中类排除。另从布局页导入合成 XML，验证规则 ID、严重级别、置信度和证据显示。以上 smoke 不替代真实设备 HPROF 或 UIAutomator 验证。

## 布局检查线索的结构化证据（2026-11-03）

- UIAutomator 可交互节点线索新增稳定规则 ID、warning/info 严重级别、high/medium 置信度、节点 ID 和证据字段。无标签仅在当前读取子树字段完整且确实为空时提示；小触控区域记录原始边界、密度、dp 尺寸和 48 dp 阈值，并标为中置信度；页面直接展示规则、严重级别、置信度和证据，中英文标签已接入。
- `test/layout-scope.test.js` 覆盖原有识别边界及结构化字段、rule ID、证据和置信度；定向测试 12 项通过。全量套件最近结果：327 项，311 通过、0 失败、16 项因未配置可选官方样本而跳过；`npm run check` 与 `git diff --check` 通过。重建 macOS arm64 `.app` 后打包 smoke 通过，renderer、16 个页面状态及桌面资源检查正常。当前 ADB 设备列表为空，无法用真机布局采集确认不同 Android / UIAutomator 实现的字段差异。

## CPU 时间图打包 renderer 大样本验证（2026-11-03）

- macOS arm64 打包 Electron renderer 载入 50,000 个合成样本，建立时间索引，等距投影 2,000 个样本，绘制 48,000 个栈帧并通过 `getImageData` 读取实际 Canvas 像素缓冲区。最终打包 smoke 实测约 46 ms：索引 29 ms、投影 1.4 ms、Canvas 命令 13.1 ms、像素读取 2.8 ms。前几轮测量约 46–50 ms；此为单机合成基准，不代表其他设备性能。
- 打包 smoke 同时保留 PNG 导出、空 / 演示状态导航、菜单和资源检查；当前真实设备大型 perf.data 端到端数据仍待验证。

## 英文界面字面文案覆盖（2026-11-03）

- 新增回归自动提取 `public/app.js` 中全部字面 `tr(...)` 键并检查英文译文无残留中文。本次覆盖 242 个含中文的字面键，0 个缺失；保留了代码、导入数据及其他用户内容不翻译的边界。
- `test/i18n.test.js` 33 项通过；全量套件最近结果：327 项，311 通过、0 失败、16 项可选官方样本跳过。动态设备字段、原始工具输出及用户导入内容不属于这项字面键检查。

## 英文动态页面打包烟测（2026-11-03）

- macOS arm64 打包 smoke 在英文配置下逐一访问空状态及演示数据的 16 个页面，扫描实际渲染的可见控件、说明、状态和动态数字。首次扫描发现未翻译字符串并据此补齐动态数量 / 时间格式、页面说明和状态文案；保留设备屏幕、布局树、属性值、代码和语言自称等用户内容。最终演示页面 0 条未翻译 UI 字符串。
- 修复节点选择后动态生成的属性操作按钮未及时本地化；加入动态数字及路径文本回归用例。
- macOS arm64 目录包重建和启动 smoke 通过，检查 16 页英文渲染、renderer 控制台、Java、Trace Processor、Perfetto UI、HPROF CSV 导出、结构化布局线索，以及 50,000 个 CPU 样本的打包 renderer Canvas 栅格读取（本轮约 47 ms）。
- 完整测试：328 项，312 通过、0 失败、16 项可选官方样本跳过；`npm run check` 与 `git diff --check` 通过。测试需在可绑定 127.0.0.1 的环境运行。

## API 25 受控 CPU 采样及完整设备 smoke（2026-11-03）

- 使用临时 debuggable Activity 在独立工作线程持续计算，确认 API 25 的 simpleperf 采集和分析可在有负载进程上端到端工作。最终 3 秒采集生成 130,281 字节 `PERFILE2`，记录 1,193 个 `cpu-clock:u` 样本，解析为 12 条栈 / 21 个符号；时间线标记 `CLOCK_MONOTONIC`，采样档案保存后 SHA-256 校验和逐字节回读均通过。该夹具只用于证明采样链路，不代表真实应用性能。
- `scripts/device-smoke.js` 现分别验证普通分析记录与 CPU 原始采样档案：CPU 摘要不再误传给仅接受 monitor / frames / startup / layout / network 等类型的会话接口；perf.data 使用产品支持的 `.trace` 档案接口，执行上传、列表读取、完整性校验和字节相等回读。
- 完整受控 smoke：24 项通过、0 项失败、1 项 unsupported。除上述 CPU 外，还通过 Activity 启动、进程监控、1 条 gfxinfo 帧、布局截图、约 12.4 MB HPROF（约 141,744 个对象，Shark 2.14 成功）、冷/温/热启动及记录持久化。API 25 设备没有 `perfetto`，该项按能力标为 unsupported；设备不返回 LaunchState，启动模式不据 TotalTime 推断。测试结束后已卸载临时 APK 并删除采样和报告文件。
- 全量自动化回归：331 项，315 通过、0 失败、16 项可选官方样本跳过；`npm run check` 与 `git diff --check` 通过。

## macOS ARM64 单 job CI（2026-11-03）

- 按用户要求，桌面 CI 仅运行 macOS ARM64 workflow。测试和打包合并到同一 runner，复用 checkout、Node 依赖和 Trace Processor 准备结果；仍执行完整测试、APK smoke、macOS 安装包构建与打包启动 smoke。后续进一步缩短产物流程：只生成 DMG，不再额外生成 PKG；NDK 保留 26.1 与 27.2：前者为 Android 7 设备准备旧版 simpleperf，后者提供当前主版本。
- 更新 workflow 配置回归，确保只有一个 `macos-15` job、`npm ci` 与 Trace Processor 准备步骤各出现一次，且没有 Windows / Linux runner。此前拆分双 job 时，该回归因仍要求旧的 `tests` + `package` 双 job 而失败；更新断言后通过。
- 本轮将 workflow 配置回归改为检查单一 DMG 产物，以及构建当前版和 Android 7 兼容版 simpleperf 所需的两套 NDK。耗时主要来自完整自动测试，以及首次准备 Android SDK/NDK、分析运行时和 Electron DMG 资源；平台数已经是一个 macOS ARM64 job。
- 提交 `b135337` 的 Actions run `41588751361` 在 `Prepare macOS tools` 失败。公开 check annotation 定位为 `tools/simpleperf/versions.json` 缺失：该资源目录由 `.gitignore` 忽略，fresh runner 只安装 NDK 27 时不能读取本机生成的 legacy 版本清单。已恢复 NDK 26.1，用其生成 Android 7 兼容二进制；同时保留 NDK 27.2 作为现代版本。修复提交后的 CI 结果待确认。

## C/C++ 源码候选定位（2026-11-03）

- 源码工作区现在能把可读的 `namespace::Class::method(...)` 符号映射到 C/C++ 文件中的声明或定义候选，支持跨多行签名；候选过程会忽略注释、字符串和普通调用点。无法识别的 `operator` 等复杂格式仍回退为原始文本搜索。它不解析 ELF 调试信息或 mangled symbols，也不能证明候选来自当前 APK 的确切构建。
- API 25 真机不参与此离线功能。解析、跨行签名、快照 HTTP API、英文证据翻译与打包配置定向测试均通过；最新完整测试 335 项，319 通过、0 失败、16 项可选官方样本跳过。
- 最新 macOS arm64 打包 app smoke 使用 `.cxx` 跨行 C++ fixture：创建只读快照、文本搜索并打开 Java 文件，再解析 `apw::SmokeWorker::run`、显示英文匹配证据并打开 C++ 文件；同时既有 renderer、HPROF CSV、布局线索、Network Agent ZIP、50,000 样本 CPU Canvas 和 16 页英文扫描通过。CPU 栅格约 52.5 ms，是当前主机观测。

## 大型 HPROF 近似支配图（2026-11-03）

- 将 Lengauer–Tarjan 图算法改为 CSR 邻接表、类型化 DFS / 前驱 / bucket 工作数组；支配树子节点改为按需排序和缓存，避免为每个对象及边分配 JavaScript 小数组。移除原先 25 万对象的硬拒绝；仍受 HPROF 的 100 万索引对象与 150 万引用边边界约束，边截断会保留不完整标记。
- 新增 300,001 节点链图回归，确认超过旧上限时完整可达对象数、支配子树计数和记录字节累计正确。HPROF 单元与会话接口通过；全量自动回归 336 项，320 通过、0 失败、16 项可选官方样本跳过；`npm run check` 和 `git diff --check` 通过。
- macOS arm64 `.app` 重建与打包 smoke 通过；smoke 在实际 Electron renderer 导入 HPROF、导出 CSV 并打开近似支配图，确认显示可达 / 已索引 / 引用边统计。Smoke HPROF 是极小 fixture，引用图按预期标记不完整，不作为支配关系正确性的样本；正确性由 HPROF 图样例、HTTP session 测试与 300,001 节点算法回归覆盖。
- 此处记录的真实应用样本较小；大型 fixture 的端到端规模、耗时与上限见下方“大型真机 HPROF 完整支配图”。桌面进程峰值内存仍待量测；支配关系基于有限解析的引用边，不是精确 retained size。

## Network Agent 真机空状态（2026-11-03）

- 网络页现在区分未导入、等待已接入 Agent 的请求、设备快照没有 Agent 记录、筛选无匹配与空 HAR，并提供对应中英文提示。新增纯函数回归覆盖五种状态。
- 在 macOS arm64 打包应用中，使用 API 25 真机 `X3315A41621110053` / `com.xmotion.sui.debug` 完成只读 UI smoke：退出演示，选择设备与包，启动 Agent 轮询、读取 UID 10051 的日志快照并停止轮询；UI 正确显示“等待请求”和“尚未读取到 Agent 请求”。ADB 通过旧版 main-process PID 回退，PID 为 13662。该应用没有接入 Network Agent，日志中无 `APWNetwork` 事件，因此没有请求行；这验证空状态和读取链路，不表示真实业务请求捕获已验证。
- 定向网络 / 本地化 / 打包配置测试 45 项通过；全量回归 337 项，321 通过、0 失败、16 项因缺少可选官方样本跳过；`npm run check` 通过。

## 真机 HPROF 支配图端到端验证（2026-11-03）

- API 25 真机 `X3315A41621110053` 上对 `com.xmotion.sui.debug` 单独执行堆采集与分析 smoke，采集 62,563,597 字节 HPROF；工作台解析 181,189 个对象、3,528 类。
- 新增设备 smoke 的 `--only heap-capture-and-analysis` 选项，并在该检查中继续请求 `/heap/dominators`。本次支配图索引 189,835 个对象、可达 172,431 个、引用边 456,943 条，25 个根条目，未达到边上限；Shark 2.14 在 905 ms 内分析成功。单项 smoke 用时约 11.3 秒，其他 24 项明确记为跳过。
- 设备 smoke 配置回归增加对单项筛选和支配图接口的断言。本节目标应用样本低于 25 万对象；后续大型 fixture 结果见下节。算法另有 300,001 节点合成图回归。

## 大型真机 HPROF 完整支配图（2026-11-03）

- 新增可复现的 API 21+ debuggable Android fixture：启动后保留 350,000 个 Java 节点构成的引用链；由 Android SDK `javac`、D8、AAPT 和 apksigner 临时构建，设备测试结束后卸载，不纳入桌面安装包。
- 首轮图超过 750,000 引用边旧上限，正确标记结果不完整。将引用边上限提高到 1,500,000 后，最终 API 25 真机采集 23,490,803 字节 HPROF，解析 483,960 条对象/数组记录、1,420 类；支配图索引 488,347 个对象、可达 481,201 个、引用边 1,355,097 条，25 个根条目，未截断。Shark 2.14 用时 1,365 ms 成功；设备 smoke 统计采集与分析 7,802 ms，外层进程 wall time 8.15 秒。
- `/usr/bin/time -l` 测得 macOS ARM64 整个 Node 设备 smoke 进程最大 RSS 723,714,048 字节（约 690 MiB），包括服务、HPROF 解析、CSR 分析和 Shark 请求处理。结果证明支配图在真实设备 HPROF 超过 25 万对象时端到端运行；超过 50 万对象、100 万索引上限的快照、1,500,000 边上限及更高容量设备仍待验证。首轮触及旧上限的数据只作失败边界证据，不作为完整图结果。

## HPROF 引用图边记录压缩（2026-11-03）

- 将每条引用边从独立 JavaScript 对象压为 `[sourceId, label, flags]` 三元组；对象数组索引以整数保存，需要展示时再格式化；`flags` 保留弱、软、虚引用类别。反向引用分页、单对象根路径、批量根路径、LeakCanary 和支配图都改为读取该格式。
- API 25 同一 fixture 的两次完整真机复测均无截断，支配图约 488,000 个已索引对象、481,000 个可达对象和 1,355,000 条边；Shark 2.14 均成功。macOS ARM64 Node 进程峰值 RSS 分别为 685,408,256 字节（约 654 MiB）和 704,708,608 字节（约 672 MiB），对照压缩前单次 723,714,048 字节（约 690 MiB）。样本快照和运行时波动尚不足以证明稳定的内存降幅；需要更多重复和更大 HPROF 验证。
- HPROF 单元回归覆盖边标签、引用语义、根路径、批量路径和支配树；全量回归 338 项，322 通过、0 失败、16 项可选官方样本跳过；`npm run check` 与 `git diff --check` 通过。
- 代码提交 `4b10382` 的 macOS ARM64 CI 成功（run `41592701411`）。后续两个仅改验证记录的提交 `06ffe5b`、`85017f7` 都在 `npm test` 步骤失败；匿名 Actions 日志为 HTTP 403，失败诊断没有指出单个测试文件。本机全量并行重跑 3 次均通过；将默认测试改成单文件串行后再次通过，338 项中 322 通过、0 失败、16 项可选样本跳过，耗时约 6.5 秒（并行约 4.3 秒）。串行设置已加入 `npm test`；提交 `1669090` 的 macOS ARM64 单 job CI 全部通过（run `41594000587`），包含测试、DMG 构建与桌面启动 smoke。
