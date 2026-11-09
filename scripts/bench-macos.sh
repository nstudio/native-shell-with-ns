#!/bin/zsh
# Runs the benchmark app once on macOS and saves its results.
# usage: scripts/bench-macos.sh <output json>
ROOT=${0:A:h:h}
OUT=${1:A}
BENCH=$ROOT/apps/bench
RESULT=$(getconf DARWIN_USER_TEMP_DIR)nsh-bench.json
rm -f $RESULT
(cd $BENCH && $ROOT/vendor/nsh/target/release/nsh build >/dev/null)
cd $BENCH
NSH_NS_BACKGROUND=1 RUST_LOG=js=info,warn $ROOT/vendor/nsh/target/release/nsh-ns .nsh/out/bundle.js > $OUT.log 2>&1 &
PID=$!
for i in $(seq 1 600); do
  [ -f $RESULT ] && break
  kill -0 $PID 2>/dev/null || { echo "app exited early"; break; }
  perl -e 'select(undef,undef,undef,0.2)'
done
kill $PID 2>/dev/null; wait $PID 2>/dev/null
[ -f $RESULT ] && mv $RESULT $OUT && echo "saved $OUT"
