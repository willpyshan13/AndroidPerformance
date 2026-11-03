package dev.androidperformance.agent;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;

import java.lang.ref.ReferenceQueue;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Debug-only lifecycle observer. It never keeps an Activity strongly reachable or forces GC. */
public final class ApwLifecycleLeakAgent implements Application.ActivityLifecycleCallbacks {
    private static final String TAG = "APWLeakCanary";
    private static final int MAX_WATCHED = 500;
    private static final long EXPIRE_AFTER_MS = TimeUnit.MINUTES.toMillis(10);
    private static final long[] CHECKPOINTS_MS = {5_000L, 30_000L, 120_000L};
    private static ApwLifecycleLeakAgent instance;

    private final ReferenceQueue<Activity> collected = new ReferenceQueue<>();
    private final LinkedHashMap<String, Watch> watches = new LinkedHashMap<>();
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "apw-lifecycle-leak-agent");
        thread.setDaemon(true);
        return thread;
    });

    public static synchronized void install(Application application) {
        if (instance != null) return;
        ApwLifecycleLeakAgent agent = new ApwLifecycleLeakAgent();
        instance = agent;
        application.registerActivityLifecycleCallbacks(agent);
        agent.worker.scheduleAtFixedRate(agent::inspect, 2, 2, TimeUnit.SECONDS);
        Log.i(TAG, "debug lifecycle observer installed");
    }

    private ApwLifecycleLeakAgent() {}

    @Override public void onActivityDestroyed(Activity activity) {
        String id = UUID.randomUUID().toString();
        String className = activity.getClass().getName();
        long now = SystemClock.uptimeMillis();
        synchronized (watches) {
            while (watches.size() >= MAX_WATCHED) {
                Iterator<String> iterator = watches.keySet().iterator();
                if (!iterator.hasNext()) break;
                String removed = iterator.next(); iterator.remove();
                Log.w(TAG, "watch limit reached; dropped candidate id=" + removed);
            }
            watches.put(id, new Watch(id, className, now, new ActivityReference(activity, collected, id)));
        }
        Log.i(TAG, "Watching object id=" + id + " class=" + className);
    }

    private void inspect() {
        ActivityReference reference;
        while ((reference = (ActivityReference) collected.poll()) != null) {
            synchronized (watches) {
                Watch watch = watches.remove(reference.id);
                if (watch != null) Log.i(TAG, "Object was collected id=" + watch.id + " class=" + watch.className);
            }
        }
        long now = SystemClock.uptimeMillis();
        synchronized (watches) {
            Iterator<Map.Entry<String, Watch>> iterator = watches.entrySet().iterator();
            while (iterator.hasNext()) {
                Watch watch = iterator.next().getValue();
                long elapsed = now - watch.destroyedAt;
                if (watch.reference.get() == null) continue;
                for (int i = 0; i < CHECKPOINTS_MS.length; i++) {
                    int bit = 1 << i;
                    if (elapsed >= CHECKPOINTS_MS[i] && (watch.reported & bit) == 0) {
                        watch.reported |= bit;
                        Log.w(TAG, "Retained object candidate id=" + watch.id + " class=" + watch.className + " elapsedMs=" + elapsed);
                    }
                }
                if (elapsed >= EXPIRE_AFTER_MS) iterator.remove();
            }
        }
    }

    private static final class Watch {
        final String id, className;
        final long destroyedAt;
        final ActivityReference reference;
        int reported;
        Watch(String id, String className, long destroyedAt, ActivityReference reference) {
            this.id = id; this.className = className; this.destroyedAt = destroyedAt; this.reference = reference;
        }
    }

    private static final class ActivityReference extends WeakReference<Activity> {
        final String id;
        ActivityReference(Activity activity, ReferenceQueue<Activity> queue, String id) { super(activity, queue); this.id = id; }
    }

    @Override public void onActivityCreated(Activity activity, Bundle state) {}
    @Override public void onActivityStarted(Activity activity) {}
    @Override public void onActivityResumed(Activity activity) {}
    @Override public void onActivityPaused(Activity activity) {}
    @Override public void onActivityStopped(Activity activity) {}
    @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) {}
}
