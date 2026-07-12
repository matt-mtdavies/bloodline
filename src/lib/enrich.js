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
 *   'relationship' — a life event computed from a fact already recorded elsewhere
 *                 on the tree (a marriage date, a partner's death, a child's or
 *                 grandchild's birth) — nothing invented, just not yet on the timeline
 *   'story'     — a pointer at the existing AI biography generator
 *
 * computeEnrichment(person, graph, memoryCount, documents) → finding[]
 * finding: { key, tier, icon, title, detail, action }
 * action: { type: 'edit' } | { type: 'merge', pair } | { type: 'story' }
 *   | { type: 'document-fact', docId, factIndex }
 *   | { type: 'document-field', docId, field }
 *   | { type: 'document-person', docId, personIndex, matchedId, relation }
 *   | { type: 'relationship-fact', key, year, title, detail, tag? }
 */
import { profileCompleteness, isDuplicateLifeEvent, hasEventMentioning } from './profile.js';
import { findDuplicatePairs } from './duplicates.js';
import { yearOf, yearsBetween } from './dates.js';

const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive' || q === 'adopted';
const firstNameOf = (p) => (p?.display_name || '').trim().split(/\s+/)[0] || p?.display_name || 'they';

const FIELD_LABEL = {
  occupation: 'Occupation', birth_place: 'Birth place', residence: 'Residence',
  military_branch: 'Branch', military_nation: 'Served with', military_service_number: 'Service number', military_rank: 'Rank',
};
const BRANCH_DISPLAY = { army: 'Army', navy: 'Navy', air_force: 'Air Force' };
const PROFILE_FIELD_KEYS = [
  'occupation', 'birth_place', 'residence',
  'military_branch', 'military_nation', 'military_service_number', 'military_rank',
];

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

  // ── Relationship-derived life events — a marriage date, a partner's death,
  //    a child's or grandchild's birth: facts already recorded elsewhere on
  //    the tree, re-surfaced as a timeline entry. Same accept/dismiss shape
  //    as a document fact (tier 'relationship', action 'relationship-fact'),
  //    but there's no document behind it: accepting writes straight to
  //    person.events via addLifeEvent, and since the underlying condition
  //    (the marriage_date, the birth) never goes away on its own, a
  //    dismissal has to be remembered explicitly, on the person itself. ────
  const dismissedRelFacts = new Set(person.dismissed_relationship_facts || []);
  // subjectName is who the fact is actually about (the partner, the child,
  // the grandchild) — checked against hasEventMentioning in ADDITION to the
  // title-similarity check above, since a user's own event for the same
  // birth or marriage is very often phrased nothing like "Welcomed Oliver"
  // ("Our son arrived", "Birth of Oliver at Cardiff") and would otherwise
  // slip past isDuplicateLifeEvent and get re-offered.
  function pushRelationshipFact(key, fact, subjectName) {
    if (dismissedRelFacts.has(key)) return false;
    if (isDuplicateLifeEvent(person, fact)) return false;
    if (subjectName && hasEventMentioning(person, fact.year, subjectName)) return false;
    findings.push({
      key: `rel_${key}`,
      tier: 'relationship',
      icon: 'family',
      title: fact.year ? `${fact.title} — ${fact.year}` : fact.title,
      detail: fact.detail,
      action: { type: 'relationship-fact', key, year: fact.year, title: fact.title, detail: fact.detail },
    });
    return true;
  }

  // Married — every partner relationship already carries its own
  // marriage_date/place once set via the spouse editor. Offered regardless
  // of current/former status: it happened, and belongs on the timeline
  // either way.
  for (const p of graph.partners(person.id)) {
    if (!p.marriage_date) continue;
    const partner = graph.byId.get(p.id);
    if (!partner) continue;
    pushRelationshipFact(`married_${p.id}`, {
      year: yearOf(p.marriage_date),
      title: `Married ${firstNameOf(partner)}`,
      detail: p.marriage_place ? `In ${p.marriage_place}.` : undefined,
    }, partner.display_name);
  }

  // Widowed — a still-"current" partner who has since died. Skipped if this
  // person's own recorded death predates the partner's — they didn't live
  // to be widowed by them.
  for (const p of graph.partners(person.id)) {
    if (p.status !== 'current') continue;
    const partner = graph.byId.get(p.id);
    if (!partner?.is_deceased || !partner.death_date) continue;
    if (person.is_deceased && person.death_date) {
      const order = yearsBetween(partner.death_date, person.death_date);
      if (order != null && order < 0) continue;
    }
    pushRelationshipFact(`widowed_${p.id}`, {
      year: yearOf(partner.death_date),
      title: 'Widowed',
      detail: `After the death of ${firstNameOf(partner)}.`,
    }, partner.display_name);
  }

  // Became a parent — one candidate per child with a recorded birth date,
  // oldest first. Capped so a large family doesn't flood the sheet; any
  // left over are still just as addable by hand from the timeline editor.
  const parentCandidates = graph.children(person.id)
    .filter((c) => isBioAdopt(c.qualifier))
    .map((c) => graph.byId.get(c.id))
    .filter((child) => child?.birth_date)
    .sort((a, b) => Number(yearOf(a.birth_date)) - Number(yearOf(b.birth_date)));
  const MAX_PARENT_SUGGESTIONS = 3;
  let shownParent = 0;
  for (const child of parentCandidates) {
    if (shownParent >= MAX_PARENT_SUGGESTIONS) break;
    const pushed = pushRelationshipFact(`parent_${child.id}`, {
      year: yearOf(child.birth_date),
      title: `Welcomed ${firstNameOf(child)}`,
      detail: child.birth_place ? `Born in ${child.birth_place}.` : undefined,
    }, child.display_name);
    if (pushed) shownParent++;
  }

  // Became a grandparent — the earliest grandchild's birth only, one
  // milestone rather than one row per grandchild.
  const grandchildren = graph.children(person.id)
    .filter((c) => isBioAdopt(c.qualifier))
    .flatMap((c) => graph.children(c.id))
    .filter((gc) => isBioAdopt(gc.qualifier))
    .map((gc) => graph.byId.get(gc.id))
    .filter((gc) => gc?.birth_date);
  if (grandchildren.length) {
    const earliest = grandchildren.sort(
      (a, b) => Number(yearOf(a.birth_date)) - Number(yearOf(b.birth_date)),
    )[0];
    pushRelationshipFact('grandparent', {
      year: yearOf(earliest.birth_date),
      title: 'Became a grandparent',
      detail: `${earliest.display_name} was born.`,
    }, earliest.display_name);
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
    for (const field of PROFILE_FIELD_KEYS) {
      const candidate = pf[field];
      if (!candidate || candidate.status !== 'pending' || person[field]) continue;
      const displayValue = field === 'military_branch' ? (BRANCH_DISPLAY[candidate.value] || candidate.value) : candidate.value;
      findings.push({
        key: `doc_field_${doc.id}_${field}`,
        tier: 'document',
        icon: field.startsWith('military_') ? 'military' : 'checklist',
        title: `${FIELD_LABEL[field]}: ${displayValue}`,
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
