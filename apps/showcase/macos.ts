import { setTray } from "./tray";
import type { Controls, Showcase } from "./types";

declare const NSProcessInfo: any, NSSlider: any, MKMapView: any, NSObject: any, NativeClass: any, interop: any;

// Controls reference their targets weakly, so JS has to keep them alive.
const targets = new WeakMap<object, unknown>();

export function start(app: Showcase): Controls {
  app.platform(NSProcessInfo.processInfo.operatingSystemVersionString);

  const tray = setTray({
    symbol: "bolt.fill",
    tooltip: "NativeScript in nsh",
    onClick: () => {
      app.event();
      app.log("NSStatusItem clicked");
    },
    menu: [
      { label: "Say hello", onSelect: () => app.log("Menu item selected") },
      { type: "separator" },
      { role: "quit" },
    ],
  })!;

  setTimeout(() => {
    tray.menu.performActionForItemAtIndex(0);
    tray.button.performClick(null);
  }, 800);

  return {
    featureName: "MKMapView",
    feature: () => MKMapView.new(),
    slider(onChange) {
      class Target extends NSObject {
        static ObjCExposedMethods = {
          "changed:": { params: [interop.types.id], returns: interop.types.void },
        };
        static {
          NativeClass(this);
        }
        changed(sender: any) {
          onChange(Math.round(sender.doubleValue));
        }
      }
      const target = (Target as any).new();
      const slider = NSSlider.new();
      slider.minValue = 0;
      slider.maxValue = 100;
      slider.target = target;
      slider.action = "changed:";
      targets.set(slider, target);
      return slider;
    },
    setSlider(slider, value) {
      if (Math.round(slider.doubleValue) !== value) slider.doubleValue = value;
    },
  };
}
