#!/bin/zsh
# Builds the tools that trim NativeScript metadata to what an app uses:
# the bundle analyzer and a metadata generator matching the runtime packages.
set -e
ROOT=${0:A:h:h}
RUNTIMES_COMMIT=3549e19
TOOLS=$ROOT/rt/metadata-tools
if [ ! -d $ROOT/vendor/ns-runtimes ]; then
  git clone https://github.com/NativeScript/runtimes.git $ROOT/vendor/ns-runtimes
  git -C $ROOT/vendor/ns-runtimes checkout $RUNTIMES_COMMIT
  git -C $ROOT/vendor/ns-runtimes apply $ROOT/patches/ns-runtimes-metadata-filter.patch
fi
cargo +stable build --locked --release \
  --manifest-path $ROOT/vendor/ns-android/metadata-generator/symbol-analyzer/Cargo.toml \
  --target-dir $TOOLS/analyzer
cmake -S $ROOT/vendor/ns-runtimes/metadata-generator -B $TOOLS/build-v1 \
  -DCMAKE_BUILD_TYPE=Release -DMETADATA_BINARY_ARCH=arm64 -DCMAKE_OSX_ARCHITECTURES=arm64
cmake --build $TOOLS/build-v1 -j10
