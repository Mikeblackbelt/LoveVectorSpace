import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { peopleApi } from '../api/endpoints';
import type { PersonSummary } from '../api/types';
import { ErrorLine, Key, Loading } from '../components/Pane';
import { rememberPerson, say } from '../components/prompt';
import { ago, timezoneGuess } from '../lib/format';
import { haptic } from '../native/native';
import { L } from '../theme/Plain';
import { SourcesPanel } from './Sources';
import { useHotkey } from '../lib/hotkeys';

const SRC: Record<string, [string, string]> = {
  whatsapp: ['WA', 'WhatsApp'], instagram: ['IG', 'Instagram'], discord: ['DC', 'Discord'], import: ['IMPORT', 'uploaded file'], plaintext: ['TXT', 'text file'],
};

export function rangeBar(lo: number | null, hi: number | null, cells = 12): string {
  if (lo == null || hi == null) return '▕' + '·'.repeat(cells) + '▏';
  const a = Math.floor((lo / 100) * cells);
  const b = Math.ceil((hi / 100) * cells);
  return '▕' + Array.from({ length: cells }, (_, i) => (i >= a && i < b ? '█' : '░')).join('') + '▏';
}

function SafetyCell({ s }: { s: PersonSummary['safety'] }) {
  if (s === 'none') return <span className="ok"><L t="SAFETY ✓" p="Safety check passed" /></span>;
  if (s === 'info') return <span className="dimt"><L t="SAFETY [ INFO ]" p="A note to read" /></span>;
  return (
    <span className={s === 'urgent' ? 'paper urgent' : 'paper'}>
      <L t={`SAFETY [ ${s.toUpperCase()} ]`} p={s === 'urgent' ? 'Please read the warning' : 'Worth a closer look'} />
    </span>
  );
}

export function PeopleScreen() {
  const q = useQuery({ queryKey: ['people'], queryFn: peopleApi.list });
  const nav = useNavigate();
  const [sel, setSel] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  useHotkey('n', () => setAdding(true), !adding);
  const selected = q.data?.find((p) => p.id === sel) || q.data?.[0];
  const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 699px)').matches;

  const open = (p: PersonSummary) => {
    rememberPerson(p.id);
    say(`lvs open ${p.pseudonym.toLowerCase().replace(/\s+/g, '')}`);
    nav(`/p/${p.id}`);
  };

  return (
    <main className="screen people-screen">
      <section className="pane people-list" aria-labelledby="t-people">
        <h2 className="ttl" id="t-people">
          <span className="glyph">┌─[ </span><b><L t="PEOPLE" p="People" /></b><span className="glyph"> ]─</span>
        </h2>
        <span className="meta"><L t={`${q.data?.length ?? 0} ENTRIES`} p={`${q.data?.length ?? 0} people`} /></span>
        <div className="ls glyph">$ ls -l ~/people</div>
        {q.isLoading && <Loading what="people" />}
        <ErrorLine error={q.error} />
        {q.data && (
          <>
            <div className="hdr" aria-hidden="true">
              <span /><span><L t="NAME" p="Name" /></span><span><L t="MODE" p="Stage" /></span>
              <span><L t="CHANCE" p="Chance it works out" /></span><span><L t="SOURCES" p="Sources" /></span><span><L t="SAFETY" p="Safety check" /></span>
            </div>
            <ul className="plist" aria-label="People">
              {q.data.map((p) => {
                const isSel = selected?.id === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`row${isSel ? ' sel' : ''}`}
                      aria-current={isSel ? 'true' : undefined}
                      onClick={() => (phone ? open(p) : setSel(p.id))}
                      onDoubleClick={() => open(p)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          open(p);
                        }
                      }}
                    >
                      <span className="c0 glyph">{isSel ? '>' : '-'}</span>
                      <span className="c1 nm">{p.pseudonym.toUpperCase()}</span>
                      <span className="c2 dimt">{p.mode.toUpperCase()}</span>
                      <span className="c3">
                        {p.success.status === 'ok' && p.success.percent != null ? (
                          <>
                            <span className="big">{Math.round(p.success.percent)}<i>%</i></span>{' '}
                            <span className="rng c-me glyph">{rangeBar(p.success.low, p.success.high)}</span>{' '}
                            <span className="sub dimt"><L t="UNCAL" p="rough estimate" /> · {p.success.low != null && p.success.high != null ? `${p.success.low}–${p.success.high}` : <L t="NO RANGE" p="no range yet" />}</span>
                          </>
                        ) : (
                          <>
                            <span className="dimt"><L t="INSUFFICIENT DATA" p="Not enough messages yet" /></span>{' '}
                            <span className="rng dimt glyph">{rangeBar(null, null)}</span>
                          </>
                        )}
                      </span>
                      <span className="c4">
                        {p.sources.length === 0 && <span className="dimt"><L t="NO SOURCES" p="No chats yet" /></span>}
                        {p.sources.map((s) => (
                          <span key={s.source} className="src-chip">
                            <L t={(SRC[s.source] || [s.source.toUpperCase()])[0]} p={(SRC[s.source] || [s.source, s.source])[1]} />{' '}
                            <span className={s.health === 'ok' ? 'ok' : 'c-me'}>●</span> {s.last_sync ? ago(s.last_sync) : ''}
                          </span>
                        ))}
                      </span>
                      <span className="c5"><SafetyCell s={p.safety} /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="row-actions">
          {!adding ? (
            <Key k="N" variant="pri" tech="NEW PERSON" plain="New person" onClick={() => setAdding(true)} id="btn-new-person" />
          ) : (
            <NewPerson onDone={(id) => { setAdding(false); if (id) setSel(id); }} />
          )}
          {selected && (
            <Link className="key" to={`/p/${selected.id}`} onClick={() => rememberPerson(selected.id)}>
              <span className="key-hint">[ ENTER ] </span><L t="OPEN DASHBOARD" p="Open dashboard" />
            </Link>
          )}
        </div>
        <p className="ls">
          <span className="glyph">// </span>
          <L
            t="chance is uncalibrated until about 20 labelled outcomes. range bar = plausible span."
            p="These are rough estimates until you have logged about 20 outcomes."
          />
        </p>
      </section>
      {selected && !phone && (
        <section className="pane src-pane" aria-labelledby="t-src">
          <h2 className="ttl" id="t-src">
            <span className="glyph">┌─[ </span><b><L t="SOURCES ·" p="Chat sources for" /> {selected.pseudonym.toUpperCase()}</b><span className="glyph"> ]─</span>
          </h2>
          <SourcesPanel pid={selected.id} compact />
        </section>
      )}
    </main>
  );
}

function NewPerson({ onDone }: { onDone: (id?: number) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'potential' | 'established'>('potential');
  const m = useMutation({
    mutationFn: () => peopleApi.create({ pseudonym: name.trim(), mode, timezone: timezoneGuess() }),
    onSuccess: (p) => {
      haptic();
      say(`lvs people add "${p.pseudonym}"`, '↳ created · import a chat next');
      void qc.invalidateQueries({ queryKey: ['people'] });
      onDone(p.id);
    },
  });
  return (
    <form
      className="new-person"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) m.mutate();
      }}
    >
      <div className="field">
        <label className="lbl" htmlFor="np-name"><L t="NAME OR NICKNAME" p="Name or nickname" /></label>
        <span className="glyph">›</span>
        <input id="np-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required maxLength={60} />
      </div>
      <div className="field" role="radiogroup" aria-label="Mode">
        <span className="lbl"><L t="MODE" p="Stage" /></span>
        {(['potential', 'established'] as const).map((v) => (
          <label key={v} className="radio-inline">
            <input type="radio" name="np-mode" checked={mode === v} onChange={() => setMode(v)} />
            <L t={v.toUpperCase()} p={v === 'potential' ? 'Getting to know them' : 'In a relationship'} />
          </label>
        ))}
      </div>
      <ErrorLine error={m.error} />
      <div className="keys">
        <Key type="submit" k="ENTER" variant="pri" tech="CREATE" plain="Create" disabled={!name.trim() || m.isPending} />
        <Key k="ESC" variant="ghost" tech="CANCEL" plain="Cancel" onClick={() => onDone()} />
      </div>
    </form>
  );
}
