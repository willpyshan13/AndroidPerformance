# 功能对齐计划

目标：对齐 AndroidPerformanceStudio 公布的用户功能，同时保留现有 APK 分析。以下状态按本项目实际能力记录；实现后须附上验证结果及设备限制。

| 模块 | 当前状态 | 待完成 |
| --- | --- | --- |
| 布局检查 | UIAutomator 快照、截图、属性、节点搜索、子树隔离、高亮 UIAutomator 暴露的可访问性节点候选、按透明度叠加并手动缩放/平移参考图片、按时间浏览历史快照、全历史相邻版本变化计数及详情、任意历史基线载入、唯一资源 ID 属性及祖先变化对比、共同唯一直接父节点下唯一子节点的相对顺序变化、重复 ID 的有限祖先范围候选匹配、对比 JSON 报告、节点定位、标签与零尺寸待核对线索；两份 XML 导入界面验证 | View/Compose 检查运行时、全量差异可视化和完整无障碍节点身份匹配 |
| CPU | 进程 CPU 使用率；simpleperf 采集后下载并自动载入、perf.data 导入、本机采样档案与完整性校验、本机 symfs 符号目录、可钻取调用树及相对权重条、热点反向调用方、火焰图、线程及时间联合筛选、采样点时间线、未知函数及无调用方样本统计、按事件类型重新解析及按 PID/TID 查询追踪线程状态；调用树与时间线包含当前采样函数；macOS 内置 simpleperf（仍需 Python 3）；调试应用真机验证通过，官方多事件及匹配 ELF 样本、线程筛选、符号目录、档案及模拟采集界面验证通过 | 真机多事件采集、采样与追踪的时钟及生命周期对齐、其他系统工具链 |
| 内存 | PSS/RSS 快照；HPROF 采集后自动分析并保留原文件、类统计、实例字段与对象及原始类型数组分页、旧版和 ART 转储字符串预览、内容搜索及重复内容分组、反向引用来源、候选根路径、按类对比、可排除已识别非强引用的近似支配图及 Bitmap Java 字段、数组引用、重复缓冲区及已销毁 Activity 候选；Perfetto heapprofd Native malloc 与 API 31+ ART 分配采样、采集后 Trace Processor 调用点汇总及原始追踪下载；公开 Android 旧版及 Android 8 堆样本验证；API 25 真机 Compose 应用采集 15.4 MiB 堆并分析 196,210 条记录 / 2,983 类，验证 String 实例分页、对象字段、引用来源、Bitmap/重复内容/Activity 查询及 203,329 节点近似支配图；heapprofd API 与配置模拟测试、真实 Trace Processor 空样本查询、API 25 页面能力门控 | heapprofd 尚未在支持的真实 Android 设备采集验证；Native 需 API 29+，ART 采样需 API 31+，目标须符合系统 debuggable/profileable 限制；独立命名子进程需单独配置；超过 25 万节点的大快照完整支配图、更大快照完整索引、更多字符串布局、完整引用语义、精确保留大小、更完整泄漏判定、Bitmap 原生像素与原生堆；更多设备和 Android 版本验证 |
| 系统追踪 | Perfetto 录制（可选目标应用 ATrace）、Trace Processor 离线导入、本机档案及完整性校验、原始文件导出、本机自托管 Perfetto v59.1 全量交互界面（本地 iframe 与追踪导入已浏览器验证）、切片/调度汇总、按嵌套深度分行的有限时间线、切片名称查询与事件参数、线程状态汇总、Binder 事务按应用和方向筛选、两端耗时、同步事务阶段分解及跳转；公开 Android 追踪和合成追踪验证 | 本机真实 Perfetto 设备验证、更高容量、嵌入式 UI 查询/分享等完整操作的逐项自动化验证、深入 Binder/图形诊断 |
| 帧 | gfxinfo framestats 逐帧分析与超预算分组；旧版 gfxinfo 直方图回退，优先保留设备报告分位数，无逐帧数据时明确估算和精度边界；FrameTimeline 显式录制、预期/实际唯一匹配、同轨道 deadline-miss 分组、帧所属进程同期线程状态、状态区间及追踪跳转；官方 Android 12 样本、接口及界面验证；API 25 真实设备读取并在界面核验 framestats | FrameTimeline 受 API 25 限制无法在此设备验证、更深入的关联布局与追踪 |
| 启动 | 冷温热实验、TotalTime、实验前后及独立 Dexopt 编译状态、单个已分析 APK 的 Baseline Profile 文件、头部版本与 010 DEX 记录校验值及方法标记统计；Perfetto 官方 Android 12 追踪与 AndroidX 官方 Profile 样本验证 | 本机设备 TTID/TTFD 及阶段采集验证、真实设备与更多 Android 版本兼容验证、Profile 与设备安装生效验证 |
| 电池 | batterystats UID 网络、唤醒锁、唤醒闹钟、作业、同步和传感器累计值、可用时展示系统 UID mAh 估计、双快照资源计数差值、可停止的 2–50 次间隔采样、样本时间线、实验归档及 JSON 报告导出、Battery Historian 原始 checkin 导入与导出、历史快照载入；API 25 真机双样本采集、归档回读及 JSON 导出验证 | 更多 Android 版本验证、设备差异和能耗估计校验、设备当前 checkin 导出与历史原文件的区别说明 |
| 网络 | HAR 离线分析、请求活动时间线、域名级连接、TLS、等待和读取阶段汇总、按方法与域名路径的 P50/P95 统计；OkHttp 监听器、源码下载、按 UID 轮询 logcat，新版请求标识去重累积、旧版快照兼容；真实 JVM 请求、模拟 ADB、连续读取、HAR 统计及保存界面验证 | Android 真机、系统权限及真实应用接入验证、独立依赖发布 |
| GPU | 本机产物索引、SHA-256 完整性校验、追踪分析交接，桌面端选择与启动 AGI、校验后交接帧捕获、读取设备声明的 Vulkan/OpenGL ES 能力；复制与模拟 ADB 验证 | AGI 实际打开产物、真机捕获、兼容性与完整关联验证 |
| Benchmark | AndroidX JSON 参数与指标类型匹配、重复标识保护、设备及运行环境差异提示、预热与重复次数和热降频等待信息、样本分布、sampledMetrics 迭代分组、历史运行和 JSON 报告；已安装的 benchmark instrumentation 运行、输出和按用户指定路径读取设备报告，AndroidX 官方 Macro/Micro 报告和模拟 ADB 验证 | 真机 benchmark 执行、自动获取和校验本次结果及追踪、独立实验级统计检验及不确定性分析、完整 Macrobenchmark 编排 |
| 源码工作区 | 本地及 GitHub/AOSP 只读快照、提交标识、校验、文本检索和查看，CPU 和布局类的 Java/Kotlin 声明候选关联；公开仓库及 API 验证，本地服务界面验证创建快照、声明定位及上下文查看 | 原生桌面界面与目录选择验证、更多远程版本与网络环境验证、精确符号解析和更多证据关联 |
| 界面与发布 | 中文；系统/浅色/深色主题、90–120% 界面缩放并保存到 Electron 本机配置；macOS arm64 已验证 | 英文、Windows/Linux 和 macOS x64 安装包验证 |
| APK | 分析单个 APK | 保留现有功能 |

各模块应基于真实证据展示可用性；设备权限、Android 版本或工具缺失时明确提示，不伪造数据。完整 Compose、网络采集与能耗归因需满足目标应用和设备的具体条件。
