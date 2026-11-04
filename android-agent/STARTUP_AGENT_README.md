# Startup Debug Agent

This optional Java-only helper records Android startup milestones from a debug build. It does not require network access, permissions, or third-party libraries. Keep it out of release builds and formal performance measurements.

Copy `src/debug/java/dev/androidperformance/agent/ApwStartupAgent.java` into the target app's `src/debug/java` source set and merge `STARTUP_AGENT_MANIFEST.xml` into the debug manifest. The provider installs Activity lifecycle observation. In the app's `Application.onCreate`, call:

```java
ApwStartupAgent.markApplicationCreated(this);
```

Call `ApwStartupAgent.markFullyDrawn(activity)` only when the app's own fully-drawn condition is met. Do not call it merely because the first frame appeared. Activity creation, resume, and first pre-draw are observed automatically.

The agent writes bounded, non-sensitive `APWStartup` Logcat records. Activity class names are URL-safe Base64 encoded; the event carries a process session ID, Activity instance ID, PID, and `System.nanoTime()` timestamp. The timestamp uses Android's monotonic clock and can be compared with trace `CLOCK_MONOTONIC` only when the trace contains a valid clock snapshot. First-draw-to-fully-drawn time is absent until the app explicitly reports that milestone. These markers are timing evidence, not proof of user-visible readiness or causality.

Example integration:

```java
@Override public void onCreate() {
    super.onCreate();
    ApwStartupAgent.markApplicationCreated(this);
}

// In the Activity's existing fully-drawn callback:
ApwStartupAgent.markFullyDrawn(this);
```

All calls must remain in a debug variant. The provider is non-exported and uses the `${applicationId}.apw-startup-agent` authority.
