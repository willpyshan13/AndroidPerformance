package dev.androidperformance.agent;

import android.content.Context;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayDeque;
import java.util.Locale;
import java.util.UUID;

/** Debug-only, cursor-based network event endpoint over an adb-forwarded local socket. */
public final class NetworkAgentServer implements NetworkEvents.Sink {
  private static final int MAX_EVENTS=10000, MAX_BATCH=500, MAX_REQUEST_CHARS=8192;
  private static volatile NetworkAgentServer instance;
  private final String packageName;
  private final Object lock=new Object();
  private final ArrayDeque<Event> events=new ArrayDeque<>();
  private volatile String token;
  private volatile boolean running;
  private volatile LocalServerSocket server;
  private long nextCursor=1;

  private static final class Event {
    final long cursor; final JSONObject value;
    Event(long cursor,JSONObject value){this.cursor=cursor;this.value=value;}
  }

  private NetworkAgentServer(String packageName,String token){this.packageName=packageName;this.token=token;}

  /** Start once from the debug Application and use sink() in OkHttp's EventListener factory. */
  public static synchronized void start(Context context,String sharedToken){
    if(context==null||sharedToken==null||sharedToken.length()<32||sharedToken.length()>256||hasLineBreak(sharedToken))throw new IllegalArgumentException("NetworkAgentServer requires a Context and a 32–256 character debug token");
    String pkg=context.getApplicationContext().getPackageName();
    if(instance!=null&&!instance.packageName.equals(pkg))throw new IllegalStateException("NetworkAgentServer already belongs to another package");
    if(instance==null)instance=new NetworkAgentServer(pkg,sharedToken);else instance.token=sharedToken;
    instance.startServer();
  }

  /** Stop the local debug endpoint when network capture is no longer needed. */
  public static synchronized void stop(){NetworkAgentServer active=instance;if(active!=null){active.running=false;active.token=null;LocalServerSocket socket=active.server;if(socket!=null)try{socket.close();}catch(IOException ignored){}instance=null;}}

  public static NetworkEvents.Sink sink(){return record->{NetworkAgentServer active=instance;if(active!=null)active.accept(record);};}

  public static String socketName(String packageName){
    try{byte[] digest=MessageDigest.getInstance("SHA-256").digest(packageName.getBytes(StandardCharsets.UTF_8));StringBuilder name=new StringBuilder("apw-network-");for(int i=0;i<12;i++)name.append(String.format(Locale.ROOT,"%02x",digest[i]&0xff));return name.toString();}
    catch(NoSuchAlgorithmException impossible){throw new AssertionError(impossible);}
  }

  private synchronized void startServer(){if(running)return;running=true;Thread thread=new Thread(this::serve,"apw-network-agent");thread.setDaemon(true);thread.start();}

  private void serve(){
    while(running){
      try(LocalServerSocket local=new LocalServerSocket(socketName(packageName))){server=local;while(running){try(LocalSocket client=local.accept()){handle(client);}catch(IOException error){if(!running)break;}}}
      catch(IOException error){if(!running)break;try{Thread.sleep(1000);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();break;}}
      finally{server=null;}
    }
  }

  private void handle(LocalSocket socket){
    try{
      socket.setSoTimeout(5000);
      BufferedReader input=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));
      BufferedWriter output=new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(),StandardCharsets.UTF_8));
      String line=readLine(input);if(line==null)throw new IllegalArgumentException("Request missing");
      JSONObject request=new JSONObject(line);if(!sameToken(request.optString("token",""),token))throw new SecurityException("Token rejected");
      String action=request.optString("action");if(request.optInt("v",0)!=1||!("open".equals(action)||"poll".equals(action)))throw new IllegalArgumentException("Unsupported protocol request");
      if("open".equals(action)){JSONObject response=new JSONObject();long latest;synchronized(lock){latest=nextCursor-1;}response.put("v",1);response.put("ok",true);response.put("cursor",latest);response.put("latestCursor",latest);output.write(response.toString());output.write('\n');output.flush();return;}
      long cursor=request.optLong("cursor",-1);int limit=request.optInt("limit",200);
      if(cursor<0||limit<1||limit>MAX_BATCH)throw new IllegalArgumentException("Invalid cursor or event limit");
      JSONObject response=poll(cursor,limit);output.write(response.toString());output.write('\n');output.flush();
    }catch(Exception error){try{JSONObject response=new JSONObject();response.put("v",1);response.put("ok",false);response.put("error",safe(error.getMessage()));BufferedWriter output=new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(),StandardCharsets.UTF_8));output.write(response.toString());output.write('\n');output.flush();}catch(Exception ignored){}}
  }

  private JSONObject poll(long cursor,int limit)throws JSONException{
    JSONArray batch=new JSONArray();long current,nextCursorValue=cursor,droppedBefore;
    synchronized(lock){
      current=nextCursor-1;long first=events.isEmpty()?nextCursor:events.peekFirst().cursor;droppedBefore=Math.max(0,first-cursor-1);
      for(Event event:events){if(event.cursor<=cursor)continue;if(batch.length()>=limit)break;JSONObject item=new JSONObject();item.put("cursor",event.cursor);item.put("event",event.value);batch.put(item);nextCursorValue=event.cursor;}
    }
    JSONObject response=new JSONObject();response.put("v",1);response.put("ok",true);response.put("cursor",nextCursorValue);response.put("latestCursor",current);response.put("dropped",droppedBefore);response.put("events",batch);return response;
  }

  @Override public void accept(NetworkEvents.Record record){
    try{
      JSONObject value=new JSONObject();value.put("v",5);value.put("eventId",UUID.randomUUID().toString());value.put("scheme",record.scheme);value.put("host",record.host);value.put("path",record.path==null?JSONObject.NULL:record.path);value.put("protocol",record.protocol==null?JSONObject.NULL:record.protocol);value.put("connectionReused",record.connectionReused==null?JSONObject.NULL:record.connectionReused);value.put("port",record.port);value.put("method",record.method);value.put("status",record.status);value.put("startedAtMs",record.startedAtMs);value.put("deviceMonotonicNs",Long.toString(record.deviceMonotonicNs));value.put("clockDomain","android-monotonic");value.put("elapsedNs",record.elapsedNs);putNullable(value,"responseBytes",record.responseBytes);putNullable(value,"dnsNs",record.dnsNs);putNullable(value,"connectNs",record.connectNs);putNullable(value,"tlsNs",record.tlsNs);putNullable(value,"waitNs",record.waitNs);putNullable(value,"receiveNs",record.receiveNs);value.put("failed",record.failed);
      synchronized(lock){if(nextCursor>=9007199254740000L){running=false;token=null;return;}long cursor=nextCursor++;events.addLast(new Event(cursor,value));if(events.size()>MAX_EVENTS)events.removeFirst();}
    }catch(JSONException ignored){}
  }

  private static void putNullable(JSONObject value,String key,Long number)throws JSONException{value.put(key,number==null?JSONObject.NULL:number);}
  private static boolean sameToken(String supplied,String expected){if(expected==null)return false;return MessageDigest.isEqual(supplied.getBytes(StandardCharsets.UTF_8),expected.getBytes(StandardCharsets.UTF_8));}
  private static boolean hasLineBreak(String value){return value.indexOf('\n')>=0||value.indexOf('\r')>=0;}
  private static String readLine(BufferedReader input)throws IOException{StringBuilder line=new StringBuilder();while(true){int c=input.read();if(c<0)return line.length()==0?null:line.toString();if(c=='\n')return line.toString();if(c!='\r')line.append((char)c);if(line.length()>MAX_REQUEST_CHARS)throw new IOException("Request too large");}}
  private static String safe(String message){if(message==null||message.isEmpty())return "Request rejected";String clean=message.replaceAll("[\\r\\n\\p{Cntrl}]"," ");return clean.substring(0,Math.min(clean.length(),160));}
}
