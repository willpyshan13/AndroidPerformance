# OkHttp 事件采集组件（开发中）

`NetworkEvents` 是应用主动接入的 OkHttp 4 事件监听器。每次调用在结束或失败时交付一条记录；仅包含初始请求的协议、域名、端口、方法、最终已观察到的响应状态、时间和阶段耗时，不读取 URL 路径、查询参数、请求头或正文。DNS、连接和 TLS 在出现多个尝试时分别累加；TLS 是连接的一部分，不能相加。连接复用时阶段可能缺失。等待阶段从请求头或请求体发送结束到响应头开始；接收阶段是响应体读取开始到结束的经过时间，可能包括应用读取间隔，并非纯网络传输时间。重试、重定向或阶段不完整时这两项留空。状态为 0 表示尚未收到响应头，`failed` 才表示调用失败。响应字节是 OkHttp 报告的响应体读取字节之和，不保证等于线路字节。耗时使用单调时钟；重定向或重试发生时，记录属于整个调用而不是单个请求。

应用须在需要采集的构建中创建 `NetworkEvents.factory(sink)` 并通过 `OkHttpClient.Builder.eventListenerFactory(...)` 接入。每次调用使用独立监听器；配置会替换已有 EventListener factory，已有监听器需要由应用自行组合。sink 应快速返回并自行保护并发；不要在主线程或 OkHttp 回调中执行阻塞操作。采集结束依赖响应体关闭或读取完成；未结束的调用不会产生记录。建议只在调试构建启用。

桌面端“开始 Agent 读取”每 3 秒通过 ADB 从当前用户的目标 UID 读取 `APWNetwork` 日志，取最近 10,000 条日志范围。新版记录带随机请求标识，桌面端在本次读取期间累积去重，最多保留 10,000 条；旧版记录没有标识，只显示最近快照。日志可能在读取前被覆盖或丢失，首次快照也可能包含启动前记录。共享 UID 的其他应用可能混入，设备需要允许 shell 读取目标日志并支持 `logcat --uid`。日志包含域名和方法等元数据，其他拥有日志读取权限的进程可能看到；不要在正式构建启用。

在桌面网络页面点击“下载 Agent 源码”，解压后把 `src/main/java/dev/androidperformance/agent` 下的两个 Java 文件复制到目标应用的 `src/debug/java/dev/androidperformance/agent/`，确保调试构建依赖 OkHttp 4，然后在仅用于调试的客户端构造代码中接入：

```java
OkHttpClient client = new OkHttpClient.Builder()
    .eventListenerFactory(NetworkEvents.factory(new LogcatSink()))
    .build();
```

使用已有客户端时，基于它的 `newBuilder()` 配置，并注意该设置替换原来的 listener factory。选择设备与应用包名后在桌面网络页面开始读取，操作应用发出请求并关闭响应体。页面显示的是全调用汇总，不包含路径或单次重定向详情。

组件目前以源码接入，尚未发布独立依赖包，也尚未完成 Android 真机验证；权限、系统版本和目标应用接入情况会影响可用性。
