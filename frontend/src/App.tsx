import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, type Location } from 'react-router-dom';
import { ApiError, onSession } from './api/client';
import { bootstrapSession, retryBootstrap, useSession } from './api/session';
import { Shell } from './components/Shell';
import { say } from './components/prompt';
import { BootIntro } from './intro/BootIntro';
import { hideSplash, listenForSharedFiles, type SharedChatFile } from './native/native';
import { AuthComplete, AuthScreen, ResetScreen, VerifyScreen, allowedNext } from './screens/Auth';
import { ChatScreen } from './screens/Chat';
import { ContextScreen } from './screens/Context';
import { DashboardScreen } from './screens/Dashboard';
import { FormsScreen } from './screens/Forms';
import { PeopleScreen } from './screens/People';
import { PrivacyScreen } from './screens/Privacy';
import { SettingsScreen } from './screens/Settings';
import { SharedImportScreen, clearPendingShare, setPendingShare } from './screens/SharedImport';
import { SourcesScreen } from './screens/Sources';
import { ThemesScreen } from './screens/Themes';
import { ThemeProvider, useRootAttrs, useTheme } from './theme/ThemeProvider';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });
}

function RequireAuth({ children }: { children: ReactNode }) {
  const s = useSession();
  const loc = useLocation();
  if (s.status === 'unknown') return null;
  if (s.status === 'offline') return <OfflineScreen />;
  if (s.status === 'anon') {
    const next = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/auth/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const s = useSession();
  const loc = useLocation() as Location;
  if (s.status === 'authed') {
    const next = new URLSearchParams(loc.search).get('next');
    return <Navigate to={allowedNext(next)} replace />;
  }
  return <>{children}</>;
}

/** Cold start could not reach the server: keep the stored session and offer a retry (never a logout). */
function OfflineScreen() {
  return (
    <main className="screen offline-screen" role="alert">
      <section className="pane">
        <h2 className="ttl"><span className="glyph">─[ </span><b>OFFLINE</b><span className="glyph"> ]─</span></h2>
        <p>Can't reach LoveVectorSpace right now. You're still signed in; check your connection and try again.</p>
        <div className="keys">
          <button className="key pri" type="button" onClick={() => void retryBootstrap()}>Try again</button>
        </div>
      </section>
    </main>
  );
}

/** Per-user caches go when the session ends (logout, account deletion, rejected refresh). Theme prefs stay. */
function SessionCacheGuard() {
  const qc = useQueryClient();
  useEffect(
    () =>
      onSession((e) => {
        if (e.type === 'logged_out') {
          qc.cancelQueries();
          qc.clear();
          clearPendingShare();
        }
      }),
    [qc],
  );
  return null;
}

/** Global keys that work on every screen: T cycles the theme. */
function GlobalKeys() {
  const { cycle, setPopoverOpen } = useTheme();
  useEffect(() => {
    let timer = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t?.closest?.('[data-own-keys]')) return;
      if (e.key === 't' || e.key === 'T') {
        const n = cycle();
        say(`lvs theme ${n}`, `↳ ${n} · saved`);
        setPopoverOpen(true);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setPopoverOpen(false), 1800);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [cycle, setPopoverOpen]);
  return null;
}

function ShareListener() {
  const nav = useNavigate();
  useEffect(() => {
    let off = () => undefined as void;
    void listenForSharedFiles((f: SharedChatFile) => {
      setPendingShare(f);
      nav('/import');
    }).then((u) => {
      off = u;
    });
    return () => off();
  }, [nav]);
  return null;
}

function Root({ skipIntro }: { skipIntro?: boolean }) {
  const attrs = useRootAttrs();
  const session = useSession();
  const [introDone, setIntroDone] = useState(!!skipIntro);

  useEffect(() => {
    void bootstrapSession();
    void hideSplash();
  }, []);

  return (
    <div className="lvs" {...attrs}>
      <GlobalKeys />
      <ShareListener />
      <SessionCacheGuard />
      {!introDone ? (
        <BootIntro loading={session.status === 'unknown'} onDone={() => setIntroDone(true)} />
      ) : (
        <Routes>
          <Route path="/auth/login" element={<PublicOnly><AuthScreen tab="login" /></PublicOnly>} />
          <Route path="/auth/signup" element={<PublicOnly><AuthScreen tab="signup" /></PublicOnly>} />
          <Route path="/auth/forgot" element={<PublicOnly><AuthScreen tab="reset" /></PublicOnly>} />
          <Route path="/auth/reset" element={<ResetScreen />} />
          <Route path="/auth/verify" element={<VerifyScreen />} />
          <Route path="/auth/complete" element={<AuthComplete />} />
          <Route path="/privacy" element={<PrivacyScreen />} />
          <Route element={<RequireAuth><Shell /></RequireAuth>}>
            <Route path="/people" element={<PeopleScreen />} />
            <Route path="/import" element={<SharedImportScreen />} />
            <Route path="/p/:pid" element={<DashboardScreen />} />
            <Route path="/p/:pid/sources" element={<SourcesScreen />} />
            <Route path="/p/:pid/chat" element={<ChatScreen />} />
            <Route path="/p/:pid/context" element={<ContextScreen />} />
            <Route path="/p/:pid/forms" element={<FormsScreen />} />
            <Route path="/themes" element={<ThemesScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
          </Route>
          <Route path="*" element={<Navigate to="/people" replace />} />
        </Routes>
      )}
    </div>
  );
}

export function App({ skipIntro, client }: { skipIntro?: boolean; client?: QueryClient }) {
  const [qc] = useState(() => client ?? makeQueryClient());
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <BrowserRouter>
          <Root skipIntro={skipIntro} />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
