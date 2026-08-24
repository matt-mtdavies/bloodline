import { useState } from 'react';
import { monogramColors, initials } from '../lib/color.js';

// A DOM avatar that mirrors the canvas bubbles: real face when we have one,
// otherwise a warm deterministic monogram. Used in the sheet and the list view.
// If a photo fails to load we fall back to the monogram — never a broken glyph.
// `shape` defaults to the circle every existing caller already expects;
// 'squircle' is opt-in per call site (Chart View's cards specifically asked
// for an app-icon-style rounded square) so nothing else in the app changes.
export default function Avatar({ person, size = 56, shape = 'circle' }) {
  const { base, light } = monogramColors(person.display_name);
  const memorial = person.is_deceased;
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={'avatar' + (shape === 'squircle' ? ' avatar--squircle' : '') + (memorial ? ' avatar--memorial' : '')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {person.photo && !failed ? (
        <img
          src={person.photo}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          style={memorial ? { filter: 'saturate(0.65) brightness(1.02)' } : undefined}
        />
      ) : (
        <span
          className="avatar__mono"
          style={{
            background: `linear-gradient(165deg, ${light}, ${base})`,
            fontSize: size * 0.4,
          }}
        >
          {/* An echo of the profile hero's own no-portrait treatment — an
              oversized, translucent ghost of the same initials bleeding off
              the top edge — scaled down to a size that still reads as
              "rich, not just a label" without crowding a small avatar. Only
              at sizes where it can actually breathe; a 26px menu avatar
              stays the plain two letters, same as it always was. */}
          {size >= 32 && (
            <span className="avatar__mono-ghost" aria-hidden="true">{initials(person.display_name)}</span>
          )}
          <span className="avatar__mono-text">{initials(person.display_name)}</span>
        </span>
      )}
    </span>
  );
}
