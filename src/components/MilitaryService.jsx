import { useEffect, useRef, useState } from 'react';
import SmartImg from './SmartImg.jsx';
import { streamBio } from '../lib/ai.js';
import {
  militaryEvents, militaryDocuments, militaryQuotes, serviceYears,
  hasMilitaryService, canGenerateMilitaryStory, militaryProfile, militaryMedals,
} from '../lib/military.js';

const NO_CONTEXT = 'NO_HISTORICAL_CONTEXT_AVAILABLE';

/*
 * Military Service — conditional, only rendered when there's real
 * military-tagged data on this person (see hasMilitaryService). Four
 * registers, deliberately different from each other rather than four
 * variations on the same card:
 *   - the campaign route: a journey, not a table — waypoints along a
 *     dashed line, the same military-tagged events already on the
 *     timeline, just given room to read as a story of movement.
 *   - the narrative: an optional AI-drafted account, fed ONLY the
 *     military-tagged events and verbatim document quotes (never the
 *     person's general life data), so it can't reach for an unrelated
 *     fact or invent a posting the records never mentioned.
 *   - historical context: a second, separate AI aside — general
 *     historical background on a specific place/camp/campaign/unit
 *     mentioned in the record, offered ONLY when the model has genuine,
 *     well-established knowledge of it (see the NO_CONTEXT sentinel).
 *     Visually and textually distinct from the narrative, since this is
 *     the one part of the section that isn't drawn from the family's own
 *     documents — it's outside knowledge, clearly labeled as such.
 *   - the story-in-fragments: verbatim quotes from the documents
 *     themselves — the human voice inside the paperwork.
 * The narrative and historical context share the same review discipline
 * (Keep it / Fix it / Dismiss, Edit + Regenerate) via GeneratedBlock below.
 */
export default function MilitaryService({ person, personDocs, onOpenDocument, onUpdateMilitaryStory, onUpdateMilitaryContext, canEdit = true }) {
  if (!hasMilitaryService(person, personDocs)) return null;

  const events = militaryEvents(person);
  const docs = militaryDocuments(personDocs);
  const quotes = militaryQuotes(personDocs);
  const allQuotes = militaryQuotes(personDocs, Infinity);
  const years = serviceYears(events);
  const hasMaterial = events.length > 0 || allQuotes.length > 0;
  const canGenerateStory = canGenerateMilitaryStory(person, personDocs);
  const profile = militaryProfile(person);
  const showTag = !!(profile.branch || profile.serviceNumber || profile.rank);
  const medals = militaryMedals(person);

  return (
    <section className="profile-section military">
      <div className="profile-section__head">
        <h3 className="profile-section__title">
          <span className="military__title-icon" aria-hidden="true"><RibbonIcon /></span>
          Military Service
        </h3>
        {(years || docs.length > 0) && (
          <span className="military__span">
            {[years, docs.length > 0 ? `${docs.length} record${docs.length === 1 ? '' : 's'}` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </div>

      {/* Dog tags — the section's hero moment, only once there's real
          structured data (branch/service number/rank, from the same
          document-field extraction as occupation/residence) to put on one.
          Absent that, the plain header above still carries the essentials. */}
      {showTag && (
        <div className="military__dogtags" aria-hidden="true">
          <div className="military__dogtag military__dogtag--back" />
          <div className="military__dogtag military__dogtag--front">
            <span className="military__dogtag-chain" />
            <span className="military__dogtag-row">
              <BranchIcon branch={profile.branch} nation={profile.nation} />
              <span className="military__dogtag-name">{person.display_name}</span>
            </span>
            {profile.serviceNumber && <span className="military__dogtag-number">{profile.serviceNumber}</span>}
            {profile.rank && <span className="military__dogtag-rank">{profile.rank}</span>}
          </div>
        </div>
      )}

      {/* Medals — a growable list appended one at a time via Enrich (see
          store.js's addMedal), shown independent of the dog tag: a person
          could have a medal on record with no known branch/rank/number.
          Gold/bronze accent, a third distinct palette alongside the dog
          tag's cool grey and the app's warm terracotta elsewhere — medals
          get their own "precious metal" register. */}
      {medals.length > 0 && (
        <div className="military__medals" role="list" aria-label="Medals and honours">
          {medals.map((m, i) => (
            <div className="military__medal" role="listitem" key={i} title={m.detail || undefined}>
              <MedalIcon />
              <span className="military__medal-name">{m.name}</span>
            </div>
          ))}
        </div>
      )}

      {events.length > 0 && (
        <div className="military__route" role="list" aria-label="Service timeline">
          {events.map((e, i) => (
            <div className="military__waypoint" role="listitem" key={i}>
              <span className="military__waypoint-dot" aria-hidden="true" />
              <span className="military__waypoint-year">{e.year}</span>
              <span className="military__waypoint-title">{e.title}</span>
              {e.detail && <span className="military__waypoint-detail">{e.detail}</span>}
            </div>
          ))}
        </div>
      )}

      {(canEdit || person.military_story) && (
        <div className="military__narrative">
          <GeneratedBlock
            person={person}
            canEdit={canEdit}
            value={person.military_story}
            onSave={(text) => onUpdateMilitaryStory?.(person.id, text)}
            requestExtra={{ focus: 'military', militaryEvents: events, militaryQuotes: allQuotes }}
            triggerLabel="Generate this chapter with AI"
            canGenerate={canGenerateStory}
            revisePlaceholder="What's not right? e.g. He was discharged in 1946, not 1947."
          />
        </div>
      )}

      {((canEdit && hasMaterial) || person.military_context) && (
        <div className="military__context">
          <p className="military__context-label">
            <InfoIcon /> Historical Context
          </p>
          <GeneratedBlock
            person={person}
            canEdit={canEdit}
            value={person.military_context}
            onSave={(text) => onUpdateMilitaryContext?.(person.id, text)}
            requestExtra={{ focus: 'military-context', militaryEvents: events, militaryQuotes: allQuotes }}
            triggerLabel="Add historical context"
            canGenerate={hasMaterial}
            emptySentinel={NO_CONTEXT}
            emptyMessage="Nothing well-documented enough to add for this record."
            revisePlaceholder="Point it at the right place — e.g. that's Stalag Luft III, not Stalag VIII-B."
            note="General historical background — not from your family's records"
          />
        </div>
      )}

      {quotes.length > 0 && (
        <div className="military__quotes">
          {quotes.map((q, i) => (
            <blockquote className="military__quote" key={i}>
              <p>&ldquo;{q.quote}&rdquo;</p>
              <cite>— {q.docTitle}{q.year ? `, ${q.year}` : ''}</cite>
            </blockquote>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <div className="military__docs">
          {docs.map((d) => (
            <button
              key={d.id}
              className="military__doc"
              onClick={() => onOpenDocument?.(d)}
              aria-label={`Open ${d.title}`}
            >
              <span className="military__doc-thumb">
                {d.mime?.startsWith('image/') ? (
                  <SmartImg src={d.src} alt={d.title} />
                ) : d.thumb ? (
                  <img src={d.thumb} alt={d.title} />
                ) : (
                  <DocGlyph />
                )}
              </span>
              <span className="military__doc-title">{d.title}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/*
 * The shared AI-generation review UI behind both the narrative and the
 * historical context block: idle -> generating -> done (Keep it / Fix it /
 * Dismiss) -> revising, plus direct manual Edit, plus an optional 'empty'
 * phase for a generation that came back as emptySentinel (nothing to add) —
 * that phase skips Keep/Fix/Dismiss entirely, since there's nothing worth
 * keeping, just a Dismiss to clear it. requestExtra is passed straight
 * through to streamBio (focus + the military-only context); this component
 * only cares about the generic stream lifecycle, not what's being generated.
 */
function GeneratedBlock({
  person, canEdit, value, onSave, requestExtra,
  triggerLabel, canGenerate = true, emptySentinel, emptyMessage,
  revisePlaceholder, note = 'Generated by AI · review before keeping',
}) {
  const abortRef = useRef(null);
  const [state, setState] = useState({ phase: 'idle', text: '', error: null });
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');

  // This component doesn't remount when the viewed person changes
  // (MilitaryService swaps `person` in place), so without this a stream
  // started for one person could still be "generating" on someone else's
  // profile a moment later.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ phase: 'idle', text: '', error: null });
    setEditing(false);
  }, [person?.id]);

  const run = async (feedback) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const previousText = state.text || value || '';
    setState({ phase: 'generating', text: '', error: null });
    setNotes('');

    await streamBio(
      person,
      {
        ...requestExtra,
        feedback: feedback?.trim() || undefined,
        previousStory: feedback?.trim() ? previousText : undefined,
      },
      {
        signal: ac.signal,
        onChunk: (text) => setState((s) => ({ ...s, text: s.text + text })),
        onDone: () => setState((s) => {
          const trimmed = s.text.trim();
          if (emptySentinel && trimmed === emptySentinel) return { phase: 'empty', text: '', error: null };
          return { ...s, phase: 'done' };
        }),
        onError: (err) => {
          if (!err) return; // aborted — no-op
          setState({ phase: 'idle', text: '', error: err.message });
        },
      },
    );
  };

  return (
    <>
      {!editing && value && state.phase === 'idle' && !state.error && canEdit && (
        <div className="military__narrative-actions">
          <button className="story-regen" onClick={() => { setEditDraft(value); setEditing(true); }}>
            Edit
          </button>
          <button className="story-regen" onClick={() => setState((s) => ({ ...s, phase: 'revising' }))}>
            Regenerate
          </button>
        </div>
      )}

      {state.phase === 'idle' && state.error && <p className="story-error">{state.error}</p>}

      {canEdit && state.phase === 'idle' && state.error && (
        <button className="story-regen" onClick={() => run()}>
          Try again
        </button>
      )}

      {canEdit && canGenerate && state.phase === 'idle' && !value && !state.error && (
        <button className="ai-generate" onClick={() => run()}>
          <SparkleIcon />
          {triggerLabel}
        </button>
      )}

      {editing ? (
        <div className="story-edit">
          <textarea
            className="field__input field__input--area story-edit__textarea"
            rows={8}
            autoFocus
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
          />
          <div className="story-actions">
            <button
              className="btn btn--primary"
              disabled={!editDraft.trim()}
              onClick={() => { onSave(editDraft.trim()); setEditing(false); }}
            >
              Save
            </button>
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        state.phase === 'idle' && value && <p className="story">{value}</p>
      )}

      {(state.phase === 'generating' || state.phase === 'done' || state.phase === 'revising') && (
        <p className={`story${state.phase === 'generating' ? ' story--generating' : ''}`}>
          {state.text || value}
        </p>
      )}

      {state.phase === 'done' && (
        <>
          <div className="story-actions">
            <button
              className="btn btn--primary"
              onClick={() => { onSave(state.text); setState({ phase: 'idle', text: '', error: null }); }}
            >
              Keep it
            </button>
            <button className="btn" onClick={() => setState((s) => ({ ...s, phase: 'revising' }))}>
              Fix it
            </button>
            <button className="btn" onClick={() => setState({ phase: 'idle', text: '', error: null })}>
              Dismiss
            </button>
          </div>
          <p className="story-note">{note}</p>
        </>
      )}

      {state.phase === 'empty' && (
        <>
          <p className="military__context-empty">{emptyMessage}</p>
          <div className="story-actions">
            <button className="btn" onClick={() => setState({ phase: 'idle', text: '', error: null })}>
              Dismiss
            </button>
          </div>
        </>
      )}

      {state.phase === 'revising' && (
        <div className="story-revise">
          <textarea
            className="field__input field__input--area"
            rows={3}
            autoFocus
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={revisePlaceholder}
          />
          <div className="story-actions">
            <button className="btn btn--primary" onClick={() => run(notes)}>
              Regenerate
            </button>
            <button
              className="btn"
              onClick={() => {
                setNotes('');
                setState((s) => ({ ...s, phase: s.text ? 'done' : 'idle' }));
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Picks the closest icon for a branch — a nation-specific icon when we
// recognize both the branch and a nation known to have one (today: just the
// Australian slouch hat for army), otherwise the generic branch icon, and
// the plain ribbon when branch itself isn't known (a bare service number or
// rank still earns a dog tag, just without a branch mark on it). Deliberately
// starting with one nation rather than building a library up front — more
// added later only as real family records call for them.
function BranchIcon({ branch, nation }) {
  if (branch === 'army' && (nation || '').toLowerCase().includes('australia')) return <SlouchHatIcon />;
  if (branch === 'army') return <ArmyIcon />;
  if (branch === 'navy') return <NavyIcon />;
  if (branch === 'air_force') return <AirForceIcon />;
  return <RibbonIcon />;
}

function ArmyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 14.5l8-6.5 8 6.5M4 20l8-6.5 8 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5v13M6.5 13H4a8 8 0 0 0 16 0h-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 10.8h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function AirForceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.6 12.3c-2.6-.2-5.7-1.5-8.1-3.4 0 2.8 2.4 5.7 6.9 6.9M14.4 12.3c2.6-.2 5.7-1.5 8.1-3.4 0 2.8-2.4 5.7-6.9 6.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A simplified, abstracted silhouette — the wide brim, one side pinned up
// against the crown, a small badge mark — not a literal or historically
// precise rendering of any specific era's slouch hat.
function SlouchHatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 16.3c2.6-1.7 6.2-2.6 10-2.6s7.4.9 10 2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.6 13.9c0-3.3 2-5.9 4.4-5.9s4.4 2.6 4.4 5.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16.4 14.1c1.5.5 3.1.1 4-1.1-.9-1.3-2.5-1.9-4-1.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="17.6" cy="12.1" r="0.9" fill="currentColor" />
    </svg>
  );
}

// A medal disc on a ribbon — diverging ribbon tails at top, a star inside
// the disc — distinct from RibbonIcon (used for the section itself) by
// having a filled disc rather than an open circle, and its own gold tone
// via CSS rather than sharing the section's terracotta accent.
function MedalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.5 3.5l2 5M15.5 3.5l-2 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="15" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11.8l1 2.1 2.3.33-1.65 1.6.4 2.28L12 17l-2.05 1.1.4-2.27-1.65-1.6 2.3-.33z" fill="currentColor" />
    </svg>
  );
}

function RibbonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 13l-2 8 5.5-3 5.5 3-2-8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.6 4.7L18.3 9.3l-4.7 1.6L12 15.6l-1.6-4.7L5.7 9.3l4.7-1.6L12 3z" fill="currentColor" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="7.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

function DocGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
