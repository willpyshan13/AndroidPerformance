package dev.androidperformance.agent;

import android.util.Log;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/** Logcat transport for debug builds. Logs contain host names and HTTP metadata. */
public final class LogcatSink implements NetworkEvents.Sink {
  public static final String TAG = "APWNetwork";
  @Override public void accept(NetworkEvents.Record record) {
    try {
      JSONObject value=new JSONObject();
      value.put("v",5); value.put("eventId",UUID.randomUUID().toString()); value.put("scheme",record.scheme); value.put("host",record.host);
      value.put("path",record.path == null ? JSONObject.NULL : record.path);
      value.put("protocol",record.protocol == null ? JSONObject.NULL : record.protocol);
      value.put("connectionReused",record.connectionReused == null ? JSONObject.NULL : record.connectionReused);
      value.put("port",record.port); value.put("method",record.method); value.put("status",record.status);
      value.put("startedAtMs",record.startedAtMs); value.put("deviceMonotonicNs",Long.toString(record.deviceMonotonicNs)); value.put("clockDomain","android-monotonic"); value.put("elapsedNs",record.elapsedNs);
      value.put("responseBytes",record.responseBytes == null ? JSONObject.NULL : record.responseBytes);
      value.put("dnsNs",record.dnsNs == null ? JSONObject.NULL : record.dnsNs);
      value.put("connectNs",record.connectNs == null ? JSONObject.NULL : record.connectNs);
      value.put("tlsNs",record.tlsNs == null ? JSONObject.NULL : record.tlsNs);
      value.put("waitNs",record.waitNs == null ? JSONObject.NULL : record.waitNs);
      value.put("receiveNs",record.receiveNs == null ? JSONObject.NULL : record.receiveNs);
      value.put("failed",record.failed);
      Log.i(TAG,value.toString());
    } catch (JSONException ignored) { }
  }
}
