import test from 'node:test';
import assert from 'node:assert/strict';
import {actionableRendererErrors} from '../scripts/desktop-smoke-errors.js';
const source=' (http://127.0.0.1:12345/perfetto-ui/v59.1/frontend_bundle.js:42309)';
test('desktop smoke accepts only expected local-only Perfetto CSP probe failures',()=>{
 const blocked=[
  "Connecting to 'http://127.0.0.1:9001/status' violates the following Content Security Policy directive: connect-src self",
  "Loading the script 'https://storage.cloud.google.com/perfetto-ui-internal/internal-data-v1/amalgamated.js' violates the following Content Security Policy directive: script-src self",
  "Fetch API cannot load https://perfetto-gae-internal.googleplex.com/extension_server_assets/manifest. Refused to connect because it violates the document's Content Security Policy.",
  'Ignoring message - document not ready yet.',
 ].map(message=>'Renderer console error: '+message+source).join('\r\n');
 assert.deepEqual(actionableRendererErrors(blocked),[]);
});
test('desktop smoke keeps main-app errors, viewer exceptions, and unrelated CSP failures',()=>{
 const errors=[
  'Renderer console error: TypeError: viewer crashed'+source,
  "Renderer console error: Connecting to 'https://unknown.example/' violates the following Content Security Policy directive: connect-src self"+source,
  'Renderer console error: unexpected 127.0.0.1:9001 error (http://127.0.0.1:12345/app.js:5)',
  'Renderer console error: TypeError while loading https://storage.cloud.google.com/perfetto-ui-internal/'+source,
 ];
 assert.deepEqual(actionableRendererErrors('Renderer console warning: ordinary message\n'+errors.join('\n')),errors);
});
