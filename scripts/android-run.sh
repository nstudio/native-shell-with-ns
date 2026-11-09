#!/bin/zsh
# Installs the demo APK on a running emulator and launches it.
# usage: scripts/android-run.sh <seconds to wait>
ROOT=${0:A:h:h}
APK=$ROOT/vendor/ns-android/platforms/android/test-app/app/build/outputs/apk/release/app-release-signed.apk
PKG=com.tns.testapplication
adb install -r -t "$APK" | tail -1
adb logcat -c
adb shell am force-stop $PKG
adb shell am start -n $PKG/dev.nstudio.nshns.MainActivity | tail -1
perl -e "select(undef,undef,undef,${1:-8})"
echo "PKG=$PKG"
