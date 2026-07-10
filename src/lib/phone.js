/*
 * Country-aware phone handling — no third-party library, covers the most
 * common country codes.
 *
 * The core problem this exists to solve: someone types a phone number the
 * way they'd actually dial it at home ("0417 384 533" in Australia), not
 * the way it needs to be STORED (E.164: "+61417384533", country code first,
 * no trunk prefix). A single free-text field can't tell "0" apart from a
 * real country code, so it used to just prepend "+" to whatever was typed —
 * "+0417384533", which is not a phone number anyone can dial. PhoneField.jsx
 * is the UI half (a country selector + a national-format input); this
 * module is the data + conversion half both it and read-only display share.
 *
 * PHONE_COUNTRIES[i] = {
 *   iso2, name, flag, dial (calling code, no +),
 *   nationalLen (significant local digits, i.e. E.164 length minus the
 *     dial code — NOT counting a domestic trunk "0"),
 *   formatNational(digits) — pretty-print the significant digits the way
 *     this country writes its own domestic number (WITH a leading 0 where
 *     that's the standard local convention),
 *   placeholder — example shown in the input.
 * }
 */
export const PHONE_COUNTRIES = [
  { iso2: 'AU', name: 'Australia', flag: '🇦🇺', dial: '61', nationalLen: 9,
    placeholder: '04XX XXX XXX',
    // Mobile groups as 4-3-3 ("0433 707 747"); landline as area-code digit +
    // 4 + 4 ("02 1234 5678"). The mobile branch used to split 1-3-3-2
    // instead of 3-3-3 after the leading 0, e.g. "04 337 077 47" for the
    // same number — wrong grouping, not just a display nit.
    formatNational: (d) => d[0] === '4'
      ? `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`
      : `0${d[0]} ${d.slice(1, 5)} ${d.slice(5)}` },
  { iso2: 'US', name: 'United States', flag: '🇺🇸', dial: '1', nationalLen: 10,
    placeholder: '(XXX) XXX-XXXX',
    formatNational: (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` },
  { iso2: 'CA', name: 'Canada', flag: '🇨🇦', dial: '1', nationalLen: 10,
    placeholder: '(XXX) XXX-XXXX',
    formatNational: (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` },
  { iso2: 'GB', name: 'United Kingdom', flag: '🇬🇧', dial: '44', nationalLen: 10,
    placeholder: '0XXXX XXXXXX',
    formatNational: (d) => `0${d.slice(0, 4)} ${d.slice(4)}` },
  { iso2: 'NZ', name: 'New Zealand', flag: '🇳🇿', dial: '64', nationalLen: 9,
    placeholder: '0X XXX XXXX',
    formatNational: (d) => `0${d[0]} ${d.slice(1, 4)} ${d.slice(4)}` },
  { iso2: 'IE', name: 'Ireland', flag: '🇮🇪', dial: '353', nationalLen: 9,
    placeholder: '0XX XXX XXXX',
    formatNational: (d) => `0${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}` },
  { iso2: 'FR', name: 'France', flag: '🇫🇷', dial: '33', nationalLen: 9,
    placeholder: '0X XX XX XX XX',
    formatNational: (d) => `0${d[0]} ${d.slice(1, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7)}` },
  { iso2: 'DE', name: 'Germany', flag: '🇩🇪', dial: '49', nationalLen: 10,
    placeholder: '0XXX XXXX XXXX',
    formatNational: (d) => `0${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}` },
  { iso2: 'ZA', name: 'South Africa', flag: '🇿🇦', dial: '27', nationalLen: 9,
    placeholder: '0XX XXX XXXX',
    formatNational: (d) => `0${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}` },
  { iso2: 'JP', name: 'Japan', flag: '🇯🇵', dial: '81', nationalLen: 10,
    placeholder: '0XX-XXXX-XXXX',
    formatNational: (d) => `0${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}` },
  { iso2: 'IN', name: 'India', flag: '🇮🇳', dial: '91', nationalLen: 10,
    placeholder: 'XXXXX XXXXX',
    formatNational: (d) => `${d.slice(0, 5)} ${d.slice(5)}` },
  { iso2: 'CN', name: 'China', flag: '🇨🇳', dial: '86', nationalLen: 11,
    placeholder: 'XXX XXXX XXXX',
    formatNational: (d) => `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}` },
  { iso2: 'SG', name: 'Singapore', flag: '🇸🇬', dial: '65', nationalLen: 8,
    placeholder: 'XXXX XXXX',
    formatNational: (d) => `${d.slice(0, 4)} ${d.slice(4)}` },
  { iso2: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', dial: '971', nationalLen: 9,
    placeholder: '0 5X XXX XXXX',
    formatNational: (d) => `0${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}` },
  { iso2: 'BR', name: 'Brazil', flag: '🇧🇷', dial: '55', nationalLen: 11,
    placeholder: '(XX) XXXXX-XXXX',
    formatNational: (d) => `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` },
];

const BY_ISO2 = new Map(PHONE_COUNTRIES.map((c) => [c.iso2, c]));
// Longest dial code first, so +353 (Ireland) matches before a shorter +1/+61
// prefix could accidentally swallow part of it.
const BY_DIAL_DESC = PHONE_COUNTRIES.slice().sort((a, b) => b.dial.length - a.dial.length);

export function countryByIso2(iso2) {
  return BY_ISO2.get(iso2) || PHONE_COUNTRIES[0];
}

// A typed national number almost always carries the local trunk prefix
// (Australia/UK/NZ/Ireland/France/Germany/South Africa/Japan/UAE all dial
// domestically with a leading 0 that is NOT part of the number in E.164).
// Rather than track which countries use a trunk digit as a per-country
// flag, one length check covers all of them at once: if what's typed is
// exactly one digit longer than the country's real significant length AND
// that extra digit is a leading 0, it's the trunk prefix — drop it.
// Matches the exact count with no stripping for a country with no trunk
// convention (US/Canada's NANP never has one).
export function significantDigits(rawDigits, country) {
  if (rawDigits.length === country.nationalLen + 1 && rawDigits[0] === '0') {
    return rawDigits.slice(1);
  }
  return rawDigits;
}

// national (as typed, any punctuation) + a chosen country → E.164 for
// storage. Returns '' for empty input.
export function toE164(national, country) {
  const digits = String(national || '').replace(/\D/g, '');
  if (!digits) return '';
  return `+${country.dial}${significantDigits(digits, country)}`;
}

// The reverse: an existing stored value → { country, digits } if it matches
// a known country's dial code and expected length exactly, else null. A
// malformed legacy value (someone's national number got the bug's bare "+"
// treatment, e.g. "+0417384533" — no real country code starts with 0) never
// matches anything here, which is exactly the signal PhoneField uses to
// know a value needs re-confirming rather than trusting it as-is.
export function splitE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  for (const country of BY_DIAL_DESC) {
    if (digits.startsWith(country.dial) && digits.length === country.dial.length + country.nationalLen) {
      return { country, digits: digits.slice(country.dial.length) };
    }
  }
  return null;
}

// True only for a value that will actually dial — used to flag legacy
// numbers (stored before country-aware input existed) that need a look.
export function isPhoneValid(raw) {
  return !!splitE164(raw);
}

// A light heuristic default when a stored number can't be parsed and there's
// no last-used country yet: match the free-text residence field against a
// handful of common country names/aliases. Best-effort only — this narrows
// "which of 14 countries" down for someone re-confirming a number, it
// doesn't (and can't) silently fix anything on its own.
const RESIDENCE_HINTS = [
  [/\bAustralia\b/i, 'AU'],
  [/\bNew Zealand\b/i, 'NZ'],
  [/\b(England|Scotland|Wales|Northern Ireland|United Kingdom|\bUK\b)\b/i, 'GB'],
  [/\bIreland\b/i, 'IE'],
  [/\b(United States|USA|\bUS\b)\b/i, 'US'],
  [/\bCanada\b/i, 'CA'],
  [/\bGermany\b/i, 'DE'],
  [/\bFrance\b/i, 'FR'],
  [/\bSouth Africa\b/i, 'ZA'],
  [/\bJapan\b/i, 'JP'],
  [/\bIndia\b/i, 'IN'],
  [/\bChina\b/i, 'CN'],
  [/\bSingapore\b/i, 'SG'],
  [/\b(United Arab Emirates|\bUAE\b)\b/i, 'AE'],
  [/\bBrazil\b/i, 'BR'],
];
export function guessCountryFromResidence(residence) {
  if (!residence) return null;
  for (const [re, iso2] of RESIDENCE_HINTS) if (re.test(residence)) return countryByIso2(iso2);
  return null;
}

/*
 * Format a phone string for display, detecting the country code. Accepts
 * E.164 or an already-formatted string. Falls back to showing the raw
 * value unchanged when it doesn't match a known country (rather than
 * guessing) — that's the read-only path's job (PhoneField.jsx handles the
 * editable, re-confirm-the-country path).
 */
export function formatPhone(raw) {
  if (!raw) return '';
  const parsed = splitE164(raw);
  if (!parsed) return raw;
  const national = parsed.country.formatNational(parsed.digits);
  // formatNational renders the DOMESTIC form, which for most countries here
  // hardcodes the local trunk "0" (see the module doc comment above). That
  // "0" is not part of the number once the +dial country code is already
  // shown — "+61 0433 707 747" isn't dialable — so it's dropped here, not in
  // formatNational itself, which PhoneField.jsx still needs for domestic
  // display. Only ever strips a literal leading "0" character; a country
  // with no trunk convention (US/CA/IN/CN/SG/BR) never starts its formatted
  // string with one, so this never touches a real area-code digit.
  const significant = national[0] === '0' ? national.slice(1).trimStart() : national;
  return `+${parsed.country.dial} ${significant}`;
}
