# 功能完整性检查

检查日期：2026-11-09。范围为当前工作区的 macOS ARM64 和 Windows x64 桌面代码，包括 16 个页面、后端接口、工具准备、数据保存和导出。不连接 Android 设备，不创建 Release 或上传构建产物。

后续已按用户要求完成 Android 7.1.2 真机采集，见 [真机采集报告](DEVICE_TEST_20261109.md)。本报告下文保留此前完整性审计的范围与结果。

## 结论

主要采集入口、离线分析和记录导出已有实现，macOS 的自动回归通过。**Windows 已补平台适配和安装验证流程，但尚未实际在 Windows 主机完成安装与功能验收，不能按“Windows 全部验证完成”交付。** 新 Android 系统能力及应用内 Agent 也有未完成的真机验证。

## 本次发现并修复

| 问题 | 影响 | 修复与证据 |
| --- | --- | --- |
| Native 符号目录只接受 `/` 开头的路径 | Windows 的盘符路径会被拒绝，无法定位 Native 源码行 | 改用宿主系统的绝对路径判断；新增最小合法 ELF 集成回归，校验 Build ID 后才调用 LLVM |
| macOS ARM64 工具脚本只查 `darwin-arm64` | NDK 使用 `darwin-x86_64` 目录分发通用工具时，准备和 smoke 会失败 | 恢复宿主目录回退；以本机 NDK 27.1 实际准备并编译 Android ELF，通过 DWARF 源码行检查 |
| Windows LLVM 仅复制两个 EXE | 源目录有依赖 DLL 时，安装后的工具可能无法启动 | 一并复制宿主 DLL，并在复制后重新启动工具校验；Windows 安装 smoke 额外检查 LLVM 和 C++ 解码 |
| 部分 NDK 的 C++ 解码器默认剥掉前导下划线 | Android ELF 的 `_Z…` 符号无法还原，源码候选匹配失败 | 显式传入 `--no-strip-underscore`；实际 LLVM 解码及源码回归通过 |
| Compose Inspector 仅校验 JAR，不确认指定 Java 程序存在 | Java 缺失时状态仍显示可用，执行后才失败 | 增加指定 Java 路径检查，补缺失运行时回归；Windows 服务默认路径补齐 `.exe` |
| 干净 CI 在准备工具前运行依赖测试 | 首次运行缺少解析器、Inspector 或 Shark 资源时会失败 | macOS / Windows 均先准备所需工具，再测试和打包；实际 Windows runner 仍待执行 |
| 测试直接使用文件 URL 的 pathname | Windows 下会出现 `/C:/…` 等无效本机路径，部分运行时还遗漏 `.exe` | 改用 `fileURLToPath`，并根据平台选择 Java 和 LLVM 文件名 |

## 页面覆盖情况

“已实现”表示存在实际处理与数据流，不表示每种 Android 版本、厂商设备或每个 Windows 环境均已验证。

| 页面 | 已实现能力 | 验证范围与限制 |
| --- | --- | --- |
| 概览 | 设备/应用选择、当前摘要、模块快捷入口 | 导航和渲染回归；设备验证沿用已有历史记录 |
| 实时监控 | CPU、PSS/RSS、内存组成、电池快照 | 解析和接口回归；权限不足时有回退或缺失状态 |
| CPU 采样 | simpleperf、调用树、火焰图、时间筛选、ART 方法跟踪、符号解析 | 自动回归、合成数据及真实 ELF 检查；真实 ART 文件变体、设备采样取消仍需更多验证 |
| 帧耗时分析 | gfxinfo、超预算帧、FrameTimeline、JankStats 关联 | 解析与合成 Trace Processor 回归；Android 12+ 真实 FrameTimeline/Agent 联动待验证 |
| 启动测试 | 冷温热、多轮统计、编译模式、实验对比、导出、可选里程碑 | 回归及历史旧设备记录；新系统 TTID/TTFD 与 Agent 的设备兼容性待验证 |
| 电池与资源 | batterystats、UID 资源、重复采样、差值、checkin 导出 | 解析/窗口一致性回归；mAh/ODPM 是系统估算，依赖设备提供数据 |
| GPU 产物 | 文件索引/校验、AGI 交接、追踪 GPU 证据 | 合成 GPU 追踪与交接桩验证；没有真实 AGI/驱动捕获验收，工具内没有 GPU 帧捕获器 |
| 堆转储 | 对象/引用/根路径/支配图、快照对比、Bitmap、Shark、分配分析 | 自动回归、已有 HPROF 和历史设备记录；Native/ART heapprofd 新设备采集待验证 |
| 布局检查 | View/Compose、截图、差异、检查器、编译报告、Probe | 自动回归和部分历史 Agent 记录；完整 Inspector API 29+ 真机、不同 Compose 版本兼容性待验证 |
| 系统追踪 | 采集/导入、Perfetto UI、SQL、Binder、线程/启动/GPU 证据 | Trace Processor 合成及可选真实样本测试；缺少设备事件时无法生成对应分析 |
| 网络分析 | HAR、OkHttp Agent、时间线/筛选、脱敏导出、UID 流量 | 解析/接口及宿主 JVM loopback；新版 Agent socket 的 Android 端完整链路待验证 |
| 基准对比 | 报告/阈值/历史比较、instrumentation 和 Macrobenchmark 工程运行 | 模拟工程与报告回归；目标工程必须读取传入参数，Baseline Profile 不由工具自动安装 |
| APK 分析 | 包信息、Manifest、权限、组件、DEX、ABI、体积、证书结构 | APK 自动回归和桌面导入记录；不验证签名密码学完整性，不合并 split APK |
| 源码工作区 | 快照、检索、声明候选、mapping、Build ID/DWARF 行 | 文件/符号回归及真实 ELF 检查；候选匹配不证明对应目标构建 |
| 采集记录 | 保存、导入导出、回放、档案校验 | 本地 HTTP 与持久化回归；大文件有明确上限 |
| 设置与帮助 | 中英文、主题、缩放、本机偏好和菜单 | 自动回归及 macOS 桌面检查；Windows 原生交互待验收 |

## 尚未实现或尚未验收

- **Windows 原生验收**：需要执行新增 Windows workflow 的工具准备、MSI/NSIS 安装、启动和页面操作；当前结果不能替代 Windows 主机验证。
- **Android 新能力的真机验收**：FrameTimeline、完整 Compose Inspector、Native/ART heapprofd、新网络 socket Agent，以及真实 GPU 轨道，仍有支持设备上的端到端验证缺口。遵照当前要求，本次不操作真实设备。
- **Compose 因果分析**：有 State 关联和执行事件的时间线索，尚不能证明某次 State 修改导致某次重组或卡顿。
- **无应用集成的请求明细**：系统 UID 流量只能提供字节数；请求级明细需要 HAR 或目标应用接入 Agent。
- **GPU 与能耗边界**：AGI 捕获在外部完成；应用能耗依赖系统支持，不能从硬件轨道推导精确应用耗电。
- **AI 分析**：按当前约定暂不实现。发布和安装包上传也不在范围内。

## 本次验证

- 全量自动测试：476 项，459 通过、17 个可选 Android 样本未配置而跳过、0 失败。
- 修复后源码/Native/Inspector/桌面配置定向回归 28 项通过。
- `npm run check` 和 `git diff --check` 通过。
- 实际 NDK 27.1 编译 Android AArch64 ELF，验证 Build ID、DWARF 文件/行号、C++ 名称解码及错误 Build ID 拒绝路径，通过。
- macOS ARM64 桌面重建与实际启动检查通过：16 个页面、中英文界面路径、APK 导入/保存/回放、HPROF CSV/Markdown/JSON 与支配图、heapprofd 区间切换、网络脱敏导出、Perfetto 查询/报告与嵌入式 CSV 导入、源码检索/C++ 定位、Agent 源码包和启动报告。50,000 CPU 合成样本的图表与深栈操作也通过。AGI 使用桩程序；ADB 使用只返回空列表的桩，未连接真实设备。
- Windows MSI/NSIS 原生安装检查：尚未运行。

自动测试中，本机 HTTP 回归需要允许监听 `127.0.0.1`。首次受限沙盒运行因 `listen EPERM` 失败，允许本机回环监听后重跑通过；该失败不记为功能通过，也不当作产品故障。
