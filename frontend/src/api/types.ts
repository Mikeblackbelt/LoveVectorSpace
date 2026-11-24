// Shapes from docs/api.md (binding contract). Where api.md names a shape without
// defining it (ScaleDef, ScaleResult, Fact, Interaction, SpeakerMapping) the fields
// follow the backend pydantic models in src/analyzer (see README "Assumed shapes").

export type ThemeName = 'signal' | 'pulse' | 'riso' | 'blueprint' | 'journal' | 'matcha' | 'midnight' | 'inkwell' | 'crt';
export type ThemeSetting = ThemeName | 'auto';

export interface ApiErrorBody {
  error: { code: string; message: string; field?: string };
}

export interface User {
  id: string;
  email: string;
  email_verified: boolean;
  display_name: string | null;
  role: 'admin' | 'user';
  providers: ('password' | 'google' | 'apple')[];
  created_at: string;
}

export interface AuthResult {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  user: User;
}

export interface SessionInfo {
  id: string;
  device: string;
  created_at: string;
  last_used_at: string;
  current: boolean;
}

export interface AutoTheme {
  mode: 'system' | 'time';
  day: ThemeName;
  night: ThemeName;
  day_start: string;
  day_end: string;
}

export interface Settings {
  theme: ThemeSetting;
  auto_theme: AutoTheme;
  reduce_motion: boolean;
  contrast_boost: boolean;
  text_size: 's' | 'm' | 'l';
  owner_timezone: string | null;
  agent_enabled: boolean;
  agent_reads_text: boolean;
  catchup_enabled: boolean;
}

export interface TokenInfo {
  id: string;
  kind: 'api' | 'extension';
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface Invite {
  code: string;
  email: string | null;
  created_at: string;
  expires_at: string;
  used_by: string | null;
}

export type Mode = 'potential' | 'established';
export type Severity = 'none' | 'info' | 'concern' | 'urgent';

export interface SourceStatus {
  source: string;
  last_sync: string | null;
  health: 'ok' | 'stale' | 'needs_update';
}

export interface PersonSummary {
  id: number;
  pseudonym: string;
  mode: Mode | string;
  sources: SourceStatus[];
  success: { percent: number | null; low: number | null; high: number | null; status: 'ok' | 'insufficient_data' };
  safety: Severity;
  updated_at: string | null;
}

export interface Person {
  id: number;
  pseudonym: string;
  mode: Mode | string;
  timezone: string | null;
  created_at: string;
}

export interface MatchInfo {
  match_id: string;
  label: string;
  first_ts: string | null;
  last_ts: string | null;
  message_count: number;
  one_sided: boolean;
}

/** Chat formats return speakers/lines; dating formats (tinder, hinge, grindr, bumble) return matches. */
export interface ImportPreview {
  format: string;
  speakers?: string[];
  lines?: number;
  matches?: MatchInfo[];
  one_sided: boolean;
}

export const DATING_FORMATS = ['tinder', 'hinge', 'grindr', 'bumble'];

/** POST /api/people/{pid}/imports/messages (phone capture: screenshots, Android readers). */
export interface ImportMessagesBody {
  source: string;
  tz: string;
  messages: { ts_local?: string; ts_utc?: string; ts_precision: 'second' | 'minute' | 'approx'; role: 'me' | 'them'; text: string }[];
}

export interface ImportResult {
  unit_id: string;
  added: number;
  merged: number;
  skipped_non_english: number;
  one_sided: boolean;
  job_id: number;
}

export interface Unit {
  unit_id: string;
  source: string;
  created_at: string;
  message_count: number;
  start_ts: string | null;
  end_ts: string | null;
}

export interface SpeakerMapping {
  person_id?: number;
  source: string;
  speaker_raw: string;
  role: 'me' | 'them';
}

export interface CoverageSpan {
  source: string;
  start: string;
  end: string;
}

export type Evidence = 'moderate' | 'heuristic' | 'descriptive' | 'self-report heuristic';

export interface Metric {
  id: string;
  label: string;
  plain_label: string;
  value: number | null;
  per_speaker: { me: number; them: number } | null;
  evidence: Evidence | string;
  status: 'ok' | 'insufficient_data';
  note: string;
  band: string;
}

export interface SuccessEstimate {
  mode: string;
  status: 'ok' | 'insufficient_data';
  percent: number | null;
  low: number | null;
  high: number | null;
  tag: string;
  top_contributors: [string, number][];
  definition: string;
  calibrated: {
    status: 'not_available' | 'ok';
    percent: number | null;
    low: number | null;
    high: number | null;
    n_outcomes: number;
    needed: number;
  };
}

export interface SafetyFlag {
  category: string;
  severity: 'info' | 'concern' | 'urgent';
  speaker: 'me' | 'them' | 'owner_report';
  count: number;
  first_seen: string;
  last_seen: string;
  snippets: string[];
}

export interface SafetyResource {
  name: string;
  phone?: string | null;
  text?: string | null;
  url?: string | null;
  description?: string | null;
  action: 'suggestion_only';
}

export interface SafetyBlock {
  flags: SafetyFlag[];
  resources: SafetyResource[];
  disclaimer: string;
}

export interface ScaleSummary {
  scale_id: string;
  name: string;
  status: string;
  subscales: Record<string, number | null>;
  bands: Record<string, string>;
  cutoff_flags: Record<string, boolean>;
  notes: string[];
}

export interface WeekPoint {
  week: string;
  me: number | null;
  them: number | null;
  covered: boolean;
}

export interface NextStep {
  id: number;
  kind: 'talk' | 'plan' | 'reflect' | 'pause';
  title: string;
  why: string;
  evidence_refs: string[];
  status: 'open' | 'done' | 'dismissed';
  created_at: string;
}

export interface PersonOverview {
  person: Person;
  mode: string;
  generated_at: string;
  success: SuccessEstimate;
  safety: SafetyBlock;
  reciprocity: Metric[];
  metrics: Metric[];
  interaction_metrics: Metric[];
  scales: ScaleSummary[];
  weekly: WeekPoint[];
  coverage_ratio: number;
  skipped_non_english: number;
  next_steps: NextStep[];
}

export interface Job {
  id: number;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'error';
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface MetricInfo {
  id: string;
  measures: string;
  evidence: string;
  caveats: string;
  citation: string;
}

export interface ScaleItem {
  id: string;
  text: string | null;
  display_text?: string | null;
  reverse?: boolean;
  optional?: boolean;
  min?: number | null;
  max?: number | null;
}

export interface ScaleDef {
  id: string;
  name: string;
  mode: string[];
  items: ScaleItem[];
  subscales: Record<string, { items: string[]; aggregate: 'sum' | 'mean' }>;
  response: { min: number; max: number };
  source: { citation: string; url?: string | null; terms?: string | null };
  item_text?: 'inline' | 'local_overlay';
  measures?: string;
  does_not_measure?: string;
  verified?: boolean;
}

export interface ScaleResult {
  subscales: Record<string, number | null>;
  bands: Record<string, string>;
  cutoff_flags: Record<string, boolean>;
  status: 'ok' | 'draft' | 'unverified';
  notes: string[];
}

export interface QuestionnaireRecord {
  scale_id: string;
  submitted_at: string;
  result: ScaleResult;
}

export interface Fact {
  id: number;
  person_id?: number;
  key: string;
  value: string;
  source?: 'interview' | 'checkin' | 'owner_edit';
  confidence: 'owner_sure' | 'owner_unsure';
  updated_at?: string;
}

export interface InteractionFields {
  ts: string;
  place?: string | null;
  duration_min?: number | null;
  initiated_by: 'me' | 'them' | 'mutual';
  activity?: string | null;
  closeness_1_7: number;
  comfort_1_7: number;
  responsiveness: string[];
  tension?: string | null;
  affection?: string | null;
  next_plan_proposed_by: 'me' | 'them' | 'none';
  followed_through_prev: boolean | null;
}

export interface Interaction {
  id: number;
  person_id?: number;
  fields: InteractionFields;
  notes: string;
}

export interface AgentThread {
  id: number;
  kind: 'chat' | 'interview' | 'checkin';
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AgentMessage {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { name: string; args?: Record<string, unknown> }[] | null;
  created_at: string;
}

export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; summary: string }
  | { type: 'done'; message_id: number }
  | { type: 'error'; code: string; message: string };

export interface InterviewProgress {
  covered: string[];
  open: string[];
  topics: { id: string; label: string }[];
}

export interface LiveEvent {
  type: 'snapshot' | 'job' | 'next_steps' | 'ingest';
  person_id: number;
  [k: string]: unknown;
}
