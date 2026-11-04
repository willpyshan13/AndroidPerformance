# Android Performance JankStats Debug Agent

This optional bridge records Jetpack JankStats frame metrics in a **debug build**. It needs AndroidX `metrics-performance` in the app module and writes compact reports to Logcat for Android Performance to read.

## Add it to an Android app

1. Add the dependency to the app module:

   ```kotlin
   dependencies {
       debugImplementation("androidx.metrics:metrics-performance:1.0.0")
   }
   ```

2. Extract this ZIP at the Android app module root. Its lifecycle observer and manifest provider install the optional bridge automatically for the debug variant.
3. Rebuild and install the debug variant. In Android Performance, open Frames and use **Read app JankStats**.

The bridge tracks each resumed Activity window and stops tracking when that Activity pauses. It aggregates data off the frame callback and writes two-second summaries to `APWJank`, plus bounded individual frame batches to `APWJankFrame`.

## Interpreting results

Reports include Activity, Window, UI state, frame and jank counts, duration buckets, and CPU/overrun data when Android exposes them. JankStats uses its own heuristic; its classification is separate from `gfxinfo` and Perfetto FrameTimeline classifications. P95 is estimated from 1 ms buckets. Trace correlation uses nearby timestamps and is only a candidate match, not proof of frame identity or causality.

This bridge and Logcat add debug overhead. Keep it out of release builds and formal performance measurements. Do not put personal data or identifiers in UI state labels because they are included in debug Logcat.
