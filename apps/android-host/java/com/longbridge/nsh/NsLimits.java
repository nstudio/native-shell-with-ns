package com.longbridge.nsh;

/** Reaches the package-private switch for an app's own, unlimited VM. */
public final class NsLimits {
    private NsLimits() {}

    public static void standalone(NshView view) {
        view.useStandaloneLimits();
    }
}
