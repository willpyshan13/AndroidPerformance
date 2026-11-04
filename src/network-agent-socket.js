import net from 'node:net';

const MAX_RESPONSE_BYTES=8*1024*1024;

function exchange(port,token,request){
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('网络 Agent 转发端口无效');
 if(typeof token!=='string'||token.length<32||token.length>256||/[\r\n]/.test(token))throw new Error('网络 Agent 令牌须为 32–256 个字符');
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection({host:'127.0.0.1',port}),chunks=[];let size=0,done=false;
  const finish=(error,value)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve(value);};
  socket.setTimeout(10000,()=>finish(new Error('网络 Agent 响应超时')));
  socket.on('connect',()=>socket.write(`${JSON.stringify(request)}\n`));
  socket.on('data',chunk=>{
   size+=chunk.length;if(size>MAX_RESPONSE_BYTES)return finish(new Error('网络 Agent 响应超过 8 MiB'));
   chunks.push(chunk);const bytes=Buffer.concat(chunks,size),newline=bytes.indexOf(10);
   if(newline<0)return;
   try{const response=JSON.parse(bytes.subarray(0,newline).toString('utf8'));if(!response||response.v!==1||typeof response.ok!=='boolean')throw new Error('网络 Agent 响应协议无效');if(!response.ok)throw new Error(typeof response.error==='string'?`网络 Agent：${response.error}`:'网络 Agent 请求失败');finish(null,response);}catch(error){finish(error);}
  });
  socket.on('error',error=>finish(new Error(`无法连接网络 Agent：${error.message}`)));
  socket.on('end',()=>{if(!done)finish(new Error('网络 Agent 提前关闭连接'));});
 });
}

export async function openNetworkAgentSocket(port,token){
 const response=await exchange(port,token,{v:1,action:'open',token});
 if(!Number.isSafeInteger(response.cursor)||response.cursor<0||response.latestCursor!==response.cursor)throw new Error('网络 Agent 初始游标无效');
 return {cursor:response.cursor};
}

export async function pollNetworkAgentSocket(port,token,cursor,limit=200){
 if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>500)throw new Error('网络 Agent 游标或批次大小无效');
 const response=await exchange(port,token,{v:1,action:'poll',token,cursor,limit});
 if(!Number.isSafeInteger(response.cursor)||response.cursor<cursor||!Number.isSafeInteger(response.latestCursor)||response.latestCursor<response.cursor||!Number.isSafeInteger(response.dropped)||response.dropped<0||!Array.isArray(response.events)||response.events.length>limit)throw new Error('网络 Agent 响应字段无效');
 let previous=cursor;for(const item of response.events){if(!item||!Number.isSafeInteger(item.cursor)||item.cursor<=previous||item.cursor>response.cursor||!item.event||typeof item.event!=='object'||Array.isArray(item.event))throw new Error('网络 Agent 事件游标无效');previous=item.cursor;}
 if((response.events.length?previous:cursor)!==response.cursor)throw new Error('网络 Agent 游标与事件不匹配');
 return response;
}
