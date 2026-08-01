/*
 * Data-integrity checks — flags logically-impossible or wildly implausible
 * facts (a person with two simultaneous current partners, a 140-year
 * lifespan, a child born before their own parent) so a human can review and
 * correct them, the same "review sheet, never auto-fix" pattern already
 * proven by findDuplicatePairs (lib/duplicates.js). Family history data is
 * messy by nature — approximate dates, blended families, same-day
 * remarriages — so every check here favors precision over recall: it flags
 * only genuinely implausible/impossible combinations, never a merely
 * unusual one, and nothing here is ever auto-corrected.
 *
 * computeIntegrityIssues(graph, now) → [{ key, type, severity, personIds, reason }]
 */

import { yearsBetween } from './dates.js';

// A round, memorable ceiling — the oldest verified human lifespan on record
// is 122; 115 gives real supercentenarians (see insightModules.js's own
// centenarians() module, capped at 130 for *celebrating* an age) room
// without also letting a four-digit birth-year typo or an un-set death
// flag slide through as a real person's plausible age. Deliberately a
// different, stricter number than centenarians()'s 130 — that module is
// about celebrating a genuinely old relative; this one is about catching
// data entry mistakes, and 115 is already generous for that job.
const MAX_PLAUSIBLE_AGE = 115;

// A biological or adoptive parent under this age at a child's birth is
// almost always a data-entry error (wrong person linked, or a typo'd
// year) rather than a real, if young, parent.
const MIN_PLAUSIBLE_PARENT_AGE = 10;

// A birth recorded more than this many years after a parent's death is
// treated as impossible. 1 full year comfortably covers every real
// posthumous-birth case (a father who died during the pregnancy) without
// letting a badly wrong death year slip past as "maybe posthumous."
const POSTHUMOUS_BIRTH_GRACE_YEARS = 1;

// Safety valve for ancestor-cycle detection — real family trees are rarely
// more than a few dozen generations deep even at their most complete; this
// only exists to guarantee termination against a corrupted graph that
// might otherwise cycle forever without ever revisiting the start id.
const MAX_ANCESTOR_WALK_DEPTH = 80;

// Stable key for one issue, independent of how its personIds happen to be
// ordered — used both to de-duplicate within a single computation and to
// remember dismissals across sessions (see loadDismissedIntegrityIssues).
export function issueKey(type, personIds) {
  return type + ':' + [...personIds].sort().join('~');
}

function ageAt(person, atDate) {
  if (!person?.birth_date) return null;
  return yearsBetween(person.birth_date, atDate);
}

function currentAge(person, now) {
  if (!person?.birth_date) return null;
  if (person.is_deceased) {
    return person.death_date ? yearsBetween(person.birth_date, person.death_date) : null;
  }
  // yearsBetween expects a 'YYYY-MM-DD' string, not a millisecond epoch —
  // `now` arrives as Date.now()-shaped for a stable/testable "as of when"
  // value (same convention as insightModules.js's centenarians()).
  const todayStr = new Date(now).toISOString().slice(0, 10);
  return yearsBetween(person.birth_date, todayStr);
}

/*
 * A person with 2+ partner edges whose status is 'current' (or unset,
 * which the app treats as current — see graph.js) at the same time. This
 * is squarely a "worth a second look" signal, not necessarily a mistake —
 * but for a conventional family tree it's unusual enough to flag, and easy
 * to fix from here (the "Change to Ex-partner" menu already exists on
 * every partner chip) if it IS one.
 */
export function findConcurrentPartners(graph) {
  const issues = [];
  const seen = new Set();
  for (const person of graph.people) {
    const current = graph.partners(person.id).filter((p) => p.status !== 'former');
    if (current.length < 2) continue;
    const ids = [person.id, ...current.map((p) => p.id)];
    const key = issueKey('concurrent_partners', ids);
    if (seen.has(key)) continue;
    seen.add(key);
    const names = current.map((p) => graph.byId.get(p.id)?.display_name).filter(Boolean);
    issues.push({
      key,
      type: 'concurrent_partners',
      severity: 'medium',
      personIds: ids,
      reason: `${person.display_name} shows as a current partner of ${names.join(' and ')} at the same time`,
    });
  }
  return issues;
}

/*
 * A living or deceased age past MAX_PLAUSIBLE_AGE. Deliberately excludes
 * anyone the plausibility window can't evaluate at all (no birth date, or
 * deceased with no death date) — silence over a guess, same rule every
 * date-derived feature in this app follows.
 */
export function findImplausibleAges(graph, now = Date.now()) {
  const issues = [];
  for (const person of graph.people) {
    const age = currentAge(person, now);
    if (age == null || age <= MAX_PLAUSIBLE_AGE) continue;
    issues.push({
      key: issueKey('implausible_age', [person.id]),
      type: 'implausible_age',
      severity: 'high',
      personIds: [person.id],
      reason: person.is_deceased
        ? `${person.display_name} would have been ${age} years old — check the birth and death dates`
        : `${person.display_name} would be ${age} years old today — check the birth date`,
    });
  }
  return issues;
}

// A death date recorded before the person's own birth date — always a
// logical impossibility, regardless of the gap, so this is checked
// separately from (and in addition to) the plausible-age window above.
export function findDeathBeforeBirth(graph) {
  const issues = [];
  for (const person of graph.people) {
    if (!person.is_deceased || !person.birth_date || !person.death_date) continue;
    const span = yearsBetween(person.birth_date, person.death_date);
    if (span == null || span >= 0) continue;
    issues.push({
      key: issueKey('death_before_birth', [person.id]),
      type: 'death_before_birth',
      severity: 'high',
      personIds: [person.id],
      reason: `${person.display_name}'s recorded death date is before their birth date`,
    });
  }
  return issues;
}

/*
 * Parent/child date-ordering problems, checked per parent-child edge:
 *   - the child's birth predates the parent's own birth (nobody's child
 *     can be older than they are);
 *   - the child was born more than POSTHUMOUS_BIRTH_GRACE_YEARS after the
 *     parent died;
 *   - for a biological/adoptive parent specifically (a step-parent has no
 *     biological timing constraint), the parent was under
 *     MIN_PLAUSIBLE_PARENT_AGE at the child's birth.
 * Each sub-case is its own issue (a record can trip more than one) so the
 * reason shown is always specific to what's actually wrong.
 */
export function findParentChildTimingIssues(graph) {
  const issues = [];
  for (const r of graph.relationships) {
    if (r.type !== 'parent') continue;
    const parent = graph.byId.get(r.from_person);
    const child = graph.byId.get(r.to_person);
    if (!parent || !child || !parent.birth_date || !child.birth_date) continue;

    const parentAgeAtBirth = ageAt(parent, child.birth_date);
    if (parentAgeAtBirth != null && parentAgeAtBirth < 0) {
      issues.push({
        key: issueKey('child_before_parent', [parent.id, child.id]),
        type: 'child_before_parent',
        severity: 'high',
        personIds: [parent.id, child.id],
        reason: `${child.display_name} is recorded as born before their parent ${parent.display_name}`,
      });
      continue; // the other checks below assume a non-negative gap
    }

    if (parent.is_deceased && parent.death_date) {
      const yearsAfterDeath = yearsBetween(parent.death_date, child.birth_date);
      if (yearsAfterDeath != null && yearsAfterDeath > POSTHUMOUS_BIRTH_GRACE_YEARS) {
        issues.push({
          key: issueKey('child_after_parent_death', [parent.id, child.id]),
          type: 'child_after_parent_death',
          severity: 'high',
          personIds: [parent.id, child.id],
          reason: `${child.display_name} is recorded as born ${yearsAfterDeath} years after ${parent.display_name}'s death`,
        });
      }
    }

    const isBioOrAdoptive = !r.qualifier || r.qualifier === 'biological' || r.qualifier === 'adoptive';
    if (isBioOrAdoptive && parentAgeAtBirth != null && parentAgeAtBirth < MIN_PLAUSIBLE_PARENT_AGE) {
      issues.push({
        key: issueKey('parent_too_young', [parent.id, child.id]),
        type: 'parent_too_young',
        severity: 'high',
        personIds: [parent.id, child.id],
        reason: `${parent.display_name} would have been ${parentAgeAtBirth} when ${child.display_name} was born`,
      });
    }
  }
  return issues;
}

// A recorded marriage date before either partner was born, or after either
// partner had already died. Reuses the marriage_date already carried on
// the partner edge (see graph.js) — no extra lookup needed.
export function findMarriageOutsideLifespan(graph) {
  const issues = [];
  const seen = new Set();
  for (const person of graph.people) {
    for (const partner of graph.partners(person.id)) {
      if (!partner.marriage_date) continue;
      const other = graph.byId.get(partner.id);
      if (!other) continue;
      const key = issueKey('marriage_outside_lifespan', [person.id, partner.id]);
      if (seen.has(key)) continue;

      const bad = [person, other].find((p) => {
        if (p.birth_date && ageAt(p, partner.marriage_date) < 0) return true;
        if (p.is_deceased && p.death_date && yearsBetween(partner.marriage_date, p.death_date) < 0) return true;
        return false;
      });
      if (!bad) continue;
      seen.add(key);
      issues.push({
        key,
        type: 'marriage_outside_lifespan',
        severity: 'medium',
        personIds: [person.id, partner.id],
        reason: `${person.display_name} and ${other.display_name}'s recorded marriage date falls outside ${bad.display_name}'s own lifespan`,
      });
    }
  }
  return issues;
}

// A person who appears in their own ancestor chain — always a structural
// impossibility, usually the result of a bad merge or a mis-pointed import
// edge. Bounded walk (MAX_ANCESTOR_WALK_DEPTH) guarantees termination even
// against an already-corrupted graph.
export function findAncestorCycles(graph) {
  const issues = [];
  const seen = new Set();
  for (const start of graph.people) {
    const visited = new Set([start.id]);
    let frontier = graph.parents(start.id).map((p) => p.id);
    let depth = 0;
    while (frontier.length && depth < MAX_ANCESTOR_WALK_DEPTH) {
      if (frontier.includes(start.id)) {
        const key = issueKey('ancestor_cycle', [start.id]);
        if (!seen.has(key)) {
          seen.add(key);
          issues.push({
            key,
            type: 'ancestor_cycle',
            severity: 'high',
            personIds: [start.id],
            reason: `${start.display_name} appears in their own ancestor chain — a relationship link is likely mis-pointed`,
          });
        }
        break;
      }
      const next = [];
      for (const id of frontier) {
        if (visited.has(id)) continue;
        visited.add(id);
        for (const p of graph.parents(id)) next.push(p.id);
      }
      frontier = next;
      depth++;
    }
  }
  return issues;
}

export function computeIntegrityIssues(graph, now = Date.now()) {
  return [
    ...findConcurrentPartners(graph),
    ...findImplausibleAges(graph, now),
    ...findDeathBeforeBirth(graph),
    ...findParentChildTimingIssues(graph),
    ...findMarriageOutsideLifespan(graph),
    ...findAncestorCycles(graph),
  ];
}

// Dismissed-issue tracking — same shared, localStorage-backed pattern as
// lib/duplicates.js's loadDismissedDuplicates/saveDismissedDuplicates, kept
// in its own key so dismissing a duplicate pair and dismissing an integrity
// issue never collide.
const DISMISS_KEY = 'bl_integrity_dismissed';

export function loadDismissedIntegrityIssues() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }
  catch { return new Set(); }
}

export function saveDismissedIntegrityIssues(set) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}
