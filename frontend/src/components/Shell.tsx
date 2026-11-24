import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { analysisApi, auth, peopleApi } from '../api/endpoints';
import { subscribeEvents } from '../api/events';
import { useSession } from '../api/session';
import type { PersonSummary } from '../api/types';
import { haptic } from '../native/native';
import { L } from '../theme/Plain';
import { useTheme } from '../theme/ThemeProvider';
import { FxLayers } from './FxLayers';
import { lastPerson, rememberPerson, say, usePromptLine } from './prompt';
import { ThemePopover } from './ThemePopover';
import { ago, hhmm } from '../lib/format';
import { useHotkey } from '../lib/hotkeys';

export const DISCLAIMER =
  'This tool offers reflection and pattern warnings. It is not therapy, counselling, or a crisis service.';

const SRC_SHORT: Record<string, string> = { whatsapp: 'WA', instagram: 'IG', discord: 'DC', import: 'IMPORT', plaintext: 'TXT' };

export function Footer({ children }: { children?: ReactNode }) {
  return (
    <footer className="foot">
      <span>
        <span className="glyph">// </span>
        {DISCLAIMER}
      </span>
      {children}
    </footer>
  );
}

export function TitleBlock({ sheet, subject }: { sheet: string; subject?: string }) {
  return (
    <div className="tblock" aria-label="Drawing title block">
      <div>
        <span className="big">LOVEVECTORSPACE</span>
        <span>{sheet}</span>
        <span>SUBJ {subject || '—'}</span>
      </div>
      <div>
        <span className="big">DWG LVS-002 · REV C · SCALE 1:1</span>
        <span>DATE {new Date().toISOString().slice(0, 10)}</span>
        <span>SHEET 1/1</span>
      </div>
    </div>
  );
}

export function PromptLine({ path, meta }: { path: string; meta?: string }) {
  const session = useSession();
  const { cmd, out } = usePromptLine();
  const user = (session.user?.display_name || session.user?.email.split('@')[0] || 'guest').toLowerCase().replace(/\s+/g, '');
  return (
    <div className="prompt glyph">
      <div className="pr-out" aria-live="polite">{out}</div>
      <div className="pr-line">
        <span className="c-me">{user}@lvs</span>:<span className="c-th">~/{path}</span> $ <span>{cmd}</span>
        <span className="cur" aria-hidden="true" />
      </div>
      <div className="pr-meta">{meta || 'TTY0 · UTF-8 · [T] THEME · [1-7] SCREENS'}</div>
    </div>
  );
}

interface NavItem {
  key: string;
  tech: string;
  plain: string;
  short: string;
  to: string;
  match: (p: string) => boolean;
}

export function useNavItems(pid: number | null): NavItem[] {
  return useMemo(() => {
    const p = pid ? `/p/${pid}` : '/people';
    const scoped = (suffix: string) => (pid ? `${p}${suffix}` : '/people');
    return [
      { key: '1', tech: 'PEOPLE', plain: 'People', short: 'PEOPLE', to: '/people', match: (x) => x === '/people' },
      { key: '2', tech: 'DASH', plain: 'Dashboard', short: 'DASH', to: scoped(''), match: (x) => /^\/p\/\d+$/.test(x) },
      { key: '3', tech: 'CHAT', plain: 'Chat', short: 'CHAT', to: scoped('/chat'), match: (x) => x.endsWith('/chat') },
      { key: '4', tech: 'CONTEXT', plain: 'Context', short: 'CTX', to: scoped('/context'), match: (x) => x.endsWith('/context') },
      { key: '5', tech: 'FORMS', plain: 'Check-ins', short: 'FORMS', to: scoped('/forms'), match: (x) => x.endsWith('/forms') },
      { key: '6', tech: 'SOURCES', plain: 'Sources', short: 'SRC', to: scoped('/sources'), match: (x) => x.endsWith('/sources') },
      { key: '7', tech: 'SET', plain: 'Settings', short: 'SET', to: '/settings', match: (x) => x === '/settings' || x === '/themes' },
    ];
  }, [pid]);
}

/** Phone bottom bar: at most 5 items. */
export const MOBILE_KEYS = ['2', '3', '1', '6', '7'];

export function Shell() {
  const params = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const session = useSession();
  const { popoverOpen, setPopoverOpen } = useTheme();
  const routePid = params.pid ? Number(params.pid) : null;
  const [pid, setPid] = useState<number | null>(() => routePid ?? lastPerson());
  useEffect(() => {
    if (routePid) {
      setPid(routePid);
      rememberPerson(routePid);
    }
  }, [routePid]);

  const people = useQuery({ queryKey: ['people'], queryFn: peopleApi.list, enabled: session.status === 'authed' });
  const person: PersonSummary | undefined = people.data?.find((p) => p.id === pid);
  const items = useNavItems(pid);

  // live updates
  useEffect(() => {
    if (session.status !== 'authed') return;
    return subscribeEvents((e) => {
      const p = e.person_id;
      if (e.type === 'snapshot' || e.type === 'job') {
        void qc.invalidateQueries({ queryKey: ['overview', p] });
        void qc.invalidateQueries({ queryKey: ['people'] });
      } else if (e.type === 'next_steps') {
        void qc.invalidateQueries({ queryKey: ['overview', p] });
      } else if (e.type === 'ingest') {
        void qc.invalidateQueries({ queryKey: ['units', p] });
        void qc.invalidateQueries({ queryKey: ['coverage', p] });
        void qc.invalidateQueries({ queryKey: ['people'] });
      }
    });
  }, [session.status, qc]);

  // screen hotkeys 1-7 and Esc (T is global, see App)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t?.closest?.('[data-own-keys]')) return;
      if (e.key === 'Escape') {
        setPopoverOpen(false);
        return;
      }
      const it = items.find((i) => i.key === e.key);
      if (it) {
        say(`lvs open ${it.tech.toLowerCase()}`);
        nav(it.to);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [items, nav, setPopoverOpen]);

  const analyze = async () => {
    if (!pid) return;
    haptic();
    say(`lvs analyze ${person?.pseudonym.toLowerCase().replace(/\s+/g, '') || pid}`, '↳ recomputing signals …');
    try {
      await analysisApi.analyze(pid);
    } catch (err) {
      say('lvs analyze', `↳ ${(err as Error).message}`);
    }
  };

  useHotkey('r', () => void analyze(), !!pid && /^\/p\/\d+/.test(loc.pathname));

  const path = loc.pathname.replace(/^\/p\/\d+\/?/, 'person/').replace(/^\//, '') || 'people';
  const last = person?.updated_at ? hhmm(person.updated_at) : '--:--';

  return (
    <>
      <FxLayers wipeKey={loc.pathname} />
      <div className="layer">
        <div className="mstat" role="status">
          <span className="disp">LVS</span>
          <b>{person ? person.pseudonym.toUpperCase() : 'PEOPLE'}</b>
          {person?.sources.slice(0, 2).map((s) => (
            <span key={s.source} className="msrc">
              {SRC_SHORT[s.source] || s.source.toUpperCase()} <i className="dot">●</i> {s.last_sync ? ago(s.last_sync) : '—'}
            </span>
          ))}
          <span className="sp"><b>{last}</b></span>
          <button
            id="btn-theme-m"
            className="key ghost"
            type="button"
            data-theme-toggle
            aria-haspopup="true"
            aria-expanded={popoverOpen}
            aria-controls="theme-pop"
            aria-label="Theme"
            onClick={() => setPopoverOpen(!popoverOpen)}
          >
            <L t="[T]" p="Theme" />
          </button>
          {person && (
            <button className="key" type="button" aria-label="Analyze now" onClick={() => void analyze()}>
              <L t="[R]" p="Update" />
            </button>
          )}
        </div>
        {/* phone: the 5-item bottom bar has no room for Context / Check-ins / Themes */}
        <nav className="msub" aria-label="More screens">
          {items.filter((i) => i.key === '4' || i.key === '5').map((it) => (
            <NavLink key={it.key} to={it.to} end className={() => (it.match(loc.pathname) ? 'on' : '')}>
              <span className="key-hint">[{it.key}]</span><L t={it.tech} p={it.plain} />
            </NavLink>
          ))}
          <NavLink to="/themes" className={() => (loc.pathname === '/themes' ? 'on' : '')}><L t="THEMES" p="Themes" /></NavLink>
        </nav>

        <header className="cmdbar">
          <div className="brand">
            <span className="disp">LVS</span>
            <small>MISSION CONTROL</small>
          </div>
          <nav className="cmds" aria-label="Screens">
            {items.map((it) => (
              <NavLink
                key={it.key}
                to={it.to}
                end
                className={() => (it.match(loc.pathname) ? 'on' : '')}
                aria-current={it.match(loc.pathname) ? 'page' : undefined}
              >
                <b className="key-hint">[{it.key}]</b>
                <span><L t={it.tech} p={it.plain} /></span>
              </NavLink>
            ))}
            <span className="sep glyph" aria-hidden="true">│</span>
            <button
              id="btn-theme"
              type="button"
              data-theme-toggle
              aria-haspopup="true"
              aria-expanded={popoverOpen}
              aria-controls="theme-pop"
              onClick={() => setPopoverOpen(!popoverOpen)}
            >
              <b className="key-hint">[T]</b>
              <span><L t="THEME" p="Theme" /></span>
            </button>
          </nav>
          <div className="status">
            {person?.sources.map((s) => (
              <span key={s.source} className="hide-md">
                {s.source.toUpperCase()}{' '}
                <i className={s.health === 'ok' ? 'dot' : 'dot warn'}>●</i> {s.last_sync ? ago(s.last_sync) : s.health === 'needs_update' ? 'UPDATE' : '—'}
              </span>
            ))}
            {person && (
              <span className="hide-md">
                <L t="LAST ANALYSIS" p="Updated" /> <b>{last}</b>
              </span>
            )}
            {person && (
              <button className="key" type="button" onClick={analyze}>
                <span className="key-hint">[ R ] </span>
                <L t="ANALYZE" p="Update" />
              </button>
            )}
            {session.status === 'authed' && (
              <button className="key ghost" type="button" onClick={() => void auth.logout().then(() => nav('/auth/login'))}>
                <L t="EXIT" p="Log out" />
              </button>
            )}
          </div>
        </header>

        <ThemePopover />

        {session.user && !session.user.email_verified && <VerifyBanner />}

        <Outlet context={{ pid, person, analyze }} />

        <PromptLine path={path} />
        <Footer>
          <TitleBlock sheet={path.toUpperCase()} subject={person?.pseudonym.toUpperCase()} />
        </Footer>
      </div>

      <nav className="mbar" aria-label="Screens (mobile)">
        {MOBILE_KEYS.map((k) => items.find((i) => i.key === k)!).map((it) => (
          <NavLink
            key={it.key}
            to={it.to}
            end
            className={() => (it.match(loc.pathname) ? 'on' : '')}
            aria-current={it.match(loc.pathname) ? 'page' : undefined}
          >
            <b className="key-hint">[{it.key}]</b>
            <span><L t={it.short} p={it.plain} /></span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

function VerifyBanner() {
  const [sent, setSent] = useState(false);
  return (
    <div className="banner" role="status">
      <span className="glyph">[ NOTE ] </span>
      <L t="email not verified · check your inbox for the link" p="Please confirm your email address. We sent you a link." />
      <button className="key ghost" type="button" disabled={sent} onClick={() => void auth.resendVerify().then(() => setSent(true))}>
        {sent ? <L t="SENT" p="Sent" /> : <L t="RESEND" p="Send again" />}
      </button>
    </div>
  );
}

export interface ShellCtx {
  pid: number | null;
  person?: PersonSummary;
  analyze: () => Promise<void>;
}
export function useShell(): ShellCtx {
  return useOutletContext<ShellCtx>();
}
