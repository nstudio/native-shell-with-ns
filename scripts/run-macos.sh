#!/bin/zsh
# Builds and runs an app on macOS. usage: scripts/run-macos.sh apps/showcase
set -e
ROOT=${0:A:h:h}
(cd $ROOT/vendor/nsh && cargo +stable build -p nsh-ns -p nsh-cli --release)
cd ${1:A}
$ROOT/vendor/nsh/target/release/nsh build
RUST_LOG=js=info,warn exec $ROOT/vendor/nsh/target/release/nsh-ns .nsh/out/bundle.js
