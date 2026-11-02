# Android Performance

**一款在本机运行的 Android 性能分析桌面工具。** 连接设备后采集性能数据，也可以导入 APK、HAR 和基准测试结果，在一个工作台中查看与归档。

`实时监控` · `帧耗时` · `启动测试` · `布局检查` · `系统追踪` · `APK 分析`

目前聚焦核心采集与离线分析。

---

## 快速开始

### 安装桌面版

目前已验证 **macOS Apple Silicon** 构建：

| 方式 | 文件 | 使用方法 |
| --- | --- | --- |
| 安装 | `dist/v0.2.0/Android Performance-0.2.0-arm64.dmg` | 打开镜像，将应用拖到「应用程序」 |
| 直接运行 | `dist/v0.2.0/mac-arm64/Android Performance.app` | 双击打开 |

当前 0.2.0 安装包内置运行环境、基于 Google Platform Tools 的 ADB 和 AAPT2，无需另外安装 Node.js 或启动浏览器；新源码构建的 macOS 包还会内置 simpleperf。也可以通过菜单 **文件 → 选择 ADB 程序…** 使用自己的 ADB；显式设置的 `ADB_PATH` 优先于自动检测。当前 Platform Tools 在部分 macOS 环境可能需要对已校验下载包中的项目副本使用本机 ad-hoc 签名，详见 [工具准备说明](tools/README.md)。

> 当前为本地 ad-hoc 签名的开发构建，尚未使用 Apple Developer 证书或公证。对外分发前还需完成正式签名、公证和其他设备的兼容性验证。

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
| CPU 采样 | 采集和导入 simpleperf 数据，查看正向调用树、热点调用方、火焰图、采样点时间线与函数汇总 | Android NDK simpleperf |
| 堆分析 | 采集或导入 HPROF，查看类、实例、引用、候选根路径、近似支配图及快照差异；在支持的设备上按调用栈采样 Native / ART 分配 | `am dumpheap`、Perfetto heapprofd |
| 电池与资源 | 单次或按间隔重复采集 batterystats，查看 UID 网络、唤醒锁、唤醒闹钟、作业及采样时间线；导出实验 JSON 或 Battery Historian checkin | `dumpsys batterystats --checkin` |
| 帧耗时 | 查看逐帧图、超预算帧、FrameTimeline 实际与预期时间、系统超期分类及同轨道分组 | `dumpsys gfxinfo framestats`、Perfetto |
| 启动测试 | 重复冷、温、热启动，查看耗时、观察到的启动模式及实验前后编译状态 | `am start -W`、`dumpsys package` |
| 布局检查 | 查看截图、层级和节点属性，搜索或隔离节点子树、高亮 UIAutomator 暴露的可访问性节点、按透明度叠加参考设计图、汇总全部历史快照的相邻变化并查看详情，检查待核对的标签与零尺寸线索；支持导入 XML | UIAutomator |
| 系统追踪 | 采集 5–30 秒追踪并下载、自动载入；可选择 FrameTimeline 模式；在本机完整 Perfetto UI 中交互分析，并查看切片、调度时间线及 Binder 名称匹配 | Perfetto，32 MB 缓冲区 |
| GPU 产物 | 导入 AGI 帧捕获或追踪，保存索引、校验 SHA-256，并将追踪送入系统追踪分析 | 本地 `.gfxtrace` / Perfetto 文件、外部 AGI |
| 网络分析 | 查看请求活动时间线和域名连接阶段；支持接入 OkHttp Agent 后读取 logcat | 本地导入标准 HAR |
| 基准对比 | 保存及载入历史运行，按测试参数比较指标并导出报告，提示环境差异和重复标识 | AndroidX Benchmark JSON |
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
npm run prepare:trace-processor  # 下载并校验 macOS arm64 的官方 Trace Processor
npm run prepare:perfetto-ui  # 下载并校验本机自托管的 Perfetto UI
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
npm run package:mac   # macOS arm64 .app
npm run package:dmg   # macOS arm64 DMG 和 .app
npm run package:win   # Windows x64 NSIS
npm run package:linux # Linux AppImage
```

Windows / Linux 的打包配置尚未在对应系统完成验证。macOS x64 可使用 `npx electron-builder --mac dmg --x64`，也需要在对应机器上验证。

## 数据与隐私

- 追踪导入会在系统临时目录保留一个私有文件供切换时间窗口，重新导入或正常退出服务时清除；异常终止时临时文件可能残留。
- 安装版记录位于系统应用数据目录的 `records/`；可从菜单 **文件 → 打开记录目录** 查看。源码桌面模式使用 `data/desktop-profile/records/`，浏览器模式使用 `data/`。
- 不调用 AI，也不自动上传采集文件。HAR 导入会丢弃查询参数、凭据、Headers、Cookies 和正文；路径与布局快照仍可能包含业务内容，保存前请按需检查。
- 界面通过仅监听 `127.0.0.1` 的服务与后端通信，并检查 Host、Origin 和启动时生成的访问令牌。Electron 渲染进程启用 sandbox 与 context isolation。
- 实时采样最多保存 1,800 条，图表显示最近 120 条。APK 上传上限为 512 MiB、50,000 个文件、8 GiB 解压后总大小；其他导入文件和记录请求上限为 12 MB。布局 XML 上限为 2 MB / 10,000 节点；HAR 上限为 50,000 个请求，表格最多显示 1,000 个匹配请求。
- 导入文件中声明的来源属于元数据，不能作为真实性鉴定。

## 结果解读与范围

- **CPU 采样**：需要 simpleperf、可调试或可 profile 的目标和允许采样的设备；按照当前源码重新打包的 macOS 版本内置 simpleperf，源码运行也可使用 Android NDK；既有 0.2.0 包不含此功能。导入 perf.data 还需要 Python 3；也可直接导入 folded stacks。权重是事件周期，不等同于 CPU 百分比；时间线显示采样点而非线程调度状态，支持按时间范围筛选。调用方树按当前火焰图范围汇总包含权重，递归调用可能重复计权，同名符号可能合并。
- **CPU 和内存**：CPU 优先根据相邻 `/proc` 计数器计算主进程利用率，单核为 100%；首个样本、进程重启或在线 CPU 数变化时需要重新建立基线。权限不足时回退到 `cpuinfo` 的应用及子进程窗口，超过 30 秒未更新则显示不可用。内存为主进程快照；电池信息不代表应用耗电量。
- **电池与资源**：统计属于 UID 的 since-charged 累计窗口，共享 UID 不能按应用拆分；两次同设备快照仅在窗口标识一致且计数未下降时计算可用差值，不能据此推算耗电量。可设置 2–50 次、1–3600 秒间隔采样；采样时间线显示累计读数，停止会保留已有样本。离线导入可导出原始 Battery Historian checkin；设备导出会重新读取设备当前 checkin，不代表此前快照的原始文件。保存实验和 JSON 报告包含完整样本序列；离线文件上限为 12 MiB。
- **帧与启动**：gfxinfo 历史缓冲区与平台累计 janky frames 的范围可能不同；超过自选预算不等同于平台 Jank。连续帧分组仅包含同一 PROFILEDATA 段中原始记录相邻、起始间隔不超过 100 ms 的超预算帧；缺失或无效记录会打断分组。FrameTimeline 模式要求 Android 12 及以上，请求系统帧数据源；有数据的真实设备录制尚待验证。普通追踪中是否包含该数据取决于设备的 Perfetto 版本。启动 TotalTime 不等同于 TTFD，温 / 热启动的实际状态以设备返回的 LaunchState 为准。编译状态读取设备报告的 Dexopt 数据，不证明 Baseline Profile 生效；兼容性尚待更多真机验证。冷启动会 force-stop 目标应用；帧分析建议先重置统计、重现操作，再读取数据。
- **布局与基准**：UIAutomator 提供可访问性层级，不是完整 View / Compose 树；截图与层级顺序采集，动画期间可能不一致。Benchmark 变化是描述性比较，不是显著性检验；sampledMetrics 如未提供中位数，会计算合并样本的中位数，样本不等同于独立实验。
- **堆分析**：采集通常需要可调试应用；字段和数组元素数据字节不等于浅大小或保留大小，支持分页查看已索引实例、跟随引用、查找有限的候选根路径和浏览近似支配图。最多索引 100 万个对象，支配图限 20 万对象和 75 万条引用。支配图基于可见 GC 根、字段、数组、类及静态字段关系；不区分强弱引用，可能缺少运行时关系。记录数据字节不含对象头、对齐等信息，不能作为保留大小；快照对比或路径结果都不能证明泄漏。
- **GPU**：桌面版可选择或启动本机安装的 AGI；导出 `.gfxtrace` 后需在 AGI 中手动打开。校验仅检测导入后文件是否变化，不能验证来源或格式；单个产物上限 512 MiB，交给内置追踪分析器的上限为 256 MiB。此功能不采集 GPU 数据。
- **源码工作区**：快照保存在本机；本地目录读取期间可能变化，因此不是原子的 Git 版本。远程模式使用浅克隆并记录完整提交 ID；临时仓库下载量可能大于快照限制，获取结束后清除临时仓库，不执行项目脚本，也不获取子模块或 LFS 内容。快照只包含受支持的文本源码，跳过符号链接及构建目录，最多 5,000 文件、总计 32 MiB。Java/Kotlin 符号定位按声明名、文件中的类名和包名排列候选，无法证明方法所属类、区分重载或还原混淆与内联；请核对版本和源码。原生符号使用文本搜索。
- **APK**：一次分析一个 APK；split APK 的结果只涵盖导入的文件。证书页面展示签名结构和证书信息，**不验证签名完整性或证书信任链**。

仍需补齐：精确保留大小和泄漏分析、完整 Compose Inspector、应用级能耗归因、未经接入的应用网络采集，以及主工作台内自定义 Perfetto SQL 查询。布局语义高亮只覆盖 UIAutomator 返回的可访问性节点，不提供 Compose Inspector 的合并/未合并语义树或重组计数；截图对比现支持居中等比叠加和透明度调整，尚无手动平移/缩放校准。完整 Perfetto UI 可作为本机嵌入分析器使用；该界面里的 SQL 查询不会自动进入工作台报告。

## 验证记录

自动测试覆盖 ADB 参数安全、采集解析、APK 解析与上传、记录校验、本地 HTTP 访问限制及持久化。`fixtures/` 提供可离线导入的合成样例。

| 验证 | 结果 | 详情 |
| --- | --- | --- |
| 自动测试 | 169 项通过、0 失败；15 项需要未配置的可选外部样本 | `npm test` |
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

网络页面可下载 OkHttp Agent 源码包。调试接入方式见 [android-agent/README.md](android-agent/README.md)。该链路尚待 Android 真机和真实应用验证。

堆分析可查看已索引 Bitmap 的 Java 字段与可识别的 byte[] 引用；这些信息不代表原生或硬件像素内存，也不是保留大小。

GPU 页面可读取设备系统报告的 Vulkan 和 OpenGL ES 版本；该报告不能替代 AGI 自身的设备兼容性验证。

布局检查支持按保存时间浏览本地快照、汇总每一版相对上一版的新增/移除/变化与未消歧 ID，并可一键载入任意相邻版本查看详情；也可分别载入任意快照作为当前版本和基线，并在差异列表中定位当前节点。全量摘要仅读取层级 XML，不下载历史截图。优先按唯一包名与资源 ID 匹配；重复 ID 可在共同唯一祖先内进行有限的候选匹配，不能确认控件身份；无 resource-id 节点不参与摘要计数。

启动页面可对已导入的 Perfetto 追踪查询启动区间和 TTID/TTFD；需要追踪包含相关 Android 事件，TTFD 还依赖应用的 fully drawn 报告。该结果不会自动与启动实验逐次配对，已用 Perfetto 官方 Android 12 冷启动样本验证；本机设备采集仍待验证。

系统追踪录制可选择包含当前应用的 ATrace 标记；目标应用需要实际提供标记，勾选本身不保证 TTID/TTFD 可计算。导入或录制的追踪可以保存到本机档案、重新载入或导出原始文件；档案载入前会校验 SHA-256。

完整 Perfetto UI 使用自托管的 v59.1 静态资源。点击追踪页“在本机完整 Perfetto 中查看”会通过本机服务将当前追踪送入同源 iframe；分享与下载开关默认关闭，追踪留在本机浏览器内存。源码运行前执行 `npm run prepare:perfetto-ui`；桌面打包会将该资源放入应用资源目录。主工作台与 Perfetto UI 各自使用不同 CSP，Perfetto 仅允许本机资源、WASM 和本地 worker。

CPU 采样完成后会下载并尝试自动载入分析；若解析失败，下载的原始文件仍可使用。采样可以保存为本机档案，载入前校验 SHA-256 并重新分析。支持指定本机 `symfs` 符号目录并重新解析，符号文件需要与采样中的路径和构建 ID 对应；不匹配的文件会被 simpleperf 拒绝，无法解析的函数仍显示为 `unknown`。

启动追踪的可选真实样本回归：从 Perfetto 官方测试数据获取 `api31_startup_cold.perfetto-trace`（SHA-256 `aadf4a141dc0249abd4d7080a7d94bd614949eb0e7398fa6f3c75b503c70dade`），设置 `APW_STARTUP_TRACE` 为本机路径后执行 `npm test`。未设置时相关真实样本测试会跳过。

Perfetto 启动记录可查看基于主线程状态和切片的阶段分解；分类及累计时间是分析工具的归类，不能单独证明问题根因。

启动与 FrameTimeline 记录可跳转至事件附近的系统追踪窗口，按原始纳秒时间裁剪；同一窗口内的事件仅表示时间重叠，不自动证明因果关系。

系统追踪可按 TID 查看当前时间窗口内的线程状态区间和累计时长；同一 TID 的不同生命周期按 UTID 区分。状态只反映追踪中记录的数据。

CPU 采样线程可按 PID/TID 查询当前系统追踪窗口的线程状态；不同记录可能来自不同设备或时间，PID/TID 也可能复用，请自行核对，功能不会自动对齐时钟。

桌面 GPU 页面可将已导入的 `.gfxtrace` 校验后交给已配置的 AGI。交接会在应用数据目录 `gpu-open/` 保留私有副本，便于 AGI 异步读取；可在不再需要时手动清理。当前环境未安装 AGI，实际打开行为仍待验证。

Benchmark 详情展示样本范围、四分位数及每次迭代中位数范围；新导入的 sampledMetrics 保留迭代分组，旧记录可能没有分组。这些描述性统计不能证明显著性。

电池页面在系统提供 `pwi` UID 数据时展示累计 mAh 估计及原始精度；该值可能包含共享 UID，依赖系统模型和取整，不作为两次快照之间的精确实验耗电。

电池页面可以从已保存的实验中选取当前或基线快照，再分别设为新的基线与结束快照；仅可比较来自同一设备、应用、UID 和统计窗口的数据。

导入 perf.data 后可选择采样事件；切换时重新读取原文件并按该事件生成调用栈，事件权重不会混合。事件清单最多 128 种，时间线样本有上限。

多事件导入可选回归样本为 Android 官方 simpleperf `perf_with_two_event_types.data`（SHA-256 `32c9e9edc7894fb96094041db31b6ddcb63f3b5bb24f402089e39c78d4dc9779`），设置 `APW_MULTI_EVENT_PERF` 后运行 `npm test`。

堆分析已用公开 Android 堆测试样本及 API 25 真机 HPROF 验证。真实设备采集会下载原始 `.hprof`，随后自动分析；页面展示记录数、类统计、实例、字段和引用查询。可设置 `APW_ANDROID_HPROF` 和 `APW_ANDROID_O_HPROF` 指向公开样本运行附加回归；文件校验值分别为 `14dcec5fa5ddb30fa3142fc5aaa90cdee02969662207458371d13a5eba007363` 和 `700b60f9b9bfb64d488f7663cc58b09f68760ed822a760911d4f4952ed4debbc`。

内存分配剖析会将原始 Perfetto 追踪下载到本机，并用 Trace Processor 汇总调用点。Native heapprofd 要求 Android 10（API 29）或更高版本；ART 分配采样要求 Android 12（API 31）或更高版本。目标应用还需满足系统的 debuggable/profileable 限制。Native 采样中的“未释放”是追踪期间的分配估计，不是 HPROF 存活对象或精确保留大小；独立命名的应用子进程可能需要单独配置。API 25 真机页面已验证能力门控，实际采样仍待支持设备验证。

真机验证记录：API 25 的 Compose 日历应用采集出 15.4 MiB HPROF，解析 196,210 条对象/数组记录、84,213 条 GC root 记录和 2,983 类；已验证 `java.lang.String` 实例分页、字段值/字符串预览、引用来源、Bitmap 与重复内容查询、Activity 候选和近似支配图（203,329 个索引对象）。支配图计算最多支持 25 万个索引对象。候选根路径如无结果会明确说明引用图覆盖有限，不据此判断不存在泄漏。该验证不等于完整 Compose Inspector，也不提供精确保留大小或原生堆像素分析。

堆页面可检查 Bitmap 引用的 Java byte[] 是否存在重复内容：先按哈希筛选再逐字节核对，共享同一个数组不算副本。结果有扫描上限，不包含原生或硬件像素，也不是可释放内存估计。

堆分析可筛选 `android.app.Activity.mDestroyed` 为 true 的对象并查看候选根路径；路径搜索可标注并排除已识别的弱、软和虚引用的 `referent`。对象尚待回收、其他引用语义及不完整引用图都可能影响判断，不能仅凭此认定泄漏。
