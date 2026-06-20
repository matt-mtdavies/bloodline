import { monogramColors, initials } from '../lib/color.js';

// A DOM avatar that mirrors the canvas bubbles: real face when we have one,
// otherwise a warm deterministic monogram. Used in the sheet and the list view.
export default function Avatar({ person, size = 56 }) {
  const { base, light } = monogramColors(person.display_name);
  const memorial = person.is_deceased;
  return (
    <span
      className={'avatar' + (memorial ? ' avatar--memorial' : '')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {person.photo ? (
        <img
          src={person.photo}
          alt=""
          loading="lazy"
          style={memorial ? { filter: 'saturate(0.65) brightness(1.02)' } : undefined}
        />
      ) : (
        <span
          className="avatar__mono"
          style={{
            background: `linear-gradient(160deg, ${light}, ${base})`,
            fontSize: size * 0.4,
          }}
        >
          {initials(person.display_name)}
        </span>
      )}
    </span>
  );
}
