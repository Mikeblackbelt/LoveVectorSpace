import { useEffect, useRef } from 'react';
import type { ThemeName } from '../api/types';
import { say } from '../components/prompt';
import { L } from '../theme/Plain';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES, THEME_META } from '../theme/themes';
import { A11yPanel, AutoPanel } from './ThemePanels';

const PERS: Record<ThemeName, [string, string]> = {
  signal: ['Swiss print, calm and exact', 'FX: crisp print, no bloom, crop marks'],
  pulse: ['Neon night, loud and glossy', 'FX: neon bloom, chromatic shimmer, drifting field'],
  riso: ['Risograph zine, playful', 'FX: misregistration + halftone dots'],
  blueprint: ['Engineering drawing, precise', 'FX: 24px grid + dimension ticks'],
  journal: ['Notebook, warm and plain-spoken', 'FX: soft rounded card, gentle shadow'],
  matcha: ['Tea house, calm and unhurried', 'FX: soft cards, paper fibre, rounded radar'],
  midnight: ['Night sky, refined and quiet', 'FX: gold hairlines + star field'],
  inkwell: ['High contrast, built for legibility', 'FX: THEM hatched, 3px focus, no ambient motion'],
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
          <span className="spec-tag">{t === 'journal' || t === 'matcha' ? 'rough estimate' : '[ UNCALIBRATED ]'}</span>
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
  const { theme, setting, setTheme, setPreview } = useTheme();
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
          <L t="// same data, nine personalities. hover or focus to try one on the whole screen; click or ENTER to keep it." p="Same data, nine personalities. Hover or focus to try one; click to keep it." />
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
        <AutoPanel />
        <A11yPanel />
      </div>
    </main>
  );
}
