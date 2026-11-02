import test from 'node:test';
import assert from 'node:assert/strict';
import {formatHeapCsv} from '../public/heap-export.js';

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
