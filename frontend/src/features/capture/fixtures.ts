// Synthetic OCR fixtures for tests: a 1080x2400 phone screenshot with bubbles laid out the
// way chat apps draw them. Not imported by app code.
import type { OcrImage, OcrLine, Role } from './types';

export const W = 1080;
export const H = 2400;
const LH = 44; // line height
const LINE_GAP = 10; // between lines of one bubble
const BUBBLE_GAP = 60; // between bubbles

export type Row =
  | { sep: string }
  | { role: Role; lines: string[]; time?: string; timeInline?: boolean; width?: number }
  | { system: string };

/** Lay rows out from `y0` downwards and return OCR lines with plausible boxes. */
export function layout(rows: Row[], y0 = 300): OcrLine[] {
  const out: OcrLine[] = [];
  let y = y0;
  for (const r of rows) {
    if ('sep' in r || 'system' in r) {
      const text = 'sep' in r ? r.sep : r.system;
      const w = Math.min(800, text.length * 22);
      out.push({ text, x: (W - w) / 2, y, w, h: 34 });
      y += 34 + BUBBLE_GAP;
      continue;
    }
    const w = r.width ?? Math.min(760, Math.max(...r.lines.map((s) => s.length)) * 24);
    // Text starts 40px into the bubble; bubbles sit 40px from their screen edge.
    const x = r.role === 'them' ? 80 : W - 80 - w;
    r.lines.forEach((text, i) => {
      const last = i === r.lines.length - 1;
      const t = last && r.time && r.timeInline ? `${text} ${r.time}` : text;
      out.push({ text: t, x, y, w, h: LH });
      y += LH + (last ? 0 : LINE_GAP);
    });
    if (r.time && !r.timeInline) {
      // Small time on its own line at the bubble's bottom-right corner.
      out.push({ text: r.time, x: x + w - 120, y: y + 4, w: 110, h: 30 });
      y += 34;
    }
    y += BUBBLE_GAP;
  }
  return out;
}

/** Header (contact name) + status bar + input bar, which segmentation must drop. */
export function chrome(): OcrLine[] {
  return [
    { text: '9:41', x: 40, y: 20, w: 90, h: 36 },
    { text: 'Alex', x: 200, y: 120, w: 120, h: 50 },
    { text: 'online', x: 200, y: 175, w: 110, h: 30 },
    { text: 'Message', x: 120, y: 2280, w: 200, h: 44 },
  ];
}

export function shot(rows: Row[], y0 = 300): OcrImage {
  return { width: W, height: H, lines: [...chrome(), ...layout(rows, y0)] };
}
