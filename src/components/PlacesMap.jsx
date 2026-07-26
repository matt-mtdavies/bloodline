import { useMemo } from 'react';
import { projectPlaces } from '../lib/placesMap.js';

/*
 * Places Lived — the "constellation map." Sits above the existing text
 * chain/chapter cards (PlacesLived.jsx), turning the same residences[] data
 * into a small plotted journey: a dot per geocoded place, sized by how long
 * they lived there, joined by one organic curved path in chronological
 * order. Renders nothing at all below 2 geocoded places (lib/placesMap.js's
 * own gate) — a lone dot with no path isn't a journey worth showing, and
 * this is purely an enrichment layer over the chain, never its replacement.
 *
 * Deliberately not a real map (no tiles, no map library) — see
 * lib/placesMap.js's own header for why. Reuses this app's established
 * --gold/--accent tokens the same way Home.jsx's own "family constellation"
 * hero graphic already does, so it reads as the same design language, not a
 * bolted-on new one.
 */
export default function PlacesMap({ residences, onSelectPlace }) {
  const map = useMemo(() => projectPlaces(residences || []), [residences]);
  if (!map) return null;
  const { points, pathD, width, height } = map;

  return (
    <div className="places-map">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="places-map__svg"
        role="img"
        aria-label={`A map of ${points.length} places lived, connected in the order they were lived in`}
      >
        <defs>
          <radialGradient id="places-map-bg" cx="42%" cy="30%" r="80%">
            <stop offset="0%" stopColor="var(--paper)" />
            <stop offset="100%" stopColor="var(--paper-deep)" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="16" fill="url(#places-map-bg)" />
        {/* A hint of "map" — never literal geography, just enough graticule
            texture to read as a chart rather than a random scatter. */}
        <g className="places-map__grid" aria-hidden="true">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={`h${f}`} x1={0} y1={height * f} x2={width} y2={height * f} />
          ))}
          {[0.2, 0.4, 0.6, 0.8].map((f) => (
            <line key={`v${f}`} x1={width * f} y1={0} x2={width * f} y2={height} />
          ))}
        </g>
        <path d={pathD} className="places-map__path" fill="none" />
        {points.map((p, i) => (
          <g
            key={p.id}
            className={'places-map__point' + (p.current ? ' places-map__point--current' : '')}
            transform={`translate(${p.x}, ${p.y})`}
            onClick={onSelectPlace ? () => onSelectPlace(p.id) : undefined}
            role={onSelectPlace ? 'button' : undefined}
            tabIndex={onSelectPlace ? 0 : undefined}
            aria-label={onSelectPlace ? `${shortPlace(p.place)}${p.current ? ', current' : ''}` : undefined}
            onKeyDown={onSelectPlace ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectPlace(p.id); } } : undefined}
          >
            {p.current && <circle className="places-map__pulse" r={p.r + 6} />}
            <circle className="places-map__dot" r={p.r} />
            <text
              className="places-map__label"
              x={p.labelAnchor === 'start' ? 6 : p.labelAnchor === 'end' ? -6 : 0}
              y={i % 2 === 0 ? -(p.r + 8) : p.r + 17}
              textAnchor={p.labelAnchor}
            >
              {shortPlace(p.place)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// A short label ("Cardiff" not "Cardiff, Wales, UK") — the full place string
// is already shown in the chain/cards right below; the map is a shape to
// glance at, not a second place to read the full address.
function shortPlace(place) {
  return (place || '').split(',')[0].trim();
}
