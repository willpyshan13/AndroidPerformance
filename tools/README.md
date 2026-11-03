# Android Platform Tools

macOS 构建使用 Google 官方 Platform Tools 中的 `adb`，连同 `NOTICE.txt` 和 `source.properties` 放入应用资源目录。`adb` 本身只链接 macOS 系统库。

准备资源：

```sh
npm run prepare:adb
```

来源：[Google Platform Tools](https://developer.android.com/tools/releases/platform-tools)，下载地址 `https://dl.google.com/android/repository/platform-tools-latest-darwin.zip`。

2026-10-30 验证版本：37.0.1-15733141。

- 下载 ZIP SHA-256：`ee39ad5967e95c2a07f04dbcbde96b1a0c916ba376096db5d2f498b7727a5d1d`
- 解压后 adb SHA-256：`1811e253b21b12cbfda7201ebaf86c10e7ddcb5c606a7a81f7c82b4c429c2d3b`

脚本固定校验上面的 ZIP SHA-256；官方更新 latest 后须先核对新包并更新脚本中的校验值，校验失败不会覆盖已有资源。本机曾出现同一 ADB 文件签名校验失败及被系统强制终止，随后又校验通过，原因尚未确定。在确认来源及 ZIP 校验值后，可以执行 `APW_ADHOC_ADB=1 npm run prepare:adb`，当原始签名校验失败时仅对下载副本做本机 ad-hoc 签名。该签名不证明 Google 原始签名有效，也不提供发布者身份认证。项目不修改用户原 SDK 中的任何文件。`platform-tools/` 是下载资源，不提交到源码库；分发时保留 Google 提供的 NOTICE。

## simpleperf

打包前执行 `npm run prepare:simpleperf`，从本机 Android NDK 复制 simpleperf、报告库及 NOTICE，并下载经 SHA-256 校验的 Python 3.11.18 standalone 运行时。需要稳定版 NDK；Android 7 兼容设备二进制已随仓库提供，可通过 `SIMPLEPERF_NDK` 和 `SIMPLEPERF_LEGACY_NDK` 指定 NDK 目录。资源位于忽略提交的 `tools/simpleperf/`，打包时保留上游许可证。安装包内置 Python，不要求用户另行安装；开发源码可用 `APW_PYTHON_PATH` 覆盖。

## Perfetto Trace Processor

macOS arm64 运行 `npm run prepare:trace-processor` 从 Perfetto 官方地址下载固定 v59.1 二进制并验证 SHA-256，同时保存 Apache 2.0 许可证。文件位于忽略提交的 `tools/trace-processor/`，打包时保留版本来源及许可证。其他平台可通过 `TRACE_PROCESSOR_PATH` 配置兼容的 Trace Processor，尚未验证。

## Perfetto UI

运行 `npm run prepare:perfetto-ui` 下载官方 Perfetto v59.1 可自托管 UI。准备脚本会校验固定 SHA-256、限制 ZIP 路径与解压大小，并保存 Apache-2.0 许可证。应用从本机服务提供静态资源，通过 Perfetto 同源嵌入接口载入追踪；追踪不会发送到 `ui.perfetto.dev`。

## LeakCanary Shark

桌面打包前运行 `npm run prepare:shark`。脚本下载 Square LeakCanary 2.14 官方 Shark CLI 发布包，固定校验归档 SHA-256，只保留 Android HPROF 分析需要的核心 JAR，并保存 Apache-2.0 / BSD-2-Clause 许可证及来源信息，同时准备 Eclipse Temurin Java 17 runtime。macOS 与 Linux 常见架构使用固定版本和 SHA-256 的 Temurin JRE；其他平台可通过 `JAVA_HOME` 使用 Java 17 或更新版本。资源写入忽略提交的 `tools/shark-cli/` 和 `tools/java-runtime/`，由桌面安装包带上。首次下载需要网络访问。

Shark 在本地分析当前 HPROF 会话，不上传堆文件。报告由 LeakCanary Shark 生成，包含其 Android reference matcher、object inspector、leak signature 和 retained-size 分析。独立的 `KeyedWeakReference` 路径候选是本工具的辅助查询，不能替代 Shark 报告。可通过界面载入 R8/ProGuard `.map` 或 `.txt` 文件（上限 128 MiB）；文件保存在当前 HPROF 私有临时会话中，并随会话清理。

## Compose UI Inspector

源码库内的 `tools/ui-inspector/` 包含 Android Studio UI Inspector CLI 的 Java runtime classpath，以及推送到设备端的 View/Compose Inspector、payload 和 ART tooling 资源。每个 JAR 的 SHA-256 和相对路径记录在 `classpath.json`，桌面安装包会携带这些资源。当前 CLI 字节码要求 Java 25；macOS arm64 打包会单独携带经过 SHA-256 校验的 Temurin JRE 25，Shark 和 Gradle 继续使用 Java 17。来源版本、最低 Java 版本、Bazel target 和 Apache-2.0 声明见 `source.json` 与 `NOTICE.txt`。

更新这组资源时，先在 Android Studio `platform/tools/base` checkout 构建 `//tools/base/ui-inspector/cli:dump-ui`，再指向生成的 runfiles 清单和 `cli.res.jar` 执行：

```sh
UI_INSPECTOR_RUNFILES_MANIFEST=/path/to/bazel-bin/tools/base/ui-inspector/cli/dump-ui.runfiles_manifest \
UI_INSPECTOR_RESOURCE_JAR=/path/to/bazel-bin/tools/base/ui-inspector/cli/cli.res.jar \
npm run prepare:ui-inspector
```

完整检查要求 Android 10（API 29）或更高版本及可注入的应用进程。默认读取参数、Modifier、Semantics 和系统 Composable；资源解析栈须单独启用，因为首次启用可能修改设备设置并重启 Activity。截图在检查器响应后采集，树节点与截图边界可相互高亮，源码位置可搜索当前快照。API 25 测试设备验证了安全拒绝路径；Android 35 模拟器用于 Inspector 运行时和 Compose fixture 验证，不替代 API 29+ 实体设备覆盖。
