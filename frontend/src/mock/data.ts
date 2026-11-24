// Synthetic demo data for VITE_API_MODE=mock. Everything here is invented.
import type {
  AgentMessage, AgentThread, Fact, Interaction, Invite, Metric, NextStep, PersonOverview, PersonSummary,
  QuestionnaireRecord, SafetyBlock, ScaleDef, SessionInfo, Settings, TokenInfo, Unit, User, WeekPoint,
} from '../api/types';

export const TAG = 'uncalibrated estimate: hand-set weights, not fitted to outcomes';
export const DISCLAIMER =
  'This tool offers reflection and pattern warnings. It is not therapy, counselling, or a crisis service.';

const now = Date.now();
const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();
const day = (d: string) => `${d}T12:00:00Z`;

export const demoUser: User = {
  id: 'u_demo',
  email: 'judge1@demo.lvs',
  email_verified: true,
  display_name: 'Alex',
  role: 'admin',
  providers: ['password'],
  created_at: '2026-11-01T09:00:00Z',
};

export const defaultSettings: Settings = {
  theme: 'signal',
  auto_theme: { mode: 'system', day: 'journal', night: 'signal', day_start: '07:00', day_end: '19:00' },
  reduce_motion: false,
  contrast_boost: false,
  text_size: 'm',
  owner_timezone: 'America/New_York',
  agent_enabled: true,
  agent_reads_text: true,
  catchup_enabled: true,
};

function m(
  id: string, label: string, plain_label: string, value: number | null,
  per: [number, number] | null, evidence: string, band = 'no reference band', note = '', status: Metric['status'] = 'ok',
): Metric {
  return { id, label, plain_label, value, per_speaker: per ? { me: per[0], them: per[1] } : null, evidence, status, note, band };
}

const emptySafety = (): SafetyBlock => ({ flags: [], resources: [], disclaimer: DISCLAIMER });

function weeks(start: string, me: (number | null)[], them: (number | null)[]): WeekPoint[] {
  const t0 = new Date(start + 'T00:00:00Z').getTime();
  return me.map((v, i) => ({
    week: new Date(t0 + i * 7 * 86400000).toISOString().slice(0, 10),
    me: v,
    them: them[i],
    covered: v !== null,
  }));
}

// ---------------- people ----------------
export const people: PersonSummary[] = [
  {
    id: 1, pseudonym: 'Yu Cheng', mode: 'potential',
    sources: [
      { source: 'whatsapp', last_sync: ago(2), health: 'ok' },
      { source: 'instagram', last_sync: ago(60), health: 'ok' },
    ],
    success: { percent: 64, low: 49, high: 79, status: 'ok' }, safety: 'none', updated_at: ago(5),
  },
  {
    id: 2, pseudonym: 'Sam', mode: 'established',
    sources: [
      { source: 'whatsapp', last_sync: ago(5), health: 'ok' },
      { source: 'discord', last_sync: ago(180), health: 'needs_update' },
      { source: 'import', last_sync: null, health: 'ok' },
    ],
    success: { percent: 71, low: 56, high: 86, status: 'ok' }, safety: 'concern', updated_at: ago(40),
  },
  {
    id: 3, pseudonym: 'Jordan', mode: 'potential',
    sources: [{ source: 'import', last_sync: null, health: 'stale' }],
    success: { percent: null, low: null, high: null, status: 'insufficient_data' }, safety: 'none', updated_at: ago(1440),
  },
];

const steps = (pid: number): NextStep[] =>
  pid === 1
    ? [
        { id: 11, kind: 'plan', title: 'Suggest a specific weekend plan', why: 'They accept plans but rarely propose them', evidence_refs: ['metric:meetup_initiation_share', 'interaction:7'], status: 'open', created_at: ago(30) },
        { id: 12, kind: 'talk', title: 'Ask an open question about their week', why: 'Their question rate is 0.22/msg vs your 0.31; open questions invite longer replies', evidence_refs: ['metric:question_rate'], status: 'open', created_at: ago(30) },
        { id: 13, kind: 'reflect', title: "Log last Friday's hangout", why: 'In-person time is invisible to the extension until you log it', evidence_refs: ['interaction:new'], status: 'open', created_at: ago(30) },
      ]
    : pid === 2
      ? [
          { id: 21, kind: 'talk', title: 'Name one thing that went well this week', why: 'Appreciation is among the strongest predictors of satisfaction', evidence_refs: ['scale:csi16', 'fact:4'], status: 'open', created_at: ago(90) },
          { id: 22, kind: 'pause', title: 'Take a breather before replying to tense threads', why: 'Most tense exchanges this month happened after 23:00', evidence_refs: ['metric:late_night_share'], status: 'open', created_at: ago(90) },
        ]
      : [
          { id: 31, kind: 'reflect', title: 'Import a longer chat history', why: 'Only 41 messages so far; most signals need about 200', evidence_refs: ['metric:message_share'], status: 'open', created_at: ago(600) },
        ];

const yuReciprocity: Metric[] = [
  m('initiation_share', 'initiation_share', 'Who starts conversations', 0.62, [0.62, 0.38], 'heuristic', 'no reference band', 'why they reply less'),
  m('message_share', 'message_share', 'Who sends more', 0.59, [0.59, 0.41], 'descriptive', 'no reference band', 'whether length means interest'),
  m('question_rate', 'question_rate', 'Questions asked', 0.31, [0.31, 0.22], 'heuristic', 'no reference band', 'their tone or intent'),
  m('disclosure_rate', 'disclosure_rate', 'Opening up', 0.13, [0.12, 0.14], 'moderate', 'typical 0.08–0.18', 'what they chose not to share'),
  m('lsm', 'lsm', 'Texting style match', 0.81, null, 'moderate', 'high ≥ 0.75', 'attraction; it measures style only'),
  m('meetup_initiation_share', 'meetup_initiation_share', 'Who suggests meetups', 0.7, [0.7, 0.3], 'self-report heuristic', 'self-reported · n=6', 'how they felt about each meetup'),
  m('plan_follow_through_rate', 'plan_follow_through_rate', 'Plans that happen', 0.78, [0.8, 0.75], 'self-report heuristic', 'self-reported · n=4', 'why a plan slipped'),
];

const samReciprocity: Metric[] = [
  m('initiation_share', 'initiation_share', 'Who starts conversations', 0.48, [0.48, 0.52], 'heuristic', 'no reference band', 'why either of you starts'),
  m('message_share', 'message_share', 'Who sends more', 0.51, [0.51, 0.49], 'descriptive', 'no reference band', 'whether length means interest'),
  m('question_rate', 'question_rate', 'Questions asked', 0.24, [0.24, 0.19], 'heuristic', 'no reference band', 'their tone or intent'),
  m('disclosure_rate', 'disclosure_rate', 'Opening up', 0.11, [0.1, 0.12], 'moderate', 'typical 0.08–0.18', 'what they chose not to share'),
  m('lsm', 'lsm', 'Texting style match', 0.86, null, 'moderate', 'high ≥ 0.75', 'attraction; it measures style only'),
  m('meetup_initiation_share', 'meetup_initiation_share', 'Who suggests meetups', 0.55, [0.55, 0.45], 'self-report heuristic', 'self-reported · n=11', 'how they felt about each meetup'),
  m('plan_follow_through_rate', 'plan_follow_through_rate', 'Plans that happen', 0.84, [0.86, 0.82], 'self-report heuristic', 'self-reported · n=9', 'why a plan slipped'),
];

const jordanReciprocity: Metric[] = [
  m('initiation_share', 'initiation_share', 'Who starts conversations', null, null, 'heuristic', 'no reference band', 'needs about 200 messages', 'insufficient_data'),
  m('message_share', 'message_share', 'Who sends more', 0.55, [0.55, 0.45], 'descriptive', 'no reference band', 'whether length means interest'),
  m('question_rate', 'question_rate', 'Questions asked', null, null, 'heuristic', 'no reference band', 'needs more messages', 'insufficient_data'),
  m('disclosure_rate', 'disclosure_rate', 'Opening up', null, null, 'moderate', 'typical 0.08–0.18', 'needs more messages', 'insufficient_data'),
  m('lsm', 'lsm', 'Texting style match', null, null, 'moderate', 'high ≥ 0.75', 'needs more messages', 'insufficient_data'),
  m('meetup_initiation_share', 'meetup_initiation_share', 'Who suggests meetups', null, null, 'self-report heuristic', 'self-reported · n=0', 'log a hangout first', 'insufficient_data'),
  m('plan_follow_through_rate', 'plan_follow_through_rate', 'Plans that happen', null, null, 'self-report heuristic', 'self-reported · n=0', 'log a hangout first', 'insufficient_data'),
];

const otherMetrics = (pid: number): Metric[] => [
  m('reply_latency_ratio', 'reply_latency_ratio', 'How fast replies come back', pid === 3 ? null : 0.9, pid === 3 ? null : [14, 16], 'descriptive', 'no reference band', 'whether they were busy', pid === 3 ? 'insufficient_data' : 'ok'),
  m('message_length_ratio', 'message_length_ratio', 'Message length balance', pid === 3 ? null : 1.2, pid === 3 ? null : [42, 35], 'descriptive', 'no reference band', 'effort or interest', pid === 3 ? 'insufficient_data' : 'ok'),
  m('late_night_share', 'late_night_share', 'Late-night messages', pid === 2 ? 0.31 : pid === 1 ? 0.12 : null, null, 'descriptive', 'no reference band', 'why you were up late', pid === 3 ? 'insufficient_data' : 'ok'),
];

const interactionMetrics = (pid: number): Metric[] =>
  pid === 3
    ? [m('meetups_per_month', 'meetups_per_month', 'Meetups each month', null, null, 'self-report heuristic', 'self-reported · n=0', 'only logged hangouts count', 'insufficient_data')]
    : [
        m('meetups_per_month', 'meetups_per_month', 'Meetups each month', pid === 1 ? 2.5 : 6, null, 'self-report heuristic', `self-reported · n=${pid === 1 ? 6 : 11}`, 'only logged hangouts count'),
        m('closeness_trend', 'closeness_trend', 'Closeness over time', pid === 1 ? 0.4 : -0.2, null, 'self-report heuristic', 'no reference band', 'how they felt'),
        m('tension_incidence', 'tension_incidence', 'How often things got tense', pid === 1 ? 0 : 0.27, null, 'self-report heuristic', 'no reference band', 'who was right'),
      ];

const samSafety: SafetyBlock = {
  flags: [
    {
      category: 'monitoring_or_control', severity: 'concern', speaker: 'them', count: 3,
      first_seen: '2026-10-28T21:14:00Z', last_seen: '2026-11-19T23:02:00Z',
      snippets: ['"who were you with tonight, send me a pic"', '"why did you not answer for an hour"'],
    },
  ],
  resources: [
    { name: 'National Domestic Violence Hotline', phone: '1-800-799-7233', text: 'Text START to 88788', url: 'thehotline.org', description: 'Free, confidential support, 24/7.', action: 'suggestion_only' },
    { name: 'love is respect', phone: '1-866-331-9474', text: 'Text LOVEIS to 22522', url: 'loveisrespect.org', description: 'Support for young people about dating relationships.', action: 'suggestion_only' },
    { name: 'Emergency', phone: null, text: null, url: null, description: 'If you are in immediate danger, you can call 911 yourself.', action: 'suggestion_only' },
  ],
  disclaimer: DISCLAIMER,
};

export function overviewFor(pid: number): PersonOverview {
  const p = people.find((x) => x.id === pid)!;
  const potential = p.mode === 'potential';
  const definition = potential ? 'interest is mutual and moves toward dating' : 'still together and satisfied in 3 months';
  const person = { id: p.id, pseudonym: p.pseudonym, mode: p.mode, timezone: 'America/New_York', created_at: '2026-09-01T10:00:00Z' };
  const contrib: Record<number, [string, number][]> = {
    1: [['meetup_initiation_share', 6], ['lsm', 4], ['initiation_share', -5]],
    2: [['lsm', 5], ['plan_follow_through_rate', 4], ['question_rate', -3]],
    3: [],
  };
  return {
    person,
    mode: p.mode,
    generated_at: p.updated_at || ago(5),
    success: {
      mode: p.mode,
      status: p.success.status,
      percent: p.success.percent,
      low: p.success.low,
      high: p.success.high,
      tag: TAG,
      top_contributors: contrib[pid] || [],
      definition,
      calibrated: { status: 'not_available', percent: null, low: null, high: null, n_outcomes: pid === 2 ? 3 : 0, needed: 20 },
    },
    safety: pid === 2 ? samSafety : emptySafety(),
    reciprocity: pid === 1 ? yuReciprocity : pid === 2 ? samReciprocity : jordanReciprocity,
    metrics: otherMetrics(pid),
    interaction_metrics: interactionMetrics(pid),
    scales: pid === 2
      ? [{ scale_id: 'csi16', name: 'Couples Satisfaction Index (CSI-16)', status: 'ok', subscales: { total: 61 }, bands: { total: 'above distress cut-off' }, cutoff_flags: { total: false }, notes: [] }]
      : [],
    weekly:
      pid === 1
        ? weeks('2026-09-01', [22, 28, 35, 41, null, null, 52, 47, 44, 38, 46, 50], [14, 19, 24, 30, null, null, 36, 33, 29, 27, 31, 35])
        : pid === 2
          ? weeks('2026-09-01', [61, 58, 64, 70, 66, 59, 62, null, 57, 63, 60, 65], [64, 60, 61, 66, 69, 62, 58, null, 59, 61, 63, 62])
          : weeks('2026-09-01', [null, null, null, null, null, null, null, null, null, 9, 8, 6], [null, null, null, null, null, null, null, null, null, 7, 6, 5]),
    coverage_ratio: pid === 1 ? 0.83 : pid === 2 ? 0.92 : 0.25,
    skipped_non_english: pid === 2 ? 12 : 0,
    next_steps: steps(pid),
  };
}

export const nextSteps: Record<number, NextStep[]> = { 1: steps(1), 2: steps(2), 3: steps(3) };

export const units: Record<number, Unit[]> = {
  1: [
    { unit_id: 'cap_wa_1', source: 'whatsapp', created_at: ago(2), message_count: 1284, start_ts: '2026-09-01T09:00:00Z', end_ts: ago(2) },
    { unit_id: 'cap_ig_1', source: 'instagram', created_at: ago(60), message_count: 212, start_ts: '2026-09-22T09:00:00Z', end_ts: ago(60) },
  ],
  2: [
    { unit_id: 'cap_dc_2', source: 'discord', created_at: day('2026-11-20'), message_count: 214, start_ts: day('2026-11-20'), end_ts: day('2026-11-20') },
    { unit_id: 'up_wa_2', source: 'whatsapp', created_at: day('2026-11-19'), message_count: 4812, start_ts: '2025-06-01T08:00:00Z', end_ts: day('2026-11-19') },
  ],
  3: [{ unit_id: 'up_txt_3', source: 'plaintext', created_at: day('2026-11-22'), message_count: 41, start_ts: day('2026-11-08'), end_ts: day('2026-11-22') }],
};

export const coverage: Record<number, { source: string; start: string; end: string }[]> = {
  1: [
    { source: 'whatsapp', start: '2026-09-01T00:00:00Z', end: '2026-09-29T00:00:00Z' },
    { source: 'whatsapp', start: '2026-10-13T00:00:00Z', end: ago(2) },
    { source: 'instagram', start: '2026-09-22T00:00:00Z', end: ago(60) },
  ],
  2: [
    { source: 'whatsapp', start: '2025-06-01T00:00:00Z', end: '2026-11-19T00:00:00Z' },
    { source: 'discord', start: '2026-11-20T00:00:00Z', end: '2026-11-21T00:00:00Z' },
  ],
  3: [{ source: 'plaintext', start: '2026-11-08T00:00:00Z', end: '2026-11-22T00:00:00Z' }],
};

export const facts: Record<number, Fact[]> = {
  1: [
    { id: 1, person_id: 1, key: 'how_we_met', value: 'Climbing gym, through a mutual friend', source: 'interview', confidence: 'owner_sure', updated_at: ago(3000) },
    { id: 2, person_id: 1, key: 'meet_frequency', value: 'About twice a month, usually weekends', source: 'interview', confidence: 'owner_sure', updated_at: ago(3000) },
    { id: 3, person_id: 1, key: 'owner_goal', value: 'Find out if it could become dating', source: 'interview', confidence: 'owner_unsure', updated_at: ago(2900) },
  ],
  2: [
    { id: 4, person_id: 2, key: 'relationship_length', value: 'Two and a half years', source: 'interview', confidence: 'owner_sure', updated_at: ago(9000) },
    { id: 5, person_id: 2, key: 'living_situation', value: 'Separate apartments, same neighbourhood', source: 'owner_edit', confidence: 'owner_sure', updated_at: ago(8000) },
  ],
  3: [],
};

export const interactions: Record<number, Interaction[]> = {
  1: [
    { id: 7, person_id: 1, notes: 'Easy conversation, they asked about my sister.', fields: { ts: '2026-11-14T19:00:00Z', place: 'Night market', duration_min: 150, initiated_by: 'me', activity: 'food + walk', closeness_1_7: 5, comfort_1_7: 6, responsiveness: ['asked about me', 'remembered details'], tension: null, affection: null, next_plan_proposed_by: 'me', followed_through_prev: true } },
    { id: 6, person_id: 1, notes: '', fields: { ts: '2026-10-31T16:00:00Z', place: 'Climbing gym', duration_min: 120, initiated_by: 'them', activity: 'bouldering', closeness_1_7: 4, comfort_1_7: 5, responsiveness: ['shared something personal'], tension: null, affection: null, next_plan_proposed_by: 'none', followed_through_prev: null } },
  ],
  2: [
    { id: 8, person_id: 2, notes: 'Small argument about plans, sorted out on the walk home.', fields: { ts: '2026-11-18T20:00:00Z', place: 'Home', duration_min: 240, initiated_by: 'mutual', activity: 'dinner', closeness_1_7: 5, comfort_1_7: 4, responsiveness: ['asked about me'], tension: 'disagreed about weekend plans; resolved', affection: null, next_plan_proposed_by: 'them', followed_through_prev: true } },
  ],
  3: [],
};

export const scales: ScaleDef[] = [
  {
    id: 'csi4', name: 'Couples Satisfaction Index (CSI-4)', mode: ['established'],
    items: [
      // Published wording is never shipped: the real server fills it from a local overlay file.
      { id: 'q1', text: null, display_text: 'Item 1 (text from local overlay)', min: 0, max: 6 },
      { id: 'q2', text: null, display_text: 'Item 2 (text from local overlay)' },
      { id: 'q3', text: null, display_text: 'Item 3 (text from local overlay)' },
      { id: 'q4', text: null, display_text: 'Item 4 (text from local overlay)' },
    ],
    subscales: { total: { items: ['q1', 'q2', 'q3', 'q4'], aggregate: 'sum' } },
    response: { min: 0, max: 5 },
    source: { citation: 'Funk & Rogge, 2007 (item text from the official form, local overlay)' }, item_text: 'local_overlay', verified: true,
    measures: 'overall relationship satisfaction', does_not_measure: 'whether the relationship is safe or will last',
  },
  {
    id: 'reciprocity', name: 'Reciprocity check', mode: ['potential', 'established'],
    items: [
      { id: 'r1', text: 'They start conversations about as often as I do.' },
      { id: 'r2', text: 'They suggest plans to meet up.' },
      { id: 'r3', text: 'They ask me follow-up questions about my life.' },
      { id: 'r4', text: 'They share personal things with me.' },
    ],
    subscales: { balance: { items: ['r1', 'r2', 'r3', 'r4'], aggregate: 'mean' } },
    response: { min: 1, max: 7 },
    source: { citation: 'LoveVectorSpace custom (unverified)' }, item_text: 'inline', verified: false, custom: true,
    measures: 'how mutual the effort feels to you', does_not_measure: 'what the other person feels',
  },
  {
    id: 'cdaq_items', name: 'Controlling behaviours (CDAQ items)', mode: ['established'],
    items: [
      { id: 'c1', text: null, display_text: 'Item 1 (text from local overlay)' },
      { id: 'c2', text: null, display_text: 'Item 2 (text from local overlay)' },
      { id: 'c3', text: null, display_text: 'Item 3 (text from local overlay)' },
    ],
    subscales: { control: { items: ['c1', 'c2', 'c3'], aggregate: 'sum' } },
    response: { min: 0, max: 3 },
    source: { citation: 'CDAQ (item text from the official form, local overlay)', terms: 'research use only' },
    item_text: 'local_overlay', verified: true,
    measures: 'possible controlling behaviours; only feeds the warning block', does_not_measure: 'abuse, or anyone’s intent',
  },
];

export const questionnaireHistory: Record<number, QuestionnaireRecord[]> = {
  1: [{ scale_id: 'reciprocity', submitted_at: '2026-11-10T20:00:00Z', result: { subscales: { balance: 4.5 }, bands: {}, cutoff_flags: {}, status: 'unverified', notes: ['custom scale, no reference band'] } }],
  2: [{ scale_id: 'csi4', submitted_at: '2026-11-02T20:00:00Z', result: { subscales: { total: 15 }, bands: { total: 'above distress cut-off' }, cutoff_flags: { total: false }, status: 'ok', notes: [] } }],
  3: [],
};

export const threads: Record<number, AgentThread[]> = {
  1: [{ id: 101, kind: 'chat', title: 'Planning the next hangout', created_at: ago(200), updated_at: ago(180) }],
  2: [],
  3: [],
};

export const threadMessages: Record<number, AgentMessage[]> = {
  101: [
    { id: 1, role: 'user', content: 'help me plan our next hangout', created_at: ago(200) },
    { id: 2, role: 'tool', content: '{"person":"Yu Cheng","mode":"potential","msgs_30d":412}', tool_calls: [{ name: 'get_person_overview', args: { person_id: 1 } }], created_at: ago(200) },
    { id: 3, role: 'tool', content: '4 plans proposed in 30d: 4 by you, 0 by them', tool_calls: [{ name: 'list_interactions', args: { since: '30d' } }], created_at: ago(200) },
    { id: 4, role: 'assistant', content: "They've accepted 3 of your last 4 plans but proposed none [SELF]. Your message style match is high (0.81) [MOD]. Suggestion: offer one specific, low-pressure plan with a time, for example Saturday market at 11am, and leave room for them to suggest an alternative.\n\nCurrent estimate 64% (range 49–79), uncalibrated estimate: hand-set weights, not fitted to outcomes.", created_at: ago(199) },
  ],
};

export const interviewTopics = {
  potential: [
    { id: 'how_met', label: 'how you met' },
    { id: 'meet_frequency', label: 'how often you meet' },
    { id: 'who_suggests', label: 'who suggests plans' },
    { id: 'want_next', label: 'what you want next' },
    { id: 'signals', label: "signals you've noticed" },
  ],
  established: [
    { id: 'length', label: 'how long together' },
    { id: 'living', label: 'living situation' },
    { id: 'going_well', label: "what's going well" },
    { id: 'disagreements', label: 'recurring disagreements' },
    { id: 'plans', label: 'shared plans' },
  ],
};

export const interviewCovered: Record<number, string[]> = { 1: ['how_met', 'meet_frequency'], 2: ['length', 'living'], 3: [] };

export const tokens: TokenInfo[] = [
  { id: 't1', kind: 'extension', label: 'Chrome on laptop', created_at: '2026-11-02T10:00:00Z', last_used_at: ago(2), revoked_at: null },
  { id: 't2', kind: 'api', label: 'notebook scripts', created_at: '2026-11-05T10:00:00Z', last_used_at: null, revoked_at: null },
];

export const invites: Invite[] = [
  { code: 'LVS-7Q4K-2M', email: 'judge2@demo.lvs', created_at: '2026-11-20T10:00:00Z', expires_at: '2026-12-04T10:00:00Z', used_by: null },
];

export const sessions: SessionInfo[] = [
  { id: 's1', device: 'Firefox on Windows', created_at: ago(600), last_used_at: ago(1), current: true },
  { id: 's2', device: 'LoveVectorSpace on Android', created_at: ago(4000), last_used_at: ago(300), current: false },
];
