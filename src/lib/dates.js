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
  const b = Number(yearOf(person.birth_date));
  if (!b) return null;
  if (person.is_deceased) {
    const d = Number(yearOf(person.death_date));
    return d ? `aged ${d - b}` : null;
  }
  return `${new Date().getFullYear() - b}`;
}
