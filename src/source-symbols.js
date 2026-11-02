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
 const raw=symbol.trim();if(raw.includes('::'))throw new Error('当前候选定位仅支持 Java/Kotlin 符号；原生符号可使用文本搜索');
 let normalized=raw.replace(/\s*\([^)]*\).*$/,'').replace(/\+0x[\da-f]+$/i,'').trim().replace(/\$/g,'.');
 const parts=normalized.split('.');if(parts.some(p=>!/^[$A-Za-z_][\w$]*$/.test(p)))throw new Error('符号格式无法识别；可使用文本搜索');
 const method=parts.at(-1),isClass=/^[A-Z]/.test(method),className=isClass?method:parts.length>=2?parts.at(-2):null,packageName=isClass?(parts.length>=2?parts.slice(0,-1).join('.'):null):parts.length>=3?parts.slice(0,-2).join('.'):null;
 return {raw,normalized,method,className,packageName};
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
