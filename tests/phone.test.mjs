import assert from 'node:assert/strict';
import { toE164, splitE164, formatPhone, isPhoneValid, guessCountryFromResidence, countryByIso2, PHONE_COUNTRIES } from '../src/lib/phone.js';

let failures = 0;
const t = (label, fn) => { try { fn(); console.log('PASS ', label); } catch (e) { failures++; console.log('FAIL ', label, '—', e.message); } };

t('AU mobile typed with trunk 0 converts correctly (the reported bug)', () => {
  assert.equal(toE164('0417384533', countryByIso2('AU')), '+61417384533');
});
t('AU mobile typed WITHOUT trunk 0 also converts correctly', () => {
  assert.equal(toE164('417384533', countryByIso2('AU')), '+61417384533');
});
t('US number (no trunk convention) converts as-is', () => {
  assert.equal(toE164('4389792323', countryByIso2('US')), '+14389792323');
});
t('UK landline with trunk 0 converts correctly', () => {
  assert.equal(toE164('02079460958', countryByIso2('GB')), '+442079460958');
});

t('splitE164 parses a correct AU E.164 back into country + digits', () => {
  const r = splitE164('+61417384533');
  assert.equal(r.country.iso2, 'AU');
  assert.equal(r.digits, '417384533');
});
t('splitE164 rejects the historical bug output ("+0..." is not a real country code)', () => {
  assert.equal(splitE164('+0417384533'), null);
});
t('splitE164 rejects empty/garbage', () => {
  assert.equal(splitE164(''), null);
  assert.equal(splitE164('not a phone'), null);
});

t('isPhoneValid flags the legacy bug output so it can be surfaced for fixing', () => {
  assert.equal(isPhoneValid('+0417384533'), false);
  assert.equal(isPhoneValid('+61417384533'), true);
});

t('formatPhone drops the domestic trunk 0 for AU mobiles (the reported bug)', () => {
  assert.equal(formatPhone('+61417384533'), '+61 417 384 533');
});
t('formatPhone groups an AU mobile 4-3-3, not 1-3-3-2', () => {
  assert.equal(countryByIso2('AU').formatNational('417384533'), '0417 384 533');
});
t('formatPhone drops the trunk 0 for other trunk-prefix countries too (GB)', () => {
  assert.equal(formatPhone('+442079460958'), '+44 2079 460958');
});
t('formatPhone leaves non-trunk countries alone (US area code never starts with 0)', () => {
  assert.equal(formatPhone('+14389792323'), '+1 (438) 979-2323');
});
t('formatPhone falls back to the raw string for an unrecognised value (never invents a country)', () => {
  assert.equal(formatPhone('+0417384533'), '+0417384533');
});

t('guessCountryFromResidence matches common aliases', () => {
  assert.equal(guessCountryFromResidence('Perth, Australia')?.iso2, 'AU');
  assert.equal(guessCountryFromResidence('Bristol, England')?.iso2, 'GB');
  assert.equal(guessCountryFromResidence('Toronto, Canada')?.iso2, 'CA');
  assert.equal(guessCountryFromResidence('Nowhere, Atlantis'), null);
  assert.equal(guessCountryFromResidence(''), null);
});

t('every country entry round-trips its own placeholder-shaped number', () => {
  // Sanity check the whole table at once: format a plausible national
  // number for each country, convert to E.164, and confirm splitE164 can
  // parse it straight back to a country sharing the same dial code. (US/CA
  // share NANP's "1" and are genuinely indistinguishable from digits alone —
  // that's a real-world phone-numbering-plan fact, not a bug — so we only
  // assert the dial code round-trips, not the exact iso2 for that pair.)
  for (const c of PHONE_COUNTRIES) {
    const digits = '5'.repeat(c.nationalLen); // any digit string of the right length
    const e164 = toE164(digits, c);
    const back = splitE164(e164);
    assert.ok(back, `${c.iso2}: ${e164} failed to parse back`);
    assert.equal(back.country.dial, c.dial, `${c.iso2}: parsed back with dial code ${back.country.dial}`);
  }
});

process.exit(failures ? 1 : 0);
