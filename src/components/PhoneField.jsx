import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PHONE_COUNTRIES, countryByIso2, splitE164, guessCountryFromResidence, toE164, significantDigits } from '../lib/phone.js';

const LAST_COUNTRY_KEY = 'bloodline:lastPhoneCountry';

function initialCountry(value, residence) {
  const parsed = splitE164(value);
  if (parsed) return parsed.country;
  const guessed = guessCountryFromResidence(residence);
  if (guessed) return guessed;
  try {
    const last = localStorage.getItem(LAST_COUNTRY_KEY);
    if (last) return countryByIso2(last);
  } catch { /* ignore */ }
  return PHONE_COUNTRIES[0];
}

// A stored value that DOESN'T parse against the chosen country (the
// "+0417384533" bug, or simply a number from a different country than our
// best guess) still deserves to show its digits rather than an empty box —
// glance-and-confirm-the-country beats "field looks empty, where did my
// number go."
function initialNational(value, country) {
  const parsed = splitE164(value);
  if (parsed && parsed.country.iso2 === country.iso2) return parsed.country.formatNational(parsed.digits);
  return value ? String(value).replace(/\D/g, '') : '';
}

/*
 * Country selector + national-format input, replacing a single free-text
 * "type it with the country code already" field. Someone in Australia
 * types their mobile the way they'd actually dial it — "0417 384 533" — and
 * this converts it to the correct E.164 for storage (+61417384533) rather
 * than literally prepending "+" to whatever was typed. See lib/phone.js for
 * the country table and the conversion rule.
 */
const MENU_W = 240;
const MENU_MARGIN = 10;

export default function PhoneField({ value, residence, onChange }) {
  const [country, setCountry] = useState(() => initialCountry(value, residence));
  const [national, setNational] = useState(() => initialNational(value, country));
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null); // { left, top } in viewport px
  const wrapRef = useRef(null);
  const countryBtnRef = useRef(null);
  const menuRef = useRef(null);
  const didMount = useRef(false);

  useEffect(() => {
    // Skip the mount-time fire — value is already this exact E.164 (or
    // already-empty), and reporting it back up would just churn the
    // parent's state with no change.
    if (!didMount.current) { didMount.current = true; return; }
    onChange(toE164(national, country));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, national]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return; // portaled outside wrapRef — see below
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    // Editing sheets scroll their own inner content rather than the window,
    // so a plain scroll listener needs capture:true to see it. A floating
    // menu with a stale position is worse than one that just closes.
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Positioned via getBoundingClientRect + portaled to document.body as
  // position:fixed, rather than CSS position:absolute inside the form.
  // An editing sheet's own entrance-animation transform lingers as its
  // applied style after the animation ends (fill-mode "both") — and a
  // transformed ancestor doesn't just redefine position:absolute's
  // containing block, it hijacks position:fixed too, so simply switching
  // to fixed while staying inside the sheet's DOM subtree still rendered
  // off in the wrong spot (observed on iOS Safari: menu flush against the
  // screen's left edge instead of under the button). Only escaping that
  // subtree entirely — a portal straight to <body> — actually gets fixed
  // positioning relative to the real viewport.
  const toggleOpen = () => {
    if (open) { setOpen(false); return; }
    const r = countryBtnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.min(Math.max(r.left, MENU_MARGIN), window.innerWidth - MENU_W - MENU_MARGIN);
      setMenuPos({ left, top: r.bottom + 6 });
    }
    setOpen(true);
  };

  const chooseCountry = (c) => {
    setCountry(c);
    try { localStorage.setItem(LAST_COUNTRY_KEY, c.iso2); } catch { /* ignore */ }
    // Deferred: closing synchronously here unmounts this button mid-click,
    // and some browsers then retarget the still-in-flight click event to
    // whatever element ends up under the pointer once it's gone (observed:
    // a phantom click landing on the country toggle button, instantly
    // reopening the menu). Waiting a tick lets the click finish first.
    setTimeout(() => setOpen(false), 0);
  };

  const blurFormat = () => {
    const digits = national.replace(/\D/g, '');
    if (digits) setNational(country.formatNational(significantDigits(digits, country)));
  };

  return (
    <div className="phone-field" ref={wrapRef}>
      <div className="phone-field__row">
        <button
          ref={countryBtnRef}
          type="button"
          className="phone-field__country"
          onClick={toggleOpen}
          aria-label={`Country code, currently ${country.name} +${country.dial}`}
          aria-expanded={open}
        >
          <span className="phone-field__flag">{country.flag}</span>
          <span className="phone-field__dial">+{country.dial}</span>
          <ChevronIcon />
        </button>
        <div className="input-wrap phone-field__input-wrap">
          <input
            className="field__input"
            type="tel"
            inputMode="tel"
            value={national}
            placeholder={country.placeholder}
            onChange={(e) => setNational(e.target.value.replace(/[^\d\s\-().]/g, ''))}
            onBlur={blurFormat}
            autoComplete="off"
          />
          {national && (
            <button type="button" className="input-clear" onClick={() => setNational('')} aria-label="Clear phone" tabIndex={-1}>×</button>
          )}
        </div>
      </div>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="phone-field__menu"
          role="listbox"
          aria-label="Choose a country code"
          style={{ left: menuPos.left, top: menuPos.top }}
        >
          {PHONE_COUNTRIES.map((c) => (
            <button
              key={c.iso2}
              type="button"
              className={'phone-field__opt' + (c.iso2 === country.iso2 ? ' phone-field__opt--on' : '')}
              onClick={() => chooseCountry(c)}
              role="option"
              aria-selected={c.iso2 === country.iso2}
            >
              <span className="phone-field__flag">{c.flag}</span>
              <span className="phone-field__optname">{c.name}</span>
              <span className="phone-field__optdial">+{c.dial}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 9l7 7 7-7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
