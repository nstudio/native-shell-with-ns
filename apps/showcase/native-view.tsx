import { effect, nativeComponent, signal } from "nsh";

declare const NSValue: any, interop: any, android: any, dev: any;

const Host = nativeComponent<Record<string, never>, { ready: { handle: number } }>("ns.view", {
  props: [],
  events: ["ready"],
});

function attach(handle: number, view: any) {
  if (typeof NSValue !== "undefined") {
    // `new NSView(pointer)` over-releases the view; an object returned from a
    // method is retained normally.
    const host = NSValue.valueWithPointer(new interop.Pointer(handle)).nonretainedObjectValue;
    view.frame = host.bounds;
    // Width and height sizable; the same bits in AppKit and UIKit.
    view.autoresizingMask = 2 | 16;
    host.addSubview(view);
  } else {
    const matchParent = android.view.ViewGroup.LayoutParams.MATCH_PARENT;
    dev.nstudio.nshns.NsBridge.hostView(handle).addView(
      view,
      new android.widget.FrameLayout.LayoutParams(matchParent, matchParent),
    );
  }
}

/** A platform view built in TypeScript and laid out by nsh like any element. */
export function NativeView<V>(props: { create: () => V; update?: (view: V) => void; style?: any }) {
  const view = signal<V | undefined>(undefined);
  effect(() => {
    const current = view();
    if (current !== undefined) props.update?.(current);
  });
  return (
    <Host
      style={props.style}
      onReady={({ handle }) => {
        const made = props.create();
        attach(handle, made);
        view.set(made);
      }}
    />
  );
}
