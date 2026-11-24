import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { scalesApi } from '../api/endpoints';
import type { ScaleDef, ScaleItem, ScaleResult } from '../api/types';
import { ErrorLine, Key, Loading, Pane } from '../components/Pane';
import { useShell } from '../components/Shell';
import { say } from '../components/prompt';
import { ymd } from '../lib/format';
import { L } from '../theme/Plain';

/** Item wording; overlay scales ship without text, so show the placeholder (backend display_text rule). */
export function itemText(item: ScaleItem, scale: ScaleDef): string {
  if (item.display_text) return item.display_text;
  if (item.text) return item.text;
  return `${scale.name} item ${scale.items.indexOf(item) + 1} (enter text from the official form)`;
}

export function FormsScreen() {
  const { pid: p } = useParams();
  const pid = Number(p);
  const { person } = useShell();
  const scales = useQuery({ queryKey: ['scales'], queryFn: scalesApi.list });
  const hist = useQuery({ queryKey: ['qhist', pid], queryFn: () => scalesApi.history(pid) });
  const [open, setOpen] = useState<string | null>(null);
  const mode = person?.mode;
  const list = (scales.data || []).filter((s) => !mode || s.mode.includes(mode));
  const other = (scales.data || []).filter((s) => mode && !s.mode.includes(mode));
  const cur = scales.data?.find((s) => s.id === open);

  return (
    <main className="screen two-col">
      <Pane id="forms" tech="QUESTIONNAIRES" plain="Check-ins" meta={<L t={`${list.length} AVAILABLE`} p={`${list.length} available`} />}>
        {scales.isLoading && <Loading what="questionnaires" />}
        <ErrorLine error={scales.error} />
        {cur ? (
          <TakeScale pid={pid} scale={cur} onClose={() => setOpen(null)} />
        ) : (
          <ul className="scale-list">
            {[...list, ...other].map((s) => (
              <li key={s.id} className="scale-row">
                <div>
                  <b>{s.name}</b>{' '}
                  {!s.verified && <span className="tag t-heur"><L t="[UNVERIFIED]" p="not yet checked" /></span>}
                  {s.custom && <span className="tag t-heur"><L t="[CUSTOM]" p="our own questions" /></span>}
                  {s.item_text === 'local_overlay' && <span className="tag t-desc"><L t="[OVERLAY]" p="text from official form" /></span>}
                  <div className="dimt small">{s.measures}{s.does_not_measure ? ` · can't tell you: ${s.does_not_measure}` : ''}</div>
                  <div className="dimt small">{s.items.length} items · {s.source.citation}</div>
                </div>
                <Key variant="pri" tech={hist.data?.some((h) => h.scale_id === s.id) ? 'RETAKE' : 'TAKE'} plain={hist.data?.some((h) => h.scale_id === s.id) ? 'Retake' : 'Start'} onClick={() => setOpen(s.id)} />
              </li>
            ))}
          </ul>
        )}
      </Pane>
      <Pane id="qhist" tech="RESULTS HISTORY" plain="Past results">
        {hist.isLoading && <Loading what="results" />}
        {hist.data?.length === 0 && <p className="dimt"><L t="// no results yet" p="No results yet." /></p>}
        <ul className="facts">
          {hist.data?.map((h, i) => (
            <li key={i} className="fact">
              <div className="fact-k">{scales.data?.find((s) => s.id === h.scale_id)?.name || h.scale_id} <span className="dimt small">· {ymd(h.submitted_at)}</span></div>
              <ResultView r={h.result} />
            </li>
          ))}
        </ul>
      </Pane>
    </main>
  );
}

function ResultView({ r }: { r: ScaleResult }) {
  return (
    <div className="mono small">
      {Object.entries(r.subscales).map(([k, v]) => (
        <span key={k}>
          {k} <b>{v ?? '--'}</b>
          {r.bands[k] ? ` (${r.bands[k]})` : ' (no reference band)'}
          {r.cutoff_flags[k] ? ' · past cut-off' : ''} &nbsp;
        </span>
      ))}
      <span className="dimt">[{r.status.toUpperCase()}]</span>
      {r.notes.map((n) => (
        <div key={n} className="dimt">// {n}</div>
      ))}
    </div>
  );
}

function TakeScale({ pid, scale, onClose }: { pid: number; scale: ScaleDef; onClose: () => void }) {
  const qc = useQueryClient();
  const [ans, setAns] = useState<Record<string, number>>({});
  const submit = useMutation({
    mutationFn: () => scalesApi.submit(pid, scale.id, ans),
    onSuccess: () => {
      say(`lvs forms submit ${scale.id}`, '↳ saved');
      void qc.invalidateQueries({ queryKey: ['qhist', pid] });
      void qc.invalidateQueries({ queryKey: ['overview', pid] });
    },
  });
  const required = scale.items.filter((i) => !i.optional);
  const complete = required.every((i) => ans[i.id] !== undefined);
  if (submit.data) {
    return (
      <div>
        <h3>{scale.name}</h3>
        <ResultView r={submit.data} />
        <p className="dimt small"><L t="// results feed reflection only, never a diagnosis." p="Results are for reflection only, never a diagnosis." /></p>
        <Key tech="DONE" plain="Done" onClick={onClose} />
      </div>
    );
  }
  return (
    <form className="take" onSubmit={(e) => { e.preventDefault(); if (complete) submit.mutate(); }} data-own-keys>
      <h3>{scale.name}</h3>
      <p className="dimt small">{scale.source.citation}{scale.source.terms ? ` · ${scale.source.terms}` : ''}</p>
      {scale.items.map((it, idx) => {
        const lo = it.min ?? scale.response.min;
        const hi = it.max ?? scale.response.max;
        const text = itemText(it, scale);
        return (
          <fieldset key={it.id} className="item">
            <legend>
              <span className="dimt">{String(idx + 1).padStart(2, '0')} </span>
              <span className={it.text ? '' : 'placeholder'}>{text}</span>
              {it.optional && <span className="dimt small"> (optional)</span>}
            </legend>
            <div className="scale" role="radiogroup" aria-label={text}>
              {Array.from({ length: hi - lo + 1 }, (_, k) => lo + k).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={ans[it.id] === v} className={`key${ans[it.id] === v ? ' pri' : ''}`} onClick={() => setAns((a) => ({ ...a, [it.id]: v }))}>
                  {v}
                </button>
              ))}
            </div>
          </fieldset>
        );
      })}
      <ErrorLine error={submit.error} />
      <div className="keys">
        <Key type="submit" k="ENTER" variant="pri" tech="SUBMIT" plain="Save answers" disabled={!complete || submit.isPending} />
        <Key variant="ghost" tech="CANCEL" plain="Cancel" onClick={onClose} />
      </div>
    </form>
  );
}
