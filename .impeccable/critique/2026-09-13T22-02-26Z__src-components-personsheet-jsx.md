---
target: profile view and its dialogs
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:/home/user/bloodline/src/components/PersonSheet.jsx"
target_fingerprint: "sha256:039cfa958c58a49448fbb0915715e178194b76f67fb56181983e10d85b5f4e19"
target_path: /home/user/bloodline/src/components/PersonSheet.jsx
timestamp: 2026-09-13T22-02-26Z
slug: src-components-personsheet-jsx
---
Method: dual-agent (A: design review + live browser · B: deterministic detector + live overlay injection), isolated sub-agents.

# Design Health Score — Profile view & its dialogs

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Lightbox caption saves silently on keystroke beside a "Save" button that means download |
| 2 | Match System / Real World | 3 | Same bio field is About / A memory or story, while Memories is a different feature |
| 3 | User Control and Freedom | 2 | No undo anywhere; Escape in DocViewer closes the profile behind it (docViewer missing from App.jsx:3435 lockEscape) |
| 4 | Consistency and Standards | 2 | Two competing card recipes: .memory flat vs .doc-card/.places-detail/.education-rung__card elevated |
| 5 | Error Prevention | 2 | "Change to -> Child" commits instantly, 40px from a guarded Remove |
| 6 | Recognition Rather Than Recall | 3 | Mother/Father disabled reasons only in title tooltips, invisible on touch |
| 7 | Flexibility and Efficiency | 1 | No keyboard path into the profile; 9 relationship groups flat and uncapped |
| 8 | Aesthetic and Minimalist Design | 1 | Mobile 5,075px (6.4 screens); 342px of buttons; first fact 860px down |
| 9 | Error Recovery | 2 | Three raw img tags with no fallback; onDocPick swallows failures in bare catch {} |
| 10 | Help and Documentation | 3 | Nothing explains what a relationship qualifier does |
| **Total** | | **22/40** | **Acceptable — significant improvements needed** |

# Design Specificity Verdict

Specific above the fold, generic below it — and the detector independently proved the seam.

Design review: hero is unmistakably Bloodline (Fraunces name on portrait, Keepsake-masthead kin kicker, prose meta "Born 1935 · Passed away 2011 · Lived 76 years"). Below the hero: thirteen identical grey eyebrows with terracotta Add links over grey empty-state pills — a CRM record with a beautiful cover page. EnrichSheet invents a five-colour tier system (#7a5cc7, #3d6fa8, #3d8c66) absent from DESIGN.md, with token fallbacks (var(--ink, #241f1c)) that don't match real tokens (#1c1d21).

Deterministic corroboration: live detector found gpt-thin-border-wide-shadow (1px border + 50px shadow) in EditPersonSheet, AddRelativeSheet, MemorySheet, TimelineEditor — absent from PersonSheet. Same for flat-type-hierarchy (h3 12px / h4 13px / body 16px, 1.23:1 vs 1.25:1 target): present in all five form dialogs, absent from the profile. Two methods, same seam.

Static CLI: exit 2, 4 findings, all design-system-color: #bbb/#ccc at PersonSheet.jsx:865,871 and EditPersonSheet.jsx:400. Verified by hand — fallback swatch colours for hair/eye trait dots plus a 1px inset border so a White swatch doesn't vanish. Real drift but trivial; P3.

Caveat: overlay scans whole DOM and the page behind modals stays mounted, so baseline counts (low-contrast x37-45, bounce-easing x31-32) repeat across all eight states and can't be attributed to any one dialog. Only deltas are trustworthy signal.

Overlays: no persistent human-viewable tab — injection succeeded in a headless sub-agent session since closed; live server stopped and verified down.

# Overall Impression

First screen and a half is genuinely moving, then the surface forgets what it's for. "The profile is the destination" — today the hero is the destination and everything under it is the database it sits on, presented as a to-do list. Biggest opportunity is deleting, not adding. Two findings are severe regardless: profile unreachable by keyboard, and it offers to email your dead grandfather.

# What's Working

1. Confirm-before-destroy close to systematic; documentContributionCount() names its own blast radius ("Remove this document — and the 3 facts it added to this profile?"); timeline rows warn about second-order consequences.
2. Hero name fit properly engineered: useLayoutEffect measures scrollWidth vs clientWidth, shrinks font-size (not transform: scale, because clipping is evaluated on the untransformed box), floors at 0.7, re-fits on document.fonts.ready.
3. Relationship list applies the refined Serif-Means-Someone rule — one hero name in Fraunces, twenty .rel-chip__name in sans for scanability.
4. TimelineEditor is the best-composed dialog: PROFILE badge on derived rows, AutoGrowField, drag-to-reorder with ArrowUp/ArrowDown equivalents.

# Priority Issues

## [P0] Profile unreachable by keyboard while telling screen readers nothing else exists
activeElement is body after open; 8 Tabs land on zoom controls and dock buttons, all outside the dialog. No focus move-in, no trap, nothing outside inert. .profile declares role="dialog" aria-modal="true" (PersonSheet.jsx:707) — tells AT the rest of the page doesn't exist. 76 controls, 0 reachable.
Fix: focus .profile__close on open, trap Tab/Shift-Tab, restore on close — the ChartTree .ped-pop pattern (childrenPopRef/lastFocusBeforePopRef). Mark canvas/dock inert. Apply to every sheet.
Command: /impeccable harden

## [P0] "Invite" offered on deceased people
PersonSheet.jsx:904 gates Invite only on !person.invited_at. Reproduced: Thomas Bennett, "In loving memory", "Passed away 2011", shows terracotta Invite. Adjacent "Manage access" IS gated on !person.is_deceased — oversight, not decision.
Fix: add !person.is_deceased. Audit rest of deceased action set (empty Health history with medical disclaimer).
Command: /impeccable clarify

## [P1] Structural relationship changes commit instantly, beside a removal that doesn't
changeOptions fires onChangeRelationship immediately (PersonSheet.jsx:2042). One tap of "Child" converts a 40-year marriage into a parent-child edge, re-rooting both people, no confirm, no undo. Remove relationship — a smaller change — gets an inline confirm 40px below. Trigger is 34x34px next to a 40px avatar row.
Fix: route changeOptions through the same inline-confirm block unlinkArgs uses, copy naming the outcome. Keep unguarded only for symmetric partner <-> ex-partner flip.
Command: /impeccable harden

## [P1] IA buries the person under chrome and unconditional empty sections
390x844: hero 371px (44%), .profile__actions 342px (43%), first content section 860px, total 5,075px / 6.4 screens. Thirteen sections render unconditionally — living person opens on empty Contact; memorial profile carries empty Health history. Seven CTAs before content, three promising "their story" in three treatments. Nine relationship groups flat and uncapped.
Fix: (a) render a section only when it has content or viewer is in explicit complete-profile mode; (b) collapse actions to one primary + one secondary, rest into overflow; (c) apply List view's collapse threshold to extended groups.
Command: /impeccable distill

## [P2] Three documented design-system rules broken as drift
Float-Only Rule: .doc-card, .places-detail, .education-rung__card are var(--card) + box-shadow on resting in-flow elements; --card and --paper both #ffffff so the shadow is the only definition. Same finding already fixed for .person-row in List view.
Semantic colour: .memory__del:hover uses var(--memorial), the violet reserved for the deceased, as a generic danger hover. Plus EnrichSheet off-palette tiers.
Contrast: .profile-section__title 12px uppercase --ink-faint #a6abb3 = 2.3:1 on white; all 13 headings fail. Detector independently found 37-45 low-contrast elements per view.
Fix: flatten card recipes onto .memory's pattern; replace --memorial on delete hover with documented danger pairing; section titles to --ink-soft (#6b6f76, 5.05:1).
Command: /impeccable colorize

## [P2] 35 sub-44px touch targets on one mobile profile, including a 17px-tall Remove
.memory__del 63x17px (destructive) and .memory__edit 36x17 — same 12.5px --ink-faint, visually interchangeable. .section-edit 34x20 x10, .places-detail__edit/__del 30x30 x6, .rel-chip__menu-btn 34x34 x6, .input-clear 21x21. Detector also found TimelineEditor PROFILE badge at 10px and EnrichSheet labels at 10.5px (under 11px floor), plus .topbar__stats--btn overflowing its box by 106px on every mobile state.
Fix: 44px minimum hit areas via padding/::before expanders; separate Remove from Edit; documented danger colour for destructive controls.
Command: /impeccable adapt

# Persona Red Flags

Sam (screen reader / keyboard-only): focus stays on body; 8 Tabs never enter the dialog while aria-modal="true" says outside doesn't exist. 13 headings at 2.3:1. .memory__del is a 63x17px link identical to Edit. Mother/Father disabled reasons only in title. .profile-scrim is a click-to-close div with no role.

Casey (distracted mobile): 35 sub-44px targets; six delete buttons in one screen of Places + Education; 342px of buttons before the first fact; .rel-chip__menu-btn ~8px from full-width row nav; EditPersonSheet sticky footer overlaps 10 hair/eye pills.

Riley (stress tester): Invite on memorial profile. Broken photo URL renders a 371px blank grey slab AND suppresses the "No portrait yet" kicker, while the same person's 40px Avatar in a relationship row falls back to their monogram. "Change to -> Child" commits instantly. onDocPick silently skips >20MB and swallows failures. Escape in DocViewer closes the profile.

# Minor Observations

- DocViewer got zero coverage in both passes: not a component file (inline at App.jsx:4025), and the seed ships no documents array. Disclosed gap.
- "Step Son" as two capitalised words; "Ex-Partner" vs "Ex-partner" across two menus.
- Key life events edit button renders an empty <button>, hidden only by .section-edit:empty.
- Section count suffixes (Memories · 2) applied inconsistently.
- Places Lived and Ancestry Story rails look near-identical but encode different axes.
- MemorySheet placeholder hardcoded "Every Christmas he made pancakes" — shown verbatim on Linda Mercer's sheet.
- Tapping Profile opens a modal also titled "Profile" showing a subset of what's already behind it.

# Questions to Consider

1. If you deleted every empty section, what would be left — and would it still be the destination?
2. Why is editing always on? A read mode with one Edit affordance would remove ~25 of the 35 sub-44px targets and most of the mis-tap surface in one move.
3. aria-modal="true" is a promise the surface doesn't keep — what else here asserts something it hasn't built?
