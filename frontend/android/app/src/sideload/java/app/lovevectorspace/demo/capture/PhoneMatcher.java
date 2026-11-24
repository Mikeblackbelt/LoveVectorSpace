package app.lovevectorspace.demo.capture;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * SMS address matching on full E.164 numbers. Pure Java: the platform normaliser
 * (PhoneNumberUtils.formatNumberToE164 with the SIM/network country) is injected, so tests can
 * use a fake. Alphanumeric senders ("BANK", "Uber") match only an identical link string.
 */
public final class PhoneMatcher {

    public interface Normalizer {
        /** E.164 ("+447700900123") or null if the number can't be normalised. */
        String toE164(String raw);
    }

    private static final Pattern E164 = Pattern.compile("^\\+[1-9]\\d{6,14}$");
    private static final Pattern HAS_LETTER = Pattern.compile(".*[A-Za-z].*");

    private final Normalizer norm;

    public PhoneMatcher(Normalizer norm) {
        this.norm = norm;
    }

    public static boolean isAlphanumericSender(String s) {
        return s != null && HAS_LETTER.matcher(s).matches();
    }

    public static boolean isE164(String s) {
        return s != null && E164.matcher(s).matches();
    }

    /**
     * Canonical form for a link: E.164 for numbers, the trimmed string for alphanumeric senders,
     * or null if it can't be normalised (the link is rejected).
     */
    public String canonical(String raw) {
        if (raw == null) return null;
        String t = raw.trim();
        if (t.isEmpty()) return null;
        if (isAlphanumericSender(t)) return t.length() <= 11 ? t : null;
        String e = norm.toE164(t);
        return isE164(e) ? e : null;
    }

    /** Does an SMS address belong to this (canonical) link? Full equality only. */
    public boolean matches(String linkCanonical, String address) {
        if (linkCanonical == null || address == null) return false;
        if (isAlphanumericSender(linkCanonical) || isAlphanumericSender(address)) {
            return linkCanonical.trim().toLowerCase(Locale.ROOT).equals(address.trim().toLowerCase(Locale.ROOT))
                && isAlphanumericSender(linkCanonical) && isAlphanumericSender(address);
        }
        String a = norm.toE164(address.trim());
        return isE164(a) && a.equals(linkCanonical);
    }

    /** Last 7 digits, used only as a SQL prefilter before the full match. */
    public static String prefilterTail(String canonical) {
        String d = ContactGate.digits(canonical);
        return d.length() >= 7 ? d.substring(d.length() - 7) : null;
    }

    /**
     * Fallback normaliser when the platform one is unavailable: "+…" and "00…" international
     * forms, plus national numbers with the given country calling code (trunk "0" dropped).
     */
    public static String simpleE164(String raw, String countryCallingCode) {
        if (raw == null) return null;
        String t = raw.trim();
        String d = ContactGate.digits(t);
        if (d.isEmpty()) return null;
        String out;
        if (t.startsWith("+")) out = "+" + d;
        else if (d.startsWith("00")) out = "+" + d.substring(2);
        else if (countryCallingCode == null) return null;
        else if ("1".equals(countryCallingCode) && d.length() == 11 && d.startsWith("1")) out = "+" + d;
        else out = "+" + countryCallingCode + (d.startsWith("0") ? d.substring(1) : d);
        return isE164(out) ? out : null;
    }
}
