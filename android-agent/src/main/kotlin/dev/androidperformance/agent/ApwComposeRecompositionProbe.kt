package dev.androidperformance.agent

import android.os.SystemClock
import android.util.Base64
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

private val processSessionId = UUID.randomUUID().toString().replace("-", "")

/**
 * Debug-only opt-in probe. Call from inside a selected composable and gate the call with BuildConfig.DEBUG.
 * The desktop app reads APWCompose records from the target app UID's main log buffer.
 */
@Composable
fun ApwComposeRecompositionProbe(name: String) {
    require(name.isNotBlank() && name.length <= 300) { "Probe name must contain 1–300 characters" }
    val instanceId = remember(name) { UUID.randomUUID().toString().replace("-", "") }
    val encodedName = remember(name) {
        Base64.encodeToString(
            name.toByteArray(StandardCharsets.UTF_8),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
    }
    val count = remember(name) { AtomicLong() }
    SideEffect {
        Log.d("APWCompose", "APW1|$processSessionId|$instanceId|$encodedName|${count.incrementAndGet()}|${SystemClock.elapsedRealtimeNanos()}")
    }
}
