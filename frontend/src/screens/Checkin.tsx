import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { contextApi } from '../api/endpoints';
import type { InteractionFields } from '../api/types';
import { ErrorLine, Key } from '../components/Pane';
import { say } from '../components/prompt';
import { blocks } from '../lib/format';
import { haptic } from '../native/native';
import { L } from '../theme/Plain';

type Step =
  | { id: string; q: string; kind: 'when' }
  | { id: string; q: string; kind: 'choice'; field: keyof InteractionFields; options: [string, string][] }
  | { id: string; q: string; kind: 'scale'; field: 'closeness_1_7' | 'comfort_1_7'; ends: [string, string] }
  | { id: string; q: string; kind: 'multi'; options: string[] }
  | { id: string; q: string; kind: 'text'; field: 'activity' | 'tension' | 'affection' | 'notes'; placeholder: string };

const STEPS: Step[] = [
  { id: 'when', q: 'When and where did you meet, and for how long?', kind: 'when' },
  { id: 'who', q: 'Who suggested it?', kind: 'choice', field: 'initiated_by', options: [['me', 'Me'], ['them', 'Them'], ['mutual', 'Both of us']] },
  { id: 'what', q: 'What did you do?', kind: 'text', field: 'activity', placeholder: 'e.g. dinner, a walk' },
  { id: 'close', q: 'How close did it feel?', kind: 'scale', field: 'closeness_1_7', ends: ['1 distant', '7 very close'] },
  { id: 'comfort', q: 'How comfortable did it feel?', kind: 'scale', field: 'comfort_1_7', ends: ['1 tense', '7 at ease'] },
  { id: 'resp', q: 'Did any of these happen?', kind: 'multi', options: ['asked about me', 'remembered details', 'shared something personal'] },
  { id: 'tension', q: 'Was there any tension, and how did it resolve?', kind: 'text', field: 'tension', placeholder: 'optional' },
  { id: 'affection', q: 'Any affection cues? (optional, skip freely)', kind: 'text', field: 'affection', placeholder: 'optional' },
  { id: 'next', q: 'Was a next meeting proposed?', kind: 'choice', field: 'next_plan_proposed_by', options: [['me', 'Yes, by me'], ['them', 'Yes, by them'], ['none', 'No']] },
  { id: 'prev', q: 'Did the last plan you made actually happen?', kind: 'choice', field: 'followed_through_prev', options: [['true', 'Yes'], ['false', 'No'], ['null', 'No earlier plan']] },
  { id: 'notes', q: 'Anything else worth remembering?', kind: 'text', field: 'notes', placeholder: 'optional notes' },
];

/** Guided "Log a hangout" check-in: one question at a time, every question skippable. */
export function HangoutCheckin({ pid, name, onClose }: { pid: number; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [i, setI] = useState(0);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [place, setPlace] = useState('');
  const [dur, setDur] = useState('');
  const [vals, setVals] = useState<Record<string, string | number | boolean | null>>({});
  const [resp, setResp] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const step = STEPS[i];

  const save = useMutation({
    mutationFn: () => {
      const fields: InteractionFields = {
        ts: new Date(date).toISOString(),
        place: place || null,
        duration_min: dur ? Number(dur) : null,
        initiated_by: (vals.initiated_by as InteractionFields['initiated_by']) || 'mutual',
        activity: (vals.activity as string) || null,
        closeness_1_7: (vals.closeness_1_7 as number) || 4,
        comfort_1_7: (vals.comfort_1_7 as number) || 4,
        responsiveness: resp,
        tension: (vals.tension as string) || null,
        affection: (vals.affection as string) || null,
        next_plan_proposed_by: (vals.next_plan_proposed_by as InteractionFields['next_plan_proposed_by']) || 'none',
        followed_through_prev: vals.followed_through_prev === undefined ? null : (vals.followed_through_prev as boolean | null),
      };
      return contextApi.addInteraction(pid, fields, (vals.notes as string) || '');
    },
    onSuccess: () => {
      haptic();
      setSaved(true);
      say('lvs hangout log', '↳ hangout saved · signals update shortly');
      void qc.invalidateQueries({ queryKey: ['interactions', pid] });
      void qc.invalidateQueries({ queryKey: ['overview', pid] });
    },
  });

  const next = () => (i < STEPS.length - 1 ? setI(i + 1) : save.mutate());
  const set = (k: string, v: string | number | boolean | null) => setVals((o) => ({ ...o, [k]: v }));

  if (saved) {
    return (
      <div className="chk" role="status">
        <span className="t"><span className="glyph">┌─[ </span><L t="LOG A HANGOUT · SAVED" p="Hangout saved" /><span className="glyph"> ]─┐</span></span>
        <p className="ok"><L t="> saved to context. edit or delete it any time in [4] CONTEXT." p={`Saved. You can edit or delete it any time on the Context page.`} /></p>
        <Key tech="CLOSE" plain="Close" onClick={onClose} />
      </div>
    );
  }

  return (
    <div
      className="chk"
      role="group"
      aria-labelledby="chk-q"
      data-own-keys
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          next();
          return;
        }
        if (step.kind === 'scale' && /^[1-7]$/.test(e.key) && (e.target as HTMLElement).tagName !== 'INPUT') {
          set(step.field, Number(e.key));
          e.preventDefault();
        }
      }}
    >
      <span className="t"><span className="glyph">┌─[ </span><L t={`LOG A HANGOUT · ${name.toUpperCase()}`} p={`Log a hangout with ${name}`} /><span className="glyph"> ]─┐</span></span>
      <div className="step">
        <L t={`question ${i + 1} of ${STEPS.length}`} p={`Question ${i + 1} of ${STEPS.length}`} /> ·{' '}
        <span className="glyph c-me">{blocks((i + 1) / STEPS.length, 11)}</span>
        <span className="pbar" aria-hidden="true"><b style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} /></span>
      </div>
      <p className="q" id="chk-q"><span className="glyph">lvs › </span>{step.q}</p>
      {step.kind === 'when' && (
        <div className="chk-fields">
          <label className="field"><span className="lbl"><L t="WHEN" p="When" /></span><input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span className="lbl"><L t="WHERE" p="Where" /></span><input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="optional" /></label>
          <label className="field"><span className="lbl"><L t="MINUTES" p="How long (minutes)" /></span><input inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ''))} placeholder="optional" /></label>
        </div>
      )}
      {step.kind === 'choice' && (
        <div className="scale" role="radiogroup" aria-label={step.q}>
          {step.options.map(([v, label]) => {
            const val = v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : v;
            const on = vals[step.field] === val && step.field in vals;
            return (
              <button key={v} type="button" role="radio" aria-checked={on} className={`key${on ? ' pri' : ''}`} onClick={() => set(step.field, val)}>
                {label}
              </button>
            );
          })}
        </div>
      )}
      {step.kind === 'scale' && (
        <>
          <div className="scale" role="radiogroup" aria-label={`${step.q} 1 to 7`}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={vals[step.field] === n} className={`key${vals[step.field] === n ? ' pri' : ''}`} onClick={() => set(step.field, n)}>
                <span className="key-hint">[</span>{n}<span className="key-hint">]</span>
              </button>
            ))}
          </div>
          <div className="ends"><span>{step.ends[0]}</span><span>{step.ends[1]}</span></div>
        </>
      )}
      {step.kind === 'multi' && (
        <div className="scale" role="group" aria-label={step.q}>
          {step.options.map((o) => {
            const on = resp.includes(o);
            return (
              <button key={o} type="button" aria-pressed={on} className={`key${on ? ' pri' : ''}`} onClick={() => setResp(on ? resp.filter((x) => x !== o) : [...resp, o])}>
                {o}
              </button>
            );
          })}
        </div>
      )}
      {step.kind === 'text' && (
        <label className="field">
          <span className="glyph">›</span>
          <input aria-label={step.q} value={(vals[step.field] as string) || ''} onChange={(e) => set(step.field, e.target.value)} placeholder={step.placeholder} />
        </label>
      )}
      <ErrorLine error={save.error} />
      <div className="keys">
        {i > 0 && <Key variant="ghost" tech="BACK" plain="Back" onClick={() => setI(i - 1)} />}
        <Key k="S" variant="ghost" tech="SKIP" plain="Skip" onClick={next} />
        <Key k="ENTER" variant="pri" tech={i === STEPS.length - 1 ? 'SAVE' : 'NEXT'} plain={i === STEPS.length - 1 ? 'Save' : 'Next'} onClick={next} disabled={save.isPending} />
        <Key variant="ghost" tech="CANCEL" plain="Cancel" onClick={onClose} />
      </div>
      <div className="chk-note"><span className="glyph">// </span><L t="every question is skippable" p="Every question is optional." /></div>
    </div>
  );
}
