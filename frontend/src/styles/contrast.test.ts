// Every theme must meet 4.5:1 for text (design-system v4). Parses themes.css and
// checks the pairs the UI actually renders.
import { describe, expect, it } from 'vitest';
import { THEMES } from '../theme/themes';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';


const css = readFileSync(resolve(process.cwd(), 'src/styles/themes.css'), 'utf8');

function tokens(theme: string): Record<string, string> {
  const m = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error('missing theme ' + theme);
  const out: Record<string, string> = {};
  for (const d of m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const [k, ...v] = d.split(':');
    if (k && k.trim().startsWith('--')) out[k.trim()] = v.join(':').trim();
  }
  const res = (v: string): string => {
    const r = v.match(/^var\((--[\w-]+)\)$/);
    return r ? res(out[r[1]]) : v;
  };
  for (const k of Object.keys(out)) out[k] = res(out[k]);
  return out;
}

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const PAIRS: [string, string][] = [
  ['--text', '--bg'], ['--text', '--panel'], ['--text-dim', '--bg'], ['--text-dim', '--panel'],
  ['--me-t', '--bg'], ['--them-t', '--bg'], ['--ok-t', '--bg'], ['--me-t', '--panel'],
  ['--on-me', '--me'], ['--concern-fg', '--concern-bg'], ['--urgent-fg', '--urgent-bg'],
];

describe('theme contrast ≥ 4.5:1', () => {
  for (const t of THEMES) {
    it(t, () => {
      const tk = tokens(t);
      // journal fills primary controls with --me-t (see app.css), every other theme with --me
      const pairs: [string, string][] = PAIRS.map(([a, b]) => (t === 'journal' && a === '--on-me' ? [a, '--me-t'] : [a, b]));
      const fails = pairs.filter(([a, b]) => tk[a] && tk[b] && ratio(tk[a], tk[b]) < 4.5).map(([a, b]) => `${a} on ${b} = ${ratio(tk[a], tk[b]).toFixed(2)}`);
      expect(fails).toEqual([]);
    });
  }
});
