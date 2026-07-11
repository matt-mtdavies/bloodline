import { useState, useEffect, useRef } from 'react';

function parse(value) {
  const parts = String(value || '').split('-');
  return { y: parts[0] || '', m: parts[1] || '', d: parts[2] || '' };
}

// Resolves what's been typed so far against a field's max value (31 for day,
// 12 for month), the way a good segmented date input behaves: two digits
// always clamp and complete immediately: a single digit completes early too,
// but only once no valid two-digit value could still follow it — typing "5"
// for month can only ever mean "05" (nothing 2-digit starts with 5-9), so it
// resolves and advances on that one keystroke; typing "1" waits, since "1" is
// still short for "10", "11" or "12". This is what makes clamping exact and
// immediate — there's never an invalid intermediate value sitting around for
// a blur handler to notice and correct later.
function stepField(raw, max) {
  const digits = raw.replace(/\D/g, '').slice(0, 2);
  if (digits.length === 2) {
    const n = Math.min(max, Math.max(1, Number(digits)));
    return { value: String(n).padStart(2, '0'), complete: true };
  }
  if (digits.length === 1 && digits !== '0' && Number(digits) * 10 > max) {
    return { value: digits.padStart(2, '0'), complete: true };
  }
  return { value: digits, complete: false };
}

/*
 * A friendlier replacement for <input type="date">. iOS/Android's native
 * picker always opens on TODAY and makes reaching a birth year from the
 * 1800s–1900s — genealogy's whole domain — a long scroll or dozens of taps.
 * On desktop, a <select> for the month has the same complaint in miniature:
 * it's a click-and-choose control when everything else on the form is just
 * typed. So all three fields here are plain numeric text — day, month,
 * year — nothing to scroll or click open, each one clamped to a valid range
 * as it's typed (see stepField) and auto-advancing to the next once it's
 * unambiguously complete, the way a paper form's boxes would.
 *
 * Supports the app's partial dates the same way every other date field
 * does: a year alone, or year+month, is a complete, valid value — nothing
 * here forces a full date before it'll commit.
 */
export default function DateField({ value, onChange, max }) {
  const maxYear = (parse(max).y && Number(parse(max).y)) || new Date().getFullYear();
  const [day, setDay] = useState(() => parse(value).d);
  const [month, setMonth] = useState(() => parse(value).m);
  const [year, setYear] = useState(() => parse(value).y);
  const monthRef = useRef(null);
  const yearRef = useRef(null);
  // Every keystroke commits up to the parent and gets echoed straight back
  // as this component's next `value` prop. commit() below pads a still-
  // ambiguous single digit ("1") to a full "01" for that OUTGOING string —
  // but locally we want to keep showing the bare "1" so a second keystroke
  // can still complete "12" or "10"/"11". Tracking what we last emitted lets
  // the sync effect tell "the parent just echoed our own commit back" (skip
  // resync, keep the in-progress digits) apart from "the parent genuinely
  // reset this value" (a Clear button, a different person's date) — without
  // this, every keystroke would round-trip through the padded value and
  // immediately overwrite whatever was still being typed.
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const p = parse(value);
    setDay(p.d);
    setMonth(p.m);
    setYear(p.y);
  }, [value]);

  const commit = (nd, nm, ny) => {
    if (ny.length < 4) return; // nothing to commit without a full year
    if (Number(ny) > maxYear) return; // never emit a future year
    const out = nm && nd ? `${ny}-${nm.padStart(2, '0')}-${nd.padStart(2, '0')}`
      : nm ? `${ny}-${nm.padStart(2, '0')}`
      : ny;
    lastEmitted.current = out;
    onChange(out);
  };

  const onDayChange = (e) => {
    const { value: v, complete } = stepField(e.target.value, 31);
    setDay(v);
    commit(v, month, year);
    if (complete) monthRef.current?.focus();
  };
  // Fallback for tabbing/clicking away mid-entry (e.g. typed just "3",
  // meaning day 3, then moved on without it ever hitting stepField's
  // early-complete case) — pad whatever's left into a valid value.
  const onDayBlur = (e) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) return;
    const clamped = String(Math.min(31, Math.max(1, Number(raw)))).padStart(2, '0');
    setDay(clamped);
    commit(clamped, month, year);
  };
  const onMonthChange = (e) => {
    const { value: v, complete } = stepField(e.target.value, 12);
    setMonth(v);
    commit(day, v, year);
    if (complete) yearRef.current?.focus();
  };
  const onMonthBlur = (e) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) return;
    const clamped = String(Math.min(12, Math.max(1, Number(raw)))).padStart(2, '0');
    setMonth(clamped);
    commit(day, clamped, year);
  };
  const onYearChange = (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 4);
    setYear(v);
    commit(day, month, v);
  };
  // Auto-select on focus (tab, click, or auto-advance alike) so typing over
  // an existing value never needs a manual select-all or backspace first —
  // the whole point of "just let me type the date."
  const selectAll = (e) => e.target.select();

  return (
    <div className="date-field">
      <input
        className="date-field__day"
        type="text"
        inputMode="numeric"
        placeholder="DD"
        aria-label="Day"
        maxLength={2}
        value={day}
        onChange={onDayChange}
        onBlur={onDayBlur}
        onFocus={selectAll}
      />
      <input
        ref={monthRef}
        className="date-field__month"
        type="text"
        inputMode="numeric"
        placeholder="MM"
        aria-label="Month"
        maxLength={2}
        value={month}
        onChange={onMonthChange}
        onBlur={onMonthBlur}
        onFocus={selectAll}
      />
      <input
        ref={yearRef}
        className="date-field__year"
        type="text"
        inputMode="numeric"
        placeholder="YYYY"
        aria-label="Year"
        maxLength={4}
        value={year}
        onChange={onYearChange}
        onFocus={selectAll}
      />
    </div>
  );
}
