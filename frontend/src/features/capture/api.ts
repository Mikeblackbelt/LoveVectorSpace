// POST /api/people/{pid}/imports/messages (docs/api.md). Kept here rather than in
// api/endpoints.ts so the capture feature stays self-contained.
import { api } from '../../api/client';
import type { ImportResult } from '../../api/types';
import type { AppSlug, ImportMessagesBody, ReaderMethod } from './types';

/** Mirrors the server's SOURCE_RE. */
export const SOURCE_RE = /^(screenshot_import|android_sms|android_(notify|a11y)_[a-z0-9_]{1,30})$/;

export function sourceFor(method: ReaderMethod, app: AppSlug | 'sms'): string {
  if (method === 'sms') return 'android_sms';
  return `android_${method}_${app}`;
}

export type Uploader = (pid: number, body: ImportMessagesBody, signal?: AbortSignal) => Promise<ImportResult>;

export const importMessages: Uploader = (pid, body, signal) => {
  if (!SOURCE_RE.test(body.source)) return Promise.reject(new Error(`Unknown capture source ${body.source}`));
  return api.post<ImportResult>(`/api/people/${pid}/imports/messages`, body, signal ? { signal } : undefined);
};
