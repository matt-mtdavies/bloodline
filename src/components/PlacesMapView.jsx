import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/placesMap.css';

/*
 * Places Lived — "Show on map": a real, tile-based map (Leaflet +
 * OpenStreetMap, no API key) plotting every geocoded residence as a
 * numbered pin in chronological order, joined by a polyline — the actual
 * geographic journey, not the abstract chronology-only chain the profile's
 * inline timeline deliberately uses instead (see PlacesLived.jsx's own
 * header comment for why that one avoids real distance entirely). A real
 * map is the right tool for "where," precisely because it handles zoom/pan/
 * clustering natively — the thing that broke the retired constellation
 * projection (lib/placesMap.js, deleted) was trying to encode real-world
 * position in a fixed, non-zoomable canvas.
 *
 * Deliberately no pin-clustering library for v1 — a real map lets someone
 * zoom in to separate two nearby places themselves; add
 * leaflet.markercluster later only if a real family's data shows this
 * isn't enough at scale.
 *
 * Custom numbered circular markers (not Leaflet's default blue teardrop)
 * so the map still reads as "a journey, in order," not just a scatter of
 * pins — the same story the horizontal chain already tells, from a
 * different, real-geography angle.
 */
export default function PlacesMapView({ residences, personName, onClose }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const points = [...residences]
      .filter((r) => r.lat != null && r.lon != null)
      .sort((a, b) => (a.from_year ?? Infinity) - (b.from_year ?? Infinity));
    if (!points.length) return undefined;

    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: true });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const latlngs = points.map((p) => [p.lat, p.lon]);
    L.polyline(latlngs, { color: '#c2603a', weight: 3, opacity: 0.65, dashArray: '2 10', lineCap: 'round' }).addTo(map);

    points.forEach((p, i) => {
      const icon = L.divIcon({
        className: 'places-map__marker',
        html: `<span class="places-map__marker-badge">${i + 1}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const label = shortPlace(p.place);
      const range = formatRange(p.from_year, p.to_year);
      L.marker([p.lat, p.lon], { icon })
        .addTo(map)
        .bindPopup(`<strong>${escapeHtml(label)}</strong><br/>${escapeHtml(p.state ? `${p.state} · ` : '')}${escapeHtml(range)}`);
    });

    if (latlngs.length === 1) {
      map.setView(latlngs[0], 11);
    } else {
      map.fitBounds(L.latLngBounds(latlngs), { padding: [48, 48] });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [residences]);

  const geocodedCount = residences.filter((r) => r.lat != null && r.lon != null).length;

  // Portalled straight to document.body: this component is opened from deep
  // inside PersonSheet's DOM tree, and .sheet-scrim's backdrop-filter (plus
  // the sheet's own slide-in transform) makes that ancestor the containing
  // block for any position: fixed descendant — without the portal, this
  // overlay would be confined and clipped inside the profile sheet instead
  // of actually covering the viewport (the same reason Lightbox/Keepsake are
  // mounted at the App.jsx top level rather than nested in PersonSheet).
  return createPortal(
    <div className="places-map-view" role="dialog" aria-modal="true" aria-label={`${personName}'s places on a map`}>
      <div className="places-map-view__bar">
        <span className="places-map-view__title">{personName}'s journey</span>
        <button className="places-map-view__close" onClick={onClose} aria-label="Close map">
          <CloseIcon />
        </button>
      </div>
      {geocodedCount > 0 ? (
        <div className="places-map-view__stage" ref={containerRef} />
      ) : (
        <div className="places-map-view__empty">
          <p>None of these places could be located on a map yet.</p>
        </div>
      )}
    </div>,
    document.body,
  );
}

function shortPlace(place) {
  return (place || '').split(',')[0].trim();
}

function formatRange(fromYear, toYear) {
  if (fromYear == null) return 'Unknown period';
  return toYear ? `${fromYear}–${toYear}` : `${fromYear}–present`;
}

// Popup content is raw HTML per Leaflet's own API — escape anything drawn
// from user-entered fields (place names are free text) before interpolating.
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function CloseIcon() {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>);
}
