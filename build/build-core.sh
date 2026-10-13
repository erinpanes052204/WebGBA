#!/usr/bin/env bash
# OPTIONAL: rebuilds web/core/mgba.{js,wasm} from mGBA 0.10.5 source.
# You do NOT need this to run WebGBA; the compiled files are already included.
# Tested on Ubuntu 24.04 with the distro's emscripten 3.1.6 (needs `acorn` from npm on NODE_PATH).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$HERE/_build}"; mkdir -p "$WORK"; cd "$WORK"
[ -d mgba-0.10.5 ] || { curl -sL https://codeload.github.com/mgba-emu/mgba/tar.gz/refs/tags/0.10.5 | tar xz; }
# Emscripten's libc is picky; these macros undo CMake's wrong feature detection.
U="-UHAVE_PTHREAD_SET_NAME_NP -UHAVE_PTHREAD_SETNAME_NP -UHAVE_CRC32 -UHAVE_POPCOUNT32 -UHAVE_SNPRINTF_L -UHAVE_XLOCALE -UHAVE_STRLCPY"
mkdir -p build && cd build
emcmake cmake ../mgba-0.10.5 -DCMAKE_BUILD_TYPE=Release -DBUILD_QT=OFF -DBUILD_SDL=OFF -DBUILD_GL=OFF \
  -DBUILD_GLES2=OFF -DBUILD_GLES3=OFF -DBUILD_SHARED=OFF -DBUILD_STATIC=ON -DBUILD_PYTHON=OFF \
  -DBUILD_LIBRETRO=OFF -DBUILD_TEST=OFF -DBUILD_SUITE=OFF -DBUILD_CINEMA=OFF -DBUILD_EXAMPLE=OFF \
  -DUSE_ZLIB=OFF -DUSE_PNG=OFF -DUSE_LIBZIP=OFF -DUSE_MINIZIP=OFF -DUSE_SQLITE3=OFF -DUSE_ELF=OFF \
  -DUSE_LZMA=OFF -DUSE_EDITLINE=OFF -DUSE_FFMPEG=OFF -DUSE_LUA=OFF -DUSE_DISCORD_RPC=OFF -DUSE_EPOXY=OFF \
  -DENABLE_SCRIPTING=OFF -DUSE_DEBUGGERS=OFF -DUSE_GDB_STUB=OFF -DM_CORE_GB=OFF -DM_CORE_GBA=ON \
  -DCMAKE_C_FLAGS="-D_GNU_SOURCE -D_POSIX_C_SOURCE=200809L -DDISABLE_THREADING $U"
emmake make -j"$(nproc)" mgba
emcc -O3 -flto -I"$WORK/mgba-0.10.5/include" -I"$PWD/include" -D_GNU_SOURCE -DDISABLE_THREADING -DM_CORE_GBA $U \
  "$HERE/wasm_api.c" libmgba.a -o "$HERE/mgba.js" \
  -sMODULARIZE=1 -sEXPORT_NAME=createMgba -sENVIRONMENT=web -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=64MB -sFILESYSTEM=0 -sEXPORTED_RUNTIME_METHODS=ccall
cp "$HERE/mgba.js" "$HERE/mgba.wasm" "$HERE/../core/"
echo "Done. rebuilt core/mgba.js and core/mgba.wasm"
