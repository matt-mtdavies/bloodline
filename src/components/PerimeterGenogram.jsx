import { useMemo } from 'react';
import { GENOGRAM_ROWS, categoryQualifiesAtLevel, groupPeopleByCategory } from '../lib/perimeterCategories.js';

/*
 * A schematic family-tree diagram — generation rows, top (older) to bottom
 * (younger) — showing which relations are included at the currently
 * selected perimeter level, and which aren't yet. Complements the rings:
 * the rings answer "how big is this level," this answers "why — which
 * actual relatives does it reach." Grounded in categoryQualifiesAtLevel's
 * own comment: direct ancestors/descendants and degree-0 collateral
 * (siblings/aunts-uncles/nieces-nephews) are unconditionally included at
 * every real level — only 2nd and 3rd cousins are ever actually gated by
 * the level picker, which is itself a useful thing to see at a glance
 * rather than infer from four separate counts.
 */
export default function PerimeterGenogram({ current, viewerId, graph, engineLevel }) {
  const counts = useMemo(() => {
    if (!current) return new Map();
    const byCategory = groupPeopleByCategory(current, viewerId, graph);
    const out = new Map();
    for (const [cat, entries] of byCategory) out.set(cat, entries.length);
    return out;
  }, [current, viewerId, graph]);

  return (
    <div
      className="pp-geno"
      role="img"
      aria-label="Family tree diagram showing which generations and relations are included at the selected perimeter level"
    >
      {GENOGRAM_ROWS.map((row) => (
        <div key={row.key} className="pp-geno__row">
          {row.chips.map((chip) => {
            const on = categoryQualifiesAtLevel(chip.cat, engineLevel);
            const count = counts.get(chip.cat) ?? 0;
            return (
              <span
                key={chip.cat}
                className={`pp-geno__chip${on ? ' pp-geno__chip--on' : ' pp-geno__chip--off'}${chip.cat === 'you' ? ' pp-geno__chip--you' : ''}`}
              >
                {chip.label}
                {on && count > 0 && <span className="pp-geno__chip-count">{count}</span>}
              </span>
            );
          })}
        </div>
      ))}
      <p className="pp-geno__note">
        Partners, step-family, and in-laws connected to anyone above are always included too.
      </p>
    </div>
  );
}
