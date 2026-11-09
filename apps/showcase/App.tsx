import { mount, Scroll, signal, Text, View } from "nsh";
import { start as startAndroid } from "./android";
import { start as startIOS } from "./ios";
import { start as startMacOS } from "./macos";
import { NativeView } from "./native-view";
import type { Showcase } from "./types";

declare const NSStatusBar: unknown, UIDevice: unknown;

const platform = signal("");
const events = signal(0);
const lines = signal<string[]>([]);
const level = signal(40);

const app: Showcase = {
  platform: (value) => platform.set(value),
  log: (line) => lines.set([...lines(), line]),
  event: () => events.set(events() + 1),
};

const controls = (typeof NSStatusBar !== "undefined" ? startMacOS : typeof UIDevice !== "undefined" ? startIOS : startAndroid)(app);

const caption = { fontSize: 13, color: "#93a4c8" };

mount(() => (
  <Scroll style={{ flex: 1, backgroundColor: "#0b1020" }}>
    <View style={{ padding: 24, paddingTop: 64, gap: 10 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", color: "#ffffff" }}>NativeScript in nsh</Text>
      <Text style={{ fontSize: 15, color: "#93a4c8" }}>One TSX app. Each platform's own APIs. No native code.</Text>
      <Text style={{ fontSize: 15, color: "#ffffff", marginTop: 12 }}>{platform()}</Text>
      <Text style={{ fontSize: 15, color: "#65d6ad" }}>Native events received in signals: {events()}</Text>
      <Text style={{ fontSize: 14, color: "#c8d3ea" }}>{lines().join("\n")}</Text>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 }}>
        <Text style={{ fontSize: 17, fontWeight: "600", color: "#ffffff" }}>Level {level()}</Text>
        <View onPress={() => level.set(0)}>
          <Text style={{ fontSize: 15, color: "#7aa2ff" }}>Reset from TSX</Text>
        </View>
      </View>
      <NativeView
        style={{ height: 36, alignSelf: "stretch" }}
        create={() => controls.slider((value) => level.set(value))}
        update={(slider) => controls.setSlider(slider, level())}
      />
      <Text style={caption}>A native slider, placed by nsh's layout, bound to a signal both ways.</Text>

      <NativeView
        style={{ height: 300, alignSelf: "stretch", borderRadius: 14, overflow: "hidden", marginTop: 8 }}
        create={controls.feature}
      />
      <Text style={caption}>{controls.featureName}, created in TypeScript. It scrolls and clips with the page.</Text>
    </View>
  </Scroll>
));
