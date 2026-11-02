import {test} from 'node:test';
import assert from 'node:assert/strict';
import {maskSource,parseSourceSymbol,findSourceDeclarations} from '../src/source-symbols.js';

test('symbol declarations ignore comments, strings and ordinary call sites',()=>{
 const text=`package com.example;
 class Screen {
 // fun render() {}
 String message = "fun render()";
 void caller() { render(); }
 public void render() {}
 }`;
 const found=findSourceDeclarations(text,'Screen.java',parseSourceSymbol('com.example.Screen.render()'));
 assert.deepEqual(found.map(x=>x.line),[6]);
 assert.deepEqual(found[0].reasons,['声明名匹配','文件中包含匹配类名','包名匹配']);
 assert.equal(maskSource(text).split('\n').length,text.split('\n').length);
});

test('Kotlin overloads and class names yield candidates without pretending to identify the overload',()=>{
 const text='package com.example\nclass Screen {\n fun render(x: Int) {}\n fun render(x: String) {}\n}';
 assert.deepEqual(findSourceDeclarations(text,'Screen.kt',parseSourceSymbol('com.example.Screen.render(int)')).map(x=>x.line),[3,4]);
 const cls=findSourceDeclarations(text,'Screen.kt',parseSourceSymbol('com.example.Screen'));
 assert.equal(cls[0].line,2);assert.equal(cls[0].score,100);
 assert.throws(()=>parseSourceSymbol('native::method'),/原生符号/);
 assert.throws(()=>parseSourceSymbol(''),/无效/);
});
