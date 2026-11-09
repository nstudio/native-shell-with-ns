import { mount, signal, Text, View } from "nsh";
import { setTray } from "./tray";

declare const NSTimer: any;

const clicks = signal(0);
const selected = signal("nothing yet");

const tray = setTray({
  symbol: "bolt.fill",
  tooltip: "NS Tray",
  onClick: () => {
    clicks.set(clicks() + 1);
    console.log("[tray] onClick, clicks =", clicks());
  },
  menu: [
    {
      label: "New Message",
      onSelect: () => {
        selected.set("New Message");
        console.log("[tray] selected New Message");
      },
    },
    { type: "separator" },
    { role: "quit" },
  ],
})!;

NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(1.0, false, () => {
  console.log("[tray] timer block on run loop");
  tray.menu.performActionForItemAtIndex(0);
  tray.button.performClick(null);
  console.log("[tray] after synthetic click, clicks =", clicks());
});

mount(() => (
  <View style={{ flex: 1, padding: 24, gap: 8 }}>
    <Text style={{ fontSize: 22, fontWeight: "700" }}>NativeScript tray inside nsh</Text>
    <Text>Tray clicks: {clicks()}</Text>
    <Text>Selected: {selected()}</Text>
  </View>
));
