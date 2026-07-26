/*
 * A registry of external genealogy/archive sources to link out to from a
 * profile — deliberately NOT another API integration (see the Trove work in
 * lib/trove.js for that pattern). This is the "research launcher" tier:
 * given what we already know about a person, surface the archives actually
 * relevant to them (by country) as deep links, and let the person do their
 * own reading on the source site. Nothing here ever fetches, stores, or
 * reuses data from these sites — zero ToS exposure, at the cost of not
 * being able to review/import a match automatically the way Trove's real
 * integration can.
 *
 * IMPORTANT, disclosed limitation: this environment's outbound network
 * policy blocks direct connections to every one of these sites (confirmed
 * via repeated 403s at the egress gateway across WebFetch AND a live
 * Playwright browser — not each site's own bot protection, an environment-
 * level restriction), so none of the query-parameter "prefill" behavior
 * below has been proven against a live page load. Each entry's `prefill`
 * field records the actual confidence:
 *   - true  + a `buildUrl`: a real, deliberately-shareable search URL
 *     pattern documented by the source itself (Trove) or corroborated by
 *     multiple independent real-world usage examples (Ancestry's
 *     long-standing sse.dll query params) — likely to work, not verified
 *     live this session.
 *   - false: no confirmed query-parameter contract exists (or the site is
 *     clearly a modern JS search app unlikely to read one at all) — these
 *     link to the source's own search/landing page, not a guessed-at
 *     prefilled URL. Still useful (one tap to the right place to search
 *     manually), just not "magic."
 * If real prefill support turns out to differ once someone actually loads
 * these from a normal browser, only `buildUrl`/`url` here needs updating —
 * everything else (country detection, grouping, the sheet UI) is unaffected.
 */

// `country: null` entries are NOT country-specific — they're either
// genuinely global (Ancestry, FindMyPast, MyHeritage, Find A Grave) or
// Commonwealth-wide rather than tied to one nation (CWGC covers Australian,
// Canadian, British, and other Commonwealth war dead alike) — shown
// alongside whichever country-specific groups matched, and shown ALONE
// (as the only thing to suggest) when no country could be inferred at all.
export const ARCHIVES = [
  // ── Australia ──────────────────────────────────────────────────────────
  {
    id: 'trove', label: 'Trove', country: 'AU', kind: 'newspapers',
    description: 'Historic Australian newspapers, gazettes & biographical records',
    prefill: true,
    buildUrl: ({ name }) => `https://trove.nla.gov.au/search/category/newspapers?keyword=${encodeURIComponent(name)}`,
  },
  {
    id: 'vic-bdm', label: 'Victoria BDM', country: 'AU', kind: 'civil-registration',
    description: 'Victorian births, deaths & marriages historical index',
    prefill: false, url: 'https://www.bdm.vic.gov.au/search-your-family-history',
  },
  {
    id: 'nsw-bdm', label: 'NSW BDM', country: 'AU', kind: 'civil-registration',
    description: 'NSW births, deaths & marriages historical index',
    prefill: false, url: 'https://familyhistory.bdm.nsw.gov.au/',
  },
  {
    id: 'qld-bdm', label: 'Queensland BDM', country: 'AU', kind: 'civil-registration',
    description: 'Queensland births, deaths & marriages historical index',
    prefill: false, url: 'https://www.familyhistory.bdm.qld.gov.au/',
  },
  {
    id: 'prov', label: 'Public Record Office Victoria', country: 'AU', kind: 'archive',
    description: 'Wills & probate, immigration, land records',
    prefill: false, url: 'https://prov.vic.gov.au/explore-collection',
  },
  {
    id: 'naa', label: 'National Archives of Australia', country: 'AU', kind: 'archive',
    description: 'Service records, immigration & naturalisation, government files',
    prefill: false, url: 'https://recordsearch.naa.gov.au/',
  },
  {
    id: 'awm', label: 'Australian War Memorial', country: 'AU', kind: 'military',
    description: 'Roll of Honour & wartime service records',
    prefill: false, url: 'https://www.awm.gov.au/people',
  },
  {
    id: 'dva-nominal-rolls', label: 'DVA Nominal Rolls', country: 'AU', kind: 'military',
    description: 'WWI & WWII Australian service nominal rolls',
    prefill: false, url: 'https://nominal-rolls.dva.gov.au/',
  },

  // ── United Kingdom ─────────────────────────────────────────────────────
  {
    id: 'uk-discovery', label: 'The National Archives (UK)', country: 'UK', kind: 'archive',
    description: 'Discovery catalogue — records held across UK archives',
    prefill: true,
    buildUrl: ({ name }) => `https://discovery.nationalarchives.gov.uk/results/r?_q=${encodeURIComponent(name)}`,
  },
  {
    id: 'freebmd', label: 'FreeBMD', country: 'UK', kind: 'civil-registration',
    description: 'Free England & Wales births, marriages & deaths index',
    prefill: false, url: 'https://www.freebmd.org.uk/cgi/search.pl',
  },
  {
    id: 'gro', label: 'GRO Index', country: 'UK', kind: 'civil-registration',
    description: 'Official England & Wales civil registration index',
    prefill: false, url: 'https://www.gro.gov.uk/gro/content/certificates/indexes_search.asp',
  },

  // ── Canada ─────────────────────────────────────────────────────────────
  {
    id: 'lac', label: 'Library and Archives Canada', country: 'CA', kind: 'archive',
    description: 'Immigration, census, service files & more',
    prefill: false, url: 'https://recherche-collection-search.bac-lac.gc.ca/eng/Home/Search',
  },
  {
    id: 'cvwm', label: 'Canadian Virtual War Memorial', country: 'CA', kind: 'military',
    description: 'Canadians who died in military service',
    prefill: false, url: 'https://www.veterans.gc.ca/eng/remembrance/memorials/canadian-virtual-war-memorial',
  },

  // ── Cross-cutting (Commonwealth-wide, not tied to one country) ────────
  {
    id: 'cwgc', label: 'Commonwealth War Graves Commission', country: null, kind: 'military',
    description: 'Commonwealth war dead — Australian, British, Canadian & more',
    prefill: false, url: 'https://www.cwgc.org/find-records/find-war-dead/',
  },

  // ── Global / commercial ────────────────────────────────────────────────
  {
    id: 'ancestry', label: 'Ancestry', country: null, kind: 'commercial',
    description: 'Broad genealogy records — subscription required for full access',
    prefill: true,
    buildUrl: ({ givenName, surname, birthYear }) => {
      const params = new URLSearchParams();
      if (givenName) params.set('gsfn', givenName);
      if (surname) params.set('gsln', surname);
      if (birthYear) params.set('msbdy', String(birthYear));
      return `https://search.ancestry.com/cgi-bin/sse.dll?${params.toString()}`;
    },
  },
  {
    id: 'findmypast', label: 'Findmypast', country: null, kind: 'commercial',
    description: 'UK-strong genealogy records — subscription required for full access',
    prefill: false, url: 'https://www.findmypast.com/search-world-records',
  },
  {
    id: 'myheritage', label: 'MyHeritage', country: null, kind: 'commercial',
    description: 'Broad genealogy records — subscription required for full access',
    prefill: false, url: 'https://www.myheritage.com/research',
  },
  {
    id: 'findagrave', label: 'Find A Grave', country: null, kind: 'memorial',
    description: 'Cemetery & memorial records worldwide',
    prefill: false, url: 'https://www.findagrave.com/memorial/search',
  },
];

// Order matters: a longer/more specific phrase is checked as its own
// pattern so a short, ambiguous word doesn't collide with it — "wales" is
// excluded from matching when it's actually part of "new south wales" via
// a negative lookbehind, rather than needing the two country's keyword
// lists to know about each other.
const COUNTRY_PATTERNS = {
  AU: [
    /\baustralia\b/i, /\bnew south wales\b/i, /\bnsw\b/i, /\bvictoria\b/i, /\bqueensland\b/i, /\bqld\b/i,
    /\btasmania\b/i, /\bwestern australia\b/i, /\bsouth australia\b/i, /\bnorthern territory\b/i, /\bact\b/i,
    /\bsydney\b/i, /\bmelbourne\b/i, /\bbrisbane\b/i, /\bperth\b/i, /\badelaide\b/i, /\bhobart\b/i,
    /\bcanberra\b/i, /\bdarwin\b/i,
  ],
  UK: [
    /\bunited kingdom\b/i, /\bengland\b/i, /\bscotland\b/i, /\bnorthern ireland\b/i,
    /\b(?<!new south )wales\b/i, /\buk\b/i, /\blondon\b/i, /\bcardiff\b/i, /\bmanchester\b/i, /\bglasgow\b/i,
    /\bedinburgh\b/i, /\bbirmingham\b/i, /\bliverpool\b/i, /\bbelfast\b/i, /\bbristol\b/i, /\bswansea\b/i,
    /\bmerthyr\b/i, /\baberdare\b/i,
  ],
  CA: [
    /\bcanada\b/i, /\bontario\b/i, /\bquebec\b/i, /\bbritish columbia\b/i, /\balberta\b/i, /\bmanitoba\b/i,
    /\bsaskatchewan\b/i, /\bnova scotia\b/i, /\bnew brunswick\b/i, /\bnewfoundland\b/i,
    /\bprince edward island\b/i, /\btoronto\b/i, /\bmontreal\b/i, /\bvancouver\b/i, /\bottawa\b/i,
    /\bcalgary\b/i, /\bwinnipeg\b/i, /\bhalifax\b/i,
  ],
};

// `military_nation` (see lib/military.js) is already a short, usually-clean
// country name rather than a place string to pattern-match the same way —
// matched directly against a small alias table instead of the regex lists
// above (which are tuned for messier "City, Region" free text).
const NATION_ALIASES = {
  AU: ['australia'],
  UK: ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'northern ireland', 'great britain'],
  CA: ['canada'],
};

function countriesInText(text, found) {
  if (!text) return;
  for (const [country, patterns] of Object.entries(COUNTRY_PATTERNS)) {
    if (patterns.some((re) => re.test(text))) found.add(country);
  }
}

/*
 * Infers which country/countries' archives are worth suggesting for a
 * person, from whatever place fields the tree already has. A person can
 * reasonably match more than one (an immigrant born in Wales who lived and
 * died in Australia gets both) — every match is kept, not just the "best"
 * one, since a family historian searching either country's records is
 * plausible. Returns an empty Set when nothing in the person's data
 * matches any known country, rather than guessing.
 */
export function detectCountries(person) {
  const found = new Set();
  if (!person) return found;
  countriesInText(person.birth_place, found);
  countriesInText(person.residence, found);
  countriesInText(person.death_place, found);
  const nation = person.military_nation?.toLowerCase().trim();
  if (nation) {
    for (const [country, aliases] of Object.entries(NATION_ALIASES)) {
      if (aliases.includes(nation)) found.add(country);
    }
  }
  return found;
}

/*
 * The archives worth showing for this person: every country-specific entry
 * whose country was detected, plus every cross-cutting (country: null)
 * entry unconditionally — those are relevant regardless of what we know
 * (or don't) about where the person is from, and they're also the only
 * thing shown when detectCountries() found nothing at all.
 */
export function getRelevantArchives(person) {
  const countries = detectCountries(person);
  return ARCHIVES.filter((a) => a.country === null || countries.has(a.country));
}

// Builds the actual URL to open for one archive, given whatever fields are
// available — archives without a real confirmed prefill contract just
// return their own search/landing page untouched (see this file's header
// comment on `prefill`/confidence).
export function buildArchiveUrl(archive, { name, givenName, surname, birthYear } = {}) {
  if (archive.prefill && archive.buildUrl) return archive.buildUrl({ name, givenName, surname, birthYear });
  return archive.url;
}
