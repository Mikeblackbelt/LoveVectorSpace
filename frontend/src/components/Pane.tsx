import type { ReactNode } from 'react';
import { L } from '../theme/Plain';

/** Box-drawing panel: ┌─[ TITLE ]──── with an optional right-hand meta label. */
export function Pane({
  id, tech, plain, meta, className = '', children, as = 'section',
}: {
  id: string;
  tech: string;
  plain: string;
  meta?: ReactNode;
  className?: string;
  children: ReactNode;
  as?: 'section' | 'aside' | 'div';
}) {
  const Tag = as;
  return (
    <Tag className={`pane ${className}`} aria-labelledby={`t-${id}`}>
      <h2 className="ttl" id={`t-${id}`}>
        <span className="glyph">─[ </span>
        <b><L t={tech} p={plain} /></b>
        <span className="glyph"> ]─</span>
      </h2>
      {meta != null && <span className="meta">{meta}</span>}
      {children}
    </Tag>
  );
}

/** Bracketed command button: [ D ] DONE. */
export function Key({
  k, tech, plain, onClick, variant, type = 'button', disabled, pressed, id, label,
}: {
  k?: string;
  tech: string;
  plain: string;
  onClick?: () => void;
  variant?: 'pri' | 'ghost';
  type?: 'button' | 'submit';
  disabled?: boolean;
  pressed?: boolean;
  id?: string;
  label?: string;
}) {
  return (
    <button
      id={id}
      className={`key${variant ? ' ' + variant : ''}`}
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
    >
      {k && <span className="key-hint">[ {k} ] </span>}
      <L t={tech} p={plain} />
    </button>
  );
}

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="err" role="alert">
      <span className="glyph">[ ERR ] </span>
      {msg}
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <p className="loading dimt" role="status">
      <span className="glyph">&gt; </span>
      <L t={`loading ${what} …`} p={`Loading ${what}…`} />
      <span className="cur glyph" aria-hidden="true" />
    </p>
  );
}
