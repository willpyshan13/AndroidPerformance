import test from 'node:test';
import assert from 'node:assert/strict';
import {formatTraceQueryCsv} from '../public/trace-export.js';

test('trace SQL CSV exports headers, exact string values and embedded line breaks',()=>{
  const csv=formatTraceQueryCsv(['name','count'],[['render, frame',2],['line one\nline two',0]]);
  assert.ok(csv.startsWith('\uFEFF"name","count"\r\n'));
  assert.match(csv,/"render, frame","2"/);
  assert.match(csv,/"line one\nline two","0"/);
});

test('trace SQL CSV escapes quotes and neutralizes spreadsheet formulas',()=>{
  const csv=formatTraceQueryCsv(['value'],[['=HYPERLINK("https://bad")'],[' @SUM(A1:A2)']]);
  assert.match(csv,/"'=HYPERLINK\(""https:\/\/bad""\)"/);
  assert.match(csv,/"' @SUM\(A1:A2\)"/);
});

test('trace SQL CSV rejects malformed or over-limit results',()=>{
  assert.throws(()=>formatTraceQueryCsv([],[]),/bounds/);
  assert.throws(()=>formatTraceQueryCsv(Array(51).fill('column'),[]),/bounds/);
  assert.throws(()=>formatTraceQueryCsv(['value'],Array(501).fill(['x'])),/bounds/);
  assert.throws(()=>formatTraceQueryCsv(['a','b'],[['only one']]),/do not match/);
});
