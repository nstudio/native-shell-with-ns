import { mount, signal, Text, View } from "nsh";

declare const NSThread: any, NSDate: any, NSNumber: any, NSString: any, NSMutableArray: any, NSProcessInfo: any,
  NSTimer: any, NSDateFormatter: any;
declare function gc(): void;

const stats = (globalThis as any).__nshNsCallStats as () => { engine: number; main: number };
const failures: string[] = [];

function path(run: () => void) {
  const before = stats();
  run();
  const after = stats();
  return { engine: after.engine - before.engine, main: after.main - before.main };
}

function check(name: string, ok: boolean, detail: unknown) {
  console.log(`[threads] ${ok ? "PASS" : "FAIL"} ${name}`, JSON.stringify(detail));
  if (!ok) failures.push(name);
}

const expectEngine = (name: string, run: () => void) => {
  const p = path(run);
  check(name + " stays on the engine thread", p.engine > 0 && p.main === 0, p);
};
const expectMain = (name: string, run: () => void) => {
  const p = path(run);
  check(name + " goes to main", p.main > 0 && p.engine === 0, p);
};

const dateClass = NSDate;
const numberClass = NSNumber;
const threadClass = NSThread;
const date = dateClass.date();
const processInfo = NSProcessInfo.processInfo;

// Calls made while the main thread is busy cross to it, so wait until it is idle.
function runChecks() {
  expectEngine("NSDate getter", () => date.timeIntervalSince1970);
  expectEngine("NSDate class method", () => dateClass.date());
  expectEngine("NSNumber", () => numberClass.numberWithInt(42));
  expectMain("NSProcessInfo getter", () => processInfo.processIdentifier);
  expectMain("NSThread class method", () => threadClass.isMainThread);

  const mutable = NSMutableArray.new();
  expectMain("NSMutableArray", () => mutable.addObject("x"));

  check("unlisted calls really run on main", NSThread.isMainThread === true, NSThread.isMainThread);

  const parts = NSString.stringWithString("a,b,c").componentsSeparatedByString(",");
  const seen: string[] = [];
  parts.enumerateObjectsUsingBlock((value: any) => {
    seen.push(String(value));
  });
  check("block runs synchronously from an engine-thread call", seen.join() === "a,b,c", seen);

  NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(0.2, false, () => {
    timerFired.set(true);
    check("NSTimer attached to the main run loop", true, "fired");
  });

  const text = "x".repeat(128);
  let batches = 0;
  const formatter = NSDateFormatter.new();
  formatter.dateFormat = "yyyy-MM-dd HH:mm:ss";
  const churn = setInterval(() => {
    for (let i = 0; i < 4000; i++) {
      NSString.stringWithString(text);
      formatter.stringFromDate(date);
    }
    gc();
    if (++batches === 40) {
      clearInterval(churn);
      console.log("[threads] churn finished", JSON.stringify(stats()));
      console.log(`[threads] ${failures.length ? "FAILED: " + failures.join("; ") : "ALL PASSED"}`);
    } else if (batches % 10 === 0) {
      console.log("[threads] churn batch", batches);
    }
  }, 100);
}
setTimeout(runChecks, 1500);

const timerFired = signal(false);

mount(() => (
  <View style={{ flex: 1, padding: 40, gap: 8 }}>
    <Text>Timer fired: {String(timerFired())}</Text>
  </View>
));
