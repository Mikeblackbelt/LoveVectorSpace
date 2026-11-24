import type { ReactNode } from 'react';
import type { Metric } from '../api/types';
import { useTheme } from './ThemeProvider';

/**
 * Technical label in terminal themes, plain-language label in journal.
 * Rendered as real text (not a CSS swap) so screen readers and tests see it.
 */
export function L({ t, p }: { t: ReactNode; p: ReactNode }) {
  const { journal } = useTheme();
  return <>{journal ? p : t}</>;
}

export function usePlain() {
  const { journal } = useTheme();
  return (t: string, p: string) => (journal ? p : t);
}

/** Metric name: the snake_case id in terminal themes, Metric.plain_label in journal. */
export function MetricName({ m }: { m: Pick<Metric, 'label' | 'plain_label' | 'id'> }) {
  const { journal } = useTheme();
  return <>{journal ? m.plain_label || m.label : m.label || m.id}</>;
}

export type TagCode = 'MOD' | 'HEUR' | 'DESC' | 'SELF' | 'UNCAL';

export const TAG_PLAIN: Record<TagCode, string> = {
  MOD: 'moderate evidence',
  HEUR: 'rule of thumb',
  DESC: 'simple count',
  SELF: 'your own notes',
  UNCAL: 'rough estimate',
};

export function evidenceCode(evidence: string): TagCode {
  const e = evidence.toLowerCase();
  if (e.startsWith('self')) return 'SELF';
  if (e.startsWith('mod')) return 'MOD';
  if (e.startsWith('desc')) return 'DESC';
  if (e.startsWith('uncal')) return 'UNCAL';
  return 'HEUR';
}

/** Evidence tag shown on every metric: [MOD] / "moderate evidence". */
export function Tag({ code, evidence }: { code?: TagCode; evidence?: string }) {
  const { journal } = useTheme();
  const c = code ?? evidenceCode(evidence || 'heuristic');
  return (
    <span className={`tag t-${c.toLowerCase()}`} data-evidence={c}>
      {journal ? TAG_PLAIN[c] : `[${c}]`}
    </span>
  );
}
