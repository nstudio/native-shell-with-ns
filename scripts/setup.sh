#!/bin/zsh
# Fetches the pinned nsh and NativeScript sources and the NativeScript packages.
set -e
ROOT=${0:A:h:h}
NSH_COMMIT=36b91689c1e7c38379179a56381de7ddab16c6a5
NS_ANDROID_COMMIT=c68bbeff9e53d9768341b25352c842dc10e97a50
IOS_PACKAGE=0.4.1-next.2026-08-09-31292056208

fetch_commit() {  # <directory> <url> <commit> <patch>
  [ -d "$1/.git" ] && return
  git init -q "$1"
  git -C "$1" remote add origin "$2"
  git -C "$1" fetch -q --depth 1 origin "$3"
  git -C "$1" checkout -q FETCH_HEAD
  git -C "$1" apply "$4"
}

mkdir -p $ROOT/vendor $ROOT/rt
fetch_commit $ROOT/vendor/nsh https://github.com/longbridge/nsh $NSH_COMMIT $ROOT/patches/nsh-hooks.patch
fetch_commit $ROOT/vendor/ns-android https://github.com/NativeScript/runtimes $NS_ANDROID_COMMIT \
  $ROOT/patches/ns-android-external-engine.patch

# NativeScript's Android runtime compiles against nsh's QuickJS headers.
QJS=$ROOT/vendor/ns-android/vendor/quickjs/source_ng
mkdir -p $QJS
cp $ROOT/crates/nsh-ns/c/qjs/{quickjs.h,cutils.h,list.h} $QJS/

unpack() {  # <npm spec> <directory>
  [ -d "$ROOT/rt/$2/package" ] && return
  mkdir -p $ROOT/rt/$2
  (cd $ROOT/rt/$2 && npm pack "$1" --silent --ignore-scripts >/dev/null && tar xzf *.tgz && rm *.tgz)
}

unpack @nativescript/macos-node-api@0.5.0-beta.0 macos-node-api
unpack @nativescript/ios-node-api@$IOS_PACKAGE ios-node-api-$IOS_PACKAGE

(cd $ROOT/vendor/ns-android/platforms/android/test-app/build-tools/jsparser && npm install --silent --no-audit --no-fund --ignore-scripts)

echo "Ready. Next: scripts/run-macos.sh apps/showcase"
