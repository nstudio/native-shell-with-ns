import { mount, signal, Text, View } from "nsh";
import { Panel } from "./Panel";

const ticks = signal(0);
const started = Date.now();
setInterval(() => {
  ticks.set(ticks() + 1);
  console.log(`[live] tick ${ticks()} started=${started}`);
}, 1000);

mount(() => (
  <View style={{ flex: 1, padding: 24, paddingTop: 60, gap: 10, backgroundColor: "#0b1020" }}>
    <Text style={{ color: "#65d6ad" }}>Ticks kept across reloads: {ticks()}</Text>
    <Panel />
  </View>
));
