import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { analysisApi, peopleApi, stepsApi } from '../api/endpoints';
import type { Metric, NextStep, PersonOverview } from '../api/types';
import { Key, Loading, Pane } from '../components/Pane';
import { Radar } from '../components/Radar';
import { SafetyBlockView } from '../components/SafetyBlock';
import { Scope } from '../components/Scope';
import { useShell } from '../components/Shell';
import { say } from '../components/prompt';
import { ago, blocks, hhmm, n as fmtN, ymd } from '../lib/format';
import { haptic } from '../native/native';
import { L, MetricName, Tag } from '../theme/Plain';
import { useTheme } from '../theme/ThemeProvider';
import { useHotkey } from '../lib/hotkeys';
import { headlineText } from '../lib/headline';

export function DashboardScreen() {
  const { pid: p } = useParams();
  const pid = Number(p);
  const { person, analyze } = useShell();
  const q = useQuery({ queryKey: ['overview', pid], queryFn: () => analysisApi.overview(pid), retry: false });

  if (q.isLoading) return <main className="grid"><Loading what="dashboard" /></main>;
  if (q.error instanceof ApiError && q.error.status === 404) {
    return (
      <main className="grid empty-grid">
        <Pane id="empty" tech="NO ANALYSIS YET" plain="Nothing to show yet" className="col-wide">
          <p>
            <L t="// no snapshot for this person. import a chat, then run [R] ANALYZE." p="Import a chat, then press Update to see the first results." />
          </p>
          <div className="keys">
            <Link className="key pri" to={`/p/${pid}/sources`}><span className="key-hint">[ 6 ] </span><L t="IMPORT CHAT" p="Import a chat" /></Link>
            <Key k="R" tech="ANALYZE" plain="Update" onClick={() => void analyze()} />
          </div>
        </Pane>
      </main>
    );
  }
  if (q.error || !q.data) return <main className="grid"><p className="err" role="alert">{(q.error as Error)?.message || 'Could not load the dashboard.'}</p></main>;
  return <Dashboard o={q.data} pid={pid} lastSync={person?.sources} />;
}

function Dashboard({ o, pid, lastSync }: { o: PersonOverview; pid: number; lastSync?: { source: string; last_sync: string | null }[] }) {
  const { journal } = useTheme();
  const subject = o.person.pseudonym;
  const flagged = o.safety.flags.length > 0;
  const allMetrics = useMemo(() => [...o.reciprocity, ...o.metrics, ...o.interaction_metrics], [o]);
  return (
    <>
      {/* §7b: the warning is the first thing after the command bar, above session chips and the ticker */}
      <div className={flagged ? 'safety-top' : 'safety-top compact'}>
        <SafetyBlockView block={o.safety} />
      </div>
      <div className="session">
        <span className="journal-only">
          {subject} · {o.weekly.length} weeks · updated <b>{hhmm(o.generated_at)}</b>
        </span>
        <span className="chip-subj glyph">{subject.toUpperCase()} · {o.mode.toUpperCase()}</span>
        <span className="glyph">WINDOW <b>{o.weekly.length}w</b> · {o.weekly[0]?.week.slice(5) || '--'} → {o.weekly[o.weekly.length - 1]?.week.slice(5) || '--'}</span>
        <span className="glyph">COVERAGE <b>{Math.round(o.coverage_ratio * 100)}%</b></span>
        {!flagged ? (
          <span className="chip-ok"><L t="SAFETY ✓ NO FLAGS" p="✓ No safety concerns" /></span>
        ) : (
          <span className="chip-warn"><L t="SAFETY [ SEE WARNING ]" p="Please read the note above" /></span>
        )}
        {o.scoring && !o.scoring.complete && (
          <span className="glyph dimt" data-testid="scoring-progress" role="status">
            <L t={`SCORING ${o.scoring.scored}/${o.scoring.total}`} p={`Scored ${o.scoring.scored.toLocaleString()} of ${o.scoring.total.toLocaleString()} recent messages so far; the rest are on their way`} />
          </span>
        )}
        {o.skipped_non_english > 0 && (
          <span className="glyph dimt">SKIPPED {o.skipped_non_english} NON-ENGLISH</span>
        )}
      </div>
      <Ticker o={o} />
      <main className="grid" id="dashboard">
        <Pane id="radar" tech="RECIPROCITY RADAR" plain="How balanced it feels" className="radar-pane" meta={<span className="glyph">§2 · {o.reciprocity.length} SPOKES · {o.weekly.length}W</span>}>
          <div className="rd-top">
            <span>
              <L t={<>SUBJECT <b>{subject.toUpperCase()}</b> · Σ = ME + THEM PER SPOKE</>} p={`Each spoke adds what you put in and what ${subject} puts in`} />
            </span>
            <span className="legend">
              <span className="c-me">━━ <L t="ME" p="You" /></span>
              <span className="c-th">━━ <L t="THEM" p={subject} /></span>
              <span className="c-ln">━━ <L t="Σ RESULTANT" p="Together" /></span>
            </span>
          </div>
          <Radar metrics={o.reciprocity} success={o.success} subject={subject} />
        </Pane>

        <aside className="col-right" aria-label="Calibration and contributors">
          <Calibrated o={o} />
          <Contributors o={o} metrics={allMetrics} />
          <Coverage o={o} pid={pid} lastSync={lastSync} />
        </aside>

        <NextSteps pid={pid} steps={o.next_steps} />

        <div className="bottom">
          <Pane id="scope" tech="MESSAGES / WEEK" plain="Messages each week" meta={<span className="glyph">CH1 ME · CH2 THEM · <Tag code="DESC" /></span>}>
            <Scope weekly={o.weekly} />
          </Pane>
          <Pane id="sig" tech="SIGNALS" plain="The details" meta={<span className="glyph">{allMetrics.length} METRICS · EVIDENCE-TAGGED</span>}>
            <Signals o={o} subject={subject} />
            <div className="legend-tags glyph">
              <span><Tag code="MOD" /> model</span>
              <span><Tag code="HEUR" /> heuristic</span>
              <span><Tag code="DESC" /> descriptive count</span>
              <span><Tag code="SELF" /> self-reported</span>
              <span><Tag code="UNCAL" /> uncalibrated</span>
            </div>
          </Pane>
          {o.scales.length > 0 && (
            <Pane id="scales" tech="QUESTIONNAIRES" plain="Your check-in results">
              <ul className="scale-list">
                {o.scales.map((s) => (
                  <li key={s.scale_id}>
                    <b>{s.name}</b> <span className="dimt">[{s.status.toUpperCase()}]</span>
                    {Object.entries(s.subscales).map(([k, v]) => (
                      <span key={k} className="mono"> · {k} {v ?? '--'}{s.bands[k] ? ` (${s.bands[k]})` : ''}</span>
                    ))}
                  </li>
                ))}
              </ul>
              {!journal && <p className="dimt mono">// scale results only feed reflection; they are not a diagnosis.</p>}
            </Pane>
          )}
        </div>
      </main>
    </>
  );
}

function Ticker({ o }: { o: PersonOverview }) {
  const [paused, setPaused] = useState(false);
  useHotkey('p', () => setPaused((v) => !v));
  const t = hhmm(o.generated_at);
  const items: [string, string][] = [
    [t, `analysis snapshot · ${headlineText(o.success) ?? 'insufficient data'}`],
    ...o.reciprocity
      .filter((m) => m.status === 'ok')
      .map((m): [string, string] => [t, `${m.label} ${m.per_speaker ? `me ${fmtVal(m.per_speaker.me)} · them ${fmtVal(m.per_speaker.them)}` : fmtVal(m.value)}`]),
    ...o.weekly.filter((w) => !w.covered).slice(0, 1).map((w): [string, string] => [w.week.slice(5), 'coverage gap']),
  ];
  const run = items.map(([time, text], i) => (
    <span key={i}>
      <i>{time}</i> {text}
    </span>
  ));
  return (
    <div className={`ticker glyph${paused ? ' paused' : ''}`}>
      <span className="tk-lbl">
        <span className="hide-sm">TELEMETRY </span>
        <span className="c-me">● LIVE</span> {t}
      </span>
      <div className="tk-view" aria-label="Telemetry log">
        <div className="tk-track">
          <div className="tk-run">{run}</div>
          <div className="tk-run" aria-hidden="true">{run}</div>
        </div>
      </div>
      <button className="key ghost" type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>
        <span className="key-hint">[ P ] </span>
        <L t={paused ? 'RESUME' : 'PAUSE'} p={paused ? 'Resume' : 'Pause'} />
      </button>
    </div>
  );
}

function fmtVal(v: number | null): string {
  if (v == null) return '--';
  if (Math.abs(v) <= 1) return v.toFixed(2).replace(/^0/, '');
  return String(Math.round(v * 10) / 10);
}

function Calibrated({ o }: { o: PersonOverview }) {
  const c = o.success.calibrated;
  const need = Math.max(0, c.needed - c.n_outcomes);
  return (
    <Pane id="cal" tech="CALIBRATED" plain="Confident estimate" meta={c.status === 'ok' ? <L t="FITTED" p="Ready" /> : <L t="LOCKED" p="Not ready yet" />}>
      <div className="cal" data-testid="calibrated">
        {c.status === 'ok' && c.percent != null ? (
          <>
            <div className="cal-row">
              <span className="cal-big">{Math.round(c.percent)}%</span>
              <span className="cal-na">CI {c.low}–{c.high}</span>
            </div>
            <p><L t={`fitted on ${c.n_outcomes} labelled outcomes`} p={`Checked against ${c.n_outcomes} known outcomes`} /></p>
          </>
        ) : (
          <>
            <div className="cal-row">
              <span className="cal-big" aria-hidden="true">--%</span>
              <span className="cal-na"><L t="NOT AVAILABLE" p="Not ready yet" /></span>
            </div>
            <p>
              <L t={`needs ${need} more labelled outcomes`} p={`Needs ${need} more known outcomes before it can check itself`} />
            </p>
            <div className="cal-prog">
              <span><b>{c.n_outcomes}</b>/{c.needed}</span>
              <span className="blk" aria-hidden="true">{blocks(c.n_outcomes / (c.needed || 20), 20, '█', '░')}</span>
            </div>
            {o.success.percent != null && (
              <p className="cmt">
                <L t={`# until then, read ${headlineText(o.success)} as a rough lean, not odds.`} p={`Until then, treat ${headlineText(o.success, true)} as a rough lean, not odds.`} />
              </p>
            )}
          </>
        )}
      </div>
    </Pane>
  );
}

function Contributors({ o, metrics }: { o: PersonOverview; metrics: Metric[] }) {
  const rows = o.success.top_contributors;
  const byId = new Map(metrics.map((m) => [m.id, m]));
  const total = rows.reduce((s, [, v]) => s + v, 0);
  return (
    <Pane id="contrib" tech="TOP CONTRIBUTORS" plain="What moves the number" meta={<Tag code="UNCAL" />}>
      {rows.length === 0 ? (
        <p className="dimt"><L t="// no contributors until the core signals have enough data" p="Nothing yet: the main signals need more data." /></p>
      ) : (
        <div className="contrib" role="list">
          {rows.map(([id, v]) => {
            const m = byId.get(id);
            const bar = '█'.repeat(Math.min(9, Math.max(1, Math.round(Math.abs(v)))));
            return (
              <div className="crow" role="listitem" key={id}>
                <span className="cname">{m ? <MetricName m={m} /> : id}</span>
                <span className="cneg">{v < 0 && <span className="bar neg" aria-hidden="true">{bar.replace(/█/g, '▓')}</span>}</span>
                <span className="caxis" aria-hidden="true">│</span>
                <span className="cpos">{v > 0 && <span className="bar pos" aria-hidden="true">{bar}</span>}</span>
                <span className={`cval ${v >= 0 ? 'c-me' : 'neg'}`}>{v > 0 ? '+' : '−'}{Math.abs(v)}pp</span>
              </div>
            );
          })}
        </div>
      )}
      {o.success.percent != null && (
        <div className="sum-line">
          <L
            t={<>TOP {rows.length} · {rows.map(([, v]) => (v > 0 ? `+${v}` : `−${Math.abs(v)}`)).join(' ')} = <b>{total > 0 ? '+' : ''}{total}pp</b> · HEADLINE <b className="c-me">{headlineText(o.success)}</b></>}
            p={`These ${rows.length} signals move the estimate by ${total > 0 ? '+' : ''}${total} points. Estimate: ${headlineText(o.success, true)}`}
          />
        </div>
      )}
    </Pane>
  );
}

function Coverage({ o, pid, lastSync }: { o: PersonOverview; pid: number; lastSync?: { source: string; last_sync: string | null }[] }) {
  const units = useQuery({ queryKey: ['units', pid], queryFn: () => peopleApi.units(pid) });
  const bySrc = new Map<string, { n: number; start: string | null; end: string | null }>();
  units.data?.forEach((u) => {
    const cur = bySrc.get(u.source) || { n: 0, start: null, end: null };
    cur.n += u.message_count;
    if (u.start_ts && (!cur.start || u.start_ts < cur.start)) cur.start = u.start_ts;
    if (u.end_ts && (!cur.end || u.end_ts > cur.end)) cur.end = u.end_ts;
    bySrc.set(u.source, cur);
  });
  const gaps = o.weekly.map((w, i) => (w.covered ? null : i + 1)).filter((x): x is number => x != null);
  const span = (a: string | null, b: string | null) => {
    if (!a || !b) return '—';
    const w = Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / (7 * 86400000)));
    return `${w}w`;
  };
  const sync = (src: string) => lastSync?.find((s) => s.source === src)?.last_sync;
  return (
    <Pane id="cov" tech="COVERAGE" plain="Where the data comes from" meta={`${Math.round(o.coverage_ratio * 100)}%`}>
      <div className="cov">
        <span className="h"><L t="SRC" p="Source" /></span>
        <span className="h n"><L t="N" p="Messages" /></span>
        <span className="h"><L t="SPAN" p="Period" /></span>
        <span className="h"><L t="SYNC" p="Synced" /></span>
        {[...bySrc.entries()].map(([src, v]) => (
          <CovRow key={src} cells={[src, fmtN(v.n), span(v.start, v.end), sync(src) ? `● ${ago(sync(src)!)}` : 'upload']} />
        ))}
        <span>hangouts</span>
        <span className="n">{o.interaction_metrics.find((m) => m.id === 'meetups_per_month')?.band.match(/n=(\d+)/)?.[1] ?? '0'}</span>
        <span><L t="logged" p="logged by you" /></span>
        <span><Tag code="SELF" /></span>
        {gaps.length > 0 && (
          <>
            <span className="dimt"><L t="gap" p="missing" /></span>
            <span className="n dimt">{gaps.length}w</span>
            <span className="dimt">w{gaps[0]}{gaps.length > 1 ? `–w${gaps[gaps.length - 1]}` : ''}</span>
            <span className="dimt glyph">╱╱╱</span>
          </>
        )}
      </div>
    </Pane>
  );
}

function CovRow({ cells }: { cells: string[] }) {
  return (
    <>
      <span>{cells[0]}</span>
      <span className="n">{cells[1]}</span>
      <span>{cells[2]}</span>
      <span>{cells[3].startsWith('●') ? <><i className="dot">●</i>{cells[3].slice(1)}</> : cells[3]}</span>
    </>
  );
}

const KIND_PLAIN: Record<NextStep['kind'], string> = { talk: 'Talk', plan: 'Plan', reflect: 'Reflect', pause: 'Pause' };

function NextSteps({ pid, steps }: { pid: number; steps: NextStep[] }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [local, setLocal] = useState<Record<number, NextStep['status']>>({});
  const set = useMutation({
    mutationFn: ({ id, status }: { id: number; status: NextStep['status'] }) => stepsApi.setStatus(id, status),
    // the card keeps its local state (so Undo works); the list refreshes on the next snapshot
    onError: () => qc.invalidateQueries({ queryKey: ['overview', pid] }),
  });
  const gen = useMutation({ mutationFn: () => stepsApi.generate(pid) });

  const act = (s: NextStep, a: 'discuss' | 'done' | 'dismiss' | 'undo') => {
    const cur = local[s.id] ?? s.status;
    if (a === 'discuss') {
      haptic();
      say(`lvs chat --context next_step:${s.id}`, '↳ opening chat with this step');
      if (s.kind === 'reflect' && /log|hangout/i.test(s.title)) nav(`/p/${pid}/chat`, { state: { checkin: true } });
      else nav(`/p/${pid}/chat`, { state: { prefill: `Let's talk about this next step: "${s.title}". ${s.why}` } });
      return;
    }
    const status: NextStep['status'] = a === 'done' ? (cur === 'done' ? 'open' : 'done') : a === 'dismiss' ? 'dismissed' : 'open';
    setLocal((l) => ({ ...l, [s.id]: status }));
    say(`lvs step ${status === 'open' ? 'reopen' : status} ${s.id}`, status === 'dismissed' ? '↳ dismissed · [U] to undo' : `↳ ${status}`);
    set.mutate({ id: s.id, status });
  };

  return (
    <Pane id="next" tech="NEXT STEPS" plain="Ideas to try" className="col-left" meta={<L t={`${steps.length} OPEN`} p={`${steps.length} ideas`} />}>
      <div className="ns-list">
        {steps.length === 0 && <p className="dimt"><L t="// no open steps" p="No ideas right now." /></p>}
        {steps.map((s, i) => {
          const st = local[s.id] ?? s.status;
          const kind = s.kind.toUpperCase();
          return (
            <article
              key={s.id}
              className={`card${st === 'done' ? ' is-done' : ''}${st === 'dismissed' ? ' is-dismissed' : ''}`}
              tabIndex={0}
              aria-labelledby={`ns${s.id}-t`}
              data-own-keys
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget && e.key !== 'd' && e.key !== 'x' && e.key !== 'u') return;
                const k = e.key.toLowerCase();
                if (k === 'enter' && e.target === e.currentTarget) { e.preventDefault(); act(s, 'discuss'); }
                else if (k === 'd') { e.preventDefault(); act(s, 'done'); }
                else if (k === 'x') { e.preventDefault(); act(s, st === 'dismissed' ? 'undo' : 'dismiss'); }
                else if (k === 'u') { e.preventDefault(); act(s, 'undo'); }
              }}
            >
              <div className="card-body">
                <div className="card-h">
                  <span className="kind"><L t={`[${kind}]`} p={KIND_PLAIN[s.kind]} /></span>
                  <span className="card-id glyph">#{String(i + 1).padStart(2, '0')}{i === 0 ? ' · PRIORITY ▲' : ''}</span>
                </div>
                <h3 id={`ns${s.id}-t`} className="card-t">{s.title}</h3>
                <p className="why"><span className="k"><L t="why" p="Why:" /></span>{s.why}</p>
                {s.evidence_refs.length > 0 && (
                  <p className="refs glyph">
                    <span className="k">refs</span>
                    {s.evidence_refs.map((r) => (
                      <span key={r} className="ref">{r}</span>
                    ))}
                  </p>
                )}
                <div className="keys">
                  <Key k="ENTER" variant="pri" tech={s.kind === 'reflect' && /log/i.test(s.title) ? 'LOG IT' : 'DISCUSS'} plain={s.kind === 'reflect' && /log/i.test(s.title) ? 'Log it' : 'Discuss'} onClick={() => act(s, 'discuss')} />
                  <Key k="D" tech={st === 'done' ? 'UNDO' : 'DONE'} plain={st === 'done' ? 'Undo' : 'Done'} pressed={st === 'done'} onClick={() => act(s, 'done')} />
                  <Key k="X" variant="ghost" tech="DISMISS" plain="Dismiss" onClick={() => act(s, 'dismiss')} />
                </div>
              </div>
              {st === 'dismissed' && (
                <div className="dismissed">
                  <span className="glyph">── </span>
                  <L t={`[${kind}] dismissed`} p={`${KIND_PLAIN[s.kind]} dismissed`} />{' '}
                  <Key k="U" variant="ghost" tech="UNDO" plain="Undo" onClick={() => act(s, 'undo')} />
                </div>
              )}
            </article>
          );
        })}
      </div>
      <div className="ns-foot">
        <span className="key-hint">FOCUS A STEP · [ENTER] DISCUSS · [D] DONE · [X] DISMISS · </span>
        <button className="linkish" type="button" disabled={gen.isPending} onClick={() => { gen.mutate(); say('lvs steps --generate', '↳ asking for fresh ideas …'); }}>
          <L t={gen.isPending ? 'GENERATING …' : 'GENERATE MORE'} p={gen.isPending ? 'Thinking…' : 'More ideas'} />
        </button>
      </div>
    </Pane>
  );
}

function metricValue(m: Metric): string {
  if (m.status !== 'ok') return 'insufficient data';
  if (m.per_speaker) {
    const { me, them } = m.per_speaker;
    const shares = me <= 1 && them <= 1 && Math.abs(me + them - 1) < 0.02;
    if (shares) return `me ${Math.round(me * 100)} / them ${Math.round(them * 100)}`;
    return `me ${fmtVal(me)} / them ${fmtVal(them)}`;
  }
  return fmtVal(m.value);
}

function Signals({ o, subject }: { o: PersonOverview; subject: string }) {
  const groups: [string, string, Metric[]][] = [
    ['RECIPROCITY', 'Give and take', o.reciprocity],
    ['OTHER SIGNALS', 'Other patterns', o.metrics],
    ['IN PERSON · LOGGED HANGOUTS ONLY', 'In person (only hangouts you logged)', o.interaction_metrics],
  ];
  return (
    <table className="sig">
      <thead>
        <tr>
          <th scope="col"><L t="METRIC" p="What" /></th>
          <th scope="col"><L t="VALUE" p={`You / ${subject}`} /></th>
          <th scope="col"><L t="EVIDENCE" p="How sure" /></th>
          <th scope="col"><L t="BAND" p="Typical range" /></th>
          <th scope="col"><L t="CAN'T TELL YOU" p="What it can't tell you" /></th>
        </tr>
      </thead>
      {groups.filter(([, , ms]) => ms.length).map(([t, p, ms]) => (
        <tbody key={t}>
          <tr className="grp"><th colSpan={5} scope="colgroup"><L t={t} p={p} /></th></tr>
          {ms.map((m) => {
            const v = metricValue(m);
            const shares = m.per_speaker && m.status === 'ok' && m.per_speaker.me <= 1 && m.per_speaker.them <= 1 && Math.abs(m.per_speaker.me + m.per_speaker.them - 1) < 0.02;
            return (
              <tr key={m.id} id={`metric-${m.id}`}>
                <td className="m"><MetricName m={m} /></td>
                <td data-k="VALUE">
                  {v}
                  {shares && (
                    <span className="ab" aria-hidden="true">
                      <span className="a">{'█'.repeat(Math.round(m.per_speaker!.me * 10))}</span>
                      <span className="b">{'█'.repeat(Math.round(m.per_speaker!.them * 10))}</span>
                    </span>
                  )}
                </td>
                <td data-k="EVIDENCE"><Tag evidence={m.evidence} /></td>
                <td data-k="BAND" className={m.band === 'no reference band' ? 'nb' : ''}>{m.band || 'no reference band'}</td>
                <td data-k="CAN'T TELL" className="cant">{m.note || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      ))}
      <caption className="sr">Signals for {subject}, generated {ymd(o.generated_at)}</caption>
    </table>
  );
}
