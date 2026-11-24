import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../theme/Plain';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES, THEME_META } from '../theme/themes';
import { say } from './prompt';

export function Swatch({ theme }: { theme: string }) {
  return (
    <span className="sw" data-theme={theme} aria-hidden="true">
      <i className="s1" />
      <i className="s2" />
      <i className="s3" />
    </span>
  );
}

/** The [T] THEME popover: every theme with a swatch strip, active one in reverse video. */
export function ThemePopover() {
  const { theme, setting, setTheme, popoverOpen, setPopoverOpen } = useTheme();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest?.('[data-theme-toggle]')) return;
      setPopoverOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [popoverOpen, setPopoverOpen]);

  return (
    <div id="theme-pop" ref={ref} className="theme-pop" hidden={!popoverOpen} role="group" aria-label="Theme">
      <h2 className="ttl">
        <span className="glyph">─[ </span>
        <b><L t="THEME" p="Theme" /></b>
        <span className="glyph"> ]─</span>
      </h2>
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          className={`th-opt${theme === t ? ' on' : ''}`}
          data-t={t}
          aria-pressed={theme === t}
          onClick={() => {
            setTheme(t);
            say(`lvs theme ${t}`, '↳ theme saved');
          }}
        >
          <span>
            {THEME_META[t].label}
            <small>{THEME_META[t].blurb}</small>
          </span>
          <Swatch theme={t} />
        </button>
      ))}
      <button
        type="button"
        className={`th-opt${setting === 'auto' ? ' on' : ''}`}
        aria-pressed={setting === 'auto'}
        onClick={() => setTheme('auto')}
      >
        <span>
          AUTO<small>by system or time of day</small>
        </span>
      </button>
      <Link className="pop-link" to="/themes" onClick={() => setPopoverOpen(false)}>
        <span className="glyph">▸ </span>
        <L t="ALL THEMES + ACCESSIBILITY" p="All themes and display options" />
      </Link>
      <div className="pop-hint key-hint">[T] CYCLE · [ESC] CLOSE · SAVED TO YOUR ACCOUNT</div>
    </div>
  );
}
