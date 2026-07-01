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
    return [b, d].filter(Boolean).join(' – ') || 'Dates unknown';
  }
  return b ? `b. ${b}` : 'Dates unknown';
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
    const dparts = person.death_date.split('-').map(Number);
    const dy = dparts[0];
    if (!dy) return null;
    const dm = dparts[1];
    const dd = dparts[2];
    let age = dy - y;
    // Only adjust for the birthday-not-yet-reached case when both dates carry
    // a month — otherwise dy - y is the best estimate we can make.
    if (m && dm) {
      const hadBirthday = dm > m || (dm === m && (!d || !dd || dd >= d));
      if (!hadBirthday) age -= 1;
    }
    return `aged ${age}`;
  }
  const now = new Date();
  if (m && d) {
    const hadBirthday = now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
    return String(now.getFullYear() - y - (hadBirthday ? 0 : 1));
  }
  return String(now.getFullYear() - y);
}
