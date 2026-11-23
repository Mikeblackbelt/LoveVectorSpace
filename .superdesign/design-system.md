# LoveVectorSpace — design system (v3: "AMBER PHOSPHOR TERMINAL")

## Product context
LoveVectorSpace is an invite-only web and mobile app shown to hackathon judges. It helps a person read **reciprocation** with someone they like ("potential" mode), or keep a relationship **healthy** ("established" mode).

Data comes from a desktop browser extension (WhatsApp Web, Discord and Instagram DMs), manual imports, questionnaires, and an AI agent that interviews the user and logs in-person hangouts.

The headline is a **chance of success**, shown as two numbers: **uncalibrated** (now) and **calibrated** (later, after about 20 labelled outcomes). Unhealthy dynamics get **warnings only**: plain-text resources, never call buttons.

### Screens
1. Boot sequence.
2. Login, sign-up (invite code) and password reset, with Google and Apple sign-in.
3. People and sources.
4. Person dashboard (MISSION CONTROL).
5. Agent chat and interview, with "Log a hangout".
6. Extension popup.

All web screens are responsive: desktop 1440px and phone 390px. They're also packaged as Android and iPhone apps.

## Aesthetic
**A real terminal, not a "dark SaaS dashboard".** Think a 1980s amber CRT reimagined as a modern instrument. The screen is a terminal session: everything is text-first, laid out on a character grid, framed with box-drawing characters, and driven by keyboard commands. It must NOT look like a generic AI-generated dark dashboard: no glassmorphism, no neon acid green, no purple gradients, no soft cards.

### Colour (warm phosphor)
| Token | Value | Use |
|---|---|---|
| `--crt-black` | `#0b0a08` | screen background (warm black) |
| `--crt-panel` | `#13110d` | inset panes |
| `--rule` | `#3a3226` | box-drawing lines and rules |
| `--paper` | `#f2e6d0` | primary text (warm paper white) |
| `--ash` | `#8a7b63` | secondary text, labels, comments |
| `--amber` | `#ffb000` | PRIMARY phosphor: the owner's ("ME") series, prompts, cursor, headline numerals, active state |
| `--amber-dim` | `#7a5400` | amber at low intensity: grid, inactive ticks, burn-in ghost text |
| `--ice` | `#a8d8ff` | the other person's ("THEM") series |
| `--rose` | `#ff5470` | "connection": resultant vectors, the closing vectors in the intro, live markers. Sparingly. |
| `--ok` | `#9bd17a` | sync ok / healthy (muted phosphor green) |

**Warnings use terminal reverse video, not new hues:**
- **Concern:** a `--paper` background block with `--crt-black` text, label `[ CONCERN ]`.
- **Urgent:** a `#ff3b3b` background block with `--crt-black` text, label `[ URGENT ]`.

### Type
- **IBM Plex Mono** for everything: UI, labels, body, data. Labels are UPPERCASE at 11px with `letter-spacing: .12em`.
- **VT323** (pixel CRT font) for big numerals and the wordmark only. The headline % is VT323 at 160–200px in `--amber` with phosphor bloom.
- No sans-serif anywhere.

### Structure and texture
- Panels are framed with **box-drawing characters** or 1px `--rule` lines with corner glyphs: titles sit in the top border like `┌─[ RECIPROCITY ]──────┐`. Radius is 0. No shadows except phosphor bloom.
- **CRT layer** over the whole screen:
  - faint horizontal scanlines (`repeating-linear-gradient`, 2px period, about 6% opacity);
  - a very slight vignette;
  - text bloom (`text-shadow: 0 0 6px rgba(255,176,0,.55)` on amber text, `0 0 6px rgba(168,216,255,.45)` on ice);
  - an occasional subtle flicker (opacity 0.97–1.0).
- **Character-grid layout.** Spacing in multiples of 8px.
- **ASCII instruments:** sparklines with block glyphs `▁▂▃▄▅▆▇█`, bars as `████░░░░`, hatched gaps as `╱╱╱` or `···`, and tables with `│` separators and `─` rules.
- **Navigation** is a command bar, e.g. `[1]PEOPLE [2]DASH [3]CHAT [4]CONTEXT [5]FORMS [6]SOURCES [7]SET`, with the active item in reverse video amber. There's a prompt line at the bottom: `yucheng@lvs:~/dashboard $ ▌`.
- **Buttons** are bracketed text: `[ ENTER ] DISCUSS`, `[ D ] DONE`, `[ X ] DISMISS`. The primary action is in reverse-video amber.
- **Inputs** look like terminal fields: `PASSWORD › ••••••••▌`.

### Motion
- Text types in character by character for headings and logs (fast, 8–12ms per character). The block cursor `▌` blinks.
- Numbers count up with a slot-machine digit roll.
- The radar sweep is a rotating amber line with a phosphor afterglow trail.
- Screen changes use a quick CRT "line wipe": a 120ms horizontal scan reveal.

## The boot sequence (intro, plays before startup and during full-screen loads)
- **Scene:** a CRT viewport. A perspective 3D grid floor in `--amber-dim`, and an x/y/z axis gizmo at the origin labelled in Plex Mono 10px. The camera orbits slowly (about 8° per second).
- **Head-to-tail vector sum:** random 3D vectors are drawn tail-to-head as a running sum.
  - **They wander through different octants.** Each new vector aims the chain's tip into a different octant around the origin from the one it is in, cycling through all 8 octants in a random order. It never just drifts one way.
  - Lengths are about 0.8–2.4 units.
- **Pronounced lines:**
  - each vector is a 3px phosphor line with strong bloom and a solid arrowhead;
  - a node dot sits at every joint;
  - a dashed drop-line runs from each tip to the floor, with a small floor marker, so the depth reads;
  - each vector has a typed label like `v3 = ( 0.42, −1.10, 0.87 )`.
- **Colours:** vectors alternate `--amber` and `--ice`.
- **Count:** at least 5. A new one is added every ~600ms while loading continues, with no maximum.
- **Readout box:** `Σv = (x, y, z)` and `|Σv| = n.nn`, plus the octant currently being visited (`OCTANT +−+`).
- **Convergence:**
  - When loading completes, two `--rose` closing vectors whose sum is exactly −Σv bring the chain back to **(0, 0, 0)**. `|Σv|` rolls down to `0.00`.
  - The origin flashes and a ring pulses out.
  - The vectors collapse into the point, and `LOVEVECTORSPACE` types in beside it in VT323 with a blinking block cursor.
  - A typed boot log runs underneath (`> mounting encrypted store… ok`).

## Dashboard (MISSION CONTROL, terminal edition)
1. A top command bar plus a status line: sync states, last analysis, `[R] ANALYZE`.
2. A telemetry ticker: a single line of scrolling log entries.
3. **Centre stage: the RADAR.**
   - Concentric rings drawn in `--amber-dim`, with tick marks. The sweep line has a phosphor afterglow.
   - Each reciprocity metric is a **spoke vector**: ME in amber, THEM in ice, with the resultant in rose.
   - The headline `64%` sits in the centre in VT323, with the range drawn as an arc on the rim, and a reverse-video `[ UNCALIBRATED ]` stamp.
4. **Left:** `NEXT STEPS` as command cards with key hints.
5. **Right:** a locked `CALIBRATED` pane (`0/20 ░░░░░░░░░░`) and `TOP CONTRIBUTORS` as signed ASCII bars.
6. **Bottom:** an oscilloscope messages/week trace with `╱╱╱` hatching for no-coverage weeks, and the signal table with `│` columns and evidence tags like `[MOD]`, `[HEUR]`, `[DESC]`, `[SELF]`, `[UNCAL]`.

## Rules
- MUST:
  - monospace only (Plex Mono, plus VT323 for numerals);
  - 0 radius;
  - box-drawing frames;
  - an evidence tag on every metric;
  - the headline always shown with its range and `[ UNCALIBRATED ]` tag;
  - the disclaimer in the footer: `// This tool offers reflection and pattern warnings. It is not therapy, counselling, or a crisis service.`
- MUST NOT:
  - glassmorphism, blur panels, rounded corners or drop shadows;
  - acid green, purple, or gradient fills;
  - emoji or hearts;
  - call or SMS buttons;
  - generic "AI dashboard" card grids.

---

## v4 THEMES (owner request, 2026-11-23). This overrides the colour, font and effect sections above.
The layout, terminal structure (box-drawing frames, command bar, bracketed keys, ASCII instruments, prompt line) and every rule above stay. **Colours, fonts and effects are now theme tokens.** All screens include `.superdesign/themes.css` (inline in each file's `<style>`), set `data-theme` on the single root `<div>`, and use ONLY the CSS variables — no raw hex in component styles.

| Theme | Character | Display font | Effect layer |
|---|---|---|---|
| `signal` (**default**) | Swiss-print terminal: ink, warm paper, vermilion ME, cobalt THEM, saffron "connection" | Instrument Serif (tall editorial numerals; the headline % in italic serif) | print: no bloom, crisp, optional faint paper grain |
| `riso` (**playful**) | Risograph zine: cream paper, fluorescent pink ME, teal THEM, yellow highlights | Bricolage Grotesque 800 | misregistered 2px offset in the second ink, halftone-dot fills, sticker tags tilted −1.5°, 2px rules |
| `blueprint` (**technical**) | Engineering drawing: navy, white ink, highlighter-yellow ME, sky THEM, safety-orange markers | IBM Plex Mono | 24px blueprint grid, dimension lines with tick ends on charts, callout leaders, a title-block footer (`DWG LVS-002 · REV C · SCALE 1:1`) |
| `crt` (optional retro) | The amber phosphor look | VT323 | scanlines, vignette, flicker, bloom |

- **Theme switcher:**
  - `[T] THEME` in the command bar cycles themes, with a small popover listing all four, a swatch strip (`■ ■ ■`) and the active one in reverse video.
  - Settings has a "THEME" section with four preview tiles.
  - The choice persists per user.
- **The intro animation follows the theme:**
  - the vectors alternate `--me` and `--them`;
  - the closing vectors use `--link`;
  - the grid floor uses `--rule`;
  - bloom only in `crt`, halftone trail in `riso`, dimensioned axes in `blueprint`.
- **Every theme meets 4.5:1 text contrast** and has visible `--focus` rings.
- **Text-safe tokens (added during the refactor):**
  - Use `--me-t`, `--them-t`, `--link-t` and `--ok-t` for TEXT coloured in those hues.
  - Plain `--me`, `--them`, `--link` and `--ok` are for fills, strokes and vectors.
  - `--on-me` is the ink colour on a `--me` fill.
  - In riso these are darker inks, so text stays ≥4.5:1 on cream. The yellow `--link` is never used for text in riso.
  - Riso's `--urgent-bg` is `#c8231d`.
- **5th theme `journal` (non-technical, owner request).** A warm notebook look.
  - **Look:** DM Sans for the UI, Fraunces for display text, terracotta for ME, sage for THEM, 12px radius, soft card shadow.
  - **Hidden:** keyboard hints (`.key-hint`) and box-drawing glyphs (`.glyph`) are hidden in this theme. Buttons read as normal labelled buttons ("Discuss", "Done").
  - **Plain-language labels:** where an element has `data-plain`, show that label instead of the technical one (e.g. `initiation_share` becomes "Who starts conversations"). Evidence tags show plain words ("moderate evidence", "rule of thumb", "your own notes", "rough estimate").
  - **Exceptions:** this is the only theme allowed rounded corners and soft shadows.
- **6th theme `pulse` (pink, owner request).** Neon night palette:
  - **Colours:** plum-black background, hot-pink `#ff3d8b` leads (ME), electric cyan (THEM), acid-lime sparks (resultant / live marker).
  - **Fonts:** JetBrains Mono for UI/data, Unbounded 800 for display numerals.
  - **Effects:** neon bloom on pink, a slow chromatic shimmer on the headline, a faint drifting 3D vector field behind panels, and a 1px pink edge highlight on panel tops.
  - **Cycle order:** signal → pulse → riso → blueprint → journal → crt.
- **THEMES screen (owner request: adaptive, unique, cool)** — see `.superdesign/tmp/themes.html`.
  - Each theme is a **live specimen**: a mini animated radar plus a vector-sum loop, a type specimen and a swatch strip, all rendered in that theme's own tokens and effects.
  - Hovering or focusing a specimen previews the whole screen in it; click or Enter applies it.
  - **AUTO mode:** follows system `prefers-color-scheme` (light → journal, dark → signal), or a time-of-day schedule (07–19 day theme, otherwise night theme). The user picks the day and night themes.
  - **Accessibility controls:** reduced motion, contrast boost and text size.
  - Fully responsive: a specimen grid on desktop, swipeable full-bleed cards on phone.
- **Themes 7–9 (owner request: more themes):**
  - `inkwell`: high-contrast black and white e-ink, Atkinson Hyperlegible and Newsreader fonts. It's the accessibility theme: 7:1+ contrast, THEM drawn hatched so charts never rely on colour, 3px focus outlines, essential motion only.
  - `matcha`: a calm light theme in tea green and clay, with Manrope and Newsreader fonts, 8px radius and soft cards.
  - `midnight`: a refined dark theme, navy with gold and moonlight blue, with Outfit, Cormorant Garamond and JetBrains Mono fonts, gold hairlines and a faint star field.
- **Cycle order:** signal → pulse → riso → blueprint → journal → matcha → midnight → inkwell → crt.
- **AUTO defaults:** day = journal, night = signal. Each theme sets `--radius` (only inkwell, signal, riso, blueprint, pulse and crt are 0).
- **Device scaling rules (every screen):**
  - a viewport meta tag; fluid type with `clamp()`; layout in `rem`, `%` or `fr`, never fixed-width page containers;
  - canvases sized from their container with DPR handling, redrawn on `resize` and `orientationchange` (debounced);
  - no horizontal scroll at 320–1920px; tap targets ≥44px under 768px;
  - honour `env(safe-area-inset-*)`, `prefers-reduced-motion` and `prefers-color-scheme` (for AUTO).
