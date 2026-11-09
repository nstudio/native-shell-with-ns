import { mount, Text, View } from "nsh";

const stats = (globalThis as any).__nshNsCallStats;
console.log("[blank] boot nanos:", stats ? stats().bootNanos : "NativeScript off");

mount(() => (
  <View style={{ flex: 1, padding: 40 }}>
    <Text>Blank app</Text>
  </View>
));
