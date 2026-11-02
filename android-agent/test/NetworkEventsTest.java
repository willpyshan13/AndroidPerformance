import com.sun.net.httpserver.HttpServer;
import dev.androidperformance.agent.NetworkEvents;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class NetworkEventsTest {
  private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
  public static void main(String[] args) throws Exception {
    HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    server.createContext("/secret", exchange -> {byte[] data="hello".getBytes("UTF-8");exchange.sendResponseHeaders(200,data.length);exchange.getResponseBody().write(data);exchange.close();});
    server.createContext("/redirect", exchange -> {exchange.getResponseHeaders().add("Location","/secret");exchange.sendResponseHeaders(302,-1);exchange.close();});
    server.start();
    List<NetworkEvents.Record> records=new ArrayList<>();
    OkHttpClient client=new OkHttpClient.Builder().eventListenerFactory(NetworkEvents.factory(records::add)).callTimeout(3,TimeUnit.SECONDS).build();
    String base="http://127.0.0.1:"+server.getAddress().getPort();
    try {
      try(Response response=client.newCall(new Request.Builder().url(base+"/secret?token=private").build()).execute()) {check(response.code()==200,"status");check(response.body().string().equals("hello"),"body");}
      check(records.size()==1,"one event"); NetworkEvents.Record first=records.get(0);
      check(first.status==200&&!first.failed&&first.responseBytes==5,"response evidence");
      check(first.host.equals("127.0.0.1")&&first.method.equals("GET")&&first.elapsedNs>0,"request metadata");
      check(first.connectNs!=null&&first.tlsNs==null,"connection phases");
      check(first.waitNs!=null&&first.waitNs>=0&&first.receiveNs!=null&&first.receiveNs>=0,"waiting and body reading phases");
      try(Response response=client.newCall(new Request.Builder().url(base+"/secret").build()).execute()) {response.body().string();}
      check(records.size()==2&&records.get(1).connectNs==null,"connection reuse has absent connection duration");
      try(Response response=client.newCall(new Request.Builder().url(base+"/redirect").build()).execute()) {response.body().string();}
      check(records.size()==3&&records.get(2).waitNs==null&&records.get(2).receiveNs==null,"redirect phases remain unknown");
      server.stop(0);client.connectionPool().evictAll();
      try {client.newCall(new Request.Builder().url(base+"/secret").build()).execute();throw new AssertionError("expected failure");}catch(java.io.IOException expected){}
      check(records.size()==4&&records.get(3).failed&&records.get(3).status==0&&records.get(3).responseBytes==null&&records.get(3).waitNs==null,"failed call evidence");
      System.out.println("NetworkEvents real OkHttp HTTP/reuse/failure checks passed");
    } finally {server.stop(0);client.dispatcher().executorService().shutdownNow();client.connectionPool().evictAll();}
  }
}
