import type { SafetyBlock as SafetyBlockT, SafetyFlag } from '../api/types';
import { ymd } from '../lib/format';
import { L } from '../theme/Plain';

const SEV_RANK = { info: 1, concern: 2, urgent: 3 } as const;
const WHO: Record<SafetyFlag['speaker'], [string, string]> = {
  them: ['THEM', 'Their messages'],
  me: ['ME', 'Your messages'],
  owner_report: ['YOUR REPORT', 'What you told us'],
};

function humanize(cat: string): string {
  return cat.replace(/_/g, ' ');
}

/**
 * Warnings only (v2 §7b): flags, severity, evidence and suggested resources.
 * Resources are plain text — never tel:/sms: links or call buttons.
 */
/** Fixed local disclaimer: shown even if the server omits it, and with zero flags (compact). */
export const LOCAL_DISCLAIMER =
  'This tool offers reflection and pattern warnings. It is not therapy, counselling, or a crisis service.';

export function SafetyBlockView({ block }: { block: SafetyBlockT }) {
  const disclaimer = block.disclaimer?.trim() || LOCAL_DISCLAIMER;
  if (!block.flags.length) {
    return (
      <p className="safety-compact" data-testid="safety-compact">
        <span className="glyph">// </span>
        {disclaimer}
      </p>
    );
  }
  const sev = block.flags.reduce<SafetyFlag['severity']>((s, f) => (SEV_RANK[f.severity] > SEV_RANK[s] ? f.severity : s), 'info');
  const label = sev.toUpperCase();
  return (
    <section className={`safety sev-${sev}`} aria-labelledby="t-safety" role="region" data-testid="safety-block">
      <h2 id="t-safety" className="safety-h">
        <span className="glyph">[ </span>
        <L t={label} p={sev === 'urgent' ? 'Important: please read' : sev === 'concern' ? 'Something worth a closer look' : 'For your information'} />
        <span className="glyph"> ]</span>
        <span className="safety-sub">
          <L t=" PATTERN WARNING" p="" />
        </span>
      </h2>
      <p className="safety-lede">
        <L
          t="The app flagged some messages that match patterns worth noticing. It can be wrong; you know the context."
          p="Some messages matched patterns that can be worth a second look. The app can be wrong, and you know the full story."
        />
      </p>
      <ul className="safety-flags">
        {block.flags.map((f, i) => (
          <li key={i}>
            <b>{humanize(f.category)}</b>
            <span className="dimt">
              {' '}· <L t={WHO[f.speaker][0]} p={WHO[f.speaker][1]} /> · {f.count}× · {ymd(f.first_seen)} → {ymd(f.last_seen)}
            </span>
            {f.snippets.length > 0 && (
              <ul className="snips">
                {f.snippets.map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {block.resources.length > 0 && (
        <div className="safety-res">
          <h3 className="lbl">
            <L t="RESOURCES · SUGGESTIONS ONLY · THE APP NEVER CONTACTS ANYONE" p="If you want to talk to someone (suggestions only)" />
          </h3>
          <ul data-testid="safety-resources">
            {block.resources.map((r, i) => (
              <li key={i}>
                <b>{r.name}</b>
                {r.description && <span> — {r.description}</span>}
                {r.phone && (
                  <span className="res-line">
                    <L t="PHONE " p="Phone: " />
                    <span className="nolink">{r.phone}</span>
                  </span>
                )}
                {r.text && (
                  <span className="res-line">
                    <L t="TEXT " p="Text: " />
                    <span className="nolink">{r.text}</span>
                  </span>
                )}
                {r.url && (
                  <span className="res-line">
                    <L t="WEB " p="Website: " />
                    <span className="nolink">{r.url}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="safety-tip">
            <L
              t="Talking it through with someone you trust, or a professional, can help."
              p="Talking it through with someone you trust, or a professional, can help."
            />
          </p>
        </div>
      )}
      <p className="safety-disc">
        <span className="glyph">// </span>
        {disclaimer}
      </p>
    </section>
  );
}
