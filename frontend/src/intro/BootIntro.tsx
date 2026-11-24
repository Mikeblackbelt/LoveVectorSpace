// React port of .superdesign/tmp/intro.html: an octant-hopping 3D head-to-tail
// vector sum that closes back to the origin when loading finishes. Theme-aware,
// skippable (tap / Esc / button) and static under reduced motion.
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import { FACTS } from './facts';

type V3 = [number, number, number];
type Key = 'me' | 'them' | 'link';
interface Vec { v: V3; from: V3; key: Key; isClose: boolean; born: number; dur: number }

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const octOf = (p: V3): V3 => p.map((c) => (c >= 0 ? 1 : -1)) as V3;
const octStr = (o: V3) => o.map((s) => (s > 0 ? '+' : '−')).join('');
const OCTS: V3[] = [];
for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) OCTS.push([x, y, z]);
const FLOOR = -3.2;
const WORD = 'LOVEVECTORSPACE';
const LOG = ['> mounting encrypted store ........ ok', '> loading signal models ............ ok', '> syncing sources ......... ok', '> walking reciprocity octants ...... ok'];
const f2 = (n: number) => (n < 0 ? '−' : ' ') + Math.abs(n).toFixed(2);

export function BootIntro({ loading, onDone, minMs = 3200 }: { loading: boolean; onDone: () => void; minMs?: number }) {
  const { theme, reducedMotion, journal } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const readRef = useRef<HTMLDivElement>(null);
  const wmRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(loading);
  const doneRef = useRef(onDone);
  const themeRef = useRef(theme);
  const [fact, setFact] = useState(() => Math.floor(Math.random() * FACTS.length));
  const [typed, setTyped] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<'boot' | 'conv' | 'ready'>('boot');
  const [word, setWord] = useState('');
  loadingRef.current = loading;
  doneRef.current = onDone;
  themeRef.current = theme;

  // skip: Esc anywhere
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') doneRef.current();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  // fun facts: type in, rotate
  useEffect(() => {
    const f = FACTS[fact].t;
    if (reducedMotion) {
      setTyped(f);
      const id = window.setTimeout(() => setFact((i) => (i + 1) % FACTS.length), 5000);
      return () => window.clearTimeout(id);
    }
    let k = 0;
    setTyped('');
    let next = 0;
    const id = window.setInterval(() => {
      k++;
      setTyped(f.slice(0, k));
      if (k >= f.length) {
        window.clearInterval(id);
        next = window.setTimeout(() => setFact((i) => (i + 1) % FACTS.length), 2800);
      }
    }, 18);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(next);
    };
  }, [fact, reducedMotion]);

  // boot log
  useEffect(() => {
    let i = 0;
    const id = window.setInterval(() => {
      if (i < LOG.length) {
        const line = LOG[i++];
        setLog((l) => (l.includes(line) ? l : [...l, line]));
      }
      else window.clearInterval(id);
    }, reducedMotion ? 60 : 900);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  // the scene
  useEffect(() => {
    const cv = cvRef.current;
    const root = rootRef.current;
    if (!cv || !root) return;
    const ctx = cv.getContext('2d');
    if (!ctx) {
      // no canvas (tests / very old webviews): finish as soon as loading does
      const id = window.setInterval(() => {
        if (!loadingRef.current) {
          window.clearInterval(id);
          doneRef.current();
        }
      }, 50);
      return () => window.clearInterval(id);
    }
    let W = 0, H = 0, scale = 1, raf = 0;
    let C: Record<string, string> = {};
    const readC = () => {
      const cs = getComputedStyle(root);
      const g = (n: string) => cs.getPropertyValue(n).trim();
      C = { bg: g('--bg'), me: g('--me'), them: g('--them'), link: g('--link'), rule: g('--rule'), dim: g('--text-dim'), text: g('--text'), font: g('--font-data') || 'monospace', fx: themeRef.current };
    };
    readC();
    const resize = () => {
      const DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth;
      H = cv.clientHeight;
      cv.width = W * DPR;
      cv.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    resize();
    let rt = 0;
    const onResize = () => {
      window.clearTimeout(rt);
      rt = window.setTimeout(resize, 120);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    let seed = (Math.random() * 2 ** 32) >>> 0;
    const rnd = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let octQueue: V3[] = [];
    let curOct = '+++';
    const nextVec = (tip: V3) => {
      if (!octQueue.length) {
        octQueue = OCTS.slice();
        for (let i = octQueue.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [octQueue[i], octQueue[j]] = [octQueue[j], octQueue[i]];
        }
      }
      const cur = octStr(octOf(tip));
      let idx = octQueue.findIndex((o) => octStr(o) !== cur);
      if (idx < 0) idx = 0;
      const o = octQueue.splice(idx, 1)[0];
      const target = o.map((s, i) => {
        const m = s * (0.45 + rnd() * 1.25);
        return i === 1 ? Math.max(-1.8, Math.min(1.8, m)) : m;
      }) as V3;
      let v = sub(target, tip);
      const L = len(v);
      if (L > 2.4) v = mul(v, 2.4 / L);
      else if (L < 0.8) v = mul(v, 0.8 / L);
      const ny = tip[1] + v[1];
      if (ny > 1.8) v[1] = 1.8 - tip[1];
      else if (ny < -1.8) v[1] = -1.8 - tip[1]; // keep the chain above the floor
      curOct = octStr(o);
      return v;
    };

    let yaw = 0.7;
    const pitch = 0.45, camDist = 10;
    const P = (p: V3) => {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x = p[0] * cy - p[2] * sy, z = p[0] * sy + p[2] * cy, y = p[1];
      const y2 = y * cp + z * sp, z2 = -y * sp + z * cp, f = scale / (camDist + z2);
      return { x: W / 2 + x * f, y: H * 0.5 - y2 * f, z: z2 };
    };

    const vecs: Vec[] = [];
    const t0 = performance.now();
    let lastAdd = -1e9;
    let phase: 'load' | 'close' | 'collapse' | 'done' = 'load';
    let closing = false;
    let ringT: number | null = null;
    let collapseT: number | null = null;
    let finished = false;
    const tip = (): V3 => vecs.reduce<V3>((p, o) => add(p, o.v), [0, 0, 0]);
    const push = (v: V3, key: Key, isClose: boolean) => vecs.push({ v, from: tip(), key, isClose, born: performance.now(), dur: 450 });

    const finish = () => {
      if (finished) return;
      finished = true;
      setStatus('ready');
      if (wmRef.current) {
        const o = P([0, 0, 0]);
        wmRef.current.style.left = Math.max(12, Math.min(o.x + 30, W - 360)) + 'px';
        wmRef.current.style.top = Math.max(56, o.y - 40) + 'px';
        wmRef.current.style.opacity = '1';
      }
      if (reducedMotion) {
        setWord(WORD);
        window.setTimeout(() => doneRef.current(), 600);
        return;
      }
      let i = 0;
      const id = window.setInterval(() => {
        setWord(WORD.slice(0, ++i));
        if (i >= WORD.length) {
          window.clearInterval(id);
          window.setTimeout(() => doneRef.current(), 700);
        }
      }, 55);
    };

    const seg = (a: { x: number; y: number }, b: { x: number; y: number }, color: string, w: number, alpha: number, dash?: number[]) => {
      ctx.lineCap = C.fx === 'journal' ? 'round' : 'butt';
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const grid = () => {
      const base = C.fx === 'riso' ? 0.45 : C.fx === 'journal' ? 0.22 : 0.8;
      for (let i = -7; i <= 7; i++) {
        const al = base * (1 - Math.abs(i) / 8);
        seg(P([i, FLOOR, -7]), P([i, FLOOR, 7]), C.rule, 1, al);
        seg(P([-7, FLOOR, i]), P([7, FLOOR, i]), C.rule, 1, al);
      }
    };
    const axes = () => {
      const o = P([0, 0, 0]), bp = C.fx === 'blueprint', jr = C.fx === 'journal', R = bp ? 3.2 : 1.6;
      const dirs: [V3, string][] = [[[1, 0, 0], 'X'], [[0, 1, 0], 'Y'], [[0, 0, 1], 'Z'], [[-1, 0, 0], ''], [[0, -1, 0], ''], [[0, 0, -1], '']];
      for (const [d, l] of dirs) {
        const e = P(mul(d, R));
        seg(o, e, C.dim, 1, jr ? 0.2 : l ? 0.9 : 0.45, l || bp ? [] : [3, 4]);
        if (l && !jr) {
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = C.dim;
          ctx.font = `11px ${C.font}`;
          ctx.fillText(l, e.x + 5, e.y - 5);
        }
        if (bp) {
          const dx = e.x - o.x, dy = e.y - o.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
          for (let k = 1; k <= 3; k++) {
            const t = P(mul(d, k)), n = (d[0] + d[1] + d[2]) * k;
            seg({ x: t.x - nx * 4, y: t.y - ny * 4 }, { x: t.x + nx * 4, y: t.y + ny * 4 }, C.dim, 1, 0.95);
            ctx.globalAlpha = 0.95;
            ctx.fillStyle = C.dim;
            ctx.font = `9px ${C.font}`;
            ctx.fillText((n < 0 ? '−' : '') + Math.abs(n), t.x + nx * 8 - 3, t.y + ny * 8 + 3);
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.text;
      ctx.fillRect(o.x - 2.5, o.y - 2.5, 5, 5);
    };
    const head = (b: { x: number; y: number }, ang: number, color: string, alpha: number, dx: number, dy: number) => {
      const hs = 13;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(b.x + dx, b.y + dy);
      ctx.lineTo(b.x + dx - hs * Math.cos(ang - 0.36), b.y + dy - hs * Math.sin(ang - 0.36));
      ctx.lineTo(b.x + dx - hs * Math.cos(ang + 0.36), b.y + dy - hs * Math.sin(ang + 0.36));
      ctx.closePath();
      ctx.fill();
    };
    const particles = (now: number) => {
      const hs = (n: number) => {
        const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
      };
      const t = reducedMotion ? 0 : now / 1000;
      ctx.save();
      for (let i = 0; i < 40; i++) {
        const sp = 4 + hs(i + 1) * 10, x = (((hs(i + 2) * W + t * sp) % W) + W) % W, y = (((hs(i + 3) * H - t * sp * 0.5) % H) + H) % H, r = 0.8 + hs(i + 4) * 1.8;
        ctx.globalAlpha = 0.1 + hs(i + 5) * 0.2;
        ctx.fillStyle = i % 3 ? C.me : C.them;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };
    const vectorLine = (from: V3, to: V3, key: Key, alpha: number, isClose: boolean) => {
      const a = P(from), b = P(to), color = C[key], fx = C.fx, neon = fx === 'crt' || fx === 'pulse';
      const fl = P([to[0], FLOOR, to[2]]);
      seg(b, fl, color, 1, alpha * (fx === 'journal' ? 0.28 : 0.45), fx === 'journal' ? [2, 6] : [4, 5]);
      ctx.globalAlpha = alpha * 0.6;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(fl.x, fl.y, 5, 2.2, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (fx === 'blueprint') {
        seg(fl, P([to[0], FLOOR, 0]), C.dim, 0.75, alpha * 0.5, [2, 3]);
        seg(fl, P([0, FLOOR, to[2]]), C.dim, 0.75, alpha * 0.5, [2, 3]);
        seg(P([to[0], FLOOR, 0]), P([to[0], 0, 0]), C.dim, 0.75, alpha * 0.35, [2, 3]);
      }
      const lw = fx === 'blueprint' ? 2.5 : fx === 'journal' ? 3 : isClose ? 3.5 : 3;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (fx === 'riso') {
        const alt = key === 'me' ? C.them : key === 'them' ? C.me : C.text;
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
        if (L > 8) {
          const nx = -dy / L, ny = dx / L, n = Math.max(1, Math.floor(L / 6));
          ctx.fillStyle = color;
          ctx.globalAlpha = alpha * 0.65;
          for (let k = 0; k <= n; k++) {
            const t = k / n, r = 0.6 + 2.2 * t;
            for (const s of [-1, 1]) {
              ctx.beginPath();
              ctx.arc(a.x + dx * t + nx * s * (6 + 3 * t), a.y + dy * t + ny * s * (6 + 3 * t), r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        seg({ x: a.x + 2, y: a.y + 2 }, { x: b.x + 2, y: b.y + 2 }, alt, lw, alpha);
        head(b, ang, alt, alpha, 2, 2);
      }
      ctx.save();
      if (neon) {
        ctx.shadowColor = color;
        ctx.shadowBlur = isClose ? (fx === 'pulse' ? 34 : 26) : 20;
      }
      seg(a, b, color, lw, alpha);
      ctx.restore();
      if (fx === 'crt') seg(a, b, C.text, 1, alpha * 0.55);
      if (fx === 'journal') {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        if (neon) {
          ctx.shadowColor = color;
          ctx.shadowBlur = fx === 'pulse' && isClose ? 24 : 16;
        }
        head(b, ang, color, alpha, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = C.bg;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    const update = (now: number) => {
      if (C.fx !== themeRef.current) readC();
      const el = now - t0;
      yaw = reducedMotion ? 0.7 : (el / 1000) * ((8 * Math.PI) / 180) + 0.7;
      if (phase === 'load') {
        const ready = el >= minMs && !loadingRef.current && vecs.length >= 5;
        if (!ready && now - lastAdd >= 600) {
          push(nextVec(tip()), vecs.length % 2 ? 'them' : 'me', false);
          lastAdd = now;
        }
        if (ready && now - lastAdd >= 650) phase = 'close';
      }
      if (phase === 'close' && !closing) {
        closing = true;
        setStatus('conv');
        const S = tip(), neg = mul(S, -1);
        let perp = cross(S, [0, 1, 0]);
        if (len(perp) < 1e-3) perp = cross(S, [1, 0, 0]);
        perp = mul(perp, (0.35 * len(S) + 0.35) / len(perp));
        const c1 = add(mul(neg, 0.5), perp), c2 = sub(mul(neg, 0.5), perp); // c1 + c2 = −Σv exactly
        push(c1, 'link', true);
        window.setTimeout(() => push(c2, 'link', true), 560);
        window.setTimeout(() => {
          phase = 'collapse';
          ringT = performance.now();
          collapseT = performance.now() + 450;
        }, 560 + 650);
      }
      if (phase === 'collapse' && collapseT && now > collapseT + 950) {
        phase = 'done';
        finish();
      }
      const s = tip();
      if (readRef.current) {
        readRef.current.textContent = `Σv = (${f2(s[0])},${f2(s[1])},${f2(s[2])})
|Σv| = ${len(s).toFixed(2)}   OCTANT ${phase === 'load' ? curOct : '000'}`;
      }
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, W, H);
      scale = Math.min(W, H) * 1.05;
      if (C.fx === 'crt' || C.fx === 'signal') {
        const g = ctx.createRadialGradient(W / 2, H * 0.52, 0, W / 2, H * 0.52, Math.max(W, H) * 0.6);
        g.addColorStop(0, C.me);
        g.addColorStop(1, C.bg);
        ctx.globalAlpha = C.fx === 'crt' ? 0.07 : 0.04;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      if (C.fx === 'pulse') particles(now);
      grid();
      axes();
      let ck = 0;
      if (collapseT && now > collapseT) ck = ease(Math.min(1, (now - collapseT) / 950));
      for (const o of vecs) {
        const k = ease(Math.min(1, (now - o.born) / o.dur));
        let from = o.from, to = add(o.from, mul(o.v, k));
        if (ck > 0) {
          from = mul(from, 1 - ck);
          to = mul(to, 1 - ck);
        }
        const mid = P(mul(add(from, to), 0.5));
        const fog = Math.max(0.35, Math.min(1, 1 - (mid.z + 2.5) / 10));
        const alpha = fog * (1 - ck * 0.9);
        if (k < 1) seg(P(from), P(add(o.from, mul(o.v, Math.max(0, k - 0.3)))), C[o.key], 6, alpha * 0.15);
        vectorLine(from, to, o.key, alpha, o.isClose);
      }
      if (ringT) {
        const rk = Math.min(1, (now - ringT) / 1300), o = P([0, 0, 0]);
        ctx.save();
        ctx.globalAlpha = 1 - rk;
        ctx.lineWidth = 2;
        if (C.fx === 'crt' || C.fx === 'pulse') {
          ctx.shadowColor = C.link;
          ctx.shadowBlur = C.fx === 'pulse' ? 30 : 24;
        }
        if (C.fx === 'riso') {
          ctx.strokeStyle = C.text;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(o.x, o.y, 6 + rk * 140, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 2.5;
        }
        ctx.strokeStyle = C.link;
        ctx.beginPath();
        ctx.arc(o.x, o.y, 6 + rk * 140, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = Math.max(0, 1 - rk * 1.8);
        ctx.fillStyle = C.text;
        ctx.beginPath();
        ctx.arc(o.x, o.y, 5 + 12 * (1 - rk), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    if (reducedMotion) {
      // static: a fixed 5-vector chain, then straight to ready once loading is done
      for (let i = 0; i < 5; i++) {
        const v = nextVec(tip());
        vecs.push({ v, from: tip(), key: i % 2 ? 'them' : 'me', isClose: false, born: 0, dur: 1 });
      }
      draw(performance.now());
      const id = window.setInterval(() => {
        if (!loadingRef.current) {
          window.clearInterval(id);
          finish();
        }
      }, 100);
      return () => {
        window.clearInterval(id);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onResize);
      };
    }

    const frame = (now: number) => {
      update(now);
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [reducedMotion, minMs]);

  const f = FACTS[fact];
  const stTech = status === 'boot' ? 'BOOTING' : status === 'conv' ? 'CONVERGING' : 'READY';
  const stPlain = status === 'boot' ? 'Getting things ready' : status === 'conv' ? 'Finding balance' : 'Ready';

  return (
    <div
      ref={rootRef}
      className="intro"
      role="dialog"
      aria-label="LoveVectorSpace is starting"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button, a')) onDone();
      }}
    >
      <canvas ref={cvRef} className="intro-scene" aria-hidden="true" />
      <div className="intro-top">
        <span className="acc">{journal ? 'LoveVectorSpace' : 'LVS-BOOT v0.3'}</span>
        <span className="mid glyph">TTY0 · 80×24</span>
        <span className={status === 'conv' ? 'rev' : 'acc'} role="status">{journal ? stPlain : stTech}</span>
      </div>
      <div className="intro-box">
        <div className="fhead">
          <span className="lab">{journal ? 'Did you know?' : `FUN FACT ${fact + 1}/${FACTS.length}`}</span>
          <span className="fnav">
            <button type="button" className="fbtn" aria-label="Previous fun fact" onClick={() => setFact((i) => (i + FACTS.length - 1) % FACTS.length)}>◂</button>
            <button type="button" className="fbtn" aria-label="Next fun fact" onClick={() => setFact((i) => (i + 1) % FACTS.length)}>▸</button>
          </span>
        </div>
        <div className="ftext" aria-live="off">{typed}</div>
        <div className="fsrc" style={{ visibility: typed.length >= f.t.length ? 'visible' : 'hidden' }}>— {f.s}</div>
        <div ref={readRef} className="readout glyph" aria-hidden="true" />
      </div>
      <div ref={wmRef} className="intro-wm" aria-hidden={word.length < WORD.length}>
        <span>{word}</span>
        <span className="cur" />
      </div>
      <div className="intro-bot">
        <div className="intro-log glyph" aria-live="polite">
          {log.map((l) => (
            <div key={l}>{l}</div>
          ))}
          {status === 'ready' && <div className="acc">&gt; entering console_</div>}
        </div>
        <button type="button" className="key" onClick={onDone}>
          <span className="key-hint">[ ESC ] </span>
          {journal ? 'Skip' : 'SKIP'}
        </button>
      </div>
    </div>
  );
}
