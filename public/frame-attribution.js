export function summarizeFrameAttribution(jankFrames, correlation) {
  if (!Array.isArray(jankFrames) || !correlation?.available || !Array.isArray(correlation.frames)) return [];
  const matches = new Map(correlation.frames.map(frame => [`${frame.pid}:${frame.startNs}`, frame]));
  const groups = new Map();
  for (const frame of jankFrames) {
    if (!frame || !Number.isSafeInteger(frame.pid) || typeof frame.startNs !== 'string' || typeof frame.uiDurationNs !== 'string') continue;
    const states = frame.states && typeof frame.states === 'object' && !Array.isArray(frame.states) ? frame.states : {};
    const stateEntries = Object.entries(states).sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([frame.activity || '', frame.windowId || '', stateEntries]);
    let group = groups.get(key);
    if (!group) {
      group = { activity: frame.activity || '', windowId: frame.windowId || '', states: Object.fromEntries(stateEntries), frameCount: 0, jankCount: 0, matchedObservations: 0, ambiguousObservations: 0, candidateTruncatedObservations: 0, platformFrames: new Map() };
      groups.set(key, group);
    }
    group.frameCount++;
    if (frame.jank === true) group.jankCount++;
    const matched = matches.get(`${frame.pid}:${frame.startNs}`);
    if (!matched) continue;
    group.matchedObservations++;
    if (matched.candidateCount > 1) group.ambiguousObservations++;
    if (matched.candidateCount > matched.candidates.length) group.candidateTruncatedObservations++;
    for (const candidate of matched.candidates) {
      if (!Number.isSafeInteger(candidate.timelineIndex) || candidate.timelineIndex < 0) continue;
      if (!group.platformFrames.has(candidate.timelineIndex)) group.platformFrames.set(candidate.timelineIndex, candidate);
    }
  }
  return [...groups.values()].map(group => {
    const candidates = [...group.platformFrames.values()];
    const platformJankCandidates = candidates.filter(frame => frame.jankType && frame.jankType !== 'None');
    return {
      activity: group.activity,
      windowId: group.windowId,
      states: group.states,
      frameCount: group.frameCount,
      jankCount: group.jankCount,
      jankPercent: group.frameCount ? group.jankCount / group.frameCount * 100 : 0,
      matchedObservations: group.matchedObservations,
      ambiguousObservations: group.ambiguousObservations,
      candidateTruncatedObservations: group.candidateTruncatedObservations,
      platformFrameCandidates: candidates.length,
      platformJankCandidates: platformJankCandidates.length,
      platformJankTypes: [...new Set(platformJankCandidates.map(frame => frame.jankType))].sort(),
    };
  }).sort((a, b) => b.jankPercent - a.jankPercent || b.platformJankCandidates - a.platformJankCandidates || a.activity.localeCompare(b.activity));
}
