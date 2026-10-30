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
mkdir -p "$project_root/tools"
unzip -qo "$download_dir/platform-tools.zip" -d "$project_root/tools"
codesign --verify --verbose=2 "$project_root/tools/platform-tools/adb"
"$project_root/tools/platform-tools/adb" version
shasum -a 256 "$download_dir/platform-tools.zip" "$project_root/tools/platform-tools/adb"
