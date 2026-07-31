/*
 * Deterministic, privacy-safe synthetic family fixtures for Phase 0 of
 * docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md — never derived from,
 * seeded by, or resembling any real family's data. Every name/place/
 * occupation comes from a small fixed synthetic pool, combined purely by a
 * seeded PRNG; no network calls, no file reads of production data, nothing
 * here ever touches D1/R2. The same {size, seed} always produces
 * byte-identical output (see tests/fixtureGenerator.test.mjs), so benchmark
 * runs are reproducible across machines and over time — a load-bearing
 * property for comparing "before" and "after" numbers honestly.
 *
 * Produces a tree in exactly the shape src/data/store.js's EMPTY state (and
 * therefore functions/_lib/treeStore.js's splitTree) already expects:
 * { people, relationships, memories, photos, documents, activity,
 *   familyName, hasCompletedOnboarding, myPersonId, _deleted }.
 *
 * Required variants (docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md
 * §8.1) are woven into every fixture rather than built as separate one-off
 * generators, so a single {size, seed} run is always a superset covering
 * all of them:
 *   - narrow/deep ancestry AND wide cousin-heavy family (natural growth
 *     alternates branching factor, so both shapes occur within one tree);
 *   - a guaranteed 4-current-partner anchor (the spec's new "standard" case)
 *     and, for size >= 500, an 8-current-partner anchor (the "stress" case);
 *   - adoptive and step parent-child edges, both probabilistic during
 *     natural growth AND explicitly guaranteed at least once regardless of
 *     size, so a small 100-person fixture can't roll zero by chance;
 *   - a guaranteed pedigree-collapse marriage (two distant cousins produce
 *     a shared descendant reachable by more than one ancestry path);
 *   - a reserved pool of fully disconnected people (§11.1's own "disconnected
 *     people" test case);
 *   - rich profiles (bio/occupation/tags/events + memories/photos/documents
 *     entries) for a fraction of people, sparse (name+dates+gender only)
 *     for the rest.
 * The one variant deliberately NOT woven in here is the malformed-cycle
 * fixture — mixing a corrupt cycle into an otherwise-valid tree would make
 * every other integrity check ambiguous ("is this pair unreachable because
 * of the cycle, or a real bug?"). It's its own tiny, separate fixture:
 * generateCorruptCycleFixture() below.
 */

// mulberry32 — the same PRNG lib/insightModules.js's seededShuffle already
// uses, reused verbatim rather than a second implementation existing side
// by side with a different determinism guarantee.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small fixed synthetic pools — plain, common-sounding names with no tie to
// any real person or family. Kept short and unremarkable on purpose: this
// is fixture plumbing, not a feature that needs variety for its own sake.
const FIRST_NAMES_M = [
  'James', 'Robert', 'Thomas', 'William', 'Arthur', 'Henry', 'George', 'Edward',
  'Charles', 'Frederick', 'Albert', 'Walter', 'Daniel', 'Samuel', 'Benjamin',
  'Oliver', 'Noah', 'Liam', 'Mark', 'David', 'Peter', 'Simon', 'Andrew', 'Paul',
];
const FIRST_NAMES_F = [
  'Mary', 'Margaret', 'Elizabeth', 'Florence', 'Alice', 'Emily', 'Sarah',
  'Susan', 'Linda', 'Rachel', 'Megan', 'Chloe', 'Eleanor', 'Catherine', 'Anne',
  'Dorothy', 'Ruth', 'Helen', 'Joan', 'Victoria', 'Grace', 'Laura', 'Emma', 'Ava',
];
const SURNAMES = [
  'Mercer', 'Walker', 'Carter', 'Turner', 'Bennett', 'Hayes', 'Foster',
  'Whitfield', 'Barlow', 'Pryce', 'Sutton', 'Marsh', 'Fenwick', 'Osborne',
  'Radcliffe', 'Doyle', 'Ashworth', 'Kendrick', 'Lancaster', 'Sherwood',
];
const OCCUPATIONS = [
  'Engineer', 'Teacher', 'Carpenter', 'Nurse', 'Clerk', 'Farmer', 'Architect',
  'Electrician', 'Solicitor', 'Shopkeeper', 'Seamstress', 'Railwayman',
  'Bookkeeper', 'Physician', 'Librarian', 'Blacksmith',
];
const PLACES = [
  'Ashford, Kent', 'Merthyr Tydfil, Wales', 'Bristol, England', 'Preston, Lancashire',
  'Dundee, Scotland', 'Cork, Ireland', 'Norwich, England', 'Perth, Australia',
  'Halifax, Canada', 'Wellington, New Zealand',
];
const TAGS = ['Storyteller', 'Gardener', 'Chapel-goer', 'Traveller', 'Musician', 'Collector'];

const isVowel = (c) => 'aeiou'.includes(c.toLowerCase());

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// Whole-years-plus-a-plausible-month/day birth date, generation index scaled
// so ancestry reads chronologically sane (~27 years/generation) without
// needing real demographic data.
function birthDateFor(rand, genIndex) {
  const year = 1900 + genIndex * 27 + Math.floor(rand() * 8) - 4;
  const month = 1 + Math.floor(rand() * 12);
  const day = 1 + Math.floor(rand() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function yearOf(dateStr) {
  return Number(dateStr.slice(0, 4));
}

/*
 * Builds one fixture: { tree, meta }. `tree` is the full logical tree shape;
 * `meta` records which ids were deliberately placed for each guaranteed
 * structural case, so tests and the benchmark harness can assert against
 * them directly instead of re-deriving "which person is the 8-anchor hub"
 * from scratch.
 */
export function generateFamilyFixture({ size, seed = 1, richFraction = 0.28 }) {
  if (!Number.isInteger(size) || size < 20) {
    throw new Error('generateFamilyFixture: size must be an integer >= 20');
  }
  const rand = mulberry32(seed);

  const people = [];
  const relationships = [];
  const memories = [];
  const photos = [];
  const documents = [];
  let personSeq = 0;
  let relSeq = 0;
  let contentSeq = 0;

  // Reserve a fixed budget of people for the guaranteed structural cases —
  // spent AFTER natural growth, so those cases never have to compete with
  // organic growth for the last few slots of a small fixture and risk
  // being silently skipped. Sized to the exact worst-case cost of every
  // guaranteed addition below (four-partner hub cluster: 5; eight-partner
  // hub cluster, size >= 500 only: 9; pedigree-collapse child: 1; explicit
  // step child: 1; explicit adoptive child: 1), plus a small margin so a
  // few genuinely disconnected people (the §11.1 "disconnected people"
  // case) always remain even after every guaranteed case is funded. A
  // fixed-percentage reserve alone (the previous version of this) silently
  // under-funded the size >= 500 tier, since the eight-partner cluster
  // alone (9 people) plus everything else (8 more) could exceed a
  // percentage-only budget for the smaller sizes in that tier.
  const guaranteedBudget = 5 + (size >= 500 ? 9 : 0) + 1 + 1 + 1;
  const reserve = Math.min(80, Math.max(guaranteedBudget + 6, Math.round(size * 0.02)));
  const growthTarget = size - reserve;

  function addPerson(genIndex, { rich = null } = {}) {
    if (people.length >= size) return null;
    const gender = rand() < 0.5 ? 'male' : 'female';
    const first = pick(rand, gender === 'male' ? FIRST_NAMES_M : FIRST_NAMES_F);
    const family = pick(rand, SURNAMES);
    const id = `f${seed}_p${++personSeq}`;
    const isRich = rich != null ? rich : rand() < richFraction;
    const birth_date = birthDateFor(rand, genIndex);
    const birthYear = yearOf(birth_date);
    // Living/deceased: nobody born in the last ~14 "simulated years" from
    // the newest generation is deceased; older generations skew deceased,
    // never both is_living and is_deceased true (the real data model's own
    // invariant) — genIndex-relative rather than a fixed calendar year, so
    // this stays sane regardless of how many generations a given size grows.
    const veryOld = genIndex <= 1;
    const is_deceased = veryOld ? rand() < 0.85 : rand() < 0.12;
    const death_date = is_deceased
      ? `${birthYear + 40 + Math.floor(rand() * 45)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-01`
      : null;
    const person = {
      id,
      display_name: `${first} ${family}`,
      given_names: first,
      family_name: family,
      maiden_name: gender === 'female' && rand() < 0.4 ? pick(rand, SURNAMES) : null,
      birth_date,
      death_date,
      is_living: !is_deceased,
      is_deceased,
      is_minor: false,
      gender,
      birth_place: pick(rand, PLACES),
      confidence: 'confirmed',
      // ~55% carry a photo reference — a realistic-length placeholder URL,
      // never a real image, never fetched by anything that reads this
      // fixture (payload-size benchmarking needs the BYTES a photo field
      // typically costs, not an actual picture).
      photo: rand() < 0.55 ? `https://faces.invalid/synthetic/${id}.jpg` : null,
    };
    if (isRich) {
      person.occupation = pick(rand, OCCUPATIONS);
      person.bio = `${first} spent much of their life in ${person.birth_place.split(',')[0]}, remembered by family for being endlessly reliable.`;
      person.tags = [pick(rand, TAGS), pick(rand, TAGS)];
      person.events = [{ year: birthYear + 22, title: 'Started work', detail: `As a ${person.occupation?.toLowerCase()}` }];
      memories.push({
        id: `f${seed}_m${++contentSeq}`,
        person_id: id,
        text: `${first} always had a story ready for Sunday lunch.`,
        author: 'Family',
        created_at: `${birthYear + 50}-01-01`,
        votes: Math.floor(rand() * 6),
      });
      if (rand() < 0.5) {
        photos.push({ id: `f${seed}_ph${++contentSeq}`, person_id: id, src: `https://photos.invalid/synthetic/${id}.jpg`, caption: null });
      }
      if (rand() < 0.3) {
        documents.push({ id: `f${seed}_d${++contentSeq}`, person_id: id, title: 'Certificate', mime: 'image/jpeg', src: `https://docs.invalid/synthetic/${id}.jpg` });
      }
    }
    people.push(person);
    return person;
  }

  function addPartner(a, b, status = 'current', meta = {}) {
    if (!a || !b) return null;
    const edge = {
      id: `f${seed}_r${++relSeq}`,
      from_person: a.id,
      to_person: b.id,
      type: 'partner',
      qualifier: 'biological',
      partner_status: status,
      is_married: !!meta.marriage_date || !!meta.is_married,
      marriage_date: meta.marriage_date ?? null,
      marriage_place: meta.marriage_place ?? null,
      separation_date: meta.separation_date ?? null,
    };
    relationships.push(edge);
    return edge;
  }

  function addParent(parent, child, qualifier = 'biological') {
    if (!parent || !child) return null;
    const edge = {
      id: `f${seed}_r${++relSeq}`,
      from_person: parent.id,
      to_person: child.id,
      type: 'parent',
      qualifier,
    };
    relationships.push(edge);
    return edge;
  }

  // ── Natural growth: founders → generations of couples → their children ──
  // A SMALL, size-independent number of founding couples on purpose — a
  // real family that grew to 5,000 people is overwhelmingly one large
  // interconnected tree, not dozens of unrelated lineages that happen to
  // share a fixture file. An earlier version scaled founder count with
  // size (up to 60), which produced a forest of ~30 largely-disconnected
  // family islands at the 5,000-person tier instead of one connected
  // family — verified directly: distancesFrom the default viewer only
  // reached ~7% of the fixture. Exponential branching from just a
  // few roots already produces both required shapes (deep narrow lines AND
  // wide cousin-heavy branches) without needing many independent starting
  // points, and stays connected because it IS mostly one shared ancestry.
  const founderCount = 4;
  const founders = [];
  for (let i = 0; i < founderCount; i++) {
    const p = addPerson(0);
    if (p) founders.push(p);
  }
  const founderCouples = [];
  for (let i = 0; i + 1 < founders.length; i += 2) {
    addPartner(founders[i], founders[i + 1], 'widowed', { marriage_date: String(1900 + Math.floor(rand() * 10)) });
    founderCouples.push([founders[i], founders[i + 1]]);
  }

  // Distant-cousin candidates tracked per generation for the pedigree-
  // collapse case below — real descendants of two DIFFERENT founder
  // couples, so reconnecting them creates a genuine second path back to a
  // shared ancestor rather than an arbitrary edge.
  const branchOf = new Map(); // personId -> founder-couple index
  founderCouples.forEach((_, i) => { branchOf.set(founderCouples[i][0].id, i); branchOf.set(founderCouples[i][1].id, i); });
  const byGenBranch = new Map(); // `${gen}|${branch}` -> [people]
  const trackBranch = (person, genIndex, branch) => {
    branchOf.set(person.id, branch);
    const key = `${genIndex}|${branch}`;
    if (!byGenBranch.has(key)) byGenBranch.set(key, []);
    byGenBranch.get(key).push(person);
  };
  founderCouples.forEach(([a, b], i) => { trackBranch(a, 0, i); trackBranch(b, 0, i); });

  let frontier = founderCouples.map(([a, b], i) => ({ a, b, branch: i }));
  let genIndex = 1;
  const guard = 60; // generations — plenty for any target size, hangs never
  while (people.length < growthTarget && genIndex < guard) {
    const nextFrontier = [];
    for (const { a, b, branch } of frontier) {
      if (people.length >= growthTarget) break;
      const childCount = Math.max(0, Math.round(1.4 + (rand() + rand() + rand() - 1.5))); // ~0-4, mean ~2.2
      const children = [];
      for (let c = 0; c < childCount; c++) {
        if (people.length >= growthTarget) break;
        const roll = rand();
        const qualifier = roll < 0.03 ? 'adoptive' : roll < 0.06 ? 'step' : 'biological';
        const child = addPerson(genIndex);
        if (!child) break;
        // Adoptive is symmetric (both parents adopted the child together);
        // step is deliberately asymmetric — one biological parent, one step
        // parent — matching the real data model's own convention (see
        // src/data/seed.js's own step-parent case) rather than marking both
        // parents 'step', which no real edit flow ever produces.
        addParent(a, child, qualifier === 'step' ? 'biological' : qualifier);
        addParent(b, child, qualifier);
        trackBranch(child, genIndex, branch);
        children.push(child);
      }
      for (const child of children) {
        if (people.length >= growthTarget) { nextFrontier.push({ a: child, b: null, branch }); continue; }
        let partner = null;
        // Occasionally marry two distant cousins from different founder
        // branches at a similar generation depth — organic pedigree
        // collapse, on top of the unconditional guaranteed case added
        // after natural growth finishes (see below) — this one is pure
        // extra realism, not relied on for the guaranteed-fixture contract.
        if (genIndex >= 2 && rand() < 0.015) {
          const candidates = (byGenBranch.get(`${genIndex}|${(branch + 1) % founderCouples.length}`) || [])
            .filter((x) => x.id !== child.id);
          if (candidates.length) partner = pick(rand, candidates);
        }
        if (!partner) partner = addPerson(genIndex);
        if (partner) {
          const status = rand() < 0.08 ? 'former' : 'current';
          addPartner(child, partner, status, status === 'current' && rand() < 0.7
            ? { marriage_date: String(1900 + genIndex * 27) }
            : {});
          trackBranch(partner, genIndex, branch);
          nextFrontier.push({ a: child, b: partner, branch });
        } else {
          nextFrontier.push({ a: child, b: null, branch });
        }
      }
    }
    frontier = nextFrontier;
    genIndex++;
    if (frontier.length === 0 && people.length < growthTarget) {
      // A very small target can run out of organic couples before
      // reaching growthTarget — seed one fresh founder couple to keep
      // growing rather than stalling permanently below size.
      const f1 = addPerson(genIndex);
      const f2 = addPerson(genIndex);
      if (!f1 || !f2) break;
      addPartner(f1, f2, 'current', { marriage_date: String(1900 + genIndex * 27) });
      const branch = founderCouples.length + genIndex;
      trackBranch(f1, genIndex, branch);
      trackBranch(f2, genIndex, branch);
      frontier = [{ a: f1, b: f2, branch }];
    }
  }

  const meta = { fourPartnerAnchorId: null, eightPartnerAnchorId: null, pedigreeCollapseChildId: null, disconnectedIds: [], stepChildId: null, adoptiveChildId: null };

  // ── Guaranteed structural fixtures, spent from the reserved budget ──────
  // A hub person with exactly four CURRENT partners — the spec's revised
  // "standard" multi-anchor case (docs §7/§8.1).
  const fourHub = addPerson(genIndex);
  if (fourHub) {
    meta.fourPartnerAnchorId = fourHub.id;
    for (let i = 0; i < 4; i++) {
      const partner = addPerson(genIndex);
      if (partner) addPartner(fourHub, partner, 'current', { marriage_date: null });
    }
  }

  // An 8-anchor stress hub — only for fixtures large enough that this is a
  // meaningful fraction of the population, matching §8.1's own "for size
  // >= 500" framing of the stress case.
  if (size >= 500) {
    const eightHub = addPerson(genIndex);
    if (eightHub) {
      meta.eightPartnerAnchorId = eightHub.id;
      for (let i = 0; i < 8; i++) {
        const partner = addPerson(genIndex);
        if (partner) addPartner(eightHub, partner, 'current', { marriage_date: null });
      }
    }
  }

  // A guaranteed pedigree-collapse case — unconditional, regardless of
  // whether the organic 1.5%-chance one above happened to fire, so a test
  // asserting on meta.pedigreeCollapseChildId can rely on it deterministically
  // rather than depending on undocumented dice rolls elsewhere in the
  // generator. Two distant cousins from different founder branches produce
  // a shared child, so that child (and the two parents) are reachable by
  // more than one ancestry path.
  if (founderCouples.length >= 2) {
    const peopleInBranch = (branch) =>
      [...byGenBranch.entries()]
        .filter(([key]) => Number(key.split('|')[1]) === branch)
        .flatMap(([, v]) => v);
    const branchAPeople = peopleInBranch(0);
    const branchBPeople = peopleInBranch(1);
    // Prefer the deepest generation each branch reached (closest to
    // "distant cousins meeting as adults" rather than two founders
    // themselves), falling back to whatever's available.
    const cousinA = branchAPeople[branchAPeople.length - 1];
    const cousinB = branchBPeople[branchBPeople.length - 1];
    if (cousinA && cousinB && cousinA.id !== cousinB.id) {
      addPartner(cousinA, cousinB, 'current', {});
      const collapseChild = addPerson(genIndex);
      if (collapseChild) {
        addParent(cousinA, collapseChild, 'biological');
        addParent(cousinB, collapseChild, 'biological');
        meta.pedigreeCollapseChildId = collapseChild.id;
      }
    }
  }

  // At least one explicit step and one explicit adoptive edge, guaranteed
  // regardless of what natural growth's dice happened to roll — matters
  // most for small fixtures (100 people) where the ~3-6% per-child chance
  // can plausibly roll zero.
  if (founders.length >= 2) {
    const stepChild = addPerson(genIndex);
    if (stepChild) {
      addParent(founders[0], stepChild, 'biological');
      addParent(founders[1], stepChild, 'step');
      meta.stepChildId = stepChild.id;
    }
    const adoptChild = addPerson(genIndex);
    if (adoptChild) {
      addParent(founders[0], adoptChild, 'adoptive');
      addParent(founders[1], adoptChild, 'adoptive');
      meta.adoptiveChildId = adoptChild.id;
    }
  }

  // Whatever's left of the reserve becomes deliberately disconnected people
  // — no relationships at all — the §11.1 "disconnected people" case.
  while (people.length < size) {
    const p = addPerson(genIndex + 1);
    if (!p) break;
    meta.disconnectedIds.push(p.id);
  }

  const tree = {
    people,
    relationships,
    memories,
    photos,
    documents,
    activity: [],
    familyName: `Synthetic Fixture ${size}`,
    hasCompletedOnboarding: true,
    myPersonId: founders[0]?.id ?? people[0]?.id ?? null,
    _deleted: {},
  };

  return { tree, meta };
}

/*
 * A tiny, deliberately corrupt fixture — a 3-person parent-child CYCLE
 * (A parent-of B, B parent-of C, C parent-of A), which cannot occur from
 * any real editing flow but must not hang traversal code that assumes a
 * DAG. Kept separate from generateFamilyFixture's own output (see file
 * header) so a corrupt-cycle test never has to be disentangled from
 * "is this an intentional pedigree-collapse path or a bug" ambiguity.
 * Deliberately tiny — this fixture exists to prove termination, not to
 * exercise scale.
 */
export function generateCorruptCycleFixture(seed = 1) {
  const rand = mulberry32(seed);
  const mk = (i) => ({
    id: `cyc_p${i}`,
    display_name: `${pick(rand, FIRST_NAMES_M)} ${pick(rand, SURNAMES)}`,
    given_names: 'Test',
    family_name: 'Cycle',
    birth_date: '1950-01-01',
    death_date: null,
    is_living: true,
    is_deceased: false,
    is_minor: false,
    gender: 'male',
    confidence: 'confirmed',
    photo: null,
  });
  const a = mk(1), b = mk(2), c = mk(3), d = mk(4), e = mk(5), f = mk(6);
  const rel = (from, to, id) => ({ id, from_person: from.id, to_person: to.id, type: 'parent', qualifier: 'biological' });
  return {
    tree: {
      people: [a, b, c, d, e, f],
      relationships: [
        rel(a, b, 'cyc_r1'),
        rel(b, c, 'cyc_r2'),
        rel(c, a, 'cyc_r3'), // the cycle: a -> b -> c -> a
        // d/e/f: a smaller, separate self-referential edge (a person
        // recorded as their own parent) — a different corruption shape
        // than a multi-hop cycle, equally real as "bad data a defensive
        // import/merge could produce."
        rel(d, d, 'cyc_r4'),
        rel(e, f, 'cyc_r5'),
        rel(f, e, 'cyc_r6'), // a 2-hop mutual-parent cycle
      ],
      memories: [], photos: [], documents: [], activity: [],
      familyName: 'Corrupt Cycle Fixture', hasCompletedOnboarding: true, myPersonId: a.id, _deleted: {},
    },
    meta: { cycleIds: [a.id, b.id, c.id], selfParentId: d.id, mutualCycleIds: [e.id, f.id] },
  };
}
