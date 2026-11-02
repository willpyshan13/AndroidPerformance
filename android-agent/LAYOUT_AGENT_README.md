# 应用内 View 布局 Agent（仅 Debug）

这个 debug 源码包包含 Android View Agent、可选的 Compose Semantics 读取、手动 probe 和一个可选的 Compose 编译器插件。View Agent 在目标应用进程内读取当前 Activity 的 Android View 树、可用的 Compose 合并/未合并 Semantics 树和应用窗口截图；桌面端通过 ADB 临时转发 Android 本机抽象 socket 请求采集，结束后移除转发。它不声明 INTERNET 权限，也不上传数据。

## 接入

1. 在桌面端“布局检查”页生成令牌并复制。
2. 将 `src/main/java/dev/androidperformance/agent/LayoutAgent.java` 放入目标应用模块的 `src/debug/java/dev/androidperformance/agent/`。
3. 只在目标应用模块的 debug 构建配置中写入相同令牌：

```kotlin
android {
    buildTypes {
        debug {
            buildConfigField("String", "APW_LAYOUT_AGENT_TOKEN", "\"替换为桌面端生成的令牌\"")
        }
    }
}
```

4. 在目标 Activity 的生命周期中启动和停用当前采集目标：

```java
import dev.androidperformance.agent.LayoutAgent;

@Override protected void onResume() {
    super.onResume();
    LayoutAgent.start(this, BuildConfig.APW_LAYOUT_AGENT_TOKEN);
}

@Override protected void onPause() {
    LayoutAgent.stop(this);
    super.onPause();
}
```

重新构建并安装 debug APK。在桌面端选择同一设备和包名、粘贴同一令牌，再点“Agent 采集”。采集失败时可使用“UIAutomator 回退”。

## 能力与限制

- 输出当前窗口中的 View 节点、类名、资源 ID、非密码文本、可交互状态、可见性、透明度和相对应用窗口的 bounds。识别为密码输入的文本及内容描述会清空，并仅标记 `password=true`。最多 10,000 节点、100 层深；截断状态会单独标记。
- 截图由应用 View 树在 UI 线程绘制，与返回的 bounds 使用同一窗口坐标。`FLAG_SECURE` 窗口不返回截图；超过 5,000 万像素的窗口也跳过截图。
- 这是 debug-only 诊断源码。不要将令牌或 Agent 放进 release 构建。令牌以明文存在 debug APK 中，不构成对有设备调试权限者的安全边界。
- 遇到 Compose `AndroidComposeView` 时，Agent 通过可选反射读取 merged 与 unmerged Semantics 节点，转换为 `ComposeSemanticsRoot` / `ComposeSemanticsNode` 并保留 bounds、文本、角色、TestTag、点击和选中等状态；Compose 依赖不是本 Agent 的编译依赖。不同 Compose 版本的运行时接口可能变化，读取失败会返回兼容性警告，Android View 树仍保留。
- Compose `Password` 节点会隐藏文本和内容描述；`EditableText` 仅标记为可编辑，不输出其内容。Agent 还会读取 Compose `CompositionData` 组合组层级，并按 `RecomposeScope` 统计每个组关联的已观察 State 数量；它不读取 State 值，也不等于完整 Composable 函数调用树。组合组源码标签依赖目标 Composer 是否启用了 source markers，可能为空；Agent 不会强制重组以触发应用副作用。State 观察接口不可用时会明确显示“不可用”，不会显示为零。该路径反射 Compose 私有运行时接口，接口不兼容时会显示警告。运行时执行/跳过次数与聚合父子调用树由可选编译器插件提供。
- 若要自动统计目标模块内 Composable 函数体执行次数和 Composer 跳过次数，可将 ZIP 中的 `ApwComposeAutomaticProbe.kt` 放入目标模块 `src/debug/kotlin/dev/androidperformance/agent/`。在 `compose-compiler-plugin/` 目录运行 `gradle jar` 构建插件，再在目标模块编译参数中启用它。插件当前针对 Kotlin 2.2.21 编译器 API 构建，目标 Kotlin 编译器版本需要匹配；插件编译期不依赖 Compose API：

```kotlin
android {
    kotlinOptions {
        freeCompilerArgs += "-Xplugin=/绝对路径/compose-compiler-plugin/build/libs/apw-compose-compiler-plugin.jar"
    }
}
```

插件只处理当前目标模块编译出的 `@Composable` 函数：在正常分支记录函数体执行，在 `Composer.skipToGroupEnd` 分支记录跳过；执行数包含首次组合。函数标识来自包名和函数名，不包含参数值。新版事件包含父函数和累计边计数，桌面端可构建 Logcat 窗口内的聚合调用树；环形缓冲区可能截断树，且自动模式无法区分同名函数的多个运行时实例。每次执行或跳过都会写一条 Logcat 事件，可能增加调试开销。它只覆盖应用本次编译的 Kotlin Composable，不会自动插桩依赖库或其他未重编译的 APK 代码。

- 如果要观测选定 Composable 的 SideEffect 提交次数和独立实例，可将 ZIP 中的 `ApwComposeRecompositionProbe.kt` 放入目标模块 `src/debug/kotlin/dev/androidperformance/agent/`，并在目标函数体内调用。probe 标记为不可跳过，以便父 Composable 每次重新执行时都能记录：

```kotlin
import dev.androidperformance.agent.ApwComposeRecompositionProbe

@Composable
fun FeedScreen() {
    if (BuildConfig.DEBUG) ApwComposeRecompositionProbe("FeedScreen")
    // screen content
}
```

- 布局页“Compose 运行时重组观测”按钮从目标包主进程 PID 的 main Logcat 缓冲区读取两种记录：自动模式分别显示函数体执行与 Composer 跳过次数，手动 probe 显示 `SideEffect` 成功提交次数和实例数。两者定义不同，执行数包含首次组合；目标应用的独立子进程不在此快照范围。Logcat 是环形缓冲区，历史事件可能被覆盖；自动模式每次执行或跳过都会写日志，正式性能测量前应关闭或移除。
- 手动 probe 记录只包含自定义名称、随机实例 ID、计数和设备单调时钟；自动记录只包含函数名和设备单调时钟，不写入参数值或状态内容。仅将运行时源码和编译器参数配置到 debug 构建，不能用于 release。
- 特殊 Surface、视频、硬件合成层可能无法通过 `View.draw` 完整捕获。设备旋转、动画或窗口切换期间，快照可能不稳定。
