// Rendered-contrast rule (design-system "Contrast and motion fixes"): text is coloured only with
// text tokens, never fill tokens or --rule, and text is never faded with opacity. Effect layers
// (grid, star field, vector field, scanlines) may use opacity because they sit behind text.
// Together with contrast.test.ts (every text-token pair ≥4.5:1 in all nine themes) this keeps
// rendered text at or above 4.5:1 without a browser.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = ['base.css', 'app.css'].map((f) => [f, readFileSync(resolve(process.cwd(), 'src/styles', f), 'utf8')] as const);

const TEXT_OK =
  /^(var\(--(text|text-dim|me-t|them-t|link-t|ok-t|on-me|concern-fg|urgent-fg|bg|res-t|hl-color|hl-pct|title|panel|wm-c)\)|inherit|transparent|currentColor|unset)(\s*!important)?$/;
// decorative, non-text layers that may be translucent (or are hidden form widgets / disabled controls)
const OPACITY_OK =
  /(fx-|\.vf|mis-copy|v-par|v-res|sc-cur|dim-ext|hero svg|intro::before|intro-wm|radio input|:disabled|hl::after|^\s*(from|to|\d+%))/;

function rules(css: string) {
  const out: { sel: string; decls: [string, string][] }[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = m[2]
      .split(';')
      .filter((d) => d.includes(':'))
      .map((d) => {
        const i = d.indexOf(':');
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()] as [string, string];
      });
    out.push({ sel: m[1].trim(), decls });
  }
  return out;
}

describe('rendered contrast rules', () => {
  for (const [name, css] of files) {
    it(`${name}: text colours use text tokens only`, () => {
      const bad = rules(css).flatMap((r) => r.decls.filter(([k, v]) => k === 'color' && !TEXT_OK.test(v)).map(([, v]) => `${r.sel} → ${v}`));
      expect(bad).toEqual([]);
    });
    it(`${name}: no opacity below 1 outside decorative layers`, () => {
      const bad = rules(css).flatMap((r) =>
        r.decls
          .filter(([k, v]) => k === 'opacity' && parseFloat(v) < 1 && !OPACITY_OK.test(r.sel))
          .map(([, v]) => `${r.sel} → ${v}`),
      );
      expect(bad).toEqual([]);
    });
  }
});
