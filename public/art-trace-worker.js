import {parseArtMethodTrace} from './offline.js';

self.onmessage=event=>{
  try { self.postMessage({ok:true,result:parseArtMethodTrace(event.data)}); }
  catch(error) { self.postMessage({ok:false,error:String(error?.message||error).slice(0,1200)}); }
};
