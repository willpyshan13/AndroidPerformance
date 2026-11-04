package dev.androidperformance.agent;

import android.app.Activity;
import android.util.Log;
import android.view.Window;

import androidx.metrics.performance.FrameData;
import androidx.metrics.performance.FrameDataApi24;
import androidx.metrics.performance.FrameDataApi31;
import androidx.metrics.performance.JankStats;
import androidx.metrics.performance.PerformanceMetricsState;
import androidx.metrics.performance.StateInfo;

import org.json.JSONObject;
import org.json.JSONException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.WeakHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Optional debug bridge for Jetpack JankStats. Logcat writes are aggregated off the frame callback. */
public final class ApwJankStatsAgent {
    private static final String TAG = "APWJank";
    private static final Object LOCK = new Object();
    private static final Map<Activity, JankStats> TRACKERS = Collections.synchronizedMap(new WeakHashMap<>());
    private static final Map<String, Aggregate> PENDING = new LinkedHashMap<>();
    private static final ScheduledExecutorService FLUSHER = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "apw-jankstats-log-flush"); thread.setDaemon(true); return thread;
    });

    static { FLUSHER.scheduleAtFixedRate(ApwJankStatsAgent::flush, 2, 2, TimeUnit.SECONDS); }
    private ApwJankStatsAgent() {}

    /** Called reflectively by the base debug lifecycle agent when this optional source is present. */
    public static void onActivityResumed(Activity activity) {
        synchronized (TRACKERS) {
            JankStats stats = TRACKERS.get(activity);
            if (stats != null) { stats.setTrackingEnabled(true); return; }
            Window window = activity.getWindow();
            if (window == null || window.peekDecorView() == null) return;
            try {
                PerformanceMetricsState.Holder holder = PerformanceMetricsState.getHolderForHierarchy(window.getDecorView());
                PerformanceMetricsState state = holder.getState();
                if (state != null) {
                    state.putState("Activity", activity.getClass().getSimpleName());
                    state.putState("WindowId", Integer.toHexString(System.identityHashCode(window)));
                }
                JankStats created = JankStats.createAndTrack(window, data -> record(activity, window, data));
                TRACKERS.put(activity, created);
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not start JankStats for " + activity.getClass().getName(), error);
            }
        }
    }

    public static void onActivityPaused(Activity activity) {
        synchronized (TRACKERS) {
            JankStats stats = TRACKERS.get(activity);
            if (stats != null) stats.setTrackingEnabled(false);
        }
        flush();
    }

    public static void onActivityDestroyed(Activity activity) {
        synchronized (TRACKERS) {
            JankStats stats = TRACKERS.remove(activity);
            if (stats != null) stats.setTrackingEnabled(false);
        }
        flush();
    }

    private static void record(Activity activity, Window window, FrameData frame) {
        long start = frame.getFrameStartNanos(), duration = frame.getFrameDurationUiNanos();
        if (start < 0 || duration < 0) return;
        Map<String, String> states = new TreeMap<>();
        List<StateInfo> frameStates = frame.getStates();
        if (frameStates != null) for (StateInfo item : frameStates) {
            if (states.size() >= 20) break;
            if (item != null && item.getKey() != null && item.getValue() != null) {
                String label = clean(item.getKey(), 80), value = clean(item.getValue(), 160);
                if (!label.isEmpty() && !value.isEmpty()) states.put(label, value);
            }
        }
        states.putIfAbsent("Activity", activity.getClass().getSimpleName());
        String id = activity.getClass().getName() + '|' + System.identityHashCode(window) + '|' + states.toString();
        long cpu = frame instanceof FrameDataApi24 ? ((FrameDataApi24) frame).getFrameDurationCpuNanos() : -1L;
        long overrun = frame instanceof FrameDataApi31 ? ((FrameDataApi31) frame).getFrameOverrunNanos() : Long.MIN_VALUE;
        synchronized (LOCK) {
            Aggregate aggregate = PENDING.get(id);
            if (aggregate == null) {
                if (PENDING.size() >= 64) PENDING.remove(PENDING.keySet().iterator().next());
                aggregate = new Aggregate(activity.getClass().getSimpleName(), Integer.toHexString(System.identityHashCode(window)), states);
                PENDING.put(id, aggregate);
            }
            aggregate.add(start, duration, frame.isJank(), cpu, overrun);
        }
    }

    private static String clean(String value, int limit) {
        if (value == null) return "";
        StringBuilder result = new StringBuilder(Math.min(value.length(), limit));
        for (int i = 0; i < value.length() && result.length() < limit; i++) {
            char c = value.charAt(i); result.append(Character.isISOControl(c) ? ' ' : c);
        }
        return result.toString();
    }

    private static void flush() {
        List<Aggregate> batch;
        synchronized (LOCK) { if (PENDING.isEmpty()) return; batch = new ArrayList<>(PENDING.values()); PENDING.clear(); }
        for (Aggregate value : batch) {
            try { Log.i(TAG, value.toJson().toString()); }
            catch (RuntimeException error) { Log.w(TAG, "Could not encode JankStats aggregate", error); }
        }
    }

    private static final class Aggregate {
        final String activity, windowId;
        final Map<String, String> states;
        final Map<Integer, Integer> histogram = new TreeMap<>();
        long frameStartNs = Long.MAX_VALUE, frameEndNs, frameCount, jankCount, durationTotalNs, durationMinNs = Long.MAX_VALUE, durationMaxNs, cpuTotalNs, overrunTotalNs;
        int cpuCount, overrunCount;
        Aggregate(String activity, String windowId, Map<String, String> states) {
            this.activity = activity; this.windowId = windowId; this.states = new LinkedHashMap<>(states);
        }
        void add(long start, long duration, boolean jank, long cpu, long overrun) {
            frameStartNs = Math.min(frameStartNs, start); frameEndNs = Math.max(frameEndNs, start + duration);
            frameCount++; if (jank) jankCount++;
            durationTotalNs += duration; durationMinNs = Math.min(durationMinNs, duration); durationMaxNs = Math.max(durationMaxNs, duration);
            int bucketMs = (int) Math.min(1000L, Math.max(1L, (duration + 999_999L) / 1_000_000L));
            histogram.put(bucketMs, histogram.containsKey(bucketMs) ? histogram.get(bucketMs) + 1 : 1);
            if (cpu >= 0) { cpuTotalNs += cpu; cpuCount++; }
            if (overrun != Long.MIN_VALUE) { overrunTotalNs += overrun; overrunCount++; }
        }
        JSONObject toJson() {
            try {
                JSONObject bins = new JSONObject(), stateValues = new JSONObject();
                for (Map.Entry<Integer, Integer> item : histogram.entrySet()) bins.put(String.valueOf(item.getKey()), item.getValue());
                for (Map.Entry<String, String> item : states.entrySet()) stateValues.put(item.getKey(), item.getValue());
                JSONObject row = new JSONObject();
                row.put("version", 1); row.put("activity", activity); row.put("windowId", windowId);
                row.put("frameStartNs", frameStartNs); row.put("frameEndNs", frameEndNs);
                row.put("frameCount", frameCount); row.put("jankCount", jankCount);
                row.put("durationTotalNs", durationTotalNs); row.put("durationMinNs", durationMinNs); row.put("durationMaxNs", durationMaxNs);
                row.put("histogram", bins); row.put("states", stateValues);
                row.put("cpuTotalNs", cpuCount == 0 ? JSONObject.NULL : cpuTotalNs); row.put("cpuCount", cpuCount);
                row.put("overrunTotalNs", overrunCount == 0 ? JSONObject.NULL : overrunTotalNs); row.put("overrunCount", overrunCount);
                return row;
            } catch (JSONException error) { throw new IllegalStateException("Could not encode frame aggregate", error); }
        }
    }
}
