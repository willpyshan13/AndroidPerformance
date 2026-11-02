const themes=new Set(['system','light','dark']);
const scales=new Set(['0.9','1','1.1','1.2']);
const languages=new Set(['zh-CN','en-US']);

export function normalizeAppearance(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('外观设置格式无效');
  const result={};
  if(Object.hasOwn(value,'theme')){
    if(!themes.has(value.theme))throw new Error('主题选项无效');
    result.theme=value.theme;
  }
  if(Object.hasOwn(value,'scale')){
    const scale=String(value.scale);
    if(!scales.has(scale))throw new Error('界面缩放选项无效');
    result.scale=scale;
  }
  if(Object.hasOwn(value,'language')){
    if(!languages.has(value.language))throw new Error('语言选项无效');
    result.language=value.language;
  }
  if(!Object.keys(result).length)throw new Error('没有可保存的外观设置');
  return result;
}
