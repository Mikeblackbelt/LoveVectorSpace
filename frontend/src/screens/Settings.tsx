import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearSession } from '../api/client';
import { accountApi, auth, invitesApi, settingsApi, tokensApi } from '../api/endpoints';
import { useSession } from '../api/session';
import type { Settings, TokenInfo } from '../api/types';
import { ErrorLine, Key, Loading, Pane } from '../components/Pane';
import { DISCLAIMER } from '../components/Shell';
import { say } from '../components/prompt';
import { ago, ymd } from '../lib/format';
import { L } from '../theme/Plain';
import { useTheme } from '../theme/ThemeProvider';
import { PhoneCapturePane } from '../features/capture';

export const DELETE_PHRASE = 'DELETE MY ACCOUNT';

export function SettingsScreen() {
  const session = useSession();
  const user = session.user;
  return (
    <main className="screen settings-screen">
      <div className="set-grid">
        <Account />
        <ThemeSummary />
        <Agent />
        <Tokens />
        {user?.role === 'admin' && <Invites />}
        <Sessions />
        <DataPane />
        <PhoneCapturePane />
        <Pane id="about" tech="ABOUT" plain="About this app">
          <p>
            <span className="glyph">// </span>
            {DISCLAIMER}
          </p>
          <p className="dimt small">
            <L t="estimates are uncalibrated until ~20 labelled outcomes. safety output is warnings only." p="Estimates are rough until about 20 known outcomes. Safety notes are warnings only." />
          </p>
          <p><Link to="/privacy"><L t="PRIVACY POLICY" p="Privacy policy" /></Link></p>
        </Pane>
      </div>
    </main>
  );
}

function Account() {
  const session = useSession();
  const u = session.user;
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const ch = useMutation({ mutationFn: () => auth.change(cur, nw), onSuccess: () => { setCur(''); setNw(''); say('lvs passwd', '↳ password changed'); } });
  const nav = useNavigate();
  if (!u) return null;
  return (
    <Pane id="acct" tech="ACCOUNT" plain="Your account" meta={<button className="key ghost" type="button" onClick={() => void auth.logout().then(() => nav('/auth/login'))}><L t="LOG OUT" p="Log out" /></button>}>
      <dl className="kv">
        <dt><L t="EMAIL" p="Email" /></dt><dd>{u.email} {u.email_verified ? <span className="ok">✓</span> : <span className="c-me"><L t="(unverified)" p="(not confirmed yet)" /></span>}</dd>
        <dt><L t="NAME" p="Name" /></dt><dd>{u.display_name || '—'}</dd>
        <dt><L t="SIGN-IN" p="Sign-in methods" /></dt><dd>{u.providers.join(', ')}</dd>
        <dt><L t="ROLE" p="Role" /></dt><dd>{u.role}</dd>
      </dl>
      {u.providers.includes('password') && (
        <form className="sub-form" onSubmit={(e) => { e.preventDefault(); if (nw.length >= 12) ch.mutate(); }}>
          <h3 className="lbl"><L t="CHANGE PASSWORD" p="Change password" /></h3>
          <label className="field"><span className="lbl"><L t="CURRENT" p="Current password" /></span><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
          <label className="field"><span className="lbl"><L t="NEW (12+)" p="New password (12+ characters)" /></span><input type="password" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} minLength={12} /></label>
          <ErrorLine error={ch.error} />
          <Key type="submit" tech="CHANGE" plain="Change password" disabled={!cur || nw.length < 12 || ch.isPending} />
        </form>
      )}
    </Pane>
  );
}

function ThemeSummary() {
  const { theme, setting } = useTheme();
  return (
    <Pane id="theme-sum" tech="THEME" plain="Look and feel">
      <p><L t={`ACTIVE ${theme.toUpperCase()} · SETTING ${setting.toUpperCase()}`} p={`Showing ${theme} (setting: ${setting})`} /></p>
      <Link className="key pri" to="/themes"><span className="key-hint">[ T ] </span><L t="OPEN THEMES" p="Choose a theme" /></Link>
    </Pane>
  );
}

function Agent() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const put = useMutation({ mutationFn: (p: Partial<Settings>) => settingsApi.put(p), onSuccess: (s) => { qc.setQueryData(['settings'], s); void qc.invalidateQueries({ queryKey: ['threads'] }); } });
  const s = q.data;
  const toggle = (k: keyof Settings, tech: string, plain: string, hint: [string, string]) => (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={!!s?.[k]} disabled={!s || put.isPending} onChange={(e) => put.mutate({ [k]: e.target.checked } as Partial<Settings>)} />
      <L t={tech} p={plain} />
      <span className="dimt small"> <L t={hint[0]} p={hint[1]} /></span>
    </label>
  );
  return (
    <Pane id="agent" tech="AGENT · GROQ" plain="Chat assistant">
      {q.isLoading && <Loading what="settings" />}
      {toggle('agent_enabled', 'AGENT ENABLED', 'Turn on the chat assistant', ['// off = chat returns agent_unavailable', 'When off, chat is unavailable'])}
      {toggle('agent_reads_text', 'AGENT MAY READ MESSAGE TEXT', 'Let the assistant read message text', ['// off = counts and timings only', 'When off, it only sees counts and timings'])}
      {toggle('catchup_enabled', 'CHECK-IN SUGGESTIONS', 'Suggest check-ins', ['// proposes a check-in card, never a notification', 'Shows a reminder card, never a notification'])}
      <p className="paper note">
        <span className="glyph">[ NOTE ] </span>
        <L
          t="turn on zero data retention (ZDR) in your Groq console so prompts are not stored by the provider."
          p="Tip for the person running this app: turn on zero data retention in the Groq console, so the AI provider stores nothing."
        />
      </p>
      <ErrorLine error={put.error} />
    </Pane>
  );
}

function Tokens() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tokens'], queryFn: tokensApi.list });
  const [kind, setKind] = useState<TokenInfo['kind']>('extension');
  const [label, setLabel] = useState('');
  const [shown, setShown] = useState<{ token: string; info: TokenInfo } | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({ mutationFn: () => tokensApi.create(kind, label || undefined), onSuccess: (r) => { setShown(r); setLabel(''); setCopied(false); void qc.invalidateQueries({ queryKey: ['tokens'] }); } });
  const revoke = useMutation({ mutationFn: (id: string) => tokensApi.revoke(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }) });
  return (
    <Pane id="tokens" tech="TOKENS" plain="Connection keys">
      <p className="dimt small"><L t="// extension tokens: the desktop capture extension. api tokens: your scripts and MCP." p="Extension keys connect the browser extension. API keys are for scripts." /></p>
      {shown && (
        <div className="once" data-testid="token-once">
          <p role="status"><b><L t="NEW TOKEN CREATED — COPY IT NOW, IT IS SHOWN ONCE" p="Key created. Copy it now; you won't see it again." /></b></p>
          {/* the secret is not read out by screen readers; use Copy */}
          <code className="secret" aria-hidden="true">{shown.token}</code>
          <div className="keys">
            <Key tech={copied ? 'COPIED' : 'COPY'} plain={copied ? 'Copied' : 'Copy'} onClick={() => void navigator.clipboard?.writeText(shown.token).then(() => setCopied(true))} />
            <Key variant="ghost" tech="I SAVED IT" plain="Done" onClick={() => setShown(null)} />
          </div>
        </div>
      )}
      {q.isLoading && <Loading what="tokens" />}
      <ul className="facts">
        {q.data?.map((t) => (
          <li key={t.id} className={`fact${t.revoked_at ? ' revoked' : ''}`}>
            <div className="fact-k">{t.kind.toUpperCase()} · {t.label || 'unlabelled'}</div>
            <div className="dimt small">
              created {ymd(t.created_at)} · {t.last_used_at ? `used ${ago(t.last_used_at)} ago` : 'never used'}{t.revoked_at ? ` · revoked ${ymd(t.revoked_at)}` : ''}
            </div>
            {!t.revoked_at && <Key variant="ghost" tech="REVOKE" plain="Revoke" label={`Revoke ${t.label || t.kind} token`} onClick={() => revoke.mutate(t.id)} />}
          </li>
        ))}
      </ul>
      <form className="sub-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="field" role="radiogroup" aria-label="Token kind">
          {(['extension', 'api'] as const).map((k) => (
            <label className="radio-inline" key={k}><input type="radio" name="tok-kind" checked={kind === k} onChange={() => setKind(k)} /> {k}</label>
          ))}
        </div>
        <label className="field"><span className="lbl"><L t="LABEL" p="Label" /></span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. laptop" /></label>
        <ErrorLine error={create.error || revoke.error} />
        <Key type="submit" variant="pri" tech="CREATE TOKEN" plain="Create key" disabled={create.isPending} />
      </form>
    </Pane>
  );
}

function Invites() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invites'], queryFn: invitesApi.list });
  const [email, setEmail] = useState('');
  const create = useMutation({ mutationFn: () => invitesApi.create(email || undefined), onSuccess: () => { setEmail(''); void qc.invalidateQueries({ queryKey: ['invites'] }); } });
  const revoke = useMutation({ mutationFn: (c: string) => invitesApi.revoke(c), onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }) });
  return (
    <Pane id="invites" tech="INVITES · ADMIN" plain="Invite people">
      <ul className="facts">
        {q.data?.map((i) => (
          <li key={i.code} className="fact">
            <div className="fact-k"><code>{i.code}</code> {i.email && <span className="dimt">· {i.email}</span>}</div>
            <div className="dimt small">expires {ymd(i.expires_at)} · {i.used_by ? `used by ${i.used_by}` : 'unused'}</div>
            {!i.used_by && <Key variant="ghost" tech="REVOKE" plain="Revoke" label={`Revoke invite ${i.code}`} onClick={() => revoke.mutate(i.code)} />}
          </li>
        ))}
      </ul>
      <form className="sub-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <label className="field"><span className="lbl"><L t="EMAIL (OPTIONAL)" p="Email (optional)" /></span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <ErrorLine error={create.error || revoke.error} />
        <Key type="submit" variant="pri" tech="CREATE INVITE" plain="Create invite" disabled={create.isPending} />
      </form>
    </Pane>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sessions'], queryFn: auth.sessions });
  const revoke = useMutation({ mutationFn: (id: string) => auth.revokeSession(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  return (
    <Pane id="sessions" tech="SESSIONS" plain="Signed-in devices">
      <ul className="facts">
        {q.data?.map((s) => (
          <li key={s.id} className="fact">
            <div className="fact-k">{s.device} {s.current && <span className="ok"><L t="· THIS DEVICE" p="(this device)" /></span>}</div>
            <div className="dimt small">signed in {ymd(s.created_at)} · active {ago(s.last_used_at)} ago</div>
            {!s.current && <Key variant="ghost" tech="SIGN OUT" plain="Sign out" label={`Sign out ${s.device}`} onClick={() => revoke.mutate(s.id)} />}
          </li>
        ))}
      </ul>
      <ErrorLine error={revoke.error} />
    </Pane>
  );
}

function DataPane() {
  const session = useSession();
  const nav = useNavigate();
  const [withMsgs, setWithMsgs] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [pw, setPw] = useState('');
  const needsPw = !!session.user?.providers.includes('password');
  const exp = useMutation({
    mutationFn: () => accountApi.exportData(withMsgs),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lovevectorspace-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say('lvs account export', '↳ export downloaded');
    },
  });
  const del = useMutation({
    mutationFn: () => accountApi.remove(phrase, needsPw ? pw : undefined),
    onSuccess: async () => {
      await clearSession();
      nav('/auth/login', { replace: true });
    },
  });
  const ready = phrase === DELETE_PHRASE && (!needsPw || pw.length > 0);
  return (
    <Pane id="data" tech="YOUR DATA" plain="Export or delete">
      <h3 className="lbl"><L t="1 · EXPORT" p="Step 1: download a copy" /></h3>
      <label className="toggle"><input type="checkbox" checked={withMsgs} onChange={(e) => setWithMsgs(e.target.checked)} /> <L t="INCLUDE RAW MESSAGES" p="Include the messages themselves" /></label>
      <Key tech="EXPORT JSON" plain="Download my data" onClick={() => exp.mutate()} disabled={exp.isPending} />
      <ErrorLine error={exp.error} />
      <h3 className="lbl danger-h"><L t="2 · DELETE ACCOUNT" p="Step 2: delete my account" /></h3>
      <p className="small">
        <L t="hard-deletes your encrypted database, your account and every token. this cannot be undone." p="This permanently deletes everything: your data, your account and your keys. It can't be undone." />
      </p>
      <form className="sub-form" onSubmit={(e) => { e.preventDefault(); if (ready) del.mutate(); }}>
        <label className="field">
          <span className="lbl"><L t={`TYPE "${DELETE_PHRASE}"`} p={`Type "${DELETE_PHRASE}" to confirm`} /></span>
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" aria-label={`Type ${DELETE_PHRASE} to confirm`} />
        </label>
        {needsPw && (
          <label className="field"><span className="lbl"><L t="PASSWORD" p="Password" /></span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>
        )}
        <ErrorLine error={del.error} />
        <button className="key danger" type="submit" disabled={!ready || del.isPending}>
          <L t="DELETE EVERYTHING" p="Delete my account" />
        </button>
      </form>
    </Pane>
  );
}
