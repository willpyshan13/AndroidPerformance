package dev.androidperformance.agent;

import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;

import java.util.Collections;
import java.util.Map;
import java.util.UUID;
import java.util.WeakHashMap;

/** Optional bridge for apps that already depend on AndroidX Fragment. */
public final class ApwAndroidXFragmentLeakAgent {
    private static final Map<FragmentManager, Boolean> INSTALLED = Collections.synchronizedMap(new WeakHashMap<>());
    private static final Map<Fragment, String> FRAGMENT_IDS = Collections.synchronizedMap(new WeakHashMap<>());
    private ApwAndroidXFragmentLeakAgent() {}

    /** Registered automatically for each FragmentActivity by the base Debug Agent. */
    public static void install(FragmentManager fragmentManager) {
        synchronized (INSTALLED) {
            if (INSTALLED.put(fragmentManager, Boolean.TRUE) != null) return;
        }
        fragmentManager.registerFragmentLifecycleCallbacks(new FragmentManager.FragmentLifecycleCallbacks() {
            @Override public void onFragmentResumed(FragmentManager manager, Fragment fragment) {
                String id;
                synchronized (FRAGMENT_IDS) { id = FRAGMENT_IDS.get(fragment); if (id == null) { id = UUID.randomUUID().toString(); FRAGMENT_IDS.put(fragment, id); } }
                notifyJankStats("onFragmentResumed", fragment, id);
            }

            @Override public void onFragmentPaused(FragmentManager manager, Fragment fragment) {
                notifyJankStats("onFragmentPaused", fragment, null);
            }

            @Override public void onFragmentDestroyed(FragmentManager manager, Fragment fragment) {
                notifyJankStats("onFragmentPaused", fragment, null);
                synchronized (FRAGMENT_IDS) { FRAGMENT_IDS.remove(fragment); }
                ApwLifecycleLeakAgent.track(fragment);
            }
        }, true);
    }

    private static void notifyJankStats(String callback, Fragment fragment, String id) {
        try {
            Class<?> bridge = Class.forName("dev.androidperformance.agent.ApwJankStatsAgent", true, fragment.getClass().getClassLoader());
            if ("onFragmentResumed".equals(callback)) {
                bridge.getMethod(callback, android.view.View.class, String.class, String.class)
                    .invoke(null, fragment.getView(), fragment.getClass().getSimpleName(), id);
            } else {
                String fragmentId;
                synchronized (FRAGMENT_IDS) { fragmentId = FRAGMENT_IDS.get(fragment); }
                bridge.getMethod(callback, String.class).invoke(null, fragmentId);
            }
        } catch (ClassNotFoundException ignored) {
            // JankStats remains optional when the app has not added its AndroidX dependency.
        } catch (ReflectiveOperationException error) {
            // Keep Fragment lifecycle and leak observation working even if the optional bridge fails.
        }
    }
}
