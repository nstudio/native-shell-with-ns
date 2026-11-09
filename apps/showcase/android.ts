import type { Controls, Showcase } from "./types";

declare const android: any, java: any, dev: any;

export function start(app: Showcase): Controls {
  app.platform(`Android ${android.os.Build.VERSION.RELEASE}`);

  setTimeout(() => {
    const activity = dev.nstudio.nshns.NsBridge.current;

    const dialog = new android.app.AlertDialog.Builder(activity)
      .setTitle("Straight from TypeScript")
      .setMessage("Android's Java APIs, called from an nsh TSX app.")
      .setPositiveButton("OK", null)
      .create();
    dialog.setOnShowListener(
      new android.content.DialogInterface.OnShowListener({
        onShow() {
          app.log("AlertDialog shown");
          new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
            new java.lang.Runnable({
              run() {
                dialog.dismiss();
                app.log("AlertDialog dismissed");
              },
            }),
            1000,
          );
        },
      }),
    );
    dialog.show();
  }, 800);

  const activity = dev.nstudio.nshns.NsBridge.current;
  return {
    featureName: "CalendarView",
    feature: () =>
      new android.widget.CalendarView(
        new android.view.ContextThemeWrapper(activity, android.R.style.Theme_Material),
      ),
    slider(onChange) {
      const slider = new android.widget.SeekBar(activity);
      slider.setMax(100);
      slider.setOnSeekBarChangeListener(
        new android.widget.SeekBar.OnSeekBarChangeListener({
          onProgressChanged: (_bar: any, progress: number) => onChange(progress),
          onStartTrackingTouch() {},
          onStopTrackingTouch() {},
        }),
      );
      return slider;
    },
    setSlider(slider, value) {
      if (slider.getProgress() !== value) slider.setProgress(value);
    },
  };
}
