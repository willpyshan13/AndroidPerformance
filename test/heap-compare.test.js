import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareHeaps} from '../public/offline.js';
const row=(name,id,count,payloadBytes)=>({name,id,count,payloadBytes});
test('heap comparison uses class names rather than unstable object IDs and includes new or removed classes',()=>{
 const a={idSize:4,classes:[row('Foo','001',2,20),row('Removed','002',3,30)]};
 const b={idSize:4,classes:[row('Foo','999',4,50),row('New','003',1,8)]};
 const result=compareHeaps(a,b);
 assert.deepEqual(result.find(x=>x.name==='Foo'),{name:'Foo',ambiguous:false,baseline:2,current:4,countDelta:2,bytesDelta:30,currentId:'999'});
 assert.equal(result.find(x=>x.name==='Removed').countDelta,-3);
 assert.equal(result.find(x=>x.name==='New').countDelta,1);
});
test('ambiguous names and different ID widths are not silently treated as comparable',()=>{
 const a={idSize:4,classes:[row('Foo','1',2,20),row('Foo','2',3,30),row('Bar','3',4,40)]};
 const b={idSize:8,classes:[row('Foo','4',5,50),row('Bar','5',6,60)]};
 const rows=compareHeaps(a,b);assert.equal(rows.find(x=>x.name==='Foo').countDelta,null);
 const bar=rows.find(x=>x.name==='Bar');assert.equal(bar.countDelta,2);assert.equal(bar.bytesDelta,null);
});
