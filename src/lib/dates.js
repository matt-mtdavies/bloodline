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
