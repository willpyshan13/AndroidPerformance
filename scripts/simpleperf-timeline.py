#!/usr/bin/env python3
"""Read bounded simpleperf sample evidence using the user's Android NDK report library."""
import json
import sys
from simpleperf_format import encode_frame

sys.path.insert(0, sys.argv[1])
from simpleperf_report_lib import ReportLib

record = sys.argv[2]
lib = ReportLib()
samples = []
frames_total = 0
first_event = None
clock_id = None
selected_event = sys.argv[3] if len(sys.argv) > 3 else None
symfs = sys.argv[4] if len(sys.argv) > 4 else None
event_counts = {}
events_truncated = False
truncated = False
try:
    if symfs:
        lib.SetSymfs(symfs)
    lib.SetRecordFile(record)
    trace_offcpu = bool(getattr(lib, 'GetSupportedTraceOffCpuModes', lambda: [])())
    if trace_offcpu:
        lib.SetTraceOffCpuMode('on-off-cpu')
    meta_info = getattr(lib, 'MetaInfo', lambda: {})()
    clock_id = meta_info.get('clockid') or None
    while True:
        sample = lib.GetNextSample()
        if sample is None:
            break
        event = lib.GetEventOfCurrentSample().name
        if first_event is None:
            first_event = event
        if event not in event_counts and len(event_counts) >= 128:
            events_truncated = True
        else:
            event_counts[event] = event_counts.get(event, 0) + 1
        if event != (selected_event or first_event):
            continue
        if len(samples) >= 50000:
            truncated = True
            continue
        chain = lib.GetCallChainOfCurrentSample()
        if frames_total + chain.nr + 1 > 500000:
            truncated = True
            continue
        symbols = [chain.entries[i].symbol for i in range(chain.nr)]
        frames = [encode_frame(symbol.symbol_name) for symbol in symbols]
        libraries = [symbol.dso_name or 'unknown' for symbol in symbols]
        frames.reverse()
        libraries.reverse()
        leaf = lib.GetSymbolOfCurrentSample()
        frames.append(encode_frame(leaf.symbol_name))
        libraries.append(leaf.dso_name or 'unknown')
        frames_total += len(frames)
        samples.append({'timeNs': str(sample.time), 'pid': sample.pid, 'tid': sample.tid,
                        'thread': encode_frame(sample.thread_comm), 'period': str(sample.period), 'frames': frames,
                        'libraries': libraries})
finally:
    lib.Close()
print(json.dumps({'event': selected_event or first_event, 'clockId': clock_id, 'traceOffCpu': trace_offcpu, 'events': [{'name': name, 'count': count} for name, count in event_counts.items()], 'eventsTruncated': events_truncated, 'samples': samples, 'truncated': truncated}, ensure_ascii=False))
