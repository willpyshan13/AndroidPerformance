import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseComposeCompilerReport} from '../public/offline.js';

test('Compose composables.txt captures restartable, skippable and unstable parameters',()=>{
 const text=`restartable skippable scheme("[androidx.compose.ui.UiComposable]") fun SnackCollection(\n  stable snackCollection: SnackCollection\n  unstable snacks: List<Snack>\n  stable onSnackClick: Function1<Long, Unit>\n  stable modifier: Modifier? = @static Companion\n)\nreadonly fun resources()\n`;
 const report=parseComposeCompilerReport(text,'app-release-composables.txt');
 assert.equal(report.type,'composables');assert.equal(report.summary.composables,2);assert.equal(report.summary.skippable,1);assert.equal(report.rows[0].name,'SnackCollection');assert.deepEqual(report.rows[0].unstableParameters,['snacks']);assert.equal(report.rows[0].hasDefaults,true);assert.equal(report.rows[1].readonly,true);
});

test('Compose classes.txt separates class and field stability evidence',()=>{
 const report=parseComposeCompilerReport(`unstable class Snack {\n  stable val id: Long\n  stable val name: String\n  unstable val tags: Set<String>\n  <runtime stability> = Unstable\n}\n`,'classes.txt');
 assert.equal(report.type,'classes');assert.equal(report.summary.unstable,1);assert.equal(report.summary.unstableFields,1);assert.deepEqual(report.rows[0].fields.at(-1),{stability:'unstable',name:'tags',type:'Set<String>'});assert.equal(report.rows[0].runtime,'<runtime stability> = Unstable');
});

test('Compose composables.csv reads real compiler columns, flags and invocation counts',()=>{
 const csv='package,name,composable,skippable,restartable,readonly,inline,isLambda,hasDefaults,defaultsGroup,groups,calls\ncom.example.ui,SnackCollection,1,0,1,0,0,0,0,0,1,3\ncom.example.ui,helper,0,0,0,0,0,0,0,0,1,1\n';
 const report=parseComposeCompilerReport(csv,'app-release-composables.csv');assert.equal(report.rows.length,1);assert.equal(report.rows[0].package,'com.example.ui');assert.equal(report.rows[0].calls,3);assert.equal(report.rows[0].restartable,true);assert.equal(report.rows[0].skippable,false);
});

test('Compose CSV accepts UTF-8 BOM and text reports reject incomplete signatures',()=>{
 const csv='\ufeffpackage,name,composable,skippable,restartable\napp.ui,Home,1,1,1\n';
 assert.equal(parseComposeCompilerReport(csv,'composables.csv').rows[0].name,'Home');
 assert.throws(()=>parseComposeCompilerReport('restartable skippable fun Broken(\n  stable value: String\n','composables.txt'),/未闭合/);
});

test('Compose report parser rejects malformed, oversized and non-report inputs',()=>{
 assert.throws(()=>parseComposeCompilerReport('package,name,composable,skippable,restartable\na,b,1,yes,1','x.csv'),/标志/);
 assert.throws(()=>parseComposeCompilerReport('package,name,composable,skippable,restartable\na,b,1,1,1,extra','x.csv'),/列数/);
 assert.throws(()=>parseComposeCompilerReport('nothing here','x.txt'),/无法识别/);
 assert.throws(()=>parseComposeCompilerReport('x'.repeat(12*1024*1024+1),'x.txt'),/超过/);
});
