import { useState, useEffect, useMemo, useRef } from 'react';
import { computeEnrichment } from '../lib/enrich.js';

const TIER_LABEL = {
  detected: 'Worth a second look',
  missing: 'Missing',
  estimated: 'Estimated',
  document: 'From a document',
  relationship: 'From your family tree',
  story: 'Story',
};

const ACTION_LABEL = {
  edit: 'Edit profile',
  merge: 'Review match',
  'add-relative': 'Add relative',
  story: 'Write it with AI',
};

// Document-derived findings all get the same two-button (accept/dismiss)
// treatment below instead of the generic single-action button — one row
// shape, three sources (a life event, a profile field, a named relative).
const DOCUMENT_ACTION_TYPES = new Set(['document-fact', 'document-field', 'document-medal', 'document-person']);
const DOCUMENT_ACTION_LABEL = {
  'document-fact': 'Add to timeline',
  'document-field': 'Add to profile',
  'document-medal': 'Add to profile',
  'document-person': 'Confirm relationship',
};

// Relationship-derived findings get the same two-button treatment, but
// there's no document behind them (no docId/factIndex) — they carry their
// own complete { key, year, title, detail } right on the action, computed
// live from the tree each time. Handled as its own small bucket below
// rather than folded into DOCUMENT_ACTION_TYPES, since "From a document"
// would be a misleading label for a fact sourced from a marriage or birth
// date already on record.
const RELATIONSHIP_ACTION_TYPE = 'relationship-fact';

/*
 * "Enrich this profile" — one place that surfaces everything the tree already
 * knows (or can honestly bound) about a person's gaps. Every row is tiered —
 * detected/missing/estimated/story — so nothing here is ever mistaken for a
 * verified fact. The one networked call is place-name standardization
 * (/api/enrich-places, Haiku); everything else is instant, computed from data
 * already in the tree (see lib/enrich.js).
 */
export default function EnrichSheet({
  person,
  graph,
  memoryCount = 0,
  documents = [],
  onClose,
  onEdit,
  onAddRelative,
  onReviewDuplicate,
  onGenerateStory,
  onApplyPlace,
  onApplyDocumentFact,
  onDismissDocumentFact,
  onApplyDocumentMedal,
  onDismissDocumentMedal,
  onApplyDocumentField,
  onDismissDocumentField,
  onApplyDocumentPerson,
  onDismissDocumentPerson,
  onApplyRelationshipFact,
  onDismissRelationshipFact,
}) {
  const allFindings = useMemo(
    () => computeEnrichment(person, graph, memoryCount, documents),
    [person, graph, memoryCount, documents],
  );
  // Document- and relationship-derived findings each get their own
  // two-button (accept/dismiss) treatment below, same UX as the place
  // suggestions — everything else keeps the single generic action button.
  const findings = allFindings.filter(
    (f) => !DOCUMENT_ACTION_TYPES.has(f.action?.type) && f.action?.type !== RELATIONSHIP_ACTION_TYPE,
  );
  const documentFindings = allFindings.filter((f) => DOCUMENT_ACTION_TYPES.has(f.action?.type));
  const relationshipFindings = allFindings.filter((f) => f.action?.type === RELATIONSHIP_ACTION_TYPE);

  function acceptDocumentFinding(f) {
    switch (f.action.type) {
      case 'document-fact': onApplyDocumentFact?.(f.action.docId, f.action.factIndex); break;
      case 'document-field': onApplyDocumentField?.(f.action.docId, f.action.field); break;
      case 'document-medal': onApplyDocumentMedal?.(f.action.docId, f.action.medalIndex); break;
      case 'document-person': onApplyDocumentPerson?.(f.action.docId, f.action.personIndex, f.action.matchedId, f.action.relation); break;
      default: break;
    }
  }
  function dismissDocumentFinding(f) {
    switch (f.action.type) {
      case 'document-fact': onDismissDocumentFact?.(f.action.docId, f.action.factIndex); break;
      case 'document-field': onDismissDocumentField?.(f.action.docId, f.action.field); break;
      case 'document-medal': onDismissDocumentMedal?.(f.action.docId, f.action.medalIndex); break;
      case 'document-person': onDismissDocumentPerson?.(f.action.docId, f.action.personIndex); break;
      default: break;
    }
  }

  const places = useMemo(() => {
    const list = [];
    if (person.birth_place) list.push({ key: 'birth_place', value: person.birth_place });
    if (person.residence) list.push({ key: 'residence', value: person.residence });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id, person.birth_place, person.residence]);

  const [placeState, setPlaceState] = useState('idle'); // idle|loading|done|unavailable|error
  const [placeSuggestions, setPlaceSuggestions] = useState([]);
  const [resolvedKeys, setResolvedKeys] = useState(() => new Set());
  const triedRef = useRef(null);

  useEffect(() => {
    if (!places.length || triedRef.current === person.id) return;
    triedRef.current = person.id;
    (async () => {
      setPlaceState('loading');
      try {
        const res = await fetch('/api/enrich-places', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ places }),
        });
        if (res.status === 503) { setPlaceState('unavailable'); return; }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setPlaceState('error'); return; }
        setPlaceSuggestions(body.suggestions || []);
        setPlaceState('done');
      } catch {
        setPlaceState('error');
      }
    })();
  }, [places, person.id]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resolvePlace = (key) => setResolvedKeys((prev) => new Set(prev).add(key));
  const applyPlace = (s) => { onApplyPlace?.(s.key, s.suggested); resolvePlace(s.key); };

  const visiblePlaceSuggestions = placeSuggestions.filter((s) => !resolvedKeys.has(s.key));

  const runAction = (finding) => {
    switch (finding.action?.type) {
      case 'edit': onEdit?.(); break;
      case 'merge': onReviewDuplicate?.(); break;
      case 'add-relative': onAddRelative?.(); break;
      case 'story': onGenerateStory?.(); break;
      default: break;
    }
  };

  const firstName = (person.display_name || 'They').trim().split(/\s+/)[0];
  const nothingToShow =
    findings.length === 0 && documentFindings.length === 0 && relationshipFindings.length === 0 &&
    placeState !== 'loading' && visiblePlaceSuggestions.length === 0;

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label={`Enrich ${person.display_name}'s profile`} onClick={onClose}>
      <div className="sheet enrich" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="enrich__head">
          <h2 className="enrich__title"><SparkIcon /> Enrich this profile</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <p className="enrich__intro">
          Everything below is either a fact already in the tree or a bounded estimate built from
          it — nothing here is invented.
        </p>

        {nothingToShow ? (
          <div className="enrich__empty">
            <CheckIcon />
            <p>{firstName}'s profile looks solid — nothing to flag right now.</p>
          </div>
        ) : (
          <ul className="enrich__list">
            {findings.map((f) => (
              <li key={f.key} className={`enrich__row enrich__row--${f.tier}`}>
                <span className="enrich__row-icon"><FindingIcon icon={f.icon} /></span>
                <div className="enrich__row-body">
                  <span className="enrich__row-tag">{TIER_LABEL[f.tier]}</span>
                  <p className="enrich__row-title">{f.title}</p>
                  <p className="enrich__row-detail">{f.detail}</p>
                </div>
                {f.action && (
                  <button className="enrich__row-action" onClick={() => runAction(f)}>
                    {ACTION_LABEL[f.action.type] || 'Open'}
                  </button>
                )}
              </li>
            ))}

            {documentFindings.map((f) => (
              <li key={f.key} className="enrich__row enrich__row--document">
                <span className="enrich__row-icon"><FindingIcon icon={f.icon} /></span>
                <div className="enrich__row-body">
                  <span className="enrich__row-tag">{TIER_LABEL.document}</span>
                  <p className="enrich__row-title">{f.title}</p>
                  <p className="enrich__row-detail">{f.detail}</p>
                </div>
                <div className="enrich__row-actions">
                  <button className="enrich__row-action" onClick={() => acceptDocumentFinding(f)}>
                    {DOCUMENT_ACTION_LABEL[f.action.type]}
                  </button>
                  <button className="enrich__row-dismiss" onClick={() => dismissDocumentFinding(f)}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}

            {relationshipFindings.map((f) => (
              <li key={f.key} className="enrich__row enrich__row--relationship">
                <span className="enrich__row-icon"><FindingIcon icon={f.icon} /></span>
                <div className="enrich__row-body">
                  <span className="enrich__row-tag">{TIER_LABEL.relationship}</span>
                  <p className="enrich__row-title">{f.title}</p>
                  <p className="enrich__row-detail">{f.detail}</p>
                </div>
                <div className="enrich__row-actions">
                  <button className="enrich__row-action" onClick={() => onApplyRelationshipFact?.(f.action)}>
                    Add to timeline
                  </button>
                  <button className="enrich__row-dismiss" onClick={() => onDismissRelationshipFact?.(f.action.key)}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}

            {placeState === 'loading' && (
              <li className="enrich__row enrich__row--loading">
                <span className="enrich__row-icon"><FindingIcon icon="place" /></span>
                <div className="enrich__row-body">
                  <span className="enrich__row-tag">Checking place names…</span>
                  <p className="enrich__row-detail enrich__shimmer">Asking AI to standardise the places on record.</p>
                </div>
              </li>
            )}

            {visiblePlaceSuggestions.map((s) => (
              <li key={s.key} className="enrich__row enrich__row--place">
                <span className="enrich__row-icon"><FindingIcon icon="place" /></span>
                <div className="enrich__row-body">
                  <span className="enrich__row-tag">Place name</span>
                  <p className="enrich__row-title">“{s.original}” → “{s.suggested}”</p>
                  <p className="enrich__row-detail">
                    {s.key === 'birth_place' ? 'Birthplace' : 'Lives in'} could be more precise.
                  </p>
                </div>
                <div className="enrich__row-actions">
                  <button className="enrich__row-action" onClick={() => applyPlace(s)}>Use this</button>
                  <button className="enrich__row-dismiss" onClick={() => resolvePlace(s.key)}>Skip</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FindingIcon({ icon }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
  switch (icon) {
    case 'checklist':
      return (<svg {...p}><path d="M4 6h11M4 12h11M4 18h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M18 5l2 2 3-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>);
    case 'duplicate':
      return (<svg {...p}><rect x="4" y="7" width="11" height="13" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M9 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1" stroke="currentColor" strokeWidth="1.7"/></svg>);
    case 'timeline':
      return (<svg {...p}><path d="M4 12h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><circle cx="8" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.7"/><circle cx="16" cy="12" r="2.2" fill="currentColor"/></svg>);
    case 'family':
      return (<svg {...p}><circle cx="8" cy="7" r="2.6" stroke="currentColor" strokeWidth="1.7"/><circle cx="16" cy="7" r="2.6" stroke="currentColor" strokeWidth="1.7" strokeDasharray="1.5 2.2"/><path d="M3.5 19c.6-3 2.2-4.6 4.5-4.6s3.9 1.6 4.5 4.6M11.5 19c.6-3 2.2-4.6 4.5-4.6s3.9 1.6 4.5 4.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>);
    case 'place':
      return (<svg {...p}><path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><circle cx="12" cy="9.5" r="2.3" stroke="currentColor" strokeWidth="1.7"/></svg>);
    case 'military':
      return (<svg {...p}><circle cx="12" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.7"/><path d="M8.5 13l-2 8 5.5-3 5.5 3-2-8" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>);
    case 'sparkle':
    default:
      return (<svg {...p}><path d="M12 3l1.6 4.7L18.3 9.3l-4.7 1.6L12 15.6l-1.6-4.7L5.7 9.3l4.7-1.6L12 3z" fill="currentColor"/></svg>);
  }
}

function SparkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3z" fill="currentColor"/>
      <path d="M19 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7L19 14z" fill="currentColor" opacity="0.7"/>
    </svg>
  );
}
function CloseIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>);
}
function CheckIcon() {
  return (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6"/><path d="M8.5 12.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
