package dev.androidperformance.agent

import android.os.SystemClock
import android.util.Base64
import android.util.Log
import java.nio.charset.StandardCharsets
import java.util.UUID

private val automaticProbeSessionId = UUID.randomUUID().toString().replace("-", "")

/** Called at composable function entry by the optional compiler plugin. */
fun apwComposeAutomaticInvocation(name: String) {
    if (name.isBlank() || name.length > 300) return
    val encodedName = Base64.encodeToString(
        name.toByteArray(StandardCharsets.UTF_8),
        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
    )
    Log.d(
        "APWCompose",
        "APW2|$automaticProbeSessionId|$encodedName|${SystemClock.elapsedRealtimeNanos()}"
    )
}
