package dev.androidperformance.agent

import android.os.SystemClock
import android.util.Base64
import android.util.Log
import java.nio.charset.StandardCharsets
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.UUID

private val automaticProbeSessionId = UUID.randomUUID().toString().replace("-", "")
private val executionCounts = ConcurrentHashMap<String, AtomicLong>()
private val skipCounts = ConcurrentHashMap<String, AtomicLong>()
private val edgeCounts = ConcurrentHashMap<String, AtomicLong>()
private data class InvocationFrame(val name: String, val groupKey: Int?, val parent: String?, val parentGroupKey: Int?)
private val invocationStack = object : ThreadLocal<ArrayDeque<InvocationFrame>>() {
    override fun initialValue() = ArrayDeque<InvocationFrame>()
}

/** Called at each compiled composable entry so automatic records can retain their parent function. */
fun apwComposeAutomaticEnter(name: String) {
    val stack = invocationStack.get() ?: return
    val parent = stack.peekLast()
    stack.addLast(InvocationFrame(name.take(300), null, parent?.name, parent?.groupKey))
}

/** Same as enter, with the key emitted by Composer.startRestartGroup for group correlation. */
fun apwComposeAutomaticEnterKeyed(name: String, groupKey: Int) {
    val stack = invocationStack.get() ?: return
    val parent = stack.peekLast()
    stack.addLast(InvocationFrame(name.take(300), groupKey, parent?.name, parent?.groupKey))
}

/** Called after the compiled composable body to close its invocation frame. */
fun apwComposeAutomaticExit() {
    val stack = invocationStack.get() ?: return
    if (stack.isNotEmpty()) stack.removeLast()
    if (stack.isEmpty()) invocationStack.remove()
}

/** Called from a composable's non-skipped compiler branch by the optional plugin. */
fun apwComposeAutomaticExecution(name: String) {
    recordAutomaticEvent("APW2", name, executionCounts)
}

/** Called from the compiler-generated Composer skip branch by the optional plugin. */
fun apwComposeAutomaticSkip(name: String) {
    recordAutomaticEvent("APW3", name, skipCounts)
}

private fun recordAutomaticEvent(prefix: String, name: String, counters: ConcurrentHashMap<String, AtomicLong>) {
    if (name.isBlank() || name.length > 300) return
    val frame = invocationStack.get()?.peekLast()?.takeIf { it.name == name }
    val parent = frame?.parent
    val parentKey = frame?.parentGroupKey
    val edgeKey = "$prefix\u0000${parent ?: ""}\u0000${parentKey ?: ""}\u0000$name\u0000${frame?.groupKey ?: ""}"
    val edgeCount = edgeCounts.computeIfAbsent(edgeKey) { AtomicLong() }.incrementAndGet()
    val encodedName = Base64.encodeToString(
        name.toByteArray(StandardCharsets.UTF_8),
        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
    )
    val encodedParent = parent?.let { Base64.encodeToString(it.toByteArray(StandardCharsets.UTF_8), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) } ?: "-"
    val parentKeyField = parentKey?.toString() ?: "-"
    val groupKeyField = frame?.groupKey?.toString() ?: "-"
    Log.d(
        "APWCompose",
        "$prefix|$automaticProbeSessionId|$encodedName|${counters.computeIfAbsent(name) { AtomicLong() }.incrementAndGet()}|${SystemClock.elapsedRealtimeNanos()}|$encodedParent|$parentKeyField|$edgeCount|$groupKeyField"
    )
}
