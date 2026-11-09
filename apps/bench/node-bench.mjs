// NativeScript alone on Node: V8, Node-API, and JS on the calling thread.
import "../../rt/macos-node-api/package/index.mjs";

const RUNS = 7;
const TARGET_MS = 150;
const timeOnce = (loop, n) => {
  const start = performance.now();
  loop(n);
  return performance.now() - start;
};
function measure(name, loop) {
  let n = 1000;
  while (timeOnce(loop, n) < TARGET_MS / 4 && n < 4e8) n *= 4;
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push((timeOnce(loop, n) / n) * 1e6);
  const sorted = [...runs].sort((a, b) => a - b);
  return { name, n, nsPerCall: sorted[RUNS >> 1], runs };
}

const processInfo = NSProcessInfo.processInfo;
class Echo extends NSObject {
  static ObjCExposedMethods = {
    "echo:": { params: [interop.types.id], returns: interop.types.id },
  };
  static {
    NativeClass(this);
  }
  echo(value) {
    return value;
  }
}
const echo = Echo.new();
function jsTarget() {
  return 0;
}

const results = [
  measure("js call", (n) => { for (let i = 0; i < n; i++) jsTarget(); }),
  measure("ns: int getter", (n) => { for (let i = 0; i < n; i++) processInfo.processIdentifier; }),
  measure("ns: string getter", (n) => { for (let i = 0; i < n; i++) processInfo.operatingSystemVersionString; }),
  measure("ns: new NSObject", (n) => { for (let i = 0; i < n; i++) NSObject.new(); }),
  measure("ns: native to JS callback", (n) => { for (let i = 0; i < n; i++) echo.performSelectorWithObject("echo:", "ping"); }),
];
for (const r of results) console.log(r.name, Math.round(r.nsPerCall), "ns");
console.log(JSON.stringify(results));
process.exit(0);
