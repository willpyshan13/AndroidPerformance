// The embedded upstream viewer probes optional external services. Our local-only
// CSP intentionally blocks those probes; trace opening and CSV transfer are
// checked separately by the desktop readiness gate.
export function actionableRendererErrors(output){
 return output.split(/\r?\n/).filter(line=>{
  if(!line.includes('Renderer console error:'))return false;
  const perfettoSource=/\(http:\/\/127\.0\.0\.1:\d+\/perfetto-ui\/[^\r\n]*:\d+\)$/.test(line);
  if(!perfettoSource)return true;
  if(line.includes('Renderer console error: Ignoring message - document not ready yet.'))return false;
  const optionalProbe=/(?:Connecting to '|Loading the script '|Fetch API cannot load )(?:http:\/\/127\.0\.0\.1:9001\/status|https:\/\/storage\.cloud\.google\.com\/perfetto-ui-internal\/|https:\/\/perfetto-gae-internal\.googleplex\.com\/extension_server_assets\/manifest)/.test(line);
  const blockedByCsp=/violates the following Content Security Policy directive|Refused to connect because it violates the document's Content Security Policy/.test(line);
  return !(optionalProbe&&blockedByCsp);
 });
}
