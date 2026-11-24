import { useEffect, useMemo, useRef, useState } from 'react';
import type { Metric, SuccessEstimate } from '../api/types';
import { L, Tag, evidenceCode, TAG_PLAIN } from '../theme/Plain';
import { useTheme } from '../theme/ThemeProvider';

// Geometry from dashboard.html: hub r=170, scale rings 198–282, bezel r=306.
const HUB = 170;
const BEZ = 306;
const K = 0.7; // px per point of share (100% → 70px)
const SPREAD = 20; // ME rotated −20°, THEM +20° off the spoke
const rad = (d: number) => (d * Math.PI) / 180;
const pt = (r: number, a: number) => [r * Math.sin(rad(a)), -r * Math.cos(rad(a))] as const;
const r1 = (n: number) => Math.round(n * 10) / 10;

const NAMES: Record<string, [string, string]> = {
  initiation_share: ['INITIATION', 'INIT'],
  message_share: ['MESSAGES', 'MSGS'],
  question_rate: ['QUESTIONS', 'QUES'],
  disclosure_rate: ['DISCLOSURE', 'DISC'],
  lsm: ['STYLE·LSM', 'LSM'],
  meetup_initiation_share: ['MEETUP INIT', 'MEET'],
  plan_follow_through_rate: ['FOLLOW-THRU', 'PLAN'],
};

export interface Spoke {
  id: string;
  name: string;
  short: string;
  plain: string;
  ang: number;
  me: number | null;
  them: number | null;
  same: boolean; // single shared value (LSM)
  tag: ReturnType<typeof evidenceCode>;
}

/** Display values on a 0–100 scale for one reciprocity metric. */
export function spokeValues(m: Metric): { me: number | null; them: number | null; same: boolean } {
  if (m.status !== 'ok') return { me: null, them: null, same: false };
  if (m.per_speaker) {
    const { me, them } = m.per_speaker;
    if (me <= 1.0001 && them <= 1.0001 && me >= 0 && them >= 0) return { me: me * 100, them: them * 100, same: false };
    const s = me + them || 1;
    return { me: (me / s) * 100, them: (them / s) * 100, same: false };
  }
  if (m.value == null) return { me: null, them: null, same: false };
  const v = m.value <= 1 ? m.value * 100 : m.value;
  return { me: v, them: v, same: true };
}

export function buildSpokes(ms: Metric[]): Spoke[] {
  const n = Math.max(ms.length, 1);
  return ms.map((m, i) => {
    const v = spokeValues(m);
    const nm = NAMES[m.id] || [m.label.toUpperCase().replace(/_/g, ' ').slice(0, 12), m.label.slice(0, 4).toUpperCase()];
    return { id: m.id, name: nm[0], short: nm[1], plain: m.plain_label, ang: r1((i * 360) / n), ...v, tag: evidenceCode(m.evidence) };
  });
}

/** Break a plain-language label into lines of about n characters (journal labels are long). */
function wrap(t: string, n: number): string[] {
  const out: string[] = [];
  for (const w of t.split(' ')) {
    const last = out[out.length - 1];
    if (last && (last + ' ' + w).length <= n) out[out.length - 1] = last + ' ' + w;
    else out.push(w);
  }
  return out;
}

function fmt(v: number | null, same: boolean) {
  if (v == null) return '--';
  return same ? (v / 100).toFixed(2) : String(Math.round(v));
}

function Arrow({ base, ang, len, cls, w }: { base: readonly [number, number]; ang: number; len: number; cls: string; w: number }) {
  const ux = Math.sin(rad(ang)), uy = -Math.cos(rad(ang));
  const tip = [base[0] + ux * len, base[1] + uy * len];
  const back = Math.min(7, len * 0.6);
  const end = [tip[0] - ux * back * 0.85, tip[1] - uy * back * 0.85];
  const hb = [tip[0] - ux * 9, tip[1] - uy * 9];
  const px = -uy, py = ux;
  const head = `${r1(tip[0])},${r1(tip[1])} ${r1(hb[0] + px * 3.6)},${r1(hb[1] + py * 3.6)} ${r1(hb[0] - px * 3.6)},${r1(hb[1] - py * 3.6)}`;
  return (
    <>
      <line className={cls} x1={r1(base[0])} y1={r1(base[1])} x2={r1(end[0])} y2={r1(end[1])} strokeWidth={w} />
      <polygon className={`${cls}-h`} points={head} />
    </>
  );
}

function SlotNumber({ value, animate }: { value: string; animate: boolean }) {
  const [go, setGo] = useState(false);
  const [settled, setSettled] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    const a = requestAnimationFrame(() => requestAnimationFrame(() => setGo(true)));
    const t = window.setTimeout(() => setSettled(true), 2600);
    return () => {
      cancelAnimationFrame(a);
      window.clearTimeout(t);
    };
  }, [animate, value]);
  if (settled || !/^\d+$/.test(value)) return <span className="hl-num">{value}</span>;
  return (
    <span className="hl-num" aria-hidden="true">
      {value.split('').map((ch, i) => (
        <span className="slot" key={i}>
          <span
            className="strip"
            style={{ transitionDuration: `${1.4 + i * 0.45}s`, transform: go ? `translateY(${-(10 * (i + 1) + Number(ch))}em)` : 'translateY(0)' }}
          >
            {Array.from({ length: 30 }, (_, n) => (
              <span key={n}>{n % 10}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

export function Radar({ metrics, success, subject }: { metrics: Metric[]; success: SuccessEstimate; subject: string }) {
  const { motion, journal } = useTheme();
  const sweepOn = motion === 'full';
  const spokes = useMemo(() => buildSpokes(metrics), [metrics]);
  const sweepRef = useRef<SVGGElement>(null);
  const brgRef = useRef<HTMLElement>(null);
  const spokeRefs = useRef<(SVGGElement | null)[]>([]);
  const [focus, setFocus] = useState(0);
  const ok = success.status === 'ok' && success.percent != null;
  const pctN = ok ? Math.round(success.percent!) : null;
  const lo = success.low ?? null;
  const hi = success.high ?? null;

  useEffect(() => {
    if (!sweepOn || !spokes.length) return;
    const PERIOD = 7000;
    const t0 = performance.now();
    const last: (number | null)[] = spokes.map(() => null);
    let raf = 0;
    let lastB = '';
    const tick = (now: number) => {
      const a = (((now - t0) / PERIOD) * 360) % 360;
      sweepRef.current?.setAttribute('transform', `rotate(${a.toFixed(2)})`);
      spokes.forEach((s, i) => {
        const d = (a - s.ang + 360) % 360;
        const g = spokeRefs.current[i];
        if (g) g.style.opacity = (0.42 + 0.58 * Math.exp(-d / 80)).toFixed(3);
        if (last[i] !== null && d < (last[i] as number)) setFocus(i);
        last[i] = d;
      });
      const b = String(Math.floor(a)).padStart(3, '0');
      if (brgRef.current && b !== lastB) {
        brgRef.current.textContent = b;
        lastB = b;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sweepOn, spokes]);

  const tips = spokes.map((s) => {
    const base = pt(HUB, s.ang);
    if (s.me == null || s.them == null) return { base, me: null, th: null, res: base };
    const me = [Math.sin(rad(s.ang - SPREAD)) * s.me * K, -Math.cos(rad(s.ang - SPREAD)) * s.me * K];
    const th = [Math.sin(rad(s.ang + SPREAD)) * s.them * K, -Math.cos(rad(s.ang + SPREAD)) * s.them * K];
    return { base, me, th, res: [base[0] + me[0] + th[0], base[1] + me[1] + th[1]] as const };
  });

  const arc = ok && lo != null && hi != null ? (() => {
    const a = lo * 3.6, b = hi * 3.6;
    const p1 = pt(BEZ, a), p2 = pt(BEZ, b);
    return { d: `M${r1(p1[0])},${r1(p1[1])}A${BEZ},${BEZ} 0 ${b - a > 180 ? 1 : 0} 1 ${r1(p2[0])},${r1(p2[1])}`, a, b };
  })() : null;

  const desc = `${spokes.length} reciprocity spokes. ` +
    spokes.map((s) => `${s.plain || s.name}: ${s.me == null ? 'not enough data' : s.same ? fmt(s.me, true) : `me ${fmt(s.me, false)}, them ${fmt(s.them, false)}`}`).join('; ') +
    (ok ? `. The outer rim shows the uncalibrated chance of ${pctN} percent, range ${lo} to ${hi}.` : '. Not enough data for a headline estimate yet.');

  const cur = spokes[focus];
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = i * 5;
    const [x1, y1] = pt(282, a);
    const [x2, y2] = pt(i % 3 === 0 ? 275 : 279, a);
    return `M${r1(x1)},${r1(y1)}L${r1(x2)},${r1(y2)}`;
  }).join('');
  const bez = Array.from({ length: 100 }, (_, i) => {
    const a = i * 3.6;
    const [x1, y1] = pt(BEZ, a);
    const [x2, y2] = pt(i % 10 === 0 ? 318 : i % 5 === 0 ? 314 : 310, a);
    return `M${r1(x1)},${r1(y1)}L${r1(x2)},${r1(y2)}`;
  }).join('');
  const axes = spokes.map((s) => {
    const [x1, y1] = pt(HUB, s.ang);
    const [x2, y2] = pt(292, s.ang);
    return `M${r1(x1)},${r1(y1)}L${r1(x2)},${r1(y2)}`;
  }).join('');
  const trail = Array.from({ length: 40 }, (_, i) => {
    const a = -40 + i;
    const [x1, y1] = pt(172, a);
    const [x2, y2] = pt(302, a);
    return { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), o: ((i / 40) ** 2 * 0.48).toFixed(3) };
  });

  return (
    <>
      <div className="rd-wrap">
        <svg className="radar-svg" viewBox="-425 -385 850 770" role="img" aria-labelledby="radar-title radar-desc">
          <title id="radar-title">Reciprocity radar</title>
          <desc id="radar-desc">{desc}</desc>
          <defs>
            <filter id="glow" filterUnits="userSpaceOnUse" x="-425" y="-385" width="850" height="770">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <pattern id="ht-link" patternUnits="userSpaceOnUse" width="6" height="6">
              <circle className="ht-dot" cx="3" cy="3" r="1.3" />
            </pattern>
          </defs>
          <circle className="r-hub" r={HUB} />
          <circle className="r-ring r-inner" r="158" />
          {[198, 226, 254, 282].map((r) => (
            <circle key={r} className="r-ring" r={r} />
          ))}
          <path className="r-tick" d={ticks} />
          <path className="r-axis" d={axes} />
          <circle className="r-bez" r={BEZ} />
          <path className="r-beztick" d={bez} />
          {arc && (
            <>
              <path className="r-range glw" d={arc.d} />
              {[arc.a, arc.b].map((a, i) => {
                const [x1, y1] = pt(BEZ - 10, a);
                const [x2, y2] = pt(BEZ + 13, a);
                const [lx, ly] = pt(334, a);
                return (
                  <g key={i}>
                    <line className="r-rangecap" x1={r1(x1)} y1={r1(y1)} x2={r1(x2)} y2={r1(y2)} />
                    <text className="rl" x={r1(lx)} y={r1(ly)} textAnchor={lx < -10 ? 'end' : lx > 10 ? 'start' : 'middle'}>
                      {i === 0 ? lo : hi}
                    </text>
                  </g>
                );
              })}
            </>
          )}
          {sweepOn && !journal && (
            <g ref={sweepRef} className="sweep">
              {trail.map((t, i) => (
                <line key={i} className="sw-trail" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} opacity={t.o} />
              ))}
              <line className="sw-head glw" x1="0" y1="-172" x2="0" y2="-304" />
              <polygon className="sw-pip" points="0,-305 -4,-314 4,-314" />
            </g>
          )}
          {tips.some((t) => t.me) && (
            <polygon className="poly" points={tips.map((t) => `${r1(t.res[0])},${r1(t.res[1])}`).join(' ')} />
          )}
          <g id="spokes">
            {spokes.map((s, i) => {
              const t = tips[i];
              return (
                <g key={s.id} className="spk" ref={(el) => { spokeRefs.current[i] = el; }} data-name={s.name}>
                  {t.me && t.th && (
                    <>
                      <line className="v-par-me" x1={r1(t.base[0] + t.th[0])} y1={r1(t.base[1] + t.th[1])} x2={r1(t.res[0])} y2={r1(t.res[1])} />
                      <line className="v-par-th" x1={r1(t.base[0] + t.me[0])} y1={r1(t.base[1] + t.me[1])} x2={r1(t.res[0])} y2={r1(t.res[1])} />
                      <g className="glw">
                        <Arrow base={t.base} ang={s.ang - SPREAD} len={s.me! * K} cls="v-me" w={2.2} />
                        <Arrow base={t.base} ang={s.ang + SPREAD} len={s.them! * K} cls="v-th" w={2.2} />
                        <Arrow
                          base={t.base}
                          ang={(Math.atan2(t.res[0] - t.base[0], -(t.res[1] - t.base[1])) * 180) / Math.PI}
                          len={Math.hypot(t.res[0] - t.base[0], t.res[1] - t.base[1])}
                          cls="v-res"
                          w={2.8}
                        />
                      </g>
                    </>
                  )}
                  <rect className="v-node" x={r1(t.base[0] - 2.5)} y={r1(t.base[1] - 2.5)} width="5" height="5" />
                </g>
              );
            })}
          </g>
          <use href="#spokes" className="mis-copy" transform="translate(2.5,2.5)" />
          {spokes.map((s) => {
            const [x, y] = pt(s.ang === 0 ? 352 : 345, s.ang);
            const anchor = x > 20 ? 'start' : x < -20 ? 'end' : 'middle';
            const [sx, sy] = pt(330, s.ang);
            const lines = journal ? wrap(s.plain || s.name, 13) : [s.name];
            return (
              <g key={s.id}>
                <text className="sl" x={r1(x)} y={r1(y - (s.ang === 0 ? 4 : 0) - (lines.length - 1) * 16)} textAnchor={anchor}>
                  {lines.map((ln, k) => (
                    <tspan key={k} x={r1(x)} dy={k ? 16 : 0}>{ln}</tspan>
                  ))}
                </text>
                <text className="sv" x={r1(x)} y={r1(y + 14 - (s.ang === 0 ? 4 : 0))} textAnchor={anchor}>
                  {s.same ? (
                    <>
                      <tspan className="sv-d sv-sep">≡ </tspan>
                      <tspan className="sv-me">{fmt(s.me, true)}</tspan>
                    </>
                  ) : (
                    <>
                      <tspan className="sv-me">{fmt(s.me, false)}</tspan>
                      <tspan className="sv-d sv-sep"> · </tspan>
                      <tspan className="sv-th">{fmt(s.them, false)}</tspan>
                    </>
                  )}
                  <tspan className="sv-d sv-tag"> [{s.tag}]</tspan>
                </text>
                <text className="sl-s" x={r1(sx)} y={r1(sy + 8)} textAnchor={sx > 20 ? 'start' : sx < -20 ? 'end' : 'middle'}>
                  {journal ? s.plain.split(' ').slice(-1)[0] : s.short}
                </text>
              </g>
            );
          })}
          {ok && (
            <>
              <g className="mk" transform={`rotate(${r1(pctN! * 3.6)})`}>
                <line className="mk-line glw" x1="0" y1="-292" x2="0" y2="-322" />
                <polygon className="mk-head" points="0,-318 -6,-330 6,-330" />
                <circle className="mk-pulse" cx="0" cy="-306" r="6" />
              </g>
              {(() => {
                const [x, y] = pt(345, pctN! * 3.6);
                return (
                  <text className="mk-lbl" x={r1(x)} y={r1(y)} textAnchor={x < -10 ? 'end' : x > 10 ? 'start' : 'middle'}>
                    {journal ? `Now ${pctN}` : `LIVE ${pctN}`}
                  </text>
                );
              })()}
            </>
          )}
        </svg>
        <div className="hub" data-testid="headline">
          <p className="sr">
            {ok
              ? `Chance of success: ${pctN} percent, uncalibrated, range ${lo} to ${hi}. Probability that ${success.definition}.`
              : 'Chance of success: not enough data yet.'}
          </p>
          <div aria-hidden="true">
            <span className="stamp">
              {ok ? <L t="[ UNCALIBRATED ]" p="rough estimate" /> : <L t="[ INSUFFICIENT DATA ]" p="not enough data yet" />}
            </span>
            <div className="hl">
              <SlotNumber value={ok ? String(pctN) : '--'} animate={ok && motion !== 'off'} />
              <span className="hl-pct">%</span>
            </div>
            <div className="hub-range">
              {ok ? (
                <L t={<>RANGE <b>{lo}</b> ──── <b>{hi}</b></>} p={`likely ${lo} to ${hi}`} />
              ) : (
                <L t={<>RANGE <b>--</b> ──── <b>--</b></>} p="no range yet" />
              )}
            </div>
            <div className="hub-def">
              <L t={`P(${success.definition})`} p={`chance that ${success.definition}`} />
            </div>
          </div>
        </div>
      </div>
      <div className="hub-under" aria-hidden="true">
        <div className="hub-range">
          {ok ? <L t={<>RANGE <b>{lo}</b> ──── <b>{hi}</b> · RIM MARKER = {pctN}</>} p={`Likely between ${lo} and ${hi}`} /> : <L t="RANGE -- · NOT ENOUGH DATA" p="Not enough data yet" />}
        </div>
        <div className="hub-def">
          <L t={`P(${success.definition})`} p={`Chance that ${success.definition}`} />
        </div>
      </div>
      <div className="rd-bot">
        <div className="rd-read glyph" aria-live="off">
          <span>
            SWEEP BRG <b ref={brgRef} className="c-me">000</b>°
          </span>
          <span className="c-me">▸</span>
          {cur && (
            <>
              <span className="rd-name">{cur.name}</span>
              <span>
                {cur.same ? (
                  <>≡ <b className="c-me">{fmt(cur.me, true)}</b></>
                ) : (
                  <>ME <b className="c-me">{fmt(cur.me, false)}</b> · THEM <b className="c-th">{fmt(cur.them, false)}</b></>
                )}{' '}
                <Tag code={cur.tag} />
              </span>
            </>
          )}
        </div>
        <HeadlineTag success={success} subject={subject} />
      </div>
    </>
  );
}

/** The fixed tag + research caveat — always shown with the headline. */
function HeadlineTag({ success, subject }: { success: SuccessEstimate; subject: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hl-tag" data-testid="headline-tag">
      <Tag code="UNCAL" /> <span className="tagtext">{success.tag}</span>{' '}
      <button type="button" className="info-btn" aria-expanded={open} onClick={() => setOpen(!open)} aria-label="About this estimate">
        <L t="[?]" p="What does this mean?" />
      </button>
      {open && (
        <span className="caveat" role="note">
          {' '}
          <L
            t={`// real outcomes are only weakly predictable from chats; LLMs reading real speed dates reached r ≈ 0.12–0.23. Not a verdict on ${subject}.`}
            p={`Real outcomes are only weakly predictable from chats (studies found r ≈ 0.12–0.23), so read this as a lean, not odds. ${TAG_PLAIN.UNCAL}.`}
          />
        </span>
      )}
    </div>
  );
}
