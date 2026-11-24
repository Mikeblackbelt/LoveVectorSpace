// Registers the app-local LvsOcr plugin with the Capacitor bridge.
//
// COMPILE-UNTESTED (written without a Mac). To activate (docs/mobile-capture.md "iOS setup"):
//   1. Add this folder (App/Capture) to the App target in Xcode.
//   2. In Base.lproj/Main.storyboard, change the view controller's custom class from
//      CAPBridgeViewController (module Capacitor) to LvsBridgeViewController (module App).
//   3. Build. JS detects the plugin with Capacitor.isPluginAvailable("LvsOcr").

import Capacitor
import UIKit

class LvsBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LvsOcrPlugin())
    }
}
