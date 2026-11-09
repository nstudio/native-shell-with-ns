#!/bin/zsh
# Builds the Android demo APK: the TSX bundle, then the runtime and app.
# usage: scripts/android-apk.sh <app dir>
ROOT=${0:A:h:h}
APP_DIR=${1:A}
TEST_APP=$ROOT/vendor/ns-android/platforms/android/test-app
export ANDROID_HOME=$HOME/Library/Android/sdk ANDROID_SDK_ROOT=$HOME/Library/Android/sdk
(cd $APP_DIR && $ROOT/vendor/nsh/target/release/nsh build) || exit 1
mkdir -p $TEST_APP/app/src/main/assets/nsh
cp $APP_DIR/.nsh/out/bundle.nshc $APP_DIR/.nsh/out/app.json $TEST_APP/app/src/main/assets/nsh/
cd $TEST_APP
./gradlew --no-daemon :app:assembleRelease -Pengine=QUICKJS_NG -PbindingLayer=napi -PonlyArm64 \
  -PndkVersion=30.0.16248370 -PpackageVersion=0.0.0-nsh -PgitCommitVersion=local \
  -PappResourcesPath=src/main/res ${=NSH_NS_GRADLE_ARGS}
# Benchmarks need an optimized build; sign it with the test app's debug key.
OUT=$TEST_APP/app/build/outputs/apk/release
APKSIGNER=$(ls -d $ANDROID_HOME/build-tools/*(On[1]))/apksigner
UNSIGNED=$(ls $OUT/*.apk | grep -v signed | head -1)
$APKSIGNER sign --ks $TEST_APP/../debug.keystore --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias androiddebugkey --out $OUT/app-release-signed.apk $UNSIGNED
