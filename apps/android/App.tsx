import { mount, signal, Text, View } from "nsh";

declare const android: any, dev: any;

const release = android.os.Build.VERSION.RELEASE;
const model = android.os.Build.MODEL;
const info = `Android ${release}, ${model}`;
console.log("[android] device:", info);

const clicks = signal(0);
const frames = signal(0);
const dialogState = signal("not shown");

function start() {
  const activity = dev.nstudio.nshns.NsBridge.current;

  const button = new android.widget.Button(activity);
  button.setText("Native button from TSX");
  button.setOnClickListener(
    new android.view.View.OnClickListener({
      onClick() {
        clicks.set(clicks() + 1);
        console.log("[android] clicked, total", clicks());
      },
    }),
  );
  const params = new android.widget.FrameLayout.LayoutParams(
    android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
    android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
    android.view.Gravity.CENTER,
  );
  activity.addContentView(button, params);
  button.performClick();

  const choreographer = android.view.Choreographer.getInstance();
  const frameCallback = new android.view.Choreographer.FrameCallback({
    doFrame() {
      frames.set(frames() + 1);
      if (frames() < 120) {
        choreographer.postFrameCallback(frameCallback);
      } else {
        console.log("[android] choreographer finished at frame", frames());
      }
    },
  });
  choreographer.postFrameCallback(frameCallback);

  const dialog = new android.app.AlertDialog.Builder(activity)
    .setTitle("From TSX")
    .setMessage("Presented directly from nsh")
    .setPositiveButton("OK", null)
    .create();
  dialog.setOnShowListener(
    new android.content.DialogInterface.OnShowListener({
      onShow() {
        dialogState.set("shown");
        console.log("[android] dialog shown");
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
          new java.lang.Runnable({
            run() {
              dialog.dismiss();
              dialogState.set("dismissed");
              console.log("[android] dialog dismissed");
            },
          }),
          1000,
        );
      },
    }),
  );
  dialog.show();
}

declare const java: any;
setTimeout(start, 800);

mount(() => (
  <View style={{ flex: 1, padding: 24, paddingTop: 80, gap: 8 }}>
    <Text style={{ fontSize: 22, fontWeight: "700" }}>Android inside nsh</Text>
    <Text>{info}</Text>
    <Text>Button clicks: {clicks()}</Text>
    <Text>Choreographer frames: {frames()}</Text>
    <Text>Dialog: {dialogState()}</Text>
  </View>
));
