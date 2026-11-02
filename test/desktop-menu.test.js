import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildMenuTemplate} from '../desktop/menu.js';
import {nativeText} from '../desktop/locale.js';

function flatten(items){return items.flatMap(item=>[item.label||'',...(item.submenu?flatten(item.submenu):[])]);}

test('native desktop menu provides localized Chinese and English labels and navigation',()=>{
 const routes=[],zh=buildMenuTemplate({language:'zh-CN',navigate:route=>routes.push(route),isMac:false}),en=buildMenuTemplate({language:'en-US',navigate:route=>routes.push(route),isMac:false});
 assert.deepEqual(zh.map(item=>item.label),['文件','编辑','分析','视图','窗口','帮助']);
 assert.deepEqual(en.map(item=>item.label),['File','Edit','Analyze','View','Window','Help']);
 const english=flatten(en);
 assert.ok(english.includes('Settings & Help'));assert.ok(english.includes('Open Perfetto UI'));assert.ok(english.includes('APK Analysis'));assert.ok(english.includes('CPU Sampling'));
 assert.deepEqual(english.filter(label=>/[\u3400-\u9fff]/.test(label)),[]);
 en.find(item=>item.label==='Analyze').submenu.find(item=>item.label==='Overview').click();
 en.find(item=>item.label==='File').submenu.find(item=>item.label==='Capture Sessions').click();
 assert.deepEqual(routes,['overview','sessions']);
});

test('macOS menu keeps native application roles in both languages',()=>{
 const zh=buildMenuTemplate({language:'zh-CN',isMac:true}),en=buildMenuTemplate({language:'en-US',isMac:true});
 assert.equal(zh[0].label,'Android Performance');assert.equal(zh[0].submenu[0].role,'about');assert.equal(zh.find(item=>item.label==='文件').submenu.at(-1).role,'close');
 assert.equal(en[0].label,'Android Performance');assert.equal(en[0].submenu[0].role,'about');assert.equal(en.find(item=>item.label==='File').submenu.at(-1).role,'close');
});

test('native dialogs and validation messages follow the persisted desktop language',()=>{
 assert.equal(nativeText('zh-CN','选择本地源码目录','Select Local Source Directory'),'选择本地源码目录');
 assert.equal(nativeText('en-US','选择本地源码目录','Select Local Source Directory'),'Select Local Source Directory');
});

test('Electron restores the saved menu language and rebuilds the menu after language changes',async()=>{
 const main=await readFile(new URL('../desktop/main.js',import.meta.url),'utf8');
 assert.match(main,/appearanceLanguage=normalizeAppearance\(settings\)\.language/);
 assert.match(main,/installMenu\(appearanceLanguage\); createWindow\(\)/);
 assert.match(main,/await saveSettings\(appearance\);appearanceLanguage=appearance\.language;installMenu\(appearanceLanguage\)/);
 assert.match(main,/nativeText\(appearanceLanguage,'选择 Android Platform Tools 中的 adb 程序','Select adb from Android Platform Tools'\)/);
 assert.match(main,/nativeText\(appearanceLanguage,'该程序未返回有效 ADB 版本','The selected program did not return a valid ADB version'\)/);
 assert.match(main,/nativeText\(appearanceLanguage,'选择本地源码目录','Select Local Source Directory'\)/);
});
