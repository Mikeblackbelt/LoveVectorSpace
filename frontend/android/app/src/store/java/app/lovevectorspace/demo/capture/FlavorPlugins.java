package app.lovevectorspace.demo.capture;

import com.getcapacitor.BridgeActivity;

/** Store flavour: no reader plugins. JS sees LvsCapture as unavailable and hides the readers. */
public final class FlavorPlugins {

    private FlavorPlugins() {}

    public static void register(BridgeActivity activity) {
        // Intentionally empty.
    }
}
