import { useEffect, useMemo } from 'react';
import { buildKeepsake } from '../../lib/keepsake.js';
import {
  CoverSpread, FrontispieceSpread, OriginsSpread, ConstellationSpread,
  ChaptersSpread, ServiceSpread, PlacesSpread, VoicesSpread, AlbumSpread,
  DocumentsSpread, RecordSpread, LegacySpread, ColophonSpread,
} from './spreads.jsx';
import '../../styles/keepsake.css';

/*
 * The Keepsake reader — a full-screen book over the app (docs/KEEPSAKE.md).
 * Phase 1: the static magazine. Native vertical scroll, proximity snap,
 * one spread per viewport. The AI narrative (Phase 2), motion (Phase 3)
 * and print (Phase 4) all layer onto this exact structure.
 */

const SPREADS = {
  cover: CoverSpread,
  frontispiece: FrontispieceSpread,
  origins: OriginsSpread,
  constellation: ConstellationSpread,
  chapters: ChaptersSpread,
  service: ServiceSpread,
  places: PlacesSpread,
  voices: VoicesSpread,
  album: AlbumSpread,
  documents: DocumentsSpread,
  record: RecordSpread,
  legacy: LegacySpread,
  colophon: ColophonSpread,
};

export default function KeepsakeView({
  graph, personId, memories, photos, documents, activity, familyName, onClose,
}) {
  const keepsake = useMemo(
    () => buildKeepsake(graph, personId, { memories, photos, documents, activity, familyName }),
    [graph, personId, memories, photos, documents, activity, familyName],
  );

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Private subject (or a person mid-removal) — nothing to show.
  if (!keepsake) return null;

  return (
    <div className="keepsake-view" role="dialog" aria-modal="true" aria-label={`${keepsake.subject.name} — Keepsake`}>
      <div className="ks-chrome">
        <span className="ks-chrome__mark">A Bloodline Keepsake</span>
        <div className="ks-chrome__btns">
          <button className="ks-chrome__btn" onClick={onClose} aria-label="Close the Keepsake">
            <CloseIcon />
          </button>
        </div>
      </div>
      {keepsake.spreads.map((spread) => {
        const Spread = SPREADS[spread.key];
        return Spread ? <Spread key={spread.key} spread={spread} /> : null;
      })}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
