---
name: Bloodline
description: A living portrait of a family — the tree is navigation, the profile is the destination, the stories are the product.
colors:
  paper: "#ffffff"
  paper-deep: "#f2f3f5"
  card: "#ffffff"
  ink: "#1c1d21"
  ink-soft: "#6b6f76"
  ink-faint: "#a6abb3"
  hairline: "#ebedf0"
  accent: "#c2603a"
  accent-deep: "#a44d2c"
  accent-soft: "#f0d9cd"
  sage: "#3f5e4e"
  sage-soft: "#d8e0d6"
  gold: "#b08642"
  bond-current: "#c2603a"
  bond-former: "#b9ab98"
  bio: "#8a7d6b"
  nonbio: "#b6a892"
  memorial: "#6b5e7a"
  memorial-soft: "#e6dff0"
  error: "#c0392b"
  error-deep: "#b94040"
  error-soft: "#fef2f2"
  error-border: "#f5b7b1"
  error-border-strong: "#e57373"
typography:
  display:
    fontFamily: "Fraunces, Georgia, 'Times New Roman', serif"
    fontWeight: 500
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
rounded:
  pill: "999px"
  sm: "10px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#fffdf9"
    rounded: "{rounded.lg}"
    height: "50px"
  button-neutral:
    backgroundColor: "{colors.paper-deep}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "50px"
  pill:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "38px"
  pill-on:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-deep}"
    rounded: "{rounded.pill}"
  chip:
    backgroundColor: "{colors.paper-deep}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
  chip-on:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
---

# Design System: Bloodline

## Overview

**Creative North Star: "Warm, editorial, human — heirloom photo album meets a living interface."**

This is the incumbent direction, stated verbatim in `src/styles/theme.css`'s own
header comment — not an invented metaphor, the actual source of truth the
codebase already holds itself to. Bloodline reads as a physical, cared-for
object (paper, ink, a warm accent, generous type) that happens to move and
breathe (spring-eased motion, an always-drifting tree, a logo that breathes
while saving) rather than as software chrome. It is deliberately **not**
enterprise SaaS, not a dashboard, and not a research database with a UI
bolted on — see PRODUCT.md's Positioning and "What Bloodline is not."

Distinctiveness is spent deliberately, not evenly: the tree visualizations
and the Keepsake (a separate, editorial magazine-reading experience — see
`docs/KEEPSAKE.md` and its own design language, intentionally more ornate
than the rest of the app) are where the product is allowed to be bold. Forms,
settings, and management surfaces stay calm, restrained, and unshowy by
comparison, so the few genuinely bespoke moments keep their power. There is
no generic `.card` component anywhere in `components.css` — panels, sheets,
and rows are purpose-built per surface rather than assembled from a
one-size-fits-all container, which is itself a confirmed, load-bearing
absence, not an oversight.

**Key characteristics:**
- One warm terracotta accent against a near-white paper ground; a quiet sage
  green as its only real companion color, plus a small, sparingly-used
  supporting cast (gold, a dignified memorial violet) — never a rainbow of
  equally-weighted brand colors.
- Fraunces (serif, editorial) for headings and emotionally-weighted moments;
  Hanken Grotesk (sans) for everything functional — facts, instructions, UI
  chrome.
- Pill shapes (999px radius) for anything tappable and small (icon buttons,
  chips, badges); soft 12–16px radii for panels, fields, and buttons; 24px
  for full sheets. Sharp corners essentially never appear.
- Motion is spring-eased and purposeful — arrival, confirmation, and
  "something is now here" moments get a gentle overshoot; simple state
  changes get a quieter, non-bouncy ease. Nothing snaps, nothing is linear,
  and `prefers-reduced-motion` is honored everywhere.
- Flat by default; a soft ambient shadow only appears on things that
  genuinely float above the page (a sheet, a hover card, a floating
  nameplate) — never as decoration on a resting element.

## Colors

The palette is intentionally narrow: one warm accent, one quiet companion,
and a small set of semantic colors for relationship and status meaning —
never an open-ended brand palette.

### Primary
- **Terracotta** (`#c2603a`, token `--accent`): the one warm accent. Primary
  actions, the current-partnership membrane in the tree, active/"on" states,
  the brand mark's two main bubbles. A deeper terracotta (`#a44d2c`,
  `--accent-deep`) and a soft tint (`#f0d9cd`, `--accent-soft`) extend it for
  hover/active and quiet "on" backgrounds respectively — never a different
  hue standing in for "more emphasis."

### Secondary
- **Sage** (`#3f5e4e`, token `--sage`): "the companion green for the second
  partner / biology," per its own source comment — the deliberate second
  voice in the palette, paired with a soft tint (`#d8e0d6`, `--sage-soft`)
  the same way terracotta is.

### Tertiary
- **Gold** (`#b08642`, token `--gold`): "the mark's third bubble +
  odd-one-out accents" — used sparingly, reserved for the third element in
  the brand mark and genuine one-off distinctions, not a general-purpose
  third brand color.

### Neutral
- **Paper** (`#ffffff`, `--paper`): page background.
- **Paper Deep** (`#f2f3f5`, `--paper-deep`): recessed panels, resting
  buttons, hover tints — the app's one "sunken" surface tone.
- **Ink** (`#1c1d21`, `--ink`): primary text.
- **Ink Soft** (`#6b6f76`, `--ink-soft`): secondary text.
- **Ink Faint** (`#a6abb3`, `--ink-faint`): tertiary text and placeholders.
- **Hairline** (`#ebedf0`, `--hairline`): the one divider/border color used
  almost everywhere a line is needed.

### Relationship semantics (signature to this product — see Do's and Don'ts)
- **Bond Current** (`#c2603a`, same as accent): a current partnership's
  visual membrane in the tree.
- **Bond Former** (`#b9ab98`): a former partnership — visibly faded, never
  hidden.
- **Bio** (`#8a7d6b`) / **Nonbio** (`#b6a892`): biological vs.
  adopted/step/foster parent-child links — a deliberately subtle, not
  alarming, distinction.
- **Memorial** (`#6b5e7a`) + **Memorial Soft** (`#e6dff0`): "a dignified
  violet for those who've passed" — the one place the palette steps outside
  warm terracotta/sage/gold, on purpose, for a graver register.

### Named Rules
**The One Accent Rule.** Terracotta is the only color that means "primary
action" or "this is active." Sage, gold, and memorial violet each have one
specific, narrow job (companion/biology, rare odd-one-out, remembrance) and
are never substituted for the primary accent's role.

**The No Dark Mode Rule.** Every color above is a hardcoded hex value, and
`theme.css` forces `color-scheme: light only`. This is a deliberate,
documented decision (iOS Safari must not invert these colors) — never
introduce a `prefers-color-scheme: dark` block or CSS `light-dark()` swap
without revisiting that decision explicitly first.

**The Error-Is-Not-Everywhere Rule.** A dedicated red-error palette exists
(`--error` `#c0392b`, `--error-deep` `#b94040`, `--error-soft` `#fef2f2`,
`--error-border` `#f5b7b1`, `--error-border-strong` `#e57373`) for
validation and destructive-action states — but the Keepsake's own edition
banner deliberately avoids red entirely in favor of a desaturated ink-gray,
to keep that one editorial surface from reading as a system warning. Follow
whichever convention the surface you're editing already uses; don't import
red into Keepsake or drop the Keepsake's ink-gray convention into ordinary
app chrome.

## Typography

**Display Font:** Fraunces (with Georgia, Times New Roman, serif fallbacks)
**Body Font:** Hanken Grotesk (with system-ui/sans-serif fallbacks)

**Character:** An editorial serif carrying names, headings, and emotionally
significant moments, set against a clean, highly legible grotesque sans for
everything functional — the same pairing logic as a well-set magazine: the
serif is voice, the sans is information.

### Hierarchy

There is **no formal numeric type scale** — `theme.css` defines only the two
font-family tokens; every component sets its own size, hand-tuned in ~0.5px
increments (13px/13.5px/14px/14.5px are all real, distinct, intentional
values in the codebase). Do not invent or impose a scale; match the nearest
existing sibling value instead of rounding to a "clean" number.

- **Display** (weight 500–600, `letter-spacing: -0.01em`, sizes from ~20px
  to ~23px observed): person/sheet headings, profile hero names, the
  Keepsake's own larger, more ornate display treatment (italic, drop caps —
  documented separately in `docs/KEEPSAKE.md`, not part of the base app
  scale).
- **Body — primary** (14–16px): the dominant reading size for profile
  content, form labels' values, and card copy.
- **Body — secondary** (12.5–13.5px): supporting text, hints, metadata,
  sub-labels — the single most common size band in the codebase.
- **Label** (11–12px, often `text-transform: uppercase` with letter-spacing,
  e.g. `.field__label`, section eyebrows): field labels and section
  headers, uppercase-and-tracked rather than sized up.

### Named Rules
**The Serif-Means-Someone Rule.** Fraunces is reserved for names, headings,
and narrative — never for buttons, labels, or numeric/tabular content. If a
string is a person's name or a heading, it earns the display font; if it's
an instruction, a value, or UI chrome, it stays in Hanken Grotesk.

## Layout

No CSS grid system or spacing-token scale exists (`theme.css` tokenizes
radius and shadow, but not spacing) — gaps and padding are hand-set per
component, most commonly in the 8–24px range (8/10/12/14/16/18/22/24px all
recur constantly). Match the nearest existing sibling spacing rather than
introducing a new value or a formal 4/8pt grid the project has never used.

Sheets and cards are the two dominant containment patterns:
- **Bottom sheet** (`.sheet`): full-width, slides up from the bottom
  (`sheet-up`, spring-eased), rounded only on its top two corners
  (`--radius-lg`, 24px) — the default on mobile and for most modals.
- **Side-docked card** (`.sheet--card`): on wider viewports, a person's
  profile opens as a narrower card docked to one side with the tree canvas
  still visible and softly dimmed behind it (`.sheet-scrim--soft`, an 8%
  scrim, not a heavy modal backdrop) — a deliberate "the tree is still
  there, you haven't left it" choice, not a generic centered modal.

Public marketing pages additionally specify (`docs/PRODUCTIZATION-BRIEF.md`
§9): mobile-first composition, one hero per page with a restrained rhythm of
sections (explicitly avoiding "SaaS-card overload"), and verification at
320px / 390px / 768px / desktop breakpoints.

## Elevation & Depth

Flat by default. Two shadow tokens exist and are used sparingly, only for
things that are genuinely floating above the page — never as decoration on
a resting panel, and there is no generic elevated "card" surface.

### Shadow Vocabulary
- **Soft** (`--shadow-soft`: `0 1px 2px rgba(20,22,28,0.04), 0 6px 20px rgba(20,22,28,0.07)`): a light ambient lift — pills, chips on hover, hover-preview cards.
- **Lift** (`--shadow-lift`: `0 2px 8px rgba(20,22,28,0.06), 0 20px 50px rgba(20,22,28,0.14)`): a stronger, more deliberate elevation for full sheets and anything that should read as clearly "above" the rest of the interface.

### Named Rules
**The Float-Only Rule.** A shadow means "this is physically above the
surface right now" (a sheet, a floating nameplate, a hover card) — it is
never applied to a resting, in-flow element just to add visual weight.

## Shapes

Rounding is the primary form language, and it is legible at a glance: pill
(999px) for anything small and tappable, 12–16px for panels/fields/buttons,
24px (`--radius-lg`) for full sheets. Borders are a single hairline
(`#ebedf0`) used for quiet separation, not for emphasis — emphasis comes
from color and shadow, never a heavier border weight. Sharp (0px) corners
essentially never appear in the reviewed CSS.

## Components

### Buttons
- **Shape:** 16px radius (`--radius`), 50px height, full-width or flexed
  within a footer row.
- **Primary:** terracotta background (`--accent`), off-white text (`#fffdf9`); `filter: brightness(1.05)` on hover — a brightness shift, not a color swap.
- **Neutral:** `--paper-deep` background, `--ink` text; `brightness(0.97)` on hover (darkens instead of brightens, since its resting tone is already near-white).
- **Danger:** a dedicated soft-red background/text pairing (`#fdf1ef` / `#b03a2e`) distinct from the newer semantic `--error` tokens used in validation contexts — both exist; danger *buttons* use this pairing, validation *messages/borders* use the `--error-*` tokens.
- **Press feedback:** `transform: scale(0.97)` on `:active` — every primary tap target compresses slightly rather than just changing color.

### Pills (icon buttons — topbar search/bell/filters)
- **Style:** 999px radius, 38px height/min-width, white background, hairline border, `--shadow-soft`.
- **"On" state:** a soft accent tint (`--accent-soft` background, `--accent-deep` text) — never a solid accent fill for a toggle that isn't a primary action.
- **Hover/active:** background shifts to `--paper-deep`; `scale(0.94)` on press.

### Chips (relationship types, filters, search results)
- **Style:** pill-shaped, `--paper-deep` background, transparent border.
- **Selected ("on"):** solid `--accent` fill, white text, and a colored glow shadow (`0 6px 16px rgba(194,96,58,0.28)`) — the one place a chip gets a tinted shadow instead of the neutral shadow tokens, because it's communicating active selection, not elevation.
- **Disabled:** `opacity: 0.38`, no pointer affordance.

### Sheets / Cards (profile, edit forms, most overlays)
- **Bottom sheet** vs. **side-docked card**: see Layout. Both animate in with a spring (`sheet-up` / `card-in`), never appear instantly.
- **Corner style:** top-only 24px radius on the bottom sheet; full 24px on the docked card.
- **Border:** the docked card adds a hairline border (the bottom sheet does not need one, since it's edge-to-edge).

### Inputs / Fields
- **Style:** 50px height, 14px radius, hairline border, white background.
- **Focus:** border shifts to `--accent` plus a soft accent-tinted glow (`0 0 0 3px rgba(194,96,58,0.14)`) — a glow, not an outline ring.
- **Error:** border shifts to `--error-border`, background to `--error-soft`, a brief horizontal shake (`shake-x`, 0.22s), and the adjacent error text fades/settles in (`error-text-in`) rather than appearing instantly — all newly consolidated onto the shared `--error-*` tokens; see `--error` in Colors.

### Disclosure panels (Privacy/Military sections, collapsible groups)
- Auto-height reveal via a CSS `grid-template-rows: 0fr → 1fr` transition, not a fixed max-height guess — content stays mounted through the closing transition (a short delayed-unmount) so the collapse always has something to animate shut.

### Signature component: the ego-centric tree canvas
Not a DOM component — a PixiJS/WebGL canvas (`src/viz/BubbleTree.jsx` and
siblings) with its own physics-driven visual language (bubble portraits,
soft drop-shadow sprites, a warm radial glow texture for birth/focus
moments, spring-driven camera motion). It deliberately does not borrow the
DOM component vocabulary above (no pills, chips, or card shadows inside the
canvas) — see the Bespoke Surfaces note below and `PRODUCT.md`'s Brand
Commitments.

## Do's and Don'ts

### Do:
- **Do** keep terracotta as the only color meaning "primary/active" (The One Accent Rule).
- **Do** use Fraunces only for names, headings, and narrative — never for buttons, labels, or data values (The Serif-Means-Someone Rule).
- **Do** default to pill radius (999px) for small tappable controls and reserve sharp/small radii for nothing — this codebase has no sharp-cornered UI.
- **Do** use a shadow only on something that is genuinely floating above the page; keep resting elements flat (The Float-Only Rule).
- **Do** spring-ease (`var(--spring)`) arrivals and confirmations; use the plainer `var(--ease)` for simple state transitions; respect `prefers-reduced-motion` on every new animation.
- **Do** match the nearest existing sibling's font-size/spacing value by inspection rather than introducing a new "round" number — there is no scale to round to.

### Don't:
- **Don't** introduce a generic `.card` grid/dashboard layout — this codebase deliberately has none, and Bloodline's own product brief explicitly names "SaaS-card overload" as something to avoid.
- **Don't** add a second, unrelated brand color "for variety" — sage and gold each have one narrow, specific job; a new hue needs a specific relationship or status meaning, not decorative variety.
- **Don't** simplify the bespoke tree visualizations (organic/Bubble, Chart, Canopy, Atlas) or the Keepsake into ordinary DOM component patterns (cards, standard nav, generic modals) — they are intentionally distinct surfaces; see `PRODUCT.md` and the "Bespoke surfaces" guidance a reviewer should apply before touching them.
- **Don't** add dark-mode support or a `prefers-color-scheme` branch — colors are hardcoded on purpose (The No Dark Mode Rule).
- **Don't** treat the internal `?lab=` motion/layout experimentation harnesses (TreeMotionLab, FocusLab, AtlasLab) as shipped UI needing this system's polish — they're engineering tools, never reached by a real visitor.
