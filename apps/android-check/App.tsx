import { mount, nativeModule, signal, Text, View } from "nsh";

declare const android: any, java: any, dev: any;
declare function gc(): void;

const g = globalThis as any;
const setMode = g.__nshNsCallMode as (mode: number) => void;
const MAIN = 1;
const ENGINE = 2;
const status = signal("stress");
const ticks = signal(0);
const log = (...parts: unknown[]) => console.log("[check]", ...parts);

function stress(done: () => void) {
  const activity = dev.nstudio.nshns.NsBridge.current;
  const counters = { engine: 0, looper: 0, nested: 0, background: 0, views: 0, errors: 0 };
  const handler = new android.os.Handler(android.os.Looper.getMainLooper());
  const button = new android.widget.Button(activity);
  button.setOnClickListener(
    new android.view.View.OnClickListener({
      onClick() {
        counters.nested++;
        ticks.set(ticks() + 1);
      },
    }),
  );
  let running = true;
  const looperTask = new java.lang.Runnable({
    run() {
      counters.looper++;
      try {
        button.performClick();
      } catch (e) {
        counters.errors++;
        log("error", String(e));
      }
      if (running) handler.postDelayed(looperTask, 1);
    },
  });
  handler.post(looperTask);
  const pool = java.util.concurrent.Executors.newFixedThreadPool(2);
  const backgroundTask = new java.lang.Runnable({
    run() {
      counters.background++;
    },
  });
  const timers = [
    setInterval(() => {
      counters.engine++;
      ticks.set(ticks() + 1);
      java.lang.System.currentTimeMillis();
    }, 1),
    setInterval(() => {
      for (let i = 0; i < 8; i++) pool.execute(backgroundTask);
    }, 5),
    setInterval(() => {
      for (let i = 0; i < 40; i++) {
        new android.widget.TextView(activity);
        counters.views++;
      }
      gc();
    }, 50),
    setInterval(() => log("stress", JSON.stringify(counters)), 2000),
  ];
  setTimeout(() => {
    running = false;
    timers.forEach(clearInterval);
    pool.shutdown();
    log("stress finished", JSON.stringify(counters));
    done();
  }, 30000);
}

type Result = { name: string; n: number; nsPerCall: number };
const RUNS = 7;
function measure(name: string, loop: (n: number) => void): Result {
  const once = (n: number) => {
    const start = performance.now();
    loop(n);
    return performance.now() - start;
  };
  let n = 500;
  while (once(n) < 40 && n < 4e8) n *= 4;
  const runs: number[] = [];
  for (let i = 0; i < RUNS; i++) runs.push((once(n) / n) * 1e6);
  runs.sort((a, b) => a - b);
  return { name, n, nsPerCall: runs[RUNS >> 1] };
}

function jsTarget() {
  return 0;
}

function bench(done: () => void) {
  const system = java.lang.System;
  const process = android.os.Process;
  const objectClass = java.lang.Object;
  const inMode = (mode: number, run: (n: number) => void) => (n: number) => {
    setMode(mode);
    run(n);
    setMode(0);
  };
  const millis = (n: number) => { for (let i = 0; i < n; i++) system.currentTimeMillis(); };
  const pid = (n: number) => { for (let i = 0; i < n; i++) process.myPid(); };
  const prop = (n: number) => { for (let i = 0; i < n; i++) system.getProperty("os.name"); };
  const objects = (n: number) => { for (let i = 0; i < n; i++) new objectClass(); };
  const activity = dev.nstudio.nshns.NsBridge.current;
  const button = new android.widget.Button(activity);
  button.setOnClickListener(
    new android.view.View.OnClickListener({
      onClick() {
        return;
      },
    }),
  );
  const callback = (n: number) => { for (let i = 0; i < n; i++) button.performClick(); };
  const rust = nativeModule<{
    Bench: { noop(): number; pid(): number; pidOnMain(): number; pidOnMainFast(): number };
  }>("ns-bench/native").Bench;
  const isolated = async (name: string, call: () => void) => {
    const samples = 300;
    let total = 0;
    for (let i = 0; i < samples; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      const start = performance.now();
      call();
      total += performance.now() - start;
    }
    results.push({ name, n: samples, nsPerCall: (total / samples) * 1e6 });
  };
  const cases: Array<[string, (n: number) => void]> = [
    ["js call", (n) => { for (let i = 0; i < n; i++) jsTarget(); }],
    ["nsh module: no-op", (n) => { for (let i = 0; i < n; i++) rust.noop(); }],
    ["nsh module: int getter, engine thread", (n) => { for (let i = 0; i < n; i++) rust.pid(); }],
    ["nsh module: int getter, main thread", (n) => { for (let i = 0; i < n; i++) rust.pidOnMain(); }],
    ["nsh module: int getter, main thread, same hand-off", (n) => { for (let i = 0; i < n; i++) rust.pidOnMainFast(); }],
    ["nsh+ns: static long, engine thread", inMode(ENGINE, millis)],
    ["nsh+ns: static long, main thread", inMode(MAIN, millis)],
    ["nsh+ns: static int, engine thread", inMode(ENGINE, pid)],
    ["nsh+ns: static int, main thread", inMode(MAIN, pid)],
    ["nsh+ns: string return, engine thread", inMode(ENGINE, prop)],
    ["nsh+ns: string return, main thread", inMode(MAIN, prop)],
    ["nsh+ns: new java.lang.Object, main thread", inMode(MAIN, objects)],
    ["nsh+ns: native to JS callback, main thread", inMode(MAIN, callback)],
  ];
  let index = 0;
  const results: Result[] = [];
  const next = async () => {
    if (index === cases.length) {
      setMode(MAIN);
      await isolated("isolated: nsh+ns int getter, main thread", () => process.myPid());
      setMode(0);
      await isolated("isolated: nsh module int getter, main thread", () => rust.pidOnMain());
      log("bench json", JSON.stringify(results));
      for (const r of results) log("bench", r.name, Math.round(r.nsPerCall), "ns");
      log("bench done");
      done();
      return;
    }
    const [name, loop] = cases[index++];
    log("start", name);
    results.push(measure(name, loop));
    setTimeout(next, 20);
  };
  next();
}

const RUN_STRESS = new java.io.File("/data/local/tmp/nsh-stress").exists();

setTimeout(() => {
  if (!RUN_STRESS) {
    bench(() => status.set("done"));
    return;
  }
  // Callbacks left over from the stress test would hold the main thread while
  // the Rust baseline blocks on it, so benchmarks run in a fresh process.
  stress(() => {
    status.set("done");
    log("bench done");
  });
}, 800);

mount(() => (
  <View style={{ flex: 1, padding: 40 }}>
    <Text>Check: {status()}</Text>
    <Text>Ticks: {ticks()}</Text>
  </View>
));
