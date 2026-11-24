// "Phone capture" settings: available methods, explanations, consent, toggles, linked contacts,
// pause, upload, and per-contact delete. Readers only appear in the Android sideload build.
// Consent, owner and link validation are enforced natively; this UI reflects native state.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { peopleApi } from '../../api/endpoints';
import { useSession } from '../../api/session';
import type { PersonSummary } from '../../api/types';
import { ErrorLine, Key, Loading, Pane } from '../../components/Pane';
import { say } from '../../components/prompt';
import { captureEnv } from '../../native/capture';
import { L } from '../../theme/Plain';
import { sourceFor } from './api';
import { APP_LABELS, METHOD_APPS } from './apps';
import type { Capabilities } from './capabilities';
import { syncAndFlush } from './CaptureFlusher';
import { CONSENT_VERSION, gateState, localConsent, nativeConsented, type GateState } from './consent';
import { METHOD_COPY, NOTIFICATIONS_REQUIRED, PRIVACY_NOTE, RESTRICTED_SETTINGS_HINT } from './copy';
import { useCaptureCaps } from './hooks';
import { contactKey, removeLink, upsertLink, validateLink } from './links';
import { cancelContactUploads } from './queue';
import type { AppSlug, CaptureLink, ReaderMethod } from './types';
import './capture.css';

const READERS: ReaderMethod[] = ['notify', 'sms', 'a11y'];
const LINKS_KEY = ['capture-links'] as const;

const STATE_TEXT: Record<GateState, [string, string]> = {
  unsupported: ['N/A', 'Not in this build'],
  needs_consent: ['OFF · NOT SET UP', 'Off'],
  off: ['OFF', 'Off'],
  needs_access: ['NEEDS ACCESS', 'Needs Android access'],
  needs_notifications: ['STOPPED · NOTIFICATIONS OFF', 'Stopped: notifications are off'],
  paused: ['PAUSED', 'Paused'],
  active: ['CAPTURING', 'Capturing linked chats'],
};

/** Settings pane. Mount in SettingsScreen. */
export function PhoneCapturePane() {
  const { caps, loading, refresh } = useCaptureCaps();
  const anyReader = caps.notify || caps.sms || caps.a11y;
  return (
    <Pane id="phone-capture" tech="PHONE CAPTURE" plain="Phone capture">
      {loading && <Loading what="capture options" />}
      <p className="paper note"><span className="glyph">[ PRIVACY ] </span>{PRIVACY_NOTE}</p>
      <div className="cap-method">
        <h3><L t="SCREENSHOT IMPORT" p="Screenshot import" /> <span className={`cap-state ${caps.screenshot ? 'ok' : 'dimt'}`}>{caps.screenshot ? <L t="AVAILABLE" p="Available" /> : <L t="APP ONLY" p="In the phone apps" />}</span></h3>
        <p className="dimt small">
          {caps.screenshot
            ? 'Open a person → Sources → Import screenshots. Text is recognised on this phone and you review every message before anything is sent.'
            : 'Available in the iPhone and Android apps: pick chat screenshots, they are read on the phone, and you review the messages before import.'}
        </p>
      </div>
      {caps.platform === 'android' && !anyReader && (
        <p className="dimt small">
          This is the Play Store build. The notification, SMS and accessibility readers are only in the sideload build (see the project docs).
        </p>
      )}
      {anyReader && <ReaderControls caps={caps} refresh={refresh} />}
    </Pane>
  );
}

function ReaderControls({ caps, refresh }: { caps: Capabilities; refresh: () => Promise<void> }) {
  const qc = useQueryClient();
  const plugin = captureEnv().capture();
  const session = useSession();
  const people = useQuery({ queryKey: ['people'], queryFn: peopleApi.list });
  const links = useQuery({ queryKey: LINKS_KEY, queryFn: async () => (await plugin.getLinks()).links });
  const [consentFor, setConsentFor] = useState<ReaderMethod | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const status = caps.status!;
  const anyEnabled = READERS.some((m) => status.methods[m].enabled);

  const saveLinks = useMutation({
    mutationFn: (next: CaptureLink[]) => plugin.setLinks({ links: next }),
    onSuccess: (r) => {
      qc.setQueryData(LINKS_KEY, r.links);
      setLinkNote(r.rejected.length ? `${r.rejected.length} link(s) were refused: agree to that reader first, or use a full number with country code.` : null);
    },
  });
  const pause = useMutation({
    mutationFn: (paused: boolean) => plugin.setPaused({ paused }),
    onSuccess: () => void refresh(),
  });
  const upload = useMutation({
    // Same owner check + flush as the background flusher.
    mutationFn: () => syncAndFlush(captureEnv(), session.user?.id ?? ''),
    onSuccess: (r) => {
      say('lvs capture flush', `↳ ${r.uploaded} uploaded${r.kept ? ` · ${r.kept} waiting` : ''}${r.dropped ? ` · ${r.dropped} rejected` : ''}`);
      void refresh();
      void qc.invalidateQueries({ queryKey: ['units'] });
      void qc.invalidateQueries({ queryKey: ['coverage'] });
    },
  });
  const allowNotifications = useMutation({
    mutationFn: async () => {
      const r = await plugin.requestPermissions({ permissions: ['notifications'] }).catch(() => ({}));
      if ((r as { notifications?: string }).notifications !== 'granted') await plugin.openSystemSettings({ method: 'app' });
    },
    onSettled: () => void refresh(),
  });

  const enable = useMutation({
    mutationFn: async ({ m, on }: { m: ReaderMethod; on: boolean }) => {
      await plugin.setEnabled({ method: m, enabled: on }); // native refuses ON without consent
      if (on) {
        await plugin.requestPermissions({ permissions: m === 'sms' ? ['sms', 'notifications'] : ['notifications'] }).catch(() => undefined);
      }
    },
    onSettled: () => void refresh(),
  });
  const agree = useMutation({
    mutationFn: async (m: ReaderMethod) => {
      await plugin.setConsent({ method: m, version: CONSENT_VERSION });
      localConsent.set(m, true);
      await plugin.setEnabled({ method: m, enabled: true });
      await plugin.requestPermissions({ permissions: m === 'sms' ? ['sms', 'notifications'] : ['notifications'] }).catch(() => undefined);
    },
    onSettled: () => {
      setConsentFor(null);
      void refresh();
    },
  });
  const withdraw = useMutation({
    mutationFn: async (m: ReaderMethod) => {
      (links.data ?? []).filter((l) => l.method === m).forEach((l) => cancelContactUploads(contactKey(l)));
      await plugin.setConsent({ method: m, version: 0 }); // native: reader off, its links removed
      localConsent.set(m, false);
    },
    onSettled: () => {
      void refresh();
      void qc.invalidateQueries({ queryKey: LINKS_KEY });
    },
  });

  return (
    <>
      {anyEnabled && !status.notificationsGranted && (
        <div className="paper note urgent" role="alert">
          <span className="glyph">[ STOPPED ] </span>{NOTIFICATIONS_REQUIRED}{' '}
          <Key tech="ALLOW NOTIFICATIONS" plain="Allow notifications" onClick={() => allowNotifications.mutate()} id="btn-cap-allow-notif" />
        </div>
      )}
      {status.droppedForCap > 0 && (
        <p className="paper note" role="status">
          {status.droppedForCap} captured message(s) were dropped because the queue on this phone was full. Upload more often to avoid this.
        </p>
      )}
      <div className="cap-method">
        <span className="cap-state">
          {status.paused
            ? <L t="[ PAUSED ]" p="Paused" />
            : status.methods.a11y.idle
              ? <L t="[ LIVE · CHAT READER IDLE-PAUSED ]" p="Running (chat reader paused after 30 minutes without a linked chat)" />
              : <L t="[ LIVE ]" p="Running" />}
          {' · '}
          <L t={`${status.queued} queued`} p={`${status.queued} messages waiting to upload`} />
        </span>
        <div className="keys">
          <Key
            variant={status.paused ? 'pri' : undefined}
            tech={status.paused ? 'RESUME ALL' : 'PAUSE ALL'}
            plain={status.paused ? 'Resume capture' : 'Pause all capture'}
            onClick={() => pause.mutate(!status.paused)}
            disabled={pause.isPending}
            id="btn-cap-pause"
          />
          {!status.paused && status.methods.a11y.idle && (
            <Key variant="pri" tech="RESUME CHAT READER" plain="Resume the chat reader" onClick={() => pause.mutate(false)} disabled={pause.isPending} id="btn-cap-resume-a11y" />
          )}
          <Key tech="UPLOAD NOW" plain="Upload now" onClick={() => upload.mutate()} disabled={upload.isPending || !session.user} id="btn-cap-upload" />
        </div>
        {upload.data?.error && <p className="err" role="alert">Upload paused: {upload.data.error}. Captured messages stay queued.</p>}
        {linkNote && <p className="err" role="alert">{linkNote}</p>}
        <ErrorLine error={pause.error || upload.error || saveLinks.error || enable.error || agree.error || withdraw.error} />
      </div>
      {READERS.filter((m) => caps[m]).map((m) => (
        <ReaderSection
          key={m}
          method={m}
          state={gateState(m, caps)}
          enabled={status.methods[m].enabled}
          consented={nativeConsented(m, caps)}
          links={(links.data ?? []).filter((l) => l.method === m)}
          allLinks={links.data ?? []}
          people={people.data ?? []}
          onSetup={() => setConsentFor(m)}
          onEnable={(on) => enable.mutate({ m, on })}
          onWithdraw={() => withdraw.mutate(m)}
          onGrant={() => void (m === 'sms'
            ? plugin.requestPermissions({ permissions: ['sms'] }).then(refresh)
            : plugin.openSystemSettings({ method: m }))}
          onAppInfo={() => void plugin.openSystemSettings({ method: 'app' })}
          onSaveLinks={(next) => saveLinks.mutate(next)}
        />
      ))}
      {consentFor && (
        <ConsentDialog method={consentFor} onCancel={() => setConsentFor(null)} onAgree={() => agree.mutate(consentFor)} />
      )}
    </>
  );
}

function ReaderSection({
  method, state, enabled, consented, links, allLinks, people, onSetup, onEnable, onWithdraw, onGrant, onAppInfo, onSaveLinks,
}: {
  method: ReaderMethod;
  state: GateState;
  enabled: boolean;
  consented: boolean;
  links: CaptureLink[];
  allLinks: CaptureLink[];
  people: PersonSummary[];
  onSetup: () => void;
  onEnable: (on: boolean) => void;
  onWithdraw: () => void;
  onGrant: () => void;
  onAppInfo: () => void;
  onSaveLinks: (next: CaptureLink[]) => void;
}) {
  const c = METHOD_COPY[method];
  const name = (pid: number) => people.find((p) => p.id === pid)?.pseudonym ?? `#${pid}`;
  return (
    <section className="cap-method" aria-labelledby={`cap-h-${method}`}>
      <h3 id={`cap-h-${method}`}>
        <L t={c.tech} p={c.title} />{' '}
        <span className={`cap-state ${state === 'active' ? 'ok' : 'dimt'}`} data-testid={`cap-state-${method}`}>
          <L t={STATE_TEXT[state][0]} p={STATE_TEXT[state][1]} />
        </span>
      </h3>
      <p className="dimt small">{c.short}</p>
      <div className="keys">
        {state === 'needs_consent' && <Key variant="pri" tech="SET UP" plain="Read how it works and turn on" onClick={onSetup} id={`btn-cap-setup-${method}`} />}
        {state === 'off' && <Key variant="pri" tech="TURN ON" plain="Turn on" onClick={() => onEnable(true)} id={`btn-cap-on-${method}`} />}
        {/* Stopping is always possible while the native switch is on, whatever the consent state. */}
        {enabled && <Key tech="TURN OFF" plain="Turn off" onClick={() => onEnable(false)} id={`btn-cap-off-${method}`} />}
        {state === 'needs_access' && <Key variant="pri" tech="GRANT ACCESS" plain="Give Android access" onClick={onGrant} id={`btn-cap-grant-${method}`} />}
        {consented && (
          <button type="button" className="linkish" onClick={onWithdraw} id={`btn-cap-withdraw-${method}`}>
            Withdraw consent (turns it off and removes its links)
          </button>
        )}
      </div>
      {state === 'needs_access' && method !== 'sms' && (
        <p className="dimt small">
          {RESTRICTED_SETTINGS_HINT}{' '}
          <button type="button" className="linkish" onClick={onAppInfo}>Open app info</button>
        </p>
      )}
      {(consented || links.length > 0) && (
        <>
          <h4 className="lbl sub-h"><L t="LINKED CONTACTS" p="Linked contacts (only these are captured)" /></h4>
          {links.length === 0 && <p className="dimt small">No linked contacts yet, so nothing is captured.</p>}
          <ul className="cap-links">
            {links.map((l) => (
              <LinkRow key={`${l.app}|${l.contact}`} link={l} person={name(l.pid)} onUnlink={() => onSaveLinks(removeLink(allLinks, l))} />
            ))}
          </ul>
          {consented && <AddLink method={method} people={people} onAdd={(l) => onSaveLinks(upsertLink(allLinks, l))} />}
        </>
      )}
    </section>
  );
}

function LinkRow({ link, person, onUnlink }: { link: CaptureLink; person: string; onUnlink: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const plugin = captureEnv().capture();
  const appLabel = link.app === 'sms' ? 'SMS' : APP_LABELS[link.app];
  const purge = useMutation({
    mutationFn: async (alsoUploaded: boolean) => {
      cancelContactUploads(contactKey(link)); // stop an in-flight batch for this contact
      const { removed } = await plugin.deleteContact({ method: link.method, app: link.app, contact: link.contact });
      let server = 0;
      if (alsoUploaded) {
        const src = sourceFor(link.method, link.app);
        const units = await peopleApi.units(link.pid);
        for (const u of units.filter((x) => x.source === src)) {
          server += (await peopleApi.deleteUnit(u.unit_id)).removed_messages;
        }
      }
      return { removed, server };
    },
    onSuccess: (r) => {
      say(`lvs capture rm ${link.method}`, `↳ ${r.removed} queued removed${r.server ? ` · ${r.server} uploaded removed` : ''}`);
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: ['units', link.pid] });
      void qc.invalidateQueries({ queryKey: ['coverage', link.pid] });
      void qc.invalidateQueries({ queryKey: ['capture-caps'] });
    },
  });
  const unlink = async () => {
    // Unlinking also forgets anything queued or in flight for this contact (and its SMS cursor).
    cancelContactUploads(contactKey(link));
    await plugin.deleteContact({ method: link.method, app: link.app, contact: link.contact }).catch(() => undefined);
    onUnlink();
  };
  return (
    <li>
      <span><b>{link.contact}</b> <span className="dimt">· {appLabel} → {person}</span></span>
      {confirm ? (
        <span className="keys">
          <Key variant="pri" tech="DELETE QUEUED" plain="Delete what's on this phone" onClick={() => purge.mutate(false)} disabled={purge.isPending} />
          <Key tech="+ UPLOADED" plain={`Also delete uploaded ${appLabel} captures for ${person}`} onClick={() => purge.mutate(true)} disabled={purge.isPending} />
          <Key variant="ghost" tech="KEEP" plain="Keep" onClick={() => setConfirm(false)} />
        </span>
      ) : (
        <span className="keys">
          <Key variant="ghost" tech="DELETE DATA" plain="Delete captured data" onClick={() => setConfirm(true)} label={`Delete captured data for ${link.contact}`} />
          <Key variant="ghost" tech="UNLINK" plain="Unlink" onClick={() => void unlink()} label={`Unlink ${link.contact}`} />
        </span>
      )}
      <ErrorLine error={purge.error} />
    </li>
  );
}

function AddLink({ method, people, onAdd }: { method: ReaderMethod; people: PersonSummary[]; onAdd: (l: CaptureLink) => void }) {
  const apps: (AppSlug | 'sms')[] = method === 'sms' ? ['sms'] : METHOD_APPS[method];
  const [app, setApp] = useState<AppSlug | 'sms'>(apps[0]);
  const [contact, setContact] = useState('');
  const [pid, setPid] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const id = (s: string) => `cap-${method}-${s}`;

  /** SMS numbers are stored in the native E.164 form; show it before linking. */
  const canonical = async (raw: string): Promise<string | null> => {
    if (method !== 'sms') return raw;
    try {
      const r = await captureEnv().capture().normalizePhone({ number: raw });
      return r.canonical ?? null;
    } catch {
      return null;
    }
  };

  const submit = async () => {
    const c = await canonical(contact);
    if (method === 'sms' && !c) {
      setErr("Can't recognise that number. Include the country code, e.g. +44 7700 900123.");
      return;
    }
    const l: CaptureLink = { method, app, contact: c ?? contact, pid };
    const e = validateLink(l);
    setErr(e);
    if (e) return;
    onAdd(l);
    setContact('');
    setPreview(null);
  };
  return (
    <div className="cap-addlink sub-form">
      {method !== 'sms' && (
        <div className="field">
          <label className="lbl" htmlFor={id('app')}><L t="APP" p="App" /></label>
          <select id={id('app')} value={app} onChange={(e) => setApp(e.target.value as AppSlug)}>
            {apps.map((a) => <option key={a} value={a}>{a === 'sms' ? 'SMS' : APP_LABELS[a]}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label className="lbl" htmlFor={id('contact')}>{method === 'sms' ? <L t="NUMBER" p="Phone number" /> : <L t="CHAT NAME" p="Chat name as shown in the app" />}</label>
        <input
          id={id('contact')}
          value={contact}
          inputMode={method === 'sms' ? 'tel' : 'text'}
          autoComplete="off"
          onChange={(e) => setContact(e.target.value)}
          onBlur={() => void (method === 'sms' && contact.trim() ? canonical(contact).then((c) => setPreview(c)) : undefined)}
        />
      </div>
      {method === 'sms' && preview && <p className="dimt small" data-testid="cap-sms-preview">Will be saved as {preview}</p>}
      <div className="field">
        <label className="lbl" htmlFor={id('person')}><L t="PERSON" p="Person" /></label>
        <select id={id('person')} value={pid} onChange={(e) => setPid(Number(e.target.value))}>
          <option value={0}>—</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.pseudonym}</option>)}
        </select>
      </div>
      <div className="keys">
        <Key tech="+ LINK" plain="Link contact" onClick={() => void submit()} id={`btn-cap-link-${method}`} />
      </div>
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

/** Explanation + consent screen shown before a reader can be switched on. */
export function ConsentDialog({ method, onAgree, onCancel }: { method: ReaderMethod; onAgree: () => void; onCancel: () => void }) {
  const c = METHOD_COPY[method];
  const [ack, setAck] = useState(false);
  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={onCancel} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="t-cap-consent" data-own-keys>
        <h2 className="ttl" id="t-cap-consent">
          <span className="glyph">┌─[ </span>{c.title}<span className="glyph"> ]─┐</span>
        </h2>
        <p>{c.short}</p>
        <h3 className="lbl sub-h">What it reads</h3>
        <ul>{c.reads.map((s) => <li key={s}>{s}</li>)}</ul>
        <h3 className="lbl sub-h">What it never reads</h3>
        <ul>{c.never.map((s) => <li key={s}>{s}</li>)}</ul>
        <p className="dimt small">{c.access}</p>
        <p className="dimt small">{PRIVACY_NOTE}</p>
        {method !== 'sms' && <p className="dimt small">{RESTRICTED_SETTINGS_HINT}</p>}
        <label className="toggle">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I understand what this reads and that only linked one-to-one chats are captured.
        </label>
        <div className="keys">
          <Key variant="pri" tech="AGREE & TURN ON" plain="Agree and turn on" onClick={onAgree} disabled={!ack} id="btn-cap-agree" />
          <Key variant="ghost" tech="NOT NOW" plain="Not now" onClick={onCancel} />
        </div>
      </div>
    </>
  );
}
