import { mount, signal, Text, View } from "nsh";

declare const UIDevice: any, UIScreen: any, UIApplication: any, UIDatePicker: any, UIAlertController: any,
  UIAlertAction: any, UIAlertControllerStyle: any, UIAlertActionStyle: any, UIControlEvents: any,
  UIDatePickerMode: any, UIDatePickerStyle: any, CADisplayLink: any, NSRunLoop: any, NSDefaultRunLoopMode: any,
  NSTimer: any, NSObject: any, NativeClass: any, interop: any, CGRectMake: any;

const device = UIDevice.currentDevice;
const bounds = UIScreen.mainScreen.bounds;
const info = `${device.systemName} ${device.systemVersion}, ${bounds.size.width}×${bounds.size.height}`;
console.log("[uikit] device:", info);

const frames = signal(0);
const changes = signal(0);
const alertState = signal("not shown");

class Target extends NSObject {
  static ObjCExposedMethods = {
    "changed:": { params: [interop.types.id], returns: interop.types.void },
    "tick:": { params: [interop.types.id], returns: interop.types.void },
  };
  static {
    NativeClass(this);
  }
  changed(picker: any) {
    changes.set(changes() + 1);
    console.log("[uikit] date changed:", String(picker.date));
  }
  tick(link: any) {
    frames.set(frames() + 1);
    if (frames() === 120) {
      link.invalidate();
      console.log("[uikit] display link finished at frame", frames());
    }
  }
}

const target = Target.new();
const after = (seconds: number, run: () => void) =>
  NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(seconds, false, run);

after(0.8, () => {
  const window = UIApplication.sharedApplication.keyWindow;
  const picker = UIDatePicker.new();
  picker.datePickerMode = UIDatePickerMode.Date;
  picker.preferredDatePickerStyle = UIDatePickerStyle.Inline;
  picker.frame = CGRectMake(16, 300, bounds.size.width - 32, 360);
  picker.addTargetActionForControlEvents(target, "changed:", UIControlEvents.ValueChanged);
  window.addSubview(picker);
  picker.sendActionsForControlEvents(UIControlEvents.ValueChanged);

  const link = CADisplayLink.displayLinkWithTargetSelector(target, "tick:");
  link.addToRunLoopForMode(NSRunLoop.mainRunLoop, NSDefaultRunLoopMode);

  const alert = UIAlertController.alertControllerWithTitleMessagePreferredStyle(
    "From TSX",
    "Presented directly from nsh",
    UIAlertControllerStyle.Alert,
  );
  alert.addAction(UIAlertAction.actionWithTitleStyleHandler("OK", UIAlertActionStyle.Default, null));
  window.rootViewController.presentViewControllerAnimatedCompletion(alert, true, () => {
    alertState.set("presented");
    console.log("[uikit] alert presented");
    after(1.0, () =>
      alert.dismissViewControllerAnimatedCompletion(true, () => {
        alertState.set("dismissed");
        console.log("[uikit] alert dismissed");
      }),
    );
  });
});

mount(() => (
  <View style={{ flex: 1, padding: 24, paddingTop: 80, gap: 8 }}>
    <Text style={{ fontSize: 22, fontWeight: "700" }}>UIKit inside nsh</Text>
    <Text>{info}</Text>
    <Text>Picker events: {changes()}</Text>
    <Text>Display link frames: {frames()}</Text>
    <Text>Alert: {alertState()}</Text>
  </View>
));
