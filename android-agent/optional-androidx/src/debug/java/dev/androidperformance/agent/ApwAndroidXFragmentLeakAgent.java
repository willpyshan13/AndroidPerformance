package dev.androidperformance.agent;

import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;

import java.util.Collections;
import java.util.Map;
import java.util.WeakHashMap;

/** Optional bridge for apps that already depend on AndroidX Fragment. */
public final class ApwAndroidXFragmentLeakAgent {
    private static final Map<FragmentManager, Boolean> INSTALLED = Collections.synchronizedMap(new WeakHashMap<>());
    private ApwAndroidXFragmentLeakAgent() {}

    /** Registered automatically for each FragmentActivity by the base Debug Agent. */
    public static void install(FragmentManager fragmentManager) {
        synchronized (INSTALLED) {
            if (INSTALLED.put(fragmentManager, Boolean.TRUE) != null) return;
        }
        fragmentManager.registerFragmentLifecycleCallbacks(new FragmentManager.FragmentLifecycleCallbacks() {
            @Override public void onFragmentDestroyed(FragmentManager manager, Fragment fragment) {
                ApwLifecycleLeakAgent.track(fragment);
            }
        }, true);
    }
}
