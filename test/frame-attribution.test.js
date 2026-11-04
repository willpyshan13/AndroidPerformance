import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFrameAttribution } from '../public/frame-attribution.js';

test('frame attribution groups by Activity, Window, and UI state without inflating platform candidate counts', () => {
  const frames = [
    { pid: 10, startNs: '1000', uiDurationNs: '16000000', activity: 'Home', windowId: 'main', states: { Screen: 'home', Mode: 'ready' }, jank: true },
    { pid: 10, startNs: '2000', uiDurationNs: '16000000', activity: 'Home', windowId: 'main', states: { Mode: 'ready', Screen: 'home' }, jank: false },
    { pid: 10, startNs: '3000', uiDurationNs: '20000000', activity: 'Settings', windowId: 'main', states: { Screen: 'settings' }, jank: true },
  ];
  const correlation = { available: true, frames: [
    { pid: 10, startNs: '1000', candidateCount: 2, candidates: [{ timelineIndex: 4, jankType: 'App Deadline Missed' }, { timelineIndex: 5, jankType: 'None' }] },
    { pid: 10, startNs: '2000', candidateCount: 1, candidates: [{ timelineIndex: 4, jankType: 'App Deadline Missed' }] },
  ] };
  const groups = summarizeFrameAttribution(frames, correlation), home = groups.find(group => group.activity === 'Home'), settings = groups.find(group => group.activity === 'Settings');
  assert.equal(home.activity, 'Home');
  assert.deepEqual(home.states, { Mode: 'ready', Screen: 'home' });
  assert.equal(home.frameCount, 2);
  assert.equal(home.jankCount, 1);
  assert.equal(home.jankPercent, 50);
  assert.equal(home.matchedObservations, 2);
  assert.equal(home.ambiguousObservations, 1);
  assert.equal(home.platformFrameCandidates, 2);
  assert.equal(home.platformJankCandidates, 1);
  assert.deepEqual(home.platformJankTypes, ['App Deadline Missed']);
  assert.equal(settings.frameCount, 1);
  assert.equal(settings.jankPercent, 100);
  assert.equal(settings.matchedObservations, 0);
  assert.equal(settings.platformFrameCandidates, 0);
});

test('frame attribution marks candidate truncation and keeps unavailable platform evidence empty', () => {
  const frame = { pid: 10, startNs: '1000', uiDurationNs: '16000000', activity: 'Home', windowId: 'main', states: {}, jank: false };
  const [group] = summarizeFrameAttribution([frame], { available: true, frames: [{ pid: 10, startNs: '1000', candidateCount: 12, candidates: [{ timelineIndex: 1, jankType: 'SurfaceFlinger GPU Deadline Missed' }] }] });
  assert.equal(group.candidateTruncatedObservations, 1);
  assert.equal(group.platformFrameCandidates, 1);
  assert.equal(group.platformJankCandidates, 1);
  assert.deepEqual(summarizeFrameAttribution([frame], { available: false, frames: [] }), []);
});
