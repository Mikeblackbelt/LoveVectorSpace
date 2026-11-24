package app.lovevectorspace.demo.capture;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.TimeZone;

/**
 * Accessibility chat reader (sideload only, off by default, behind a consent screen).
 *
 * Guardrails:
 * - packageNames allowlist in res/xml/lvs_accessibility_config.xml: Android never delivers
 *   events from other apps; we re-check the package anyway.
 * - Captures only while the foreground chat's header shows a contact linked to a person, and
 *   only on chat screens (a message input box is present).
 * - Password nodes and editable fields are skipped without reading their text.
 * - Bubbles, sides and separators are parsed here (BubbleParser); only those messages are
 *   queued (encrypted) for upload. Nothing is logged.
 * - Auto-pauses after 30 minutes without a linked chat; one-tap pause in the notification.
 */
public class LvsAccessibilityService extends AccessibilityService {

    private static final long DEBOUNCE_MS = 800;
    private static final long IDLE_CHECK_MS = 60_000;
    private static final int MAX_NODES = 1500;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable process = this::processWindow;
    private final Runnable idleCheck = new Runnable() {
        @Override
        public void run() {
            if (CaptureStore.get(LvsAccessibilityService.this).checkIdle(System.currentTimeMillis())) {
                CaptureIndicator.update(LvsAccessibilityService.this);
            }
            handler.postDelayed(this, IDLE_CHECK_MS);
        }
    };

    @Override
    protected void onServiceConnected() {
        CaptureIndicator.update(this);
        handler.postDelayed(idleCheck, IDLE_CHECK_MS);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getPackageName() == null) return;
        if (!CaptureApps.allowed(CaptureApps.A11Y, event.getPackageName().toString())) return;
        CaptureStore st = CaptureStore.get(this);
        if (!st.isActive(CaptureApps.A11Y)) return;
        // Coalesce bursts of content-changed/scroll events into one read of the window.
        handler.removeCallbacks(process);
        handler.postDelayed(process, DEBOUNCE_MS);
    }

    @Override
    public void onInterrupt() {
        handler.removeCallbacks(process);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private void processWindow() {
        CaptureStore st = CaptureStore.get(this);
        long now = System.currentTimeMillis();
        if (st.checkIdle(now)) {
            CaptureIndicator.update(this);
            return;
        }
        if (!st.isActive(CaptureApps.A11Y)) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null) return;
        String pkg = root.getPackageName().toString();
        if (!CaptureApps.allowed(CaptureApps.A11Y, pkg)) return;
        ContactGate gate = st.gate();
        if (!gate.hasLinks(CaptureApps.A11Y)) return;

        // Copy the window into a plain tree (password/editable text is never read), then let the
        // pure ChatScreen decide whether this is a linked one-to-one chat.
        ChatScreen.UiNode tree = copyTree(root, new int[] { 0 });
        ChatScreen.Result res = ChatScreen.analyze(tree, pkg, gate);
        if (res.link == null) return; // not a linked 1:1 chat, or unsure: nothing kept
        ContactGate.Link link = res.link;
        st.markLinkedSeen(now);

        Calendar c = Calendar.getInstance();
        TimeParser.Ymd today = new TimeParser.Ymd(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
        int width = Math.max(1, tree.right - tree.left);
        List<BubbleParser.Item> items = BubbleParser.parse(res.bubbles, width, res.listTop, res.footerTop, today);
        List<TimeAssigner.Msg> msgs = TimeAssigner.assign(items, today, c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
        if (msgs.isEmpty()) return;

        String slug = CaptureApps.slugFor(pkg);
        String tz = TimeZone.getDefault().getID();
        List<CaptureQueue.Item> out = new ArrayList<>();
        List<String> keys = new ArrayList<>();
        for (TimeAssigner.Msg m : msgs) {
            CaptureQueue.Item it = CaptureStore.newItem(link, CaptureApps.source(CaptureApps.A11Y, slug), tz, m.role, m.text);
            it.tsLocal = m.tsLocal;
            it.precision = m.precision;
            out.add(it);
            keys.add(m.dedupeKey);
        }
        if (st.addAll(out, keys) > 0) CaptureIndicator.update(this);
    }

    /** Plain copy of the node tree, depth-first, capped at MAX_NODES. Never reads password/editable text. */
    private ChatScreen.UiNode copyTree(AccessibilityNodeInfo n, int[] count) {
        ChatScreen.UiNode u = new ChatScreen.UiNode();
        count[0]++;
        Rect r = new Rect();
        n.getBoundsInScreen(r);
        u.left = r.left;
        u.top = r.top;
        u.right = r.right;
        u.bottom = r.bottom;
        u.password = n.isPassword();
        u.editable = n.isEditable();
        u.scrollable = n.isScrollable();
        u.visible = n.isVisibleToUser();
        u.viewId = n.getViewIdResourceName();
        u.className = n.getClassName() == null ? null : n.getClassName().toString();
        if (u.password) return u; // neither its text nor its children are read
        if (!u.editable) {
            CharSequence cs = n.getText();
            u.text = cs == null ? null : cs.toString();
        } else {
            return u; // the input box: position only
        }
        for (int i = 0; i < n.getChildCount() && count[0] < MAX_NODES; i++) {
            AccessibilityNodeInfo child = n.getChild(i);
            if (child != null) u.add(copyTree(child, count));
        }
        return u;
    }
}
