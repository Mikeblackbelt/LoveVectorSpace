package app.lovevectorspace.demo.capture;

import com.getcapacitor.BridgeActivity;

/** Sideload flavour: registers the LvsCapture reader plugin. */
public final class FlavorPlugins {

    private FlavorPlugins() {}

    public static void register(BridgeActivity activity) {
        activity.registerPlugin(CapturePlugin.class);
    }
}
