#!/bin/bash
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "此准备脚本用于 macOS 构建；其他平台请使用对应官方 Platform Tools。" >&2
  exit 1
fi
project_root="$(cd "$(dirname "$0")/.." && pwd)"
download_dir="$(mktemp -d "${TMPDIR:-/tmp}/apw-platform-tools.XXXXXX")"
trap 'rm -rf "$download_dir"' EXIT
curl --fail --location --connect-timeout 20 --max-time 120 \
  --output "$download_dir/platform-tools.zip" \
  https://dl.google.com/android/repository/platform-tools-latest-darwin.zip
expected_sha256="ee39ad5967e95c2a07f04dbcbde96b1a0c916ba376096db5d2f498b7727a5d1d"
actual_sha256="$(shasum -a 256 "$download_dir/platform-tools.zip" | awk '{print $1}')"
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "Platform Tools 下载内容与已核对版本不一致：${actual_sha256}；请核实官方新版本后更新校验值。" >&2
  exit 1
fi
unzip -qo "$download_dir/platform-tools.zip" -d "$download_dir"
staged_adb="$download_dir/platform-tools/adb"
if ! codesign --verify --verbose=2 "$staged_adb"; then
  if [[ "${APW_ADHOC_ADB:-0}" != 1 ]]; then
    echo "ADB 原始签名未通过校验，未覆盖现有工具。核对来源后可设置 APW_ADHOC_ADB=1 为本项目副本生成本机 ad-hoc 签名。" >&2
    exit 1
  fi
  echo "原始签名无效；仅对已核对 SHA-256 的下载副本使用本机 ad-hoc 签名，不代表 Google 签名有效。" >&2
  codesign --force --sign - "$staged_adb"
  codesign --verify --verbose=2 "$staged_adb"
fi
"$staged_adb" version
mkdir -p "$project_root/tools/platform-tools"
cp "$staged_adb" "$download_dir/platform-tools/NOTICE.txt" "$download_dir/platform-tools/source.properties" "$project_root/tools/platform-tools/"
shasum -a 256 "$download_dir/platform-tools.zip" "$project_root/tools/platform-tools/adb"
