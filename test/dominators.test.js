import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dominators,dominatorsCsr} from '../src/dominators.js';
test('dominator graph handles shared references, loops and inaccessible nodes',()=>{
 const edges=[[1,2],[3],[3,4],[4],[3],[]],w=Float64Array.from([0,1,2,3,4,5]);const r=dominators(edges,w,new Uint8Array(6));
 const dom=node=>r.vertex[r.idom[r.order[node]]];
 assert.equal(dom(1),0);assert.equal(dom(2),0);assert.equal(dom(3),0);assert.equal(dom(4),0);assert.equal(r.order[5],0);assert.equal(r.dominated[1],4);assert.equal(r.payload[1],10);
});
test('dominator computation agrees with an independent fixed-point oracle on small cyclic graphs',()=>{
 let seed=19;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
 for(let run=0;run<200;run++){
  const n=2+Math.floor(random()*10),edges=Array.from({length:n},()=>[]);for(let a=0;a<n;a++)for(let b=1;b<n;b++)if(random()<.18)edges[a].push(b);
  const r=dominators(edges,new Float64Array(n),new Uint8Array(n)),reachable=Array.from({length:n},(_,i)=>i).filter(i=>r.order[i]);
  const sets=Array.from({length:n},(_,i)=>new Set(i===0?[0]:reachable));let changed=true;
  while(changed){changed=false;for(const node of reachable.filter(i=>i!==0)){const preds=reachable.filter(p=>edges[p].includes(node));let intersection=new Set(sets[preds[0]]);for(const p of preds.slice(1))intersection=new Set([...intersection].filter(x=>sets[p].has(x)));intersection.add(node);if(intersection.size!==sets[node].size||[...intersection].some(x=>!sets[node].has(x))){sets[node]=intersection;changed=true;}}}
  for(const node of reachable.filter(i=>i!==0)){const actual=r.vertex[r.idom[r.order[node]]];const candidates=[...sets[node]].filter(v=>v!==node);const expected=candidates.find(v=>candidates.every(other=>other===v||sets[v].has(other)));assert.equal(actual,expected,`run ${run}, node ${node}`);}
 }
});
test('CSR dominators handle HPROF-sized graphs above the former 250k object limit',()=>{
 const n=300001,offsets=new Int32Array(n+1),edges=new Int32Array(n-1),weights=new Float64Array(n),unknown=new Uint8Array(n);
 for(let i=0;i<n;i++){offsets[i]=Math.min(i,n-1);if(i<n-1)edges[i]=i+1;weights[i]=1;}
 offsets[n]=n-1;
 const result=dominatorsCsr(offsets,edges,weights,unknown);
 assert.equal(result.count,n);assert.equal(result.dominated[1],n-1);assert.equal(result.payload[1],n-1);
 assert.equal(result.vertex[result.idom[n]],result.vertex[n-1]);
});
