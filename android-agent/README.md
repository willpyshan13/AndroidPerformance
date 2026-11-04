# OkHttp 网络事件采集组件

`NetworkEvents` 是应用主动接入的 OkHttp 4 事件监听器。每次调用在结束或失败时交付一条记录；默认仅包含协议、域名、端口、方法、最终已观察到的响应状态、时间和阶段耗时，不读取 URL 路径、查询参数、请求头或正文。若目标应用需要端点详情，可显式提供 `PathSanitizer`；它只接收 URL 的 encoded path，不会收到查询参数、请求头或正文。回调返回的路径会随 Agent 记录传给桌面端，因此必须在应用侧先脱敏；返回值超过 2,048 字符、包含 query/fragment 或控制字符时会被丢弃。DNS、连接和 TLS 在出现多个尝试时分别累加；TLS 是连接的一部分，不能相加。连接复用时阶段可能缺失。等待阶段从请求头或请求体发送结束到响应头开始；接收阶段是响应体读取开始到结束的经过时间，可能包括应用读取间隔，并非纯网络传输时间。重试、重定向或阶段不完整时这两项留空。状态为 0 表示尚未收到响应头，`failed` 才表示调用失败。响应字节是 OkHttp 报告的响应体读取字节之和，不保证等于线路字节。耗时使用单调时钟；重定向或重试发生时，记录属于整个调用而不是单个请求。

应用须在需要采集的构建中创建 `NetworkEvents.factory(sink)` 并通过 `OkHttpClient.Builder.eventListenerFactory(...)` 接入。每次调用使用独立监听器；配置会替换已有 EventListener factory，已有监听器需要由应用自行组合。sink 与 `PathSanitizer` 都在 OkHttp 回调线程运行，应快速返回并自行保护并发；不要执行磁盘、网络或其他阻塞操作。采集结束依赖响应体关闭或读取完成；未结束的调用不会产生记录。建议只在调试构建启用。

桌面端“开始 Agent 读取”每 3 秒通过 ADB 从当前用户的目标 UID 读取 `APWNetwork` 日志，取最近 10,000 条日志范围。新版记录带随机请求标识，桌面端在本次读取期间累积去重，最多保留 10,000 条；旧版记录没有标识，只显示最近快照。日志可能在读取前被覆盖或丢失，首次快照也可能包含启动前记录。共享 UID 的其他应用可能混入，设备需要允许 shell 读取目标日志并支持 `logcat --uid`。日志包含域名和方法等元数据，其他拥有日志读取权限的进程可能看到；不要在正式构建启用。

在桌面网络页面点击“下载 Agent 源码”，把 ZIP 解压到目标 Android 工程根目录。包内 Java 文件已放在 `src/debug/java/`，只参与 debug source set；确保 debug 构建依赖 OkHttp 4，然后在仅用于调试的客户端构造代码中接入：

```java
OkHttpClient client = new OkHttpClient.Builder()
    .eventListenerFactory(NetworkEvents.factory(new LogcatSink(), encodedPath -> {
      // Example: replace sensitive or dynamic segments using your API routes.
      return encodedPath.replaceAll("/users/[^/]+", "/users/{user}");
    }))
    .build();
```

若暂时没有可靠的路由脱敏规则，使用 `NetworkEvents.factory(new LogcatSink())` 保持默认不采集路径。不要原样返回可能含访问令牌、用户标识或其他敏感值的路径。

使用已有客户端时，基于它的 `newBuilder()` 配置，并注意该设置替换原来的 listener factory。选择设备与应用包名后在桌面网络页面开始读取，操作应用发出请求并关闭响应体。页面显示全调用汇总；若启用了应用侧路径脱敏器，也会显示其返回的路径。单次重定向详情仍不提供。

组件目前以源码接入，尚未发布独立依赖包。API 25 / rk3399-all 真机使用临时 OkHttp 4.12 debug 应用验证了本机 HTTP 请求、Logcat Agent 记录、桌面端 PID 回退读取和路径脱敏；这只证明已接入该 Agent 的 OkHttp 客户端，不会捕获未配置的客户端、WebView、Cronet 或原生 socket。设备日志权限、Android 版本和应用接入方式会影响可用性。
