#!/bin/zsh
# Runs the benchmark app once on an iOS simulator and saves its results.
# usage: scripts/bench-ios.sh <simulator udid> <output json>
ROOT=${0:A:h:h}
UDID=$1
OUT=${2:A}
ID=dev.nstudio.nsh-ns.bench
DATA=$(xcrun simctl get_app_container $UDID $ID data 2>/dev/null)
[ -n "$DATA" ] && rm -f $DATA/tmp/nsh-bench.json
IOS_SIM_SECONDS=keep $ROOT/scripts/ios-sim.sh $ROOT/apps/bench $UDID /dev/null >/dev/null 2>&1
DATA=$(xcrun simctl get_app_container $UDID $ID data)
for i in $(seq 1 600); do
  [ -f $DATA/tmp/nsh-bench.json ] && break
  perl -e 'select(undef,undef,undef,0.2)'
done
xcrun simctl terminate $UDID $ID >/dev/null 2>&1
[ -f $DATA/tmp/nsh-bench.json ] && cp $DATA/tmp/nsh-bench.json $OUT && echo "saved $OUT"
