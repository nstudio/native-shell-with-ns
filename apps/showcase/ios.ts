import type { Controls, Showcase } from "./types";

declare const UIDevice: any, UIApplication: any, UIAlertController: any,
  UIAlertAction: any, UIAlertControllerStyle: any, UIAlertActionStyle: any, UIControlEvents: any,
  UISlider: any, MKMapView: any, NSBundle: any, NSObject: any, NativeClass: any, interop: any, CGRectMake: any,
  NSTimer: any;

// Controls reference their targets weakly, so JS has to keep them alive.
const targets = new WeakMap<object, unknown>();

export function start(app: Showcase): Controls {
  const device = UIDevice.currentDevice;
  app.platform(`${device.systemName} ${device.systemVersion}`);

  NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(0.8, false, () => {
    const window = UIApplication.sharedApplication.keyWindow;

    const alert = UIAlertController.alertControllerWithTitleMessagePreferredStyle(
      "Straight from TypeScript",
      "UIKit, called from an nsh TSX app.",
      UIAlertControllerStyle.Alert,
    );
    alert.addAction(UIAlertAction.actionWithTitleStyleHandler("OK", UIAlertActionStyle.Default, null));
    window.rootViewController.presentViewControllerAnimatedCompletion(alert, true, () => {
      app.log("UIAlertController presented");
      NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(1, false, () => {
        alert.dismissViewControllerAnimatedCompletion(true, () => app.log("UIAlertController dismissed"));
      });
    });
  });

  return {
    featureName: "MKMapView",
    feature: () => {
      // The host binary doesn't link MapKit, so its classes don't exist until it is loaded.
      NSBundle.bundleWithPath("/System/Library/Frameworks/MapKit.framework").load();
      return MKMapView.new();
    },
    slider(onChange) {
      class Target extends NSObject {
        static ObjCExposedMethods = {
          "changed:": { params: [interop.types.id], returns: interop.types.void },
        };
        static {
          NativeClass(this);
        }
        changed(sender: any) {
          onChange(Math.round(sender.value));
        }
      }
      const slider = UISlider.new();
      slider.minimumValue = 0;
      slider.maximumValue = 100;
      const target = (Target as any).new();
      slider.addTargetActionForControlEvents(target, "changed:", UIControlEvents.ValueChanged);
      targets.set(slider, target);
      return slider;
    },
    setSlider(slider, value) {
      if (Math.round(slider.value) !== value) slider.value = value;
    },
  };
}
