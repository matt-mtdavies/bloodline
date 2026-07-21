/*
 * The Cinematic Timeline "director" — Phase 0 of the feature (design doc
 * planned at docs/CINEMATIC-TIMELINE.md; not yet wired into the app).
 *
 * Pure, unit-tested, and deliberately renderer-agnostic: it compiles a person
 * into an ordered SCRIPT of beats — the emotional structure of a life — and
 * knows nothing about pixels, PixiJS, or the camera. A renderer walks the
 * script and interprets each beat's `camera` intent and `setPiece` into actual
 * motion (that's Phase 1+). Keeping the story logic here, testable in
 * isolation, is the same lib/*.js split the rest of the codebase uses.
 *
 * This is intentionally the SAME shape of work `keepsake.js` already does for
 * the printed biography (compile a person → an ordered, inclusion-filtered
 * list of narrative units). The Keepsake is the life as a magazine; this is
 * the life as a film. If they ever share a compiler, this is the seam.
 *
 * A beat:
 *   {
 *     id, kind,            // stable key + one of BEAT_KINDS
 *     year,                // where it sits along the river (may be estimated)
 *     estimated,           // true when `year` was inferred, not from data
 *     focus,               // the id the camera frames — NOT always the subject
 *     cast,                // ids in frame (subject + whoever the moment needs)
 *     camera: { move, tightness },   // intent, not coordinates
 *     pacing,              // 'quiet' | 'event' | 'major' — dwell bucket
 *     dwellMs,             // suggested dwell, derived from pacing
 *     setPiece,            // 'birth-glow' | 'death-fade' | 'legacy-bloom' | null
 *     title, detail,       // caption copy (never invented — omitted if absent)
 *     world,               // { year, title } historical context, or null
 *   }
 */

import { lifeEvents } from './profile.js';
import { yearOf } from './dates.js';
import { detectRegion, nearestWorldEvent, sameYearWorldEvent } from './worldEvents.js';

export const BEAT_KINDS = [
  'opening',       // parents already travelling together, before the subject exists
  'birth',         // the subject forms between their parents
  'sibling',       // a sibling is born alongside
  'marriage',      // a partner's current merges into the subject's
  'child',         // a child forms — a defining moment
  'milestone',     // a stored life event (graduated, migrated, served, …)
  'world',         // a standalone historical-context beat in a quiet stretch
  'parent_death',  // a parent's graceful fade, within the subject's lifetime
  'death',         // the subject's own fade
  'legacy',        // pull back, descendants illuminate
  'present',       // living subject — settle on the family as it is today
];

// Suggested dwell per pacing bucket (ms). The renderer is free to scale these,
// but their RATIO is the point: a major beat breathes ~3.5× longer than a
// quiet one, which is what makes the pacing feel musical rather than metronomic.
export const DWELL_MS = { quiet: 900, event: 1800, major: 3200 };

// A childless, dateless stub still deserves a coherent (if short) film, so the
// compiler never returns an empty script — at minimum an establishing beat.
const AVG_PARENT_AGE = 27; // only ever used to ESTIMATE a missing subject birth
                           // year, always flagged estimated — never shown as fact.

function yr(value) {
  const y = yearOf(value);
  const n = y != null ? Number(y) : NaN;
  return Number.isFinite(n) ? n : null;
}

function firstName(person) {
  return (person?.display_name || '').trim().split(/\s+/)[0] || 'Someone';
}

// The subject's birth year anchors the whole river, so — and ONLY here — we
// estimate one when it's missing, rather than refuse to build a film. Every
// other unknown year is left out, never fabricated.
function anchorBirthYear(graph, person) {
  const known = yr(person.birth_date);
  if (known != null) return { year: known, estimated: false };

  // Earliest stored event is a hard lower bound on a plausible birth.
  const events = lifeEvents(person).map((e) => Number(e.year)).filter(Number.isFinite);
  if (events.length) return { year: Math.min(...events) - 1, estimated: true };

  // Failing that, lean on a parent: roughly a generation after the eldest.
  const parentYears = graph.parents(person.id)
    .map((p) => yr(graph.byId.get(p.id)?.birth_date))
    .filter((n) => n != null);
  if (parentYears.length) return { year: Math.max(...parentYears) + AVG_PARENT_AGE, estimated: true };

  return { year: null, estimated: true };
}

function partnerMarriageYear(edge, subject, other) {
  // Prefer the edge's own marriage_date; fall back to a "Married {name}" event
  // on either person; else null (we don't invent a wedding year).
  const fromEdge = yr(edge.marriage_date);
  if (fromEdge != null) return fromEdge;
  const otherFirst = firstName(other).toLowerCase();
  const scan = (p) => (p.events || []).find(
    (e) => /married|wed|marriage/i.test(e.title || '') &&
      (!otherFirst || (e.title + ' ' + (e.detail || '')).toLowerCase().includes(otherFirst) || !/\w/.test(otherFirst)),
  );
  const ev = scan(subject) || scan(other);
  return ev ? Number(ev.year) : null;
}

let _seq = 0;
function beat(partial) {
  const pacing = partial.pacing || 'event';
  return {
    id: partial.id ?? `beat_${_seq++}`,
    estimated: false,
    focus: partial.focus ?? (partial.cast?.[0] ?? null),
    cast: partial.cast ?? [],
    camera: partial.camera ?? { move: 'push-in', tightness: 0.6 },
    setPiece: partial.setPiece ?? null,
    title: partial.title ?? '',
    detail: partial.detail ?? null,
    world: partial.world ?? null,
    ...partial,
    pacing,
    dwellMs: DWELL_MS[pacing],
  };
}

/*
 * Compile a person into an ordered cinematic script.
 *
 * Returns { subjectId, span: {startYear, endYear}, region, beats: [...] } with
 * beats sorted chronologically. Pure — no side effects, safe to call in a test.
 */
export function buildCinematicScript(graph, personId, opts = {}) {
  _seq = 0;
  const nowYear = opts.nowYear ?? new Date().getFullYear();
  const subject = graph.byId.get(personId);
  if (!subject) return { subjectId: personId, span: { startYear: nowYear, endYear: nowYear }, region: 'global', beats: [] };

  const region = detectRegion(graph);
  const { year: birthYear, estimated: birthEstimated } = anchorBirthYear(graph, subject);
  const deathYear = subject.is_deceased ? yr(subject.death_date) : null;
  const endYear = deathYear ?? nowYear;
  const subjFirst = firstName(subject);

  const parents = graph.parents(personId).map((p) => graph.byId.get(p.id)).filter(Boolean);
  const siblings = graph.siblings(personId).map((s) => graph.byId.get(s.id)).filter(Boolean);
  const partners = graph.partners(personId);
  const children = graph.children(personId).map((c) => graph.byId.get(c.id)).filter(Boolean);

  const beats = [];

  // ── Opening — the parents, already travelling together, before birth ──────
  if (parents.length && birthYear != null) {
    beats.push(beat({
      id: 'opening', kind: 'opening', year: birthYear - 1,
      focus: parents[0].id, cast: parents.map((p) => p.id),
      camera: { move: 'establish', tightness: 0.35 }, pacing: 'event',
      title: parents.length > 1
        ? `${firstName(parents[0])} and ${firstName(parents[1])}`
        : firstName(parents[0]),
      detail: 'Before the story begins',
    }));
  }

  // ── Birth of the subject ──────────────────────────────────────────────────
  if (birthYear != null) {
    beats.push(beat({
      id: 'birth', kind: 'birth', year: birthYear, estimated: birthEstimated,
      focus: personId, cast: [personId, ...parents.map((p) => p.id)],
      camera: { move: 'push-in', tightness: 0.85 }, pacing: 'major', setPiece: 'birth-glow',
      title: subject.display_name,
      detail: subject.birth_place || null,
    }));
  }

  // ── Siblings — same birth set-piece, briefly widening the household ────────
  for (const sib of siblings) {
    const sy = yr(sib.birth_date);
    if (sy == null) continue; // no invented year → no dated beat (still in legacy cast)
    beats.push(beat({
      id: `sibling_${sib.id}`, kind: 'sibling', year: sy,
      focus: sib.id, cast: [personId, sib.id, ...parents.map((p) => p.id)],
      camera: { move: 'widen', tightness: 0.55 }, pacing: 'event', setPiece: 'birth-glow',
      title: sib.display_name, detail: 'joins the family',
    }));
  }

  // ── Marriages — a partner's current merges into the subject's ─────────────
  for (const edge of partners) {
    const other = graph.byId.get(edge.id);
    if (!other) continue;
    const my = partnerMarriageYear(edge, subject, other);
    if (my == null) continue;
    const ended = edge.status === 'former';
    beats.push(beat({
      id: `marriage_${other.id}`, kind: 'marriage', year: my,
      focus: personId, cast: [personId, other.id],
      camera: { move: 'beside', tightness: 0.7 }, pacing: 'major',
      title: `Married ${firstName(other)}`,
      detail: edge.marriage_place || (ended ? 'A chapter that later turned' : null),
    }));
  }

  // ── Children — defining moments; camera rises to frame the family ─────────
  for (const child of children) {
    const cy = yr(child.birth_date);
    if (cy == null) continue;
    beats.push(beat({
      id: `child_${child.id}`, kind: 'child', year: cy,
      focus: child.id, cast: [personId, child.id],
      camera: { move: 'rise', tightness: 0.8 }, pacing: 'major', setPiece: 'birth-glow',
      title: child.display_name, detail: 'is born',
    }));
  }

  // ── Milestones — stored life events not already told as a set-piece ───────
  const covered = new Set(['born', 'passed away']);
  for (const ev of lifeEvents(subject)) {
    const t = (ev.title || '').trim().toLowerCase();
    if (covered.has(t)) continue;
    // Skip "became a parent / a father" — the child's own beat already tells it.
    if (/became a (parent|father|mother|grand)/.test(t)) continue;
    const y = Number(ev.year);
    if (!Number.isFinite(y)) continue;
    const sameYear = sameYearWorldEvent(y, region);
    beats.push(beat({
      id: `milestone_${y}_${t.replace(/\W+/g, '').slice(0, 12)}`, kind: 'milestone', year: y,
      focus: personId, cast: [personId],
      camera: { move: 'push-in', tightness: 0.65 }, pacing: 'event',
      title: ev.title, detail: ev.detail || null,
      world: sameYear ? { year: sameYear.year, title: sameYear.title } : null,
    }));
  }

  // ── Parent deaths within the subject's lifetime ───────────────────────────
  for (const parent of parents) {
    if (!parent.is_deceased) continue;
    const py = yr(parent.death_date);
    if (py == null || birthYear == null || py < birthYear || py > endYear) continue;
    beats.push(beat({
      id: `parent_death_${parent.id}`, kind: 'parent_death', year: py,
      focus: parent.id, cast: [personId, parent.id],
      camera: { move: 'isolate', tightness: 0.75 }, pacing: 'event', setPiece: 'death-fade',
      title: firstName(parent), detail: 'passes',
    }));
  }

  // ── Quiet stretches — drop a world-context beat mid-gap so years don't feel
  //    empty. Only where a genuine >QUIET_GAP-year silence exists between the
  //    personal beats we already have. ──────────────────────────────────────
  const QUIET_GAP = 12;
  const dated = beats.map((b) => b.year).filter((y) => y != null).sort((a, b) => a - b);
  const anchors = [birthYear, ...dated, endYear].filter((y) => y != null).sort((a, b) => a - b);
  for (let i = 0; i < anchors.length - 1; i++) {
    const gap = anchors[i + 1] - anchors[i];
    if (gap < QUIET_GAP) continue;
    const mid = Math.round(anchors[i] + gap / 2);
    const w = nearestWorldEvent(mid, region, Math.ceil(gap / 2));
    if (!w) continue;
    beats.push(beat({
      id: `world_${w.year}`, kind: 'world', year: w.year,
      focus: personId, cast: [personId],
      camera: { move: 'widen', tightness: 0.3 }, pacing: 'quiet',
      title: w.title, detail: 'Meanwhile, in the wider world',
      world: { year: w.year, title: w.title },
    }));
  }

  // ── Ending ────────────────────────────────────────────────────────────────
  if (deathYear != null) {
    beats.push(beat({
      id: 'death', kind: 'death', year: deathYear,
      focus: personId, cast: [personId],
      camera: { move: 'settle', tightness: 0.9 }, pacing: 'major', setPiece: 'death-fade',
      title: subject.display_name,
      detail: subject.cause_of_death || null,
    }));
    // Legacy — pull back, living descendants illuminate.
    const living = collectDescendants(graph, personId).filter((id) => {
      const p = graph.byId.get(id);
      return p && !p.is_deceased;
    });
    beats.push(beat({
      id: 'legacy', kind: 'legacy', year: deathYear + 1,
      focus: personId, cast: [personId, ...living],
      camera: { move: 'pull-back', tightness: 0.15 }, pacing: 'major', setPiece: 'legacy-bloom',
      title: living.length ? 'The family continues' : 'A life remembered',
      detail: living.length ? `${living.length} living ${living.length === 1 ? 'descendant carries' : 'descendants carry'} it on` : null,
    }));
  } else {
    beats.push(beat({
      id: 'present', kind: 'present', year: endYear,
      focus: personId,
      cast: [personId, ...partners.map((e) => e.id), ...children.map((c) => c.id)],
      camera: { move: 'settle', tightness: 0.45 }, pacing: 'event',
      title: 'The story continues…', detail: null,
    }));
  }

  // Order chronologically; a stable secondary key keeps same-year beats in a
  // sensible order (openings before births before the rest of that year).
  const KIND_RANK = Object.fromEntries(BEAT_KINDS.map((k, i) => [k, i]));
  beats.sort((a, b) => (a.year - b.year) || (KIND_RANK[a.kind] - KIND_RANK[b.kind]));

  const years = beats.map((b) => b.year).filter((y) => y != null);
  const span = { startYear: years.length ? Math.min(...years) : nowYear, endYear: years.length ? Math.max(...years) : nowYear };
  return { subjectId: personId, span, region, beats };
}

// Every descendant id (children, their children, …) of a person. Cycle-guarded.
function collectDescendants(graph, personId) {
  const seen = new Set();
  const out = [];
  const walk = (id) => {
    for (const c of graph.children(id)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c.id);
      walk(c.id);
    }
  };
  walk(personId);
  return out;
}
