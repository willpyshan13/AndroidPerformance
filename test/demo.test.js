import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoCpuTimeline} from '../public/demo.js';
import {buildSampleTimeline,parseFoldedStacks,sampleStackTimeline} from '../public/offline.js';

test('CPU demo fixture is deterministic, labeled, multi-threaded, and usable by the sampled stack views',()=>{
 const fixture=demoCpuTimeline(),again=demoCpuTimeline();
 assert.deepEqual(fixture,again);assert.equal(fixture.samples.length,240);assert.equal(fixture.event,'cpu-clock:u');assert.equal(fixture.clockId,'monotonic');
 assert.deepEqual([...new Set(fixture.samples.map(sample=>sample.thread))],['main','RenderThread','OkHttp']);
 assert.equal(fixture.samples[120].frames.length,90,'the midpoint sample exercises deep stack rendering and details');
 const timeline=buildSampleTimeline(fixture,48),folded=parseFoldedStacks(fixture.samples.map(sample=>`${[`${sample.thread}-${sample.pid}/${sample.tid}`,...sample.frames].join(';')} ${sample.period}`).join('\n'));
 assert.equal(timeline.samples.length,240);assert.equal(folded.stacks,240);assert.equal(sampleStackTimeline(timeline).entries.length,240);assert.ok(folded.root.weight>0);
});
