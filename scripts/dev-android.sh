#!/bin/zsh
# Runs an app on a running arm64 emulator with live reload.
# usage: scripts/dev-android.sh apps/showcase
set -e
ROOT=${0:A:h:h}
$ROOT/scripts/build-android.sh --features nsh-ns-android/dev
cp $ROOT/vendor/nsh/target/aarch64-linux-android/release/libnsh_android_host.so $ROOT/apps/android-host/jniLibs/arm64-v8a/libnsh.so
$ROOT/scripts/android-apk.sh $1
adb reverse tcp:8790 tcp:8790
adb shell touch /data/local/tmp/nsh-dev-server
trap "adb shell rm -f /data/local/tmp/nsh-dev-server; kill \$SERVER 2>/dev/null" EXIT
(cd ${1:A} && $ROOT/vendor/nsh/target/release/nsh dev --server-only) &
SERVER=$!
sleep 1
$ROOT/scripts/android-run.sh 1
wait $SERVER
