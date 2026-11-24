package app.lovevectorspace.demo.capture;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** One-tap Pause/Resume from the "capturing" notification. Not exported. */
public class CaptureControlReceiver extends BroadcastReceiver {

    public static final String ACTION_TOGGLE = "app.lovevectorspace.demo.capture.TOGGLE_PAUSE";
    /** Lift the accessibility reader's 30-minute idle pause (setPaused(false) clears it). */
    public static final String ACTION_RESUME = "app.lovevectorspace.demo.capture.RESUME";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null) return;
        CaptureStore st = CaptureStore.get(ctx);
        if (ACTION_TOGGLE.equals(intent.getAction())) st.setPaused(!st.isPaused());
        else if (ACTION_RESUME.equals(intent.getAction())) st.setPaused(false);
        else return;
        CaptureIndicator.update(ctx);
    }
}
