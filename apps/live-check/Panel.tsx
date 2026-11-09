import { Text } from "nsh";
import { NativeView } from "../showcase/native-view";

declare const NSTextField: any, UILabel: any, NSObject: any, NativeClass: any, android: any, dev: any;

const g = globalThis as any;

const VERSION = "v1";

const Marker = g.NSObject
  ? class extends NSObject {
      static {
        NativeClass(this);
      }
    }
  : undefined;

function label(text: string) {
  if (g.NSTextField) return NSTextField.labelWithString(text);
  if (g.UILabel) {
    const view = UILabel.new();
    view.text = text;
    view.textColor = g.UIColor.whiteColor;
    return view;
  }
  const view = new android.widget.TextView(dev.nstudio.nshns.NsBridge.current);
  view.setText(text);
  return view;
}

export function Panel() {
  return (
    <>
      <Text style={{ color: "#ffffff" }}>TSX says {VERSION}</Text>
      <NativeView
        style={{ height: 40, alignSelf: "stretch" }}
        create={() => {
          if (Marker) (Marker as any).new();
          console.log(`[live] native view created ${VERSION}`);
          return label(`Native says ${VERSION}`);
        }}
      />
    </>
  );
}
