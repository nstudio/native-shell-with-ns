package dev.nstudio.nshns;

import android.app.Activity;
import android.os.Bundle;

import com.longbridge.nsh.NshView;

public final class MainActivity extends Activity {
    private NshView view;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        NsBridge.setup(this);
        view = new NshView(this);
        com.longbridge.nsh.NsLimits.standalone(view);
        NsBridge.registerComponents(view);
        setContentView(view);
        String devServer = devServerUrl();
        if (devServer == null || !view.connectDevServer(devServer)) view.loadAssetBundle("nsh");
    }

    /** The marker is set by scripts/dev-android.sh, which forwards this port with adb reverse. */
    private static String devServerUrl() {
        return new java.io.File("/data/local/tmp/nsh-dev-server").exists() ? "ws://127.0.0.1:8790/ws" : null;
    }

    @Override
    protected void onDestroy() {
        view.destroy();
        super.onDestroy();
    }
}
