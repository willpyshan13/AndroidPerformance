# OkHttp 网络事件采集组件

`NetworkEvents` 是应用主动接入的 OkHttp 4 事件监听器。每次调用在结束或失败时交付一条记录；默认仅包含协议、域名、端口、方法、最终已观察到的响应状态、时间和阶段耗时，不读取 URL 路径、查询参数、请求头或正文。Agent v5 同时保留 Unix 墙上时间与 `System.nanoTime()` 的 Android 单调时钟起点（十进制字符串，避免纳秒数转浮点丢精度）；前者用于人类时间显示，后者标记为 `android-monotonic`，可供同设备 Perfetto 时钟快照映射。单调值不是 epoch，不可直接与桌面时间或未映射的 trace 时间比较。连接复用状态来自 `connectionAcquired` 与 `connectStart` 的配对：新建连接后获取标作未复用，获取时没有对应的新连接事件标作复用；没有获取事件时保持未知，不从连接耗时缺失推断。若目标应用需要端点详情，可显式提供 `PathSanitizer`；它只接收 URL 的 encoded path，不会收到查询参数、请求头或正文。回调返回的路径会随 Agent 记录传给桌面端，因此必须在应用侧先脱敏；返回值超过 2,048 字符、包含 query/fragment 或控制字符时会被丢弃。DNS、连接和 TLS 在出现多个尝试时分别累加；TLS 是连接的一部分，不能相加。等待阶段从请求头或请求体发送结束到响应头开始；接收阶段是响应体读取开始到结束的经过时间，可能包括应用读取间隔，并非纯网络传输时间。重试、重定向或阶段不完整时这两项留空。状态为 0 表示尚未收到响应头，`failed` 才表示调用失败。响应字节是 OkHttp 报告的响应体读取字节之和，不保证等于线路字节。耗时使用单调时钟；重定向或重试发生时，记录属于整个调用而不是单个请求。

应用须在需要采集的构建中创建 `NetworkEvents.factory(sink)` 并通过 `OkHttpClient.Builder.eventListenerFactory(...)` 接入。每次调用使用独立监听器；配置会替换已有 EventListener factory，已有监听器需要由应用自行组合。sink 与 `PathSanitizer` 都在 OkHttp 回调线程运行，应快速返回并自行保护并发；不要执行磁盘、网络或其他阻塞操作。采集结束依赖响应体关闭或读取完成；未结束的调用不会产生记录。建议只在调试构建启用。

桌面端优先通过版本化的本机抽象 socket 协议读取：cursor 单调递增，Agent 在内存中保留最近 10,000 条请求事件，桌面端以 ADB 临时转发增量轮询；缓冲区溢出会返回丢失数量。协议逐次请求使用共享调试令牌校验。旧版 `LogcatSink` 仍可用作兼容模式，每 3 秒读取当前 UID 的最近日志，可能丢失、混入共享 UID 应用或包含启动前记录。

在桌面网络页面点击“生成令牌”，将生成值安全地配置到目标 app 的 debug 构建配置中；不要提交进源码仓库或用于 release。下载 Agent ZIP 并解压到 Android 工程根目录。Java 文件放在 `src/debug/java/`，只参与 debug source set；确保 debug 构建依赖 OkHttp 4。首选 socket 方式，在 debug Application 启动服务并在客户端构造代码中接入：

```kotlin
android {
  buildFeatures { buildConfig = true }
  buildTypes {
    debug {
      val token = providers.gradleProperty("apwNetworkToken").orElse("").get()
      buildConfigField("String", "APW_NETWORK_TOKEN", "\"$token\"")
    }
  }
}
```

通过本机安全的 Gradle 属性或环境注入 `apwNetworkToken`；不要把真实令牌写进 `gradle.properties` 并提交。

```java
NetworkAgentServer.start(getApplicationContext(), BuildConfig.APW_NETWORK_TOKEN);

OkHttpClient client = new OkHttpClient.Builder()
    .eventListenerFactory(NetworkEvents.factory(NetworkAgentServer.sink(), encodedPath -> {
      // Example: replace sensitive or dynamic segments using your API routes.
      return encodedPath.replaceAll("/users/[^/]+", "/users/{user}");
    }))
    .build();
```

`NetworkAgentServer.stop()` 可在 debug 网络采集不再需要时停止 socket 服务。令牌必须与桌面页面当前令牌一致；桌面端只在本机绑定 ADB forward，并在停止采集或关闭程序时移除转发。若不能在目标应用配置令牌，仍可使用兼容的 Logcat 模式：将 sink 改成 `new LogcatSink()`，并在桌面页面留空共享令牌。

若暂时没有可靠的路由脱敏规则，使用 `NetworkEvents.factory(new LogcatSink())` 保持默认不采集路径。不要原样返回可能含访问令牌、用户标识或其他敏感值的路径。

使用已有客户端时，基于它的 `newBuilder()` 配置，并注意该设置替换原来的 listener factory。选择设备与应用包名后在桌面网络页面开始读取，操作应用发出请求并关闭响应体。socket 模式会持续增量读取，请求没有 query/header/body；若启用了应用侧路径脱敏器，也会显示其返回路径。单次重定向详情仍不提供。

组件目前以源码接入，尚未发布独立依赖包。API 25 / rk3399-all 真机使用临时 OkHttp 4.12 debug 应用验证了本机 HTTP 请求、Logcat Agent 记录、桌面端 PID 回退读取和路径脱敏；这只证明已接入该 Agent 的 OkHttp 客户端，不会捕获未配置的客户端、WebView、Cronet 或原生 socket。设备日志权限、Android 版本和应用接入方式会影响可用性。
