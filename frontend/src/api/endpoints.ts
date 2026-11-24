import { acceptAuth, api, clearSession, nativeMode, rawRequest, request, streamAgent } from './client';
import { refreshStore } from './tokens';
import type {
  AgentEvent, AgentMessage, AgentThread, AuthResult, CoverageSpan, Fact, ImportPreview, ImportResult,
  ImportMessagesBody, Interaction, InteractionFields, InterviewProgress, Invite, Job, MetricInfo, NextStep, Person,
  PersonOverview, PersonSummary, QuestionnaireRecord, ScaleDef, ScaleResult, SessionInfo, Settings,
  SpeakerMapping, TokenInfo, Unit, User,
} from './types';

const noRetry = { retry: false } as const;

async function authCall(path: string, json: unknown): Promise<AuthResult> {
  const r = await api.post<AuthResult>(path, json, noRetry);
  await acceptAuth(r);
  return r;
}

export const auth = {
  login: (email: string, password: string) => authCall('/api/auth/login', { email, password }),
  signup: (b: { email: string; password: string; invite_code: string; display_name?: string }) =>
    authCall('/api/auth/signup', b),
  googleToken: (id_token: string, invite_code?: string, nonce?: string) => authCall('/api/auth/google/token', { id_token, invite_code, nonce }),
  appleToken: (id_token: string, invite_code?: string, name?: string, nonce?: string) =>
    authCall('/api/auth/apple/token', { id_token, invite_code, name, nonce }),
  me: () => api.get<User>('/api/auth/me'),
  async logout() {
    try {
      const body = nativeMode() ? { refresh_token: await refreshStore()?.get() } : undefined;
      await api.post<void>('/api/auth/logout', body, noRetry);
    } finally {
      await clearSession();
    }
  },
  verifyEmail: (token: string) => api.post<void>('/api/auth/verify-email', { token }, noRetry),
  resendVerify: () => api.post<void>('/api/auth/verify-email/resend'),
  forgot: (email: string) => api.post<void>('/api/auth/password/forgot', { email }, noRetry),
  reset: (token: string, new_password: string) => api.post<void>('/api/auth/password/reset', { token, new_password }, noRetry),
  change: (current_password: string, new_password: string) =>
    api.post<void>('/api/auth/password/change', { current_password, new_password }),
  sessions: () => api.get<SessionInfo[]>('/api/auth/sessions'),
  revokeSession: (id: string) => api.del<void>(`/api/auth/sessions/${encodeURIComponent(id)}`),
};

export const settingsApi = {
  get: () => api.get<Settings>('/api/settings'),
  put: (s: Partial<Settings>) => api.put<Settings>('/api/settings', s),
};

export const tokensApi = {
  list: () => api.get<TokenInfo[]>('/api/tokens'),
  create: (kind: 'api' | 'extension', label?: string) =>
    api.post<{ token: string; info: TokenInfo }>('/api/tokens', { kind, label }),
  revoke: (id: string) => api.del<void>(`/api/tokens/${encodeURIComponent(id)}`),
};

export const invitesApi = {
  list: () => api.get<Invite[]>('/api/invites'),
  create: (email?: string, expires_days = 14) => api.post<Invite>('/api/invites', { email: email || undefined, expires_days }),
  revoke: (code: string) => api.del<void>(`/api/invites/${encodeURIComponent(code)}`),
};

export const accountApi = {
  async exportData(include_messages: boolean): Promise<Blob> {
    const res = await rawRequest('/api/account/export', { method: 'POST', json: { include_messages } });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },
  remove: (confirm: string, password?: string) => api.del<void>('/api/account', { confirm, password }),
};

export const peopleApi = {
  list: () => api.get<PersonSummary[]>('/api/people'),
  create: (b: { pseudonym: string; mode: 'potential' | 'established'; timezone?: string }) => api.post<Person>('/api/people', b),
  get: (pid: number) => api.get<Person>(`/api/people/${pid}`),
  patch: (pid: number, b: Partial<Pick<Person, 'pseudonym' | 'mode' | 'timezone'>>) => api.patch<Person>(`/api/people/${pid}`, b),
  remove: (pid: number) => api.del<void>(`/api/people/${pid}`),
  preview(pid: number, file: Blob, name = 'chat.txt') {
    const f = new FormData();
    f.append('file', file, name);
    return api.form<ImportPreview>(`/api/people/${pid}/imports/preview`, f);
  },
  importChat(pid: number, b: { file: Blob; name?: string; tz: string; me_names: string[]; match_id?: string; source?: string }) {
    const f = new FormData();
    f.append('file', b.file, b.name || 'chat.txt');
    f.append('tz', b.tz);
    b.me_names.forEach((n) => f.append('me_names', n));
    if (b.match_id) f.append('match_id', b.match_id);
    if (b.source) f.append('source', b.source);
    return api.form<ImportResult>(`/api/people/${pid}/imports`, f);
  },
  /** Structured messages from phone capture (screenshot OCR, Android SMS / notification readers). */
  importMessages: (pid: number, body: ImportMessagesBody) => api.post<ImportResult>(`/api/people/${pid}/imports/messages`, body),
  units: (pid: number) => api.get<Unit[]>(`/api/people/${pid}/units`),
  deleteUnit: (unitId: string) => api.del<{ removed_messages: number }>(`/api/units/${encodeURIComponent(unitId)}`),
  speakers: (pid: number) => api.get<SpeakerMapping[]>(`/api/people/${pid}/speakers`),
  putSpeakers: (pid: number, m: { source: string; speaker_raw: string; role: 'me' | 'them' }[]) =>
    api.put<SpeakerMapping[]>(`/api/people/${pid}/speakers`, m),
  coverage: (pid: number) => api.get<CoverageSpan[]>(`/api/people/${pid}/coverage`),
};

export const analysisApi = {
  overview: (pid: number) => api.get<PersonOverview>(`/api/people/${pid}/overview`),
  analyze: (pid: number) => api.post<{ job_id: number }>(`/api/people/${pid}/analyze`),
  job: (id: number) => api.get<Job>(`/api/jobs/${id}`),
  history: (pid: number, metricId: string) => api.get<{ ts: string; value: number }[]>(`/api/people/${pid}/history/${metricId}`),
  explain: (metricId: string) => api.get<MetricInfo>(`/api/metrics/${encodeURIComponent(metricId)}/explain`),
};

export const scalesApi = {
  list: () => api.get<ScaleDef[]>('/api/scales'),
  submit: (pid: number, scaleId: string, answers: Record<string, number>) =>
    api.post<ScaleResult>(`/api/people/${pid}/questionnaires/${encodeURIComponent(scaleId)}`, { answers }),
  history: (pid: number) => api.get<QuestionnaireRecord[]>(`/api/people/${pid}/questionnaires`),
};

export const contextApi = {
  facts: (pid: number) => api.get<Fact[]>(`/api/people/${pid}/facts`),
  addFact: (pid: number, b: { key: string; value: string; confidence: Fact['confidence'] }) => api.post<Fact>(`/api/people/${pid}/facts`, b),
  patchFact: (id: number, b: { value?: string; confidence?: Fact['confidence'] }) => api.patch<Fact>(`/api/facts/${id}`, b),
  deleteFact: (id: number) => api.del<void>(`/api/facts/${id}`),
  interactions: (pid: number) => api.get<Interaction[]>(`/api/people/${pid}/interactions`),
  addInteraction: (pid: number, fields: InteractionFields, notes: string) =>
    api.post<Interaction>(`/api/people/${pid}/interactions`, { fields, notes }),
  patchInteraction: (id: number, b: Partial<{ fields: Partial<InteractionFields>; notes: string }>) =>
    api.patch<Interaction>(`/api/interactions/${id}`, b),
  deleteInteraction: (id: number) => api.del<void>(`/api/interactions/${id}`),
};

export const stepsApi = {
  list: (pid: number, status = 'open') => api.get<NextStep[]>(`/api/people/${pid}/next-steps?status=${status}`),
  generate: (pid: number) => api.post<{ job_id: number }>(`/api/people/${pid}/next-steps/generate`),
  setStatus: (id: number, status: NextStep['status']) => api.patch<NextStep>(`/api/next-steps/${id}`, { status }),
};

export const agentApi = {
  threads: (pid: number) => api.get<AgentThread[]>(`/api/people/${pid}/agent/threads`),
  createThread: (pid: number, kind: AgentThread['kind']) => api.post<AgentThread>(`/api/people/${pid}/agent/threads`, { kind }),
  thread: (tid: number) => request<{ thread: AgentThread; messages: AgentMessage[] }>(`/api/agent/threads/${tid}`),
  send: (tid: number, text: string, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) =>
    streamAgent(`/api/agent/threads/${tid}/messages`, { text }, onEvent, signal),
  progress: (pid: number) => api.get<InterviewProgress>(`/api/people/${pid}/interview/progress`),
};
