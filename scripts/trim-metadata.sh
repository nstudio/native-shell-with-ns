#!/bin/zsh
# Trims NativeScript's metadata to what an app uses, through `ns metadata trim`.
# usage: NS_CLI=<nativescript-cli checkout> scripts/trim-metadata.sh <app dir> macos|ios|android
# Apple: prints the trimmed framework's path. Android: run android-apk.sh after,
# with the NSH_NS_GRADLE_ARGS this prints.
set -e
ROOT=${0:A:h:h}
APP=${1:A}
PLATFORM=$2
TOOLS=$ROOT/rt/metadata-tools
OUT=$APP/.nsh/trim-$PLATFORM
ns() { node $NS_CLI/bin/tns "$@"; }

(cd $APP && $ROOT/vendor/nsh/target/release/nsh build >/dev/null)
rm -rf $OUT
APPLE_TOOLS=(--analyzer $TOOLS/analyzer/release/ns-metadata-symbols --generator $TOOLS/build-v1/bin/objc-metadata-generator)
case $PLATFORM in
  macos)
    FRAMEWORK=$ROOT/rt/macos-node-api/package/build/RelWithDebInfo/NativeScript.apple.node/macos-arm64/NativeScript.framework
    ns metadata trim macos $APP/.nsh/out/bundle.js $APPLE_TOOLS --framework $FRAMEWORK --out $OUT
    echo "NSH_NS_FRAMEWORK=$OUT/NativeScript.framework/Versions/A/NativeScript"
    ;;
  ios)
    FRAMEWORK=$(echo $ROOT/rt/ios-node-api-*/package/build/RelWithDebInfo/NativeScript.apple.node/ios-arm64-simulator/NativeScript.framework)
    ns metadata trim ios $APP/.nsh/out/bundle.js $APPLE_TOOLS --framework $FRAMEWORK --out $OUT
    echo "NSH_NS_TRIMMED_FRAMEWORK=$OUT/NativeScript.framework"
    ;;
  android)
    TEST_APP=$ROOT/vendor/ns-android/platforms/android/test-app
    ns metadata trim android $APP/.nsh/out/bundle.js --android-project $TEST_APP --out $OUT
    echo "NSH_NS_GRADLE_ARGS='-PnsFilterMetadata -PnsFilterMetadataInput=$APP/.nsh/out'"
    echo "NODE_PATH=$TEST_APP/build-tools/jsparser/node_modules"
    ;;
  *)
    echo "usage: $0 <app dir> macos|ios|android" >&2
    exit 2
    ;;
esac
