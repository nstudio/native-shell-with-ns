#!/bin/zsh
# Builds libnsh.so with NativeScript support for arm64 Android.
ROOT=${0:A:h:h}
NDK=$HOME/Library/Android/sdk/ndk/30.0.16248370
TOOL=$NDK/toolchains/llvm/prebuilt/darwin-x86_64
API=28
CLANG=$TOOL/bin/aarch64-linux-android$API-clang
CLANG_INC=$(ls -d $TOOL/lib/clang/*/include | tail -1)
export CC_aarch64_linux_android=$CLANG
export AR_aarch64_linux_android=$TOOL/bin/llvm-ar
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=$CLANG
export BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android="--target=aarch64-linux-android$API --sysroot=$TOOL/sysroot -idirafter $CLANG_INC"
cd $ROOT/vendor/nsh
cargo +stable build -p nsh-ns-android --release --target aarch64-linux-android "$@"
