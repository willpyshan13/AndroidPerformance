import net from 'node:net';
import {createHash} from 'node:crypto';

function connect(port, token) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host:'127.0.0.1',port});
    const chunks=[];let size=0,done=false;
    const finish=(error,value)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve(value);};
    socket.setTimeout(15000,()=>finish(new Error('布局 Agent 响应超时')));
    socket.on('connect',()=>socket.write(`${JSON.stringify({action:'capture',token})}\n`));
    socket.on('data',chunk=>{
      size+=chunk.length;if(size>36*1024*1024)return finish(new Error('布局 Agent 响应超过 36 MiB'));
      const newline=chunk.indexOf(10);chunks.push(chunk);
      if(newline>=0){const bytes=Buffer.concat(chunks,size),response=bytes.subarray(0,bytes.indexOf(10)).toString('utf8');try{finish(null,JSON.parse(response));}catch{finish(new Error('布局 Agent 返回了无效 JSON'));}}
    });
    socket.on('error',error=>finish(new Error(`无法连接布局 Agent：${error.message}`)));
    socket.on('end',()=>{if(!done)finish(new Error('布局 Agent 提前关闭连接'));});
  });
}

export async function captureLayoutFromAgent(adb,serial,packageName,sharedToken){
  if(typeof serial!=='string'||!/^[\w.:[\]-]{1,200}$/.test(serial))throw new Error('请选择有效的设备');
  if(typeof packageName!=='string'||!/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(packageName))throw new Error('应用包名无效');
  if(typeof sharedToken!=='string'||sharedToken.length<32||sharedToken.length>256||/[\r\n]/.test(sharedToken))throw new Error('Agent 令牌须为 32–256 个字符');
  const socketName=`apw-layout-${createHash('sha256').update(packageName).digest('hex').slice(0,24)}`;
  let port=null;
  try{
    const output=await adb.run(['-s',serial,'forward','tcp:0',`localabstract:${socketName}`],{timeout:10000});
    const match=String(output).trim().match(/(?:tcp:)?(\d{1,5})$/);port=match?Number(match[1]):NaN;
    if(!Number.isInteger(port)||port<1||port>65535)throw new Error('ADB 没有返回有效的本机转发端口');
    const response=await connect(port,sharedToken);
    if(!response||response.ok!==true)throw new Error(typeof response?.error==='string'?`布局 Agent：${response.error}`:'布局 Agent 采集失败');
    if(typeof response.xml!=='string'||response.xml.length>8*1024*1024||!response.xml.includes('<hierarchy'))throw new Error('布局 Agent 返回的层级无效或超过 8 MiB');
    let screenshot=null,imageSize=null;const warnings=[];
    if(typeof response.screenshot==='string'&&response.screenshot.length<=36*1024*1024){
      const png=Buffer.from(response.screenshot,'base64');
      if(png.length>=24&&png.subarray(0,8).toString('hex')==='89504e470d0a1a0a'){
        const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
        if(width>0&&height>0&&width*height<=50000000){screenshot=response.screenshot;imageSize={width,height};}
        else warnings.push('Agent 截图尺寸无效或超过 5,000 万像素');
      }else warnings.push('Agent 未返回有效 PNG 截图');
    }else warnings.push('截图不可用（安全窗口或文件超过 36 MiB）');
    if(typeof response.warning==='string'&&response.warning)warnings.push(response.warning);
    if(response.truncated===true)warnings.push('View 树达到 10,000 节点或 100 层采集上限');
    const densityOutput=await adb.shell(serial,['wm','density']).catch(()=>''),densities=[...densityOutput.matchAll(/(?:Physical|Override)\s+density:\s*(\d+)/g)].map(m=>Number(m[1])),densityDpi=densities.at(-1);
    return {xml:response.xml,screenshot,imageSize,densityDpi:Number.isSafeInteger(densityDpi)&&densityDpi>=72&&densityDpi<=1000?densityDpi:null,warning:warnings.length?warnings.join('；'):null,source:'agent',timestamp:Date.now(),serial,packageName,truncated:response.truncated===true,note:'应用内 Debug Agent View 树与应用窗口截图；不含 Compose 内部节点。节点字段比 UIAutomator 更丰富，截图仍受安全窗口与系统渲染限制。'};
  }finally{
    if(Number.isInteger(port))await adb.run(['-s',serial,'forward','--remove',`tcp:${port}`],{timeout:10000}).catch(()=>{});
  }
}
