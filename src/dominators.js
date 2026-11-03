// Lengauer-Tarjan immediate dominators over a directed graph with a synthetic
// root at node 0. CSR adjacency and typed work arrays keep large heap graphs
// from allocating one JavaScript array per node or edge.
export function dominatorsCsr(offsets, edges, weights, unknownBytes) {
  const n=offsets.length-1;
  if(n<1||weights.length!==n||unknownBytes.length!==n||offsets[0]!==0||offsets[n]!==edges.length)throw new Error('引用图格式无效');
  for(let i=1;i<offsets.length;i++)if(offsets[i]<offsets[i-1]||offsets[i]>edges.length)throw new Error('引用图格式无效');
  const order=new Int32Array(n),vertex=new Int32Array(n+1),parent=new Int32Array(n+1);let count=1;order[0]=1;vertex[1]=0;
  const stackNode=new Int32Array(n),stackEdge=new Int32Array(n);let top=0;stackNode[0]=0;stackEdge[0]=offsets[0];
  while(top>=0){
    const node=stackNode[top],stop=offsets[node+1];let edge=stackEdge[top];
    if(edge>=stop){top--;continue;}
    stackEdge[top]=edge+1;const v=edges[edge];
    if(!Number.isInteger(v)||v<0||v>=n)throw new Error('引用图节点无效');
    if(order[v])continue;
    order[v]=++count;vertex[count]=v;parent[count]=order[node];
    stackNode[++top]=v;stackEdge[top]=offsets[v];
  }

  const predOffsets=new Int32Array(count+2);
  for(let i=1;i<=count;i++)for(let edge=offsets[vertex[i]];edge<offsets[vertex[i]+1];edge++){
    const targetOrder=order[edges[edge]];if(targetOrder)predOffsets[targetOrder+1]++;
  }
  for(let i=1;i<predOffsets.length;i++)predOffsets[i]+=predOffsets[i-1];
  const pred=new Int32Array(predOffsets[count+1]),write=predOffsets.slice(0,count+1);
  for(let i=1;i<=count;i++)for(let edge=offsets[vertex[i]];edge<offsets[vertex[i]+1];edge++){
    const targetOrder=order[edges[edge]];if(targetOrder)pred[write[targetOrder]++]=i;
  }

  const semi=new Int32Array(count+1),ancestor=new Int32Array(count+1),label=new Int32Array(count+1),idom=new Int32Array(count+1),bucketHead=new Int32Array(count+1),bucketNext=new Int32Array(count+1);
  for(let i=1;i<=count;i++)semi[i]=label[i]=i;
  function evaluate(v){
    if(!ancestor[v])return label[v];
    const path=[];let x=v;
    while(ancestor[x]&&ancestor[ancestor[x]]){path.push(x);x=ancestor[x];}
    for(let i=path.length-1;i>=0;i--){x=path[i];const p=ancestor[x];if(semi[label[p]]<semi[label[x]])label[x]=label[p];ancestor[x]=ancestor[p];}
    return label[v];
  }
  for(let w=count;w>=2;w--){
    for(let edge=predOffsets[w];edge<predOffsets[w+1];edge++){const v=pred[edge];semi[w]=Math.min(semi[w],semi[evaluate(v)]);}
    bucketNext[w]=bucketHead[semi[w]];bucketHead[semi[w]]=w;ancestor[w]=parent[w];
    let v=bucketHead[parent[w]];bucketHead[parent[w]]=0;
    while(v){const next=bucketNext[v],u=evaluate(v);idom[v]=semi[u]<semi[v]?u:parent[w];v=next;}
  }
  for(let w=2;w<=count;w++)if(idom[w]!==semi[w])idom[w]=idom[idom[w]];
  const dominated=new Float64Array(count+1),payload=new Float64Array(count+1),unknown=new Float64Array(count+1);
  for(let i=2;i<=count;i++){dominated[i]=1;payload[i]=weights[vertex[i]];unknown[i]=unknownBytes[vertex[i]];}
  for(let i=count;i>=2;i--){const p=idom[i];dominated[p]+=dominated[i];payload[p]+=payload[i];unknown[p]+=unknown[i];}
  return {count,vertex,order,idom,dominated,payload,unknown};
}

export function dominators(outgoing, weights, unknownBytes) {
  const n=outgoing.length;if(!n||weights.length!==n||unknownBytes.length!==n)throw new Error('引用图格式无效');
  let edgeCount=0;const offsets=new Int32Array(n+1);
  for(let i=0;i<n;i++){
    const edges=outgoing[i];if(!Array.isArray(edges))throw new Error('引用图格式无效');
    edgeCount+=edges.length;if(edgeCount>0x7fffffff)throw new Error('引用图边数超过计算上限');offsets[i+1]=edgeCount;
  }
  const edges=new Int32Array(edgeCount);let cursor=0;
  for(const list of outgoing)for(const node of list)edges[cursor++]=node;
  return dominatorsCsr(offsets,edges,weights,unknownBytes);
}
