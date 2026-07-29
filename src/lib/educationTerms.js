/*
 * Country-appropriate terminology for education stages — "Primary School"
 * in Australia is "Elementary School" in Canada, "TAFE" in Australia is
 * "Trade School" in Canada. Unlike kinTerms.js (a subjective per-viewer
 * preference), this is resolved PER-ENTRY from that entry's own geocoded
 * country (see lib/places.js's geocodePlace, same as Places Lived/Resting
 * Place) — the correct term is tied to where the schooling actually
 * happened, not the viewer's own preference, and one profile can hold
 * entries from several countries (e.g. an immigrant family).
 */

export const EDUCATION_STAGES = [
  { key: 'primary', label: 'Primary School' },
  { key: 'secondary', label: 'Secondary School' },
  { key: 'trade', label: 'Trade & Vocational' },
  { key: 'university', label: 'University' },
];

const GENERIC_PACK = {
  primary: 'Primary School',
  secondary: 'Secondary School',
  trade: 'Vocational School',
  university: 'University',
};

const COUNTRY_PACKS = {
  'united kingdom': { primary: 'Primary School', secondary: 'Secondary School', trade: 'Further Education College', university: 'University' },
  australia: { primary: 'Primary School', secondary: 'Secondary School', trade: 'TAFE', university: 'University' },
  canada: { primary: 'Elementary School', secondary: 'Secondary School', trade: 'Trade School', university: 'University' },
  'united states': { primary: 'Elementary School', secondary: 'High School', trade: 'Trade School', university: 'University' },
};

// Nominatim's address.country returns full English names (see
// functions/_lib/geocode.js) — these aliases normalize the handful of
// common variants a typed-and-not-geocoded location might also carry.
const COUNTRY_ALIASES = {
  uk: 'united kingdom',
  'united kingdom': 'united kingdom',
  'great britain': 'united kingdom',
  england: 'united kingdom',
  scotland: 'united kingdom',
  wales: 'united kingdom',
  'northern ireland': 'united kingdom',
  australia: 'australia',
  canada: 'canada',
  'united states': 'united states',
  'united states of america': 'united states',
  usa: 'united states',
  us: 'united states',
};

export function resolveStageLabel(stage, country) {
  const key = COUNTRY_ALIASES[(country || '').trim().toLowerCase()];
  const pack = (key && COUNTRY_PACKS[key]) || GENERIC_PACK;
  return pack[stage] || GENERIC_PACK[stage] || 'Education';
}
