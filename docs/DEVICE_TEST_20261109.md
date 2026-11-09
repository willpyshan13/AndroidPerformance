# Android 7.1.2 真机采集测试

日期：2026-11-09。设备为用户已连接的 rk3399-all，Android 7.1.2 / API 25 / arm64-v8a。主目标为已安装且允许调试的 `com.xmotion.sui.debug`，版本 1.0.10.90；ART 交叉验证使用已安装的 `com.will.calendar.demo`。

## 实际结果

| 采集项目 | 结果 | 本次数据 |
| --- | --- | --- |
| 设备、应用发现与启动 | 通过 | 正确识别设备和已安装目标；目标为 debuggable |
| 实时 CPU / 内存 | 通过 | 3 次 PSS 约 168.5–168.6 MiB；建立基线后 CPU 为 4.68%、2.89%，范围为主进程 |
| simpleperf 事件枚举 | 通过 | 返回 1,092 个事件；设备报告 trace-offcpu 支持，本次未采集 off-CPU |
| simpleperf 采集与解析 | 活动窗口通过 | 8 秒、99 Hz、`cpu-clock:u`、FP 展开；193,354 字节，310 个真实样本、291 个符号、142 条折叠栈；时间线和原文件归档回读通过 |
| HPROF 与对象图 | 通过 | 原文件 62,594,096 字节；186,351 条对象/数组记录、3,514 类；支配图索引 195,005 个对象，173,850 可达、469,470 条引用边，未截断 |
| Shark 2.14 | 通过 | 真实 HPROF 分析成功；报告已保存。不把“分析成功”解释为“不存在泄漏” |
| ART 方法跟踪 | 部分通过 | 日历演示应用：真实标准 v3 trace，2,374 字节、26 个事件、23 个方法、14 个线程；主目标应用仍返回空文件 |
| gfxinfo 帧数据 | 通过 | 初次 2 帧；页面活动补测读到 8 帧；原始文本导入一致。窗口主要包含启动/恢复，不能据此评价日常流畅度 |
| 布局与截图 | 通过 | 112 个 UIAutomator 节点，292,022 字节 PNG；仅为可访问性层级，不是完整 Compose Inspector |
| 电池与资源 | 通过 | UID 10051、2 条唤醒锁，保存快照和 21,809 字节 checkin；mAh 为 since-charged 系统累计估算，不是本次测试耗电 |
| 冷 / 温 / 热启动 | 通过 | 两轮均值分别为 1,777 / 1,096.5 / 404 ms；系统未提供 LaunchState，保留未知，不把 TotalTime 当作 TTFD |
| GPU 能力查询 | 通过 | OpenGL ES 3.2，Vulkan 未报告；没有进行 GPU 帧捕获 |
| 编译状态 | 无有效数据 | 命令调用完成，但系统没有返回可识别的目标编译状态；未修改 ART 编译模式 |
| 记录与原始采样归档 | 通过 | 保存与回读校验通过；CPU 原始文件按字节相等比较 |
| Perfetto | 不支持 | 设备没有 `perfetto` 可执行程序；不宣称系统追踪录制通过 |

本次未测试 Android 10+/12+/15+ 专属能力，也没有将离线 HAR / Benchmark 合成夹具回归当成真机网络采集或真实 Macrobenchmark 执行。未向目标应用注入新版 Agent，未测试请求级网络 socket 采集。

## 发现的问题和复测

1. 修复采集脚本缺少 `--only` 参数时误读第一个参数的问题，并补充原始 HPROF、Shark、battery/checkin 和 ART 文件保存。
2. 初次 3 秒静止 simpleperf 文件有效，但没有可解析样本。补测通过 Home / 恢复应用制造可重复的页面活动，得到 310 个真实样本。该补测是采集链路测试，不是常规使用性能基准。
3. ART 采集校验原来仅接受 `SLOW` 开头的 streaming 文件，错误拒绝 Android 7 常见的 `*version … *end` 文本头格式。修复后增加 LF/CRLF 回归，并成功解析日历演示应用实际生成的标准 v3 文件。
4. `com.xmotion.sui.debug` 的 ART 追踪仍为空；直接通过 ADB 测试采样式及插桩式也得到空文件。日历应用能采集，说明不能将此问题归结为“Android 7 全部不支持”；目标应用与厂商 runtime 的具体原因尚未确定。此项保留为未通过。

初轮报告为 24 通过、2 不支持、1 失败；其中包含两项明确的离线夹具回归。profiling 补测为 7 通过、1 失败、19 项因 `--only profiling` 跳过。两份报告保留原始结果，不将后续修复覆盖为初轮全部成功。日历 ART 交叉验证另存结果。

## 本机产物和清理

- 主测试目录：`data/device-test-20261109-android71/`，包含 `report.json`、`heap.hprof`、`heap-analysis.json`、`heap-shark.json`、`monitor.json`、`gfxinfo.txt`、`layout.xml`、`screen.png`、电池文件、逐模式启动报告和本地记录。
- profiling 补测：`data/device-test-20261109-android71-profiling/`，包含有效 `cpu.perf.data`、`cpu-analysis.json`、归档记录、`calendar-art.trace` 和 `calendar-art.json`。
- 原始数据位于忽略提交的 `data/`，没有上传。测试未安装、卸载或清除应用数据。
- 已停止 debug profiler、清理本轮诊断临时文件，并确认恢复测试前的 `com.xmotion/.sui.home.ui.activity.HomeActivity`。
- 修复后自动回归：477 项，460 通过、17 个可选样本跳过、0 失败；ART/CPU 定向回归 37 项通过。
