import { useEffect, useRef } from 'react';

/** Single-letter screen hotkey (ignored while typing or inside widgets that own their keys). */
export function useHotkey(key: string, fn: () => void, enabled = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t?.closest?.('[data-own-keys], [role="dialog"]')) return;
      if (e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault();
        ref.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [key, enabled]);
}
