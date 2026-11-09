export type Result = { name: string; n: number; nsPerCall: number; runs: number[] };

const RUNS = 7;
const TARGET_MS = 150;

function timeOnce(loop: (n: number) => void, n: number) {
  const start = performance.now();
  loop(n);
  return performance.now() - start;
}

// One timed loop per JS turn: nsh interrupts a turn that runs past its budget.
const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function measure(name: string, loop: (n: number) => void): Promise<Result> {
  let n = 1000;
  while (timeOnce(loop, n) < TARGET_MS / 4 && n < 4e8) {
    n *= 4;
    await nextTurn();
  }
  const runs: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    await nextTurn();
    runs.push((timeOnce(loop, n) / n) * 1e6);
  }
  const sorted = [...runs].sort((a, b) => a - b);
  return { name, n, nsPerCall: sorted[RUNS >> 1], runs };
}

export function nativeScriptCases(g: any) {
  const processInfo = g.NSProcessInfo.processInfo;
  class Echo extends g.NSObject {
    static ObjCExposedMethods = {
      "echo:": { params: [g.interop.types.id], returns: g.interop.types.id },
    };
    static {
      g.NativeClass(this);
    }
    echo(value: any) {
      return value;
    }
  }
  const echo = (Echo as any).new();
  const date = g.NSDate.date();
  const numberClass = g.NSNumber;
  const rect = (g.CGRectMake ?? g.NSMakeRect)(0, 0, 10, 20);
  const formatter = g.NSDateFormatter.new();
  formatter.dateFormat = "yyyy-MM-dd";
  return {
    date(n: number) {
      for (let i = 0; i < n; i++) date.timeIntervalSince1970;
    },
    number(n: number) {
      for (let i = 0; i < n; i++) numberClass.numberWithInt(42).intValue;
    },
    structField(n: number) {
      for (let i = 0; i < n; i++) rect.size;
    },
    formatDate(n: number) {
      for (let i = 0; i < n; i++) formatter.stringFromDate(date);
    },
    pid(n: number) {
      for (let i = 0; i < n; i++) processInfo.processIdentifier;
    },
    osVersion(n: number) {
      for (let i = 0; i < n; i++) processInfo.operatingSystemVersionString;
    },
    newObject(n: number) {
      for (let i = 0; i < n; i++) g.NSObject.new();
    },
    callback(n: number) {
      for (let i = 0; i < n; i++) echo.performSelectorWithObject("echo:", "ping");
    },
  };
}
