import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, refreshOnce } from '../api/client';
import { API_MODE } from '../api/config';
import { auth } from '../api/endpoints';
import { signInWithApple, signInWithGoogle } from '../api/social';
import { Footer } from '../components/Shell';
import { ThemePopover } from '../components/ThemePopover';
import { haptic } from '../native/native';
import { L } from '../theme/Plain';
import { useTheme } from '../theme/ThemeProvider';

type Tab = 'login' | 'signup' | 'reset';

function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/auth') ? raw : '/people';
}

function msg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'rate_limited') return `Too many attempts. Try again in ${e.retryAfter ?? 60} seconds.`;
    if (e.status === 401) return 'Email or password is incorrect.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong. Try again.';
}

function strength(pw: string): { frac: number; word: string } {
  let s = 0;
  if (pw.length >= 12) s += 2;
  if (pw.length >= 16) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1;
  if (/\d/.test(pw)) s += 0.5;
  if (/[^A-Za-z0-9]/.test(pw)) s += 0.5;
  const frac = Math.min(1, s / 5);
  return { frac, word: pw.length < 12 ? 'too short' : frac < 0.6 ? 'ok' : 'strong' };
}

function Field({ id, label, children, hint, err }: { id: string; label: ReactNode; children: ReactNode; hint?: ReactNode; err?: string | null }) {
  return (
    <div className="f">
      <label className="lbl" htmlFor={id}>{label}</label>
      <div className={`in${err ? ' bad' : ''}`}>
        <span className="pr glyph">›</span>
        {children}
      </div>
      {hint}
      {err && <div className="err" role="alert"><span className="glyph">[ ERR ] </span>{err}</div>}
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, describedBy }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; describedBy?: string }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} aria-describedby={describedBy} required />
      <button type="button" className="tg" aria-pressed={show} onClick={() => setShow(!show)}>
        <span className="key-hint">[ ? ] </span>
        {show ? <L t="HIDE" p="Hide" /> : <L t="SHOW" p="Show" />}
      </button>
    </>
  );
}

function Meter({ pw, id }: { pw: string; id: string }) {
  const s = strength(pw);
  return (
    <div className={`meter ${s.frac >= 0.6 ? 'acc' : 'dim'}`} id={id} aria-live="polite">
      <span className="glyph">{'█'.repeat(Math.round(s.frac * 10))}{'░'.repeat(10 - Math.round(s.frac * 10))} </span>
      <span className="pbar" aria-hidden="true"><b style={{ width: `${s.frac * 100}%` }} /></span>
      {s.word}
    </div>
  );
}

function GoogleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 12.2h-8.2" /><path d="M19 6.6A8 8 0 1 0 20.3 13" /></svg>;
}
function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="fl" d="M12 8.2c-.9 0-1.7.5-2.5.5C7.9 8.7 6 10.1 6 13.4 6 16.9 8.4 20.2 10 20.2c.8 0 1.2-.5 2-.5s1.2.5 2 .5c1.4 0 3.1-2.5 3.7-4.4-1.8-.8-2.5-3.7-.3-5.2-.8-1-1.9-1.5-3-1.5-1 0-1.6.6-2.4.6z" />
      <path className="fl" d="M14.6 4c.1 1.1-.4 2.1-1 2.8-.7.7-1.6 1.1-2.4 1-.1-1 .4-2 1-2.7.7-.7 1.7-1.1 2.4-1.1z" />
    </svg>
  );
}

/** Google + Apple buttons with invite_required handling (new social users need an invite). */
function SocialButtons({ next, invite }: { next: string; invite?: string }) {
  const nav = useNavigate();
  const [needInvite, setNeedInvite] = useState(false);
  const [code, setCode] = useState(invite || '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (which: 'google' | 'apple') => {
    setErr(null);
    setBusy(true);
    haptic();
    try {
      const r = which === 'google' ? await signInWithGoogle(next, code || undefined) : await signInWithApple(code || undefined);
      if (r) nav(next, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invite_required') {
        setNeedInvite(true);
        setErr('This looks like a new account. Enter your invite code, then try again.');
      } else setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="or" aria-hidden="true"><span className="ln">────────────────────────</span><L t="OR" p="or" /><span className="ln">────────────────────────</span></div>
      {needInvite && (
        <Field id={`soc-code-${next.length}`} label="Invite code">
          <input id={`soc-code-${next.length}`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} />
        </Field>
      )}
      <button className="btn out" type="button" disabled={busy} onClick={() => void run('google')}>
        <GoogleIcon /><span className="glyph">[ </span>Continue with Google<span className="glyph"> ]</span>
      </button>
      <button className="btn out" type="button" disabled={busy} onClick={() => void run('apple')}>
        <AppleIcon /><span className="glyph">[ </span>Continue with Apple<span className="glyph"> ]</span>
      </button>
      {err && <div className="err" role="alert"><span className="glyph">[ ERR ] </span>{err}</div>}
    </>
  );
}

function LoginPane({ on, next }: { on: boolean; next: string }) {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className={`apane${on ? ' on' : ''}`} id="pane-login" role="tabpanel" aria-labelledby="tab-login">
      <span className="ttl"><span className="glyph">┌─[ L ] </span><L t="LOGIN" p="Log in" /><span className="glyph"> ─┐</span></span>
      <h2 className="acc"><span className="glyph">&gt; </span><L t="auth --login" p="Welcome back" /></h2>
      <p className="cmt"><span className="glyph">// </span><L t="welcome back. your store unlocks on login." p="Your private notes unlock when you log in." /></p>
      {API_MODE === 'mock' && (
        <p className="cmt demo-note"><span className="glyph">// </span>demo mode: any email and password signs you in.</p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          setBusy(true);
          try {
            await auth.login(email.trim(), pw);
            haptic();
            nav(next, { replace: true });
          } catch (ex) {
            setErr(msg(ex));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field id="l-email" label="Email">
          <input id="l-email" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field id="l-pw" label="Password" err={err}>
          <PasswordInput id="l-pw" value={pw} onChange={setPw} autoComplete="current-password" />
        </Field>
        <button className="btn pri" type="submit" disabled={busy}><span className="key-hint">[ ENTER ] </span>Log in</button>
      </form>
      <SocialButtons next={next} />
      <div className="links">
        <Link to="/auth/forgot"><L t="forgot password?" p="Forgot your password?" /></Link>
        <Link to="/auth/signup"><L t="have an invite? sign up" p="Have an invite? Sign up" /></Link>
      </div>
    </section>
  );
}

function SignupPane({ on, next }: { on: boolean; next: string }) {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [code, setCode] = useState(sp.get('invite') || sp.get('code') || '');
  const [email, setEmail] = useState(sp.get('email') || '');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<{ field?: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <section className={`apane${on ? ' on' : ''}`} id="pane-signup" role="tabpanel" aria-labelledby="tab-signup">
      <span className="ttl"><span className="glyph">┌─[ S ] </span><L t="SIGN UP" p="Sign up" /><span className="glyph"> ─┐</span></span>
      <h2 className="acc"><span className="glyph">&gt; </span><L t="auth --invite" p="Join with an invite" /></h2>
      <p className="cmt"><span className="glyph">// </span><L t="access is by invite code only." p="You need an invite code to join." /></p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 12) return setErr({ field: 'password', text: 'Password must be at least 12 characters.' });
          if (pw !== pw2) return setErr({ field: 'confirm', text: 'Passwords do not match.' });
          setErr(null);
          setBusy(true);
          try {
            await auth.signup({ email: email.trim(), password: pw, invite_code: code.trim(), display_name: name.trim() || undefined });
            haptic();
            nav(next, { replace: true });
          } catch (ex) {
            const f = ex instanceof ApiError ? ex.field : undefined;
            setErr({ field: f === 'invite_code' || (ex instanceof ApiError && ex.code === 'invite_required') ? 'invite_code' : f, text: msg(ex) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field id="s-code" label="Invite code" err={err?.field === 'invite_code' ? err.text : null}>
          <input id="s-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} required />
        </Field>
        <Field id="s-email" label="Email" err={err?.field === 'email' ? err.text : null}>
          <input id="s-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field id="s-name" label={<L t="Name (optional)" p="What should we call you? (optional)" />}>
          <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={60} />
        </Field>
        <Field id="s-pw" label="Password (12+ characters)" hint={<Meter pw={pw} id="s-meter" />} err={err?.field === 'password' ? err.text : null}>
          <PasswordInput id="s-pw" value={pw} onChange={setPw} autoComplete="new-password" describedBy="s-meter" />
        </Field>
        <Field
          id="s-pw2"
          label="Confirm password"
          hint={pw2 && !mismatch ? <div className="hint ok">✓ matches</div> : null}
          err={mismatch ? 'Passwords do not match.' : err?.field === 'confirm' ? err.text : null}
        >
          <input id="s-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
        </Field>
        {err && !['invite_code', 'email', 'password', 'confirm'].includes(err.field || '') && (
          <div className="err" role="alert"><span className="glyph">[ ERR ] </span>{err.text}</div>
        )}
        <button className="btn pri" type="submit" disabled={busy}><span className="key-hint">[ ENTER ] </span>Create account</button>
      </form>
      <SocialButtons next={next} invite={code} />
      <p className="fine"><span className="glyph">// </span><L t="your data is encrypted per account. you can delete everything at any time in SET." p="Your data is encrypted for your account only. You can delete everything at any time in Settings." /></p>
      <div className="links"><Link to="/auth/login"><L t="already registered? log in" p="Already have an account? Log in" /></Link></div>
    </section>
  );
}

function ResetRequestPane({ on }: { on: boolean }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className={`apane${on ? ' on' : ''}`} id="pane-reset" role="tabpanel" aria-labelledby="tab-reset">
      <span className="ttl"><span className="glyph">┌─[ R ] </span><L t="RESET" p="Reset password" /><span className="glyph"> ─┐</span></span>
      <h2 className="acc"><span className="glyph">&gt; </span><L t="auth --reset" p="Reset your password" /></h2>
      <p className="cmt"><span className="glyph">// </span><L t="step 1 of 2 · we email a one-time link." p="Step 1 of 2: we'll email you a one-time link." /></p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await auth.forgot(email.trim());
            setSent(email.trim());
          } catch (ex) {
            setErr(msg(ex));
          }
        }}
      >
        <Field id="r-email" label="Email" err={err}>
          <input id="r-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <button className="btn pri" type="submit"><span className="key-hint">[ ENTER ] </span>Send reset link</button>
      </form>
      {sent && (
        <div className="log" role="status">
          <p className="ok"><span className="glyph">&gt; </span><L t={`if ${sent} has an account, a reset link is on its way · expires in 30 min`} p={`If ${sent} has an account, we sent a reset link. It expires in 30 minutes.`} /></p>
          <p className="dim"><span className="glyph">&gt; </span><L t="not there? check spam" p="Not there? Check your spam folder." /></p>
        </div>
      )}
      <div className="links"><Link to="/auth/login"><L t="back to login" p="Back to log in" /></Link></div>
    </section>
  );
}

function AuthFrame({ children, tab }: { children: ReactNode; tab?: Tab }) {
  const { popoverOpen, setPopoverOpen } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const qs = loc.search;
  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'l') nav('/auth/login' + qs);
      else if (k === 's') nav('/auth/signup' + qs);
      else if (k === 'r') nav('/auth/forgot' + qs);
      else if (k === 'escape') setPopoverOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tab, nav, qs, setPopoverOpen]);
  return (
    <div className="auth-root">
      <div className="layer auth-wrap">
        <div className="sbar">
          <span className="acc"><L t="LVS-AUTH v0.3" p="Welcome" /></span>
          <span className="mid glyph">TTY1 · 80×24 · SECURE</span>
          <span className="ok"><L t="● SECURE LINE" p="● Secure connection" /></span>
        </div>
        <header className="hero">
          <svg viewBox="0 0 640 260" preserveAspectRatio="xMaxYMid meet" aria-hidden="true" focusable="false">
            <defs>
              <marker id="ma" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path className="f-me" d="M0 0L10 5L0 10z" /></marker>
              <marker id="mi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path className="f-them" d="M0 0L10 5L0 10z" /></marker>
              <marker id="mr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path className="f-link" d="M0 0L10 5L0 10z" /></marker>
            </defs>
            <g className="s-rule" strokeWidth="1" fill="none" opacity=".9"><path d="M20 236H620M60 250L120 214M200 250L230 214M340 250L340 214M480 250L450 214M600 250L560 214M20 214H620" /></g>
            <g strokeWidth="1" strokeDasharray="3 5" opacity=".7">
              <path className="s-me" d="M290 70V226" /><path className="s-them" d="M400 130V226" /><path className="s-me" d="M500 52V226" /><path className="s-them" d="M430 196V226" /><path className="s-link" d="M300 214V226" />
            </g>
            <g strokeWidth="3" fill="none" strokeLinecap="square">
              <path className="s-me" d="M170 168L286 72" markerEnd="url(#ma)" />
              <path className="s-them" d="M290 70L396 130" markerEnd="url(#mi)" />
              <path className="s-me" d="M400 130L496 56" markerEnd="url(#ma)" />
              <path className="s-them" d="M500 52L428 192" markerEnd="url(#mi)" />
              <path className="s-link" d="M430 196L306 212" markerEnd="url(#mr)" />
              <path className="s-link" d="M300 214L176 172" markerEnd="url(#mr)" />
            </g>
            <g className="f-bg" strokeWidth="1.5">
              <circle className="s-me" cx="290" cy="70" r="4" /><circle className="s-them" cx="400" cy="130" r="4" /><circle className="s-me" cx="500" cy="52" r="4" /><circle className="s-them" cx="430" cy="196" r="4" /><circle className="s-link" cx="300" cy="214" r="4" />
            </g>
            <rect className="f-text" x="166" y="166" width="8" height="8" />
            <g className="svt" fontSize="10">
              <text x="196" y="108">v1 = ( 0.42, 1.10, 0.87 )</text>
              <text x="408" y="100">v3 = ( 0.96, 0.73, -0.31 )</text>
              <text x="130" y="192">( 0, 0, 0 )  Σv = 0</text>
            </g>
          </svg>
          <div className="txt">
            <h1 className="wm"><span>LoveVectorSpace</span><span className="cur glyph" aria-hidden="true" /></h1>
            <p className="sub"><span className="glyph">// </span><L t="invite-only · hackathon demo build" p="Invite-only preview" /></p>
          </div>
        </header>
        {tab && (
          <div className="tabbar">
            <div className="tabs" role="tablist" aria-label="Access mode">
              {(
                [
                  ['login', 'L', 'LOGIN', 'Log in', '/auth/login'],
                  ['signup', 'S', 'SIGN UP', 'Sign up', '/auth/signup'],
                  ['reset', 'R', 'RESET', 'Reset password', '/auth/forgot'],
                ] as const
              ).map(([id, k, t, p, to]) => (
                <button key={id} className="tab" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`pane-${id}`} type="button" onClick={() => nav(to + qs)}>
                  <span className="key-hint">[ {k} ] </span><L t={t} p={p} />
                </button>
              ))}
            </div>
            <button className="tbtn" type="button" data-theme-toggle aria-haspopup="true" aria-expanded={popoverOpen} aria-controls="theme-pop" onClick={() => setPopoverOpen(!popoverOpen)}>
              <span className="key-hint">[ T ] </span><L t="THEME" p="Theme" />
            </button>
          </div>
        )}
        <ThemePopover />
        {children}
        <div className="prompt glyph"><span className="dim">guest@lvs:~/auth $</span> <span className="acc">{tab || 'auth'}</span><span className="cur" aria-hidden="true" /></div>
        <Footer>
          <nav className="foot-links"><Link to="/privacy">privacy</Link></nav>
        </Footer>
      </div>
    </div>
  );
}

export function AuthScreen({ tab }: { tab: Tab }) {
  const [sp] = useSearchParams();
  const next = safeNext(sp.get('next'));
  return (
    <AuthFrame tab={tab}>
      <main className="agrid">
        <LoginPane on={tab === 'login'} next={next} />
        <SignupPane on={tab === 'signup'} next={next} />
        <ResetRequestPane on={tab === 'reset'} />
      </main>
    </AuthFrame>
  );
}

/** /auth/reset?token=… — the second step, from the emailed link. */
export function ResetScreen() {
  const [sp] = useSearchParams();
  const token = sp.get('token') || '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  return (
    <AuthFrame>
      <main className="agrid one">
        <section className="apane on" aria-labelledby="t-reset2">
          <span className="ttl"><span className="glyph">┌─[ R ] </span><L t="NEW PASSWORD" p="New password" /><span className="glyph"> ─┐</span></span>
          <h2 className="acc" id="t-reset2"><span className="glyph">&gt; </span><L t="auth --reset --step 2" p="Choose a new password" /></h2>
          {!token && <div className="err" role="alert">This reset link is missing its token. Request a new one.</div>}
          {done ? (
            <div className="log" role="status">
              <p className="ok"><span className="glyph">&gt; </span><L t="password updated · all sessions signed out" p="Password updated. You've been signed out everywhere." /></p>
              <Link to="/auth/login"><L t="log in" p="Log in" /></Link>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (pw.length < 12) return setErr('Password must be at least 12 characters.');
                if (pw !== pw2) return setErr('Passwords do not match.');
                setErr(null);
                try {
                  await auth.reset(token, pw);
                  setDone(true);
                } catch (ex) {
                  setErr(msg(ex));
                }
              }}
            >
              <Field id="r-pw" label="New password" hint={<Meter pw={pw} id="r-meter" />} err={err}>
                <PasswordInput id="r-pw" value={pw} onChange={setPw} autoComplete="new-password" describedBy="r-meter" />
              </Field>
              <Field id="r-pw2" label="Confirm new password">
                <input id="r-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
              </Field>
              <button className="btn pri" type="submit" disabled={!token}><span className="key-hint">[ ENTER ] </span>Set new password</button>
            </form>
          )}
          <div className="links"><Link to="/auth/login"><L t="back to login" p="Back to log in" /></Link></div>
        </section>
      </main>
    </AuthFrame>
  );
}

/** /auth/verify?token=… — confirms the email address. */
export function VerifyScreen() {
  const [sp] = useSearchParams();
  const token = sp.get('token') || '';
  const [state, setState] = useState<'busy' | 'ok' | 'err'>('busy');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!token) {
      setState('err');
      setErr('This link is missing its token.');
      return;
    }
    auth.verifyEmail(token).then(
      () => setState('ok'),
      (e) => {
        setState('err');
        setErr(msg(e));
      },
    );
  }, [token]);
  return (
    <AuthFrame>
      <main className="agrid one">
        <section className="apane on" role="status">
          <span className="ttl"><span className="glyph">┌─[ </span><L t="VERIFY EMAIL" p="Confirm your email" /><span className="glyph"> ]─┐</span></span>
          {state === 'busy' && <p className="cmt"><L t="> verifying …" p="Confirming…" /></p>}
          {state === 'ok' && <p className="ok"><span className="glyph">&gt; </span><L t="email verified · ok" p="Thanks, your email is confirmed." /></p>}
          {state === 'err' && <div className="err" role="alert">{err} <L t="request a new link from SET." p="You can ask for a new link in Settings." /></div>}
          <div className="links"><Link to="/people"><L t="continue" p="Continue" /></Link></div>
        </section>
      </main>
    </AuthFrame>
  );
}

const SOCIAL_ERR: Record<string, string> = {
  invite_required: 'New accounts need an invite. Sign up with your invite code first, then link Google from the same email.',
  access_denied: 'Google sign-in was cancelled.',
};

/** /auth/complete#ok | #error=<code> — landing after the Google web redirect. */
export function AuthComplete() {
  const nav = useNavigate();
  const loc = useLocation();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const h = loc.hash.replace(/^#/, '');
    const p = new URLSearchParams(h);
    const code = p.get('error');
    if (code) {
      setErr(SOCIAL_ERR[code] || `Sign-in failed (${code}). Try again.`);
      return;
    }
    const next = safeNext(new URLSearchParams(loc.search).get('redirect'));
    refreshOnce().then((r) => (r ? nav(next, { replace: true }) : setErr('Could not finish signing in. Try again.')));
  }, [loc.hash, loc.search, nav]);
  return (
    <AuthFrame>
      <main className="agrid one">
        <section className="apane on" role="status">
          <span className="ttl"><span className="glyph">┌─[ </span>SIGN-IN<span className="glyph"> ]─┐</span></span>
          {err ? (
            <>
              <div className="err" role="alert">{err}</div>
              <div className="links"><Link to="/auth/login">back to login</Link><Link to="/auth/signup">sign up with an invite</Link></div>
            </>
          ) : (
            <p className="cmt"><L t="> finishing sign-in …" p="Finishing sign-in…" /></p>
          )}
        </section>
      </main>
    </AuthFrame>
  );
}
