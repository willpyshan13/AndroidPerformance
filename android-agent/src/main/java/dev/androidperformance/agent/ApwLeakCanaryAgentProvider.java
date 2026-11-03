package dev.androidperformance.agent;

import android.app.Application;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;

/** Installs the debug observer without requiring changes to the app's Application class. */
public final class ApwLeakCanaryAgentProvider extends ContentProvider {
    @Override public boolean onCreate() {
        if (getContext() != null) {
            Application application = (Application) getContext().getApplicationContext();
            ApwLifecycleLeakAgent.install(application);
        }
        return true;
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sortOrder) { return null; }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
}
