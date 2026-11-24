package app.lovevectorspace.demo.capture;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;

/**
 * LvsCapture (sideload flavour only): JS control surface for the notification, SMS and
 * accessibility readers. See src/native/capture.ts for the TypeScript interface. The built-in
 * Capacitor requestPermissions({ permissions: ["sms", "notifications"] }) handles the aliases below.
 */
@CapacitorPlugin(
    name = "LvsCapture",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    }
)
public class CapturePlugin extends Plugin {

    private CaptureStore store() {
        return CaptureStore.get(getContext());
    }

    private JSObject method(boolean enabled, boolean granted) {
        JSObject o = new JSObject();
        o.put("supported", true);
        o.put("enabled", enabled);
        o.put("granted", granted);
        return o;
    }

    private JSObject statusObject() {
        CaptureStore st = store();
        JSObject methods = new JSObject();
        methods.put("notify", method(st.isEnabled(CaptureApps.NOTIFY), CaptureIndicator.notifyAccessGranted(getContext())));
        methods.put("sms", method(st.isEnabled(CaptureApps.SMS), CaptureIndicator.smsGranted(getContext())));
        JSObject a11y = method(st.isEnabled(CaptureApps.A11Y), CaptureIndicator.a11yAccessGranted(getContext()));
        a11y.put("idle", st.isA11yIdle());
        methods.put("a11y", a11y);
        JSObject o = new JSObject();
        o.put("methods", methods);
        o.put("paused", st.isPaused());
        o.put("pausedReason", st.isPaused() ? "user" : st.isA11yIdle() ? "idle" : null);
        o.put("queued", st.queued());
        o.put("notificationsGranted", CaptureIndicator.canPostNotifications(getContext()));
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        // Cheap and idempotent: (re)posts the capturing notification once POST_NOTIFICATIONS is granted.
        CaptureIndicator.update(getContext());
        call.resolve(statusObject());
    }

    @PluginMethod
    public void getLinks(PluginCall call) {
        try {
            JSObject o = new JSObject();
            o.put("links", new JSArray(CaptureStore.linksToJson(store().links()).toString()));
            call.resolve(o);
        } catch (JSONException e) {
            call.reject("Could not read linked contacts");
        }
    }

    @PluginMethod
    public void setLinks(PluginCall call) {
        JSONArray a = call.getArray("links");
        if (a == null) {
            call.reject("links is required");
            return;
        }
        try {
            store().setLinks(CaptureStore.linksFromJson(a));
            call.resolve();
        } catch (JSONException e) {
            call.reject("Invalid links");
        }
    }

    private static boolean validMethod(String m) {
        return CaptureApps.NOTIFY.equals(m) || CaptureApps.SMS.equals(m) || CaptureApps.A11Y.equals(m);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        String m = call.getString("method");
        Boolean on = call.getBoolean("enabled");
        if (!validMethod(m) || on == null) {
            call.reject("method and enabled are required");
            return;
        }
        store().setEnabled(m, on);
        CaptureIndicator.update(getContext());
        call.resolve(statusObject());
    }

    @PluginMethod
    public void setPaused(PluginCall call) {
        Boolean p = call.getBoolean("paused");
        if (p == null) {
            call.reject("paused is required");
            return;
        }
        store().setPaused(p);
        CaptureIndicator.update(getContext());
        call.resolve(statusObject());
    }

    @PluginMethod
    public void openSystemSettings(PluginCall call) {
        String m = call.getString("method", "app");
        Intent i;
        if (CaptureApps.NOTIFY.equals(m)) i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        else if (CaptureApps.A11Y.equals(m)) i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        else i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open settings");
        }
    }

    @PluginMethod
    public void syncSms(PluginCall call) {
        // Plugin methods run on Capacitor's background thread, so provider queries are fine here.
        int n = SmsReader.sync(getContext());
        if (n > 0) CaptureIndicator.update(getContext());
        JSObject o = new JSObject();
        o.put("queued", n);
        call.resolve(o);
    }

    @PluginMethod
    public void drain(PluginCall call) {
        int max = call.getInt("max", 500);
        try {
            JSArray items = new JSArray();
            for (CaptureQueue.Item it : store().drain(Math.max(1, Math.min(max, 1000)))) items.put(CaptureStore.itemToJson(it, false));
            JSObject o = new JSObject();
            o.put("items", items);
            call.resolve(o);
        } catch (JSONException e) {
            call.reject("Could not read the queue");
        }
    }

    @PluginMethod
    public void ack(PluginCall call) {
        JSONArray a = call.getArray("ids");
        List<String> ids = new ArrayList<>();
        for (int i = 0; a != null && i < a.length(); i++) ids.add(a.optString(i));
        int n = store().ack(ids);
        CaptureIndicator.update(getContext());
        JSObject o = new JSObject();
        o.put("removed", n);
        call.resolve(o);
    }

    @PluginMethod
    public void deleteContact(PluginCall call) {
        String m = call.getString("method"), app = call.getString("app"), contact = call.getString("contact");
        if (!validMethod(m) || app == null || contact == null) {
            call.reject("method, app and contact are required");
            return;
        }
        int n = store().removeContact(m, app, contact);
        CaptureIndicator.update(getContext());
        JSObject o = new JSObject();
        o.put("removed", n);
        call.resolve(o);
    }
}
