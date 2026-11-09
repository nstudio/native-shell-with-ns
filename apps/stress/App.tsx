import { mount, signal, Text, View } from "nsh";

declare const NSTimer: any, NSObject: any, NSOperationQueue: any, NSArray: any,
  NativeClass: any, interop: any, NSProcessInfo: any;
declare function gc(): void;

const counters = { engineTicks: 0, runLoopBlocks: 0, nested: 0, background: 0, views: 0, errors: 0 };
const ticks = signal(0);

class Echo extends NSObject {
  static ObjCExposedMethods = {
    "echo:": { params: [interop.types.id], returns: interop.types.id },
  };
  static {
    NativeClass(this);
  }
  echo(value: any) {
    counters.nested++;
    ticks.set(ticks() + 1);
    return value;
  }
}
const echo = Echo.new();

setInterval(() => {
  counters.engineTicks++;
  ticks.set(ticks() + 1);
  NSProcessInfo.processInfo.processIdentifier;
}, 1);

NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(0.001, true, () => {
  counters.runLoopBlocks++;
  try {
    const out = echo.performSelectorWithObject("echo:", "ping");
    if (out !== "ping") counters.errors++;
  } catch (e) {
    counters.errors++;
    console.log("[stress] error", String(e));
  }
});

const queue = NSOperationQueue.new();
setInterval(() => {
  for (let i = 0; i < 8; i++) queue.addOperationWithBlock(() => counters.background++);
}, 5);

setInterval(() => {
  for (let i = 0; i < 200; i++) {
    (globalThis as any).UIView ? (globalThis as any).UIView.new() : (globalThis as any).NSView.new();
    counters.views++;
  }
  gc();
}, 50);

setInterval(() => console.log("[stress]", JSON.stringify(counters)), 1000);

mount(() => (
  <View style={{ flex: 1, padding: 24 }}>
    <Text>ticks {ticks()}</Text>
  </View>
));
