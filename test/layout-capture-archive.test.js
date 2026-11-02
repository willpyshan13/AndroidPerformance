import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutCaptureArchive, parseLayoutCaptureArchive } from '../public/offline.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/tL8AAAAASUVORK5CYII=';

test('layout capture archive preserves XML, screenshot and safe metadata', () => {
  const source = {source:'agent',timestamp:1700000000000,serial:'device-1',packageName:'dev.sample',api:34,densityDpi:420,imageSize:{width:1,height:1},warning:null,note:'evidence note',xml:'<?xml version="1.0"?><hierarchy><node class="TextView"/></hierarchy>',screenshot:png};
  const archive = createLayoutCaptureArchive(source);
  assert.equal(archive.type,'android-performance-layout-capture');
  const restored = parseLayoutCaptureArchive(JSON.parse(JSON.stringify(archive)));
  assert.deepEqual(restored,{...source,source:'agent'});
});

test('layout capture archive rejects unsupported, oversized and malformed content', () => {
  assert.throws(() => parseLayoutCaptureArchive({schemaVersion:2,type:'android-performance-layout-capture',capture:{}}),/受支持/);
  assert.throws(() => createLayoutCaptureArchive({xml:'<hierarchy/>',screenshot:'not base64!'}),/编码无效/);
  const valid = createLayoutCaptureArchive({xml:'<hierarchy/>',screenshot:png,imageSize:{width:1,height:1}});
  valid.capture.imageSize.width = 2;
  assert.throws(() => parseLayoutCaptureArchive(valid),/尺寸与元数据不一致/);
  valid.capture.imageSize = {width:1,height:1};
  valid.capture.xml = `<hierarchy>${'x'.repeat(8*1024*1024)}</hierarchy>`;
  assert.throws(() => parseLayoutCaptureArchive(valid),/超过 8 MiB/);
});
