---
target: Chart view (src/viz/ChartTree.jsx)
total_score: 22
max_score: 36
na_heuristics: 9
p0_count: 0
p1_count: 3
target_identity: "file:/home/user/bloodline/src/viz/ChartTree.jsx"
target_fingerprint: "sha256:1c8a734e032a68b04b320cd119a351455c56157fadff270f11c29ebadad1b16e"
target_path: /home/user/bloodline/src/viz/ChartTree.jsx
timestamp: 2026-09-13T02-27-47Z
slug: src-viz-charttree-jsx
---
# Impeccable Critique — src/viz/ChartTree.jsx ("Chart" view)

## Design Health Score
22/36 (heuristic 9 n/a) — Acceptable band.

## Design Specificity Verdict
Partially authored. Palette + monogram avatars are on-brand; typography (names in body font, not Fraunces) and card chrome are borrowed from FamilySearch's own pedigree reference per the file's own comment. CLI static scan: clean. Live browser overlay: 8 anti-patterns / 10 instances, including a text-overflow finding that independently confirms the LLM review's top issue (name truncation), plus one new WCAG contrast finding (white-on-terracotta 4.2:1). bounce-easing and gpt-thin-border-wide-shadow flagged by the overlay are false positives against Bloodline's own documented, deliberate conventions (--spring motion primitive; --shadow-soft float rule).

## What's Working
1. Couple-pod wash — two individually-tappable cards bound by a shared background wash, terracotta ring isolated to the one active person; a deliberate reuse of Canopy's proven solution.
2. Generational recede protects legibility on purpose — a self-documented prior accessibility regression fixed by keeping recede styling off the text.
3. Tap semantics unified with the organic tree (tap-to-reroot / tap-active-to-open) — no Chart-specific reinvention, directly serving "tree is navigation, profile is destination."

## Priority Issues
[P1] Names truncate in the default render of ordinary demo data (confirmed by both assessments — LLM read of PLATE_W metrics + detector's live overflow measurement on .pplate__name-text, 17-20px overflow).
[P1] No way to add a first parent/child from Chart — pedigreeLayout.js computes canAddParent but PlateCard never reads it; down-pip only renders when childrenCount > 0, so a childless person has no path to their first child. Unused .ped-up--add CSS already exists.
[P1] Chart's own visual language (dashed/violet/gold lines, recede tiers) documented nowhere — Legend.jsx explicitly scopes itself to the organic tree only.
[P2] Two independent WCAG AA contrast failures: .pplate__dates on --ink-faint (self-documented 2.3:1 at full strength) + overlay-detected white-on-terracotta at 4.2:1.
[P2] Chart exploration state (expanded branches, orientation, zoom) silently discarded on any view switch away and back — no state lifted in App.jsx.

## Persona Red Flags
Jordan (first-timer): no on-canvas hint that adding a missing parent/child is possible; unexplained dashed/violet lines.
Sam (accessibility): correct focus order and accessible names, but nav pips rely on bare title (no aria-label, unlike sibling zoom/fit buttons); no relationship semantics exposed to screen readers.
Riley (stress tester): seed family alone reproduces name truncation with zero synthetic data; correctly suppresses a living minor's current age (privacy-by-default, a genuine strength).

## Minor Observations
Touch targets 13.7-20.2px on-canvas (under the app's own 44px floor elsewhere); transition: width perf smell; unverified repeating-stripes-gradient finding; TopBar text-size findings misattributed to this file by the overlay (shared chrome, not Chart-specific); dead mobile white space below the fitted chart.

## Questions to Consider
1. Names in Fraunces, everything else in Hanken Grotesk — per DESIGN.md's own split?
2. Recede tiers carrying relationship-color language (current-partner terracotta) into the pod wash?
3. Reframe the add-parent/add-child gap as Chart's actual differentiator — a completion tool for genealogists?
