export function zipFixture(entries) {
  const locals=[],centrals=[];let offset=0;
  for(const [name,content] of entries){
    const filename=Buffer.from(name),data=Buffer.from(content),header=Buffer.alloc(30),central=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    locals.push(header,filename,data);centrals.push(central,filename);offset+=header.length+filename.length+data.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
export function dexFixture() {
  const b=Buffer.alloc(112);b.write('dex\n035\0',0,'ascii');b.writeUInt32LE(112,32);b.writeUInt32LE(112,36);b.writeUInt32LE(0x12345678,40);b.writeUInt32LE(25,56);b.writeUInt32LE(7,64);b.writeUInt32LE(12,88);b.writeUInt32LE(3,96);return b;
}
export const BADGING="package: name='com.test.apk' versionCode='7' versionName='1.2.3' compileSdkVersion='36'\napplication-label:'测试 & App'\nminSdkVersion:'23'\ntargetSdkVersion:'33'\n";
export const TREE=`N: android=http://schemas.android.com/apk/res/android
  E: manifest (line=2)
    A: package="com.test.apk"
    A: http://schemas.android.com/apk/res/android:versionCode(0x0101021b)=7
    E: uses-sdk (line=3)
      A: android:minSdkVersion(0x0101020c)=(type 0x10)0x17
      A: android:targetSdkVersion(0x01010270)=33
    E: uses-permission (line=4)
      A: android:name="android.permission.INTERNET"
    E: uses-permission-sdk-23 (line=5)
      A: android:name="android.permission.CAMERA"
      A: android:maxSdkVersion=28
    E: permission (line=6)
      A: android:name="com.test.apk.CUSTOM"
      A: android:protectionLevel=0x00000002
    E: application (line=7)
      A: android:debuggable=(type 0x12)0x00000000
      A: android:allowBackup=true
      A: android:label="Test & <App>"
      E: activity (line=8)
        A: android:name=".MainActivity"
        A: android:exported=true
        E: intent-filter (line=9)
          E: action (line=10)
            A: android:name="android.intent.action.MAIN"
          E: category (line=11)
            A: android:name="android.intent.category.LAUNCHER"
      E: service (line=12)
        A: android:name="WorkService"
      E: provider (line=13)
        A: android:name="com.external.Provider"
        A: android:authorities="com.test.apk.provider"
`;
export const aaptRunner=async(_path,args)=>({stdout:args[1]==='badging'?BADGING:TREE});
