package app.lovevectorspace.demo.capture;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayDeque;
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

        Rect win = new Rect();
        root.getBoundsInScreen(win);
        int height = Math.max(1, win.height());
        int headerLimit = win.top + (int) (height * 0.2);
        int composeLimit = win.top + (int) (height * 0.6);

        // One pass: header candidates, the input box position, and bubble candidates.
        List<BubbleParser.Node> nodes = new ArrayList<>();
        ContactGate.Link link = null;
        int titleTop = -1;
        int titleBottom = -1;
        int footerTop = win.bottom;
        boolean hasCompose = false;
        ArrayDeque<AccessibilityNodeInfo> stack = new ArrayDeque<>();
        stack.push(root);
        int seen = 0;
        Rect r = new Rect();
        while (!stack.isEmpty() && seen++ < MAX_NODES) {
            AccessibilityNodeInfo n = stack.pop();
            if (n == null) continue;
            if (n.isPassword()) continue; // never read, nor its children
            n.getBoundsInScreen(r);
            if (n.isEditable()) {
                // The message box: marks a chat screen and the bottom of the chat area. Text not read.
                if (r.top >= composeLimit) {
                    hasCompose = true;
                    footerTop = Math.min(footerTop, r.top);
                }
                continue;
            }
            for (int i = n.getChildCount() - 1; i >= 0; i--) {
                AccessibilityNodeInfo child = n.getChild(i);
                if (child != null) stack.push(child); // ArrayDeque rejects nulls
            }
            if (!n.isVisibleToUser()) continue;
            CharSequence cs = n.getText();
            if (cs == null || cs.length() == 0) continue;
            String text = cs.toString();
            if (link == null && r.bottom <= headerLimit) {
                ContactGate.Link l = gate.match(CaptureApps.A11Y, pkg, text);
                if (l != null) {
                    link = l;
                    titleTop = r.top;
                    titleBottom = r.bottom;
                    continue;
                }
            }
            nodes.add(new BubbleParser.Node(text, r.left, r.top, r.right, r.bottom, false, false));
        }
        if (link == null || !hasCompose) return; // not a linked chat: nothing kept
        st.markLinkedSeen(now);
        // Subtitle lines right under the title ("online", "typing…") belong to the header.
        int headerBottom = titleBottom;
        for (BubbleParser.Node n : nodes) {
            if (n.top >= titleTop && n.top <= headerBottom + 12 && n.bottom <= headerLimit) headerBottom = Math.max(headerBottom, n.bottom);
        }

        Calendar c = Calendar.getInstance();
        TimeParser.Ymd today = new TimeParser.Ymd(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
        List<BubbleParser.Item> items = BubbleParser.parse(nodes, Math.max(1, win.width()), headerBottom, footerTop, today);
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
}
