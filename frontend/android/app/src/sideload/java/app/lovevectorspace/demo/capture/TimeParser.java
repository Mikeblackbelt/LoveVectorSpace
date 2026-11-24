package app.lovevectorspace.demo.capture;

import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Date/time separators and bubble times as chat apps print them. Java port of
 * src/features/capture/separators.ts (kept deliberately smaller). Pure Java; "today" is passed in.
 */
public final class TimeParser {

    private TimeParser() {}

    public static final class Ymd {
        public final int y, m, d;

        public Ymd(int y, int m, int d) {
            this.y = y;
            this.m = m;
            this.d = d;
        }

        @Override
        public boolean equals(Object o) {
            if (!(o instanceof Ymd)) return false;
            Ymd x = (Ymd) o;
            return x.y == y && x.m == m && x.d == d;
        }

        @Override
        public int hashCode() {
            return (y * 13 + m) * 32 + d;
        }

        @Override
        public String toString() {
            return String.format(Locale.ROOT, "%04d-%02d-%02d", y, m, d);
        }

        public Ymd plusDays(int n) {
            GregorianCalendar c = new GregorianCalendar(y, m - 1, d);
            c.add(Calendar.DAY_OF_MONTH, n);
            return new Ymd(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
        }

        /** 0 = Sunday ... 6 = Saturday. */
        public int dayOfWeek() {
            return new GregorianCalendar(y, m - 1, d).get(Calendar.DAY_OF_WEEK) - 1;
        }

        int cmp(Ymd o) {
            return y != o.y ? y - o.y : m != o.m ? m - o.m : d - o.d;
        }
    }

    /** Hour/minute, or a separator with optional date and time. */
    public static final class Parsed {
        public final Ymd date; // may be null
        public final int hour; // -1 if none
        public final int minute;

        Parsed(Ymd date, int hour, int minute) {
            this.date = date;
            this.hour = hour;
            this.minute = minute;
        }

        public boolean hasTime() {
            return hour >= 0;
        }
    }

    private static final String TIME = "(\\d{1,2})[:.](\\d{2})(?:\\s*([ap])\\.?\\s*m\\.?)?";
    private static final Pattern TIME_ONLY = Pattern.compile("^" + TIME + "$", Pattern.CASE_INSENSITIVE);
    private static final Pattern TRAILING = Pattern.compile("^(.*?\\S)\\s+" + TIME + "(?:\\s*(?:[✓✔]{1,2}|edited))?\\s*$", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern WITH_TIME = Pattern.compile("^(.*?)(?:,?\\s+at)?,?\\s+" + TIME + "$", Pattern.CASE_INSENSITIVE);
    private static final Pattern ISO = Pattern.compile("^(\\d{4})-(\\d{1,2})-(\\d{1,2})$");
    private static final Pattern NUMERIC = Pattern.compile("^(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?$");
    private static final Pattern MONTH_DAY = Pattern.compile("^([a-z]+) (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?$");
    private static final Pattern DAY_MONTH = Pattern.compile("^(\\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\\d{4}))?$");
    private static final Map<String, Integer> MONTHS = new HashMap<>();
    private static final Map<String, Integer> DAYS = new HashMap<>();

    static {
        String[][] ms = {
            { "jan", "january" }, { "feb", "february" }, { "mar", "march" }, { "apr", "april" }, { "may" }, { "jun", "june" },
            { "jul", "july" }, { "aug", "august" }, { "sep", "sept", "september" }, { "oct", "october" }, { "nov", "november" },
            { "dec", "december" },
        };
        for (int i = 0; i < ms.length; i++) for (String s : ms[i]) MONTHS.put(s, i + 1);
        String[][] ds = {
            { "sun", "sunday" }, { "mon", "monday" }, { "tue", "tues", "tuesday" }, { "wed", "wednesday" },
            { "thu", "thur", "thurs", "thursday" }, { "fri", "friday" }, { "sat", "saturday" },
        };
        for (int i = 0; i < ds.length; i++) for (String s : ds[i]) DAYS.put(s, i);
    }

    private static int[] hm(String hs, String ms, String ap) {
        int h = Integer.parseInt(hs), m = Integer.parseInt(ms);
        if (m > 59) return null;
        if (ap != null) {
            if (h < 1 || h > 12) return null;
            boolean pm = ap.equalsIgnoreCase("p");
            if (h == 12) h = pm ? 12 : 0;
            else if (pm) h += 12;
        } else if (h > 23) return null;
        return new int[] { h, m };
    }

    /** {hour, minute} if the whole string is a time, else null. */
    public static int[] parseTime(String s) {
        if (s == null) return null;
        Matcher m = TIME_ONLY.matcher(s.trim());
        return m.matches() ? hm(m.group(1), m.group(2), m.group(3)) : null;
    }

    /** Splits "see you 10:42 PM" into text + time. Returns null if there is no trailing time. */
    public static Object[] splitTrailingTime(String s) {
        Matcher m = TRAILING.matcher(s);
        if (!m.matches()) return null;
        int[] t = hm(m.group(2), m.group(3), m.group(4));
        return t == null ? null : new Object[] { m.group(1), t };
    }

    private static Ymd valid(int y, int m, int d) {
        if (m < 1 || m > 12 || d < 1 || d > 31) return null;
        GregorianCalendar c = new GregorianCalendar(y, m - 1, d);
        c.setLenient(false);
        try {
            c.getTime();
        } catch (IllegalArgumentException e) {
            return null;
        }
        return new Ymd(y, m, d);
    }

    private static Ymd inferYear(int m, int d, Ymd today) {
        Ymd c = valid(today.y, m, d);
        if (c != null && c.cmp(today) <= 0) return c;
        return valid(today.y - 1, m, d);
    }

    static Ymd parseDate(String raw, Ymd today) {
        String t = raw.toLowerCase(Locale.ROOT).replaceAll("[,.]", " ").replaceAll("\\s+", " ").trim();
        if (t.isEmpty()) return null;
        if (t.equals("today")) return today;
        if (t.equals("yesterday")) return today.plusDays(-1);
        Integer wd = DAYS.get(t);
        if (wd != null) {
            int back = (today.dayOfWeek() - wd + 7) % 7;
            return today.plusDays(-(back == 0 ? 7 : back));
        }
        Matcher m;
        if ((m = ISO.matcher(t)).matches()) {
            return valid(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
        }
        if ((m = NUMERIC.matcher(t)).matches()) {
            int a = Integer.parseInt(m.group(1)), b = Integer.parseInt(m.group(2));
            if (a > 12) {
                int x = a;
                a = b;
                b = x;
            }
            if (m.group(3) == null) return inferYear(a, b, today);
            int y = Integer.parseInt(m.group(3));
            return valid(y < 100 ? 2000 + y : y, a, b);
        }
        String[] w = t.split(" ");
        int i = (w.length > 1 && DAYS.containsKey(w[0])) ? 1 : 0;
        StringBuilder rb = new StringBuilder();
        for (int k = i; k < w.length; k++) rb.append(k > i ? " " : "").append(w[k]);
        String rest = rb.toString();
        if ((m = MONTH_DAY.matcher(rest)).matches() && MONTHS.containsKey(m.group(1))) {
            int mo = MONTHS.get(m.group(1)), d = Integer.parseInt(m.group(2));
            return m.group(3) != null ? valid(Integer.parseInt(m.group(3)), mo, d) : inferYear(mo, d, today);
        }
        if ((m = DAY_MONTH.matcher(rest)).matches() && MONTHS.containsKey(m.group(2))) {
            int mo = MONTHS.get(m.group(2)), d = Integer.parseInt(m.group(1));
            return m.group(3) != null ? valid(Integer.parseInt(m.group(3)), mo, d) : inferYear(mo, d, today);
        }
        return null;
    }

    /** A separator line: a date, a time, or "date [at] time". Anything else returns null. */
    public static Parsed parseSeparator(String text, Ymd today) {
        if (text == null) return null;
        String s = text.replaceAll("[•·|]", " ").replaceAll("\\s+", " ").trim();
        if (s.isEmpty() || s.length() > 40) return null;
        int[] t = parseTime(s);
        if (t != null) return new Parsed(null, t[0], t[1]);
        Matcher m = WITH_TIME.matcher(s);
        if (m.matches()) {
            int[] tt = hm(m.group(2), m.group(3), m.group(4));
            Ymd d = parseDate(m.group(1), today);
            if (tt != null && d != null) return new Parsed(d, tt[0], tt[1]);
        }
        Ymd d = parseDate(s, today);
        return d == null ? null : new Parsed(d, -1, -1);
    }
}
