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
frame_addresses_total = 0
first_event = None
clock_id = None
selected_event = sys.argv[3] if len(sys.argv) > 3 else None
symfs = sys.argv[4] if len(sys.argv) > 4 else None
event_counts = {}
events_truncated = False
truncated = False
addresses_truncated = False
build_ids = {}

def native_address(symbol):
    value = getattr(symbol, 'vaddr_in_file', None)
    try:
        value = int(value)
        return format(value, 'x') if value >= 0 else None
    except (TypeError, ValueError):
        return None
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
        addresses = [native_address(symbol) for symbol in symbols]
        frames.reverse()
        libraries.reverse()
        addresses.reverse()
        leaf = lib.GetSymbolOfCurrentSample()
        frames.append(encode_frame(leaf.symbol_name))
        libraries.append(leaf.dso_name or 'unknown')
        addresses.append(native_address(leaf))
        if frame_addresses_total + len(addresses) <= 200000:
            frame_addresses_total += len(addresses)
        else:
            addresses = [None] * len(addresses)
            addresses_truncated = True
        for dso in set(libraries):
            if dso == 'unknown' or dso in build_ids or len(build_ids) >= 200:
                continue
            try:
                build_id = lib.GetBuildIdForPath(dso)
                if isinstance(build_id, bytes):
                    build_id = build_id.hex()
                if isinstance(build_id, str):
                    build_id = build_id.removeprefix('0x')
                    while len(build_id) > 8 and build_id.endswith('00000000'):
                        build_id = build_id[:-8]
                    if 8 <= len(build_id) <= 128 and all(c in '0123456789abcdefABCDEF' for c in build_id):
                        build_ids[dso] = build_id.lower()
            except Exception:
                pass
        frames_total += len(frames)
        samples.append({'timeNs': str(sample.time), 'pid': sample.pid, 'tid': sample.tid,
                        'thread': encode_frame(sample.thread_comm), 'period': str(sample.period), 'frames': frames,
                        'libraries': libraries, 'vaddrs': addresses})
finally:
    lib.Close()
print(json.dumps({'event': selected_event or first_event, 'clockId': clock_id, 'traceOffCpu': trace_offcpu, 'events': [{'name': name, 'count': count} for name, count in event_counts.items()], 'eventsTruncated': events_truncated, 'samples': samples, 'buildIds': build_ids, 'addressesTruncated': addresses_truncated, 'truncated': truncated}, ensure_ascii=False))
