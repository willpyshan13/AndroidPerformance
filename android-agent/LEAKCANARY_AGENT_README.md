# Android Performance Debug Lifecycle Agent

This optional source package observes destroyed Android Activities in a **debug build** and writes lifecycle events to the `APWLeakCanary` Logcat tag. The desktop app reads those events alongside logs from the upstream LeakCanary library.

## Add it to an Android app

1. Extract this ZIP at the Android app module root. The Java files are placed in `src/debug/java/`, and the provider declaration is placed in `src/debug/AndroidManifest.xml`.
2. Rebuild and install the app's debug variant. No `Application` subclass changes, network permission, token, or external dependency is needed.
3. In Android Performance, select that app and device, open Memory, and start **LeakCanary live events**.

The provider and source only enter the debug variant. Keep them out of release builds.

## What the events mean

When an Activity is destroyed, the agent keeps only a `WeakReference` and reports if it remains reachable after 5 seconds, 30 seconds, and 2 minutes. It reports when the reference is collected, and expires watches after 10 minutes. It does not force garbage collection, keep an Activity strongly reachable, inspect the heap, or trace retaining references. A retained candidate can be intentional or temporary and is **not proof of a memory leak**. Fragment lifecycle and non-Activity objects are not observed. The watch list is capped at 500 items.

This lightweight signal helps identify suspicious lifecycles; use an HPROF analysis tool or LeakCanary's object graph analysis to confirm a leak.
