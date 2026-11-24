// Screenshot import: pick chat screenshots -> on-device OCR -> review bubbles -> import.
// Images stay in memory only for the OCR call; only reviewed text is uploaded.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { peopleApi } from '../../api/endpoints';
import { ErrorLine, Key } from '../../components/Pane';
import { say } from '../../components/prompt';
import { timezoneGuess } from '../../lib/format';
import { haptic } from '../../native/native';
import { L } from '../../theme/Plain';
import { importMessages } from './api';
import { useCaptureCaps } from './hooks';
import { recognizeScreenshot } from './ocr';
import { buildScreenshotBody, parseScreens, reviewReducer } from './review';
import { APP_PROFILES, type ProfileId } from './segment';
import { ymdOf } from './separators';
import type { OcrImage, Ymd } from './types';
import './capture.css';

const pad = (n: number) => String(n).padStart(2, '0');
const ymdStr = (d: Ymd) => `${d.y}-${pad(d.m)}-${pad(d.d)}`;
function parseYmd(s: string): Ymd | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/** Button for the Sources page; renders nothing where on-device OCR isn't available (web). */
export function ScreenshotImportKey({ pid }: { pid: number }) {
  const { caps } = useCaptureCaps();
  const [open, setOpen] = useState(false);
  if (!caps.screenshot) return null;
  return (
    <>
      <Key tech="IMPORT SCREENSHOTS" plain="Import screenshots" onClick={() => setOpen(true)} id="btn-shots-open" />
      {open && <ScreenshotImportDialog pid={pid} onClose={() => setOpen(false)} />}
    </>
  );
}

type Step = 'pick' | 'reading' | 'review';

export function ScreenshotImportDialog({ pid: initialPid, onClose }: { pid: number; onClose: () => void }) {
  const qc = useQueryClient();
  const people = useQuery({ queryKey: ['people'], queryFn: peopleApi.list });
  const [step, setStep] = useState<Step>('pick');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [images, setImages] = useState<OcrImage[]>([]);
  const [refNow, setRefNow] = useState(() => new Date());
  const [pid, setPid] = useState(initialPid);
  const [profile, setProfile] = useState<ProfileId>('generic');
  const [tz, setTz] = useState(timezoneGuess());
  const [fallback, setFallback] = useState<Ymd>(() => ymdOf(new Date()));
  const [bubbles, dispatch] = useReducer(reviewReducer, []);
  const [gaps, setGaps] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    fileRef.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  // (Re)parse whenever the OCR results or the parse settings change. Resets edits.
  useEffect(() => {
    if (!images.length) return;
    const r = parseScreens(images, { now: refNow, profile, fallbackDate: fallback });
    dispatch({ type: 'load', bubbles: r.bubbles });
    setGaps(r.gaps);
  }, [images, refNow, profile, fallback]);

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(f.name));
    if (!files.length) return;
    // Screenshots are usually taken top-to-bottom while scrolling; dedupe copes with other orders.
    files.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name));
    const newest = Math.max(...files.map((f) => f.lastModified || 0));
    const ref = newest > 0 ? new Date(newest) : new Date();
    setErr(null);
    setStep('reading');
    setProgress({ done: 0, total: files.length });
    const out: OcrImage[] = [];
    try {
      for (const f of files) {
        out.push(await recognizeScreenshot(f));
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    } catch {
      setErr('Could not read text from one of the screenshots. Try again, or pick clearer screenshots.');
      setStep('pick');
      return;
    }
    if (fileRef.current) fileRef.current.value = '';
    if (!out.some((o) => o.lines.length)) {
      setErr('No text found in those screenshots.');
      setStep('pick');
      return;
    }
    setRefNow(ref);
    setFallback(ymdOf(ref));
    setImages(out);
    setStep('review');
  };

  const body = useMemo(() => buildScreenshotBody(bubbles, tz), [bubbles, tz]);
  const imp = useMutation({
    mutationFn: () => importMessages(pid, body),
    onSuccess: (r) => {
      haptic();
      say('lvs import screenshots', `↳ +${r.added} new · ${r.merged} merged${r.one_sided ? ' · one-sided' : ''}`);
      void qc.invalidateQueries({ queryKey: ['units', pid] });
      void qc.invalidateQueries({ queryKey: ['coverage', pid] });
      void qc.invalidateQueries({ queryKey: ['people'] });
      void qc.invalidateQueries({ queryKey: ['overview', pid] });
      onClose();
    },
  });

  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div className="modal cap-modal" role="dialog" aria-modal="true" aria-labelledby="t-shots" data-own-keys>
        <h2 className="ttl" id="t-shots">
          <span className="glyph">┌─[ </span><L t="IMPORT SCREENSHOTS" p="Import chat screenshots" /><span className="glyph"> ]─┐</span>
        </h2>

        {step !== 'review' && (
          <>
            <p className="dimt small">
              Pick screenshots of one chat, oldest first if you can. Text is read on this phone; the images are never uploaded.
            </p>
            <label className="key pri cap-pick" htmlFor="shots-file">
              <L t="CHOOSE SCREENSHOTS" p="Choose screenshots" />
            </label>
            <input
              ref={fileRef}
              id="shots-file"
              className="file-in"
              type="file"
              accept="image/*"
              multiple
              disabled={step === 'reading'}
              onChange={(e) => void onFiles(e.target.files)}
            />
            {step === 'reading' && (
              <p role="status" className="dimt">
                <L t={`reading ${progress.done}/${progress.total} …`} p={`Reading screenshot ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`} />
              </p>
            )}
            {err && <p className="err" role="alert">{err}</p>}
            <div className="keys">
              <Key variant="ghost" tech="CANCEL" plain="Cancel" onClick={onClose} />
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <div className="cap-settings">
              <div className="field">
                <label className="lbl" htmlFor="shots-person"><L t="PERSON" p="Who is this with?" /></label>
                <select id="shots-person" value={pid} onChange={(e) => setPid(Number(e.target.value))}>
                  {!people.data?.some((p) => p.id === pid) && <option value={pid}>#{pid}</option>}
                  {people.data?.map((p) => <option key={p.id} value={p.id}>{p.pseudonym}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="lbl" htmlFor="shots-app"><L t="APP" p="App" /></label>
                <select id="shots-app" value={profile} onChange={(e) => setProfile(e.target.value as ProfileId)}>
                  {(Object.keys(APP_PROFILES) as ProfileId[]).map((k) => <option key={k} value={k}>{APP_PROFILES[k].label}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="lbl" htmlFor="shots-tz"><L t="TIMEZONE" p="Time zone" /></label>
                <input id="shots-tz" value={tz} onChange={(e) => setTz(e.target.value)} />
              </div>
              <div className="field">
                <label className="lbl" htmlFor="shots-date"><L t="UNDATED = " p="Date for undated messages" /></label>
                <input
                  id="shots-date"
                  type="date"
                  value={ymdStr(fallback)}
                  onChange={(e) => {
                    const d = parseYmd(e.target.value);
                    if (d) setFallback(d);
                  }}
                />
              </div>
              <p className="dimt small">Changing the app or date reads the screenshots again and resets your edits. Times are approximate.</p>
            </div>
            {gaps.length > 0 && (
              <p className="paper note" role="status">
                Screenshot {gaps.join(', ')} didn't overlap the one before it, so some messages may be missing in between.
              </p>
            )}
            <ol className="cap-review" aria-label="Messages found">
              {bubbles.map((b) => (
                <li key={b.id} className={`cap-bubble ${b.role}${b.dropped ? ' dropped' : ''}`}>
                  <button
                    type="button"
                    className={`key cap-side ${b.role === 'me' ? 'c-me' : 'c-th'}`}
                    onClick={() => dispatch({ type: 'flip', id: b.id })}
                    disabled={b.dropped}
                    aria-label={`Message ${b.id} is from ${b.role === 'me' ? 'you' : 'them'}; switch side`}
                  >
                    {b.role === 'me' ? <L t="ME" p="You" /> : <L t="THEM" p="Them" />}
                  </button>
                  <textarea
                    className="cap-text"
                    aria-label={`Message ${b.id} text`}
                    value={b.text}
                    rows={Math.min(5, Math.max(1, Math.ceil(b.text.length / 34)))}
                    disabled={b.dropped}
                    onChange={(e) => dispatch({ type: 'edit', id: b.id, text: e.target.value })}
                  />
                  <span className="cap-meta dimt small">{b.ts_local.replace('T', ' ').slice(0, 16)}</span>
                  <button
                    type="button"
                    className="key ghost cap-drop"
                    onClick={() => dispatch({ type: b.dropped ? 'restore' : 'drop', id: b.id })}
                    aria-label={b.dropped ? `Keep message ${b.id}` : `Drop message ${b.id}`}
                  >
                    {b.dropped ? <L t="KEEP" p="Keep" /> : <L t="DROP" p="Drop" />}
                  </button>
                </li>
              ))}
            </ol>
            <ErrorLine error={imp.error} />
            <div className="keys">
              <Key
                variant="pri"
                tech={`IMPORT ${body.messages.length}`}
                plain={`Import ${body.messages.length} messages`}
                onClick={() => imp.mutate()}
                disabled={!body.messages.length || imp.isPending || !tz.trim()}
                id="btn-shots-import"
              />
              <Key variant="ghost" tech="CANCEL" plain="Cancel" onClick={onClose} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
