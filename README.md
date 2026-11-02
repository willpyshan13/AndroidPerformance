# Android Performance

**一款在本机运行的 Android 性能分析桌面工具。** 连接设备后采集性能数据，也可以导入 APK、HAR 和基准测试结果，在一个工作台中查看与归档。

`实时监控` · `帧耗时` · `启动测试` · `布局检查` · `系统追踪` · `APK 分析`

目前聚焦核心采集与离线分析。

---

## 快速开始

### 安装桌面版

GitHub Actions 原生 runner 已构建并上传以下安装包（artifact 保留 14 天）：

| 平台 | 安装包 | CI 产物 |
| --- | --- | --- |
| macOS Apple Silicon | DMG、PKG | `android-performance-macos-arm64` |
| macOS Intel | DMG、PKG | `android-performance-macos-x64` |
| Windows x64 | NSIS EXE、MSI | `android-performance-windows-x64` |
| Linux x64 | AppImage、DEB、RPM | `android-performance-linux-x64` |

[查看本轮跨平台构建结果](https://github.com/willpyshan13/AndroidPerformance/actions/runs/41503926815)。macOS PKG 目前未签名；应用使用 ad-hoc 签名，未使用 Apple Developer 证书或公证。
安装包包含 Electron、平台原生 ADB/AAPT2 与分析所需工具，无需另外安装 Node.js 或启动浏览器。Windows 首次启动会把 Java runtime 解压到应用数据目录，以供 Shark 和 Compose Inspector 使用。也可以通过菜单 **文件 → 选择 ADB 程序…** 使用自己的 ADB；显式设置的 `ADB_PATH` 优先于自动检测。

Windows Java runtime 解压逻辑通过自动测试；当前 CI 验证了安装包构建和上传。当前环境已对 macOS arm64 桌面包执行 headless 启动冒烟，并确认本机首页及 JavaScript 返回 HTTP 200；尚未在可见桌面逐项检查窗口，也未在 Windows/Linux 上逐一安装启动。macOS 使用 ad-hoc 签名，尚未使用 Apple Developer 证书或公证。

### 连接 Android 设备

1. 在手机上开启**开发者选项**和 **USB 调试**，用数据线连接电脑。
2. 在手机上允许调试授权，并保持设备解锁。
3. 打开应用，刷新设备列表，选择设备和目标应用。
4. 运行目标应用并开始采集；完成后保存记录或导出 JSON。

无线调试需先在终端执行 `adb pair` / `adb connect`。没有设备时，可点击 **进入演示**；示例数据会明确标注，演示模式不会生成虚构的 Perfetto 文件。

## 功能一览

| 功能 | 可以做什么 | 数据来源 |
| --- | --- | --- |
| 设备与应用 | 查看连接状态、设备信息和已安装应用 | `adb devices -l`、设备属性 |
| 实时监控 | 查看主进程 CPU、PSS / RSS、内存组成及设备电池信息 | `/proc`、`dumpsys cpuinfo`、`dumpsys meminfo` |
| CPU 采样 | 采集和导入 simpleperf 数据，查看可展开调用树及相对权重条、热点调用方、火焰图、按单调时间排列的采样调用栈、采样点时间线与叶函数权重分布；设备采集会保留 simpleperf 明确报告的截断及丢失样本诊断 | Android NDK simpleperf |
| 堆分析 | 采集或导入 HPROF，查看类、实例、引用、候选根路径、近似支配图及快照差异；使用 Shark 2.14 生成 LeakCanary 格式的 Android 泄漏报告；读取目标应用 Logcat 中的 LeakCanary 实时事件；在支持的设备上按调用栈采样 Native / ART 分配 | `am dumpheap`、LeakCanary Logcat、Shark、Perfetto heapprofd |
| 电池与资源 | 单次或按间隔重复采集 batterystats，查看 UID 网络、唤醒锁、唤醒闹钟、作业及采样时间线；在可用时计算系统报告的 UID mAh 估计值区间差；导出实验 JSON 或 Battery Historian checkin | `dumpsys batterystats --checkin` |
| 帧耗时 | 查看逐帧图、超预算帧、FrameTimeline 实际与预期时间、系统超期分类及同轨道分组 | `dumpsys gfxinfo framestats`、Perfetto |
| 启动测试 | 重复冷、温、热启动，查看耗时、观察到的启动模式及实验前后编译状态 | `am start -W`、`dumpsys package` |
| 布局检查 | debug 构建可接入应用内 Agent 采集 Android View 树、Compose 合并/未合并 Semantics 树和截图；可导入/导出包含层级、截图与设备元数据的完整采集档案；可对选定 Composable 显式插桩并读取运行时执行次数；应用内 Agent 还可统计 RecomposeScope 的 State 读取关联，以及两次采集之间已应用 State 对象与读取关系的时间交集（不证明重组或帧因果）；新 Probe 的 uptime 事件可与 gfxinfo 逐帧区间做时间重合关联；未接入时使用 UIAutomator 回退 | Android View、Compose Semantics、Compose Runtime probe、UIAutomator、Compose 编译报告 |
| 系统追踪 | 采集 5–30 秒追踪并下载、自动载入；可选择 FrameTimeline 模式；Compose Probe uptime 事件可借助追踪时钟快照与实际帧区间做时间重合关联；在本机完整 Perfetto UI 中交互分析，并查看切片、调度时间线、Binder 阶段及 GPU RenderStage / 频率 / 进程显存证据；可用同一追踪的 FrameTimeline 以 UPID 和时间区间找重叠项 | Perfetto，32 MB 缓冲区 |
| GPU 产物 | 导入 AGI 帧捕获或追踪，保存索引、校验 SHA-256，并将追踪送入系统追踪分析 | 本地 `.gfxtrace` / Perfetto 文件、外部 AGI |
| 网络分析 | 查看请求活动时间线和域名连接阶段；支持接入 OkHttp Agent 后读取 logcat；也可比较系统按 UID 统计的移动网络与 Wi-Fi 字节数 | 本地导入标准 HAR、`dumpsys batterystats --checkin` |
| 基准对比 | 保存及载入历史运行，按测试参数比较指标并导出报告，提示环境差异和重复标识；可运行已安装的 instrumentation，或选择带 Gradle Wrapper 的 Macrobenchmark 工程执行 connected Android Test，并载入本次生成的 JSON、直接将本次 trace 导入分析；可选多份独立保存报告，查看并导出逐指标的报告级中位数及探索性 95% Bootstrap 区间 | AndroidX Benchmark JSON / ADB / Gradle Wrapper |
| 源码工作区 | 创建本地或 GitHub/AOSP 源码快照、文本检索和查看，从 CPU 函数及布局类名定位 Java/Kotlin 声明候选 | 本机目录或公开 Git 仓库 |
| APK 分析 | 查看包信息、权限、组件、文件大小、DEX、原生库、证书和 Manifest | 本地 APK、AAPT2 |
| 外观设置 | 跟随系统或切换浅色/深色主题，设置 90%–120% 缩放；桌面偏好退出后保留 | 系统外观与本机设置 |
| 采集记录 | 保存、回放及导入导出 JSON 报告 | 本地记录 |

桌面版提供原生文件选择、菜单和快捷键。`⌘/Ctrl+1…9` 切换分析模块，`⌘/Ctrl+O` 打开采集记录，`⌘/Ctrl+,` 打开帮助。

## 从源码运行

需要 Node.js 22+。桌面版依赖 Electron 45.1.0 和 electron-builder 26.18.0，版本由锁文件固定。

```sh
npm ci
npm run prepare:adb        # 准备 macOS 官方 ADB，打包前需要
npm run prepare:apk-tools  # 从本机 Android SDK 准备 AAPT2
npm run prepare:simpleperf  # 准备 macOS simpleperf 资源（需要稳定版 NDK 和 r26 或更早版本）
npm run prepare:trace-processor  # 下载并校验当前主机架构的官方 Trace Processor
npm run prepare:perfetto-ui  # 下载并校验本机自托管的 Perfetto UI
npm run prepare:shark        # 下载并校验 Shark 及 Java runtime
npm run desktop
```

也可以运行本地浏览器开发模式：

```sh
npm start
# 打开 http://127.0.0.1:4318

# 可选：指定 ADB 和端口
ADB_PATH=/path/to/platform-tools/adb PORT=4319 npm start
```

### 测试与打包

```sh
npm run check         # 语法检查
npm test              # 自动测试
npm run package:mac                 # macOS arm64 .app
npm run package:mac:installers      # macOS arm64 DMG + PKG
npm run package:mac:installers:x64  # macOS x64 DMG + PKG
npm run package:win:installers      # Windows x64 NSIS + MSI
npm run package:linux:installers   # Linux x64 AppImage + DEB + RPM
```

GitHub Actions 于 2026-11-03 成功构建并上传 macOS arm64/x64 DMG、PKG，Windows x64 NSIS EXE、MSI，以及 Linux x64 AppImage、DEB、RPM；详见[构建记录](https://github.com/willpyshan13/AndroidPerformance/actions/runs/41503926815)。macOS arm64 DMG 本机校验和有效；PKG 未签名。Linux arm64 尚未进入打包矩阵：本轮检查的 Google Maven 官方 Linux AAPT2 是 x86-64 ELF；目前没有已验证的 ARM64 AAPT2 方案，所以不能在不牺牲 APK 分析能力的情况下发布该架构。参见 [Android AAPT2 文档](https://developer.android.com/tools/aapt2)；Windows runtime 解压仍需安装后的桌面冒烟验证。macOS / Windows 安装包尚未使用开发者签名证书。

## 数据与隐私

- 追踪导入会在系统临时目录保留一个私有文件供切换时间窗口，重新导入或正常退出服务时清除；异常终止时临时文件可能残留。
- 安装版记录位于系统应用数据目录的 `records/`；可从菜单 **文件 → 打开记录目录** 查看。源码桌面模式使用 `data/desktop-profile/records/`，浏览器模式使用 `data/`。
- 不调用 AI，也不自动上传采集文件。HAR 导入会丢弃查询参数、凭据、Headers、Cookies 和正文；路径与布局快照仍可能包含业务内容，保存前请按需检查。
- 界面通过仅监听 `127.0.0.1` 的服务与后端通信，并检查 Host、Origin 和启动时生成的访问令牌。Electron 渲染进程启用 sandbox 与 context isolation。
- 实时采样最多保存 1,800 条，图表显示最近 120 条。APK 上传上限为 512 MiB、50,000 个文件、8 GiB 解压后总大小；其他导入文件和记录请求上限为 12 MB。手动导入布局 XML 上限为 2 MB；布局采集档案最大 48 MiB，含最多 8 MiB XML 与 24 MiB PNG；debug View Agent 回包上限为 8 MiB，最多解析 10,000 节点；HAR 上限为 50,000 个请求，表格最多显示 1,000 个匹配请求。
- 导入文件中声明的来源属于元数据，不能作为真实性鉴定。

## 结果解读与范围

- **CPU 采样与 ART 方法跟踪**：需要 simpleperf、可调试或可 profile 的目标和允许采样的设备；可点击“读取设备事件”查询该设备的 simpleperf 事件并从列表添加，采集时最多指定 8 个逗号分隔事件。不同设备支持的事件不同；硬件计数器复用时，事件样本数和权重会受计数器运行比例影响。按照当前源码重新打包的 macOS 版本内置 simpleperf，源码运行也可使用 Android NDK；既有 0.2.0 包不含此功能。导入 perf.data 还需要 Python 3；也可直接导入 folded stacks。权重是事件周期，不等同于 CPU 百分比；时间线显示采样点而非线程调度状态，支持按时间范围筛选。可在目标应用运行时通过 `am profile` 采集 ART `.trace/.dmtrace`（3–30 秒、可设置 100 µs–1 s 采样间隔，采集中可取消），也可导入已有文件，查看方法调用时间线、线程、调用次数、包含与自身时间；逐方法插桩开销明显，耗时只适合相对参考，不能与 simpleperf 采样结果混为一类。
- **CPU 和内存**：CPU 优先根据相邻 `/proc` 计数器计算主进程利用率，单核为 100%；首个样本、进程重启或在线 CPU 数变化时需要重新建立基线。权限不足时回退到 `cpuinfo` 的应用及子进程窗口，超过 30 秒未更新则显示不可用。内存为主进程快照；电池信息不代表应用耗电量。
- **电池与资源**：统计属于 UID 的 since-charged 累计窗口，共享 UID 不能按应用拆分；两次同设备快照仅在窗口标识一致且计数未下降时计算可用差值，不能据此推算耗电量。可设置 2–50 次、1–3600 秒间隔采样；采样时间线显示累计读数，停止会保留已有样本。离线导入可导出原始 Battery Historian checkin；设备导出会重新读取设备当前 checkin，不代表此前快照的原始文件。保存实验和 JSON 报告包含完整样本序列；离线文件上限为 12 MiB。
- **帧与启动**：gfxinfo 历史缓冲区与平台累计 janky frames 的范围可能不同；超过自选预算不等同于平台 Jank。连续帧分组仅包含同一 PROFILEDATA 段中原始记录相邻、起始间隔不超过 100 ms 的超预算帧；缺失或无效记录会打断分组。FrameTimeline 模式要求 Android 12 及以上，请求系统帧数据源；有数据的真实设备录制尚待验证。普通追踪中是否包含该数据取决于设备的 Perfetto 版本。启动 TotalTime 不等同于 TTFD，温 / 热启动的实际状态以设备返回的 LaunchState 为准。编译状态读取设备报告的 Dexopt 数据，不证明 Baseline Profile 生效；兼容性尚待更多真机验证。冷启动会 force-stop 目标应用；帧分析建议先重置统计、重现操作，再读取数据。
- **布局与基准**：UIAutomator 提供可访问性层级，不是完整 View / Compose 树；截图与层级顺序采集，动画期间可能不一致。Benchmark 单份报告变化是描述性比较；多份独立保存报告可估算报告级中位数差异的 Bootstrap 区间，但它是探索性估计，不是显著性检验或因果结论。使用者需确认报告来自独立运行；sampledMetrics 如未提供中位数，会计算合并样本的中位数，单份报告内的 runs 不等于独立实验。
- **堆分析**：采集通常需要可调试应用；字段和数组元素数据字节不等于浅大小或保留大小，支持分页查看已索引实例、跟随引用、查找有限的候选根路径和浏览近似支配图。最多索引 100 万个对象，支配图限 20 万对象和 75 万条引用。支配图基于可见 GC 根、字段、数组、类及静态字段关系；不区分强弱引用，可能缺少运行时关系。记录数据字节不含对象头、对齐等信息，不能作为保留大小；快照对比或路径结果都不能证明泄漏。
- **GPU**：桌面版可选择或启动本机安装的 AGI；导出 `.gfxtrace` 后需在 AGI 中手动打开。校验仅检测导入后文件是否变化，不能验证来源或格式；单个产物上限 512 MiB，交给内置追踪分析器的上限为 256 MiB。此功能不采集 GPU 数据。
- **源码工作区**：快照保存在本机；本地目录读取期间可能变化，因此不是原子的 Git 版本。远程模式使用浅克隆并记录完整提交 ID；临时仓库下载量可能大于快照限制，获取结束后清除临时仓库，不执行项目脚本，也不获取子模块或 LFS 内容。快照包含受支持的文本源码，并在 Gradle 工程中额外收集 `build/outputs/mapping/**/mapping.txt`；其他构建产物和符号链接会跳过。最多 5,000 文件、总计 32 MiB。Java/Kotlin 符号定位会优先使用 R8 / ProGuard 映射文件还原混淆类名、方法名及可用的行号范围，再按源码声明生成候选；没有映射时按声明名、类名和包名排序。候选仍需核对源码版本、重载和内联位置。原生符号使用文本搜索。
- **APK**：一次分析一个 APK；split APK 的结果只涵盖导入的文件。证书页面展示签名结构和证书信息，**不验证签名完整性或证书信任链**。

仍需补齐：State 变更与实际重组执行、帧表现之间的因果关联，以及基于实测功耗轨道的独立应用能耗归因及未接入应用的网络请求明细采集。网络页现可用系统 UID 累计快照比较移动网络和 Wi-Fi 总字节数，但不能显示请求、域名或时间线。电池页在统计窗口一致且系统提供 UID mAh 时可显示两次系统估计值的区间差；它仍是 batterystats 模型估算，无法拆分共享 UID。布局页可在 debug 构建中接入应用内 Agent；兼容的 Compose UI 运行时会采集合并/未合并 Semantics 节点，也可反射读取兼容 Compose 版本的运行时组合组树及按 RecomposeScope 聚合的 State 读取关联数（不读取 State 值）。手动 probe 可统计指定 Composable 的 SideEffect 提交；Kotlin 2.2.21 编译器插件可统计本模块 Composable 函数体执行与 Composer 跳过次数，并提供按函数和可用组 key 聚合的父子调用树，组 key 可与 Agent 组合组节点对照；未接入时使用 UIAutomator 回退。自动插件不能覆盖未重编译的依赖或区分同名实例，部分 lambda 没有组 key；Agent 的 State 关联不代表因果；新版 runtime event 可通过追踪内的 CLOCK_MONOTONIC 快照映射至 Perfetto FrameTimeline，并分别与 gfxinfo 帧区间做时间重合关联；旧版 elapsedRealtime 事件不会参与 Perfetto 映射；时间重合不证明因果或同一设备来源，需自行确认日志与追踪来自同一设备及交互时段；View.draw 对安全窗口和部分硬件合成内容有限制；Compose 编译报告是静态信息。布局差异可在当前截图标记新增和变化节点，并在保留的基线截图回放移除节点及移动前位置；参考截图仍需手动缩放和平移校准。主工作台支持对当前追踪运行只读 SELECT / WITH 查询，结果最多 500 行、50 列；嵌入式 Perfetto UI 的查询仍不会自动进入工作台报告。Benchmark 运行后会核对标准报告的更新时间和大小，只在确认文件于本次运行中更新时自动载入；设备不支持文件元数据检查时可手动指定报告路径读取。

## 验证记录

自动测试覆盖 ADB 参数安全、采集解析、APK 解析与上传、记录校验、本地 HTTP 访问限制及持久化。`fixtures/` 提供可离线导入的合成样例。

| 验证 | 结果 | 详情 |
| --- | --- | --- |
| 自动测试 | 318 项，302 通过、0 失败、16 项因未配置的可选外部样本而跳过 | `npm test`；完整记录见 [TEST_REPORT.md](TEST_REPORT.md) |
| 设备采集（2026-11-02） | rk3399-all（Android 7.1.2 / API 25）：15 项通过；Perfetto 因设备不支持而跳过 | [真机测试记录](TEST_REPORT.md) |
| APK 分析 | 真实 APK 导入、分析、导出和回放已验证 | [APK 测试记录](APK_TEST_REPORT.md) |

## 项目结构

```text
desktop/   Electron 主进程、preload 和图标
src/       ADB 采集、APK 分析、数据解析与本地服务
public/    中文工作台、图表和演示数据
test/      Node.js 自动测试
fixtures/  可导入的合成样例
data/      本地开发数据（忽略提交）
dist/      按版本保存的构建产物（忽略提交）
tools/     ADB 和 AAPT2 资源准备目录
```

参考文档：[Android ADB](https://developer.android.com/tools/adb) · [dumpsys](https://developer.android.com/tools/dumpsys) · [Perfetto](https://perfetto.dev/docs/getting-started/system-tracing)

网络页面可按域名/路径、方法、状态、HAR 连接标识、请求耗时和本地开始时间筛选；筛选会同步更新请求统计、接口百分位、活动时间线和列表，也可将当前筛选结果导出为 CSV。CSV 会引用并转义字段，且阻止表格公式注入。HAR 导入仅保留安全字符组成的连接标识。网络页面也可下载 OkHttp Agent 源码包。调试接入方式见 [android-agent/README.md](android-agent/README.md)。Agent 链路尚待 Android 真机和真实应用验证。

堆分析可查看已索引 Bitmap 的 Java 字段与可识别的 byte[] 引用；这些信息不代表原生或硬件像素内存，也不是保留大小。

GPU 页面可读取设备系统报告的 Vulkan 和 OpenGL ES 版本；该报告不能替代 AGI 自身的设备兼容性验证。

布局检查支持按保存时间浏览本地快照、汇总每一版相对上一版的新增/移除/变化与未消歧 ID，并可一键载入任意相邻版本查看详情；也可分别载入任意快照作为当前版本和基线，并在差异列表中定位当前节点。全量摘要仅读取层级 XML，不下载历史截图。布局线索仅基于 UIAutomator 已读节点；设备报告显示密度时会把可交互节点边界换算为 dp，并将小于 48 dp 的结果标作人工复核候选。48 dp 是 Android 对触控目标的建议值；UIAutomator 可见边界不是实际触控区域，padding、TouchDelegate 或 Compose 最小触控语义可能扩展它。[Android 可访问性指南](https://developer.android.com/guide/topics/ui/accessibility/apps)。优先按唯一包名与资源 ID 匹配；重复 ID 可在共同唯一祖先内进行有限的候选匹配，不能确认控件身份；无 resource-id 节点不参与摘要计数。

布局检查还可导入 Compose Compiler 生成的 `composables.txt`、`composables.csv` 和 `classes.txt`，按函数、包、参数或类字段搜索 restartable/skippable 状态与静态稳定性推断。该报告不含应用运行时重组/跳过次数；运行时数据仍需单独采集，静态报告也不能单独证明性能问题。[Android Compose 稳定性诊断文档](https://developer.android.com/develop/ui/compose/performance/stability/diagnose)。

在布局页下载 Agent 源码包，按包内指南接入目标应用的 debug 构建，再使用相同的临时令牌采集。Agent 只在应用进程内读取 View 与可兼容的 Compose Semantics 树，不增加 Android 权限；正式 release 不应包含 Agent 或令牌。可选的 Compose probe 需在目标函数中显式调用并受 debug 构建保护，统计 SideEffect 提交与实例；可选编译器插件自动统计本次编译模块的函数体执行与 Composer 跳过，但需要匹配 Kotlin 2.2.21 编译器。Agent 还可读取组合组树及按 RecomposeScope 统计的 State 关联数（不读取 State 值）；调用树中的匹配 Group key 可定位对应 Runtime 组，多实例会列出候选供选择。布局页还集成完整 Compose Inspector，可读取实例级 Compose 树、运行时参数与 Modifier、源码位置、merged / unmerged Semantics 和 View 属性，并支持大参数续读、JSON 导出、截图边界高亮，以及定位到已有源码快照中的文件候选。它要求 Android 10（API 29）或更高版本及可注入的目标应用；连接的 API 25 设备会在注入前被门控拒绝。资源解析栈为可选项，首次使用可能修改 `debug_view_attributes_application_package` 并重启 Activity。参数可能含应用展示的数据，只在本机处理。截图在检查器响应后采集，动画期间边界可能错位；快照不提供 State Reads 因果或帧关联，安全窗口和部分硬件合成内容也无法保证完整显示。

启动页面可对已导入的 Perfetto 追踪查询启动区间和 TTID/TTFD，也可按里程碑窗口分别查看已记录的 GC、JIT、类加载、类验证、类初始化及 dex2oat 切片重叠；需要追踪包含相关 Android 事件，TTFD 还依赖应用的 fully drawn 报告。ART 切片时长不是线程 CPU 时间，事件间可能重叠，缺失不代表耗时为零。启动数据不会自动与启动实验逐次配对，已用 Perfetto 官方 Android 12 冷启动样本验证；本机设备采集仍待验证。

系统追踪录制可选择包含当前应用的 ATrace 标记；目标应用需要实际提供标记，勾选本身不保证 TTID/TTFD 可计算。导入或录制的追踪可以保存到本机档案、重新载入或导出原始文件；档案载入前会校验 SHA-256。

完整 Perfetto UI 使用自托管的 v59.1 静态资源。点击追踪页“在本机完整 Perfetto 中查看”会通过本机服务将当前追踪送入同源 iframe；分享与下载开关默认关闭，追踪留在本机浏览器内存。源码运行前执行 `npm run prepare:perfetto-ui`；桌面打包会将该资源放入应用资源目录。主工作台与 Perfetto UI 各自使用不同 CSP，Perfetto 仅允许本机资源、WASM 和本地 worker。

CPU 采样完成后会下载并尝试自动载入分析；若解析失败，下载的原始文件仍可使用。实时采集会一并显示 simpleperf 输出中可识别的记录数、切除数、丢失数、内核 / 用户态丢失数及截断调用栈数；支持 trace-offcpu 的设备还可记录线程被调度切出后的等待栈，并在 `sched:sched_switch` 事件中查看区间估算。未由设备报告的项目保持“未提供”，不会按零计，也不会从解析后的时间线推算；单独导入 perf.data 时，这些采集器诊断不可恢复。采样可以保存为本机档案，载入前校验 SHA-256 并重新分析。支持指定本机 `symfs` 符号目录并重新解析，符号文件需要与采样中的路径和构建 ID 对应；不匹配的文件会被 simpleperf 拒绝，无法解析的函数仍显示为 `unknown`。

启动追踪的可选真实样本回归：从 Perfetto 官方测试数据获取 `api31_startup_cold.perfetto-trace`（SHA-256 `aadf4a141dc0249abd4d7080a7d94bd614949eb0e7398fa6f3c75b503c70dade`），设置 `APW_STARTUP_TRACE` 为本机路径后执行 `npm test`。未设置时相关真实样本测试会跳过。

Perfetto 启动记录可查看基于主线程状态和切片的阶段分解；分类及累计时间是分析工具的归类，不能单独证明问题根因。

启动与 FrameTimeline 记录可跳转至事件附近的系统追踪窗口，按原始纳秒时间裁剪；同一窗口内的事件仅表示时间重叠，不自动证明因果关系。

系统追踪可按 TID 查看当前时间窗口内的线程状态区间和累计时长；同一 TID 的不同生命周期按 UTID 区分。GPU 诊断按需读取 RenderStage、频率和进程 GPU 内存轨道，并可将 RenderStage 按进程 UPID 和纳秒区间与 FrameTimeline 比较；设备未采集或驱动未提供时会显示无数据，频率保留追踪原始值。RenderStage 可能跨队列并行，持续时间求和不是墙钟耗时；时间重合也不证明 GPU 负载导致某帧卡顿。状态只反映追踪中记录的数据。

CPU 采样提供按叶函数汇总的时间分布图，点击时间段可查看该段全部线程的调用树；图中是事件周期采样权重，不是 CPU 时间或函数包含成本。线程时间线可按 PID/TID 查询当前系统追踪窗口的线程状态；不同记录可能来自不同设备或时间，PID/TID 也可能复用，请自行核对，功能不会自动对齐时钟。

桌面 GPU 页面可将已导入的 `.gfxtrace` 校验后交给已配置的 AGI。交接会在应用数据目录 `gpu-open/` 保留私有副本，便于 AGI 异步读取；可在不再需要时手动清理。当前环境未安装 AGI，实际打开行为仍待验证。

Benchmark 详情展示样本范围、四分位数及每次迭代中位数范围；新导入的 sampledMetrics 保留迭代分组，旧记录可能没有分组。这些描述性统计不能证明显著性。

在“基准对比”页可以选择 Macrobenchmark 工程目录，默认任务为 `:macrobenchmark:connectedBenchmarkReleaseAndroidTest`，也可按项目修改为实际的模块和变体任务。工程需包含 `gradlew` 使用的 Gradle Wrapper 文件及 Android Benchmark 模块，设备需已连接并可被 Android Gradle Plugin 识别；应用会通过本机 Java Runtime 调用 Wrapper，不经 Shell。Gradle 按工程配置构建、安装测试 APK 并执行测试，首次运行可能下载 Gradle 和项目依赖。运行结束后仅自动读取本次更新的 `connected_android_test_additional_output` 中 `benchmarkData*.json`；发现 trace 文件后，可从结果区选择并安全导入追踪分析。若工程使用自定义报告目录或输出名称，请手动导入 JSON。运行前请确认所选工程及 Gradle 脚本可信，因为 Gradle 构建会执行工程代码。

电池页面在系统提供 `pwi` UID 数据时展示累计 mAh 估计及原始精度；该值可能包含共享 UID，依赖系统模型和取整，不作为两次快照之间的精确实验耗电。

电池页面可以从已保存的实验中选取当前或基线快照，再分别设为新的基线与结束快照；仅可比较来自同一设备、应用、UID 和统计窗口的数据。

导入 perf.data 后可选择采样事件；切换时重新读取原文件并按该事件生成调用栈，事件权重不会混合。事件清单最多 128 种，时间线样本有上限。

多事件导入可选回归样本为 Android 官方 simpleperf `perf_with_two_event_types.data`（SHA-256 `32c9e9edc7894fb96094041db31b6ddcb63f3b5bb24f402089e39c78d4dc9779`），设置 `APW_MULTI_EVENT_PERF` 后运行 `npm test`。

simpleperf 设备采集可在进行中取消。取消会向本次采样进程发送中断信号，等待其退出后再删除设备和本机临时文件并释放设备采集锁；设备拒绝终止或 ADB 连接异常时，清理能力取决于设备当前连接状态。

堆分析已用公开 Android 堆测试样本及 API 25 真机 HPROF 验证。真实设备采集会下载原始 `.hprof`，随后自动分析；页面展示记录数、类统计、实例、字段和引用查询。可设置 `APW_ANDROID_HPROF` 和 `APW_ANDROID_O_HPROF` 指向公开样本运行附加回归；文件校验值分别为 `14dcec5fa5ddb30fa3142fc5aaa90cdee02969662207458371d13a5eba007363` 和 `700b60f9b9bfb64d488f7663cc58b09f68760ed822a760911d4f4952ed4debbc`。

桌面构建还包含 LeakCanary Shark 2.14 分析器。源码环境首次打包前运行 `npm run prepare:shark`，脚本下载官方发布包并校验 SHA-256，只提取 CLI 所需的核心 JAR 与许可证，同时准备 Java 17 runtime；HPROF 页面提供“Shark Android 泄漏分析”，报告包含泄漏路径、指纹、Android reference matcher / inspector 结果和 retained size。项目另有本地 `KeyedWeakReference` 路径候选分析；该候选结果与 Shark 的泄漏判定分开展示。堆分析页可载入 R8 / ProGuard `.map` 或 `.txt` 映射文件（最多 128 MiB），应用会将映射保存在当前 HPROF 临时会话中供 Shark 使用；清除映射、替换快照或退出应用时删除临时文件。

内存分配剖析会将原始 Perfetto 追踪下载到本机，并用 Trace Processor 汇总调用点。Native heapprofd 要求 Android 10（API 29）或更高版本；ART 分配采样要求 Android 12（API 31）或更高版本。目标应用还需满足系统的 debuggable/profileable 限制。Native 采样中的“未释放”是追踪期间的分配估计，不是 HPROF 存活对象或精确保留大小；独立命名的应用子进程可能需要单独配置。API 25 真机页面已验证能力门控，实际采样仍待支持设备验证。

真机验证记录：API 25 的 Compose 日历应用采集出 15.4 MiB HPROF，解析 196,210 条对象/数组记录、84,213 条 GC root 记录和 2,983 类；已验证 `java.lang.String` 实例分页、字段值/字符串预览、引用来源、Bitmap 与重复内容查询、Activity 候选和近似支配图（203,329 个索引对象）。支配图计算最多支持 25 万个索引对象。候选根路径如无结果会明确说明引用图覆盖有限，不据此判断不存在泄漏。该验证不等于完整 Compose Inspector，也不提供精确保留大小或原生堆像素分析。

堆页面可检查 Bitmap 引用的 Java byte[] 是否存在重复内容：先按哈希筛选再逐字节核对，共享同一个数组不算副本。结果有扫描上限，不包含原生或硬件像素，也不是可释放内存估计。

堆分析可筛选 `android.app.Activity.mDestroyed` 为 true 的对象并查看候选根路径；路径搜索可标注并排除已识别的弱、软和虚引用的 `referent`。对象尚待回收、其他引用语义及不完整引用图都可能影响判断，不能仅凭此认定泄漏。
