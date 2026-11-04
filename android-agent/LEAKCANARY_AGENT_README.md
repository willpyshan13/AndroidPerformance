# Android Performance Debug Lifecycle Agent

This optional source package observes destroyed Android Activities in a **debug build** and writes lifecycle events to the `APWLeakCanary` Logcat tag. The desktop app reads those events alongside logs from the upstream LeakCanary library.

## Add it to an Android app

1. Extract this ZIP at the Android app module root. The Java files are placed in `src/debug/java/`, and the provider declaration is placed in `src/debug/AndroidManifest.xml`.
2. Rebuild and install the app's debug variant. No `Application` subclass changes, network permission, token, or external dependency is needed.
3. In Android Performance, select that app and device, open Memory, and start **LeakCanary live events**.

The provider and source only enter the debug variant. Keep them out of release builds.

## What the events mean

When an Activity is destroyed, the agent keeps only a `WeakReference` and reports if it remains reachable after 5 seconds, 30 seconds, and 2 minutes. It reports when the reference is collected, and expires watches after 10 minutes. It does not force garbage collection, keep an object strongly reachable, inspect the heap, or trace retaining references. A retained candidate can be intentional or temporary and is **not proof of a memory leak**. The watch list is capped at 500 items.

### Optional AndroidX Fragment observation

The ZIP also includes `optional-androidx/src/debug/java/.../ApwAndroidXFragmentLeakAgent.java`. It is outside the app source set so projects without AndroidX Fragment do not need an extra dependency. In a project that already uses AndroidX Fragment, copy the file to `src/debug/java/dev/androidperformance/agent/`. The base agent detects `FragmentActivity` and registers the callback automatically. Destroyed Fragment instances use the same weak-reference checks as Activities; nested fragments are covered by recursive callback registration.

### Optional Jetpack JankStats capture

The ZIP includes `optional-jankstats/src/debug/java/.../ApwJankStatsAgent.java` outside the default source set. To enable it, add the AndroidX dependency to the app module and copy the file into `src/debug/java/dev/androidperformance/agent/`:

```kotlin
dependencies {
    debugImplementation("androidx.metrics:metrics-performance:1.0.0")
}
```

The base Agent detects the optional class and starts/stops JankStats with each Activity's resumed/paused lifecycle. It writes two-second aggregates to the `APWJank` Logcat tag instead of logging each frame. Aggregates include Activity/window, JankStats UI state, frame and jank counts, duration histogram/min/max/mean inputs, and API-available CPU duration/frame overrun. Apps can attach bounded, non-sensitive state labels to `PerformanceMetricsState`; state values are written to debug Logcat, so do not include user data or identifiers. The JankStats heuristic and gfxinfo/FrameTimeline platform classifications remain separate metrics. Aggregation and Logcat still add debug overhead; do not use this Agent in release builds or formal performance measurement.

This lightweight signal helps identify suspicious lifecycles; use an HPROF analysis tool or LeakCanary's object graph analysis to confirm a leak. Arbitrary non-Activity/non-Fragment objects are not watched.
