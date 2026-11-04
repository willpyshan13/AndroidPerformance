package dev.androidperformance.agent;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.os.Process;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.ViewTreeObserver;

import java.nio.charset.StandardCharsets;
import java.lang.ref.WeakReference;
import java.util.UUID;
import java.util.WeakHashMap;

/** Debug-only lifecycle milestones. It never reads app content or retains Activities. */
public final class ApwStartupAgent implements Application.ActivityLifecycleCallbacks {
    private static final String TAG = "APWStartup";
    private static final String PROCESS_SESSION = UUID.randomUUID().toString().replace("-", "");
    private static volatile ApwStartupAgent instance;

    private final WeakHashMap<Activity, String> activityIds = new WeakHashMap<>();
    private final WeakHashMap<Activity, Boolean> firstDrawReported = new WeakHashMap<>();
    private final WeakHashMap<Activity, ViewTreeObserver.OnPreDrawListener> drawListeners = new WeakHashMap<>();

    private ApwStartupAgent() { }

    public static void install(Application application) {
        if (application == null || instance != null) return;
        synchronized (ApwStartupAgent.class) {
            if (instance != null) return;
            ApwStartupAgent agent = new ApwStartupAgent();
            instance = agent;
            application.registerActivityLifecycleCallbacks(agent);
            agent.record("agent-installed", null, null);
        }
    }

    /** Call from Application.onCreate after super.onCreate(). */
    public static void markApplicationCreated(Application application) {
        ApwStartupAgent agent = instance;
        if (agent != null && application != null) agent.record("application-created", null, null);
    }

    /** Call only when the app's own fully-drawn condition is satisfied. */
    public static void markFullyDrawn(Activity activity) {
        ApwStartupAgent agent = instance;
        if (agent == null || activity == null) return;
        synchronized (agent.activityIds) {
            String activityId = agent.activityIds.get(activity);
            if (activityId != null) agent.record("fully-drawn", activityId, activity.getClass().getName());
        }
    }

    private void record(String event, String activityId, String activityName) {
        String encoded = activityName == null ? "-" : Base64.encodeToString(activityName.getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        Log.i(TAG, "APWS1|" + PROCESS_SESSION + "|" + (activityId == null ? "-" : activityId) + "|" + event + "|" + encoded + "|" + System.nanoTime() + "|" + Process.myPid());
    }

    private String idFor(Activity activity) {
        synchronized (activityIds) {
            String id = activityIds.get(activity);
            if (id == null) {
                id = UUID.randomUUID().toString().replace("-", "");
                activityIds.put(activity, id);
            }
            return id;
        }
    }

    @Override public void onActivityCreated(Activity activity, Bundle state) {
        record("activity-created", idFor(activity), activity.getClass().getName());
    }

    @Override public void onActivityResumed(Activity activity) {
        String id = idFor(activity);
        record("activity-resumed", id, activity.getClass().getName());
        View decor = activity.getWindow() == null ? null : activity.getWindow().getDecorView();
        synchronized (activityIds) {
            if (decor == null || Boolean.TRUE.equals(firstDrawReported.get(activity)) || drawListeners.containsKey(activity)) return;
        }
        ViewTreeObserver observer = decor.getViewTreeObserver();
        if (!observer.isAlive()) return;
        WeakReference<Activity> activityReference = new WeakReference<>(activity);
        String activityName = activity.getClass().getName();
        ViewTreeObserver.OnPreDrawListener listener = new ViewTreeObserver.OnPreDrawListener() {
            @Override public boolean onPreDraw() {
                if (observer.isAlive()) observer.removeOnPreDrawListener(this);
                Activity resumedActivity = activityReference.get();
                if (resumedActivity == null) return true;
                synchronized (activityIds) {
                    drawListeners.remove(resumedActivity);
                    firstDrawReported.put(resumedActivity, true);
                }
                record("first-draw", id, activityName);
                return true;
            }
        };
        synchronized (activityIds) { drawListeners.put(activity, listener); }
        observer.addOnPreDrawListener(listener);
    }

    @Override public void onActivityDestroyed(Activity activity) {
        ViewTreeObserver.OnPreDrawListener listener;
        synchronized (activityIds) {
            listener = drawListeners.remove(activity);
            activityIds.remove(activity);
            firstDrawReported.remove(activity);
        }
        View decor = activity.getWindow() == null ? null : activity.getWindow().getDecorView();
        if (listener != null && decor != null && decor.getViewTreeObserver().isAlive()) decor.getViewTreeObserver().removeOnPreDrawListener(listener);
    }

    @Override public void onActivityStarted(Activity activity) { }
    @Override public void onActivityPaused(Activity activity) { }
    @Override public void onActivityStopped(Activity activity) { }
    @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) { }
}
