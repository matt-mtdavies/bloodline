import { useEffect, useRef, useState } from 'react';
import SmartImg from './SmartImg.jsx';
import { streamBio } from '../lib/ai.js';
import {
  militaryEvents, militaryDocuments, militaryQuotes, serviceYears,
  hasMilitaryService, canGenerateMilitaryStory,
} from '../lib/military.js';

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
 *     fact or invent a posting the records never mentioned. Same review
 *     discipline as the general Life Story — Keep it / Fix it / Dismiss,
 *     Edit + Regenerate afterward — and stored separately
 *     (person.military_story), never overwriting the general story.
 *   - the record: bureaucratic fact, tabular and quiet.
 *   - the story-in-fragments: verbatim quotes from the documents
 *     themselves — the human voice inside the paperwork, sitting
 *     alongside the narrative rather than being replaced by it.
 */
export default function MilitaryService({ person, personDocs, onOpenDocument, onUpdateMilitaryStory, canEdit = true }) {
  const storyAbort = useRef(null);
  const [storyState, setStoryState] = useState({ phase: 'idle', text: '', error: null });
  const [storyNotes, setStoryNotes] = useState('');
  const [storyEditing, setStoryEditing] = useState(false);
  const [storyEditDraft, setStoryEditDraft] = useState('');

  // Same reset as PersonSheet's own story state: this component doesn't
  // remount when the viewed person changes (PersonSheet swaps `person` in
  // place), so without this a stream started for one person could still be
  // "generating" on someone else's profile a moment later.
  useEffect(() => {
    storyAbort.current?.abort();
    storyAbort.current = null;
    setStoryState({ phase: 'idle', text: '', error: null });
    setStoryEditing(false);
  }, [person?.id]);

  if (!hasMilitaryService(person, personDocs)) return null;

  const events = militaryEvents(person);
  const docs = militaryDocuments(personDocs);
  const quotes = militaryQuotes(personDocs);
  const years = serviceYears(events);
  const canGenerate = canGenerateMilitaryStory(person, personDocs);

  const generateMilitaryStory = async (feedback) => {
    storyAbort.current?.abort();
    const ac = new AbortController();
    storyAbort.current = ac;
    const previousStory = storyState.text || person.military_story || '';
    setStoryState({ phase: 'generating', text: '', error: null });
    setStoryNotes('');

    await streamBio(
      person,
      {
        focus: 'military',
        militaryEvents: events,
        militaryQuotes: militaryQuotes(personDocs, Infinity),
        feedback: feedback?.trim() || undefined,
        previousStory: feedback?.trim() ? previousStory : undefined,
      },
      {
        signal: ac.signal,
        onChunk: (text) => setStoryState((s) => ({ ...s, text: s.text + text })),
        onDone: () => setStoryState((s) => ({ ...s, phase: 'done' })),
        onError: (err) => {
          if (!err) return; // aborted — no-op
          setStoryState({ phase: 'idle', text: '', error: err.message });
        },
      },
    );
  };

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

      {/* The narrative — optional, AI-drafted, grounded only in the material
          above. Same UX as the general Life Story, kept in its own field. */}
      {(canEdit || person.military_story) && (
        <div className="military__narrative">
          {!storyEditing && person.military_story && storyState.phase === 'idle' && !storyState.error && canEdit && (
            <div className="military__narrative-actions">
              <button
                className="story-regen"
                onClick={() => { setStoryEditDraft(person.military_story); setStoryEditing(true); }}
              >
                Edit
              </button>
              <button className="story-regen" onClick={() => setStoryState((s) => ({ ...s, phase: 'revising' }))}>
                Regenerate
              </button>
            </div>
          )}

          {storyState.phase === 'idle' && storyState.error && (
            <p className="story-error">{storyState.error}</p>
          )}

          {canEdit && storyState.phase === 'idle' && storyState.error && (
            <button className="story-regen" onClick={() => generateMilitaryStory()}>
              Try again
            </button>
          )}

          {canEdit && canGenerate && storyState.phase === 'idle' && !person.military_story && !storyState.error && (
            <button className="ai-generate" onClick={() => generateMilitaryStory()}>
              <SparkleIcon />
              Generate this chapter with AI
            </button>
          )}

          {storyEditing ? (
            <div className="story-edit">
              <textarea
                className="field__input field__input--area story-edit__textarea"
                rows={10}
                autoFocus
                value={storyEditDraft}
                onChange={(e) => setStoryEditDraft(e.target.value)}
              />
              <div className="story-actions">
                <button
                  className="btn btn--primary"
                  onClick={() => {
                    onUpdateMilitaryStory?.(person.id, storyEditDraft.trim());
                    setStoryEditing(false);
                  }}
                  disabled={!storyEditDraft.trim()}
                >
                  Save
                </button>
                <button className="btn" onClick={() => setStoryEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            storyState.phase === 'idle' && person.military_story && (
              <p className="story">{person.military_story}</p>
            )
          )}

          {(storyState.phase === 'generating' || storyState.phase === 'done' || storyState.phase === 'revising') && (
            <p className={`story${storyState.phase === 'generating' ? ' story--generating' : ''}`}>
              {storyState.text || person.military_story}
            </p>
          )}

          {storyState.phase === 'done' && (
            <>
              <div className="story-actions">
                <button
                  className="btn btn--primary"
                  onClick={() => {
                    onUpdateMilitaryStory?.(person.id, storyState.text);
                    setStoryState({ phase: 'idle', text: '', error: null });
                  }}
                >
                  Keep it
                </button>
                <button className="btn" onClick={() => setStoryState((s) => ({ ...s, phase: 'revising' }))}>
                  Fix it
                </button>
                <button className="btn" onClick={() => setStoryState({ phase: 'idle', text: '', error: null })}>
                  Dismiss
                </button>
              </div>
              <p className="story-note">Generated by AI · review before keeping</p>
            </>
          )}

          {storyState.phase === 'revising' && (
            <div className="story-revise">
              <textarea
                className="field__input field__input--area"
                rows={3}
                autoFocus
                value={storyNotes}
                onChange={(e) => setStoryNotes(e.target.value)}
                placeholder="What's not right? e.g. He was discharged in 1946, not 1947."
              />
              <div className="story-actions">
                <button className="btn btn--primary" onClick={() => generateMilitaryStory(storyNotes)}>
                  Regenerate
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setStoryNotes('');
                    setStoryState((s) => ({ ...s, phase: s.text ? 'done' : 'idle' }));
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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

function DocGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
