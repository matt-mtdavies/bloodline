/*
 * The seeded demo family — ~23 people across four generations.
 *
 * It is deliberately *messy* in the way real families are: a divorce and a
 * remarriage, a step-child, an adopted child, widowed grandparents and two
 * deceased great-grandparents in a memorial state. Phase 1 has to render all
 * of this gracefully or it isn't done.
 *
 * Faces come from randomuser.me (CORS-friendly). A deliberate minority have no
 * photo so the generated monograms get shown off too.
 *
 * Shapes mirror the D1 schema in /migrations so the client and the API speak
 * the same language.
 */

// Portraits are served same-origin via the /faces proxy (functions/faces) so the
// WebGL bubble textures aren't tainted by cross-origin images. In `vite dev` the
// same path is proxied to randomuser.me (see vite.config.js).
const face = (g, n) => `/faces/${g}/${n}.jpg`;

export const FAMILY_NAME = 'My Family';

export const people = [
  // ── Generation 0 — great-grandparents (memorial) ───────────────────────────
  {
    id: 'william',
    display_name: 'William Mercer',
    given_names: 'William John',
    family_name: 'Mercer',
    birth_date: '1905',
    death_date: '1985',
    is_living: false,
    is_deceased: true,
    gender: 'male',
    birth_place: 'Aberdare, Wales',
    occupation: 'Colliery engineer',
    tags: ['Engineer', 'Chapel man', 'Prize gardener'],
    events: [
      { year: 1927, title: 'Married Florence' },
      { year: 1928, title: 'Became a father', detail: 'Arthur was born' },
    ],
    bio: 'A colliery engineer who kept a garden of prize leeks and never missed a chapel service. Remembered for his low, slow laugh.',
    photo: null,
    confidence: 'confirmed',
  },
  {
    id: 'florence',
    display_name: 'Florence Mercer',
    given_names: 'Florence May',
    family_name: 'Mercer',
    maiden_name: 'Pryce',
    birth_date: '1908',
    death_date: '1990',
    is_living: false,
    is_deceased: true,
    gender: 'female',
    birth_place: 'Merthyr Tydfil, Wales',
    bio: 'Ran the house and half the street. Her bara brith recipe is still argued over at every funeral and christening.',
    photo: null,
    confidence: 'confirmed',
  },

  // ── Generation 1 — grandparents ─────────────────────────────────────────────
  {
    id: 'arthur',
    display_name: 'Arthur Mercer',
    given_names: 'Arthur William',
    family_name: 'Mercer',
    birth_date: '1928',
    death_date: '2009',
    is_living: false,
    is_deceased: true,
    gender: 'male',
    birth_place: 'Cardiff, Wales',
    occupation: 'Railwayman',
    tags: ['Railwayman', 'Veteran', 'Grandfather'],
    events: [
      { year: 1946, title: 'National Service', detail: 'Royal Engineers' },
      { year: 1955, title: 'Joined British Railways' },
      { year: 1958, title: 'Became a father', detail: 'Robert was born' },
    ],
    bio: 'Left the valleys for the railways. Could name every station between Cardiff and Paddington from memory.',
    photo: face('men', 52),
    confidence: 'confirmed',
    conditions: [
      { id: 'c_arthur_1', name: 'Heart Disease', category: 'heart', status: 'active', onset_year: null },
      { id: 'c_arthur_2', name: 'High Blood Pressure', category: 'heart', status: 'active', onset_year: null },
    ],
  },
  {
    id: 'margaret',
    display_name: 'Margaret Mercer',
    given_names: 'Margaret Anne',
    family_name: 'Mercer',
    maiden_name: 'Hughes',
    birth_date: '1932',
    death_date: '2018',
    is_living: false,
    is_deceased: true,
    gender: 'female',
    birth_place: 'Swansea, Wales',
    occupation: 'Schoolteacher',
    tags: ['Teacher', 'Storykeeper', 'Grandmother'],
    events: [
      { year: 1953, title: 'Began teaching', detail: 'Cardiff' },
      { year: 1955, title: 'Married Arthur' },
      { year: 1993, title: 'Retired after 40 years' },
    ],
    bio: 'A schoolteacher for forty years. Strict, adored, and the keeper of the family stories until the very end.',
    photo: face('women', 65),
    confidence: 'confirmed',
  },
  {
    id: 'thomas',
    display_name: 'Thomas Bennett',
    given_names: 'Thomas Edward',
    family_name: 'Bennett',
    birth_date: '1935',
    death_date: '2011',
    is_living: false,
    is_deceased: true,
    gender: 'male',
    birth_place: 'Bristol, England',
    bio: 'A joiner with a workshop that smelled of pine and pipe smoke. Built the cot three of his grandchildren slept in.',
    photo: face('men', 76),
    confidence: 'confirmed',
  },
  {
    id: 'eleanor',
    display_name: 'Eleanor Bennett',
    given_names: 'Eleanor Rose',
    family_name: 'Bennett',
    maiden_name: 'Carter',
    birth_date: '1938',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'female',
    birth_place: 'Bath, England',
    residence: 'Bristol, England',
    occupation: 'Seamstress',
    tags: ['Matriarch', 'Crossword champion'],
    events: [
      { year: 1959, title: 'Married Thomas' },
      { year: 1960, title: 'Became a mother', detail: 'Linda was born' },
    ],
    bio: 'Ninety this spring and still does the crossword in pen. Holds court at every Sunday lunch.',
    photo: face('women', 33),
    confidence: 'confirmed',
    conditions: [
      { id: 'c_eleanor_1', name: 'Thyroid Disease', category: 'metabolic', status: 'resolved', onset_year: null },
      { id: 'c_eleanor_2', name: 'Rheumatoid Arthritis', category: 'chronic', status: 'active', onset_year: null },
    ],
  },

  // ── Generation 2 — parents / aunts / uncles ─────────────────────────────────
  {
    id: 'robert',
    display_name: 'Robert Mercer',
    given_names: 'Robert Arthur',
    family_name: 'Mercer',
    birth_date: '1958',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'male',
    birth_place: 'Cardiff, Wales',
    residence: 'Cardiff, Wales',
    occupation: 'Retired GP',
    tags: ['Doctor', 'Father', 'Allotment-keeper'],
    events: [
      { year: 1982, title: 'Qualified as a doctor' },
      { year: 1984, title: 'Married Linda' },
      { year: 1985, title: 'Became a father', detail: 'James was born' },
      { year: 2023, title: 'Retired' },
    ],
    bio: 'Recently retired GP. The one everyone phones first when something hurts.',
    photo: face('men', 32),
    confidence: 'confirmed',
    conditions: [
      { id: 'c_robert_1', name: 'High Blood Pressure', category: 'heart', status: 'active', onset_year: null },
      { id: 'c_robert_2', name: 'Type 2 Diabetes', category: 'metabolic', status: 'family_history', onset_year: null },
    ],
  },
  {
    id: 'linda',
    display_name: 'Linda Mercer',
    given_names: 'Linda Jane',
    family_name: 'Mercer',
    maiden_name: 'Bennett',
    birth_date: '1960',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'female',
    birth_place: 'Bristol, England',
    bio: 'Potter, gardener, and the unofficial family archivist of every photo box in the loft.',
    photo: face('women', 44),
    confidence: 'confirmed',
  },
  {
    id: 'susan',
    display_name: 'Susan Walker',
    given_names: 'Susan Margaret',
    family_name: 'Walker',
    maiden_name: 'Mercer',
    birth_date: '1962',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'female',
    birth_place: 'Cardiff, Wales',
    bio: 'Headteacher, like her mother before her. Emigrated to Bristol and never let anyone forget the move.',
    photo: face('women', 16),
    confidence: 'confirmed',
  },
  {
    id: 'david',
    display_name: 'David Walker',
    given_names: 'David Paul',
    family_name: 'Walker',
    birth_date: '1959',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'male',
    birth_place: 'Gloucester, England',
    bio: 'Civil engineer. Builds model railways in the garage and will tell you all about them.',
    photo: face('men', 41),
    confidence: 'confirmed',
  },

  // ── Generation 3 — the ego generation ───────────────────────────────────────
  {
    id: 'james',
    display_name: 'James Mercer',
    given_names: 'James Robert',
    family_name: 'Mercer',
    birth_date: '1985-04-12',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'male',
    birth_place: 'Cardiff, Wales',
    residence: 'Bristol, England',
    occupation: 'Architect',
    tags: ['Architect', 'Father', 'Kin-keeper'],
    events: [
      { year: 2007, title: 'Graduated', detail: 'Architecture, Cardiff University' },
      { year: 2012, title: 'Became a father', detail: 'Oliver was born' },
      { year: 2019, title: 'Married Megan' },
      { year: 2024, title: 'Started the family tree' },
    ],
    bio: 'Architect. Started building the family tree after his grandmother passed and the stories started slipping away.',
    photo: face('men', 11),
    confidence: 'confirmed',
  },
  {
    id: 'rachel',
    display_name: 'Rachel Carter',
    given_names: 'Rachel Louise',
    family_name: 'Carter',
    birth_date: '1986',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'female',
    birth_place: 'Reading, England',
    bio: "James's first wife and Oliver and Chloe's mum. Still very much family — co-parenting works.",
    photo: face('women', 9),
    confidence: 'confirmed',
  },
  {
    id: 'megan',
    display_name: 'Megan Mercer',
    given_names: 'Megan Elin',
    family_name: 'Mercer',
    maiden_name: 'Roberts',
    birth_date: '1987',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'female',
    birth_place: 'Caernarfon, Wales',
    bio: 'Midwife. Married James in 2019 and brought Noah into the fold.',
    photo: face('women', 68),
    confidence: 'confirmed',
  },
  {
    id: 'sarah',
    display_name: 'Sarah Thompson',
    given_names: 'Sarah Margaret',
    family_name: 'Thompson',
    maiden_name: 'Mercer',
    birth_date: '1988',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'female',
    birth_place: 'Cardiff, Wales',
    bio: 'Paediatric nurse. Adopted Ava in 2019 and talks about it as the best year of her life.',
    photo: face('women', 25),
    confidence: 'confirmed',
  },
  {
    id: 'mark',
    display_name: 'Mark Thompson',
    given_names: 'Mark Andrew',
    family_name: 'Thompson',
    birth_date: '1986',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'male',
    birth_place: 'Newport, Wales',
    bio: 'Secondary school music teacher. Plays in a covers band that is better than it has any right to be.',
    photo: face('men', 3),
    confidence: 'confirmed',
  },
  {
    id: 'tom',
    display_name: 'Tom Mercer',
    given_names: 'Thomas Arthur',
    family_name: 'Mercer',
    birth_date: '1990',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'male',
    birth_place: 'Cardiff, Wales',
    bio: 'The youngest. Travels constantly and is perpetually three time zones away from Sunday lunch.',
    photo: null,
    confidence: 'uncertain',
  },
  {
    id: 'emily',
    display_name: 'Emily Walker',
    given_names: 'Emily Claire',
    family_name: 'Walker',
    birth_date: '1990',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'female',
    birth_place: 'Bristol, England',
    bio: 'Cousin on the Walker side. Vet, dog person, runs marathons for fun.',
    photo: face('women', 52),
    confidence: 'confirmed',
  },
  {
    id: 'daniel',
    display_name: 'Daniel Walker',
    given_names: 'Daniel James',
    family_name: 'Walker',
    birth_date: '1992',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'male',
    birth_place: 'Bristol, England',
    bio: 'Cousin on the Walker side. Sound engineer, knows everyone, remembers every birthday.',
    photo: null,
    confidence: 'confirmed',
  },

  // ── Generation 4 — the children ─────────────────────────────────────────────
  {
    id: 'oliver',
    display_name: 'Oliver Mercer',
    given_names: 'Oliver James',
    family_name: 'Mercer',
    birth_date: '2012',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'male',
    birth_place: 'Cardiff, Wales',
    bio: 'Football, dinosaurs, and an alarming memory for facts about both.',
    photo: face('men', 20),
    is_minor: true,
    confidence: 'confirmed',
  },
  {
    id: 'chloe',
    display_name: 'Chloe Mercer',
    given_names: 'Chloe Rose',
    family_name: 'Mercer',
    birth_date: '2014',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'female',
    birth_place: 'Cardiff, Wales',
    bio: 'Draws horses on every available surface.',
    photo: face('women', 26),
    is_minor: true,
    confidence: 'confirmed',
  },
  {
    id: 'noah',
    display_name: 'Noah Mercer',
    given_names: 'Noah Elis',
    family_name: 'Mercer',
    birth_date: '2013',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'male',
    birth_place: 'Bangor, Wales',
    bio: "Megan's son, James's step-son — though nobody in the house bothers with the word 'step'.",
    photo: null,
    is_minor: true,
    confidence: 'confirmed',
  },
  {
    id: 'ava',
    display_name: 'Ava Thompson',
    given_names: 'Ava Grace',
    family_name: 'Thompson',
    birth_date: '2016',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'female',
    birth_place: 'Cardiff, Wales',
    bio: 'Adopted in 2019. Fearless on a balance bike.',
    photo: face('women', 89),
    is_minor: true,
    confidence: 'confirmed',
  },
  {
    id: 'liam',
    display_name: 'Liam Thompson',
    given_names: 'Liam Mark',
    family_name: 'Thompson',
    birth_date: '2018',
    death_date: null,
    is_living: true,
    is_deceased: false,
    gender: 'male',
    birth_place: 'Cardiff, Wales',
    bio: 'The baby of the family, for now.',
    photo: null,
    is_minor: true,
    confidence: 'confirmed',
  },
];

/*
 * Relationships — directional parent + partner edges only.
 * Siblings are DERIVED (shared parents), never stored. See data/graph.js.
 *   type: 'parent' | 'partner'
 *   qualifier: 'biological' | 'adopted' | 'step' | 'foster' | 'guardian'
 *   partner_status: 'current' | 'former' | 'widowed'
 */
export const relationships = [
  // parents → children (Gen 0 → 1)
  p('william', 'arthur'),
  p('florence', 'arthur'),

  // Gen 1 → 2
  p('arthur', 'robert'),
  p('margaret', 'robert'),
  p('arthur', 'susan'),
  p('margaret', 'susan'),
  p('thomas', 'linda'),
  p('eleanor', 'linda'),

  // Gen 2 → 3
  p('robert', 'james'),
  p('linda', 'james'),
  p('robert', 'sarah'),
  p('linda', 'sarah'),
  p('robert', 'tom'),
  p('linda', 'tom'),
  p('david', 'emily'),
  p('susan', 'emily'),
  p('david', 'daniel'),
  p('susan', 'daniel'),

  // Gen 3 → 4
  p('james', 'oliver'),
  p('rachel', 'oliver'),
  p('james', 'chloe'),
  p('rachel', 'chloe'),
  p('megan', 'noah'), // biological
  p('james', 'noah', 'step'), // step-parent
  p('sarah', 'ava', 'adopted'),
  p('mark', 'ava', 'adopted'),
  p('sarah', 'liam'),
  p('mark', 'liam'),

  // partnerships
  partner('william', 'florence', 'widowed', { marriage_date: '1927', marriage_place: 'Rochester, Kent' }),
  partner('arthur', 'margaret', 'widowed', { marriage_date: '1951-06-09', marriage_place: 'Maidstone' }),
  partner('thomas', 'eleanor', 'widowed', { marriage_date: '1957' }),
  partner('robert', 'linda', 'current', { marriage_date: '1983-04-16', marriage_place: 'Canterbury' }),
  partner('susan', 'david', 'current', { marriage_date: '1984' }),
  partner('james', 'rachel', 'former', { is_married: true }), // divorced
  partner('james', 'megan', 'current', { marriage_date: '2016-09-03', marriage_place: 'Whitstable' }), // remarried
  partner('sarah', 'mark', 'current', { marriage_date: '2011' }),
];

function p(from, to, qualifier = 'biological') {
  return {
    id: `r_${from}_${to}`,
    from_person: from,
    to_person: to,
    type: 'parent',
    qualifier,
    partner_status: null,
  };
}

function partner(a, b, status, meta = {}) {
  return {
    id: `r_${a}_${b}`,
    from_person: a,
    to_person: b,
    type: 'partner',
    qualifier: 'biological',
    partner_status: status,
    is_married: !!meta.is_married || !!meta.marriage_date || !!meta.marriage_place,
    marriage_date: meta.marriage_date ?? null,
    marriage_place: meta.marriage_place ?? null,
  };
}

/*
 * Memories — the heart of V2. Short, specific, human. Contributed by relatives,
 * upvoted so the most meaningful float to the top. Never AI-generated.
 *   { id, person_id, text, author, created_at, votes, youVoted }
 */
export const memories = [
  m('arthur', 'He could tell you the platform number for any train, anywhere, without once looking it up.', 'Robert', '2024-11-02', 6),
  m('arthur', 'Sunday walks to the allotment, every week, rain or shine — and always a mint humbug in his coat pocket.', 'Linda', '2024-11-10', 3),
  m('margaret', 'She marked everything in red pen. Our essays, the shopping list, even the birthday cards.', 'Susan', '2024-10-21', 5),
  m('margaret', 'Knew every family story by heart and told them the same way every Christmas, word for word.', 'James', '2024-12-26', 4),
  m('james', 'He turned the loft upside down for a week looking for Gran\'s photo box — then scanned every single picture so none of it could be lost again.', 'Sarah', '2025-01-15', 4),
  m('james', 'Always the one who actually phones on your birthday, not just a text.', 'Tom', '2025-02-03', 2),
  m('robert', 'I phoned him at 2am about Oliver\'s temperature. He talked us through it like it was nothing.', 'Megan', '2024-09-30', 4),
  m('william', 'Grew the biggest leeks in the valley and gave every one of them away.', 'Arthur', '2008-05-01', 2),
];

function m(person_id, text, author, created_at, votes) {
  return { id: `m_${person_id}_${Math.abs(hash(text))}`, person_id, text, author, created_at, votes, youVoted: false };
}

/*
 * Photos — a gallery per person. Stored as image sources (high-res URLs for the
 * demo; uploads become downscaled data URLs). Captions + dates are optional and
 * editable.
 *   { id, person_id, src, caption, date }
 */
const hires = (n) => `https://i.pravatar.cc/1000?img=${n}`;

export const photos = [
  ph('james', hires(11), 'On the steps of the new studio', '2021'),
  ph('james', hires(12), 'Best man at Tom\'s wedding', '2018'),
  ph('james', hires(13), 'Sunday lunch, the whole crowd', '2023'),
  ph('arthur', hires(51), 'In his guard\'s uniform', '1955'),
  ph('arthur', hires(52), 'At the allotment', '1998'),
  ph('margaret', hires(45), 'Her last day of teaching', '1993'),
  ph('robert', hires(31), 'Graduation', '1982'),
  ph('robert', hires(32), 'On call, somewhere in the Brecon Beacons', '2005'),
];

function ph(person_id, src, caption, date) {
  return { id: `ph_${person_id}_${Math.abs(hash(src + caption))}`, person_id, src, caption, date };
}
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// The person the demo opens on — our kin-keeper, James.
export const DEFAULT_FOCUS = 'james';

// Demo activity feed — represents the history of building this tree.
// Timestamps are computed at import time so the demo always feels recent.
const hAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
const dAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

export const seedActivity = [
  { id: 'sa_001', type: 'memory_added', personId: 'arthur', personName: 'Arthur Mercer', authorName: 'Auntie Joan',
    detail: 'He had the loudest laugh in any room. You always knew when Dad had arrived.', created_at: hAgo(2) },
  { id: 'sa_002', type: 'photo_added', personId: 'margaret', personName: 'Margaret Mercer', authorName: 'You',
    detail: null, created_at: hAgo(7) },
  { id: 'sa_003', type: 'person_updated', personId: 'robert', personName: 'Robert Mercer', authorName: 'You',
    detail: 'biography', created_at: dAgo(1) },
  { id: 'sa_004', type: 'memory_added', personId: 'margaret', personName: 'Margaret Mercer', authorName: 'Rachel Carter',
    detail: 'Gran always had a tin of shortbread on the kitchen windowsill. It was never empty, no matter when you turned up.', created_at: dAgo(2) },
  { id: 'sa_005', type: 'portrait_updated', personId: 'florence', personName: 'Florence Mercer', authorName: 'You',
    detail: null, created_at: dAgo(4) },
  { id: 'sa_006', type: 'person_added', personId: 'megan', personName: 'Megan Mercer', authorName: 'You',
    detail: null, created_at: dAgo(6) },
  { id: 'sa_007', type: 'document_added', personId: 'arthur', personName: 'Arthur Mercer', authorName: 'You',
    detail: 'Military Service Record', created_at: dAgo(9) },
  { id: 'sa_008', type: 'relationship_added', personId: 'robert', personName: 'Robert Mercer', authorName: 'You',
    detail: 'Linda Mercer', created_at: dAgo(12) },
  { id: 'sa_009', type: 'person_added', personId: 'linda', personName: 'Linda Mercer', authorName: 'You',
    detail: null, created_at: dAgo(13) },
  { id: 'sa_010', type: 'memory_added', personId: 'william', personName: 'William Mercer', authorName: 'You',
    detail: 'Grandad kept a garden of prize leeks and never missed a chapel service. Three times county show winner.', created_at: dAgo(18) },
  { id: 'sa_011', type: 'person_added', personId: 'william', personName: 'William Mercer', authorName: 'You',
    detail: null, created_at: dAgo(21) },
];
