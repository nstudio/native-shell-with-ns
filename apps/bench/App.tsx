import { mount, nativeModule, signal, Text, View } from "nsh";
import { measure, nativeScriptCases, type Result } from "./suite";

declare const NSString: any, NSTemporaryDirectory: any, NSOperationQueue: any;

const g = globalThis as any;
const bench = nativeModule<{
  Bench: {
    noop(): number;
    pid(): number;
    osVersion(): string;
    pidOnMain(): number;
    pidOnMainFast(): number;
    trayCreate(): void;
    trayUpdate(text: string): void;
    trayUpdateFast(text: string): void;
    trayRemove(): void;
  };
}>("ns-bench/native").Bench;
const ns = nativeScriptCases(g);
const setMode = g.__nshNsCallMode as (mode: number) => void;
const AUTO = 0;
const MAIN = 1;
const ENGINE = 2;

function jsTarget() {
  return 0;
}

const inMode = (mode: number, run: (n: number) => void) => (n: number) => {
  setMode(mode);
  run(n);
  setMode(AUTO);
};
const hopped = (run: (n: number) => void) => inMode(MAIN, run);
const direct = (run: (n: number) => void) => inMode(ENGINE, run);

const cases: Array<[string, (n: number) => void]> = [
  ["js call", (n) => { for (let i = 0; i < n; i++) jsTarget(); }],
  ["nsh module: no-op", (n) => { for (let i = 0; i < n; i++) bench.noop(); }],
  ["nsh module: int getter, engine thread", (n) => { for (let i = 0; i < n; i++) bench.pid(); }],
  ["nsh module: string getter, engine thread", (n) => { for (let i = 0; i < n; i++) bench.osVersion(); }],
  ["nsh module: int getter, main thread", (n) => { for (let i = 0; i < n; i++) bench.pidOnMain(); }],
  ["nsh module: int getter, main thread, same hand-off", (n) => { for (let i = 0; i < n; i++) bench.pidOnMainFast(); }],
  ["nsh+ns: int getter, engine thread", direct(ns.pid)],
  ["nsh+ns: string getter, engine thread", direct(ns.osVersion)],
  ["nsh+ns: int getter, main thread", hopped(ns.pid)],
  ["nsh+ns: string getter, main thread", hopped(ns.osVersion)],
  ["nsh+ns: new NSObject, main thread", hopped(ns.newObject)],
  ["nsh+ns: native to JS callback, main thread", hopped(ns.callback)],
  ["allowlist: NSDate getter, always main", hopped(ns.date)],
  ["allowlist: NSDate getter, auto", inMode(AUTO, ns.date)],
  ["allowlist: NSNumber create and read, always main", hopped(ns.number)],
  ["allowlist: NSNumber create and read, auto", inMode(AUTO, ns.number)],
  ["allowlist: NSDateFormatter format, always main", hopped(ns.formatDate)],
  ["allowlist: NSDateFormatter format, auto", inMode(AUTO, ns.formatDate)],
  ["allowlist: struct field, always main", hopped(ns.structField)],
  ["allowlist: struct field, auto", inMode(AUTO, ns.structField)],
  ["allowlist: NSProcessInfo getter (unlisted), auto", inMode(AUTO, ns.pid)],
];

const results: Result[] = [];
const status = signal("running");

function finish() {
  if (g.NSStatusBar !== undefined) bench.trayRemove();
  const json = JSON.stringify(results, null, 1);
  const path = NSTemporaryDirectory() + "nsh-bench.json";
  NSString.stringWithString(json).writeToFileAtomicallyEncodingError(path, true, 4, null);
  console.log("[bench] wrote", path);
  for (const r of results) console.log("[bench]", r.name, Math.round(r.nsPerCall), "ns");
  console.log("[bench] done");
  status.set("done");
}

function runLoopCallbacks(done: () => void) {
  const total = 5000;
  const queue = NSOperationQueue.mainQueue;
  let fired = 0;
  const start = performance.now();
  const step = () => {
    if (++fired === total) {
      const perCall = ((performance.now() - start) / total) * 1e6;
      results.push({ name: "nsh+ns: main queue block to JS", n: total, nsPerCall: perCall, runs: [perCall] });
      // Main is waiting on this callback, so a Rust dispatch_sync here deadlocks.
      setTimeout(done, 0);
    } else {
      queue.addOperationWithBlock(step);
    }
  };
  queue.addOperationWithBlock(step);
}

// A single call after the threads have gone idle, so it pays the full wake-up.
async function isolated(name: string, call: () => void) {
  const samples = 300;
  let total = 0;
  for (let i = 0; i < samples; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const start = performance.now();
    call();
    total += performance.now() - start;
  }
  const perCall = (total / samples) * 1e6;
  results.push({ name, n: samples, nsPerCall: perCall, runs: [perCall] });
}

async function isolatedCases() {
  setMode(MAIN);
  const processInfo = g.NSProcessInfo.processInfo;
  await isolated("isolated: nsh+ns int getter, main thread", () => processInfo.processIdentifier);
  setMode(AUTO);
  await isolated("isolated: nsh module int getter, main thread", () => bench.pidOnMain());
}

// The same two AppKit property sets from a Rust module and from TypeScript.
function trayCases(): Array<[string, (n: number) => void]> {
  if (g.NSStatusBar === undefined) return [];
  bench.trayCreate();
  const item = g.NSStatusBar.systemStatusBar.statusItemWithLength(-1);
  const button = item.button;
  const label = (i: number) => "tray " + (i % 16);
  return [
    ["tray update: nsh module (Rust)", (n) => { for (let i = 0; i < n; i++) bench.trayUpdate(label(i)); }],
    ["tray update: nsh module (Rust), same hand-off", (n) => { for (let i = 0; i < n; i++) bench.trayUpdateFast(label(i)); }],
    ["tray update: nsh+ns (TypeScript)", (n) => {
      for (let i = 0; i < n; i++) {
        const text = label(i);
        button.toolTip = text;
        button.accessibilityLabel = text;
      }
    }],
  ];
}

cases.push(...trayCases());

let index = 0;
async function next() {
  if (index === cases.length) {
    await isolatedCases();
    runLoopCallbacks(finish);
    return;
  }
  const [name, loop] = cases[index++];
  const startedAt = performance.now();
  results.push(await measure(name, loop));
  console.log("[bench] case", name, Math.round(performance.now() - startedAt), "ms");
  setTimeout(next, 20);
}
setTimeout(next, 800);

mount(() => (
  <View style={{ flex: 1, padding: 40 }}>
    <Text>Bench: {status()}</Text>
  </View>
));
