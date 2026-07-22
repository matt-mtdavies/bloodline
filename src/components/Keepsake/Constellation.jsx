import { useEffect, useRef, useState } from 'react';
import { monogramColors, initials } from '../../lib/color.js';

/*
 * The Family Constellation — the Keepsake's signature graphic. Renders the
 * pure layout from lib/keepsake.js's constellationLayout() as a fine-line
 * SVG: thin links, portrait discs, names in small caps, the subject ringed
 * in the accent. Rendered at a fixed pixel scale (never shrunk to fit a
 * container) so legibility never degrades as a family grows — a wrapper
 * scrolls horizontally instead, opening centred on the subject. Print gets
 * its own width:100% override (keepsake.css) since a printed page can't
 * scroll and must show the whole diagram scaled to fit. Phase 3 adds the
 * draw-itself-on-scroll animation on top of these same elements; nothing
 * here may depend on being animated.
 */

const UX = 128; // world-unit → px
const UY = 168;
const R = 30; // relative disc radius — sized for legibility at a book page's
              // rendered width, not just a full-viewport scroll reader
const R_SUBJECT = 40;

export default function Constellation({ nodes, links }) {
  const wrapRef = useRef(null);
  const [scrollable, setScrollable] = useState(false);
  if (!nodes?.length) return null;

  const xs = nodes.map((n) => n.x * UX);
  const ys = nodes.map((n) => n.y * UY);
  const pad = 74;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad + 16; // room for the name under the lowest disc
  const w = maxX - minX;
  const h = maxY - minY;
  const subjectX = -minX; // the subject always sits at world x=0

  // Open scrolled to the subject, centred — a family wide enough to need
  // the scroll would otherwise open on its leftmost, least relevant edge.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, Math.min(subjectX - el.clientWidth / 2, el.scrollWidth - el.clientWidth));
    setScrollable(el.scrollWidth > el.clientWidth + 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ks-constellation__frame">
      <div className="ks-constellation__scroll" ref={wrapRef}>
      <svg
        viewBox={`${minX} ${minY} ${w} ${h}`}
        width={w}
        height={h}
        role="img"
        aria-label="Family constellation diagram"
      >
      <g className="ks-const-links">
        {links.map((l, i) => {
          const partner = l.kind === 'partner';
          return (
            <line
              key={i}
              // Solid parent lines draw themselves via a normalized dash
              // (pathLength=1 makes one CSS dashoffset rule fit every
              // length); the dotted partner bond can't use that trick — a
              // dash pattern scales with pathLength and would turn solid —
              // so it fades in with its partner's disc instead.
              className={partner ? 'ks-const-link ks-const-link--fade' : 'ks-const-link ks-const-link--draw'}
              style={{ '--d': `${Math.min(i * 0.045, 1.2)}s` }}
              x1={l.x1 * UX}
              y1={l.y1 * UY}
              x2={l.x2 * UX}
              y2={l.y2 * UY}
              pathLength={partner ? undefined : 1}
              stroke={partner ? 'var(--accent, #c2603a)' : 'var(--bio, #8a7d6b)'}
              strokeWidth={partner ? 1.6 : 1}
              strokeDasharray={partner ? '1 5' : undefined}
              strokeLinecap="round"
              opacity="0.7"
            />
          );
        })}
      </g>
      <g className="ks-const-nodes">
        {nodes.map((n, i) => <Disc key={n.id} node={n} delay={0.6 + Math.min(i * 0.04, 1.1)} />)}
      </g>
      </svg>
      </div>
      {scrollable && (
        <>
          <div className="ks-constellation__fade ks-constellation__fade--l" aria-hidden="true" />
          <div className="ks-constellation__fade ks-constellation__fade--r" aria-hidden="true" />
        </>
      )}
    </div>
  );
}

function Disc({ node, delay = 0 }) {
  const cx = node.x * UX;
  const cy = node.y * UY;
  const r = node.band === 'subject' ? R_SUBJECT : R;
  const { base, light } = monogramColors(node.name || '');
  const clipId = `ksc_${node.id}`;
  return (
    <g className="ks-const-node" style={{ '--d': `${delay}s` }}>
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
        y={cy + r + 18}
        textAnchor="middle"
        fontFamily="var(--body, sans-serif)"
        fontSize="13"
        letterSpacing="0.06em"
        style={{ textTransform: 'uppercase' }}
        fill="var(--ink-soft, #6b6f76)"
      >
        {(node.name || '').split(/\s+/)[0].toUpperCase()}
      </text>
    </g>
  );
}
