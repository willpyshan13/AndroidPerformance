// Lengauer-Tarjan immediate dominators over a directed graph with a synthetic
// root at node 0. Iterative DFS/compression avoids overflowing the JS stack.
export function dominators(outgoing, weights, unknownBytes) {
  const n=outgoing.length;if(!n||weights.length!==n||unknownBytes.length!==n)throw new Error('引用图格式无效');
  const order=new Int32Array(n),vertex=new Int32Array(n+1),parent=new Int32Array(n+1);let count=1;order[0]=1;vertex[1]=0;
  const stack=[{node:0,next:0}];
  while(stack.length){const top=stack[stack.length-1],edges=outgoing[top.node];if(top.next>=edges.length){stack.pop();continue;}const v=edges[top.next++];if(!Number.isInteger(v)||v<0||v>=n)throw new Error('引用图节点无效');if(order[v])continue;order[v]=++count;vertex[count]=v;parent[count]=order[top.node];stack.push({node:v,next:0});}
  const pred=Array.from({length:count+1},()=>[]);
  for(let i=1;i<=count;i++){const node=vertex[i];for(const child of outgoing[node])if(order[child])pred[order[child]].push(i);}
  const semi=new Int32Array(count+1),ancestor=new Int32Array(count+1),label=new Int32Array(count+1),idom=new Int32Array(count+1),bucket=Array.from({length:count+1},()=>[]);
  for(let i=1;i<=count;i++)semi[i]=label[i]=i;
  function evaluate(v){if(!ancestor[v])return label[v];const path=[];let x=v;while(ancestor[x]&&ancestor[ancestor[x]]){path.push(x);x=ancestor[x];}for(let i=path.length-1;i>=0;i--){x=path[i];const p=ancestor[x];if(semi[label[p]]<semi[label[x]])label[x]=label[p];ancestor[x]=ancestor[p];}return label[v];}
  for(let w=count;w>=2;w--){for(const v of pred[w])semi[w]=Math.min(semi[w],semi[evaluate(v)]);bucket[semi[w]].push(w);ancestor[w]=parent[w];for(const v of bucket[parent[w]]){const u=evaluate(v);idom[v]=semi[u]<semi[v]?u:parent[w];}bucket[parent[w]]=[];}
  for(let w=2;w<=count;w++)if(idom[w]!==semi[w])idom[w]=idom[idom[w]];
  const dominated=new Float64Array(count+1),payload=new Float64Array(count+1),unknown=new Float64Array(count+1);
  for(let i=2;i<=count;i++){dominated[i]=1;payload[i]=weights[vertex[i]];unknown[i]=unknownBytes[vertex[i]];}
  for(let i=count;i>=2;i--){const p=idom[i];dominated[p]+=dominated[i];payload[p]+=payload[i];unknown[p]+=unknown[i];}
  return {count,vertex,order,idom,dominated,payload,unknown};
}
