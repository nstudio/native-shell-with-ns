declare const NSObject: any, NSStatusBar: any, NSImage: any, NSApplication: any, NSMenu: any,
  NSMenuItem: any, NSEventMask: any, NSEventType: any, NSEventModifierFlags: any, NativeClass: any,
  interop: any, NSVariableStatusItemLength: number;

export type TrayItem =
  | { label: string; onSelect: () => void }
  | { type: "separator" }
  | { role: "quit" };

export interface TrayOptions {
  symbol: string;
  tooltip: string;
  onClick?: () => void;
  menu?: TrayItem[];
}

class TrayTarget extends NSObject {
  static ObjCExposedMethods = {
    "clicked:": { params: [interop.types.id], returns: interop.types.void },
    "selected:": { params: [interop.types.id], returns: interop.types.void },
  };
  static {
    NativeClass(this);
  }
  onClick?: () => void;
  openMenu?: () => void;
  handlers: Array<() => void> = [];

  clicked() {
    const event = NSApplication.sharedApplication.currentEvent;
    const secondary =
      event?.type === NSEventType.RightMouseUp ||
      event?.type === NSEventType.RightMouseDown ||
      (event?.modifierFlags & NSEventModifierFlags.Control) !== 0;
    secondary ? this.openMenu?.() : this.onClick?.();
  }

  selected(sender: any) {
    this.handlers[sender.tag]?.();
  }
}

let item: any;
let target: any;

function buildMenu(items: TrayItem[]) {
  const menu = NSMenu.new();
  target.handlers = [];
  for (const entry of items) {
    if ("type" in entry) {
      menu.addItem(NSMenuItem.separatorItem());
    } else if ("role" in entry) {
      const quit = NSMenuItem.alloc().initWithTitleActionKeyEquivalent("Quit", "terminate:", "");
      menu.addItem(quit);
    } else {
      const row = NSMenuItem.alloc().initWithTitleActionKeyEquivalent(entry.label, "selected:", "");
      row.target = target;
      row.tag = target.handlers.push(entry.onSelect) - 1;
      menu.addItem(row);
    }
  }
  return menu;
}

export function setTray(options: TrayOptions | null) {
  if (!options) {
    if (item) NSStatusBar.systemStatusBar.removeStatusItem(item);
    item = target = undefined;
    return;
  }
  item ??= NSStatusBar.systemStatusBar.statusItemWithLength(NSVariableStatusItemLength);
  target ??= TrayTarget.new();

  const menu = options.menu?.length ? buildMenu(options.menu) : null;
  const button = item.button;
  button.image = NSImage.imageWithSystemSymbolNameAccessibilityDescription(options.symbol, options.tooltip);
  button.toolTip = options.tooltip;
  button.accessibilityLabel = options.tooltip;

  target.onClick = options.onClick;
  target.openMenu = () => {
    item.menu = menu;
    button.performClick(null);
    item.menu = options.onClick ? null : menu;
  };

  button.target = options.onClick ? target : null;
  button.action = options.onClick ? "clicked:" : null;
  button.sendActionOn(NSEventMask.LeftMouseUp | NSEventMask.RightMouseUp);
  item.menu = options.onClick ? null : menu;
  return { button, menu };
}
