import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { agentApi } from '../api/endpoints';
import type { AgentEvent, AgentMessage, AgentThread } from '../api/types';
import { ErrorLine, Key, Loading } from '../components/Pane';
import { useShell } from '../components/Shell';
import { say } from '../components/prompt';
import { hhmm } from '../lib/format';
import { haptic } from '../native/native';
import { L, Tag, type TagCode } from '../theme/Plain';
import { useTheme } from '../theme/ThemeProvider';
import { HangoutCheckin } from './Checkin';
import { useHotkey } from '../lib/hotkeys';

interface ToolChip { name: string; args?: Record<string, unknown>; ok?: boolean; summary?: string }
interface Line { id: string; role: 'user' | 'assistant' | 'error'; text: string; at: string; tools: ToolChip[]; streaming?: boolean }

// api.md leaves the tool_calls element shape open: accept {name,args} and OpenAI-style {function:{name,arguments}}.
function toolName(t: unknown): { name: string; args?: Record<string, unknown> } {
  const o = (t || {}) as { name?: string; args?: Record<string, unknown>; function?: { name?: string; arguments?: string | Record<string, unknown> } };
  if (o.name) return { name: o.name, args: o.args };
  const a = o.function?.arguments;
  let args: Record<string, unknown> | undefined;
  try {
    args = typeof a === 'string' ? JSON.parse(a) : a;
  } catch {
    args = undefined;
  }
  return { name: o.function?.name || 'tool', args };
}

/** Agent text with inline evidence tags ([MOD], [SELF], …) rendered as real tags. */
function TaggedText({ text }: { text: string }) {
  const parts = text.split(/\[(MOD|HEUR|DESC|SELF|UNCAL)\]/);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <Tag key={i} code={p as TagCode} /> : <span key={i}>{p}</span>))}
    </>
  );
}

/** Turn stored thread messages into transcript lines (tool rows fold into the next reply). */
export function toLines(msgs: AgentMessage[]): Line[] {
  const out: Line[] = [];
  let pending: ToolChip[] = [];
  for (const m of msgs) {
    if (m.role === 'tool') {
      (m.tool_calls?.length ? m.tool_calls : [{ name: 'tool' }]).forEach((t) => pending.push({ ...toolName(t), ok: true, summary: m.content.slice(0, 160) }));
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) m.tool_calls.forEach((t) => pending.push({ ...toolName(t), ok: true }));
    if (m.role === 'assistant' && !m.content.trim()) continue;
    out.push({ id: String(m.id), role: m.role, text: m.content, at: m.created_at, tools: m.role === 'assistant' ? pending : [] });
    if (m.role === 'assistant') pending = [];
  }
  return out;
}

function argStr(a?: Record<string, unknown>) {
  if (!a) return '';
  return Object.entries(a).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');
}

function ToolChips({ tools }: { tools: ToolChip[] }) {
  const { journal } = useTheme();
  const [open, setOpen] = useState<number | null>(null);
  if (!tools.length) return null;
  return (
    <div className="tools" data-testid="tool-chips">
      {journal && <div className="tools-sum">looked at {tools.length} thing{tools.length > 1 ? 's' : ''}</div>}
      {tools.map((t, i) => (
        <div key={i}>
          <button className="tool chip" type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            <span className="car glyph">{open === i ? '▾' : '▸'}</span>
            {t.name}({argStr(t.args)}){' '}
            {t.ok === undefined ? <span className="dimt">…</span> : t.ok ? <span className="ok">✓</span> : <span className="c-me">✗</span>}
          </button>
          {open === i && t.summary && <div className="tool-out">{t.summary}</div>}
        </div>
      ))}
    </div>
  );
}

export function ChatScreen() {
  const { pid: p } = useParams();
  const pid = Number(p);
  const { person } = useShell();
  const loc = useLocation() as { state?: { prefill?: string; checkin?: boolean } };
  const qc = useQueryClient();
  const threads = useQuery({ queryKey: ['threads', pid], queryFn: () => agentApi.threads(pid), retry: false });
  const unavailable = threads.error instanceof ApiError && threads.error.code === 'agent_unavailable';
  const [tid, setTid] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState(loc.state?.prefill || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [checkin, setCheckin] = useState(!!loc.state?.checkin);
  const [announce, setAnnounce] = useState('');
  const [railOpen, setRailOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const hydratedFor = useRef<number | null>(null);
  useHotkey('h', () => setCheckin(true), !checkin);

  const activeId = tid ?? threads.data?.[0]?.id ?? null;
  const thread = useQuery({ queryKey: ['thread', activeId], queryFn: () => agentApi.thread(activeId!), enabled: activeId != null });
  useEffect(() => {
    // Never re-hydrate mid-stream, and never let an older server copy (fetched before our message was
    // stored) replace a longer local transcript of the same thread. Switching threads always hydrates.
    if (!thread.data || busyRef.current) return;
    const next = toLines(thread.data.messages);
    const sameThread = hydratedFor.current === thread.data.thread.id;
    hydratedFor.current = thread.data.thread.id;
    setLines((cur) => (!sameThread || next.length >= cur.length ? next : cur));
  }, [thread.data]);
  useEffect(() => {
    if (activeId == null) setLines([]);
  }, [activeId]);
  useEffect(() => {
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight });
  }, [lines, checkin]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const create = useMutation({
    mutationFn: (kind: AgentThread['kind']) => agentApi.createThread(pid, kind),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['threads', pid] });
      setTid(t.id);
    },
  });

  const send = async () => {
    const msg = text.trim();
    if (!msg || busy) return;
    setErr(null);
    setBusy(true);
    busyRef.current = true;
    haptic();
    let id = activeId;
    try {
      if (id == null) {
        const t = await agentApi.createThread(pid, 'chat');
        id = t.id;
        hydratedFor.current = t.id; // the local transcript is authoritative for this new thread
        setTid(t.id);
        void qc.invalidateQueries({ queryKey: ['threads', pid] });
      }
      const now = new Date().toISOString();
      const replyId = 'r' + Date.now();
      setLines((l) => [...l, { id: 'u' + Date.now(), role: 'user', text: msg, at: now, tools: [] }, { id: replyId, role: 'assistant', text: '', at: now, tools: [], streaming: true }]);
      setText('');
      const patch = (f: (x: Line) => Line) => setLines((l) => l.map((x) => (x.id === replyId ? f(x) : x)));
      let full = '';
      abortRef.current = new AbortController();
      await agentApi.send(
        id,
        msg,
        (e: AgentEvent) => {
          if (e.type === 'token') {
            full += e.text;
            patch((x) => ({ ...x, text: x.text + e.text }));
          }
          else if (e.type === 'tool_call') patch((x) => ({ ...x, tools: [...x.tools, { name: e.name, args: e.args }] }));
          else if (e.type === 'tool_result')
            patch((x) => {
              const tools = [...x.tools];
              const i = tools.map((t) => t.name).lastIndexOf(e.name);
              if (i >= 0) tools[i] = { ...tools[i], ok: e.ok, summary: e.summary };
              else tools.push({ name: e.name, ok: e.ok, summary: e.summary });
              return { ...x, tools };
            });
          else if (e.type === 'done') {
            patch((x) => ({ ...x, streaming: false, id: e.message_id != null ? 'm' + e.message_id : x.id }));
            setAnnounce(`Reply: ${full.slice(0, 400)}`);
          }
          else if (e.type === 'error') patch((x) => ({ ...x, streaming: false, role: 'error', text: x.text || e.message }));
        },
        abortRef.current.signal,
      );
      setLines((l) => l.map((x) => (x.streaming ? { ...x, streaming: false } : x)));
      say('lvs chat send', '↳ reply received');
    } catch (e) {
      setErr(e);
      setLines((l) => l.filter((x) => !(x.streaming && !x.text)));
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (id != null) void qc.invalidateQueries({ queryKey: ['thread', id] });
    }
  };

  const sendUnavailable = err instanceof ApiError && err.code === 'agent_unavailable';
  const isUnavailable = unavailable || sendUnavailable;
  const activeThread = threads.data?.find((t) => t.id === activeId);
  const name = person?.pseudonym || 'them';

  return (
    <main className={`screen chat-screen${railOpen ? ' rail-open' : ''}`}>
      <section className="pane chat-pane" aria-label="Session transcript">
        <h2 className="ttl">
          <span className="glyph">┌─[ </span>
          <b><L t={`SESSION · ${name.toUpperCase()} · ${(activeThread?.kind || 'chat').toUpperCase()}`} p={activeThread?.title || `Chat about ${name}`} /></b>
          <span className="glyph"> ]─┐</span>
        </h2>
        {threads.data && threads.data.length > 1 && (
          <div className="thread-tabs" role="tablist" aria-label="Saved threads">
            {threads.data.map((t) => (
              <button key={t.id} role="tab" aria-selected={t.id === activeId} type="button" className={`tab${t.id === activeId ? ' on' : ''}`} onClick={() => setTid(t.id)}>
                {t.title}
              </button>
            ))}
          </div>
        )}
        <button className="rail-toggle key ghost" type="button" aria-expanded={railOpen} aria-controls="rail" onClick={() => setRailOpen(!railOpen)}>
          <L t="INTERVIEW · HANGOUT" p="Interview and hangouts" />
        </button>
        {/* the transcript is not live while tokens stream (it would read every fragment); finished replies are announced here */}
        <div className="sr" role="status" aria-live="polite" data-testid="chat-announce">{announce}</div>
        <div className="log" ref={logRef} tabIndex={0} aria-label="Transcript" aria-live={busy ? 'off' : 'polite'} aria-busy={busy} data-testid="transcript">
          {(threads.isLoading || thread.isLoading) && <Loading what="conversation" />}
          {isUnavailable && (
            <div className="unavail" role="status" data-testid="agent-unavailable">
              <p className="paper">
                <span className="glyph">[ AGENT UNAVAILABLE ] </span>
                <L t="the agent is off or no API key is configured." p="The chat assistant is turned off right now." />
              </p>
              <p className="dimt">
                <L t="// turn it on in [7] SET → AGENT. dashboards, imports, forms and hangout logging still work." p="You can turn it on in Settings. Everything else, including logging a hangout, still works." />
              </p>
            </div>
          )}
          {!isUnavailable && !lines.length && !thread.isLoading && !threads.isLoading && (
            <p className="dimt">
              <L t={`// ask anything about ${name}: plans, how to bring something up, what a signal means.`} p={`Ask anything about ${name}: plans, how to bring something up, or what a result means.`} />
            </p>
          )}
          {lines.map((ln) =>
            ln.role === 'user' ? (
              <div className="ln me" key={ln.id}>
                <span className="ts">{hhmm(ln.at)}</span>
                <span className="who glyph">you ›</span>
                <span className="body">{ln.text}</span>
              </div>
            ) : (
              <div key={ln.id}>
                <ToolChips tools={ln.tools} />
                <div className={`ln bot${ln.role === 'error' ? ' err-line' : ''}`}>
                  <span className="ts">{hhmm(ln.at)}</span>
                  <span className="who glyph">lvs ›</span>
                  <div className="body">
                    <TaggedText text={ln.text} />
                    {ln.streaming && (
                      <span className="cap">
                        {!ln.text && <L t="lvs is thinking…" p="Thinking…" />}
                        <span className="cur glyph">▌</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ),
          )}
          {checkin && <HangoutCheckin pid={pid} name={name} onClose={() => setCheckin(false)} />}
          <div className="sys">
            <span className="dimt">
              <span className="glyph">// </span>
              <L t="groq · zero data retention should be on · the agent may read message text when allowed in SET" p="Privacy: message text is only used to answer you, if you allow it in Settings." />
            </span>
          </div>
        </div>
        <ErrorLine error={sendUnavailable ? null : err} />
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="prompt-in" htmlFor="chat-inp">
            <span className="ps glyph">{name.toLowerCase().replace(/\s+/g, '')}@lvs:~/chat $</span>
            <input
              id="chat-inp"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
              placeholder={isUnavailable ? 'agent unavailable' : 'Write a message…'}
              aria-label="Message"
              disabled={isUnavailable}
            />
          </label>
          <button className="key pri" type="submit" disabled={busy || !text.trim() || isUnavailable}>
            <span className="key-hint">[ ENTER ] </span>
            <L t="SEND" p="Send" />
          </button>
        </form>
      </section>
      <InterviewRail
        pid={pid}
        disabled={isUnavailable}
        onInterview={() => create.mutate('interview')}
        onHangout={() => {
          setCheckin(true);
          setRailOpen(false);
        }}
      />
    </main>
  );
}

function InterviewRail({ pid, disabled, onInterview, onHangout }: { pid: number; disabled: boolean; onInterview: () => void; onHangout: () => void }) {
  const prog = useQuery({ queryKey: ['interview', pid], queryFn: () => agentApi.progress(pid), retry: false });
  const topics = prog.data?.topics || [];
  const covered = new Set(prog.data?.covered || []);
  const next = topics.find((t) => !covered.has(t.id));
  const done = topics.filter((t) => covered.has(t.id)).length;
  return (
    <aside className="pane rail-frame" id="rail" aria-label="Interview">
      <h2 className="ttl"><span className="glyph">┌─[ </span><b><L t="INTERVIEW" p="Getting to know you" /></b><span className="glyph"> ]─┐</span></h2>
      <div className="rail">
        {prog.isLoading && <Loading what="topics" />}
        {topics.length > 0 && (
          <>
            <h3 className="lbl"><L t="topics" p="Topics" /></h3>
            <ul className="topics" data-testid="interview-topics">
              {topics.map((t) => (
                <li key={t.id} className={covered.has(t.id) ? 'done' : t.id === next?.id ? 'next' : ''}>
                  <span className="bx glyph">{covered.has(t.id) ? '[x]' : '[ ]'}</span>
                  <span className="journal-only">{covered.has(t.id) ? '✓ ' : ''}</span>
                  {t.label}
                </li>
              ))}
            </ul>
            <div className="rail-bar" role="img" aria-label={`${done} of ${topics.length} topics done`}>
              <span className="glyph">{'█'.repeat(done * 2)}<i>{'░'.repeat((topics.length - done) * 2)}</i></span>
              <span className="pbar" aria-hidden="true"><b style={{ width: `${(done / (topics.length || 1)) * 100}%` }} /></span> {done}/{topics.length}
            </div>
            {next && (
              <p className="rail-legend">
                <L t="next up:" p="Next:" /> <span className="c-me">{next.label}</span>
              </p>
            )}
          </>
        )}
        <div className="rail-btns">
          <Key k="H" variant="pri" tech="LOG A HANGOUT" plain="Log a hangout" onClick={onHangout} />
          <Key k="N" tech={done ? 'CONTINUE INTERVIEW' : 'START INTERVIEW'} plain={done ? 'Continue interview' : 'Start interview'} onClick={onInterview} disabled={disabled} />
        </div>
        <p className="rail-legend"><span className="glyph">// </span><L t="answers stay on your account. skip anything." p="Your answers stay on your account. You can skip anything." /></p>
      </div>
    </aside>
  );
}
