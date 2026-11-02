export function buildMenuTemplate({language='zh-CN',isMac=false,navigate=()=>{},chooseAdb=()=>{},openRecords=()=>{},openPerfetto=()=>{},about=()=>{}}={}) {
  const text=(zh,en)=>language==='en-US'?en:zh;
  return [
    ...(isMac?[{label:'Android Performance',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]}]:[]),
    {label:text('文件','File'),submenu:[
      {label:text('采集记录','Capture Sessions'),accelerator:'CmdOrCtrl+O',click:()=>navigate('sessions')},
      {label:text('打开记录目录','Open Records Folder'),click:openRecords},
      {label:text('选择 ADB 程序…','Select ADB Executable…'),click:chooseAdb},
      {type:'separator'},{role:isMac?'close':'quit',label:isMac?text('关闭窗口','Close Window'):text('退出','Quit')},
    ]},
    {label:text('编辑','Edit'),submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:text('分析','Analyze'),submenu:[
      ['overview','概览','Overview','1'],['monitor','实时监控','Live Monitor','2'],['frames','帧耗时分析','Frame Timing','3'],['startup','启动测试','Startup Tests','4'],['layout','布局检查','Layout Inspector','5'],['trace','系统追踪','System Trace','6'],['network','网络分析','Network Analysis','7'],['benchmark','基准对比','Benchmark','8'],
      ['apk','APK 分析','APK Analysis','9'],['cpu-profile','CPU 采样','CPU Sampling'],['heap','内存堆分析','Heap Profiler'],['battery','电池与资源','Battery & Resources'],['gpu','GPU 产物','GPU Artifacts'],['source','源码工作区','Source Workspace'],
    ].map(([route,zh,en,key])=>({label:text(zh,en),...(key?{accelerator:`CmdOrCtrl+${key}`} :{}),click:()=>navigate(route)}))},
    {label:text('视图','View'),submenu:[
      {role:'resetZoom',label:text('实际大小','Actual Size')},{role:'zoomIn',label:text('放大','Zoom In')},{role:'zoomOut',label:text('缩小','Zoom Out')},{type:'separator'},
      {role:'togglefullscreen',label:text('全屏','Toggle Full Screen')},
    ]},
    {label:text('窗口','Window'),submenu:[
      {role:'minimize',label:text('最小化','Minimize')},{role:'zoom',label:text('缩放','Zoom')},...(isMac?[{role:'front',label:text('全部置前','Bring All to Front')}]:[]),
    ]},
    {label:text('帮助','Help'),submenu:[
      {label:text('设置与帮助','Settings & Help'),accelerator:'CmdOrCtrl+,',click:()=>navigate('settings')},
      {label:text('打开 Perfetto UI','Open Perfetto UI'),click:openPerfetto},
      ...(!isMac?[{label:text('关于','About'),click:about}]:[]),
    ]},
  ];
}
