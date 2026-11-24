import { useMemo, useRef, useState } from 'react';
import type { WeekPoint } from '../api/types';
import { L } from '../theme/Plain';

const X0 = 44, X1 = 540, Y0 = 16, Y1 = 192;
const BLK = '▁▂▃▄▅▆▇█';

function spark(vals: (number | null)[], max: number) {
  return vals.map((v) => (v == null ? '╱' : BLK[Math.max(0, Math.min(7, Math.round((v / (max || 1)) * 7)))])).join('');
}

/** Oscilloscope trace of messages/week: ME and THEM channels, uncovered weeks hatched. */
export function Scope({ weekly }: { weekly: WeekPoint[] }) {
  const n = weekly.length;
  const svgRef = useRef<SVGSVGElement>(null);
  const [wi, setWi] = useState(Math.max(0, n - 1));
  const g = useMemo(() => {
    const step = n > 1 ? (X1 - X0) / (n - 1) : 0;
    const xs = weekly.map((_, i) => +(X0 + i * step).toFixed(1));
    const max = Math.max(20, ...weekly.flatMap((w) => [w.me ?? 0, w.them ?? 0]));
    const top = Math.ceil(max / 20) * 20;
    const y = (v: number) => +(Y1 - (v / top) * (Y1 - Y0)).toFixed(1);
    const runs = (key: 'me' | 'them') => {
      const out: string[] = [];
      let cur: string[] = [];
      weekly.forEach((w, i) => {
        const v = w[key];
        if (!w.covered || v == null) {
          if (cur.length) out.push(cur.join(' '));
          cur = [];
        } else cur.push(`${xs[i]},${y(v)}`);
      });
      if (cur.length) out.push(cur.join(' '));
      return out;
    };
    const gaps: { a: number; b: number }[] = [];
    weekly.forEach((w, i) => {
      if (w.covered) return;
      const last = gaps[gaps.length - 1];
      if (last && last.b === i - 1) last.b = i;
      else gaps.push({ a: i, b: i });
    });
    const yTicks = [0, top / 3, (2 * top) / 3, top].map((v) => Math.round(v));
    return { step, xs, top, y, me: runs('me'), th: runs('them'), gaps, yTicks };
  }, [weekly, n]);

  if (!n) return <p className="dimt">No weekly data yet.</p>;
  const w = weekly[wi];
  const meVals = weekly.map((x) => (x.covered ? x.me : null));
  const thVals = weekly.map((x) => (x.covered ? x.them : null));
  const sum = (a: (number | null)[]) => a.reduce<number>((s, v) => s + (v ?? 0), 0);
  const title =
    `Messages per week over ${n} weeks. Me: ${meVals.map((v) => (v == null ? 'no coverage' : v)).join(', ')}. ` +
    `Them: ${thVals.map((v) => (v == null ? 'no coverage' : v)).join(', ')}.`;

  const pick = (clientX: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM?.();
    if (!svg || !m) return;
    const p = svg.createSVGPoint();
    p.x = clientX;
    p.y = 0;
    const q = p.matrixTransform(m.inverse());
    let best = 0;
    g.xs.forEach((x, i) => {
      if (Math.abs(x - q.x) < Math.abs(g.xs[best] - q.x)) best = i;
    });
    setWi(best);
  };

  return (
    <>
      <div className="sc-top">
        <span>
          <L t="CURSOR" p="Week" />{' '}
          <span className="sc-read" aria-live="polite">
            W{wi + 1} ·{' '}
            {!w.covered || w.me == null ? (
              <L t="NO COVERAGE" p="no data this week" />
            ) : (
              <>
                <L t="ME" p="You" /> <b className="c-me">{w.me}</b> · <L t="THEM" p="Them" /> <b className="c-th">{w.them ?? '--'}</b>
              </>
            )}
          </span>
        </span>
        <span className="glyph">{Math.round(g.top / 6)} MSG/DIV · ← → TO STEP</span>
      </div>
      <svg
        ref={svgRef}
        className="scope-svg"
        viewBox="0 0 560 250"
        tabIndex={0}
        role="img"
        aria-label={title}
        data-own-keys
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setWi(n - 1)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            setWi((i) => Math.max(0, i - 1));
            e.preventDefault();
          } else if (e.key === 'ArrowRight') {
            setWi((i) => Math.min(n - 1, i + 1));
            e.preventDefault();
          }
        }}
      >
        <defs>
          <filter id="glow2" filterUnits="userSpaceOnUse" x="0" y="0" width="560" height="250">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8">
            <path className="hatch-l" d="M-2,10L10,-2M6,10L10,6M-2,2L2,-2" />
          </pattern>
          <pattern id="ht-dots" patternUnits="userSpaceOnUse" width="6" height="6">
            <circle className="ht-dot2" cx="3" cy="3" r="1.4" />
          </pattern>
        </defs>
        <rect className="sc-frame" x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} />
        <path
          className="sc-grid"
          d={g.xs.map((x) => `M${x},${Y0}L${x},${Y1}`).join('') + g.yTicks.slice(1, 3).map((v) => `M${X0},${g.y(v)}L${X1},${g.y(v)}`).join('')}
        />
        <line className="sc-mid" x1={X0} y1={(Y0 + Y1) / 2} x2={X1} y2={(Y0 + Y1) / 2} />
        {g.yTicks.map((v) => (
          <text key={v} className="sc-lbl" x="38" y={g.y(v) + 3.5} textAnchor="end">
            {v}
          </text>
        ))}
        {g.xs.map((x, i) => (
          <text key={i} className="sc-lbl" x={x} y="207" textAnchor="middle">
            W{i + 1}
          </text>
        ))}
        {g.gaps.map((gp) => {
          const a = Math.max(X0, g.xs[gp.a] - g.step / 2);
          const b = Math.min(X1, g.xs[gp.b] + g.step / 2);
          const cx = (a + b) / 2;
          return (
            <g key={gp.a} data-testid="gap">
              <rect className="sc-gap" x={a} y={Y0} width={b - a} height={Y1 - Y0} />
              {b - a > 70 && (
                <>
                  <rect className="sc-gap-bg" x={cx - 40} y="86" width="80" height="30" />
                  <text className="sc-gap-t" x={cx} y="99" textAnchor="middle">NO COVERAGE</text>
                  <text className="sc-gap-t2" x={cx} y="112" textAnchor="middle">
                    W{gp.a + 1}
                    {gp.b > gp.a ? `–W${gp.b + 1}` : ''} ╱╱╱
                  </text>
                </>
              )}
            </g>
          );
        })}
        <g id="traces">
          <g className="glw2">
            {g.th.map((p, i) => (
              <polyline key={'t' + i} className="tr tr-th" points={p} />
            ))}
            {g.me.map((p, i) => (
              <polyline key={'m' + i} className="tr tr-me" points={p} />
            ))}
          </g>
          {weekly.map((x, i) =>
            x.covered && x.me != null ? <rect key={'pm' + i} className="pt-me" x={g.xs[i] - 2.5} y={g.y(x.me) - 2.5} width="5" height="5" /> : null,
          )}
          {weekly.map((x, i) =>
            x.covered && x.them != null ? <rect key={'pt' + i} className="pt-th" x={g.xs[i] - 2.5} y={g.y(x.them) - 2.5} width="5" height="5" /> : null,
          )}
        </g>
        <use href="#traces" className="mis-copy" transform="translate(2,2)" />
        <line className="sc-cur" x1={g.xs[wi]} y1={Y0} x2={g.xs[wi]} y2={Y1} />
        <g className="bp-only dims">
          <line className="dim" x1={X0} y1="226" x2={X1} y2="226" />
          <line className="dim-ext" x1={X0} y1="212" x2={X0} y2="231" />
          <line className="dim-tick" x1={X0 - 4} y1="230" x2={X0 + 4} y2="222" />
          <line className="dim-ext" x1={X1} y1="212" x2={X1} y2="231" />
          <line className="dim-tick" x1={X1 - 4} y1="230" x2={X1 + 4} y2="222" />
          <rect className="dim-bg" x="258" y="219" width="68" height="14" />
          <text className="dim-t" x="292" y="230" textAnchor="middle">{n} WK</text>
        </g>
      </svg>
      <div className="spark glyph">
        <span className="c-me">ME</span>
        <span className="g c-me" aria-hidden="true">{spark(meVals, g.top)}</span>
        <span>Σ <b>{sum(meVals)}</b></span>
        <span className="c-th">THEM</span>
        <span className="g c-th" aria-hidden="true">{spark(thVals, g.top)}</span>
        <span>Σ <b>{sum(thVals)}</b></span>
      </div>
    </>
  );
}
