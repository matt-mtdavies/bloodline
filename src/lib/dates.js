// Partial dates are first-class: 'year-only' and 'YYYY-MM-DD' both render warmly.
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-');
  if (m && d) return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
  if (m) return `${MONTHS[Number(m) - 1]} ${y}`;
  return y;
}

export function yearOf(value) {
  return value ? value.split('-')[0] : null;
}

export function lifespan(person) {
  const b = yearOf(person.birth_date);
  if (person.is_deceased) {
    const d = yearOf(person.death_date);
    // A real range needs no prefix (the dash already reads as "born – died").
    // Either end alone is ambiguous without one — "1912" alone doesn't say
    // whether that's a birth or a death, so it gets the same b./d. treatment
    // a living person's birth-only year already has.
    if (b && d) return `${b} – ${d}`;
    if (b) return `b. ${b}`;
    if (d) return `d. ${d}`;
    return 'Dates unknown';
  }
  return b ? `b. ${b}` : 'Dates unknown';
}

// Whole years elapsed from one 'YYYY[-MM[-DD]]' date to another — the one
// "has the birthday happened yet" rule every age display in the app shares,
// so a lifespan computed elsewhere (insights' record books, cohort
// averages) can never drift from what a person's own profile shows for the
// exact same two dates. Year-only inputs fall back to plain year
// subtraction, the best estimate available without a month to compare.
export function yearsBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const [fy, fm, fd] = String(fromDate).split('-').map(Number);
  const [ty, tm, td] = String(toDate).split('-').map(Number);
  if (!fy || !ty) return null;
  let years = ty - fy;
  if (fm && tm) {
    const hadAnniversary = tm > fm || (tm === fm && (!fd || !td || td >= fd));
    if (!hadAnniversary) years -= 1;
  }
  return years;
}

// A quick "how far back does this reach" stat for a batch of people — the
// oldest recorded birth year through to the present (or the most recent
// death year, if everyone in the batch is already deceased). Built for the
// GEDCOM/FamilySearch import landing moment (real feedback: "instead of
// dropping them into a tree, gently introduce them... we've found 486
// people connected across 212 years of family history"), but deliberately
// generic — any array of person-shaped objects with birth_date/death_date/
// is_deceased works. Returns null when nobody in the batch has a usable
// birth year at all, so the caller can omit the line rather than invent one.
export function familySpan(people, now = new Date()) {
  const birthYears = (people || [])
    .map((p) => Number(yearOf(p.birth_date)))
    .filter((y) => Number.isFinite(y) && y > 0);
  if (!birthYears.length) return null;
  const earliestYear = Math.min(...birthYears);
  const hasLiving = people.some((p) => !p.is_deceased);
  const deathYears = people
    .map((p) => Number(yearOf(p.death_date)))
    .filter((y) => Number.isFinite(y) && y > 0);
  const latestYear = hasLiving ? now.getFullYear() : (deathYears.length ? Math.max(...deathYears) : earliestYear);
  return { earliestYear, latestYear, spanYears: Math.max(0, latestYear - earliestYear) };
}

// A warmer, prose reading of a person's dates — for the profile hero
// specifically. Deliberately NOT a replacement for lifespan()/ageOrAt():
// those stay in their existing terse "1905 – 1985"/"aged 65" form for every
// space-constrained context that already relies on it (nameplates, hover
// cards, list rows, insights) — a floating nameplate over a small bubble
// has no room for "Born 1905 · Lived 65 years". Real design feedback:
// database-shaped facts ("b. 1934", "Age: 65") read cold; a sentence reads
// like a person. Returns an ordered array of phrases (never a joined
// string) so the caller controls its own separator; omits a phrase rather
// than guessing when the underlying date is unknown, same "silence over
// invention" rule every date-derived feature in this app already follows.
export function humanLifeSummary(person) {
  const b = yearOf(person.birth_date);
  const parts = [];
  if (person.is_deceased) {
    const d = yearOf(person.death_date);
    if (b) parts.push(`Born ${b}`);
    if (d) parts.push(`Passed away ${d}`);
    if (!b && !d) parts.push('Dates unknown');
    const yrs = yearsBetween(person.birth_date, person.death_date);
    if (yrs != null) parts.push(yrs === 0 ? 'Lived less than a year' : `Lived ${yrs} year${yrs === 1 ? '' : 's'}`);
  } else if (b) {
    parts.push(`Born ${b}`);
    const age = ageOrAt(person); // bare number for a living person
    if (age) parts.push(`${age} year${age === '1' ? '' : 's'} old`);
  } else {
    parts.push('Dates unknown');
  }
  return parts;
}

export function ageOrAt(person) {
  if (!person.birth_date) return null;
  const parts = person.birth_date.split('-').map(Number);
  const y = parts[0];
  if (!y) return null;
  const m = parts[1];
  const d = parts[2];
  if (person.is_deceased) {
    if (!person.death_date) return null;
    const age = yearsBetween(person.birth_date, person.death_date);
    if (age == null) return null;
    return `aged ${age}`;
  }
  const now = new Date();
  if (m && d) {
    const hadBirthday = now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
    return String(now.getFullYear() - y - (hadBirthday ? 0 : 1));
  }
  return String(now.getFullYear() - y);
}
