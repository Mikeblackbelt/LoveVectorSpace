import type { ThemeName } from '../api/types';
import { Pane } from '../components/Pane';
import { L } from '../theme/Plain';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES, type Motion } from '../theme/themes';

/** Segmented radio group with arrow-key movement (roving tabindex). */
export function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div
      className="seg"
      role="radiogroup"
      aria-label={label}
      data-own-keys
      onKeyDown={(e) => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
        const i = options.findIndex(([v]) => v === value);
        const n = options[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length][0];
        onChange(n);
        (e.currentTarget.querySelector(`[data-v="${n}"]`) as HTMLElement | null)?.focus();
        e.preventDefault();
      }}
    >
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" data-v={v} aria-checked={value === v} tabIndex={value === v ? 0 : -1} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Chips({ label, value, onChange }: { label: string; value: ThemeName; onChange: (t: ThemeName) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {THEMES.map((t) => (
        <button key={t} type="button" className="chip" role="radio" data-theme={t} aria-checked={value === t} onClick={() => onChange(t)}>
          <span className="mini" aria-hidden="true"><i className="m1" /><i className="m2" /><i className="m3" /></span>
          {t}
        </button>
      ))}
    </div>
  );
}

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const xy = (r: number, a: number) => [r * Math.sin((a * Math.PI) / 180), -r * Math.cos((a * Math.PI) / 180)].map((n) => n.toFixed(2)).join(',');
function arc(r: number, a0: number, a1: number) {
  let d = a1 - a0;
  if (d <= 0) d += 360;
  return `M${xy(r, a0)}A${r},${r} 0 ${d > 180 ? 1 : 0} 1 ${xy(r, a0 + d)}`;
}

/** 24-hour AUTO ring: day band in the day theme, night band in the night theme, a hand at now. */
function AutoRing() {
  const { prefs, theme } = useTheme();
  const a = prefs.auto_theme;
  const now = new Date();
  const nowA = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 360;
  const d0 = (mins(a.day_start) / 1440) * 360;
  const d1 = (mins(a.day_end) / 1440) * 360;
  const ticks = Array.from({ length: 24 }, (_, h) => `M${xy(h % 6 === 0 ? 87 : 90, (h / 24) * 360)}L${xy(96, (h / 24) * 360)}`).join('');
  const hours: [string, number, number][] = [['00', 0, -101], ['06', 104, 4], ['12', 0, 109], ['18', -104, 4]];
  return (
    <svg
      className="dial"
      viewBox="-118 -118 236 236"
      role="img"
      aria-label={`24-hour schedule: ${a.day} from ${a.day_start} to ${a.day_end}, ${a.night} otherwise. Now showing ${theme}.`}
    >
      <circle className="ol" r="85" />
      <circle className="ol" r="59" />
      <path className="tk" d={ticks} />
      {a.mode === 'time' ? (
        <>
          <g data-theme={a.day}><path className="band" d={arc(72, d0, d1)} /></g>
          <g data-theme={a.night}><path className="band" d={arc(72, d1, d0)} /></g>
        </>
      ) : (
        <>
          <g data-theme={a.day}><path className="band" d={arc(72, 0, 180)} /></g>
          <g data-theme={a.night}><path className="band" d={arc(72, 180, 360)} /></g>
        </>
      )}
      {a.mode === 'time' && hours.map(([t, x, y]) => (
        <text key={t} className="hl" x={x} y={y} textAnchor="middle">{t}</text>
      ))}
      {a.mode === 'time' && (
        <g className="hand" transform={`rotate(${nowA.toFixed(1)})`}>
          <line x1="0" y1="-52" x2="0" y2="-94" />
          <circle cx="0" cy="-95" r="3.6" />
        </g>
      )}
      <text className="ct" y="-2" textAnchor="middle">{a.mode === 'time' ? now.toTimeString().slice(0, 5) : 'system'}</text>
      <text className="cs" y="16" textAnchor="middle">{theme}</text>
    </svg>
  );
}

export function AutoPanel() {
  const { prefs, setting, theme, setTheme, update } = useTheme();
  const a = prefs.auto_theme;
  const on = setting === 'auto';
  const setA = (p: Partial<typeof a>) => update({ auto_theme: { ...a, ...p } });
  return (
    <Pane id="auto" tech="AUTO" plain="Automatic theme">
      <label className="toggle big-toggle">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => setTheme(e.target.checked ? 'auto' : theme)} />
        <L t="AUTO MODE" p="Switch automatically" /> <span className="dimt">{on ? 'on' : 'off'}</span>
      </label>
      <p className="dimt small">
        <L t="// let the theme change on its own, from your system setting or the clock." p="Let the theme change on its own, from your system setting or the clock." />
      </p>
      <Seg label="Auto mode" value={a.mode} options={[['system', 'Follow system'], ['time', 'By time of day']]} onChange={(m) => setA({ mode: m })} />
      <div className="dial-wrap"><AutoRing /></div>
      <div className="pick">
        <span className="lbl"><L t={a.mode === 'time' ? 'DAY THEME' : 'LIGHT THEME'} p={a.mode === 'time' ? 'Day theme' : 'When your device is light'} /></span>
        <Chips label="Day theme" value={a.day} onChange={(t) => setA({ day: t })} />
      </div>
      <div className="pick">
        <span className="lbl"><L t={a.mode === 'time' ? 'NIGHT THEME' : 'DARK THEME'} p={a.mode === 'time' ? 'Night theme' : 'When your device is dark'} /></span>
        <Chips label="Night theme" value={a.night} onChange={(t) => setA({ night: t })} />
      </div>
      {a.mode === 'time' && (
        <div className="opt-grid">
          <label className="field">
            <span className="lbl"><L t="DAY STARTS" p="Day starts" /></span>
            <input type="time" value={a.day_start} onChange={(e) => setA({ day_start: e.target.value })} />
          </label>
          <label className="field">
            <span className="lbl"><L t="DAY ENDS" p="Day ends" /></span>
            <input type="time" value={a.day_end} onChange={(e) => setA({ day_end: e.target.value })} />
          </label>
        </div>
      )}
      <p className="now" aria-live="polite">
        <L t="NOW" p="Now" />: <b>{theme}</b>
        {!on && <span className="dimt"> · auto is off</span>}
      </p>
    </Pane>
  );
}

export function A11yPanel() {
  const { prefs, update, motion, motionChoice, setMotion } = useTheme();
  return (
    <Pane id="a11y" tech="ACCESSIBILITY" plain="Display options">
      <div className="arow">
        <span className="lbl"><L t="MOTION" p="Motion" /></span>
        <Seg<Motion> label="Motion" value={motion} options={[['full', 'Full'], ['gentle', 'Gentle'], ['off', 'Off']]} onChange={(m) => setMotion(m)} />
      </div>
      <p className="dimt small" data-testid="motion-note">
        {motionChoice ? (
          <>
            <L t="// your choice." p="Your choice." />{' '}
            <button className="linkish" type="button" onClick={() => setMotion(null)}><L t="USE DEFAULT" p="Use default" /></button>
          </>
        ) : (
          <L t={`// ${motion} by default (system setting, account or theme).`} p={`${motion === 'full' ? 'Full' : 'Gentle'} by default.`} />
        )}{' '}
        <L t="gentle keeps drawing and count-ups but drops sweeps, flicker and loops; off is static." p="Gentle keeps small animations and stops anything that loops. Off is still." />
      </p>
      <label className="toggle">
        <input type="checkbox" role="switch" checked={prefs.contrast_boost} onChange={(e) => update({ contrast_boost: e.target.checked })} />
        <L t="CONTRAST BOOST" p="Stronger contrast" />
      </label>
      <div className="arow">
        <span className="lbl"><L t="TEXT SIZE" p="Text size" /></span>
        <Seg label="Text size" value={prefs.text_size} options={[['s', 'S'], ['m', 'M'], ['l', 'L']]} onChange={(v) => update({ text_size: v })} />
      </div>
    </Pane>
  );
}
