package dev.androidperformance.agent;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.text.method.PasswordTransformationMethod;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Checkable;
import android.widget.TextView;
import android.util.Base64;
import android.util.Xml;

import org.json.JSONObject;
import org.xmlpull.v1.XmlSerializer;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Debug-build-only, read-only View hierarchy endpoint over an adb-forwarded local socket. */
public final class LayoutAgent {
    private static final int MAX_NODES = 10000;
    private static final int MAX_DEPTH = 100;
    private static final int MAX_TEXT = 512;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static volatile WeakReference<Activity> activity = new WeakReference<>(null);
    private static volatile String token;
    private static volatile boolean started;
    private static volatile LocalServerSocket server;

    private LayoutAgent() {}

    /** Call from a debug-only Activity.onResume(); token must be a random secret of at least 32 chars. */
    public static synchronized void start(Activity current, String sharedToken) {
        if (current == null || sharedToken == null || sharedToken.length() < 32) {
            throw new IllegalArgumentException("LayoutAgent requires an Activity and a 32+ character debug token");
        }
        activity = new WeakReference<>(current);
        token = sharedToken;
        if (started) return;
        started = true;
        String packageName = current.getPackageName();
        Thread worker = new Thread(() -> serve(packageName), "apw-layout-agent");
        worker.setDaemon(true);
        worker.start();
    }

    /** Call from Activity.onPause() when the target screen should no longer be inspectable. */
    public static synchronized void stop(Activity current) {
        Activity active = activity.get();
        if (active == current) activity = new WeakReference<>(null);
        if (activity.get() == null) token = null;
    }

    private static void serve(String packageName) {
        String socketName = socketName(packageName);
        while (started) {
            try (LocalServerSocket local = new LocalServerSocket(socketName)) {
                server = local;
                while (started) {
                    try (LocalSocket client = local.accept()) { handle(client); }
                    catch (Exception ignored) { if (!started) break; }
                }
            } catch (Exception error) {
                try { Thread.sleep(1000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); return; }
            }
        }
    }

    private static void handle(LocalSocket socket) {
        try {
            socket.setSoTimeout(5000);
            BufferedReader input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            BufferedWriter output = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));
            String line = readRequestLine(input);
            if (line == null) throw new IllegalArgumentException("Invalid request");
            JSONObject request = new JSONObject(line);
            String supplied = request.optString("token", "");
            if (!sameToken(supplied, token)) throw new SecurityException("Token rejected");
            if (!"capture".equals(request.optString("action"))) throw new IllegalArgumentException("Unsupported action");
            JSONObject response = captureOnMain();
            output.write(response.toString()); output.write('\n'); output.flush();
        } catch (Exception error) {
            try {
                BufferedWriter output = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));
                JSONObject response = new JSONObject(); response.put("ok", false); response.put("error", safe(error.getMessage()));
                output.write(response.toString()); output.write('\n'); output.flush();
            } catch (Exception ignored) {}
        }
    }

    private static JSONObject captureOnMain() throws Exception {
        final JSONObject[] result = new JSONObject[1];
        final Exception[] failure = new Exception[1];
        CountDownLatch done = new CountDownLatch(1);
        MAIN.post(() -> {
            try { result[0] = capture(); } catch (Exception error) { failure[0] = error; } finally { done.countDown(); }
        });
        if (!done.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Timed out waiting for the app UI thread");
        if (failure[0] != null) throw failure[0];
        return result[0];
    }

    private static JSONObject capture() throws Exception {
        Activity current = activity.get();
        if (current == null || current.isFinishing() || current.isDestroyed()) throw new IllegalStateException("No active Activity is available");
        View root = current.getWindow().getDecorView().getRootView();
        if (root.getWidth() <= 0 || root.getHeight() <= 0) throw new IllegalStateException("The active window has no laid-out content");
        ByteArrayOutputStream xml = new ByteArrayOutputStream();
        XmlSerializer serializer = Xml.newSerializer(); serializer.setOutput(xml, "UTF-8");
        serializer.startDocument("UTF-8", true); serializer.startTag(null, "hierarchy"); serializer.attribute(null, "rotation", "0");
        int[] rootLocation = new int[2]; root.getLocationOnScreen(rootLocation);
        CaptureState state = new CaptureState(); writeView(serializer, current, root, rootLocation, 0, 0, state);
        serializer.endTag(null, "hierarchy"); serializer.endDocument();

        JSONObject response = new JSONObject(); response.put("ok", true); response.put("xml", xml.toString("UTF-8"));
        response.put("width", root.getWidth()); response.put("height", root.getHeight());
        int flags = current.getWindow().getAttributes().flags;
        if ((flags & WindowManager.LayoutParams.FLAG_SECURE) == 0 && (long)root.getWidth() * root.getHeight() <= 16000000L) {
            Bitmap bitmap = Bitmap.createBitmap(root.getWidth(), root.getHeight(), Bitmap.Config.ARGB_8888);
            root.draw(new Canvas(bitmap)); ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes); bitmap.recycle();
            if (bytes.size() <= 24 * 1024 * 1024) response.put("screenshot", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
            else { response.put("screenshot", JSONObject.NULL); response.put("warning", "Screenshot exceeds 24 MiB"); }
        } else { response.put("screenshot", JSONObject.NULL); response.put("warning", "Secure window or screenshot exceeds 16 megapixels"); }
        response.put("truncated", state.truncated); return response;
    }

    private static void writeView(XmlSerializer out, Activity current, View view, int[] rootLocation, int depth, int index, CaptureState state) throws Exception {
        if (depth > MAX_DEPTH || state.count >= MAX_NODES) { state.truncated = true; return; }
        state.count++;
        out.startTag(null, "node");
        boolean password = view instanceof TextView && isPassword((TextView)view);
        attr(out, "index", Integer.toString(index)); attr(out, "text", view instanceof TextView && !password ? clip(((TextView) view).getText()) : "");
        attr(out, "resource-id", resourceId(current, view.getId())); attr(out, "class", view.getClass().getName());
        attr(out, "package", current.getPackageName()); attr(out, "content-desc", password ? "" : clip(view.getContentDescription()));
        if (password) attr(out, "password", "true");
        attr(out, "checkable", Boolean.toString(view instanceof Checkable));
        attr(out, "checked", Boolean.toString(view instanceof Checkable && ((Checkable) view).isChecked()));
        attr(out, "clickable", Boolean.toString(view.isClickable())); attr(out, "long-clickable", Boolean.toString(view.isLongClickable()));
        attr(out, "focusable", Boolean.toString(view.isFocusable())); attr(out, "focused", Boolean.toString(view.isFocused()));
        attr(out, "selected", Boolean.toString(view.isSelected())); attr(out, "enabled", Boolean.toString(view.isEnabled()));
        attr(out, "scrollable", Boolean.toString(view.canScrollVertically(1) || view.canScrollVertically(-1) || view.canScrollHorizontally(1) || view.canScrollHorizontally(-1)));
        attr(out, "visibility", view.getVisibility() == View.VISIBLE ? "visible" : view.getVisibility() == View.INVISIBLE ? "invisible" : "gone");
        attr(out, "alpha", String.format(Locale.US, "%.3f", view.getAlpha()));
        int[] location = new int[2]; view.getLocationOnScreen(location);
        Rect bounds = new Rect(location[0] - rootLocation[0], location[1] - rootLocation[1], location[0] - rootLocation[0] + view.getWidth(), location[1] - rootLocation[1] + view.getHeight());
        attr(out, "bounds", "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]");
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) writeView(out, current, group.getChildAt(i), rootLocation, depth + 1, i, state);
        }
        out.endTag(null, "node");
    }

    private static void attr(XmlSerializer out, String key, String value) throws Exception { out.attribute(null, key, value == null ? "" : value); }
    private static String resourceId(Activity current, int id) {
        if (id == View.NO_ID) return "";
        try { return current.getResources().getResourceName(id); } catch (Exception ignored) { return current.getPackageName() + ":id/0x" + Integer.toHexString(id); }
    }
    private static String readRequestLine(BufferedReader input) throws Exception {
        StringBuilder line = new StringBuilder(); int value;
        while ((value = input.read()) != -1 && value != '\n') {
            if (line.length() >= 8192) throw new IllegalArgumentException("Invalid request");
            line.append((char)value);
        }
        return value == -1 && line.length() == 0 ? null : line.toString();
    }
    private static String clip(CharSequence value) {
        if (value == null) return "";
        String text = value.toString(); StringBuilder clean = new StringBuilder(Math.min(text.length(), MAX_TEXT));
        for (int i = 0; i < text.length() && clean.length() < MAX_TEXT;) {
            int codePoint = text.codePointAt(i), width = Character.charCount(codePoint); i += width;
            boolean valid = codePoint == 0x9 || codePoint == 0xa || codePoint == 0xd || (codePoint >= 0x20 && codePoint <= 0xd7ff) || (codePoint >= 0xe000 && codePoint <= 0xfffd) || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
            if (valid && clean.length() + width <= MAX_TEXT) clean.appendCodePoint(codePoint);
        }
        return clean.toString();
    }
    private static boolean isPassword(TextView view) {
        int variation = view.getInputType() & (InputType.TYPE_MASK_CLASS | InputType.TYPE_MASK_VARIATION);
        return variation == (InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD)
                || variation == (InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)
                || variation == (InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD)
                || variation == (InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD)
                || view.getTransformationMethod() instanceof PasswordTransformationMethod;
    }
    private static String safe(String value) { if (value == null) return "Agent request failed"; return value.length() > 300 ? value.substring(0, 300) : value; }
    private static boolean sameToken(String a, String b) {
        if (b == null) return false;
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
    private static String socketName(String packageName) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(packageName.getBytes(StandardCharsets.UTF_8));
            StringBuilder value = new StringBuilder("apw-layout-");
            for (int i = 0; i < 12; i++) value.append(String.format(Locale.US, "%02x", digest[i]));
            return value.toString();
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    private static final class CaptureState { int count; boolean truncated; }
}
