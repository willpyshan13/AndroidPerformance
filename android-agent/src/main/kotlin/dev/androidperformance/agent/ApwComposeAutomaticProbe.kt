package dev.androidperformance.agent

import android.os.SystemClock
import android.util.Base64
import android.util.Log
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.UUID

private val automaticProbeSessionId = UUID.randomUUID().toString().replace("-", "")
private val executionCounts = ConcurrentHashMap<String, AtomicLong>()
private val skipCounts = ConcurrentHashMap<String, AtomicLong>()

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
    val encodedName = Base64.encodeToString(
        name.toByteArray(StandardCharsets.UTF_8),
        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
    )
    Log.d(
        "APWCompose",
        "$prefix|$automaticProbeSessionId|$encodedName|${counters.computeIfAbsent(name) { AtomicLong() }.incrementAndGet()}|${SystemClock.elapsedRealtimeNanos()}"
    )
}
