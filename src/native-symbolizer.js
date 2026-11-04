import {access,open,realpath,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename,dirname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile),MAX_ELF=512*1024*1024,MAX_NOTE=1024*1024;
const root=()=>process.resourcesPath?join(process.resourcesPath,'native-symbolizer','llvm-symbolizer'):join(dirname(dirname(fileURLToPath(import.meta.url))),'tools','native-symbolizer','llvm-symbolizer');
export async function locateLlvmSymbolizer({path=process.env.LLVM_SYMBOLIZER_PATH}={}){
 const candidates=[path,root()];for(const candidate of candidates.filter(Boolean))try{await access(candidate,constants.X_OK);return candidate;}catch{}
 throw new Error('未找到 LLVM symbolizer；请运行 npm run prepare:native-symbolizer 或设置 LLVM_SYMBOLIZER_PATH');
}

function parseOutput(output){
 const lines=String(output).replaceAll('\r','').split('\n'),frames=[];
 for(let i=0;i<lines.length;){
  while(i<lines.length&&!lines[i])i++;
  if(i>=lines.length)break;
  const functionName=lines[i++].slice(0,1000);
  if(i>=lines.length)break;
  const location=lines[i++].slice(0,4096),match=location.match(/^(.*?):(\d+)(?::(\d+))?$/);
  frames.push({function:functionName==='??'?null:functionName,source:match&&match[1]!=='??'?match[1]:null,line:match?Number(match[2]):null,column:match?.[3]?Number(match[3]):null});
  if(frames.length>=32)break;
 }
 return frames;
}

export async function readElfBuildId(handle,fileSize){
 const header=Buffer.alloc(64);if(fileSize<header.length||(await handle.read(header,0,header.length,0)).bytesRead<header.length||!header.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46])))return null;
 const elfClass=header[4],data=header[5];if(![1,2].includes(elfClass)||![1,2].includes(data))return null;
 const read16=(buffer,offset)=>data===1?buffer.readUInt16LE(offset):buffer.readUInt16BE(offset),read32=(buffer,offset)=>data===1?buffer.readUInt32LE(offset):buffer.readUInt32BE(offset),read64=(buffer,offset)=>Number(data===1?buffer.readBigUInt64LE(offset):buffer.readBigUInt64BE(offset));
 const phoff=elfClass===2?read64(header,32):read32(header,28),phentsize=read16(header,elfClass===2?54:42),phnum=read16(header,elfClass===2?56:44),minimum=elfClass===2?56:32;
 if(!Number.isSafeInteger(phoff)||phoff<0||phentsize<minimum||phnum>4096||phoff+phentsize*phnum>fileSize)return null;
 const phdrs=Buffer.alloc(phentsize*phnum);if(phdrs.length&&(await handle.read(phdrs,0,phdrs.length,phoff)).bytesRead!==phdrs.length)return null;
 for(let i=0;i<phnum;i++){
  const headerOffset=i*phentsize;if(read32(phdrs,headerOffset)!==4)continue;
  const start=elfClass===2?read64(phdrs,headerOffset+8):read32(phdrs,headerOffset+4),size=elfClass===2?read64(phdrs,headerOffset+32):read32(phdrs,headerOffset+16);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(size)||start<0||size<12||size>MAX_NOTE||start+size>fileSize)continue;
  const note=Buffer.alloc(size);if((await handle.read(note,0,size,start)).bytesRead!==size)continue;
  for(let cursor=0;cursor+12<=note.length;){
   const namesz=read32(note,cursor),descsz=read32(note,cursor+4),type=read32(note,cursor+8),nameStart=cursor+12,descStart=nameStart+((namesz+3)&~3),next=descStart+((descsz+3)&~3);
   if(next>note.length)break;
   if(namesz<=64&&descsz<=128&&type===3&&namesz===4&&note.subarray(nameStart,nameStart+3).toString('ascii')==='GNU'&&descsz>0)return note.subarray(descStart,descStart+descsz).toString('hex');
   cursor=next;
  }
 }
 return null;
}

export async function symbolizeNativeAddress({symfs,dso,address,expectedBuildId,locator=locateLlvmSymbolizer,runner=run}={}){
 if(typeof symfs!=='string'||symfs.length>4096||!symfs.startsWith('/')||/[\x00-\x1f\x7f]/.test(symfs))throw new Error('Native 符号目录必须为有效绝对路径');
 if(typeof dso!=='string'||dso.length>4096||!dso.startsWith('/')||dso.split(/[\\/]/).some(part=>part==='..')||/[\x00-\x1f\x7f]/.test(dso))throw new Error('Native 动态库路径无效');
 if(typeof address!=='string'||!(/^(?:0x)?[0-9a-f]{1,16}$/i).test(address))throw new Error('Native 指令地址无效');
 if(typeof expectedBuildId!=='string'||! /^[0-9a-f]{8,128}$/i.test(expectedBuildId))throw new Error('采样记录未包含该 ELF 的 Build ID；不能安全验证符号文件');
 const symbolizer=await locator(),symbolRoot=await realpath(symfs),relativeDso=dso.replace(/^[/\\]+/,'');
 const candidates=[join(symbolRoot,relativeDso),join(symbolRoot,basename(dso))];let elfPath=null,lastCandidateError=null;
 let actualBuildId=null;
 for(const candidate of candidates){try{const resolved=await realpath(candidate),rel=relative(symbolRoot,resolved);if(!rel||rel==='..'||rel.startsWith(`..${sep}`))continue;const info=await stat(resolved);if(!info.isFile()||info.size<4||info.size>MAX_ELF)continue;const handle=await open(resolved,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{actualBuildId=await readElfBuildId(handle,info.size);if(actualBuildId){elfPath=resolved;break;}}finally{await handle.close();}}catch(error){lastCandidateError=error;}}
 if(!elfPath)throw new Error(`符号目录中没有找到与 ${basename(dso)} 对应的 ELF 文件${lastCandidateError?`（${lastCandidateError.message}）`:''}`);
 if(actualBuildId.toLowerCase()!==expectedBuildId.toLowerCase())throw new Error('符号 ELF 的 Build ID 与采样记录不匹配；拒绝返回可能错误的源码行');
 const normalized=address.startsWith('0x')?address:`0x${address}`;let result;
 try{result=await runner(symbolizer,[`--obj=${elfPath}`,'--functions','--inlines','--demangle',normalized],{timeout:15000,maxBuffer:1024*1024,encoding:'utf8',windowsHide:true});}
 catch(error){throw new Error(`LLVM DWARF 查询失败：${String(error.stderr||error.message).slice(0,1000)}`);}
 const frames=parseOutput(result.stdout);return {dso:basename(dso),address:normalized,frames,hasSource:frames.some(frame=>frame.source&&frame.line),note:frames.some(frame=>frame.source&&frame.line)?'源码行来自 ELF DWARF 调试信息；请核对 Build ID 与目标 APK。':'该 ELF 没有可用的 DWARF 行表，或地址无法解析。'};
}
