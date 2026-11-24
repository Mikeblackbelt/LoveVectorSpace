// Per-theme effect layers (CSS decides which show): blueprint grid, pulse vector
// field, crt scanlines + vignette, and the screen-change line wipe.
const VF: [number, number, number, number, 'a' | 'b', number][] = [
  [18, 22, 20, 26, 'a', 0.9], [92, 14, 160, 18, 'b', 0.6], [54, 70, 300, 30, 'a', 0.5], [130, 64, 45, 22, 'b', 0.85],
  [24, 120, 110, 16, 'b', 0.45], [100, 118, 230, 28, 'a', 0.7], [142, 140, 340, 14, 'a', 0.4], [66, 146, 75, 20, 'b', 0.55],
];

function Field({ id, cls }: { id: string; cls: string }) {
  return (
    <svg className={`vf ${cls}`} width="100%" height="100%">
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width="160" height="160">
          {VF.map(([x, y, r, l, k, o], i) => (
            <g key={i} className={`vf-${k}`} opacity={o} transform={`translate(${x},${y}) rotate(${r})`}>
              <line x1="0" y1="0" x2={l} y2="0" />
              <path d={`M${l},0l-5,-3v6z`} />
              <circle r="1.4" />
            </g>
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

export function FxLayers({ wipeKey }: { wipeKey?: string }) {
  return (
    <>
      <div className="fx fx-grid" aria-hidden="true" />
      <div className="fx fx-field" aria-hidden="true">
        <Field id="vf-p1" cls="vf1" />
        <Field id="vf-p2" cls="vf2" />
      </div>
      <div className="fx fx-scan" aria-hidden="true" />
      <div className="fx fx-vig" aria-hidden="true" />
      <div key={wipeKey} className="wipe" aria-hidden="true" />
    </>
  );
}
