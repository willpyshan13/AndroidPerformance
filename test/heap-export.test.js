import test from 'node:test';
import assert from 'node:assert/strict';
import {formatHeapCsv, formatHeapMarkdown, formatHeapJson} from '../public/heap-export.js';

test('heap class CSV includes UTF-8 BOM and byte-size caveat',()=>{
  const csv=formatHeapCsv('classes',[['com.example.Foo',12,345]]);
  assert.ok(csv.startsWith('\uFEFF# Byte values are HPROF field/element payload only'));
  assert.match(csv,/"Class","Object count","Field \/ element payload bytes"/);
  assert.match(csv,/"com\.example\.Foo","12","345"/);
  assert.match(csv,/not shallow or retained size/);
});

test('heap comparison CSV escapes cells and guards spreadsheet formulas',()=>{
  const csv=formatHeapCsv('comparison',[[ '=HYPERLINK("https://bad")',1,2,1,100,128,100,'yes' ],['Foo, Bar',null,null,null,null,null,null,'no']]);
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"https://bad\"\")\""));
  assert.match(csv,/"Foo, Bar","","","","","","","no"/);
  assert.match(csv,/"Comparable"/);
  assert.match(csv,/ambiguous rows are marked not comparable/);
});

test('heap class Markdown exports rows and explains payload byte limits',()=>{
  const markdown=formatHeapMarkdown('classes',[['com.example.Foo',12,345]]);
  assert.match(markdown,/^# HPROF class statistics/);
  assert.match(markdown,/\| Class \| Object count \| Field \/ element payload bytes \|/);
  assert.match(markdown,/\| com\.example\.Foo \| 12 \| 345 \|/);
  assert.match(markdown,/not shallow or retained size/);
});

test('heap comparison Markdown escapes table cells and preserves ambiguity markers',()=>{
  const markdown=formatHeapMarkdown('comparison',[[ 'Foo|Bar\nBaz',null,null,null,null,null,null,'no' ]]);
  assert.match(markdown,/\| Foo\\\|Bar<br>Baz \| — \| — \| — \| — \| — \| — \| no \|/);
  assert.match(markdown,/ambiguous rows are marked not comparable/);
});

test('heap JSON uses stable column keys and explicit comparison ambiguity',()=>{
  const classes=JSON.parse(formatHeapJson('classes',[['com.example.Foo',12,345]]));
  assert.equal(classes.schemaVersion,1);
  assert.deepEqual(classes.rows[0],{className:'com.example.Foo',objectCount:12,fieldElementPayloadBytes:345});
  const comparison=JSON.parse(formatHeapJson('comparison',[[ 'Foo', '', '', '', '', '', '', 'no' ],[ 'Bar', 1, 3, 2, 200, 64, 100, 'yes' ]]));
  assert.deepEqual(comparison.rows[0],{className:'Foo',baselineObjectCount:null,currentObjectCount:null,objectCountDelta:null,objectCountDeltaPercent:null,fieldElementBytesDelta:null,fieldElementBytesDeltaPercent:null,comparable:false});
  assert.equal(comparison.rows[1].objectCountDelta,2);
  assert.equal(comparison.rows[1].comparable,true);
  assert.match(comparison.notes.join(' '),/not shallow or retained size/);
});
