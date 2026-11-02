// Only parse the versioned, privacy-reduced records emitted by our agent.
export function parseNetworkAgentLog(raw) {
 const rows=[];let invalid=0;
 for(const line of String(raw).split(/\r?\n/)){
  if(!line.trim()||line.startsWith('---------'))continue;
  try{
   const v=JSON.parse(line);
   const nonnegative=n=>Number.isSafeInteger(n)&&n>=0;
   const optional=n=>n===null||nonnegative(n);
   if(!v||![1,2].includes(v.v)||(v.v===2&&(typeof v.eventId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.eventId)))||!['http','https'].includes(v.scheme)||typeof v.host!=='string'||v.host.length>255||typeof v.method!=='string'||! /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,32}$/.test(v.method)||!Number.isInteger(v.port)||v.port<1||v.port>65535||!Number.isInteger(v.status)||v.status<0||v.status>999||!nonnegative(v.startedAtMs)||!nonnegative(v.elapsedNs)||!optional(v.responseBytes)||!optional(v.dnsNs)||!optional(v.connectNs)|| !optional(v.tlsNs)||!optional(v.waitNs??null)||!optional(v.receiveNs??null)||typeof v.failed!=='boolean')throw new Error();
   const host=v.host.includes(':')?`[${v.host}]`:v.host,parsed=new URL(`${v.scheme}://${host}:${v.port}/`);
   if(parsed.hostname.replace(/^\[|\]$/g,'').toLowerCase()!==v.host.toLowerCase()||parsed.username||parsed.password)throw new Error();
   rows.push({id:rows.length+1,...(v.v===2?{eventId:v.eventId.toLowerCase()}:{}),method:v.method,host:parsed.host,path:'（未采集）',url:parsed.origin+'/',status:v.status,failed:v.failed,timeMs:v.elapsedNs/1e6,bytes:v.responseBytes,startedAt:v.startedAtMs,timings:{dns:v.dnsNs===null?null:v.dnsNs/1e6,connect:v.connectNs===null?null:v.connectNs/1e6,ssl:v.tlsNs===null?null:v.tlsNs/1e6,blocked:null,send:null,wait:v.waitNs==null?null:v.waitNs/1e6,receive:v.receiveNs==null?null:v.receiveNs/1e6}});
  }catch{invalid++;}
 }
 return {rows,invalid};
}
