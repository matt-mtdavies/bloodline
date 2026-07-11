/*
 * "Enrich this profile" — the data-quality + discovery layer for a single
 * person. Everything here is deterministic and free: real arithmetic and
 * lookups over data already in the tree, never a guess dressed up as a
 * fact. The one genuinely-AI piece (place-name standardization) is a
 * separate async call from enrichAI.js, kept out of this file so the
 * synchronous findings render instantly with no network round-trip.
 *
 * Every finding carries a `tier` so the UI can be honest about its own
 * confidence, matching the rest of the app's house rule (never invent —
 * only help preserve):
 *   'detected'  — a hard logical contradiction in the recorded data
 *   'missing'   — a plain gap, no inference at all
 *   'estimated' — a bounded range computed from OTHER people's own recorded
 *                 dates (interval arithmetic, not a statistical guess)
 *   'document'  — a candidate fact an AI document summary extracted, grounded
 *                 in a verbatim quote, awaiting a human's accept or dismiss
 *   'story'     — a pointer at the existing AI biography generator
 *
 * computeEnrichment(person, graph, memoryCount, documents) → finding[]
 * finding: { key, tier, icon, title, detail, action }
 * action: { type: 'edit' } | { type: 'merge', pair } | { type: 'story' }
 *   | { type: 'document-fact', docId, factIndex }
 *   | { type: 'document-field', docId, field }
 *   | { type: 'document-person', docId, personIndex, matchedId, relation }
 */
import { profileCompleteness, isDuplicateLifeEvent } from './profile.js';
import { findDuplicatePairs } from './duplicates.js';
import { yearOf, yearsBetween } from './dates.js';

const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive' || q === 'adopted';
const firstNameOf = (p) => (p?.display_name || '').trim().split(/\s+/)[0] || p?.display_name || 'they';

const FIELD_LABEL = { occupation: 'Occupation', birth_place: 'Birth place', residence: 'Residence' };

// Only relations the app can actually write as a direct edge — a sibling has
// no direct edge (siblings are derived from shared parents, never stored),
// and 'other' (a witness, registrar, attesting officer...) is never a family
// relationship, so neither gets a suggestion here. See summarize.js.
const REL_LABEL = { parent: 'parent', spouse: 'partner', child: 'child' };

function normalizeNameTokens(raw) {
  return (raw || '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// A document often records a woman under a maiden name aside — "Laura
// Angeline Turner (formerly Tuffnell)" — try the name as written first, then
// swap the surname for the aside, so a tree that has her under either name
// still matches.
function nameCandidates(raw) {
  const primary = normalizeNameTokens(raw);
  const candidates = [primary];
  const aside = (raw || '').match(/\(([^)]*)\)/);
  if (aside) {
    const altSurname = normalizeNameTokens(aside[1].replace(/^(formerly|n[ée]e)\s+/i, ''));
    if (altSurname.length && primary.length) candidates.push([...primary.slice(0, -1), ...altSurname]);
  }
  return candidates;
}

// Tolerant of middle names and initials: match on first + last token only.
function nameMatchesPerson(candidates, person) {
  const target = normalizeNameTokens(person.display_name);
  if (!target.length) return false;
  return candidates.some((c) => c.length && c[0] === target[0] && c[c.length - 1] === target[target.length - 1]);
}

export function computeEnrichment(person, graph, memoryCount = 0, documents = []) {
  const findings = [];
  if (!person) return findings;

  // ── Missing fields — one combined row; the completeness meter elsewhere
  //    on the profile already itemises these, so Enrich points at it rather
  //    than repeating every line. ──────────────────────────────────────────
  const completeness = profileCompleteness(person, graph, memoryCount);
  if (completeness.score < 100) {
    findings.push({
      key: 'completeness',
      tier: 'missing',
      icon: 'checklist',
      title: `${completeness.score}% complete`,
      detail: `Still missing ${completeness.missing.join(', ').toLowerCase()}.`,
      action: { type: 'edit' },
    });
  }

  // ── Duplicates — reuse the existing detector, filtered to pairs that
  //    involve this person. ───────────────────────────────────────────────
  const pairs = findDuplicatePairs(graph.people, graph.relationships)
    .filter((p) => p.aId === person.id || p.bId === person.id);
  for (const pair of pairs) {
    const otherId = pair.aId === person.id ? pair.bId : pair.aId;
    const other = graph.byId.get(otherId);
    if (!other) continue;
    findings.push({
      key: `dup_${otherId}`,
      tier: 'detected',
      icon: 'duplicate',
      title: `Possibly the same person as ${other.display_name}`,
      detail: pair.reasons.join(' · '),
      action: { type: 'merge', pair: { ...pair, otherId } },
    });
  }

  // ── Timeline contradictions — hard logic, not inference. ────────────────
  if (person.is_deceased && person.birth_date && person.death_date) {
    const span = yearsBetween(person.birth_date, person.death_date);
    if (span != null && span < 0) {
      findings.push({
        key: 'died_before_born',
        tier: 'detected',
        icon: 'timeline',
        title: 'Died before they were born',
        detail: `Birth ${person.birth_date} is after death ${person.death_date} — one of these dates is likely wrong.`,
        action: { type: 'edit' },
      });
    }
  }

  // This person's age at each child's birth, and each parent's age at THIS
  // person's birth — same [13, 75] plausibility window used everywhere else
  // in the app that reasons about parent age (see insightModules.js records).
  if (person.birth_date) {
    for (const c of graph.children(person.id)) {
      if (!isBioAdopt(c.qualifier)) continue;
      const child = graph.byId.get(c.id);
      if (!child?.birth_date) continue;
      const age = yearsBetween(person.birth_date, child.birth_date);
      if (age == null) continue;
      if (age < 0) {
        findings.push({
          key: `child_before_birth_${c.id}`,
          tier: 'detected',
          icon: 'timeline',
          title: `${firstNameOf(child)} was born before ${firstNameOf(person)}`,
          detail: `${child.display_name} (${yearOf(child.birth_date)}) predates ${person.display_name}'s own birth (${yearOf(person.birth_date)}).`,
          action: { type: 'edit' },
        });
      } else if (age < 13 || age > 75) {
        findings.push({
          key: `implausible_parent_age_${c.id}`,
          tier: 'detected',
          icon: 'timeline',
          title: `Age ${age} at ${firstNameOf(child)}'s birth`,
          detail: 'That falls outside a plausible parenting age — worth a second look at either birth date.',
          action: { type: 'edit' },
        });
      }
    }
  }

  // ── Missing co-parent — this person's own bio/adopted children who have
  //    only ONE recorded parent at all. ───────────────────────────────────
  const lonelyKids = graph.children(person.id)
    .filter((c) => isBioAdopt(c.qualifier))
    .map((c) => graph.byId.get(c.id))
    .filter((child) => child && graph.parents(child.id).length < 2);
  if (lonelyKids.length) {
    findings.push({
      key: 'missing_coparent',
      tier: 'missing',
      icon: 'family',
      title: lonelyKids.length === 1
        ? `${firstNameOf(lonelyKids[0])} has only one recorded parent`
        : `${lonelyKids.length} children have only one recorded parent`,
      detail: `Add ${lonelyKids.length === 1 ? 'their' : 'the'} other parent to complete the family line.`,
      action: { type: 'add-relative' },
    });
  }

  // ── Birth-year estimate — only when birth_date is entirely absent, and
  //    only ever a bounded RANGE from other people's own recorded dates:
  //    a partner's age, a child's or parent's birth year, a sibling's. Never
  //    a single guessed value, never presented as anything but an estimate. ─
  if (!person.birth_date) {
    const years = [];
    for (const p of graph.partners(person.id)) {
      const y = yearOf(graph.byId.get(p.id)?.birth_date);
      if (y) { years.push(Number(y) - 10); years.push(Number(y) + 10); }
    }
    for (const c of graph.children(person.id)) {
      if (!isBioAdopt(c.qualifier)) continue;
      const y = yearOf(graph.byId.get(c.id)?.birth_date);
      if (y) { years.push(Number(y) - 50); years.push(Number(y) - 15); }
    }
    for (const p of graph.parents(person.id)) {
      if (!isBioAdopt(p.qualifier)) continue;
      const y = yearOf(graph.byId.get(p.id)?.birth_date);
      if (y) { years.push(Number(y) + 15); years.push(Number(y) + 50); }
    }
    for (const s of graph.siblings(person.id)) {
      const y = yearOf(graph.byId.get(s.id)?.birth_date);
      if (y) { years.push(Number(y) - 15); years.push(Number(y) + 15); }
    }
    if (years.length >= 2) {
      // Intersect every lower/upper pair rather than taking the single
      // widest span, so one distant relative can't blow the range open.
      const los = years.filter((_, i) => i % 2 === 0);
      const his = years.filter((_, i) => i % 2 === 1);
      const rangeLo = Math.max(...los);
      const rangeHi = Math.min(...his);
      if (rangeLo <= rangeHi && rangeHi - rangeLo <= 40) {
        findings.push({
          key: 'birth_year_estimate',
          tier: 'estimated',
          icon: 'sparkle',
          title: 'No birth year on record',
          detail: `Likely born between ${rangeLo} and ${rangeHi}, based on relatives' own recorded dates.`,
          action: { type: 'edit' },
        });
      }
    }
  }

  // ── Document-derived facts, profile fields, and mentioned people —
  //    everything an AI document summary extracted, each grounded in a
  //    verbatim quote from the document itself. Applying one writes a real
  //    life event / profile field / relationship; nothing here is ever
  //    written on its own (see DocViewer's Summarize action and App.jsx's
  //    applyDocument* handlers). ────────────────────────────────────────────
  const personDocs = documents.filter((d) => d.person_id === person.id);

  for (const doc of personDocs) {
    (doc.extracted?.facts || []).forEach((fact, i) => {
      // No year, no timeline slot — the app's life events are chronological.
      if (fact.status !== 'pending' || !fact.year) return;
      // Already on record under this or a near-identical title (the derived
      // Born/Passed-away entry, or a stored event) — offering it again would
      // just be clutter toward the exact duplicate the accept path below
      // already refuses to create.
      if (isDuplicateLifeEvent(person, fact)) return;
      findings.push({
        key: `doc_fact_${doc.id}_${i}`,
        tier: 'document',
        icon: fact.tag === 'military' ? 'military' : 'timeline',
        title: fact.year ? `${fact.title} — ${fact.year}` : fact.title,
        detail: `From "${doc.title}": "${fact.quote}"`,
        action: { type: 'document-fact', docId: doc.id, factIndex: i },
      });
    });
  }

  // Profile fields — only offered where the person's own field is still
  // empty, so a document can never overwrite something already on record.
  for (const doc of personDocs) {
    const pf = doc.extracted?.profileFields;
    if (!pf) continue;
    for (const field of ['occupation', 'birth_place', 'residence']) {
      const candidate = pf[field];
      if (!candidate || candidate.status !== 'pending' || person[field]) continue;
      findings.push({
        key: `doc_field_${doc.id}_${field}`,
        tier: 'document',
        icon: 'checklist',
        title: `${FIELD_LABEL[field]}: ${candidate.value}`,
        detail: `From "${doc.title}": "${candidate.quote}"`,
        action: { type: 'document-field', docId: doc.id, field },
      });
    }
  }

  // People mentioned — cross-referenced against the tree by name. Only
  // offered for a direct kinship the app can actually write, and only when a
  // plausible name match already exists in the tree; never a prompt to
  // create a brand-new person straight from a document.
  for (const doc of personDocs) {
    (doc.extracted?.peopleMentioned || []).forEach((pm, i) => {
      if (pm.status !== 'pending' || !REL_LABEL[pm.relation]) return;
      const candidates = nameCandidates(pm.name);
      const matched = graph.people.find((p) => p.id !== person.id && nameMatchesPerson(candidates, p));
      if (!matched) return;
      const already =
        (pm.relation === 'parent' && graph.parents(person.id).some((x) => x.id === matched.id)) ||
        (pm.relation === 'child' && graph.children(person.id).some((x) => x.id === matched.id)) ||
        (pm.relation === 'spouse' && graph.partners(person.id).some((x) => x.id === matched.id));
      if (already) return;
      findings.push({
        key: `doc_person_${doc.id}_${i}`,
        tier: 'document',
        icon: 'family',
        title: `${matched.display_name} — ${REL_LABEL[pm.relation]} named in this document`,
        detail: `From "${doc.title}": "${pm.quote}"`,
        action: { type: 'document-person', docId: doc.id, personIndex: i, matchedId: matched.id, relation: pm.relation },
      });
    });
  }

  // ── AI life story — a pointer at the existing generator (lib/ai.js /
  //    /api/biography), not a second implementation of it. Only offered
  //    once there's enough on record to write something grounded, and
  //    only if nobody's written one yet. ──────────────────────────────────
  const hasMaterial = person.birth_date || person.occupation || (person.tags?.length)
    || (person.events?.length) || memoryCount > 0;
  if (!person.story && hasMaterial) {
    findings.push({
      key: 'life_story',
      tier: 'story',
      icon: 'sparkle',
      title: 'No life story yet',
      detail: `There's enough on record to write ${firstNameOf(person)}'s story — AI drafts it from what's already here, nothing invented.`,
      action: { type: 'story' },
    });
  }

  return findings;
}
