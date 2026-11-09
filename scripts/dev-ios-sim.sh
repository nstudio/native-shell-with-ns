#!/bin/zsh
# Runs an app in the iOS simulator with live reload.
# usage: scripts/dev-ios-sim.sh apps/showcase <simulator-udid> <log file>
set -e
ROOT=${0:A:h:h}
(cd $ROOT/vendor/nsh && cargo +stable build -p nsh-ns --release --target aarch64-apple-ios-sim --features nsh-ns/dev)
(cd $ROOT/vendor/nsh && cargo +stable build -p nsh-cli --release)
(cd ${1:A} && $ROOT/vendor/nsh/target/release/nsh dev --server-only) &
SERVER=$!
trap "kill $SERVER 2>/dev/null" EXIT
sleep 1
SIMCTL_CHILD_NSH_NS_DEV_SERVER=ws://127.0.0.1:8790/ws IOS_SIM_SECONDS=keep $ROOT/scripts/ios-sim.sh $1 $2 $3
wait $SERVER
