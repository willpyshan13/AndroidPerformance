#!/usr/bin/env python3
"""Convert simpleperf samples to folded stacks, including the sampled leaf."""
import collections
import sys
from simpleperf_format import encode_frame

sys.path.insert(0, sys.argv[1])
from simpleperf_report_lib import ReportLib

record = sys.argv[2]
selected = sys.argv[3] if len(sys.argv) > 3 else None
symfs = sys.argv[4] if len(sys.argv) > 4 else None
first = None
multiple = False
stacks = collections.Counter()

lib = ReportLib()
try:
    if symfs:
        lib.SetSymfs(symfs)
    lib.SetRecordFile(record)
    while True:
        sample = lib.GetNextSample()
        if sample is None:
            break
        event = lib.GetEventOfCurrentSample().name
        if first is None:
            first = event
        if not selected and event != first:
            multiple = True
        if event != (selected or first):
            continue
        chain = lib.GetCallChainOfCurrentSample()
        leaf = lib.GetSymbolOfCurrentSample()
        frames = [encode_frame(chain.entries[i].symbol.symbol_name) for i in range(chain.nr)]
        frames.reverse()
        frames.insert(0, '%s-%d/%d' % (encode_frame(sample.thread_comm), sample.pid, sample.tid))
        frames.append(encode_frame(leaf.symbol_name))
        stacks[';'.join(frames)] += sample.period
        if len(stacks) > 100000:
            raise ValueError('调用栈超过 100,000 行限制')
finally:
    lib.Close()
if multiple:
    print('包含多个采样事件；默认显示第一个事件：%s' % first, file=sys.stderr)
for stack, weight in sorted(stacks.items()):
    print('%s %d' % (stack, weight))
