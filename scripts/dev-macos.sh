#!/bin/zsh
# Runs an app on macOS with live reload: edit its TSX or its native-calling
# TypeScript and the running app updates. usage: scripts/dev-macos.sh apps/showcase
set -e
ROOT=${0:A:h:h}
(cd $ROOT/vendor/nsh && cargo +stable build -p nsh-ns -p nsh-cli --release --features nsh-ns/dev)
cd ${1:A}
$ROOT/vendor/nsh/target/release/nsh dev --server-only &
SERVER=$!
trap "kill $SERVER 2>/dev/null" EXIT
sleep 1
RUST_LOG=js=info,warn $ROOT/vendor/nsh/target/release/nsh-ns ws://127.0.0.1:8790/ws
