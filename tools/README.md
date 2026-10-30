# Android Platform Tools

macOS 构建使用 Google 官方 Platform Tools 中的 `adb`，连同 `NOTICE.txt` 和 `source.properties` 放入应用资源目录。`adb` 本身只链接 macOS 系统库。

准备资源：

```sh
npm run prepare:adb
```

来源：[Google Platform Tools](https://developer.android.com/tools/releases/platform-tools)，下载地址 `https://dl.google.com/android/repository/platform-tools-latest-darwin.zip`。

2026-10-30 验证版本：37.0.1-15733141。

- 下载 ZIP SHA-256：`ee39ad5967e95c2a07f04dbcbde96b1a0c916ba376096db5d2f498b7727a5d1d`
- 解压后 adb SHA-256：`1811e253b21b12cbfda7201ebaf86c10e7ddcb5c606a7a81f7c82b4c429c2d3b`

该下载地址指向最新版本，未来下载后请重新验证来源、签名和设备兼容性。项目不修改用户原 SDK 中的任何文件。`platform-tools/` 是下载资源，不提交到源码库；分发时保留 Google 提供的 NOTICE。
