import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { peopleApi } from '../api/endpoints';
import type { CoverageSpan, ImportPreview, Unit } from '../api/types';
import { ErrorLine, Key, Loading } from '../components/Pane';
import { useShell } from '../components/Shell';
import { say } from '../components/prompt';
import { n as fmtN, timezoneGuess, ymd } from '../lib/format';
import { haptic } from '../native/native';
import { L } from '../theme/Plain';

const CELLS = 28;

/** ASCII coverage timeline: █ covered, ╱ none, across the person's whole range. */
export function coverageBar(spans: CoverageSpan[], t0: number, t1: number): string {
  const w = (t1 - t0) / CELLS || 1;
  return Array.from({ length: CELLS }, (_, i) => {
    const a = t0 + i * w, b = a + w;
    return spans.some((s) => new Date(s.start).getTime() < b && new Date(s.end).getTime() > a) ? '█' : '╱';
  }).join('');
}

export function SourcesScreen() {
  const { pid: p } = useParams();
  const pid = Number(p);
  const { person } = useShell();
  const loc = useLocation() as { state?: { sharedFile?: { blob: Blob; name: string } } };
  return (
    <main className="screen sources-screen">
      <section className="pane src-pane" aria-labelledby="t-src">
        <h2 className="ttl" id="t-src">
          <span className="glyph">┌─[ </span><b><L t="SOURCES ·" p="Chat sources for" /> {person?.pseudonym.toUpperCase() || ''}</b><span className="glyph"> ]─</span>
        </h2>
        <SourcesPanel pid={pid} shared={loc.state?.sharedFile} />
      </section>
    </main>
  );
}

export function SourcesPanel({ pid, compact, shared }: { pid: number; compact?: boolean; shared?: { blob: Blob; name: string } }) {
  const qc = useQueryClient();
  const units = useQuery({ queryKey: ['units', pid], queryFn: () => peopleApi.units(pid) });
  const cov = useQuery({ queryKey: ['coverage', pid], queryFn: () => peopleApi.coverage(pid) });
  const speakers = useQuery({ queryKey: ['speakers', pid], queryFn: () => peopleApi.speakers(pid), enabled: !compact });
  const [importing, setImporting] = useState(!!shared);
  const [confirm, setConfirm] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: (u: Unit) => peopleApi.deleteUnit(u.unit_id),
    onSuccess: (r, u) => {
      say(`lvs units rm ${u.unit_id}`, `↳ removed ${r.removed_messages} messages`);
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ['units', pid] });
      void qc.invalidateQueries({ queryKey: ['coverage', pid] });
      void qc.invalidateQueries({ queryKey: ['overview', pid] });
    },
  });

  const spans = cov.data || [];
  const t0 = spans.length ? Math.min(...spans.map((s) => new Date(s.start).getTime())) : 0;
  const t1 = spans.length ? Math.max(...spans.map((s) => new Date(s.end).getTime())) : 1;
  const bySource = new Map<string, CoverageSpan[]>();
  spans.forEach((s) => bySource.set(s.source, [...(bySource.get(s.source) || []), s]));
  const countBy = new Map<string, number>();
  units.data?.forEach((u) => countBy.set(u.source, (countBy.get(u.source) || 0) + u.message_count));

  return (
    <div className="sources">
      {(units.isLoading || cov.isLoading) && <Loading what="sources" />}
      {[...bySource.entries()].map(([src, ss]) => (
        <div className="srcrow" key={src}>
          <div className="srchead">
            <span><b>{src.toUpperCase()}</b> <span className="dimt">{fmtN(countBy.get(src) || 0)} msgs</span></span>
            <span className="ok"><L t="OK" p="Working" /></span>
          </div>
          <div className="tl c-me" role="img" aria-label={`${src} coverage: ${ss.map((s) => `${ymd(s.start)} to ${ymd(s.end)}`).join(', ')}`}>
            {coverageBar(ss, t0, t1)}
          </div>
          <div className="dimt small">{ss.map((s) => `${ymd(s.start)} → ${ymd(s.end)}`).join(' · ')}</div>
        </div>
      ))}
      {spans.length > 0 && (
        <div className="dimt small">
          {ymd(new Date(t0).toISOString())} ──── {ymd(new Date(t1).toISOString())} &nbsp;█ <L t="covered" p="has messages" /> &nbsp;
          <span className="glyph">╱</span> <L t="none" p="no messages" />
        </div>
      )}
      {!compact && speakers.data && speakers.data.length > 0 && (
        <>
          <h3 className="lbl sub-h"><L t="SPEAKER MAPPING" p="Who is who" /></h3>
          <ul className="speakers">
            {speakers.data.map((s) => (
              <li key={s.source + s.speaker_raw}>
                <span className="dimt">{s.source}</span> · {s.speaker_raw} → <b className={s.role === 'me' ? 'c-me' : 'c-th'}>{s.role.toUpperCase()}</b>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="lbl sub-h"><L t="UNITS" p="Uploads and captures" /></h3>
      {units.data?.length === 0 && <p className="dimt"><L t="// nothing imported yet" p="Nothing imported yet." /></p>}
      <ul className="units">
        {units.data?.map((u) => (
          <li className="unit" key={u.unit_id}>
            <span className="t">
              <L
                t={`${u.unit_id.startsWith('cap') ? 'capture' : 'upload'}:${u.source} · ${fmtN(u.message_count)} msgs · ${ymd(u.start_ts)}→${ymd(u.end_ts)}`}
                p={`${u.source} · ${fmtN(u.message_count)} messages · ${ymd(u.start_ts)} to ${ymd(u.end_ts)}`}
              />
            </span>
            {confirm === u.unit_id ? (
              <span className="keys">
                <Key variant="pri" tech="CONFIRM DELETE" plain="Yes, delete" onClick={() => del.mutate(u)} disabled={del.isPending} />
                <Key variant="ghost" tech="KEEP" plain="Keep" onClick={() => setConfirm(null)} />
              </span>
            ) : (
              <button className="key ghost" type="button" onClick={() => setConfirm(u.unit_id)} aria-label={`Delete ${u.source} unit`}>
                <span className="glyph">[ </span><L t="DEL" p="Delete" /><span className="glyph"> ]</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorLine error={del.error} />
      <div className="row-actions">
        <Key k="I" variant="pri" tech="IMPORT CHAT" plain="Import chat" onClick={() => setImporting(true)} id="btn-import-open" />
      </div>
      {importing && <ImportDialog pid={pid} initial={shared} onClose={() => setImporting(false)} />}
    </div>
  );
}

export function ImportDialog({ pid, onClose, initial }: { pid: number; onClose: () => void; initial?: { blob: Blob; name: string } }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<{ blob: Blob; name: string } | null>(initial || null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [tz, setTz] = useState(timezoneGuess());
  const [localErr, setLocalErr] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  const pv = useMutation({
    mutationFn: (f: { blob: Blob; name: string }) => peopleApi.preview(pid, f.blob, f.name),
    onSuccess: (r) => {
      setPreview(r);
      setMe(null);
    },
  });
  const imp = useMutation({
    mutationFn: () => peopleApi.importChat(pid, { file: file!.blob, name: file!.name, tz, me_names: me ? [me] : [] }),
    onSuccess: (r) => {
      haptic();
      say(`lvs import ${file?.name}`, `↳ +${r.added} new · ${r.merged} merged${r.skipped_non_english ? ` · ${r.skipped_non_english} non-English skipped` : ''}`);
      void qc.invalidateQueries({ queryKey: ['units', pid] });
      void qc.invalidateQueries({ queryKey: ['coverage', pid] });
      void qc.invalidateQueries({ queryKey: ['people'] });
      onClose();
    },
  });

  useEffect(() => {
    if (initial) pv.mutate(initial);
    firstRef.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const serverMeErr = imp.error instanceof ApiError && imp.error.field === 'me_names';
  const submit = () => {
    if (!file) return setLocalErr('Choose a chat export file first.');
    if (!me) return setLocalErr('Pick which name is you before importing.');
    setLocalErr(null);
    imp.mutate();
  };

  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="t-imp" data-own-keys>
        <h2 className="ttl" id="t-imp">
          <span className="glyph">┌─[ </span><L t="IMPORT CHAT" p="Import a chat" /><span className="glyph"> ]─┐</span>
        </h2>
        <label className="drop" htmlFor="imp-file">
          <span className="glyph drop-art" aria-hidden="true">{'┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐\n┆  DROP .txt / .zip / .json HERE ┆\n┆  or choose a file to browse    ┆\n└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘'}</span>
          <span className="journal-only drop-j">Choose your .txt, .zip or .json chat export</span>
        </label>
        <input
          ref={firstRef}
          id="imp-file"
          className="file-in"
          type="file"
          accept=".txt,.zip,.json,text/plain,application/json,application/zip"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 50 * 1024 * 1024) return setLocalErr('That file is over 50 MB.');
            const v = { blob: f, name: f.name };
            setFile(v);
            setLocalErr(null);
            pv.mutate(v);
          }}
        />
        {pv.isPending && <Loading what="preview" />}
        <ErrorLine error={pv.error} />
        {preview && file && (
          <>
            <div className="detected">
              <span className="ok">✓</span> <L t="DETECTED" p="Found" /> <span className="c-me">{file.name}</span> · {preview.format} · {fmtN(preview.lines)} lines
            </div>
            <div className="field">
              <label className="lbl" htmlFor="imp-tz"><L t="TIMEZONE" p="Time zone" /></label>
              <span className="glyph">›</span>
              <input id="imp-tz" value={tz} onChange={(e) => setTz(e.target.value)} autoComplete="off" />
            </div>
            <fieldset className="me-pick">
              <legend className="lbl"><L t="WHICH NAME IS YOU?" p="Which name is you?" /></legend>
              {preview.speakers.map((s) => (
                <label key={s} className={`radio${me === s ? ' on' : ''}`}>
                  <input type="radio" name="me-name" value={s} checked={me === s} onChange={() => setMe(s)} />
                  <span className="glyph">{me === s ? '(•)' : '( )'}</span> {s}
                </label>
              ))}
            </fieldset>
            {preview.one_sided && (
              <p>
                <span className="paper">
                  <span className="glyph">[ NOTE ] </span>
                  <L t="this export only contains one side of the chat — signals that need both people will be marked partial." p="This export only has one person's messages, so some results will be partial." />
                </span>
              </p>
            )}
          </>
        )}
        {(localErr || serverMeErr) && (
          <div className="err" role="alert">
            <span className="glyph">[ ERR ] </span>
            {localErr || 'Pick which name is you before importing.'}
          </div>
        )}
        {!serverMeErr && <ErrorLine error={imp.error} />}
        <div className="keys">
          <Key k="ENTER" variant="pri" tech="IMPORT" plain="Import" onClick={submit} disabled={!file || !me || imp.isPending} id="btn-import-go" />
          <Key k="ESC" variant="ghost" tech="CANCEL" plain="Cancel" onClick={onClose} />
        </div>
      </div>
    </>
  );
}
