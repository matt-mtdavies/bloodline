---
target: src/components/AccessibleTree.jsx
total_score: 16
max_score: 40
na_heuristics: 0
p0_count: 1
p1_count: 3
p2_count: 1
target_identity: "file:/home/user/bloodline/src/components/AccessibleTree.jsx"
target_fingerprint: "sha256:821d501294a1a3799557c78ff952f67cbbfdf6316589ac227d9d26ecb474466d"
target_path: /home/user/bloodline/src/components/AccessibleTree.jsx
timestamp: 2026-09-13T15-58-38Z
slug: src-components-accessibletree-jsx
---
# Critique — `src/components/AccessibleTree.jsx` (List view)

**Method:** dual-agent (A: design review · B: detector + live-browser evidence), run in isolation per Impeccable's critique invariants.
**Grounded in:** full source of `AccessibleTree.jsx`, `components.css` (`.person-row`/`.listview` rules, lines ~1117–1269 and 3285–3307), `Avatar.jsx`, `theme.css`/`global.css` tokens, `App.jsx` (view-mode wiring), PRODUCT.md, DESIGN.md, and live inspection at 1280×900 and 390×844 against the seeded `?demo` family (23 people).

---

## Design Health Score — 16 / 40

Operate-mode surface (a navigation/task tool, not marketing or a showcase) — all 10 Nielsen heuristics apply; none marked n/a.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 1 | Tapping a directory row silently re-centres the whole page (measured `scrollTop` 1799→0, hero swaps person) with no transition and no announcement — 0 `[aria-live]` regions in the component. |
| 2 | Match with the real world | 3 | Kin-term labels ("Step Son", "Paternal Aunt") are genuinely excellent; docked for canvas jargon ("centred here") and dev vocabulary ("tag…") leaking into copy on a page with no camera. |
| 3 | User control and freedom | 1 | No undo/back after an accidental re-centre destroys a 2,783px scroll position; the search clear button has `tabIndex={-1}`, unreachable by keyboard. |
| 4 | Consistency and standards | 1 | The same `.person-row` markup does two different things depending on where it renders (hero opens a profile, every other row re-centres); two overlapping clear-buttons stack in the search field; "Great Grandparents" (heading) vs. "Great-Grandfather" (row) vs. "Living"/"Passed away" (adjective vs. verb phrase). |
| 5 | Error prevention | 2 | Two 34×34px icon buttons sit 13px apart from a third tap zone (the row itself), all on one thumb, with no confirmation and no way back from the wrong tap. |
| 6 | Recognition rather than recall | 2 | Strong in the focus section (grouping, avatars, kin terms); the directory forces recall ("who is David Walker to me?") and both row-action icons are unlabelled 15px glyphs for sighted users. |
| 7 | Flexibility and efficiency | 1 | Measured: the search input sits 1,078px into a 2,783px scroll for a 23-person demo family. Directory is first-name-alphabetical only, no letter index, no surname sort, no closeness sort — despite `distancesFrom` already existing and being used elsewhere in the app. |
| 8 | Aesthetic and minimalist design | 2 | `--card` and `--paper` resolve to the same white, so every resting row is separated from the page by a drop shadow alone, repeated once per person; a ghost-monogram watermark reads as mud at 42px avatar size. |
| 9 | Recognize/diagnose/recover from errors | 2 | "No one matches this search." is accurate but offers no recovery: no clear-and-retry action, no "search the whole tree" fallback. |
| 10 | Help and documentation | 1 | Two icon-only destinations (tree vs. chart circles) exist nowhere else in the user's mental model and are explained nowhere in-view; the topbar Legend documents canvas colors/lines, not these. |

## Design Specificity Verdict

**Split exactly at the fold, and both assessments independently converge on the same line.**

The LLM design review found the top ~340px of the surface — the focused-person hero and the immediate-family groups — unmistakably Bloodline: a terracotta-washed 64px portrait, a Fraunces serif name, and every relative captioned by a culturally-adaptive kin term (`relationLabel`) rather than a generic field. Everything from the "Everyone" directory down, however, reads as a component that could be lifted into a CRM or Slack member list unchanged: white shadowed rows, two grey icon circles, a `type="search"` box — with the one field that would make it a *family* directory (the relationship) computed 108 lines earlier in the same file and never carried down.

The deterministic scan corroborates a version of this from a different angle. The static file-level detector (`impeccable detect`) returned zero findings against the file in isolation — consistent with the component containing no single flagrantly broken rule, only an accumulation of pattern drift. Injecting the live-page detector against the actually-rendered DOM (necessary since a virtualized list's real markup only exists post-render) surfaced 44–46 anti-pattern hits: 11× `low-contrast` (two of these are near-misses on body text — `2.1:1` where `4.5:1` is required, on the muted meta-text color `#a6abb3` on `#f4f5f7`, repeated across 9 of those 11 hits) and one `undersized-ui-text` hit (10.5px stats text, though this one is attributable to `TopBar.jsx`, not this file — see Minor Observations). 31× `bounce-easing` also fired on an identical `cubic-bezier(0.34, 1.56, 0.64, 1)` curve; given DESIGN.md explicitly specifies "spring-eased motion" as a house convention, this is flagged as likely-intentional rather than a defect and should be confirmed against the design system rather than auto-"fixed."

Manual measurement (not caught by either automated pass) found the `.person-row__map`/`.person-row__chart` action buttons at 34×34px — below the 44×44px floor PRODUCT.md itself names — on the one view whose entire mandate is being the fully accessible parallel to the canvas.

## Overall Impression

List view knows exactly what Bloodline is supposed to feel like — and applies that knowledge to roughly the first fifth of the surface. The focused-person card and immediate-family groups are the most emotionally specific thing in the file: side-aware kin terms, a deliberate serif-for-one-name rule, and accessible naming (`aria-hidden` correctly keeping ghost-monogram text out of button labels) that would be easy to get wrong and isn't. Past that fold, the surface stops being about a family and becomes a roster — alphabetical by first name, undifferentiated at scale, with the one interaction that matters (open a profile) reserved for exactly one row on the page while every other row does something else that looks identical. For a 1,104-person production family, the "Everyone" directory *is* the product for the overwhelming majority of use, and today it's the part that reads least like Bloodline.

## What's Working

- **The Serif-Means-Someone rule is executed correctly, not just present.** Only `.person-row--focus .person-row__name` computes to Fraunces; every other name in the view stays in Hanken Grotesk. That's the harder, more disciplined version of the rule (one singled-out name earns the display face) rather than the easy failure mode of applying it everywhere.
- **The kin-term meta line is real product differentiation, correctly rendered.** `relationLabel(graph, focusId, item.id, kinTerms)` produces side-aware, culturally-adaptive labels ("Step Son", "Paternal Aunt") in the immediate-family groups — this is PRODUCT.md's "every family counts" principle actually landing in pixels, not just stated in a doc.
- **Accessible naming is genuinely clean in a spot that's easy to get wrong.** `Avatar.jsx` marks its monogram span `aria-hidden`, so duplicate initials text never leaks into a button's accessible name; the two row-action icons carry explicit, person-named `aria-label`s rather than bare "View"/"Tree" text.

## Priority Issues

### P0 — Tapping a person in the directory doesn't open their profile; it silently re-centres the whole page and destroys your scroll position
**What:** `.person-row__main` calls `onFocus(item.id)` (wired to `activate` in `App.jsx`) everywhere except `.person-row--focus`, which alone calls `onOpenPerson`. Measured live: tapping a directory row swapped the hero person, reset `scrollTop` from 1799 to 0, opened no sheet, and triggered zero `aria-live` announcements.
**Why it matters:** PRODUCT.md's founding thesis is "the tree is navigation, the profile is the destination." In the one view built to be the accessible, scale-proof parallel to the canvas, the profile is the single thing you cannot reach directly from where most people actually are (the directory). A user who finds someone after scrolling gets thrown back to the top of the page with no transition and no way back — indistinguishable from a bug.
**Fix:** Make the row's primary tap open the profile (`onOpenPerson`); move "centre the list on this person" to an explicit, separately-labelled action (or drop it — the profile sheet already offers "show their family"). If re-centring must stay primary, at minimum animate the transition, add an `aria-live="polite"` announcement, and preserve/restore scroll position.
**Suggested command:** this is an interaction/wiring fix, not a visual one — no single `/impeccable` command targets it directly. Make the code change directly, then run `/impeccable audit src/components/AccessibleTree.jsx` to confirm no accessibility regressions.

### P1 — The "Everyone" directory strips every person of their relationship, turning the family into a contact list
**What:** Directory rows render `lifespan(p)` + occupation; `relationLabel` — already imported and already used 108 lines earlier for the immediate-family groups — is never applied to directory rows.
**Why it matters:** For the real 1,104-person production family, the directory is where almost everyone lives; the immediate-family section covers maybe 20 people. This is precisely the "genealogy database with a tree bolted on" PRODUCT.md positions itself against.
**Fix:** Render `relationLabel(graph, focusId, item.id, kinTerms)` in directory rows too, falling back to the existing lifespan/occupation string where it returns nothing useful (distant in-laws, unrelated members).
**Suggested command:** `/impeccable clarify src/components/AccessibleTree.jsx`

### P1 — At real family scale, the directory is unnavigable, and the control that would save it is buried below the fold
**What:** Measured on a 390×844 phone: the search input sits 1,078px into a 2,783px scroll for the 23-person demo alone. Sort is first-name alphabetical with no letter index, no surname grouping, no closeness sort, and the immediate-family block above it has 9 non-collapsible group headings.
**Why it matters:** At 48× the demo's scale, a steward looking for one specific relative must scroll past their entire extended family to reach a search box, or abandon this view's own search for the topbar's global one — making List view's lower half dead weight to scroll past.
**Fix:** Make the search/filter row sticky (or hoist above the focus section); add sticky letter headers or an A–Z rail; offer a sort control (First name / Surname / Closest to you — `distancesFrom` already exists and is used elsewhere); make groups collapsible above ~6 items.
**Suggested command:** `/impeccable layout src/components/AccessibleTree.jsx`

### P1 — Every resting row is a shadowed white card on a white page — a named design-system rule broken, producing the generic-list look the brief explicitly forbids
**What:** `--card` and `--paper` are both `#ffffff`; `.person-row` sets `background: var(--card); box-shadow: var(--shadow-soft)` at rest, escalating to `--shadow-lift` on hover — the same elevation DESIGN.md reserves for full sheets.
**Why it matters:** DESIGN.md's Float-Only Rule states a shadow is "never applied to a resting, in-flow element just to add visual weight." A stack of equal-weight floating white tiles is the universal grammar of a records table — the opposite of the warm, editorial system this app is built on everywhere else.
**Fix:** Flatten rows to hairline separators on the paper ground (or a recessed `--paper-deep` group container), reserving card-with-shadow treatment exclusively for `.person-row--focus`.
**Suggested command:** `/impeccable polish src/components/AccessibleTree.jsx`

### P2 — The two row-action icons are 34×34px, unlabelled to sighted users, and are what's forcing rows to wrap unevenly
**What:** `.person-row__map`/`.person-row__chart` measure 34×34px (confirmed live on both desktop and phone) against PRODUCT.md's own 44×44px floor; their only affordance is a hover state that never fires on touch. The pair consumes ~94px of a 358px phone row, which is why the meta line (no truncation at all) wraps to 2–3 lines while the person's name — the most important string on the row — is the only text that clips.
**Why it matters:** Three adjacent tap targets on one thumb, with no confirmation and no way back from a mis-tap (compounding the P0 issue above), on the one view whose stated purpose is being the accessible parallel.
**Fix:** Raise both hit areas to 44×44px (icon can stay visually smaller inside a larger padded target); consider collapsing the pair into one action or moving both behind a swipe/long-press. Give the meta line `text-overflow: ellipsis` and let the name wrap before it does.
**Suggested command:** `/impeccable adapt src/components/AccessibleTree.jsx`

## Persona Red Flags

**The screen-reader user — the persona this component exists for.** PRODUCT.md commits to this view as "a fully semantic/keyboard-navigable list view... never a degraded fallback." Five concrete breaks: the virtualized list has no `aria-setsize`/`aria-posinset` (a screen reader announces "list, 11 items" for a family of 1,104, with no way to perceive true size); zero live regions anywhere, so both search filtering and the re-centre-on-tap bug are invisible to assistive tech; the one primary, most-consequential action (`.person-row__main`) is the *only* unlabelled control — its two secondary siblings both announce explicit verbs; nine `<h3>`s with no `<h2>`/`<h1>` for heading-jump navigation; and the search clear button is unreachable by keyboard (`tabIndex={-1}`).

**The family steward on a phone — PRODUCT.md's primary persona, 1,104 people, heavy photo/document use.** She opens List view specifically because the canvas is unusable at her scale, then meets 1,078px of scrolling before a search box, a first-name roster with no letter index, rows that never say who anyone is to her, and — when she finally finds who she's looking for — a tap that throws her to the top of the page instead of opening them. She will likely abandon this view's own search for the topbar's global search, making the lower two-thirds of the surface dead weight.

**Riley (stress-tester, pushing the app past demo scale).** Everything measured against the 23-person demo — the buried search, the non-collapsible 9-group header stack, the missing size announcements — scales roughly 48× in the real production family. None of the P1 fixes above were validated against real 1,104-person data in this pass (only the demo seed); a stress-tester persona would be the fastest way to confirm the fixes actually hold at that scale before shipping.

## Minor Observations

- Two clear-buttons visually overlap in the search field: the native `type="search"` cancel glyph isn't suppressed (that suppression rule exists only on a different search input elsewhere in the codebase), and the custom clear button's padding compensation targets a CSS class (`.input-wrap > .search`) that doesn't match the actual wrapper (`.search-wrap`) — a long query runs under both.
- The live result count ("Everyone · 12 of 23") is styled as a 12px uppercase field-label eyebrow — the least legible treatment available for the one number a user is watching change while they type.
- `.listview` scrolls content underneath the topbar with no mask/fade; a row can be visually bisected by the semi-transparent header pill.
- Desktop renders List view as a 620px column inside a 1280px window with no responsive breakpoint — 330px of dead gutter per side, forcing a two-screen scroll for a 23-person family.
- Copy inconsistencies: "Great Grandparents" (heading) vs. "Great-Grandfather" (row); "Living" vs. "Passed away" (adjective vs. verb phrase); "centred here" (camera language on a page with no camera); "tag…" (developer vocabulary in a placeholder).
- `.person-row--current`'s focus-adjacent outline (`2px solid var(--accent-soft)`) is visually close to the global `:focus-visible` outline (`2px solid var(--accent)`) — two different meanings, nearly the same mark.
- Detector/measurement gap worth flagging on its own: neither the static file-level detector nor the live overlay's rule set caught the 34×34px touch targets — that finding came only from direct manual measurement. Treat a clean detector run as necessary, not sufficient, evidence for this codebase's touch-target floor.
- The live overlay's 31× `bounce-easing` hits are all the identical curve (`cubic-bezier(0.34, 1.56, 0.64, 1)`) — worth confirming this matches DESIGN.md's documented spring-motion token rather than treating it as 31 independent defects.

## Questions to Consider

- What if List view stopped mirroring the canvas's "one person is centred" ego model in DOM, and just became the fastest route to a profile — row tap opens, hero becomes a breadcrumb, and "centre here" moves to the canvas where centring is a visual experience worth having?
- What if "Everyone" weren't alphabetical at all? `distancesFrom` already exists and is used elsewhere — sorting the directory by closeness-to-you by default (parents/children first, then aunts and cousins, then distant in-laws) would make the top of the list useful instead of arbitrary.
- What if rows carried no card/shadow at all — just names on paper with a hairline rule, like an index at the back of a family book — reserving the one floating, shadowed treatment for the person actually being looked at?
