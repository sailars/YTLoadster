#!/usr/bin/env bash
set -euo pipefail

# Downloads and build inputs are intentionally pinned. Nothing from this
# directory is committed: GitHub Actions creates it on a clean macOS runner.
readonly YTDLP_VERSION="2026.07.04"
readonly YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_macos"
readonly YTDLP_SHA256="498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b"

readonly DENO_VERSION="2.9.3"
readonly DENO_ARM64_SHA256="1b2972f7ceb6df28d9600eab18d423bebb9aa18db02f01d7eb37a5b501482203"
readonly DENO_X64_SHA256="cff2bce236fde0952aac62a5699464c46901b4eb1e61d0caffbb33d556e098c1"

readonly FFMPEG_VERSION="8.1.2"
readonly FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
readonly FFMPEG_SHA256="464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"

readonly LAME_VERSION="3.100"
readonly LAME_URL="https://downloads.sourceforge.net/project/lame/lame/${LAME_VERSION}/lame-${LAME_VERSION}.tar.gz"
readonly LAME_SHA256="ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e"

if [[ "${1:-}" != "arm64" && "${1:-}" != "x64" ]]; then
  echo "Usage: $0 <arm64|x64>" >&2
  exit 64
fi

readonly BUILD_ARCH="$1"
readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly RESOURCES_DIR="${PROJECT_ROOT}/src-tauri/resources/macos"
readonly TOOLS_DIR="${RESOURCES_DIR}/tools"
readonly WORK_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ytloadster-macos-tools-${BUILD_ARCH}"

sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}

download_and_verify() {
  local url="$1"
  local expected_sha256="$2"
  local destination="$3"

  curl --fail --location --retry 3 --silent --show-error "$url" --output "$destination"
  local actual_sha256
  actual_sha256="$(sha256 "$destination")"
  if [[ "$actual_sha256" != "$expected_sha256" ]]; then
    echo "SHA-256 mismatch for ${url}" >&2
    echo "expected: ${expected_sha256}" >&2
    echo "actual:   ${actual_sha256}" >&2
    exit 1
  fi
}

rm -rf "$WORK_DIR" "$TOOLS_DIR"
mkdir -p "$WORK_DIR" "$TOOLS_DIR"

echo "Downloading yt-dlp ${YTDLP_VERSION}"
download_and_verify "$YTDLP_URL" "$YTDLP_SHA256" "${TOOLS_DIR}/yt-dlp_macos"
chmod 755 "${TOOLS_DIR}/yt-dlp_macos"

case "$BUILD_ARCH" in
  arm64)
    deno_asset="deno-aarch64-apple-darwin.zip"
    deno_sha256="$DENO_ARM64_SHA256"
    ;;
  x64)
    deno_asset="deno-x86_64-apple-darwin.zip"
    deno_sha256="$DENO_X64_SHA256"
    ;;
esac

echo "Downloading Deno ${DENO_VERSION} for ${BUILD_ARCH}"
deno_archive="${WORK_DIR}/${deno_asset}"
download_and_verify \
  "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/${deno_asset}" \
  "$deno_sha256" \
  "$deno_archive"
unzip -q "$deno_archive" -d "${WORK_DIR}/deno"
install -m 755 "${WORK_DIR}/deno/deno" "${TOOLS_DIR}/deno"

echo "Building shared LAME ${LAME_VERSION} for ${BUILD_ARCH}"
lame_archive="${WORK_DIR}/lame-${LAME_VERSION}.tar.gz"
download_and_verify "$LAME_URL" "$LAME_SHA256" "$lame_archive"
tar -xzf "$lame_archive" -C "$WORK_DIR"
lame_source="${WORK_DIR}/lame-${LAME_VERSION}"
lame_prefix="${WORK_DIR}/lame-install"
# LAME 3.100 ships a stale macOS export-list entry for `lame_init_old`.
# The function is no longer part of the library, so current Apple linkers
# reject the dynamic library until the obsolete export is removed.
sed -i.bak '/^lame_init_old$/d' "${lame_source}/include/libmp3lame.sym"
(
  cd "$lame_source"
  ./configure \
    --prefix="$lame_prefix" \
    --enable-shared \
    --disable-static
  make -j"$(sysctl -n hw.ncpu)"
  make install
)

echo "Building LGPL-only FFmpeg ${FFMPEG_VERSION} with MP3 support for ${BUILD_ARCH}"
ffmpeg_archive="${WORK_DIR}/ffmpeg-${FFMPEG_VERSION}.tar.xz"
download_and_verify "$FFMPEG_URL" "$FFMPEG_SHA256" "$ffmpeg_archive"
tar -xJf "$ffmpeg_archive" -C "$WORK_DIR"
ffmpeg_source="${WORK_DIR}/ffmpeg-${FFMPEG_VERSION}"
ffmpeg_prefix="${WORK_DIR}/ffmpeg-install"
(
  cd "$ffmpeg_source"
  PKG_CONFIG_PATH="${lame_prefix}/lib/pkgconfig${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}" ./configure \
    --prefix="$ffmpeg_prefix" \
    --disable-gpl \
    --disable-nonfree \
    --disable-autodetect \
    --disable-debug \
    --disable-doc \
    --disable-ffplay \
    --disable-shared \
    --enable-static \
    --enable-libmp3lame \
    --extra-cflags="-I${lame_prefix}/include" \
    --extra-ldflags="-L${lame_prefix}/lib"
  make -j"$(sysctl -n hw.ncpu)"
  make install
)
install -m 755 "${ffmpeg_prefix}/bin/ffmpeg" "${TOOLS_DIR}/ffmpeg"
install -m 755 "${ffmpeg_prefix}/bin/ffprobe" "${TOOLS_DIR}/ffprobe"
readonly LAME_DYLIB_SOURCE="${lame_prefix}/lib/libmp3lame.0.dylib"
readonly LAME_DYLIB_NAME="libmp3lame.0.dylib"
if [[ ! -f "$LAME_DYLIB_SOURCE" ]]; then
  echo "LAME dynamic library was not produced" >&2
  exit 1
fi
install -m 755 "$LAME_DYLIB_SOURCE" "${TOOLS_DIR}/${LAME_DYLIB_NAME}"
install_name_tool -id "@loader_path/${LAME_DYLIB_NAME}" "${TOOLS_DIR}/${LAME_DYLIB_NAME}"

# FFmpeg's programs can retain the absolute LAME path from this temporary
# runner. It works during CI while that path exists, but fails on the user's
# Mac after the DMG is installed. Patch every bundled program that references
# LAME, not only ffmpeg: audio extraction starts by invoking ffprobe as well.
readonly BUNDLED_LAME_REFERENCE="@loader_path/${LAME_DYLIB_NAME}"
rewrite_lame_dependency() {
  local tool_name="$1"
  local tool_path="${TOOLS_DIR}/${tool_name}"
  local lame_reference
  lame_reference="$(otool -L "$tool_path" | awk '/libmp3lame/ { print $1; exit }')"

  if [[ "$tool_name" == "ffmpeg" && -z "$lame_reference" ]]; then
    echo "FFmpeg was built without a libmp3lame dependency" >&2
    exit 1
  fi

  if [[ -n "$lame_reference" && "$lame_reference" != "$BUNDLED_LAME_REFERENCE" ]]; then
    install_name_tool -change "$lame_reference" "$BUNDLED_LAME_REFERENCE" "$tool_path"
  fi

  if [[ -n "$lame_reference" ]] \
    && ! otool -L "$tool_path" | awk '{ print $1 }' | grep -Fxq "$BUNDLED_LAME_REFERENCE"; then
    echo "${tool_name} does not refer to the bundled LAME library" >&2
    exit 1
  fi
}

rewrite_lame_dependency "ffmpeg"
rewrite_lame_dependency "ffprobe"
install -m 644 "${ffmpeg_source}/COPYING.LGPLv2.1" "${RESOURCES_DIR}/FFMPEG_LGPL-2.1.txt"
install -m 644 "${lame_source}/COPYING" "${RESOURCES_DIR}/LAME_LGPL-2.0.txt"

cat > "${RESOURCES_DIR}/COMPONENTS.txt" <<EOF
YTLoadster macOS component manifest
Architecture: ${BUILD_ARCH}

yt-dlp ${YTDLP_VERSION}
Source: ${YTDLP_URL}
SHA-256: $(sha256 "${TOOLS_DIR}/yt-dlp_macos")
License: The Unlicense; bundled third-party licenses are included by yt-dlp.

Deno ${DENO_VERSION}
Source: https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/${deno_asset}
SHA-256: $(sha256 "${TOOLS_DIR}/deno")
License: MIT

FFmpeg ${FFMPEG_VERSION}
Source: ${FFMPEG_URL}
Source SHA-256: ${FFMPEG_SHA256}
Built with: --disable-gpl --disable-nonfree --disable-autodetect --disable-shared --enable-static --enable-libmp3lame
ffmpeg SHA-256: $(sha256 "${TOOLS_DIR}/ffmpeg")
ffprobe SHA-256: $(sha256 "${TOOLS_DIR}/ffprobe")
License: LGPL-2.1-or-later; full text: FFMPEG_LGPL-2.1.txt

LAME ${LAME_VERSION}
Source: ${LAME_URL}
Source SHA-256: ${LAME_SHA256}
Bundled as FFmpeg's dynamic dependency for MP3 encoding.
libmp3lame SHA-256: $(sha256 "${TOOLS_DIR}/${LAME_DYLIB_NAME}")
License: LGPL-2.0; full text: LAME_LGPL-2.0.txt
EOF

# A distributable macOS tool may use Apple system libraries and libraries
# bundled beside it. Any other absolute path (Homebrew, MacPorts or a runner
# directory) would make the DMG work only on the machine that built it.
verify_portable_dependencies() {
  local tool_name="$1"
  local tool_path="${TOOLS_DIR}/${tool_name}"
  local dependency

  while IFS= read -r dependency; do
    case "$dependency" in
      /System/Library/* | /usr/lib/* | @loader_path/*)
        ;;
      *)
        echo "${tool_name} has a non-portable dependency: ${dependency}" >&2
        exit 1
        ;;
    esac
  done < <(otool -L "$tool_path" | tail -n +2 | awk '{ print $1 }')
}

verify_portable_dependencies "ffmpeg"
verify_portable_dependencies "ffprobe"
verify_portable_dependencies "$LAME_DYLIB_NAME"

# The final application cannot access the runner's temporary build directory.
# Remove it before exercising both executables so an absolute dependency can
# never be hidden by a successful CI run.
rm -rf "$WORK_DIR"
"${TOOLS_DIR}/ffmpeg" -version >/dev/null
"${TOOLS_DIR}/ffprobe" -version >/dev/null

echo "Prepared macOS tools in ${TOOLS_DIR}"
