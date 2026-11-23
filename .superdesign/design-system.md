# LoveVectorSpace — design system

## Product context
LoveVectorSpace is a private, single-user web app. It helps one person:
- read **reciprocation** with someone they like ("potential" mode);
- keep a relationship they're in **healthy** ("established" mode).

Data comes from three places: a browser extension that captures WhatsApp Web, Discord and Instagram DMs; manual chat imports; and questionnaires. The app shows evidence-tagged signals, a headline **chance of success**, next-step cards, and a planning chat with an AI agent that also interviews the owner and logs in-person hangouts.

**Tone:** precise and calm, like an instrument console, never cutesy. Unhealthy dynamics get **warnings only**: a warning block with a plain-text resource list. No call buttons, no `tel:` links, no alarms.

### Key screens
1. **People:** person cards with mode, sources (WhatsApp / Discord / Instagram / import, with last-sync time) and safety status. Plus a **Sources & import** view: upload dialog, speaker mapping ("which name is you?"), and a units list with delete.
2. **Person dashboard**, top to bottom:
   - safety warning block (only when flags exist);
   - **headline: chance of success**, shown as two numbers: uncalibrated estimate (big %, with a range bar and an "UNCALIBRATED" tag) and calibrated estimate ("NOT AVAILABLE — needs N labelled outcomes" until phase 2);
   - **Reciprocity at a glance** panel (the supporting metrics);
   - weekly messages chart (me vs them, uncovered weeks hatched);
   - signal table with evidence tags;
   - questionnaire results;
   - next-step cards.
3. **Agent chat + interview:** streaming chat, tool-call chips, an Interview mode with a topic progress rail, and a "Log a hangout" guided check-in.
4. **Extension popup** (360×560): current chat link status, rough stats (counts and share only), backfill controls (date picker, rate-limited, with a stop reason), per-platform health and toggles.

## Visual language: "Operating Console"
**Industrial/technical minimalist.** Function and precision over decoration.

### Colour
| Token | Value | Use |
|---|---|---|
| `--bg` | `#0f1115` | app background |
| `--bg-deep` | `#050608` | canvases, inputs, terminal boxes |
| `--panel` | `#14161a` | sidebars and panels |
| `--node` | `#151b23` | cards and nodes |
| `--border` | `#2d333b` | 1px borders everywhere |
| `--text` | `#cbd5e1` | primary text |
| `--text-dim` | `#64748b` | secondary text and labels |
| `--accent` | `#d4ff00` | acid green: the ONLY brand accent (primary actions, active state, headline numbers) |
| `--them` | `#38bdf8` | cyan: the other person's series in charts |
| `--me` | `#d4ff00` | the owner's series in charts |
| `--warn` | `#f59e0b` | amber: "concern" warnings, "partial coverage" tags |
| `--urgent` | `#ef4444` | red: "urgent" warnings only |
| `--ok` | `#4ade80` | green: healthy sync, ok status |

| `--pulse` | `#ff3d8b` | hot pink: used sparingly for the "connection" moments — the resultant vector, the headline's live marker, the active nav glow. Never for warnings. |

**Depth palette (v2: less flat):**
- Glass panels: `rgba(20,22,26,0.72)` with `backdrop-filter: blur(12px)` over the animated background.
- Glow: `0 0 24px rgba(212,255,0,.18)` on headline and active elements; `0 0 18px rgba(255,61,139,.22)` on pulse elements.
- Gradients are allowed ONLY as light, not as decoration:
  - radial vignettes behind the headline;
  - a 1px accent→transparent edge highlight on panel tops;
  - fading trails on moving vectors.

### Type
- **UI labels and headers:** Inter 600, UPPERCASE, `tracking-wider`, 10–12px for labels.
- **Data, values, IDs, timestamps, evidence tags:** JetBrains Mono 400. The headline percentage is JetBrains Mono at 64–80px in `--accent`.
- **Body text** in chat and notes: Inter 400, 14px, sentence case.

### Shape and effects
- 1px solid borders. **Border radius is 0px everywhere.** No soft shadows.
- 40px background grid in `--border` at 20% opacity on canvas areas.
- Corner ticks (4×4px L-shapes) on major containers.
- Evidence tags are small mono chips with a 1px border:
  - `MODERATE` in `--accent` text;
  - `HEURISTIC` in `--text-dim`;
  - `DESCRIPTIVE` in `--text-dim`;
  - `SELF-REPORT` in `--them`;
  - `UNCALIBRATED` in `--warn`.

### Motion
- Mechanical, snappy transitions (linear or fast cubic-bezier, 120–180ms). Nothing bouncy.
- Live/streaming indicators use a 1px expanding border pulse.
- **INTRO / BOOT SEQUENCE (plays before startup and during any full-screen load)**, a 3D vector-addition animation:
  - **Scene:** a black (`--bg-deep`) viewport with a faint perspective 3D grid floor and an x/y/z axis gizmo at the origin labelled in 10px mono. The camera slowly orbits (about 8° per second).
  - **Mechanic:**
    - Random 3D vectors are drawn **head-to-tail**. Each new vector starts at the tip of the previous one, so the chain is a running vector sum.
    - Each vector animates in: a line grows from its tail to its head in 350–500 ms, with an arrowhead, a fading trail, a glow, and a mono label like `v₃ = (0.42, −1.10, 0.87)`.
    - Colours alternate between `--accent` and `--them`.
    - A live readout in the corner shows `Σv = (x, y, z)  |Σv| = 2.31` in mono.
  - **Count:** at least **5 vectors**. While loading continues, more random vectors keep appending, one every ~600 ms, with no fixed maximum.
  - **Convergence:**
    - When loading finishes, one or two final vectors are computed as the exact negative of the running sum (split across them for elegance) and drawn in `--pulse` pink. They bring the chain back to **(0, 0, 0)**.
    - `|Σv|` counts down to `0.00`.
    - The origin flashes, a ring pulses out, the vectors collapse into the origin point, and the wordmark `LOVEVECTORSPACE` types in beside the origin in mono with a blinking cursor.
    - Then everything cross-fades into the app.
  - **Randomness:** each vector's direction is uniform on the sphere, with length 0.6–1.6 units. A new random seed is used each launch.
  - **Status line:** a boot log under the canvas in 11px mono, typed in: `> mounting encrypted store… ok` / `> loading signal models… ok` / `> syncing extension… 3 new messages`.
- **Loading animation (signature):** a 3D vector field. Several thin arrows (1px lines with small arrowheads) in `--accent` and `--them` float and slowly rotate around a shared origin inside a wireframe cube or axis gizmo (x/y/z ticks). They drift, converge, rotate as one group, then diverge — vectors finding alignment. It's drawn with CSS 3D transforms or canvas.
  - Used full-panel while analysis jobs run, with a mono caption like `COMPUTING SIGNALS… 42%`.
  - A small 24px version is used inline for streaming and agent typing.
- Terminal scanline: a 2px horizontal bar sweeps vertically across terminal/chat boxes every 4s, very subtle.

## Components
- **Headline Success Module:** a large mono % in `--accent`, with a horizontal range bar (low–high band, point marker) under it. It carries an `UNCALIBRATED` tag and the definition line ("interest is mutual and moves toward dating"), plus an ⓘ tooltip with the research caveat. Beside it sits a second, dimmer box: "CALIBRATED — NOT AVAILABLE · needs 20 labelled outcomes", with a progress tick bar (0/20). Below both, a "TOP CONTRIBUTORS" list of 3 signals with signed ±pp values.
- **Reciprocity panel:** a grid of compact metric cells. Each cell has an uppercase label, a mono value, a me/them split bar (acid vs cyan), an evidence tag, and a one-line "can't tell you" note revealed on hover.
- **Safety Warning Block:** a full-width panel with a `--warn` (concern) or `--urgent` (urgent) left border bar and an icon. It shows a flag list (category, severity, count, dates) and evidence snippets in mono. Under it, a "RESOURCES — suggestions only" plain-text list (name · number · text code · website) with **no buttons and no links that dial**. Last comes the disclaimer line: "This tool offers reflection and pattern warnings. It is not therapy, counselling, or a crisis service."
- **Next-step card:** a node-style card with a kind tag (TALK / PLAN / REFLECT / PAUSE), title, "why" text and evidence ref chips (`metric:lsm`, `fact:12`). Actions: DONE / DISMISS / DISCUSS as sharp outline buttons. DISCUSS is the accent-filled primary.
- **Primary button:** `--accent` background, black bold text, sharp; on hover it moves 1px down with a glow of `0 0 15px rgba(212,255,0,.3)`. Secondary buttons are 1px-border outlines.
- **Inputs:** `--bg-deep` background, 1px `--border`, with 10px mono labels above.
- **Chat:** owner messages right-aligned in `--node` blocks; agent messages left-aligned with a 1px `--accent` left rule. Tool calls show as collapsible mono chips (`▸ get_person_overview(person_id=3)`). The composer is a terminal-style prompt (`> _`).
- **Status bar:** a top bar with `SYSTEM_ONLINE`-style status chips (extension sync, last analysis time, Groq ZDR reminder).

## Rules
- MUST: 0px radius, 1px borders, uppercase mono IDs, evidence tags on every metric, headline always with its tag and range.
- MUST NOT: rounded corners, decorative gradients (light-only gradients per the depth palette are fine), heavy drop shadows, photography, hearts or emoji as decoration, call or SMS action buttons, a single unqualified score without its range.
- **Make it alive, not flat:**
  - an ambient, very slow 3D vector-field background behind glass panels;
  - the headline number counts up on load;
  - the range bar has a breathing glow;
  - charts draw in;
  - hover states reveal mono detail;
  - strong typographic hierarchy (oversized mono numerals vs tiny uppercase labels);
  - asymmetric layouts with one dominant hero element per screen rather than equal-weight boxes.
- Footer on every screen: the disclaimer line in `--text-dim` at 11px.
