package app.lovevectorspace.demo.capture;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Gives parsed bubbles a naive local timestamp (ts_local) and precision. Mirrors
 * src/features/capture/timestamps.ts: date from the last separator (else today), time from the
 * bubble or separator; bubbles without one get strictly increasing seconds next to their
 * neighbours so order survives. Precision is "minute" only when both date and time were read
 * off the screen; everything else is "approx". Pure Java.
 */
public final class TimeAssigner {

    private TimeAssigner() {}

    public static final class Msg {
        public final String role, text, tsLocal, precision, dedupeKey;

        Msg(String role, String text, String tsLocal, String precision, String dedupeKey) {
            this.role = role;
            this.text = text;
            this.tsLocal = tsLocal;
            this.precision = precision;
            this.dedupeKey = dedupeKey;
        }
    }

    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");

    static long naive(TimeParser.Ymd d, int h, int m) {
        GregorianCalendar c = new GregorianCalendar(UTC);
        c.clear();
        c.set(d.y, d.m - 1, d.d, h, m, 0);
        return c.getTimeInMillis();
    }

    static String fmt(long ms) {
        GregorianCalendar c = new GregorianCalendar(UTC);
        c.setTimeInMillis(ms);
        return String.format(Locale.ROOT, "%04d-%02d-%02dT%02d:%02d:%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1,
            c.get(Calendar.DAY_OF_MONTH), c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), c.get(Calendar.SECOND));
    }

    private static final class Slot {
        BubbleParser.Item it;
        TimeParser.Ymd date;
        boolean dateKnown;
        Long anchor;
    }

    public static List<Msg> assign(List<BubbleParser.Item> items, TimeParser.Ymd today, int nowHour, int nowMinute) {
        TimeParser.Ymd date = today;
        boolean dateKnown = false;
        int sepH = -1, sepM = -1;
        int lastAnchorMin = -1;
        List<Slot> slots = new ArrayList<>();
        for (BubbleParser.Item it : items) {
            if (it.separator) {
                if (it.date != null) {
                    date = it.date;
                    dateKnown = true;
                    lastAnchorMin = -1;
                }
                sepH = it.hour;
                sepM = it.minute;
                continue;
            }
            int h = it.hour >= 0 ? it.hour : sepH;
            int m = it.hour >= 0 ? it.minute : sepM;
            sepH = -1;
            sepM = -1;
            if (h >= 0 && lastAnchorMin >= 0 && h * 60 + m < lastAnchorMin - 6 * 60) date = date.plusDays(1); // past midnight
            if (h >= 0) lastAnchorMin = h * 60 + m;
            Slot s = new Slot();
            s.it = it;
            s.date = date;
            s.dateKnown = dateKnown;
            s.anchor = h >= 0 ? naive(date, h, m) : null;
            slots.add(s);
        }

        List<Msg> out = new ArrayList<>();
        long prev = Long.MIN_VALUE;
        long now = naive(today, nowHour, nowMinute);
        for (int i = 0; i < slots.size(); i++) {
            Slot s = slots.get(i);
            long ms;
            if (s.anchor != null) {
                ms = s.anchor;
            } else if (prev != Long.MIN_VALUE && slots.get(i - 1).date.equals(s.date)) {
                ms = prev + 1000;
            } else {
                int j = i + 1;
                while (j < slots.size() && slots.get(j).anchor == null && slots.get(j).date.equals(s.date)) j++;
                if (j < slots.size() && slots.get(j).anchor != null && slots.get(j).date.equals(s.date)) {
                    ms = slots.get(j).anchor - (j - i) * 1000L;
                } else if (s.date.equals(today)) {
                    ms = now - (j - i) * 1000L; // newest unlabelled messages on today's screen: just now
                } else {
                    ms = naive(s.date, 12, 0);
                }
            }
            if (prev != Long.MIN_VALUE && ms <= prev) ms = prev + 1000;
            prev = ms;
            boolean exact = s.anchor != null && s.dateKnown;
            String hm = s.it.hour >= 0 ? String.format(Locale.ROOT, "%02d:%02d", s.it.hour, s.it.minute) : "?";
            String key = s.it.role + "|" + ContactGate.normName(s.it.text) + "|" + s.date + "|" + hm;
            out.add(new Msg(s.it.role, s.it.text, fmt(ms), exact ? "minute" : "approx", key));
        }
        return out;
    }
}
