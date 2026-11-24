package app.lovevectorspace.demo.capture;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;

/**
 * The persistent "capturing" notification with a one-tap Pause/Resume, plus OS-access checks.
 * Shown while any reader is switched on; removed when all are off.
 */
public final class CaptureIndicator {

    private static final String CHANNEL = "lvs_capture";
    private static final int ID = 4711;

    private CaptureIndicator() {}

    public static boolean notifyAccessGranted(Context ctx) {
        return NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.getPackageName());
    }

    public static boolean a11yAccessGranted(Context ctx) {
        String flat = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (TextUtils.isEmpty(flat)) return false;
        ComponentName me = new ComponentName(ctx, LvsAccessibilityService.class);
        for (String s : flat.split(":")) {
            ComponentName c = ComponentName.unflattenFromString(s);
            if (me.equals(c)) return true;
        }
        return false;
    }

    public static boolean smsGranted(Context ctx) {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean canPostNotifications(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
    }

    @SuppressLint("MissingPermission") // checked by canPostNotifications() before notify()
    public static void update(Context ctx) {
        CaptureStore st = CaptureStore.get(ctx);
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        List<String> on = new ArrayList<>();
        if (st.isEnabled(CaptureApps.NOTIFY)) on.add("notifications");
        if (st.isEnabled(CaptureApps.SMS)) on.add("SMS");
        if (st.isEnabled(CaptureApps.A11Y)) on.add(st.isA11yIdle() ? "chat screens (idle-paused)" : "chat screens");
        if (on.isEmpty()) {
            nm.cancel(ID);
            return;
        }
        if (!canPostNotifications(ctx)) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager sys = ctx.getSystemService(NotificationManager.class);
            if (sys != null && sys.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Phone capture", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Shows while LoveVectorSpace is capturing linked chats");
                ch.setShowBadge(false);
                sys.createNotificationChannel(ch);
            }
        }
        boolean paused = st.isPaused();
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent toggle = new Intent(ctx, CaptureControlReceiver.class).setAction(CaptureControlReceiver.ACTION_TOGGLE);
        PendingIntent togglePi = PendingIntent.getBroadcast(ctx, 1, toggle, flags);
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent openPi = open == null ? null : PendingIntent.getActivity(ctx, 2, open, flags);
        String title = paused ? "Phone capture paused" : "Capturing linked chats";
        String text = (paused ? "Paused: " : "Reading ") + TextUtils.join(", ", on) + " · " + st.queued() + " waiting to upload";
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .addAction(0, paused ? "Resume" : "Pause", togglePi);
        if (!paused && st.isA11yIdle()) {
            Intent resume = new Intent(ctx, CaptureControlReceiver.class).setAction(CaptureControlReceiver.ACTION_RESUME);
            b.addAction(0, "Resume chat reader", PendingIntent.getBroadcast(ctx, 3, resume, flags));
        }
        if (openPi != null) b.setContentIntent(openPi);
        // Foreground-service style: if the user swipes it away while capture is on, it comes back
        // (pause is the way to stop). Readers are inactive whenever it can't be shown at all.
        Intent repost = new Intent(ctx, CaptureControlReceiver.class).setAction(CaptureControlReceiver.ACTION_REPOST);
        b.setDeleteIntent(PendingIntent.getBroadcast(ctx, 4, repost, flags));
        try {
            nm.notify(ID, b.build());
        } catch (SecurityException e) {
            // Notification permission revoked between the check and the call.
        }
    }
}
