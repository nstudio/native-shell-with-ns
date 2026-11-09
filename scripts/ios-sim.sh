#!/bin/zsh
# Builds an app for the iOS simulator and launches it with its output in a log file.
# usage: scripts/ios-sim.sh <app dir> <simulator udid> <log file>
set -e
ROOT=${0:A:h:h}
APP_DIR=${1:A}
UDID=$2
LOG=$3
NAME=${APP_DIR:t}
ID=dev.nstudio.nsh-ns.$NAME
TARGET=$ROOT/vendor/nsh/target/aarch64-apple-ios-sim/release
NS=$ROOT/rt/ios-node-api-0.4.1-next.2026-08-09-31292056208/package/build/RelWithDebInfo/NativeScript.apple.node/ios-arm64-simulator/NativeScript.framework
OUT=$APP_DIR/.nsh/ios/$NAME.app

(cd $APP_DIR && $ROOT/vendor/nsh/target/release/nsh build >/dev/null)
rm -rf $OUT
mkdir -p $OUT/nsh $OUT/Frameworks
cp $TARGET/nsh-ns $OUT/$NAME
cp $APP_DIR/.nsh/out/bundle.js $APP_DIR/.nsh/out/app.json $OUT/nsh/
cp -R ${NSH_NS_TRIMMED_FRAMEWORK:-$NS} $OUT/Frameworks/

/usr/libexec/PlistBuddy -c 'Clear dict' $OUT/Info.plist >/dev/null 2>&1 || true
plutil -create xml1 $OUT/Info.plist
for pair in CFBundleExecutable=$NAME CFBundleIdentifier=$ID CFBundleName=$NAME CFBundlePackageType=APPL \
    CFBundleShortVersionString=1.0 CFBundleVersion=1 MinimumOSVersion=15.0; do
  plutil -insert ${pair%%=*} -string ${pair#*=} $OUT/Info.plist
done
plutil -insert LSRequiresIPhoneOS -bool YES $OUT/Info.plist
plutil -insert UILaunchScreen -dictionary $OUT/Info.plist
plutil -insert UIDeviceFamily -json '[1,2]' $OUT/Info.plist
plutil -insert CFBundleSupportedPlatforms -json '["iPhoneSimulator"]' $OUT/Info.plist

codesign --force --sign - --timestamp=none $OUT/Frameworks/NativeScript.framework
codesign --force --sign - --timestamp=none $OUT

xcrun simctl terminate $UDID $ID >/dev/null 2>&1 || true
xcrun simctl install $UDID $OUT
SIMCTL_CHILD_RUST_LOG=${RUST_LOG:-js=info,warn} xcrun simctl launch --terminate-running-process \
  --console-pty $UDID $ID > $LOG 2>&1 &
# IOS_SIM_SECONDS=keep leaves the app running for the caller to stop.
if [ "${IOS_SIM_SECONDS:-8}" != keep ]; then
  sleep ${IOS_SIM_SECONDS:-8}
  xcrun simctl terminate $UDID $ID >/dev/null 2>&1 || true
fi
