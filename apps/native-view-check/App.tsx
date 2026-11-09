import { mount, signal, Text, View } from "nsh";
import { start as startAndroid } from "../showcase/android";
import { start as startIOS } from "../showcase/ios";
import { start as startMacOS } from "../showcase/macos";
import { NativeView } from "../showcase/native-view";

declare const UIControlEvents: any, NSStatusBar: unknown, UIDevice: unknown;

const isMac = typeof NSStatusBar !== "undefined";
const isIOS = typeof UIDevice !== "undefined";
const app = { platform() {}, log() {}, event() {} };
const controls = (isMac ? startMacOS : isIOS ? startIOS : startAndroid)(app);

const level = signal(40);
const shown = signal(true);
const results = signal<string[]>([]);
let slider: any;
let creations = 0;

function report(name: string, ok: boolean, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"} ${name} ${detail}`;
  console.log(`[native-view] ${line}`);
  results.set([...results(), line]);
}

function nativeValue() {
  return isMac ? slider.doubleValue : isIOS ? slider.value : slider.getProgress();
}

function nativeSize() {
  if (isMac || isIOS) return slider.frame.size.width;
  return slider.getWidth();
}

function fireFromNative(value: number) {
  if (isMac) {
    slider.doubleValue = value;
    slider.sendActionTo(slider.action, slider.target);
  } else if (isIOS) {
    slider.value = value;
    slider.sendActionsForControlEvents(UIControlEvents.ValueChanged);
  } else {
    slider.setProgress(value);
  }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function run() {
  await wait(1200);
  report("created", creations === 1, `creations=${creations}`);
  report("initial value reaches native", Math.round(nativeValue()) === 40, `native=${nativeValue()}`);
  report("laid out by nsh", nativeSize() > 100, `width=${nativeSize()}`);

  fireFromNative(70);
  await wait(200);
  report("native to signal", level() === 70, `level=${level()}`);

  level.set(25);
  await wait(200);
  report("signal to native", Math.round(nativeValue()) === 25, `native=${nativeValue()}`);

  shown.set(false);
  await wait(300);
  shown.set(true);
  await wait(600);
  report("remount makes a new view", creations === 2, `creations=${creations}`);
  report("remounted view is bound", Math.round(nativeValue()) === 25, `native=${nativeValue()}`);
  console.log("[native-view] done");
}

run();

mount(() => (
  <View style={{ flex: 1, padding: 24, paddingTop: 80, gap: 8, backgroundColor: "#0b1020" }}>
    {shown() ? (
      <NativeView
        style={{ height: 36, alignSelf: "stretch" }}
        create={() => {
          creations++;
          slider = controls.slider((value) => level.set(value));
          return slider;
        }}
        update={(view) => controls.setSlider(view, level())}
      />
    ) : null}
    <Text style={{ color: "#ffffff" }}>{results().join("\n")}</Text>
  </View>
));
