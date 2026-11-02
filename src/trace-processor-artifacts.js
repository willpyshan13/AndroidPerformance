// SHA-256 values are pinned from the official Perfetto v59.1 prebuilts manifest.
// https://github.com/google/perfetto/blob/main/tools/cpu_profile
const artifacts={
 'darwin/arm64':{name:'trace_processor_shell',arch:'mac-arm64',sha256:'8488edbefadfc4be152cda1d42d9bfcede8b47638295eb85eb3bad8cd148fdf4'},
 'darwin/x64':{name:'trace_processor_shell',arch:'mac-amd64',sha256:'df38039845244c353c399994748599345cf08f740491b5832e7feb9a4dbcc476'},
 'linux/x64':{name:'trace_processor_shell',arch:'linux-amd64',sha256:'2434129a3af4dc9e2034a476f7b76447b490975213e301769310d3bd0d5d6458'},
 'linux/arm64':{name:'trace_processor_shell',arch:'linux-arm64',sha256:'a08e4836171c87be3ba5834eef3489aa8803476d35f292ed7feaccae252747d0'},
 'win32/x64':{name:'trace_processor_shell.exe',arch:'windows-amd64',sha256:'3acc5aca1c764541033a82ba3bb0a47524b5c3c0aa194eea8d9a7b0cdb346bdc'}
};
export function traceProcessorArtifact(platform=process.platform,arch=process.arch){
 const item=artifacts[`${platform}/${arch}`];
 if(!item)throw new Error(`当前平台 ${platform}/${arch} 没有已校验的 Trace Processor v59.1 构建`);
 return {version:'v59.1',...item,url:`https://commondatastorage.googleapis.com/perfetto-luci-artifacts/v59.1/${item.arch}/${item.name}`};
}
