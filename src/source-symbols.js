// Lightweight source-text heuristics, not a compiler or debug-symbol resolver.
// Erase comments and literals while preserving positions/newlines.
export function maskSource(text){
 let out='',state='code';
 for(let i=0;i<text.length;i++){
  const c=text[i],n=text[i+1],triple=text.slice(i,i+3)==='"""';
  if(state==='code'){
   if(c==='/'&&n==='/'){out+='  ';i++;state='line';continue;}
   if(c==='/'&&n==='*'){out+='  ';i++;state='block';continue;}
   if(triple){out+='   ';i+=2;state='triple';continue;}
   if(c==='"'||c==="'"){out+=' ';state=c;continue;}out+=c;continue;
  }
  if(state==='line'){if(c==='\n'){out+='\n';state='code';}else out+=' ';continue;}
  if(state==='block'){if(c==='*'&&n==='/'){out+='  ';i++;state='code';}else out+=c==='\n'?'\n':' ';continue;}
  if(state==='triple'){if(triple){out+='   ';i+=2;state='code';}else out+=c==='\n'?'\n':' ';continue;}
  if(c==='\\'&&n!==undefined){out+='  ';i++;continue;}if(c===state){out+=' ';state='code';}else out+=c==='\n'?'\n':' ';
 }
 return out;
}
export function parseSourceSymbol(symbol){
 if(typeof symbol!=='string'||!symbol.trim()||symbol.length>500)throw new Error('符号名称无效');
 const raw=symbol.trim();
 if(raw.includes('::')){
  const normalized=raw.replace(/\s*\([^)]*\).*$/,'').replace(/\+0x[\da-f]+$/i,'').trim(),parts=normalized.split('::');
  if(parts.length<2||parts.some(part=>!/^~?[A-Za-z_][\w$]*$/.test(part)))throw new Error('原生符号格式无法识别；可使用文本搜索');
  return {raw,normalized,method:parts.at(-1),className:parts.at(-2),qualifiers:parts.slice(0,-1),packageName:null,obfuscatedLine:null,isClass:false,isNative:true};
 }
 const obfuscatedLineMatch=raw.match(/\((?:[^():]*:)?(\d+)\)\s*$/),obfuscatedLine=obfuscatedLineMatch?Number(obfuscatedLineMatch[1]):null;
 let normalized=raw.replace(/\s*\([^)]*\).*$/,'').replace(/\+0x[\da-f]+$/i,'').trim().replace(/\$/g,'.');
 const parts=normalized.split('.');if(parts.some(p=>!/^[$A-Za-z_][\w$]*$/.test(p)))throw new Error('符号格式无法识别；可使用文本搜索');
 const method=parts.at(-1),isClass=/^[A-Z]/.test(method),className=isClass?method:parts.length>=2?parts.at(-2):null,packageName=isClass?(parts.length>=2?parts.slice(0,-1).join('.'):null):parts.length>=3?parts.slice(0,-2).join('.'):null;
 return {raw,normalized,method,className,packageName,obfuscatedLine,isClass};
}
const escapeRegExp=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function findSourceDeclarations(text,path,symbol){
 const masked=maskSource(text),lines=masked.split(/\r?\n/),original=text.split(/\r?\n/),pkg=masked.match(/^\s*package\s+([\w.]+)\s*;?/m)?.[1]||'';
 const classNames=new Set([...masked.matchAll(/\b(?:class|interface|object|enum)\s+([A-Za-z_$][\w$]*)/g)].map(m=>m[1]));
 const exactClass=symbol.className&&classNames.has(symbol.className),exactPackage=symbol.packageName&&pkg===symbol.packageName;
 const name=escapeRegExp(symbol.method),kt=new RegExp(`\\bfun\\s+(?:[\\w<>?.]+\\.)?${name}\\s*\\(`);
 const java=new RegExp(`^\\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\\s+)*(?:[\\w$<>\\[\\].?,]+\\s+)+${name}\\s*\\(`);
 const classDecl=new RegExp(`\\b(?:class|interface|object|enum)\\s+${name}\\b`);
 const results=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i],trim=line.trim();if(!trim||/^(return|throw|new)\b/.test(trim))continue;
  const kind=kt.test(line)?'kotlin-function':java.test(line)?'java-method':classDecl.test(line)?'class':null;if(!kind)continue;
  const reasons=['声明名匹配'];if(exactClass)reasons.push('文件中包含匹配类名');if(exactPackage)reasons.push('包名匹配');
  results.push({path,line:i+1,preview:original[i].slice(0,300),kind,packageName:pkg,score:20+(exactClass?30:0)+(exactPackage?50:0),reasons});
 }
 return results;
}
export function findNativeSourceDeclarations(text,path,symbol){
 const masked=maskSource(text),lines=masked.split(/\r?\n/),original=text.split(/\r?\n/),name=escapeRegExp(symbol.method);
 const declaration=new RegExp(`^\\s*(?:(?:inline|static|virtual|constexpr|consteval|extern|friend|explicit|register|thread_local)\\s+)*(?:[\\w~:<>,*&]+\\s+)+(?:(?:[\\w~]+)::)*${name}\\s*\\(`);
 const classes=new Set([...masked.matchAll(/\b(?:class|struct|union)\s+([A-Za-z_$][\w$]*)/g)].map(match=>match[1]));
 const namespaces=new Set([...masked.matchAll(/\bnamespace\s+([A-Za-z_$][\w$]*)/g)].map(match=>match[1]));
 const qualifiers=symbol.qualifiers||[],scopeMatches=qualifiers.filter(scope=>classes.has(scope)||namespaces.has(scope));
 const results=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i],trim=line.trim(),signature=lines.slice(i,i+12).join('\n');if(!trim||/^(?:return|throw|new)\b|^(?:public|private|protected)\s*:/.test(trim)||!declaration.test(signature))continue;
  const reasons=['原生函数名匹配'];if(scopeMatches.length)reasons.push(`作用域名匹配：${scopeMatches.join('::')}`);
  results.push({path,line:i+1,preview:original[i].slice(0,300),kind:'native-function',packageName:null,score:20+scopeMatches.length*30,reasons});
 }
 return results;
}
export function deobfuscateJavaMethod(mappingText,symbol){
 const parsed=typeof symbol==='string'?parseSourceSymbol(symbol):symbol;
 if(!parsed?.className||!parsed.method)return [];
 const obfuscatedClass=parsed.packageName?`${parsed.packageName}.${parsed.className}`:parsed.className,inputLine=parsed.obfuscatedLine||null,results=[];
 let current=null;const lines=String(mappingText).split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const line=lines[i],classMatch=line.match(/^\s*([^\s]+)\s+->\s+([^\s:]+):\s*$/);
  if(classMatch){current={originalClass:classMatch[1],obfuscatedClass:classMatch[2]};if(current.obfuscatedClass.replaceAll('$','.')===obfuscatedClass&&parsed.isClass)results.push({...current,originalMethod:null,line:i+1,raw:line});continue;}
  if(current?.obfuscatedClass.replaceAll('$','.')!==obfuscatedClass)continue;
  const arrow=line.lastIndexOf(' -> ');if(arrow<0)continue;
  const left=line.slice(0,arrow).trim(),obfuscatedMethod=line.slice(arrow+4).trim();if(!/^[A-Za-z_$][\w$]*$/.test(obfuscatedMethod)||obfuscatedMethod!==parsed.method)continue;
  const withoutObfuscatedRange=left.replace(/^\d+:\d+:/,'');const open=withoutObfuscatedRange.indexOf('('),close=withoutObfuscatedRange.indexOf(')',open+1);if(open<0||close<open)continue;
  const qualified=withoutObfuscatedRange.slice(0,open).trim().split(/\s+/).at(-1),originalMethod=qualified?.split('.').at(-1);if(!originalMethod)continue;
  const lineMap=left.match(/^(\d+):(\d+):/)||[],sourceLine=left.match(/\)(?::(\d+):(\d+))?\s*$/)||[];
  const obfuscatedStart=lineMap[1]?Number(lineMap[1]):null,obfuscatedEnd=lineMap[2]?Number(lineMap[2]):null,originalStart=sourceLine[1]?Number(sourceLine[1]):null,originalEnd=sourceLine[2]?Number(sourceLine[2]):null;
  if(inputLine!==null&&obfuscatedStart!==null&&(inputLine<obfuscatedStart||inputLine>obfuscatedEnd))continue;
  results.push({originalClass:current.originalClass,obfuscatedClass,originalMethod,obfuscatedMethod,line:i+1,obfuscatedStart,obfuscatedEnd,originalStart,originalEnd,raw:line});
 }
 return results;
}
