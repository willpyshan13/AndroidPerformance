# 验证记录

完整的 0.1.1 全功能测试与修复说明见 [TEST_REPORT.md](TEST_REPORT.md)。

- 自动测试：23 项通过。
- 最终真机回归：15 项通过、1 项设备不支持（Perfetto）。
- 桌面原生文件、回放、重启持久化、菜单、退出保护及签名安装包均已验证。
- 平台：macOS arm64；设备：rk3399-all / Android 7.1.2 / API 25。

原始结果在 data/full-test-release-0.1.1/，桌面交互证据在 data/ui-test/。
