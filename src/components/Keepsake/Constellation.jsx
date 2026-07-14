import { monogramColors, initials } from '../../lib/color.js';

/*
 * The Family Constellation — the Keepsake's signature graphic. Renders the
 * pure layout from lib/keepsake.js's constellationLayout() as a fine-line
 * SVG: thin links, portrait discs, names in small caps, the subject ringed
 * in the accent. ViewBox-scaled so one drawing serves phone, desktop and
 * print. Phase 3 adds the draw-itself-on-scroll animation on top of these
 * same elements; nothing here may depend on being animated.
 */

const UX = 128; // world-unit → px
const UY = 168;
const R = 26; // relative disc radius
const R_SUBJECT = 34;

export default function Constellation({ nodes, links }) {
  if (!nodes?.length) return null;

  const xs = nodes.map((n) => n.x * UX);
  const ys = nodes.map((n) => n.y * UY);
  const pad = 74;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad + 16; // room for the name under the lowest disc

  return (
    <svg
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      role="img"
      aria-label="Family constellation diagram"
    >
      <g className="ks-const-links">
        {links.map((l, i) => (
          <line
            key={i}
            x1={l.x1 * UX}
            y1={l.y1 * UY}
            x2={l.x2 * UX}
            y2={l.y2 * UY}
            stroke={l.kind === 'partner' ? 'var(--accent, #c2603a)' : 'var(--bio, #8a7d6b)'}
            strokeWidth={l.kind === 'partner' ? 1.6 : 1}
            strokeDasharray={l.kind === 'partner' ? '1 5' : undefined}
            strokeLinecap="round"
            opacity="0.7"
          />
        ))}
      </g>
      <g className="ks-const-nodes">
        {nodes.map((n) => <Disc key={n.id} node={n} />)}
      </g>
    </svg>
  );
}

function Disc({ node }) {
  const cx = node.x * UX;
  const cy = node.y * UY;
  const r = node.band === 'subject' ? R_SUBJECT : R;
  const { base, light } = monogramColors(node.name || '');
  const clipId = `ksc_${node.id}`;
  return (
    <g>
      {node.band === 'subject' && (
        <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke="var(--accent, #c2603a)" strokeWidth="1.4" />
      )}
      <circle cx={cx} cy={cy} r={r} fill={light} stroke="var(--hairline, #ebedf0)" strokeWidth="1" />
      {node.photo ? (
        <>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={r - 1} />
          </clipPath>
          <image
            href={node.photo}
            x={cx - r}
            y={cy - r}
            width={r * 2}
            height={r * 2}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
        </>
      ) : (
        <text
          x={cx}
          y={cy + 1}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="var(--display, serif)"
          fontSize={r * 0.78}
          fill={base}
        >
          {initials(node.name || '?').slice(0, 2)}
        </text>
      )}
      <text
        x={cx}
        y={cy + r + 16}
        textAnchor="middle"
        fontFamily="var(--body, sans-serif)"
        fontSize="10.5"
        letterSpacing="0.08em"
        style={{ textTransform: 'uppercase' }}
        fill="var(--ink-soft, #6b6f76)"
      >
        {(node.name || '').split(/\s+/)[0].toUpperCase()}
      </text>
    </g>
  );
}
