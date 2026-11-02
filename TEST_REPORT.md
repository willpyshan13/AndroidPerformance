# 当前验证记录（2026-11-02）

## 布局时间线增量

- 完整 `npm test`：178 项，163 通过、0 失败、15 项因未配置外部官方样本而跳过。
- `npm run check` 和 `git diff --check`：通过。
- 布局历史页新增全量相邻版本摘要及差异载入；摘要接口只传递 XML，不传截图。新增的计数纯函数和轻量历史接口测试通过。差异精度和 UIAutomator 覆盖范围与下方限制相同。

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

启动数值只证明该设备接受并完成启动命令，不证明冷/温/热请求实际对应系统判定的启动模式：设备没有返回 LaunchState。设备也不支持 Perfetto，因此此处没有验证真实 FrameTimeline、TTID/TTFD、trace 或线程关联。内存、CPU profiling、HPROF、GPU、实时网络和设备能耗归因没有纳入本次真机 smoke；它们仍由自动化/离线样本覆盖或等待兼容设备验证。

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
