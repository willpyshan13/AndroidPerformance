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
selected_event = sys.argv[3] if len(sys.argv) > 3 else None
symfs = sys.argv[4] if len(sys.argv) > 4 else None
event_counts = {}
events_truncated = False
truncated = False
try:
    if symfs:
        lib.SetSymfs(symfs)
    lib.SetRecordFile(record)
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
        frames = [encode_frame(chain.entries[i].symbol.symbol_name) for i in range(chain.nr)]
        frames.reverse()
        frames.append(encode_frame(lib.GetSymbolOfCurrentSample().symbol_name))
        frames_total += len(frames)
        samples.append({'timeNs': str(sample.time), 'pid': sample.pid, 'tid': sample.tid,
                        'thread': encode_frame(sample.thread_comm), 'period': str(sample.period), 'frames': frames})
finally:
    lib.Close()
print(json.dumps({'event': selected_event or first_event, 'events': [{'name': name, 'count': count} for name, count in event_counts.items()], 'eventsTruncated': events_truncated, 'samples': samples, 'truncated': truncated}, ensure_ascii=False))
