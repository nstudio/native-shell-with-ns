package dev.nstudio.nshns;

import android.app.Activity;
import android.content.Context;
import android.util.SparseArray;
import android.view.View;
import android.widget.FrameLayout;

import com.longbridge.nsh.NshComponent;
import com.longbridge.nsh.NshView;

import java.util.Collections;

/** Lets the native bridge start NativeScript once nsh has created its VM. */
public final class NsBridge {
    /** The running activity, for TSX that needs a Context. */
    public static Activity current;

    private static Context appContext;
    private static final SparseArray<FrameLayout> hosts = new SparseArray<>();
    private static int nextHost = 1;

    private NsBridge() {}

    private static native void install();

    public static void setup(Activity activity) {
        System.loadLibrary("nsh");
        current = activity;
        appContext = activity.getApplicationContext();
        if (!new java.io.File("/data/local/tmp/nsh-off").exists()) install();
    }

    /** Registers {@code ns.view}: an empty view nsh lays out, handed to TSX to fill. */
    public static void registerComponents(NshView view) {
        view.registerComponent("ns.view", context -> {
            final int handle = nextHost++;
            final FrameLayout host = new FrameLayout(view.getContext());
            hosts.put(handle, host);
            context.emit("ready", Collections.singletonMap("handle", handle));
            return new NshComponent() {
                @Override public View view() { return host; }
                @Override public void setProp(String name, Object value) {}
                @Override public void destroy() { hosts.remove(handle); }
            };
        });
    }

    public static FrameLayout hostView(int handle) {
        return hosts.get(handle);
    }

    /** A Rust module's way to reach the main thread: post, then wait. */
    private static int pidOnMain() throws InterruptedException {
        final int[] pid = new int[1];
        final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
            pid[0] = android.os.Process.myPid();
            done.countDown();
        });
        done.await();
        return pid[0];
    }

    private static void bootNativeScript() {
        com.tns.RuntimeHelper.initRuntime(appContext);
    }
}
