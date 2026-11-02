import {test} from 'node:test';
import assert from 'node:assert/strict';
import {traceEventWindow} from '../public/offline.js';

test('event windows preserve nanosecond precision and clamp to trace bounds',()=>{
 const bounds={startNs:'9007199254740000',endNs:'9007199354740000'};
 assert.deepEqual(traceEventWindow(bounds,'9007199255740000','10000000','20000000'),{startNs:bounds.startNs,endNs:'9007199285740000'});
 assert.deepEqual(traceEventWindow(bounds,'9007199353740000','500000','20000000'),{startNs:'9007199333740000',endNs:bounds.endNs});
 assert.throws(()=>traceEventWindow(bounds,'9007199450000000','1'),/范围/);
 assert.throws(()=>traceEventWindow(bounds,'3;drop','1'),/无效/);
});
