import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layoutScope,extractLayoutNodes,compareLayouts,summarizeLayoutChanges,layoutComparisonReport,inspectLayout} from '../public/offline.js';
test('layout extraction rejects partial node counts and depths at their exact boundaries',()=>{
 const element=(tag,attrs={},children=[])=>({tagName:tag,attributes:Object.entries(attrs).map(([name,value])=>({name,value})),children});
 const node=(children=[])=>element('node',{class:'android.view.View',bounds:'[1,2][3,4]'},children);
 const root=element('hierarchy',{},[node([node()]),node()]);
 const parsed=extractLayoutNodes(root,{maxNodes:3,maxDepth:1});assert.deepEqual(parsed.map(x=>x.depth),[0,1,0]);assert.deepEqual(parsed[0].bounds,[1,2,3,4]);
 assert.throws(()=>extractLayoutNodes(root,{maxNodes:2,maxDepth:1}),/节点超过 2/);
 assert.throws(()=>extractLayoutNodes(root,{maxNodes:3,maxDepth:0}),/深度超过 0/);
});
test('layout findings respect descendant labels, unknown fields, disabled nodes and empty bounds',()=>{
 const n=(id,depth,extra={},bounds=[0,0,100,100])=>({id,depth,bounds,attributes:{text:'','content-desc':'',...extra}});
 const nodes=[n(0,0),n(1,1,{clickable:'true'}),n(2,2,{text:'Child label'}),n(3,1,{clickable:'true'}),n(4,1,{clickable:'true','content-desc':undefined}),n(5,1,{clickable:'true',enabled:'false'},[0,0,0,10]),n(6,1,{clickable:'true',text:'  '},[1,2,1,20]),n(7,1,{clickable:'true',text:'Known'},[0,0,0,1]),n(8,1,{clickable:'true'}),n(9,2,{'content-desc':undefined})];
 assert.deepEqual(inspectLayout(nodes),[{id:3,kind:'unlabelled'},{id:6,kind:'unlabelled'},{id:6,kind:'emptyBounds'},{id:7,kind:'emptyBounds'}]);
});
test('touch target findings use device density and skip disabled or incomplete dimensions',()=>{
 const node=(id,bounds,extra={})=>({id,depth:0,bounds,attributes:{text:'Button','content-desc':'',clickable:'true',...extra}});
 const nodes=[node(0,[0,0,120,180]),node(1,[0,0,144,144]),node(2,[0,0,80,80],{enabled:'false'}),node(3,null),node(4,[0,0,120,180],{'long-clickable':'true',clickable:'false'})];
 assert.deepEqual(inspectLayout(nodes,{densityDpi:480}).filter(x=>x.kind==='smallTouchTarget'),[
  {id:0,kind:'smallTouchTarget',widthDp:40,heightDp:60},
  {id:4,kind:'smallTouchTarget',widthDp:40,heightDp:60}
 ]);
 assert.equal(inspectLayout([node(0,[0,0,120,180])]).some(x=>x.kind==='smallTouchTarget'),false);
 assert.equal(inspectLayout([node(0,[0,0,120,180])],{densityDpi:NaN}).some(x=>x.kind==='smallTouchTarget'),false);
});
test('layout isolation keeps exactly the selected subtree and its original IDs',()=>{
 const nodes=[{id:0,depth:0},{id:1,depth:1},{id:2,depth:2},{id:3,depth:2},{id:4,depth:1},{id:5,depth:2}];
 assert.deepEqual(layoutScope(nodes,1).map(n=>n.id),[1,2,3]);
 assert.deepEqual(layoutScope(nodes,4).map(n=>n.id),[4,5]);
 assert.deepEqual(layoutScope(nodes,2).map(n=>n.id),[2]);
 assert.deepEqual(layoutScope(nodes,99),[]);
 assert.equal(layoutScope(nodes),nodes);
});

test('layout comparison pairs only unique package/resource IDs and reports uncertainty',()=>{
 const n=(id,text,pkg='app')=>({id:0,depth:0,attributes:{package:pkg,'resource-id':id,text}});
 const before=[n('title','old'),n('gone','x'),n('repeat','a'),n('repeat','b'),n('','unknown')];
 const after=[n('title','new'),n('added','x'),n('repeat','c'),n('','unknown')];
 const result=compareLayouts(before,after);
 assert.deepEqual(result.changes.map(x=>[x.id,x.kind]),[['title','changed'],['gone','removed'],['added','added']]);
 assert.deepEqual(result.changes[0].fields,['text']);assert.deepEqual(result.ambiguous,['repeat']);
 assert.equal(result.unkeyedBefore,1);assert.equal(result.unkeyedAfter,1);
});

test('layout timeline summary separates additions, removals, changes and ambiguous IDs',()=>{
 const node=(id,text)=>({id:0,depth:0,attributes:{package:'app','resource-id':id,text}});
 assert.deepEqual(summarizeLayoutChanges([node('same','old'),node('gone','x'),node('repeat','a'),node('repeat','b')],[node('same','new'),node('added','y'),node('repeat','c')]),{added:1,removed:1,changed:1,ambiguous:1});
});

test('layout comparison detects moves between shared unique ancestors without guessing unkeyed containers',()=>{
 const n=(id,depth)=>({id:0,depth,attributes:{package:'app','resource-id':id}});
 const before=[n('root',0),n('left',1),n('',2),n('item',3),n('right',1)];
 const after=[n('root',0),n('left',1),n('right',1),n('',2),n('item',3)];
 const result=compareLayouts(before,after),item=result.changes.find(c=>c.id==='item');
 assert.equal(item.moved,true);assert.equal(item.oldParent,'left');assert.equal(item.newParent,'right');assert.deepEqual(item.fields,[]);
 const throughUnkeyed=compareLayouts([n('root',0),n('',1),n('item',2)],[n('root',0),n('',1),n('',2),n('item',3)]);
 assert.equal(throughUnkeyed.changes.length,0);
});

test('repeated resource IDs can be compared as candidates within unique shared ancestor scopes',()=>{
 const n=(id,depth,text='')=>({id:0,depth,attributes:{package:'app','resource-id':id,text}});
 const before=[n('root',0),n('left',1),n('label',2,'old left'),n('right',1),n('label',2,'old right')];
 const after=[n('root',0),n('left',1),n('label',2,'new left'),n('right',1),n('label',2,'new right')];
 const result=compareLayouts(before,after);assert.deepEqual(result.changes.map(c=>[c.id,c.matchScope,c.before.attributes.text,c.after.attributes.text]),[['label','left','old left','new left'],['label','right','old right','new right']]);assert.deepEqual(result.ambiguous,[]);
 const duplicated=[n('root',0),n('left',1),n('label',2,'a'),n('label',2,'b'),n('right',1),n('label',2,'c')];
 const partial=compareLayouts(duplicated,after);assert.deepEqual(partial.changes.filter(c=>c.id==='label').map(c=>c.matchScope),['right']);assert.deepEqual(partial.ambiguous,['label']);
});

test('layout sibling reorder marks inversions but not insertions or uncertain parents',()=>{
 const n=(id,depth)=>({id:0,depth,attributes:{package:'app','resource-id':id}});
 const before=[n('root',0),n('a',1),n('b',1),n('c',1)];
 const reordered=[n('root',0),n('b',1),n('a',1),n('c',1)];
 assert.deepEqual(compareLayouts(before,reordered).changes.filter(c=>c.orderChanged).map(c=>c.id),['a','b']);
 const inserted=[n('root',0),n('added',1),n('a',1),n('b',1),n('c',1)];
 assert.deepEqual(compareLayouts(before,inserted).changes.filter(c=>c.orderChanged),[]);
 const uncertainBefore=[n('root',0),n('',1),n('a',2),n('b',2)];
 const uncertainAfter=[n('root',0),n('',1),n('b',2),n('a',2)];
 assert.deepEqual(compareLayouts(uncertainBefore,uncertainAfter).changes.filter(c=>c.orderChanged),[]);
});

test('layout comparison export preserves both snapshots provenance and complete diff',()=>{
 const n=(id,text)=>({id:0,depth:0,attributes:{package:'app','resource-id':id,text}});
 const baseline={name:'before',source:'adb',timestamp:12,nodes:[n('title','old')]};
 const current={source:'import',timestamp:34,nodes:[n('title','new'),n('new','x')]};
 const report=JSON.parse(JSON.stringify(layoutComparisonReport(baseline,current,56)));
 assert.deepEqual(report.baseline,{name:'before',source:'adb',timestamp:12,nodeCount:1});
 assert.deepEqual(report.current,{name:null,source:'import',timestamp:34,nodeCount:2});
 assert.equal(report.generatedAt,56);assert.equal(report.changes.length,2);
 assert.equal(report.changes[0].before.attributes.text,'old');assert.equal(report.changes[0].after.attributes.text,'new');
 assert.match(report.limitations,/不一定完整/);
 assert.throws(()=>layoutComparisonReport({},current),/两份布局快照/);
});
