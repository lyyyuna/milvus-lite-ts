#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-2.5.1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGES_DIR="${SCRIPT_DIR}/../packages"
TMP_DIR=$(mktemp -d)

PLATFORMS="darwin-arm64 darwin-x64 linux-x64 linux-arm64"
wheel_platform_for() {
  case "$1" in
    darwin-arm64) echo "macosx_11_0_arm64" ;;
    darwin-x64)   echo "macosx_10_9_x86_64" ;;
    linux-x64)    echo "manylinux2014_x86_64" ;;
    linux-arm64)  echo "manylinux2014_aarch64" ;;
  esac
}

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

for platform in $PLATFORMS; do
  wp=$(wheel_platform_for "$platform")
  wheel_name="milvus_lite-${VERSION}-py3-none-${wp}.whl"
  pkg_dir="${PACKAGES_DIR}/milvus-lite-${platform}"
  lib_dir="${pkg_dir}/lib"

  echo "=== ${platform} ==="

  rm -rf "$lib_dir"
  mkdir -p "$lib_dir"

  echo "  Downloading ${wheel_name}..."
  pip3 download "milvus-lite==${VERSION}" \
    --no-deps --only-binary=:all: \
    --platform "$wp" \
    --python-version 3 \
    -d "$TMP_DIR" \
    --no-cache-dir \
    -q 2>/dev/null || {
    echo "  pip3 download failed, trying direct PyPI..."
    url="https://pypi.org/simple/milvus-lite/"
    wheel_url=$(curl -sL "$url" | grep -o 'href="[^"]*'"${wheel_name}"'[^"]*"' | head -1 | sed 's/href="//;s/#.*//' | sed 's|../../|https://pypi.org/|')
    curl -sL "$wheel_url" -o "${TMP_DIR}/${wheel_name}"
  }

  echo "  Extracting lib..."
  unzip -o -q "${TMP_DIR}/${wheel_name}" "milvus_lite/lib/*" -d "${TMP_DIR}/extract_${platform}"
  cp -R "${TMP_DIR}/extract_${platform}/milvus_lite/lib/"* "$lib_dir/"

  chmod +x "${lib_dir}/milvus"

  echo "  Done: $(ls "$lib_dir" | wc -l | tr -d ' ') files in lib/"
  echo ""
done

echo "All platforms fetched successfully."
