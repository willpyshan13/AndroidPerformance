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

安装包内置运行环境、Google 官方 ADB 和 AAPT2，无需另外安装 Node.js 或启动浏览器。也可以通过菜单 **文件 → 选择 ADB 程序…** 使用自己的 ADB；显式设置的 `ADB_PATH` 优先于自动检测。

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
| 帧耗时 | 查看逐帧图、百分位数和不同刷新率预算；支持重置及离线导入 | `dumpsys gfxinfo framestats` |
| 启动测试 | 重复冷、温、热启动，查看耗时、请求和观察到的启动模式 | `am start -W` |
| 布局检查 | 查看截图、层级和节点属性；支持导入 XML | UIAutomator |
| 系统追踪 | 采集 5–30 秒追踪并下载原始文件 | Perfetto，32 MB 缓冲区 |
| 网络分析 | 筛选请求并查看状态、大小和耗时 | 本地导入标准 HAR |
| 基准对比 | 比较同名指标的中位数与相对变化 | AndroidX Benchmark JSON |
| APK 分析 | 查看包信息、权限、组件、文件大小、DEX、原生库、证书和 Manifest | 本地 APK、AAPT2 |
| 采集记录 | 保存、回放及导入导出 JSON 报告 | 本地记录 |

桌面版提供原生文件选择、菜单和快捷键。`⌘/Ctrl+1…9` 切换分析模块，`⌘/Ctrl+O` 打开采集记录，`⌘/Ctrl+,` 打开帮助。

## 从源码运行

需要 Node.js 22+。桌面版依赖 Electron 45.1.0 和 electron-builder 26.18.0，版本由锁文件固定。

```sh
npm ci
npm run prepare:adb        # 准备 macOS 官方 ADB，打包前需要
npm run prepare:apk-tools  # 从本机 Android SDK 准备 AAPT2
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

- 安装版记录位于系统应用数据目录的 `records/`；可从菜单 **文件 → 打开记录目录** 查看。源码桌面模式使用 `data/desktop-profile/records/`，浏览器模式使用 `data/`。
- 不调用 AI，也不自动上传采集文件。HAR 导入会丢弃查询参数、凭据、Headers、Cookies 和正文；路径与布局快照仍可能包含业务内容，保存前请按需检查。
- 界面通过仅监听 `127.0.0.1` 的服务与后端通信，并检查 Host、Origin 和启动时生成的访问令牌。Electron 渲染进程启用 sandbox 与 context isolation。
- 实时采样最多保存 1,800 条，图表显示最近 120 条。APK 上传上限为 512 MiB、50,000 个文件、8 GiB 解压后总大小；其他导入文件和记录请求上限为 12 MB。布局 XML 上限为 2 MB / 10,000 节点；HAR 上限为 50,000 个请求，表格最多显示 1,000 个匹配请求。
- 导入文件中声明的来源属于元数据，不能作为真实性鉴定。

## 结果解读与范围

- **CPU 和内存**：CPU 优先根据相邻 `/proc` 计数器计算主进程利用率，单核为 100%；首个样本、进程重启或在线 CPU 数变化时需要重新建立基线。权限不足时回退到 `cpuinfo` 的应用及子进程窗口，超过 30 秒未更新则显示不可用。内存为主进程快照；电池信息不代表应用耗电量。
- **帧与启动**：gfxinfo 历史缓冲区与平台累计 janky frames 的范围可能不同；超过自选预算不等同于平台 Jank。启动 TotalTime 不等同于 TTFD，温 / 热启动的实际状态以设备返回的 LaunchState 为准。冷启动会 force-stop 目标应用；帧分析建议先重置统计、重现操作，再读取数据。
- **布局与基准**：UIAutomator 提供可访问性层级，不是完整 View / Compose 树；截图与层级顺序采集，动画期间可能不一致。Benchmark 变化是描述性比较，不是显著性检验。
- **APK**：一次分析一个 APK；split APK 的结果只涵盖导入的文件。证书页面展示签名结构和证书信息，**不验证签名完整性或证书信任链**。

尚未实现 simpleperf 火焰图、HPROF 堆与泄漏分析、完整 Compose Inspector、应用级能耗归因、网络实时 Agent，以及内置 Perfetto Trace Processor / SQL。

## 验证记录

自动测试覆盖 ADB 参数安全、采集解析、APK 解析与上传、记录校验、本地 HTTP 访问限制及持久化。`fixtures/` 提供可离线导入的合成样例。

| 验证 | 结果 | 详情 |
| --- | --- | --- |
| 自动测试 | 34 项通过 | `npm test` |
| 设备采集 | rk3399-all（Android 7.1.2 / API 25）：15 项通过，1 项因设备不支持 Perfetto 未通过 | [真机测试记录](TEST_REPORT.md) |
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
