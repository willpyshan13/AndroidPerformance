import {win32} from 'node:path';

// Git Bash can prepend GNU tar to PATH. Its C: interpretation breaks Windows
// archive paths, so use the native Windows tar shipped with the operating system.
export function tarExecutable({platform=process.platform,env=process.env}={}){
 return platform==='win32'?win32.join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32','tar.exe'):'tar';
}
