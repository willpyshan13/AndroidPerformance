import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const exec=promisify(execFile);
const curl=['-fsSL','--retry','5','--retry-all-errors','--retry-delay','2','--connect-timeout','10'];

// Release-page redirects can fail with persistent gateway errors even when the
// same public asset is downloadable through GitHub's official asset API.
// Callers retain their pinned SHA-256 verification after either download path.
export async function downloadGithubReleaseAsset(url,destination,{runner=exec,timeout=250000,fetcher=fetch,token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN}={}){
 const options={timeout,maxBuffer:32*1024*1024,encoding:'utf8',windowsHide:true};
 try{return await runner('curl',[...curl,'--max-time',String(Math.max(1,Math.floor(timeout/1000)-10)),url,'-o',destination],options);}
 catch(error){
  if(!/\b50[234]\b|timed?\s*out|connection reset|curl: \((?:7|18|28|35|52|56)\)/i.test(String(error.stderr||error.message)))throw error;
  const parsed=new URL(url),match=parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/);
  if(parsed.protocol!=='https:'||parsed.hostname!=='github.com'||parsed.username||parsed.password||!match)throw error;
  const [,owner,repo,tag,filename]=match,api=`https://api.github.com/repos/${owner}/${repo}`;
  console.warn('GitHub release download failed; retrying the same artifact through the official asset API.');
  // Keep credentials out of child-process arguments and error command strings.
  // Fetch removes Authorization when a download redirects to another origin.
  const headers={'User-Agent':'AndroidPerformance-tool-preparation',...(token?{Authorization:`Bearer ${token}`}:{})};
  const metadata=await fetcher(`${api}/releases/tags/${encodeURIComponent(decodeURIComponent(tag))}`,{headers:{...headers,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(40000)});
  if(!metadata.ok)throw new Error(`Official GitHub release metadata returned HTTP ${metadata.status}`);
  const release=await metadata.json(),asset=release.assets?.find(item=>item.name===decodeURIComponent(filename));
  if(!asset||!Number.isSafeInteger(asset.id)||asset.id<=0||asset.url!==`${api}/releases/assets/${asset.id}`)throw new Error('Official GitHub release metadata did not contain the exact requested asset');
  const binary=await fetcher(asset.url,{headers:{...headers,Accept:'application/octet-stream'},signal:AbortSignal.timeout(timeout)});
  if(!binary.ok)throw new Error(`Official GitHub release asset returned HTTP ${binary.status}`);
  if(!binary.body)throw new Error('Official GitHub release asset returned an empty body');
  await pipeline(Readable.fromWeb(binary.body),createWriteStream(destination,{mode:0o600}));
 }
}
