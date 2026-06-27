/*
 * Lightweight country-aware phone formatter.
 * No third-party library — covers the most common country codes.
 *
 * toE164(raw)      → "+14389792323"   (canonical, for storage)
 * formatPhone(raw) → "+1 (438) 979-2323"  (pretty, for display)
 */

// Country code → { digits: expected local digit count, fmt: format fn }
// fmt receives the local digit string (after stripping the country code).
// If the local string is shorter (still being typed), we fall back to
// "+CC localDigits" so formatting is always progressive.
const FORMATS = [
  // US/Canada: +1 (xxx) xxx-xxxx
  { cc: '1', len: 10,
    fmt: (d) => `+1 (${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}` },

  // Australia: mobile +61 4xx xxx xxx, landline +61 (x) xxxx xxxx
  { cc: '61', len: 9,
    fmt: (d) => d[0] === '4'
      ? `+61 ${d[0]} ${d.slice(1,4)} ${d.slice(4,7)} ${d.slice(7)}`
      : `+61 (${d[0]}) ${d.slice(1,5)} ${d.slice(5)}` },

  // UK: +44 xxxx xxxxxx
  { cc: '44', len: 10,
    fmt: (d) => `+44 ${d.slice(0,4)} ${d.slice(4)}` },

  // New Zealand: +64 x xxx xxxx
  { cc: '64', len: 9,
    fmt: (d) => `+64 ${d[0]} ${d.slice(1,4)} ${d.slice(4)}` },

  // Ireland: +353 xx xxx xxxx
  { cc: '353', len: 9,
    fmt: (d) => `+353 ${d.slice(0,2)} ${d.slice(2,5)} ${d.slice(5)}` },

  // France: +33 x xx xx xx xx
  { cc: '33', len: 9,
    fmt: (d) => `+33 ${d[0]} ${d.slice(1,3)} ${d.slice(3,5)} ${d.slice(5,7)} ${d.slice(7)}` },

  // Germany: +49 xxx xxxx xxxx (mobile-ish)
  { cc: '49', len: 10,
    fmt: (d) => `+49 ${d.slice(0,3)} ${d.slice(3,7)} ${d.slice(7)}` },

  // India: +91 xxxxx xxxxx
  { cc: '91', len: 10,
    fmt: (d) => `+91 ${d.slice(0,5)} ${d.slice(5)}` },

  // China: +86 xxx xxxx xxxx
  { cc: '86', len: 11,
    fmt: (d) => `+86 ${d.slice(0,3)} ${d.slice(3,7)} ${d.slice(7)}` },

  // Japan: +81 xx-xxxx-xxxx
  { cc: '81', len: 10,
    fmt: (d) => `+81 ${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6)}` },

  // South Africa: +27 xx xxx xxxx
  { cc: '27', len: 9,
    fmt: (d) => `+27 ${d.slice(0,2)} ${d.slice(2,5)} ${d.slice(5)}` },

  // Brazil: +55 (xx) xxxxx-xxxx
  { cc: '55', len: 11,
    fmt: (d) => `+55 (${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}` },

  // Singapore: +65 xxxx xxxx
  { cc: '65', len: 8,
    fmt: (d) => `+65 ${d.slice(0,4)} ${d.slice(4)}` },

  // UAE: +971 5x xxx xxxx
  { cc: '971', len: 9,
    fmt: (d) => `+971 ${d[0]} ${d.slice(1,4)} ${d.slice(4,7)} ${d.slice(7)}` },
];

// Build prefix lookup sorted longest-first so +353 matches before +35, +1, etc.
const LOOKUP = FORMATS.slice().sort((a, b) => b.cc.length - a.cc.length);

/*
 * Strip a raw phone string to E.164 digits + leading +.
 * "+1 (438) 979-2323" → "+14389792323"
 */
export function toE164(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

/*
 * Format a phone string for display, detecting the country code.
 * Accepts E.164, already-formatted, or partial strings.
 * Returns the original string unchanged if the country isn't recognised.
 */
export function formatPhone(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;

  const entry = LOOKUP.find((f) => digits.startsWith(f.cc));
  if (!entry) return raw; // unknown country — show as-is

  const local = digits.slice(entry.cc.length);
  if (local.length === entry.len) {
    // Complete number — apply full format
    return entry.fmt(local);
  }
  // Partial — show +CC then whatever digits we have so far
  return `+${entry.cc} ${local}`;
}
