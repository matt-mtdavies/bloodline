import { useState, useEffect, useRef } from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parse(value) {
  const parts = String(value || '').split('-');
  return { y: parts[0] || '', m: parts[1] || '', d: parts[2] || '' };
}

/*
 * A friendlier replacement for <input type="date"> on mobile. iOS/Android's
 * native picker always opens on TODAY and makes reaching a birth year from
 * the 1800s–1900s — genealogy's whole domain — a long scroll or dozens of
 * taps. Three small fields (day / month / year) let someone just type the
 * year directly, the way they'd fill in a paper form.
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

  // Stay in sync when the parent resets the value (e.g. its own Clear button).
  useEffect(() => {
    const p = parse(value);
    setDay(p.d);
    setMonth(p.m);
    setYear(p.y);
  }, [value]);

  const commit = (nd, nm, ny) => {
    if (ny.length < 4) return; // nothing to commit without a full year
    if (Number(ny) > maxYear) return; // never emit a future year
    if (nm && nd) onChange(`${ny}-${nm}-${nd.padStart(2, '0')}`);
    else if (nm) onChange(`${ny}-${nm}`);
    else onChange(ny);
  };

  const onDayChange = (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 2);
    setDay(v);
    if (v.length === 2) monthRef.current?.focus();
    commit(v, month, year);
  };
  const onDayBlur = () => {
    if (!day) return;
    const clamped = String(Math.min(31, Math.max(1, Number(day)))).padStart(2, '0');
    setDay(clamped);
    commit(clamped, month, year);
  };
  const onMonthChange = (e) => {
    const v = e.target.value;
    setMonth(v);
    if (v) yearRef.current?.focus();
    commit(day, v, year);
  };
  const onYearChange = (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 4);
    setYear(v);
    commit(day, month, v);
  };

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
      />
      <select
        ref={monthRef}
        className="date-field__month"
        aria-label="Month"
        value={month}
        onChange={onMonthChange}
      >
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>
        ))}
      </select>
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
      />
    </div>
  );
}
