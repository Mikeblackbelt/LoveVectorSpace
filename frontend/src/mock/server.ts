// In-browser implementation of docs/api.md over synthetic data (VITE_API_MODE=mock).
// It is installed as the API client's transport, so the app code is identical in both modes.
import type { AgentEvent, AgentMessage, AgentThread, NextStep, PersonSummary, Settings } from '../api/types';
import * as D from './data';

type Handler = (ctx: { params: string[]; body: unknown; url: URL; init: RequestInit }) => Promise<Response> | Response;

const SESSION_KEY = 'lvs.mock.session';
let settings: Settings = { ...D.defaultSettings };
let nextId = 1000;
/** messages added through POST /imports/messages, per person */
const captured: Record<number, { me: number; them: number }> = {};
const id = () => ++nextId;
const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => (import.meta.env.MODE === 'test' ? 0 : 80 + Math.random() * 180);

function json(data: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const noContent = () => new Response(null, { status: 204 });
function err(status: number, code: string, message: string, field?: string): Response {
  return json({ error: { code, message, field } }, status);
}

function sessionOn(): boolean {
  try {
    return localStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}
function setSession(v: boolean) {
  try {
    if (v) localStorage.setItem(SESSION_KEY, '1');
    else localStorage.removeItem(SESSION_KEY);
    document.cookie = v ? 'lvs_csrf=mock-csrf-token; path=/; SameSite=Lax' : 'lvs_csrf=; Max-Age=0; path=/';
  } catch {
    /* storage blocked */
  }
}

const authResult = () => ({ access_token: 'mock.' + Math.random().toString(36).slice(2), expires_in: 900, user: D.demoUser });

// ---------- live events (/api/events) ----------
const eventSinks = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();
function pushEvent(e: Record<string, unknown>) {
  const frame = enc.encode(`data: ${JSON.stringify(e)}\n\n`);
  eventSinks.forEach((c) => {
    try {
      c.enqueue(frame);
    } catch {
      eventSinks.delete(c);
    }
  });
}

function sseResponse(start: (c: ReadableStreamDefaultController<Uint8Array>) => void | Promise<void>, onCancel?: () => void) {
  const stream = new ReadableStream<Uint8Array>({ start, cancel: onCancel });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

// ---------- agent ----------
function agentReply(pid: number, text: string): { tools: [string, Record<string, unknown>, string][]; reply: string } {
  const p = D.people.find((x) => x.id === pid);
  const name = p?.pseudonym || 'them';
  const t = text.toLowerCase();
  if (/hangout|log|met up|saw them/.test(t)) {
    return {
      tools: [['list_interactions', { person_id: pid, since: '30d' }, 'found 2 logged hangouts in 30 days']],
      reply: `Happy to log it. Use "Log a hangout" on the right and I'll ask one question at a time; every question is skippable. Anything you tell me is saved as a context fact you can edit later.`,
    };
  }
  if (/chance|odds|percent|%|score/.test(t)) {
    const s = p?.success;
    return {
      tools: [['get_person_overview', { person_id: pid }, 'loaded latest snapshot']],
      reply:
        s && s.percent != null
          ? `The current estimate is ${s.percent}% (range ${s.low}–${s.high}). It's an uncalibrated estimate: hand-set weights, not fitted to outcomes. Real outcomes are only weakly predictable from chats, so read it as a lean, not odds.`
          : `There isn't enough data for an estimate yet. Importing a longer chat or logging a hangout would help.`,
    };
  }
  return {
    tools: [
      ['get_person_overview', { person_id: pid }, 'loaded latest snapshot'],
      ['get_context', { person_id: pid }, `${(D.facts[pid] || []).length} facts, ${(D.interactions[pid] || []).length} hangouts`],
    ],
    reply: `Looking at ${name}: you start more conversations (62/38) [HEUR], and your texting style match is high (0.81) [MOD]. One idea: ask an open question about something they mentioned last week, then give them room to carry it. Want me to draft a message you could send in your own words?`,
  };
}

async function streamReply(c: ReadableStreamDefaultController<Uint8Array>, pid: number, tid: number, text: string) {
  const send = (e: AgentEvent) => c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
  const slow = import.meta.env.MODE !== 'test';
  const { tools, reply } = agentReply(pid, text);
  for (const [name, args, summary] of tools) {
    send({ type: 'tool_call', name, args });
    if (slow) await sleep(260);
    send({ type: 'tool_result', name, ok: true, summary });
  }
  const words = reply.split(/(\s+)/);
  for (const w of words) {
    send({ type: 'token', text: w });
    if (slow) await sleep(18 + Math.random() * 30);
  }
  const msg: AgentMessage = { id: id(), role: 'assistant', content: reply, created_at: nowIso() };
  (D.threadMessages[tid] ||= []).push(msg);
  send({ type: 'done', message_id: msg.id });
  c.close();
}

const firstQuestion: Record<string, string> = {
  interview: "Let's start where it began. How did you two meet? (You can skip any question.)",
  checkin: 'When did you see each other, and roughly how long was it?',
};

// ---------- helpers ----------
function person(pid: number): PersonSummary | undefined {
  return D.people.find((p) => p.id === pid);
}
async function readFile(body: unknown): Promise<{ file?: Blob; fields: Record<string, string[]> }> {
  const fields: Record<string, string[]> = {};
  let file: Blob | undefined;
  if (body instanceof FormData) {
    body.forEach((v, k) => {
      if (typeof v === 'string') (fields[k] ||= []).push(v);
      else file = v;
    });
  }
  return { file, fields };
}
const DATING = ['tinder', 'hinge', 'grindr', 'bumble'];
/** Dating-app exports (JSON with matches/conversations): one match = one import unit. */
function detectDating(text: string, name: string) {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  const lower = name.toLowerCase();
  const fmt = DATING.find((d) => lower.includes(d)) || (/"(Messages|matches|conversations)"/.test(text) ? 'tinder' : null);
  if (!fmt) return null;
  const o = obj as { matches?: { match_id?: string; id?: string; label?: string; name?: string; messages?: unknown[] }[] };
  const list = Array.isArray(o.matches) && o.matches.length
    ? o.matches.map((m, i) => ({ match_id: String(m.match_id ?? m.id ?? i + 1), label: m.label ?? m.name ?? `Match ${i + 1}`, n: m.messages?.length ?? 0 }))
    : [{ match_id: 'm1', label: 'Match 1', n: 42 }, { match_id: 'm2', label: 'Match 2', n: 7 }];
  const matches = list.map((m) => ({ match_id: m.match_id, label: m.label, first_ts: '2026-10-02T19:00:00Z', last_ts: '2026-11-20T22:10:00Z', message_count: m.n, one_sided: fmt === 'tinder' }));
  return { format: fmt, matches, one_sided: matches.every((m) => m.one_sided) };
}

function detect(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const names = new Map<string, number>();
  let format = 'plaintext';
  for (const l of lines) {
    const wa = l.match(/^\[?\d{1,2}[./]\d{1,2}[./]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?\]?\s*(?:-\s*)?([^:]{1,40}):/);
    const plain = l.match(/^([A-Za-z][\w .'-]{0,30}):\s/);
    const n = wa?.[1] ?? plain?.[1];
    if (wa) format = 'whatsapp';
    if (n) names.set(n.trim(), (names.get(n.trim()) || 0) + 1);
  }
  if (/"participants"\s*:/.test(text)) format = 'instagram';
  const speakers = [...names.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 6);
  return { format, speakers: speakers.length ? speakers : ['Me', 'Them'], lines: lines.length, one_sided: speakers.length === 1 };
}

// ---------- routes ----------
const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/healthz$/, () => json({ ok: true, version: 'mock' })],

  // auth
  ['POST', /^\/api\/auth\/login$/, ({ body }) => {
    const b = body as { email?: string; password?: string };
    if (!b?.email || !b?.password) return err(401, 'unauthenticated', 'Email or password is incorrect.');
    setSession(true);
    return json(authResult());
  }],
  ['POST', /^\/api\/auth\/signup$/, ({ body }) => {
    const b = body as { email?: string; password?: string; invite_code?: string };
    if (b?.invite_code && b.invite_code.trim().length < 4) return err(403, 'invite_required', 'A valid invite code is required.', 'invite_code');   // open registration: optional
    if (!b.password || b.password.length < 12) return err(422, 'validation_error', 'Password must be at least 12 characters.', 'password');
    setSession(true);
    return json(authResult(), 201);
  }],
  ['POST', /^\/api\/auth\/refresh$/, () => (sessionOn() ? json(authResult()) : err(401, 'unauthenticated', 'Session expired.'))],
  ['POST', /^\/api\/auth\/logout$/, () => { setSession(false); return noContent(); }],
  ['GET', /^\/api\/auth\/me$/, () => json(D.demoUser)],
  ['GET', /^\/api\/auth\/providers$/, () => json({ google: true, apple: true, registration: 'open' })],
  ['POST', /^\/api\/auth\/verify-email$/, ({ body }) => ((body as { token?: string })?.token ? noContent() : err(400, 'invalid_input', 'This link is invalid or has expired.'))],
  ['POST', /^\/api\/auth\/verify-email\/resend$/, () => noContent()],
  ['POST', /^\/api\/auth\/password\/forgot$/, () => noContent()],
  ['POST', /^\/api\/auth\/password\/reset$/, ({ body }) => {
    const b = body as { token?: string; new_password?: string };
    if (!b?.token) return err(400, 'invalid_input', 'This reset link is invalid or has expired.');
    if (!b.new_password || b.new_password.length < 12) return err(422, 'validation_error', 'Password must be at least 12 characters.', 'new_password');
    return noContent();
  }],
  ['POST', /^\/api\/auth\/password\/change$/, () => noContent()],
  ['POST', /^\/api\/auth\/(google|apple)\/token$/, ({ body }) => {
    const b = body as { invite_code?: string };
    if (!b?.invite_code && !sessionOn()) return err(403, 'invite_required', 'New accounts need an invite code.', 'invite_code');
    setSession(true);
    return json(authResult());
  }],
  ['GET', /^\/api\/auth\/sessions$/, () => json(D.sessions)],
  ['DELETE', /^\/api\/auth\/sessions\/([^/]+)$/, ({ params }) => {
    const i = D.sessions.findIndex((s) => s.id === params[0]);
    if (i >= 0) D.sessions.splice(i, 1);
    return noContent();
  }],

  // settings, tokens, invites, account
  ['GET', /^\/api\/settings$/, () => json(settings)],
  ['PUT', /^\/api\/settings$/, ({ body }) => { settings = { ...settings, ...(body as Partial<Settings>) }; return json(settings); }],
  ['GET', /^\/api\/tokens$/, () => json(D.tokens)],
  ['POST', /^\/api\/tokens$/, ({ body }) => {
    const b = body as { kind: 'api' | 'extension'; label?: string };
    const info = { id: 't' + id(), kind: b.kind, label: b.label || null, created_at: nowIso(), last_used_at: null, revoked_at: null };
    D.tokens.unshift(info);
    const secret = (b.kind === 'api' ? 'lvs_api_' : 'lvs_ext_') + crypto.getRandomValues(new Uint32Array(4)).join('').slice(0, 32);
    return json({ token: secret, info }, 201);
  }],
  ['DELETE', /^\/api\/tokens\/([^/]+)$/, ({ params }) => {
    const t = D.tokens.find((x) => x.id === params[0]);
    if (t) t.revoked_at = nowIso();
    return noContent();
  }],
  ['GET', /^\/api\/invites$/, () => json(D.invites)],
  ['POST', /^\/api\/invites$/, ({ body }) => {
    const b = body as { email?: string; expires_days?: number };
    const code = 'LVS-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 4).toUpperCase();
    const inv = { code, email: b?.email || null, created_at: nowIso(), expires_at: new Date(Date.now() + (b?.expires_days || 14) * 86400000).toISOString(), used_by: null };
    D.invites.unshift(inv);
    return json(inv, 201);
  }],
  ['DELETE', /^\/api\/invites\/([^/]+)$/, ({ params }) => {
    const i = D.invites.findIndex((x) => x.code === decodeURIComponent(params[0]));
    if (i >= 0) D.invites.splice(i, 1);
    return noContent();
  }],
  ['POST', /^\/api\/account\/export$/, ({ body }) => {
    const b = body as { include_messages?: boolean };
    const out = { exported_at: nowIso(), user: D.demoUser, people: D.people, facts: D.facts, interactions: D.interactions, questionnaires: D.questionnaireHistory, messages: b?.include_messages ? '(synthetic demo has no raw messages)' : undefined };
    return new Response(JSON.stringify(out, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }],
  ['DELETE', /^\/api\/account$/, ({ body }) => {
    const b = body as { confirm?: string; password?: string };
    if (b?.confirm !== 'DELETE MY ACCOUNT') return err(422, 'validation_error', 'Type DELETE MY ACCOUNT to confirm.', 'confirm');
    if (!b.password) return err(422, 'validation_error', 'Enter your password to confirm.', 'password');
    setSession(false);
    return noContent();
  }],

  // people
  ['GET', /^\/api\/people$/, () => json(D.people)],
  ['POST', /^\/api\/people$/, ({ body }) => {
    const b = body as { pseudonym?: string; mode?: string; timezone?: string };
    if (!b?.pseudonym?.trim()) return err(422, 'validation_error', 'Give this person a name or nickname.', 'pseudonym');
    const pid = id();
    D.people.push({ id: pid, pseudonym: b.pseudonym.trim(), mode: b.mode || 'potential', sources: [], success: { percent: null, low: null, high: null, status: 'insufficient_data' }, safety: 'none', updated_at: null });
    D.units[pid] = []; D.facts[pid] = []; D.interactions[pid] = []; D.nextSteps[pid] = []; D.threads[pid] = []; D.coverage[pid] = []; D.interviewCovered[pid] = []; D.questionnaireHistory[pid] = [];
    return json({ id: pid, pseudonym: b.pseudonym.trim(), mode: b.mode || 'potential', timezone: b.timezone || null, created_at: nowIso() }, 201);
  }],
  ['GET', /^\/api\/people\/(\d+)$/, ({ params }) => {
    const p = person(+params[0]);
    return p ? json({ id: p.id, pseudonym: p.pseudonym, mode: p.mode, timezone: 'America/New_York', created_at: '2026-09-01T10:00:00Z' }) : err(404, 'not_found', 'Person not found.');
  }],
  ['PATCH', /^\/api\/people\/(\d+)$/, ({ params, body }) => {
    const p = person(+params[0]);
    if (!p) return err(404, 'not_found', 'Person not found.');
    Object.assign(p, body as object);
    return json({ id: p.id, pseudonym: p.pseudonym, mode: p.mode, timezone: 'America/New_York', created_at: '2026-09-01T10:00:00Z' });
  }],
  ['DELETE', /^\/api\/people\/(\d+)$/, ({ params }) => {
    const i = D.people.findIndex((p) => p.id === +params[0]);
    if (i >= 0) D.people.splice(i, 1);
    return noContent();
  }],
  ['POST', /^\/api\/people\/(\d+)\/imports\/preview$/, async ({ body }) => {
    const { file } = await readFile(body);
    if (!file) return err(400, 'invalid_input', 'Choose a chat export file.', 'file');
    if (file.size > 50 * 1024 * 1024) return err(413, 'too_large', 'That file is over 50 MB.');
    const text = await file.text();
    return json(detectDating(text, (file as File).name || '') || detect(text));
  }],
  ['POST', /^\/api\/people\/(\d+)\/imports$/, async ({ params, body }) => {
    const pid = +params[0];
    const { file, fields } = await readFile(body);
    if (!file) return err(400, 'invalid_input', 'Choose a chat export file.', 'file');
    const text = await file.text();
    const dating = detectDating(text, (file as File).name || '');
    if (dating) {
      const m = dating.matches.find((x) => x.match_id === fields.match_id?.[0]);
      if (!m) return err(400, 'invalid_input', 'Pick which match this chat is with.', 'match_id');
      const unit = { unit_id: `import:${dating.format}:${m.match_id}`, source: dating.format, created_at: nowIso(), message_count: m.message_count, start_ts: m.first_ts, end_ts: m.last_ts };
      (D.units[pid] ||= []).unshift(unit);
      return json({ unit_id: unit.unit_id, added: m.message_count, merged: 0, skipped_non_english: 0, one_sided: m.one_sided, job_id: id() }, 201);
    }
    if (!fields.me_names?.length) return err(422, 'validation_error', 'Pick which name is you.', 'me_names');
    const d = detect(text);
    const unit = { unit_id: 'up_' + id(), source: fields.source?.[0] || d.format, created_at: nowIso(), message_count: d.lines, start_ts: nowIso(), end_ts: nowIso() };
    (D.units[pid] ||= []).unshift(unit);
    const p = person(pid);
    if (p && !p.sources.some((s) => s.source === 'import')) p.sources.push({ source: 'import', last_sync: nowIso(), health: 'ok' });
    const job = id();
    setTimeout(() => pushEvent({ type: 'ingest', person_id: pid, added: d.lines }), 300);
    return json({ unit_id: unit.unit_id, added: d.lines, merged: 0, skipped_non_english: 0, one_sided: d.one_sided, job_id: job }, 201);
  }],
  ['POST', /^\/api\/people\/(\d+)\/imports\/messages$/, ({ params, body }) => {
    const pid = +params[0];
    const b = body as { source?: string; messages?: { role: string }[] };
    if (!b?.source || !/^(screenshot_import|android_sms|android_notify_\w+|android_a11y_\w+)$/.test(b.source)) return err(400, 'invalid_input', 'Unknown capture source.', 'source');
    if (!person(pid)) return err(404, 'not_found', 'Person not found.');
    const msgs = b.messages || [];
    const n = msgs.length;
    const oneSided = b.source.startsWith('android_notify_');
    // notification readers only see incoming messages: the server forces them to "them"
    const me = oneSided ? 0 : msgs.filter((m) => m.role === 'me').length;
    const c = (captured[pid] ||= { me: 0, them: 0 });
    c.me += me;
    c.them += n - me;
    const unitId = `capture:${b.source}:${nowIso().slice(0, 10)}`;
    const list = (D.units[pid] ||= []);
    const existing = list.find((u) => u.unit_id === unitId);
    if (existing) {
      existing.message_count += n;
      existing.end_ts = nowIso();
    } else list.unshift({ unit_id: unitId, source: b.source, created_at: nowIso(), message_count: n, start_ts: nowIso(), end_ts: nowIso() });
    const p = person(pid)!;
    const src = p.sources.find((x) => x.source === b.source);
    if (src) src.last_sync = nowIso();
    else p.sources.push({ source: b.source, last_sync: nowIso(), health: 'ok' });
    p.updated_at = nowIso();
    setTimeout(() => {
      pushEvent({ type: 'ingest', person_id: pid, added: n });
      pushEvent({ type: 'snapshot', person_id: pid });
    }, 200);
    return json({ unit_id: unitId, added: n, merged: 0, skipped_non_english: 0, one_sided: oneSided && p.sources.length === 1, job_id: id() }, 201);
  }],
  ['GET', /^\/api\/people\/(\d+)\/units$/, ({ params }) => json(D.units[+params[0]] || [])],
  ['DELETE', /^\/api\/units\/([^/]+)$/, ({ params }) => {
    for (const k of Object.keys(D.units)) {
      const list = D.units[+k];
      const i = list.findIndex((u) => u.unit_id === params[0]);
      if (i >= 0) {
        const [u] = list.splice(i, 1);
        return json({ removed_messages: u.message_count });
      }
    }
    return err(404, 'not_found', 'Unit not found.');
  }],
  ['GET', /^\/api\/people\/(\d+)\/speakers$/, ({ params }) => json(+params[0] === 1 ? [{ source: 'whatsapp', speaker_raw: 'Alex', role: 'me' }, { source: 'whatsapp', speaker_raw: 'Yu Cheng', role: 'them' }] : [])],
  ['PUT', /^\/api\/people\/(\d+)\/speakers$/, ({ body }) => json(body)],
  ['GET', /^\/api\/people\/(\d+)\/coverage$/, ({ params }) => json(D.coverage[+params[0]] || [])],

  // analysis
  ['GET', /^\/api\/people\/(\d+)\/overview$/, ({ params }) => {
    const pid = +params[0];
    const p = person(pid);
    if (!p) return err(404, 'not_found', 'Person not found.');
    if (pid > 3) return err(404, 'not_found', 'No analysis yet.');
    const o = D.overviewFor(pid);
    o.next_steps = (D.nextSteps[pid] || []).filter((s) => s.status === 'open');
    // phone-captured messages land in the latest week so the dashboard visibly updates
    const c = captured[pid];
    const last = o.weekly[o.weekly.length - 1];
    if (c && last) {
      last.me = (last.me ?? 0) + c.me;
      last.them = (last.them ?? 0) + c.them;
      last.covered = true;
    }
    o.generated_at = person(pid)?.updated_at || o.generated_at;
    return json(o);
  }],
  ['POST', /^\/api\/people\/(\d+)\/analyze$/, ({ params }) => {
    const pid = +params[0];
    const job = id();
    setTimeout(() => {
      const p = person(pid);
      if (p) p.updated_at = nowIso();
      pushEvent({ type: 'job', person_id: pid, job_id: job, status: 'done' });
      pushEvent({ type: 'snapshot', person_id: pid });
    }, 1400);
    return json({ job_id: job }, 202);
  }],
  ['GET', /^\/api\/jobs\/(\d+)$/, ({ params }) => json({ id: +params[0], kind: 'analyze', status: 'done', error: null, created_at: nowIso(), finished_at: nowIso() })],
  ['GET', /^\/api\/people\/(\d+)\/history\/([^/]+)$/, () => json([])],
  ['GET', /^\/api\/metrics\/([^/]+)\/explain$/, ({ params }) => json({ id: params[0], measures: 'See the signal table note.', evidence: 'heuristic', caveats: 'Chats show only part of a relationship.', citation: '' })],

  // questionnaires
  ['GET', /^\/api\/scales$/, () => json(D.scales)],
  ['POST', /^\/api\/people\/(\d+)\/questionnaires\/([^/]+)$/, ({ params, body }) => {
    const pid = +params[0];
    const def = D.scales.find((s) => s.id === params[1]);
    if (!def) return err(404, 'not_found', 'Unknown questionnaire.');
    const answers = (body as { answers: Record<string, number> }).answers || {};
    const subscales: Record<string, number | null> = {};
    for (const [name, sub] of Object.entries(def.subscales)) {
      const vals = sub.items.map((i) => answers[i]).filter((v) => typeof v === 'number');
      subscales[name] = vals.length ? (sub.aggregate === 'sum' ? vals.reduce((a, b) => a + b, 0) : +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
    }
    const result = { subscales, bands: {}, cutoff_flags: {}, status: def.verified ? 'ok' : 'unverified', notes: def.verified ? [] : ['custom scale, no reference band'] } as const;
    (D.questionnaireHistory[pid] ||= []).unshift({ scale_id: def.id, submitted_at: nowIso(), result: { ...result, notes: [...result.notes] } });
    return json(result);
  }],
  ['GET', /^\/api\/people\/(\d+)\/questionnaires$/, ({ params }) => json(D.questionnaireHistory[+params[0]] || [])],

  // context
  ['GET', /^\/api\/people\/(\d+)\/facts$/, ({ params }) => json(D.facts[+params[0]] || [])],
  ['POST', /^\/api\/people\/(\d+)\/facts$/, ({ params, body }) => {
    const pid = +params[0];
    const b = body as { key: string; value: string; confidence: 'owner_sure' | 'owner_unsure' };
    const f = { id: id(), person_id: pid, key: b.key, value: b.value, source: 'owner_edit' as const, confidence: b.confidence, updated_at: nowIso() };
    (D.facts[pid] ||= []).push(f);
    return json(f, 201);
  }],
  ['PATCH', /^\/api\/facts\/(\d+)$/, ({ params, body }) => {
    for (const list of Object.values(D.facts)) {
      const f = list.find((x) => x.id === +params[0]);
      if (f) { Object.assign(f, body as object, { updated_at: nowIso() }); return json(f); }
    }
    return err(404, 'not_found', 'Fact not found.');
  }],
  ['DELETE', /^\/api\/facts\/(\d+)$/, ({ params }) => {
    for (const list of Object.values(D.facts)) {
      const i = list.findIndex((x) => x.id === +params[0]);
      if (i >= 0) list.splice(i, 1);
    }
    return noContent();
  }],
  ['GET', /^\/api\/people\/(\d+)\/interactions$/, ({ params }) => json(D.interactions[+params[0]] || [])],
  ['POST', /^\/api\/people\/(\d+)\/interactions$/, ({ params, body }) => {
    const pid = +params[0];
    const b = body as { fields: import('../api/types').InteractionFields; notes: string };
    const it = { id: id(), person_id: pid, fields: b.fields, notes: b.notes || '' };
    (D.interactions[pid] ||= []).unshift(it);
    setTimeout(() => pushEvent({ type: 'snapshot', person_id: pid }), 400);
    return json(it, 201);
  }],
  ['PATCH', /^\/api\/interactions\/(\d+)$/, ({ params, body }) => {
    for (const list of Object.values(D.interactions)) {
      const it = list.find((x) => x.id === +params[0]);
      if (it) {
        const b = body as { fields?: object; notes?: string };
        if (b.fields) it.fields = { ...it.fields, ...b.fields };
        if (b.notes !== undefined) it.notes = b.notes;
        return json(it);
      }
    }
    return err(404, 'not_found', 'Interaction not found.');
  }],
  ['DELETE', /^\/api\/interactions\/(\d+)$/, ({ params }) => {
    for (const list of Object.values(D.interactions)) {
      const i = list.findIndex((x) => x.id === +params[0]);
      if (i >= 0) list.splice(i, 1);
    }
    return noContent();
  }],

  // next steps
  ['GET', /^\/api\/people\/(\d+)\/next-steps$/, ({ params, url }) => {
    const st = url.searchParams.get('status');
    return json((D.nextSteps[+params[0]] || []).filter((s) => !st || s.status === st));
  }],
  ['POST', /^\/api\/people\/(\d+)\/next-steps\/generate$/, ({ params }) => {
    const pid = +params[0];
    const job = id();
    setTimeout(() => {
      const s: NextStep = { id: id(), kind: 'talk', title: 'Share something small about your day first', why: 'Disclosure tends to be reciprocated; it gives them an easy opening', evidence_refs: ['metric:disclosure_rate'], status: 'open', created_at: nowIso() };
      (D.nextSteps[pid] ||= []).push(s);
      pushEvent({ type: 'next_steps', person_id: pid });
    }, 900);
    return json({ job_id: job }, 202);
  }],
  ['PATCH', /^\/api\/next-steps\/(\d+)$/, ({ params, body }) => {
    for (const list of Object.values(D.nextSteps)) {
      const s = list.find((x) => x.id === +params[0]);
      if (s) { s.status = (body as { status: NextStep['status'] }).status; return json(s); }
    }
    return err(404, 'not_found', 'Step not found.');
  }],

  // agent
  ['GET', /^\/api\/people\/(\d+)\/agent\/threads$/, ({ params }) => (settings.agent_enabled ? json(D.threads[+params[0]] || []) : err(503, 'agent_unavailable', 'The agent is turned off.'))],
  ['POST', /^\/api\/people\/(\d+)\/agent\/threads$/, ({ params, body }) => {
    if (!settings.agent_enabled) return err(503, 'agent_unavailable', 'The agent is turned off.');
    const pid = +params[0];
    const kind = (body as { kind: AgentThread['kind'] }).kind || 'chat';
    const t: AgentThread = { id: id(), kind, title: kind === 'interview' ? 'Intake interview' : kind === 'checkin' ? 'Log a hangout' : 'New chat', created_at: nowIso(), updated_at: nowIso() };
    (D.threads[pid] ||= []).unshift(t);
    D.threadMessages[t.id] = firstQuestion[kind] ? [{ id: id(), role: 'assistant', content: firstQuestion[kind], created_at: nowIso() }] : [];
    return json(t, 201);
  }],
  ['GET', /^\/api\/agent\/threads\/(\d+)$/, ({ params }) => {
    const tid = +params[0];
    const thread = Object.values(D.threads).flat().find((t) => t.id === tid);
    return thread ? json({ thread, messages: D.threadMessages[tid] || [] }) : err(404, 'not_found', 'Thread not found.');
  }],
  ['POST', /^\/api\/agent\/threads\/(\d+)\/messages$/, ({ params, body }) => {
    if (!settings.agent_enabled) return err(503, 'agent_unavailable', 'The agent is turned off.');
    const tid = +params[0];
    const pid = +(Object.entries(D.threads).find(([, ts]) => ts.some((t) => t.id === tid))?.[0] || 1);
    const text = (body as { text: string }).text || '';
    (D.threadMessages[tid] ||= []).push({ id: id(), role: 'user', content: text, created_at: nowIso() });
    return sseResponse((c) => streamReply(c, pid, tid, text));
  }],
  ['GET', /^\/api\/people\/(\d+)\/interview\/progress$/, ({ params }) => {
    const pid = +params[0];
    const p = person(pid);
    const topics = p?.mode === 'established' ? D.interviewTopics.established : D.interviewTopics.potential;
    const covered = D.interviewCovered[pid] || [];
    return json({ covered, open: topics.map((t) => t.id).filter((t) => !covered.includes(t)), topics });
  }],

  // live events
  ['GET', /^\/api\/events$/, () => {
    let ctl: ReadableStreamDefaultController<Uint8Array> | null = null;
    return sseResponse(
      (c) => { ctl = c; eventSinks.add(c); c.enqueue(enc.encode(': connected\n\n')); },
      () => { if (ctl) eventSinks.delete(ctl); },
    );
  }],
];

const PUBLIC = /^\/api\/auth\/(?!me$|logout$|sessions)|^\/healthz$/;

export async function mockFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, 'http://mock.local');
  const method = (init.method || 'GET').toUpperCase();
  let body: unknown = init.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      /* raw */
    }
  }
  await sleep(latency());
  const headers = new Headers(init.headers);
  if (!PUBLIC.test(url.pathname) && !headers.get('Authorization')?.startsWith('Bearer mock.')) {
    return err(401, 'unauthenticated', 'Sign in again.');
  }
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = url.pathname.match(re);
    if (match) return h({ params: match.slice(1), body, url, init });
  }
  return err(404, 'not_found', `No mock route for ${method} ${url.pathname}`);
}

/** Reset mutable mock state (tests). */
export function resetMockSettings(s?: Partial<Settings>) {
  settings = { ...D.defaultSettings, ...s };
}
