import { useEffect, useRef } from 'react';
import type { ThemeName } from '../api/types';
import { Pane } from '../components/Pane';
import { say } from '../components/prompt';
import { L } from '../theme/Plain';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES, THEME_META } from '../theme/themes';

const PERS: Record<ThemeName, [string, string]> = {
  signal: ['Swiss print, calm and exact', 'FX: crisp print, no bloom, crop marks'],
  pulse: ['Neon night, loud and glossy', 'FX: neon bloom, chromatic shimmer, drifting field'],
  riso: ['Risograph zine, playful', 'FX: misregistration + halftone dots'],
  blueprint: ['Engineering drawing, precise', 'FX: 24px grid + dimension ticks'],
  journal: ['Notebook, warm and plain-spoken', 'FX: soft rounded card, gentle shadow'],
  crt: ['Amber CRT, nostalgic', 'FX: scanlines, vignette, phosphor bloom'],
};

/** A live specimen: mini radar with sweep + a vector-sum loop, type and swatches, all in its own tokens. */
function Specimen({ t, active, focusable, onPick, onPreview }: {
  t: ThemeName; active: boolean; focusable: boolean;
  onPick: () => void; onPreview: (on: boolean) => void;
}) {
  return (
    <div
      className={`spec${active ? ' on' : ''}`}
      data-theme={t}
      role="radio"
      aria-checked={active}
      tabIndex={focusable ? 0 : -1}
      aria-label={`${THEME_META[t].label.toLowerCase()}: ${PERS[t][0]}`}
      data-t={t}
      onMouseEnter={() => onPreview(true)}
      onMouseLeave={() => onPreview(false)}
      onFocus={() => onPreview(true)}
      onBlur={() => onPreview(false)}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick();
        }
      }}
    >
      <div className="spec-head">
        <span className="spec-name">{t}</span>
        <span className="spec-kind">{THEME_META[t].blurb.split(' · ')[1] || THEME_META[t].blurb}</span>
      </div>
      <div className="spec-body">
        <svg className="spec-radar" viewBox="-60 -60 120 120" aria-hidden="true">
          <circle className="rg" r="52" />
          <circle className="rg rg2" r="35" />
          <circle className="rg rg2" r="18" />
          <line className="ax" x1="-56" y1="0" x2="56" y2="0" />
          <line className="ax" x1="0" y1="-56" x2="0" y2="56" />
          <g className="swp">
            <path d="M0 0 L52 0 A52 52 0 0 0 39.83 -33.43 Z" />
            <line x1="0" y1="0" x2="52" y2="0" />
          </g>
          <g className="vsum">
            <line className="v me" x1="0" y1="0" x2="-18.5" y2="-23.6" />
            <line className="v th" x1="-18.5" y1="-23.6" x2="8.9" y2="-38.2" />
            <line className="v rs" x1="0" y1="0" x2="8.9" y2="-38.2" />
            <circle className="dt me" r="3" cx="-18.5" cy="-23.6" />
            <circle className="dt rs" r="3.6" cx="8.9" cy="-38.2" />
          </g>
          <rect className="org" x="-2" y="-2" width="4" height="4" />
        </svg>
        <div className="spec-num">
          <div className="num">64<i>%</i></div>
          <span className="spec-tag">{t === 'journal' ? 'rough estimate' : '[ UNCALIBRATED ]'}</span>
          <div className="spec-rng">{t === 'journal' ? 'likely 49 to 79' : 'RANGE 49–79'}</div>
        </div>
      </div>
      <div className="spec-sw" aria-hidden="true">
        <span><i className="s-me" />{t === 'journal' ? 'You' : 'ME'}</span>
        <span><i className="s-them" />{t === 'journal' ? 'Them' : 'THEM'}</span>
        <span><i className="s-link" />{t === 'journal' ? 'Together' : 'LINK'}</span>
      </div>
      <p className="spec-pers">{PERS[t][0]}</p>
      <p className="spec-fx">{PERS[t][1]}</p>
      <p className="spec-type">Aa Bb 0123 — {THEME_META[t].label}</p>
    </div>
  );
}

export function ThemesScreen() {
  const { theme, setting, prefs, setTheme, update, setPreview } = useTheme();
  const groupRef = useRef<HTMLDivElement>(null);
  const applied = setting === 'auto' ? null : setting;
  useEffect(() => () => setPreview(null), [setPreview]);

  const pick = (t: ThemeName) => {
    setPreview(null);
    setTheme(t);
    say(`lvs theme ${t}`, '↳ applied · saved to your account');
  };

  return (
    <main className="screen themes-screen">
      <section className="themes-hero" aria-labelledby="th-title">
        <h1 id="th-title" className="th-title"><L t="PICK HOW LOVEVECTORSPACE FEELS" p="Pick how LoveVectorSpace feels" /></h1>
        <p className="th-line">
          <L t="// same data, six personalities. hover or focus to try one on the whole screen; click or ENTER to keep it." p="Same data, six personalities. Hover or focus to try one; click to keep it." />
        </p>
        <p className="th-state" aria-live="polite">
          <L t="ON SCREEN" p="On screen" /> <b>{theme}</b> · <L t="SAVED" p="Saved" /> <b>{setting}</b>
        </p>
      </section>

      <div
        ref={groupRef}
        className="specs"
        role="radiogroup"
        aria-label="Themes"
        data-own-keys
        onKeyDown={(e) => {
          if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
          const els = [...(groupRef.current?.querySelectorAll<HTMLElement>('.spec') || [])];
          const i = els.indexOf(document.activeElement as HTMLElement);
          const n = els[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length];
          n?.focus();
          e.preventDefault();
        }}
      >
        {THEMES.map((t, i) => (
          <Specimen
            key={t}
            t={t}
            active={applied === t}
            focusable={applied ? applied === t : i === 0}
            onPick={() => pick(t)}
            onPreview={(on) => setPreview(on ? t : null)}
          />
        ))}
      </div>

      <div className="two-col themes-panels">
        <Pane id="auto" tech="AUTO" plain="Automatic theme">
          <label className="toggle big-toggle">
            <input type="checkbox" role="switch" checked={setting === 'auto'} onChange={(e) => setTheme(e.target.checked ? 'auto' : theme)} />
            <L t="AUTO MODE" p="Switch automatically" />
          </label>
          <fieldset className="opt-group" disabled={setting !== 'auto'}>
            <legend className="lbl"><L t="FOLLOW" p="Based on" /></legend>
            <label className="radio-inline">
              <input type="radio" name="auto-mode" checked={prefs.auto_theme.mode === 'system'} onChange={() => update({ auto_theme: { ...prefs.auto_theme, mode: 'system' } })} />
              <L t="SYSTEM APPEARANCE (LIGHT → DAY, DARK → NIGHT)" p="Your device's light or dark setting" />
            </label>
            <label className="radio-inline">
              <input type="radio" name="auto-mode" checked={prefs.auto_theme.mode === 'time'} onChange={() => update({ auto_theme: { ...prefs.auto_theme, mode: 'time' } })} />
              <L t="TIME OF DAY" p="Time of day" />
            </label>
          </fieldset>
          <div className="opt-grid">
            <label className="field">
              <span className="lbl"><L t="DAY THEME" p="Day theme" /></span>
              <select value={prefs.auto_theme.day} onChange={(e) => update({ auto_theme: { ...prefs.auto_theme, day: e.target.value as ThemeName } })}>
                {THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="lbl"><L t="NIGHT THEME" p="Night theme" /></span>
              <select value={prefs.auto_theme.night} onChange={(e) => update({ auto_theme: { ...prefs.auto_theme, night: e.target.value as ThemeName } })}>
                {THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            {prefs.auto_theme.mode === 'time' && (
              <>
                <label className="field">
                  <span className="lbl"><L t="DAY STARTS" p="Day starts" /></span>
                  <input type="time" value={prefs.auto_theme.day_start} onChange={(e) => update({ auto_theme: { ...prefs.auto_theme, day_start: e.target.value } })} />
                </label>
                <label className="field">
                  <span className="lbl"><L t="DAY ENDS" p="Day ends" /></span>
                  <input type="time" value={prefs.auto_theme.day_end} onChange={(e) => update({ auto_theme: { ...prefs.auto_theme, day_end: e.target.value } })} />
                </label>
              </>
            )}
          </div>
        </Pane>
        <Pane id="a11y" tech="ACCESSIBILITY" plain="Display options">
          <label className="toggle">
            <input type="checkbox" role="switch" checked={prefs.reduce_motion} onChange={(e) => update({ reduce_motion: e.target.checked })} />
            <L t="REDUCE MOTION" p="Reduce motion" />
            <span className="dimt small"> <L t="// stops sweeps, tickers, wipes and the intro animation" p="Stops moving effects" /></span>
          </label>
          <label className="toggle">
            <input type="checkbox" role="switch" checked={prefs.contrast_boost} onChange={(e) => update({ contrast_boost: e.target.checked })} />
            <L t="CONTRAST BOOST" p="Stronger contrast" />
          </label>
          <fieldset className="opt-group">
            <legend className="lbl"><L t="TEXT SIZE" p="Text size" /></legend>
            {(['s', 'm', 'l'] as const).map((s) => (
              <label key={s} className="radio-inline">
                <input type="radio" name="text-size" checked={prefs.text_size === s} onChange={() => update({ text_size: s })} />
                {s === 's' ? <L t="S" p="Small" /> : s === 'm' ? <L t="M" p="Medium" /> : <L t="L" p="Large" />}
              </label>
            ))}
          </fieldset>
        </Pane>
      </div>
    </main>
  );
}
