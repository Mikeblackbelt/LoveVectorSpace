import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { contextApi } from '../api/endpoints';
import type { Fact, Interaction } from '../api/types';
import { ErrorLine, Key, Loading, Pane } from '../components/Pane';
import { say } from '../components/prompt';
import { ymd } from '../lib/format';
import { L } from '../theme/Plain';

export function ContextScreen() {
  const { pid: p } = useParams();
  const pid = Number(p);
  return (
    <main className="screen two-col">
      <Facts pid={pid} />
      <Interactions pid={pid} />
    </main>
  );
}

function Facts({ pid }: { pid: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['facts', pid], queryFn: () => contextApi.facts(pid) });
  const inval = () => qc.invalidateQueries({ queryKey: ['facts', pid] });
  const patch = useMutation({ mutationFn: (a: { id: number; b: { value?: string; confidence?: Fact['confidence'] } }) => contextApi.patchFact(a.id, a.b), onSuccess: inval });
  const del = useMutation({ mutationFn: (id: number) => contextApi.deleteFact(id), onSuccess: () => { say('lvs facts rm', '↳ deleted'); void inval(); } });
  const add = useMutation({ mutationFn: (b: { key: string; value: string; confidence: Fact['confidence'] }) => contextApi.addFact(pid, b), onSuccess: inval });
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [nk, setNk] = useState('');
  const [nv, setNv] = useState('');
  const [nu, setNu] = useState(false);

  return (
    <Pane id="facts" tech="FACTS" plain="What you've told us" meta={<L t={`${q.data?.length ?? 0} SAVED`} p={`${q.data?.length ?? 0} saved`} />}>
      <p className="dimt small"><span className="glyph">// </span><L t="facts marked unsure are weighted lower and flagged in replies." p="Things you mark as unsure count for less and are flagged in replies." /></p>
      {q.isLoading && <Loading what="facts" />}
      <ErrorLine error={q.error || patch.error || del.error} />
      <ul className="facts">
        {q.data?.map((f) => (
          <li key={f.id} className={`fact${f.confidence === 'owner_unsure' ? ' unsure' : ''}`}>
            <div className="fact-k">{f.key.replace(/_/g, ' ')} <span className="dimt small">{f.source ? `· ${f.source}` : ''}</span></div>
            {editing === f.id ? (
              <form className="field" onSubmit={(e) => { e.preventDefault(); patch.mutate({ id: f.id, b: { value: draft } }); setEditing(null); }}>
                <span className="glyph">›</span>
                <input aria-label={`Edit ${f.key}`} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                <Key type="submit" variant="pri" tech="SAVE" plain="Save" />
                <Key variant="ghost" tech="CANCEL" plain="Cancel" onClick={() => setEditing(null)} />
              </form>
            ) : (
              <div className="fact-v">{f.value}</div>
            )}
            <div className="keys">
              <label className="toggle">
                <input type="checkbox" checked={f.confidence === 'owner_unsure'} onChange={(e) => patch.mutate({ id: f.id, b: { confidence: e.target.checked ? 'owner_unsure' : 'owner_sure' } })} />
                <L t="UNSURE" p="I'm not sure" />
              </label>
              <Key variant="ghost" tech="EDIT" plain="Edit" onClick={() => { setEditing(f.id); setDraft(f.value); }} />
              <Key variant="ghost" tech="DEL" plain="Delete" label={`Delete ${f.key}`} onClick={() => del.mutate(f.id)} />
            </div>
          </li>
        ))}
      </ul>
      <form
        className="add-fact"
        onSubmit={(e) => {
          e.preventDefault();
          if (!nk.trim() || !nv.trim()) return;
          add.mutate({ key: nk.trim().toLowerCase().replace(/\s+/g, '_'), value: nv.trim(), confidence: nu ? 'owner_unsure' : 'owner_sure' });
          setNk(''); setNv(''); setNu(false);
        }}
      >
        <h3 className="lbl"><L t="ADD FACT" p="Add something" /></h3>
        <label className="field"><span className="lbl"><L t="KEY" p="Topic" /></span><input value={nk} onChange={(e) => setNk(e.target.value)} placeholder="e.g. how we met" /></label>
        <label className="field"><span className="lbl"><L t="VALUE" p="Details" /></span><input value={nv} onChange={(e) => setNv(e.target.value)} /></label>
        <label className="toggle"><input type="checkbox" checked={nu} onChange={(e) => setNu(e.target.checked)} /> <L t="UNSURE" p="I'm not sure" /></label>
        <ErrorLine error={add.error} />
        <Key type="submit" variant="pri" tech="ADD" plain="Add" disabled={!nk.trim() || !nv.trim()} />
      </form>
    </Pane>
  );
}

function Interactions({ pid }: { pid: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['interactions', pid], queryFn: () => contextApi.interactions(pid) });
  const inval = () => {
    void qc.invalidateQueries({ queryKey: ['interactions', pid] });
    void qc.invalidateQueries({ queryKey: ['overview', pid] });
  };
  const patch = useMutation({ mutationFn: (a: { id: number; notes: string }) => contextApi.patchInteraction(a.id, { notes: a.notes }), onSuccess: inval });
  const del = useMutation({ mutationFn: (id: number) => contextApi.deleteInteraction(id), onSuccess: inval });
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState<number | null>(null);

  const summary = (it: Interaction) => {
    const f = it.fields;
    return [f.place, f.activity, f.duration_min ? `${f.duration_min} min` : null, `suggested by ${f.initiated_by}`].filter(Boolean).join(' · ');
  };

  return (
    <Pane id="ints" tech="HANGOUTS" plain="Time together" meta={<L t={`${q.data?.length ?? 0} LOGGED`} p={`${q.data?.length ?? 0} logged`} />}>
      <p className="dimt small"><span className="glyph">// </span><L t="log new hangouts from [3] CHAT → LOG A HANGOUT." p="Log new hangouts from the Chat page." /></p>
      {q.isLoading && <Loading what="hangouts" />}
      <ErrorLine error={q.error || patch.error || del.error} />
      <ul className="facts">
        {q.data?.map((it) => (
          <li key={it.id} className="fact">
            <div className="fact-k">{ymd(it.fields.ts)} <span className="dimt small">· {summary(it)}</span></div>
            <div className="mono small">
              <L t={`closeness ${it.fields.closeness_1_7}/7 · comfort ${it.fields.comfort_1_7}/7`} p={`Felt close: ${it.fields.closeness_1_7} of 7 · comfortable: ${it.fields.comfort_1_7} of 7`} />
              {it.fields.responsiveness.length > 0 && <> · {it.fields.responsiveness.join(', ')}</>}
              {it.fields.tension && <> · tension: {it.fields.tension}</>}
            </div>
            {editing === it.id ? (
              <form className="field" onSubmit={(e) => { e.preventDefault(); patch.mutate({ id: it.id, notes: draft }); setEditing(null); }}>
                <span className="glyph">›</span>
                <input aria-label="Edit notes" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                <Key type="submit" variant="pri" tech="SAVE" plain="Save" />
              </form>
            ) : (
              it.notes && <div className="fact-v">{it.notes}</div>
            )}
            <div className="keys">
              <Key variant="ghost" tech="EDIT NOTES" plain="Edit notes" onClick={() => { setEditing(it.id); setDraft(it.notes); }} />
              {confirm === it.id ? (
                <>
                  <Key variant="pri" tech="CONFIRM DELETE" plain="Yes, delete" onClick={() => del.mutate(it.id)} />
                  <Key variant="ghost" tech="KEEP" plain="Keep" onClick={() => setConfirm(null)} />
                </>
              ) : (
                <Key variant="ghost" tech="DEL" plain="Delete" label={`Delete hangout on ${ymd(it.fields.ts)}`} onClick={() => setConfirm(it.id)} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </Pane>
  );
}
