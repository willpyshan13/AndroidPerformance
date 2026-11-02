# 应用内 View 布局 Agent（仅 Debug）

这个源码 Agent 在目标应用进程内读取当前 Activity 的 Android View 树、可用的 Compose 合并/未合并 Semantics 树和应用窗口截图。桌面端通过 ADB 临时转发 Android 本机抽象 socket 请求采集，结束后立即移除转发。它不声明 INTERNET 权限，也不上传数据。

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
- Compose `Password` 节点会隐藏文本和内容描述；`EditableText` 仅标记为可编辑，不输出其内容。该 Semantics 树不是 Composable 调用树，不提供 State Reads 或运行时重组次数。官方重组计数还受 Compose 版本与 Android API 版本限制。
- 特殊 Surface、视频、硬件合成层可能无法通过 `View.draw` 完整捕获。设备旋转、动画或窗口切换期间，快照可能不稳定。
