import assert from 'node:assert/strict';
import { appendFile, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { analyzeApk, locateAapt2 } from '../src/apk.js';

const run = promisify(execFile);
const aapt2Path = process.env.AAPT2_PATH || await locateAapt2();
if (!aapt2Path) throw new Error('AAPT2 is not available');
console.log(`Using AAPT2: ${aapt2Path}`);
const temp = await mkdtemp(join(tmpdir(), 'apw-aapt2-smoke-'));
const manifestPath = join(temp, 'AndroidManifest.xml');
const apkPath = join(temp, 'sample.apk');
try {
  await writeFile(manifestPath, '<manifest package="dev.apw.smoke"><application/></manifest>');
  await run(aapt2Path, ['link', '--manifest', manifestPath, '-o', apkPath], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (process.env.APK_SMOKE_OUTPUT_PATH) {
    const outputPath = resolve(process.env.APK_SMOKE_OUTPUT_PATH);
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(apkPath, outputPath);
    console.log(`Generated APK fixture for packaged UI smoke: ${outputPath}`);
  }
  const result = await analyzeApk(apkPath, { fileName: 'sample.apk', aapt2Path });
  assert.equal(result.packageName, 'dev.apw.smoke');
  assert.ok(result.manifest);
  assert.ok(result.files.some(file => file.path === 'AndroidManifest.xml'));
  console.log(`Real AAPT2 APK analysis smoke passed: ${result.packageName}, ${result.fileCount} ZIP entries`);
} catch (error) {
  const detail = error?.stack || error?.message || String(error);
  const logPath = resolve(process.env.APK_SMOKE_LOG_PATH || 'dist/apw-apk-smoke.log');
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, `${detail}\n`, 'utf8');
  const message = error?.message || String(error);
  const failureCode = /dump badging/i.test(message) ? 'aapt2-dump-badging'
    : /dump xmltree/i.test(message) ? 'aapt2-dump-xmltree'
    : /\blink\b/i.test(message) ? 'aapt2-link-fixture'
    : /未返回有效 Manifest|Manifest 节点数量或深度超过限制/i.test(message) ? 'aapt2-manifest-output'
    : /AAPT2|aapt2/i.test(message) ? 'aapt2-analysis'
    : /APK ZIP|AndroidManifest|APK smoke/i.test(message) ? 'apk-input-or-generation'
    : 'apk-smoke-unknown';
  if (process.env.GITHUB_OUTPUT) try { await appendFile(process.env.GITHUB_OUTPUT, `failure_code=${failureCode}\n`, 'utf8'); } catch {}
  const safeDiagnostic = message.replace(/(?:[A-Za-z]:\\|\/)[^\s:]+/g, '<path>').replace(/\s+/g, ' ').slice(0, 500);
  console.error(`::error title=APK smoke diagnostic::${safeDiagnostic.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
  console.error(`APK smoke failed; diagnostic written to ${logPath}\n${detail}`);
  throw error;
} finally {
  await rm(temp, { recursive: true, force: true });
}
