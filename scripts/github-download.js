import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const headers=['-H','User-Agent: AndroidPerformance-tool-preparation'];
const curl=['-fsSL','--retry','5','--retry-all-errors','--retry-delay','2','--connect-timeout','10'];

// Release-page redirects can fail with persistent gateway errors even when the
// same public asset is downloadable through GitHub's official asset API.
// Callers retain their pinned SHA-256 verification after either download path.
export async function downloadGithubReleaseAsset(url,destination,{runner=exec,timeout=250000}={}){
 const options={timeout,maxBuffer:32*1024*1024,encoding:'utf8',windowsHide:true};
 try{return await runner('curl',[...curl,'--max-time',String(Math.max(1,Math.floor(timeout/1000)-10)),url,'-o',destination],options);}
 catch(error){
  if(!/\b50[234]\b|timed?\s*out|connection reset|curl: \((?:7|18|28|35|52|56)\)/i.test(String(error.stderr||error.message)))throw error;
  const parsed=new URL(url),match=parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/);
  if(parsed.protocol!=='https:'||parsed.hostname!=='github.com'||parsed.username||parsed.password||!match)throw error;
  const [,owner,repo,tag,filename]=match,api=`https://api.github.com/repos/${owner}/${repo}`;
  console.warn('GitHub release download failed; retrying the same artifact through the official asset API.');
  const metadata=await runner('curl',[...curl,...headers,'--max-time','30',`${api}/releases/tags/${encodeURIComponent(decodeURIComponent(tag))}`],{...options,timeout:40000});
  const release=JSON.parse(metadata.stdout),asset=release.assets?.find(item=>item.name===decodeURIComponent(filename));
  if(!asset||!Number.isSafeInteger(asset.id)||asset.id<=0||asset.url!==`${api}/releases/assets/${asset.id}`)throw new Error('Official GitHub release metadata did not contain the exact requested asset');
  return runner('curl',[...curl,...headers,'-H','Accept: application/octet-stream','--max-time',String(Math.max(1,Math.floor(timeout/1000)-10)),asset.url,'-o',destination],options);
 }
}
