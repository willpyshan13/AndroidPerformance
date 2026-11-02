# 当前验证记录（2026-11-02）

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
- 设备事件支持度由设备 simpleperf 决定；硬件计数器复用可能影响样本权重。当前 ADB 未发现连接设备，因此本增量尚未做真机多事件采集验证。
- `npm run check`、`git diff --check` 通过；完整 `npm test`：189 项，174 通过、0 失败、15 项因未配置官方外部样本而跳过。

## simpleperf 设备事件发现增量

- 新增设备事件读取 API：临时推送 simpleperf 后执行 `list`，解析设备支持事件，最多返回 2,000 项，并在成功或失败后删除设备临时二进制。
- CPU 页面可读取当前设备事件并从下拉列表添加到最多 8 项的采集列表；设备切换后应重新读取。
- 模拟 ADB 测试覆盖事件清单解析、`(may not supported)` 标记剥离、临时文件清理；HTTP 测试覆盖设备序列号转发与事件列表响应。
- `npm run check`、`git diff --check` 通过；完整 `npm test`：191 项，176 通过、0 失败、15 项因未配置官方外部样本而跳过。
- 当前无连接设备，无法验证真机事件清单格式或事件可采样性。

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

## 布局、电池与真机 HPROF 增量

- 完整 `npm test`：181 项，166 通过、0 失败、15 项因未配置外部官方样本而跳过。
- `npm run check` 和 `git diff --check`：通过。
- 布局历史页新增全量相邻版本摘要及差异载入；摘要接口只传递 XML，不传截图。新增的计数纯函数和轻量历史接口测试通过。差异精度和 UIAutomator 覆盖范围与下方限制相同。
- 电池报告支持 JSON 导出和原始 Battery Historian checkin 导出；设备原始导出会重新读取当前 checkin。设备命令封装与文本下载接口测试通过。
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
