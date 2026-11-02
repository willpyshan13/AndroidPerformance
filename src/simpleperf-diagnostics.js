// Parse only explicit counters emitted by simpleperf. Missing counters stay null;
// they are never inferred from the retained sample count.
export function parseSimpleperfDiagnostics(output = '') {
  const text = String(output).slice(0, 1024 * 1024);
  const diagnostics = {
    samplesRecorded: null,
    samplesCut: null,
    samplesLost: null,
    kernelSamplesLost: null,
    userSamplesLost: null,
    truncatedStacks: null,
    available: false,
  };
  const recorded = text.match(/Samples recorded:\s*([\d,]+)(?:\s*\(cut\s*([\d,]+)\))?/i);
  if (recorded) {
    diagnostics.samplesRecorded = Number(recorded[1].replaceAll(',', ''));
    if (recorded[2] !== undefined) diagnostics.samplesCut = Number(recorded[2].replaceAll(',', ''));
  }
  const lost = text.match(/Samples lost:\s*([\d,]+)(?:\s*\(kernelspace:\s*([\d,]+),\s*userspace:\s*([\d,]+)\))?/i);
  if (lost) {
    diagnostics.samplesLost = Number(lost[1].replaceAll(',', ''));
    if (lost[2] !== undefined) diagnostics.kernelSamplesLost = Number(lost[2].replaceAll(',', ''));
    if (lost[3] !== undefined) diagnostics.userSamplesLost = Number(lost[3].replaceAll(',', ''));
  }
  const truncated = text.match(/([\d,]+)\s+with truncated stacks/i);
  if (truncated) diagnostics.truncatedStacks = Number(truncated[1].replaceAll(',', ''));
  diagnostics.available = Object.keys(diagnostics).some(key => key !== 'available' && diagnostics[key] !== null);
  return diagnostics;
}
