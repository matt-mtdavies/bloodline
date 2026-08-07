/*
 * Structural fixtures for the Tree Motion Lab.
 *
 * Deliberately synthetic and deliberately shared between the lab UI and the
 * test suite: every motion claim made in the lab is the same input a test can
 * assert on. No real family data ever reaches V2 — the lab is fixture-only.
 *
 * Each fixture is a family SHAPE chosen because it stresses one composition
 * rule. Names are ordinary so screenshots read like a real tree rather than
 * "n1 n2 n3", but nobody here is a real person.
 *
 * A fixture is `{ id, label, note, focus, people, relationships }` — the same
 * flat shape src/data/graph.js#buildGraph consumes, so the lab and the tests
 * both just call buildGraph(fixture.people, fixture.relationships).
 */

let seq = 0;
const p = (id, name, opts = {}) => ({
  id,
  display_name: name,
  given_names: name.split(' ')[0],
  family_name: name.split(' ').slice(1).join(' ') || null,
  birth_date: opts.born ?? null,
  death_date: opts.died ?? null,
  is_deceased: !!opts.died,
  is_living: !opts.died,
  gender: opts.gender ?? null,
  _seed: seq++,
});
const par = (parentId, childId, qualifier = 'biological') => ({
  type: 'parent', from_person: parentId, to_person: childId, qualifier, partner_status: null,
});
const ptn = (a, b, status = 'current') => ({
  type: 'partner', from_person: a, to_person: b, partner_status: status,
});

/* ── 1. The plain case: one couple, three children ───────────────────────── */
const nuclear = {
  id: 'nuclear',
  label: 'Nuclear family',
  note: 'The baseline. One union, three children — nothing to disambiguate.',
  focus: 'n_dad',
  people: [
    p('n_dad', 'Robert Mercer', { born: '1958', gender: 'male' }),
    p('n_mum', 'Linda Mercer', { born: '1960', gender: 'female' }),
    p('n_a', 'James Mercer', { born: '1985', gender: 'male' }),
    p('n_b', 'Sarah Mercer', { born: '1988', gender: 'female' }),
    p('n_c', 'Tom Mercer', { born: '1990', gender: 'male' }),
  ],
  relationships: [
    ptn('n_dad', 'n_mum'),
    par('n_dad', 'n_a'), par('n_mum', 'n_a'),
    par('n_dad', 'n_b'), par('n_mum', 'n_b'),
    par('n_dad', 'n_c'), par('n_mum', 'n_c'),
  ],
};

/* ── 2. The reported shape: remarriage, a step-parent, two child sets ─────
 * Christopher is Heather's FORMER partner and has his own ancestry; Ken is
 * her current partner and has children of his own. Both child sets belong on
 * one row beneath a single levelled adult row. This is the fixture that the
 * production layout got visibly wrong.                                      */
const remarried = {
  id: 'remarried',
  label: 'Remarriage + step-family',
  note: "Former partner with his own ancestry, current partner with his own children. One adult row, one child row.",
  focus: 'r_heather',
  people: [
    p('r_gran', 'Dorothy Monish', { born: '1931', gender: 'female' }),
    p('r_grandad', 'Francis Monish', { born: '1928', gender: 'male' }),
    p('r_heather', 'Heather Davies', { born: '1957', gender: 'female' }),
    p('r_ken', 'Ken Threlfall', { born: '1955', gender: 'male' }),
    p('r_chris', 'Christopher Monish', { born: '1958', gender: 'male' }),
    p('r_matthew', 'Matthew Davies', { born: '1980', gender: 'male' }),
    p('r_jason', 'Jason Davies', { born: '1982', gender: 'male' }),
    p('r_jessica', 'Jessica Lamb', { born: '1981', gender: 'female' }),
    p('r_amie', 'Amie Frankcom', { born: '1983', gender: 'female' }),
    p('r_fiona', 'Fiona Davies', { born: '1984', gender: 'female' }),
  ],
  relationships: [
    par('r_gran', 'r_chris'), par('r_grandad', 'r_chris'),
    ptn('r_heather', 'r_ken'),
    ptn('r_heather', 'r_chris', 'former'),
    par('r_chris', 'r_matthew'), par('r_heather', 'r_matthew'),
    par('r_chris', 'r_jason'), par('r_heather', 'r_jason'),
    par('r_ken', 'r_jessica'),
    par('r_ken', 'r_amie'),
    ptn('r_jason', 'r_fiona', 'former'),
  ],
};

/* ── 3. Three partners in one pod ────────────────────────────────────────── */
const threePod = {
  id: 'three-pod',
  label: 'Three-partner pod',
  note: 'Two former partners and one current. All four adults share one row; the hub sits between the chapters.',
  focus: 't_hub',
  people: [
    p('t_hub', 'Peter Johnston', { born: '1962', gender: 'male' }),
    p('t_ex1', 'Alice Reed', { born: '1963', gender: 'female' }),
    p('t_ex2', 'Bianca Cole', { born: '1966', gender: 'female' }),
    p('t_now', 'Clara Ford', { born: '1970', gender: 'female' }),
    p('t_k1', 'Daniel Johnston', { born: '1988', gender: 'male' }),
    p('t_k2', 'Erin Johnston', { born: '1992', gender: 'female' }),
    p('t_k3', 'Felix Johnston', { born: '2001', gender: 'male' }),
  ],
  relationships: [
    ptn('t_hub', 't_ex1', 'former'),
    ptn('t_hub', 't_ex2', 'former'),
    ptn('t_hub', 't_now'),
    par('t_hub', 't_k1'), par('t_ex1', 't_k1'),
    par('t_hub', 't_k2'), par('t_ex2', 't_k2'),
    par('t_hub', 't_k3'), par('t_now', 't_k3'),
  ],
};

/* ── 4. A wide sibling rank ──────────────────────────────────────────────── */
const wideSiblings = {
  id: 'wide-siblings',
  label: 'Eight siblings',
  note: 'Tests even distribution and that the selected sibling stays put while the rank composes around them.',
  focus: 'w_s4',
  people: [
    p('w_dad', 'Arthur Pike', { born: '1920', gender: 'male' }),
    p('w_mum', 'Margaret Pike', { born: '1924', gender: 'female' }),
    ...Array.from({ length: 8 }, (_, i) =>
      p(`w_s${i + 1}`, `${['Ada', 'Bert', 'Cyril', 'Dora', 'Edith', 'Frank', 'Grace', 'Harold'][i]} Pike`, {
        born: String(1945 + i * 2), gender: i % 2 ? 'male' : 'female',
      })),
  ],
  relationships: [
    ptn('w_dad', 'w_mum'),
    ...Array.from({ length: 8 }, (_, i) => par('w_dad', `w_s${i + 1}`)),
    ...Array.from({ length: 8 }, (_, i) => par('w_mum', `w_s${i + 1}`)),
  ],
};

/* ── 5. Five generations straight down ───────────────────────────────────── */
const deepLineage = {
  id: 'deep-lineage',
  label: 'Five generations',
  note: 'Tests row ordering and that the camera frames the near family, not the whole lineage.',
  focus: 'd_g3',
  people: Array.from({ length: 5 }, (_, i) =>
    p(`d_g${i + 1}`, `${['William', 'Arthur', 'Robert', 'James', 'Oliver'][i]} Ashcroft`, {
      born: String(1880 + i * 28), gender: 'male',
    })).concat(Array.from({ length: 5 }, (_, i) =>
    p(`d_w${i + 1}`, `${['Florence', 'Margaret', 'Linda', 'Megan', 'Ivy'][i]} Ashcroft`, {
      born: String(1883 + i * 28), gender: 'female',
    }))),
  relationships: [
    ...Array.from({ length: 5 }, (_, i) => ptn(`d_g${i + 1}`, `d_w${i + 1}`)),
    ...Array.from({ length: 4 }, (_, i) => par(`d_g${i + 1}`, `d_g${i + 2}`)),
    ...Array.from({ length: 4 }, (_, i) => par(`d_w${i + 1}`, `d_g${i + 2}`)),
  ],
};

/* ── 6. Near family plus a large unrelated branch ────────────────────────
 * The composition guard: the distant branch must not shift the near family
 * by a single pixel.                                                        */
const distantPull = {
  id: 'distant-pull',
  label: 'Near family + distant branch',
  note: 'A far cousin branch of 12. The near family must compose identically with or without it.',
  focus: 'x_me',
  people: [
    p('x_gran', 'Eleanor Bennett', { born: '1930', gender: 'female' }),
    p('x_grandad', 'Thomas Bennett', { born: '1928', gender: 'male' }),
    p('x_mum', 'Nancy Turner', { born: '1955', gender: 'female' }),
    p('x_dad', 'Peter Turner', { born: '1953', gender: 'male' }),
    p('x_aunt', 'Rosemary Bennett', { born: '1958', gender: 'female' }),
    p('x_me', 'Heather Turner', { born: '1980', gender: 'female' }),
    p('x_sib', 'Gordon Turner', { born: '1983', gender: 'male' }),
    p('x_partner', 'Neil Hardy', { born: '1979', gender: 'male' }),
    p('x_kid1', 'Ivy Hardy', { born: '2008', gender: 'female' }),
    p('x_kid2', 'Leo Hardy', { born: '2011', gender: 'male' }),
    ...Array.from({ length: 12 }, (_, i) =>
      p(`x_far${i}`, `Distant Cousin ${i + 1}`, { born: String(1975 + i), gender: i % 2 ? 'male' : 'female' })),
  ],
  relationships: [
    ptn('x_gran', 'x_grandad'),
    par('x_gran', 'x_mum'), par('x_grandad', 'x_mum'),
    par('x_gran', 'x_aunt'), par('x_grandad', 'x_aunt'),
    ptn('x_mum', 'x_dad'),
    par('x_mum', 'x_me'), par('x_dad', 'x_me'),
    par('x_mum', 'x_sib'), par('x_dad', 'x_sib'),
    ptn('x_me', 'x_partner'),
    par('x_me', 'x_kid1'), par('x_partner', 'x_kid1'),
    par('x_me', 'x_kid2'), par('x_partner', 'x_kid2'),
    // The aunt's descendants — a whole branch hanging off one side.
    par('x_aunt', 'x_far0'), par('x_aunt', 'x_far1'), par('x_aunt', 'x_far2'),
    ...Array.from({ length: 9 }, (_, i) => par(`x_far${i % 3}`, `x_far${i + 3}`)),
  ],
};

/* ── 7. A transitive partner chain: A–B, B–C, C–D ─────────────────────────
 * A real reported bug: full transitive closure over the whole partner graph
 * once collapsed a chain like this into one giant rigid pod, purely because
 * B and C each happen to have two partners. B's partnership with C has
 * nothing to do with A, and C's with D has nothing to do with B — only
 * DIRECT partnerships belong in the same rigid pod.                         */
const partnerChain = {
  id: 'partner-chain',
  label: 'Partner chain (non-transitive)',
  note: "A–B and C–D are direct partnerships; B–C is a separate one. Selecting A must not drag C or D into A's pod.",
  focus: 'ch_a',
  people: [
    p('ch_a', 'Aaron Voss', { born: '1959', gender: 'male' }),
    p('ch_b', 'Bridget Voss', { born: '1961', gender: 'female' }),
    p('ch_c', 'Carl Doyle', { born: '1963', gender: 'male' }),
    p('ch_d', 'Diane Doyle', { born: '1965', gender: 'female' }),
  ],
  relationships: [
    ptn('ch_a', 'ch_b', 'former'),
    ptn('ch_b', 'ch_c', 'former'),
    ptn('ch_c', 'ch_d'),
  ],
};

/* ── 8. Degenerate inputs ────────────────────────────────────────────────── */
const singleton = {
  id: 'singleton',
  label: 'One person alone',
  note: 'Degenerate case — the planner must still produce a valid plan and camera.',
  focus: 's_only',
  people: [p('s_only', 'Ada Quill', { born: '1975', gender: 'female' })],
  relationships: [],
};

const disconnected = {
  id: 'disconnected',
  label: 'Two disconnected households',
  note: 'No path between the halves. The unreachable half must be parked, never allowed to drag the active family.',
  focus: 'y_a1',
  people: [
    p('y_a1', 'Mary Cole', { born: '1950', gender: 'female' }),
    p('y_a2', 'John Cole', { born: '1948', gender: 'male' }),
    p('y_a3', 'Ruth Cole', { born: '1975', gender: 'female' }),
    p('y_b1', 'Owen Frost', { born: '1952', gender: 'male' }),
    p('y_b2', 'Nina Frost', { born: '1954', gender: 'female' }),
    p('y_b3', 'Kit Frost', { born: '1979', gender: 'male' }),
  ],
  relationships: [
    ptn('y_a1', 'y_a2'), par('y_a1', 'y_a3'), par('y_a2', 'y_a3'),
    ptn('y_b1', 'y_b2'), par('y_b1', 'y_b3'), par('y_b2', 'y_b3'),
  ],
};

export const FIXTURES = [
  nuclear, remarried, threePod, wideSiblings, deepLineage, distantPull, partnerChain, disconnected, singleton,
];

export const fixtureById = (id) => FIXTURES.find((f) => f.id === id) ?? FIXTURES[0];
