import {test} from 'node:test';
import assert from 'node:assert/strict';
import {maskSource,parseSourceSymbol,findSourceDeclarations,findNativeSourceDeclarations,deobfuscateJavaMethod} from '../src/source-symbols.js';

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
 const native=parseSourceSymbol('demo::NativeWorker::run(int)');assert.equal(native.isNative,true);assert.equal(native.method,'run');assert.deepEqual(native.qualifiers,['demo','NativeWorker']);
 assert.throws(()=>parseSourceSymbol(''),/无效/);
});

test('native C++ declaration candidates match qualified definitions and ignore comments, strings and call sites',()=>{
 const text=`namespace demo {
class NativeWorker {
 public:
  void run(int value);
  void caller() { run(1); }
};
// void demo::NativeWorker::run(int value) {}
void demo::NativeWorker::run(int value) { const char* text = "void run("; }
}`;
 const matches=findNativeSourceDeclarations(text,'native.cpp',parseSourceSymbol('demo::NativeWorker::run(int)'));
 assert.deepEqual(matches.map(match=>match.line),[4,8]);
 assert.equal(matches[0].kind,'native-function');assert.equal(matches[0].score,80);
 assert.deepEqual(matches[0].reasons,['原生函数名匹配','作用域名匹配：demo::NativeWorker']);
 assert.throws(()=>parseSourceSymbol('native::operator<<'),/原生符号格式/);
});

test('R8 and ProGuard mappings resolve obfuscated Java frames and filter by obfuscated line range',()=>{
 const mapping=`com.example.Screen -> a.b:
    1:1:void render():42:42 -> a
    2:4:void other():50:52 -> b
com.example.Worker -> c:
    void run() -> a`;
 const matches=deobfuscateJavaMethod(mapping,'a.b.a(SourceFile:1)');
 assert.equal(matches.length,1);
 assert.deepEqual({originalClass:matches[0].originalClass,originalMethod:matches[0].originalMethod,obfuscatedClass:matches[0].obfuscatedClass,obfuscatedMethod:matches[0].obfuscatedMethod,obfuscatedStart:matches[0].obfuscatedStart,originalStart:matches[0].originalStart},{originalClass:'com.example.Screen',originalMethod:'render',obfuscatedClass:'a.b',obfuscatedMethod:'a',obfuscatedStart:1,originalStart:42});
 assert.equal(deobfuscateJavaMethod(mapping,'a.b.b(Foo.java:8)').length,0);
 assert.equal(deobfuscateJavaMethod(mapping,'c.a()')[0].originalMethod,'run');
 assert.equal(deobfuscateJavaMethod('com.example.Outer$Inner -> a.b$c:\n    void draw() -> a','a.b$c.a()')[0].originalClass,'com.example.Outer$Inner');
});
