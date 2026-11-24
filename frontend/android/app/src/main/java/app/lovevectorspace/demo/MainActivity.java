package app.lovevectorspace.demo;

import android.os.Bundle;
import app.lovevectorspace.demo.capture.FlavorPlugins;
import app.lovevectorspace.demo.capture.OcrPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered before the bridge starts.
        registerPlugin(OcrPlugin.class);
        // store: nothing; sideload: the LvsCapture reader plugin (src/<flavour>/java/.../FlavorPlugins.java).
        FlavorPlugins.register(this);
        super.onCreate(savedInstanceState);
    }
}
