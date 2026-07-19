import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import SmartImg from './SmartImg.jsx';
import { lifespan, formatDate, ageOrAt, yearOf } from '../lib/dates.js';
import { relationLabel } from '../data/graph.js';
import { useKinTerms } from '../lib/kinTerms.js';
import { profileCompleteness, lifeEvents, fullName } from '../lib/profile.js';
import { fileToDataUrl, uploadPhoto, uploadDocument, suggestDocumentTitle, imageSrcToDataUrl } from '../lib/image.js';
import { streamBio } from '../lib/ai.js';
import EnrichSheet from './EnrichSheet.jsx';
import MilitaryService from './MilitaryService.jsx';
import DateField from './DateField.jsx';
import { VISIBILITY_LABELS, VISIBILITY_DESCS } from '../lib/visibility.js';
import { HEALTH_CATEGORIES, HEALTH_CONDITIONS, HEALTH_STATUSES, colorFor } from '../lib/health.js';
import { formatPhone, isPhoneValid } from '../lib/phone.js';
import { militaryDocuments } from '../lib/military.js';
import { dayLabel } from './ActivityFeed.jsx';

// How many facts (events, medals, profile fields) a document still owns on
// this person — see store.js's retractDocumentContributions, which this
// count previews before the user commits to deleting the document. Zero for
// the common case (a document nobody's accepted anything from yet, or one
// whose accepted facts were later hand-corrected and lost their field_sources
// tag), in which case the confirm below stays the plain, unqualified prompt.
function documentContributionCount(person, docId) {
  if (!person) return 0;
  const events = (person.events || []).filter((e) => e.sourceDocId === docId).length;
  const medals = (person.military_medals || []).filter((m) => m.sourceDocId === docId).length;
  const fields = Object.values(person.field_sources || {}).filter((id) => id === docId).length;
  return events + medals + fields;
}

const HAIR_DOTS = { Black: '#1a1a1a', Brown: '#6b4226', Blonde: '#d4b483', Auburn: '#9b3a1e', Red: '#c0392b', Grey: '#9e9e9e', White: '#ddd' };
const EYE_DOTS  = { Brown: '#6b4226', Blue: '#4a7fbf', Green: '#3d8c55', Hazel: '#8b6914', Grey: '#8a9099', Amber: '#c8860a' };

/*
 * The profile. In V2 this is the destination, not a popover — a portrait,
 * a life, and the beginnings of the stories that should outlast a person.
 * The tree recedes behind it; this rises as a full reading surface.
 *
 * Living minors get a light privacy note rather than full exposure (§7).
 */
export default function PersonSheet({
  graph,
  personId,
  viewerId,
  memories = [],
  photos = [],
  documents = [],
  activity = [],
  lockEscape = false,
  onClose,
  onFocus,
  onShowOnMap,
  onOpenPerson,
  onAddRelative,
  onEdit,
  onEditTimeline,
  onAddMemory,
  onVoteMemory,
  onRemoveMemory,
  onUpdateMemory,
  onAddPhoto,
  onOpenLightbox,
  onAddDocument,
  onOpenDocument,
  onRemoveDocument,
  onUpdateDocument,
  onInvite,
  onRemoveRelationship,
  onUpdateRelationshipQualifier,
  onChangeRelationship,
  onUpdatePartnerMeta,
  onUpdateStory,
  onOpenKeepsake,
  onUpdateMilitaryStory,
  onUpdateMilitaryContext,
  onAddCondition,
  onRemoveCondition,
  onUpdateCondition,
  onUpdateHealthNotes,
  onPhoto,
  onLifeJourney,
  onMarkJoined,
  onReviewDuplicate,
  onApplyEnrichedPlace,
  onApplyDocumentFact,
  onDismissDocumentFact,
  onApplyDocumentMedal,
  onDismissDocumentMedal,
  onRemoveMedal,
  onApplyDocumentField,
  onDismissDocumentField,
  onApplyDocumentPerson,
  onDismissDocumentPerson,
  onApplyRelationshipFact,
  onDismissRelationshipFact,
  canEdit = true,        // editor+ : structural changes (people, relationships, edits)
  canContribute = true,  // contributor+ : add memories & photos
  isAdmin = true,        // owner/co-admin : manage anyone's memory, not just your own
}) {
  const person = personId ? graph.byId.get(personId) : null;
  const kinTerms = useKinTerms();
  const profileRef = useRef(null);
  const fileRef = useRef(null);
  const galleryRef = useRef(null);
  const docRef = useRef(null);
  const mediaRef = useRef(null);
  const storyAbort = useRef(null);
  const [storyState, setStoryState] = useState({ phase: 'idle', text: '', error: null });
  // Notes for the 'revising' phase — corrections the family gives before a
  // regenerate, e.g. "he was discharged in 1946, not 1947; there was no
  // appendectomy." Sent as feedback so the rewrite treats them as authoritative.
  const [storyNotes, setStoryNotes] = useState('');
  // Direct manual editing of an already-kept story — separate from the AI
  // revise flow above (storyState.phase === 'revising'), which sends
  // feedback back to the model. This is just a plain textarea, for anyone
  // who'd rather fix a word themselves than describe the fix to AI.
  const [storyEditing, setStoryEditing] = useState(false);
  const [storyEditDraft, setStoryEditDraft] = useState('');
  const [relMenuId, setRelMenuId] = useState(null);       // rel-chip whose ⋯ menu is open
  const [confirmUnlinkId, setConfirmUnlinkId] = useState(null); // rel-chip awaiting unlink confirm
  const [editingDocId, setEditingDocId] = useState(null);
  const [editingDocTitle, setEditingDocTitle] = useState('');
  const [confirmDeleteDocId, setConfirmDeleteDocId] = useState(null); // awaiting "remove this document?" confirm
  const [suggestingDocId, setSuggestingDocId] = useState(null); // doc awaiting an AI title suggestion
  const [showMilitaryDocs, setShowMilitaryDocs] = useState(false); // reveal docs already shown in Military Service
  const [editingMediaId, setEditingMediaId] = useState(null);
  const [editingMediaTitle, setEditingMediaTitle] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState(null);
  const [editingMemoryText, setEditingMemoryText] = useState('');
  const [editingMemoryAuthorId, setEditingMemoryAuthorId] = useState('');
  // Tap-to-arm confirm state for the three removals on this sheet that used
  // to fire instantly on a single tap (memory / voice-video / health
  // condition) — one id in flight at a time per kind, cleared on any other
  // action so a stale "remove?" never lingers armed in the background.
  const [confirmRemoveMemoryId, setConfirmRemoveMemoryId] = useState(null);
  const [confirmRemoveMediaId, setConfirmRemoveMediaId] = useState(null);
  const [confirmRemoveConditionId, setConfirmRemoveConditionId] = useState(null);
  const [healthPickerOpen, setHealthPickerOpen] = useState(false);
  const [healthCat, setHealthCat] = useState(HEALTH_CATEGORIES[0].id);
  const [statusPickId, setStatusPickId] = useState(null);
  const [healthNotesEditing, setHealthNotesEditing] = useState(false);
  const [healthNotesDraft, setHealthNotesDraft] = useState('');
  const [enrichOpen, setEnrichOpen] = useState(false);

  useEffect(() => {
    if (!person || lockEscape || enrichOpen) return; // a stacked overlay owns Escape
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [person, onClose, lockEscape, enrichOpen]);

  // Reset generation + health state whenever the viewed person changes.
  // Switching from a relationship chip swaps `person` in place (this sheet
  // stays mounted — see App.jsx's <PersonSheet personId={openId}>, no key
  // prop), so the scroll position was otherwise carried over from whoever
  // you were previously reading, landing you mid-page on someone new.
  useEffect(() => {
    storyAbort.current?.abort();
    storyAbort.current = null;
    setStoryState({ phase: 'idle', text: '', error: null });
    setHealthPickerOpen(false);
    setStatusPickId(null);
    setHealthNotesEditing(false);
    if (profileRef.current) profileRef.current.scrollTop = 0;
  }, [personId]);

  if (!person) return null;

  const minor = person.is_minor && !person.is_deceased;
  // Visibility: 'private' seals the profile; 'summary' shows name + dates only.
  // The local user is always the owner so they can see and edit everything —
  // this gate will matter for shared trees with viewer/contributor roles (Phase 4).
  const vis = person.visibility || 'full';
  const sealed = vis === 'private';
  const summaryOnly = vis === 'summary';
  const restricted = minor || sealed || summaryOnly; // hides sections

  const partners = graph.partners(person.id);
  const parents = graph.parents(person.id);
  const children = graph.children(person.id);
  const siblings = graph.siblings(person.id);

  const groups = [
    { title: partners.length > 1 ? 'Partners' : 'Partner', items: partners, relType: 'partner' },
    { title: 'Parents', items: parents, relType: 'parent_from_item' },
    { title: 'Children', items: children, relType: 'parent_from_self' },
    { title: 'Siblings', items: siblings, relType: null }, // derived — can't be directly removed
  ].filter((g) => g.items.length);

  // ── Extended family (derived, read-only) ──────────────────────────────────
  // Single shared seen set across all extended groups: each person appears once.
  const immediateIds = new Set([
    person.id,
    ...partners.map((x) => x.id),
    ...parents.map((x) => x.id),
    ...children.map((x) => x.id),
    ...siblings.map((x) => x.id),
  ]);
  const extSeen = new Set();
  const extDedup = (items) => {
    const out = [];
    for (const item of items) {
      if (!immediateIds.has(item.id) && !extSeen.has(item.id)) {
        extSeen.add(item.id);
        out.push(item);
      }
    }
    return out;
  };
  // Only bio/adoptive lines propagate upward — step-parent lines stop at the
  // immediate tier. Step grandparents/aunts are reachable by tapping the
  // step-parent's bubble, which keeps the extended section from exploding.
  const upwardParents = parents.filter(
    (p) => !p.qualifier || p.qualifier === 'biological' || p.qualifier === 'adoptive',
  );
  // Keep raw grandparent IDs (before dedup) so great-grandparents can be
  // derived from the full set even if some grandparents were deduped into
  // another group — same pattern as rawGrandchildIds below, going up
  // instead of down.
  const rawGrandparentIds = upwardParents.flatMap((p) => graph.parents(p.id).map((gp) => gp.id));
  const grandparents = extDedup(rawGrandparentIds.map((id) => ({ id })));
  const auntsUncles = extDedup(
    upwardParents.flatMap((p) => graph.siblings(p.id).map((s) => ({ id: s.id }))),
  );
  // Keep raw grandchild IDs (before dedup) so great-grandchildren can be derived
  // from the full set even if some grandchildren were deduped into another group.
  const rawGrandchildIds = children.flatMap((c) => graph.children(c.id).map((gc) => gc.id));
  const grandchildren = extDedup(rawGrandchildIds.map((id) => ({ id })));
  const niecesNephews = extDedup(
    siblings.flatMap((s) => graph.children(s.id).map((c) => ({ id: c.id }))),
  );
  // Cousins — children of the person's aunts & uncles (parents' siblings).
  const cousins = extDedup(
    upwardParents.flatMap((p) =>
      graph.siblings(p.id).flatMap((s) => graph.children(s.id).map((c) => ({ id: c.id }))),
    ),
  );
  const greatGrandparents = extDedup(
    rawGrandparentIds.flatMap((gpId) => graph.parents(gpId).map((ggp) => ({ id: ggp.id }))),
  );
  const greatGrandchildren = extDedup(
    rawGrandchildIds.flatMap((gcId) => graph.children(gcId).map((ggc) => ({ id: ggc.id }))),
  );
  const extendedGroups = [
    { title: 'Great Grandparents', items: greatGrandparents },
    { title: 'Grandparents', items: grandparents },
    { title: 'Aunts & Uncles', items: auntsUncles },
    { title: 'Cousins', items: cousins },
    { title: 'Grandchildren', items: grandchildren },
    { title: 'Nieces & Nephews', items: niecesNephews },
    { title: 'Great Grandchildren', items: greatGrandchildren },
  ].filter((g) => g.items.length);

  const relToViewer =
    viewerId && viewerId !== person.id ? relationLabel(graph, viewerId, person.id, kinTerms) : null;
  const location = person.residence || person.birth_place;
  const age = ageOrAt(person);
  const events = restricted ? [] : lifeEvents(person);
  const personMemories = restricted
    ? []
    : memories
        .filter((m) => m.person_id === person.id)
        .sort((a, b) => b.votes - a.votes || (a.created_at < b.created_at ? 1 : -1));
  const personPhotos = restricted ? [] : photos.filter((p) => p.person_id === person.id);
  const allPersonDocs = restricted ? [] : documents.filter((d) => d.person_id === person.id);
  const personDocs = allPersonDocs.filter(
    (d) => !d.mime?.startsWith('audio/') && !d.mime?.startsWith('video/'),
  );
  const personMedia = allPersonDocs.filter(
    (d) => d.mime?.startsWith('audio/') || d.mime?.startsWith('video/'),
  );
  // Documents already shown in the Military Service gallery above are
  // collapsed out of this list by default — same document, no reason to
  // list it twice — but stay one tap away (showMilitaryDocs) for anyone who
  // needs to rename, delete, or re-suggest a title, since the gallery above
  // is read-only.
  const militaryDocIds = new Set(militaryDocuments(personDocs).map((d) => d.id));
  const visibleDocs = personDocs.filter((d) => !militaryDocIds.has(d.id) || showMilitaryDocs);
  const completeness = restricted ? null : profileCompleteness(person, graph, personMemories.length);

  // Legacy memories (added before authorId existed) fall back to their old
  // free-text `author` string for display; only an admin can manage those,
  // since there's no reliable way to attribute them to anyone specific.
  // "You" specifically was never a real name — it's what the old composer
  // defaulted to when the free-text field was left blank, and it only ever
  // meant "the person typing this, right now" to whoever wrote it. Displayed
  // to anyone else later, it reads as "you personally added this", which is
  // wrong as often as not. Show a neutral label instead until an admin
  // reassigns it to whoever actually wrote it (see the author picker below).
  const memoryAuthorLabel = (mem) => {
    if (mem.anonymous) return mem.authorId === viewerId ? 'Anonymous (you)' : 'Anonymous';
    if (mem.authorId) return graph.byId.get(mem.authorId)?.display_name || 'Someone';
    if (!mem.author?.trim() || mem.author.trim().toLowerCase() === 'you') return 'Family member';
    return mem.author;
  };
  const canManageMemory = (mem) => isAdmin || (!!mem.authorId && mem.authorId === viewerId);

  const generateStory = async (feedback) => {
    storyAbort.current?.abort();
    const ac = new AbortController();
    storyAbort.current = ac;
    const previousStory = storyState.text || person.story || '';
    setStoryState({ phase: 'generating', text: '', error: null });
    setStoryNotes('');

    const relSummary = [];
    for (const x of partners) {
      const p = graph.byId.get(x.id);
      if (p) relSummary.push({ label: 'Partner', name: p.display_name });
    }
    for (const x of parents) {
      const p = graph.byId.get(x.id);
      if (p) relSummary.push({ label: x.qualifier === 'biological' ? 'Parent' : `${x.qualifier} parent`, name: p.display_name });
    }
    for (const x of children) {
      const p = graph.byId.get(x.id);
      if (p) relSummary.push({ label: x.qualifier === 'biological' ? 'Child' : `${x.qualifier} child`, name: p.display_name });
    }

    const documentSummaries = allPersonDocs
      .filter((d) => d.summary)
      .map((d) => ({ title: d.title, summary: d.summary }));

    await streamBio(
      person,
      {
        memories: personMemories,
        relSummary,
        documentSummaries,
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

  // Upload a file: try R2 via Worker first, fall back to base64 for offline/unauthed users.
  const uploadDoc = async (file) => {
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await fetch('/api/documents', { method: 'POST', body: form });
      if (res.ok) {
        const { url } = await res.json();
        return url;
      }
    } catch {
      /* network error — fall through to base64 */
    }
    // Base64 fallback (localStorage; cap 8 MB).
    if (file.type.startsWith('image/')) return fileToDataUrl(file, 1200);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const openDoc = (doc) => onOpenDocument?.(doc);

  const onDocPick = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const file of files) {
      try {
        if (file.size > 20 * 1024 * 1024) continue;
        let title = file.name.replace(/\.[^.]+$/, '');
        const src = await uploadDoc(file);
        let thumb = null;
        let preview = null; // small image handed to the title suggester below
        if (file.type === 'application/pdf') {
          // Lazy-loaded — pdf.js is a large dependency only worth paying for
          // when someone actually uploads a PDF (see PdfViewer.jsx).
          const { generatePdfThumbnail } = await import('../lib/pdf.js');
          thumb = await generatePdfThumbnail(src);
          preview = thumb;
        } else if (file.type.startsWith('image/')) {
          preview = await fileToDataUrl(file, 1000).catch(() => null);
        }
        // Read any heading/letterhead/document type off the page itself —
        // "Certificate of Discharge" beats whatever the camera named the
        // file. Best-effort: falls straight back to the filename above if
        // AI isn't configured, the request fails, or there's nothing to read.
        if (preview) {
          const suggested = await suggestDocumentTitle(preview);
          if (suggested) title = suggested;
        }
        // Upload the PDF preview to R2 immediately, the same as `src` above,
        // rather than storing it inline forever — thumb was the one field
        // that never got this treatment (docs/TREE-STORAGE.md §3, Phase 0),
        // and it's permanent per-document, so fixing it at the source means
        // no NEW document ever adds to the problem, even before existing
        // ones are migrated by migrateDocThumbsToR2 on next login.
        if (thumb) thumb = await uploadDocument(thumb, { title: `${title}-thumb`, mime: 'image/jpeg' });
        onAddDocument?.(person.id, { title, mime: file.type, src, thumb });
      } catch {
        /* skip unreadable file */
      }
    }
  };

  // Re-run the same title suggestion against a document that's already been
  // uploaded — fixes the legacy "IMG_0166"/"image" titles that predate this
  // feature, without needing to re-upload anything. Reads the doc's own
  // image (downscaled fresh from its src) or, for a PDF, its existing
  // first-page thumbnail — same best-effort contract as onDocPick: any
  // failure just leaves the current title untouched.
  const suggestTitleForExistingDoc = async (doc) => {
    if (suggestingDocId) return;
    setSuggestingDocId(doc.id);
    try {
      const preview = doc.mime?.startsWith('image/')
        ? await imageSrcToDataUrl(doc.src, 1000).catch(() => null)
        : doc.thumb || null;
      if (!preview) return;
      const suggested = await suggestDocumentTitle(preview);
      if (suggested) onUpdateDocument?.(doc.id, { title: suggested });
    } finally {
      setSuggestingDocId(null);
    }
  };

  const onMediaPick = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const file of files) {
      try {
        if (file.size > 200 * 1024 * 1024) continue;
        const title = file.name.replace(/\.[^.]+$/, '');
        const src = await uploadDoc(file);
        onAddDocument?.(person.id, { title, mime: file.type, src });
      } catch {
        /* skip unreadable file */
      }
    }
  };

  // Picked gallery files are downscaled then uploaded to R2.
  const onGalleryPick = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const file of files) {
      try {
        const dataUrl = await fileToDataUrl(file, 1800);
        const src = await uploadPhoto(dataUrl); // R2 URL or data URL fallback
        onAddPhoto?.(person.id, src);
      } catch {
        /* skip an unreadable file */
      }
    }
  };

  const metaBits = [];
  if (person.occupation) metaBits.push(person.occupation);
  metaBits.push(lifespan(person));
  if (age) metaBits.push(person.is_deceased ? age : `age ${age}`);

  // Who added this record, and when — real user report: "if there has been
  // a mistake made, it would be good to know who added them and why."
  // person.created_by is unreliable dead data (always the literal 'me'), but
  // the activity log's person_added event already carries a real author —
  // just not surfaced here until now. Re-resolves the author's CURRENT
  // display name from their email (same convention as ActivityFeed's own
  // nameByEmail) rather than trusting the name string frozen at add-time,
  // so a later name correction is reflected here too.
  const creatorEvent = activity.find((e) => e.type === 'person_added' && e.personId === person.id) || null;
  let creatorName = null;
  if (creatorEvent) {
    const email = (creatorEvent.authorEmail || '').toLowerCase();
    for (const p of graph.people) {
      if ((p.email && p.email.toLowerCase() === email) || (p.invited_email && p.invited_email.toLowerCase() === email)) {
        creatorName = p.display_name;
        break;
      }
    }
    if (!creatorName) creatorName = creatorEvent.authorName;
  }

  // "2026-06-22" → "Jun 2026"
  function fmtDocDate(iso) {
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString('en', { month: 'short', year: 'numeric' });
    } catch {
      return iso;
    }
  }

  return (
    <div className="profile-scrim" onClick={onClose}>
      <article
        ref={profileRef}
        className="profile"
        role="dialog"
        aria-modal="true"
        aria-label={`${person.display_name} profile`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="profile__close" onClick={onClose} aria-label="Close profile">
          <CloseIcon />
        </button>
        <button className="profile__centre" onClick={() => onFocus(person.id)} aria-label="Centre the tree here">
          <CrosshairIcon />
        </button>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <header className="profile__hero">
          {canEdit ? (
            <>
              <button
                className="avatar-edit avatar-edit--lg"
                onClick={() => fileRef.current?.click()}
                aria-label={person.photo ? 'Change photo' : 'Add a photo'}
                title={person.photo ? 'Change photo' : 'Add a photo'}
              >
                <Avatar person={person} size={108} />
                <span className="avatar-edit__badge">
                  <CameraIcon />
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onPhoto?.(person.id, file);
                  e.target.value = '';
                }}
              />
            </>
          ) : (
            <Avatar person={person} size={108} />
          )}

          {relToViewer && <p className="profile__kin">{relToViewer}</p>}
          <h2 className="profile__name">{fullName(person)}</h2>
          {person.birth_name && (
            <p className="profile__birth-name">née {person.birth_name}</p>
          )}
          <p className="profile__meta">{metaBits.join('  ·  ')}</p>
          {location && (
            <p className="profile__where">
              <PinIcon />
              {location}
            </p>
          )}
          {creatorEvent && creatorName && (
            <p className="profile__added-by">Added by {creatorName} · {dayLabel(creatorEvent.created_at)}</p>
          )}

          <div className="profile__badges">
            {person.is_deceased && <span className="badge badge--memorial">In loving memory</span>}
            {minor && <span className="badge badge--quiet">Child · limited details</span>}
            {!minor && sealed && <span className="badge badge--private">Private</span>}
            {!minor && summaryOnly && <span className="badge badge--summary">Protected</span>}
            {person.confidence === 'uncertain' && (
              <span className="badge badge--quiet">Unconfirmed</span>
            )}
          </div>

          {!restricted && (person.tags?.length > 0 || person.hair_color || person.eye_color) && (
            <ul className="tags">
              {person.hair_color && (
                <li className="tag tag--trait" key="hair">
                  <span className="tag__dot" style={{ background: HAIR_DOTS[person.hair_color] || '#bbb', boxShadow: person.hair_color === 'White' ? 'inset 0 0 0 1px #ccc' : undefined }} />
                  {person.hair_color} hair
                </li>
              )}
              {person.eye_color && (
                <li className="tag tag--trait" key="eye">
                  <span className="tag__dot" style={{ background: EYE_DOTS[person.eye_color] || '#bbb' }} />
                  {person.eye_color} eyes
                </li>
              )}
              {person.tags?.map((t) => (
                <li className="tag" key={t}>{t}</li>
              ))}
            </ul>
          )}
        </header>

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        {/* Add relative + Profile share one even row when that's the whole
            row (nothing to invite); once the Invite button also needs to be
            there, Add relative takes its own full-width row above so the
            other two aren't squeezed three-across. */}
        <div className={`profile__actions${person.invited_at ? '' : ' profile__actions--has-invite'}`}>
          <button className="action action--map" onClick={() => onShowOnMap?.(person.id)} aria-label={`Show ${person.display_name.split(' ')[0]} in the tree`}>
            <TreeIcon />
            Show in tree
          </button>
          {canEdit && (
            <button className="action action--primary" onClick={() => onAddRelative?.(person.id)}>
              <PlusIcon />
              Add a relative
            </button>
          )}
          {canEdit && (
            <button className="action" onClick={() => onEdit?.(person.id)}>
              <PencilIcon />
              Profile
            </button>
          )}
          {!person.invited_at && (
            <button className="action action--invite" onClick={() => onInvite?.(person.id)} aria-label={`Invite ${person.display_name.split(' ')[0]}`}>
              <EnvelopeIcon />
              Invite
            </button>
          )}
          {onOpenKeepsake && (person.visibility || 'full') !== 'private' && (
            <button className="ks-entry" onClick={() => onOpenKeepsake(person.id)}>
              {/* A miniature of the book's own cover — portrait (or the
                  bare-cover wash) with the name set small in serif. */}
              <span className="ks-entry__cover" aria-hidden="true">
                {person.photo && <img src={person.photo} alt="" />}
                <span className="ks-entry__cover-name">{person.display_name.split(/\s+/)[0]}</span>
              </span>
              <span className="ks-entry__text">
                <strong>Keepsake</strong>
                <span>The illustrated story of their life — read it, print it, keep it</span>
              </span>
            </button>
          )}
          {person.birth_date && !restricted && (
            <button className="action action--journey" onClick={() => onLifeJourney?.(person.id)} aria-label={`Watch ${person.display_name.split(' ')[0]}'s life story`}>
              <FilmIcon />
              Watch {person.display_name.split(' ')[0]}&apos;s life story
            </button>
          )}
        </div>

        {/* Placeholder nudge — these stand-in parents are auto-created so a lone
            person's siblings have something to hang from; prompt to name them. */}
        {canEdit && person.confidence === 'uncertain' && /\b(father|mother|parent)\b/i.test(person.display_name) && (
          <button className="profile__placeholder" onClick={() => onEdit?.(person.id)}>
            <span className="profile__placeholder-icon"><PencilIcon /></span>
            <span>This is a placeholder — tap to add their real name and details.</span>
          </button>
        )}

        {/* Invited state banner — hides itself once the invite has been
            accepted (joined_at set, e.g. via claiming their spot). Also
            offers a manual way to clear it for invites accepted before that
            tracking existed. */}
        {person.invited_at && person.invited_email && !person.joined_at && (
          <div className="profile__invited">
            <CheckCircleIcon />
            <span>
              Invited · <span className="profile__invited-email">{person.invited_email}</span>
            </span>
            <span className="profile__invited-actions">
              <button className="profile__invited-resend" onClick={() => onInvite?.(person.id)}>Resend</button>
              {canEdit && (
                <button className="profile__invited-resend" onClick={() => onMarkJoined?.(person.id)}>
                  Already joined
                </button>
              )}
            </span>
          </div>
        )}

        {/* Quiet access link — once someone has joined, changing their role
            or grabbing a fresh share link is a rare, low-stakes action, so
            it doesn't need the same visual weight as the Invite button
            above (which only shows before they've ever been invited). */}
        {canEdit && !person.is_deceased && person.joined_at && (
          <button className="profile__access-link" onClick={() => onInvite?.(person.id)}>
            Manage access
          </button>
        )}

        {(minor || sealed || summaryOnly) ? (
          <div className="profile__restricted">
            <p className="profile__private">
              {sealed
                ? 'Details are private and only visible to family admins.'
                : summaryOnly
                  ? 'Bio, memories and photos are protected and only visible to family admins.'
                  : 'Details for children are kept private and shared only within the family.'}
            </p>
            <button className="profile__privacy-edit" onClick={() => onEdit?.(person.id)}>
              <LockIcon /> Change privacy
            </button>
          </div>
        ) : (
          <div className="profile__body">
            {completeness && completeness.score < 100 && (
              <div className="meter" aria-label={`Profile ${completeness.score}% complete`}>
                <div className="meter__top">
                  <span className="meter__pct">{completeness.score}% complete</span>
                  <span className="meter__missing">
                    Add {completeness.missing.slice(0, 2).join(', ').toLowerCase()}
                    {completeness.missing.length > 2 ? '…' : ''}
                  </span>
                </div>
                <div className="meter__bar">
                  <span className="meter__fill" style={{ width: `${completeness.score}%` }} />
                </div>
              </div>
            )}

            {canEdit && (
              <button className="enrich-trigger" onClick={() => setEnrichOpen(true)}>
                <SparkleIcon /> Enrich this profile
              </button>
            )}

            {/* Contact — living people only */}
            {!person.is_deceased && (
              <section className="profile-section">
                <div className="profile-section__head">
                  <h3 className="profile-section__title">Contact</h3>
                  <button className="section-edit" onClick={() => onEdit?.(person.id)}>Edit</button>
                </div>
                {(person.email || person.phone) ? (
                  <div className="contact-card">
                    {person.email && (
                      <a href={`mailto:${person.email}`} className="contact-row">
                        <span className="contact-row__icon"><EmailIcon /></span>
                        <span className="contact-row__value">{person.email}</span>
                        <span className="contact-row__action">Email</span>
                      </a>
                    )}
                    {person.phone && (
                      <a href={`tel:${person.phone}`} className="contact-row">
                        <span className="contact-row__icon"><PhoneIcon /></span>
                        <span className="contact-row__valuewrap">
                          <span className="contact-row__value">{formatPhone(person.phone)}</span>
                          {!isPhoneValid(person.phone) && (
                            <span className="contact-row__flag" title="Missing a recognised country code — open Edit to fix">
                              Needs a country code
                            </span>
                          )}
                        </span>
                        <span className="contact-row__action">Call</span>
                      </a>
                    )}
                  </div>
                ) : (
                  <button className="empty-add" onClick={() => onEdit?.(person.id)}>
                    <PlusIcon />
                    Add email or phone number
                  </button>
                )}
              </section>
            )}

            {/* About */}
            {person.bio && (
              <section className="profile-section">
                <h3 className="profile-section__title">About</h3>
                <p className="profile__about">{person.bio}</p>
              </section>
            )}

            {/* Key life events */}
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">Key life events</h3>
                {canEdit && (
                  <button className="section-edit" onClick={() => onEditTimeline?.(person.id)}>
                    {events.length > 0 ? 'Edit' : null}
                  </button>
                )}
              </div>
              {events.length > 0 ? (
                <ol className="timeline">
                  {events.map((e, i) => (
                    <li className="timeline__item" key={`${e.year}-${i}`}>
                      <span className="timeline__year">{e.year}</span>
                      <span className="timeline__dot" aria-hidden="true" />
                      <span className="timeline__body">
                        <span className="timeline__title">
                          {e.tag === 'military' && (
                            <span className="timeline__ribbon" title="Military service" aria-label="Military service">
                              <RibbonIcon />
                            </span>
                          )}
                          {e.title}
                        </span>
                        {e.detail && <span className="timeline__detail">{e.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : canEdit ? (
                <button className="empty-add" onClick={() => onEditTimeline?.(person.id)}>
                  <PlusIcon />
                  Add a life event
                </button>
              ) : (
                <p className="profile-section__empty">No life events yet</p>
              )}
            </section>

            {/* Memories — the heart of the profile. */}
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">
                  Memories{personMemories.length > 0 ? ` · ${personMemories.length}` : ''}
                </h3>
                {canContribute && (
                  <button className="section-edit" onClick={() => onAddMemory?.(person.id)}>
                    Add
                  </button>
                )}
              </div>

              {personMemories.length > 0 ? (
                <ul className="memories">
                  {personMemories.map((mem) => (
                    <li className="memory" key={mem.id}>
                      {editingMemoryId === mem.id ? (
                        <div className="memory__editing">
                          <textarea
                            className="field__input field__input--area"
                            rows={3}
                            autoFocus
                            value={editingMemoryText}
                            onChange={(e) => setEditingMemoryText(e.target.value)}
                          />
                          {isAdmin && (
                            <label className="memory__author-picker">
                              <span className="field__label">Author</span>
                              <select
                                className="field__input"
                                value={editingMemoryAuthorId}
                                onChange={(e) => setEditingMemoryAuthorId(e.target.value)}
                              >
                                <option value="">Unknown / not sure</option>
                                {[...graph.people]
                                  .sort((a, b) => a.display_name.localeCompare(b.display_name))
                                  .map((p) => (
                                    <option key={p.id} value={p.id}>{p.display_name}</option>
                                  ))}
                              </select>
                            </label>
                          )}
                          <div className="memory__editing-actions">
                            <button
                              className="section-edit"
                              onClick={() => {
                                const t = editingMemoryText.trim();
                                if (t) {
                                  onUpdateMemory?.(mem.id, {
                                    text: t,
                                    ...(isAdmin ? { authorId: editingMemoryAuthorId || null } : {}),
                                  });
                                }
                                setEditingMemoryId(null);
                              }}
                            >
                              Save
                            </button>
                            <button className="section-edit" onClick={() => setEditingMemoryId(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="memory__text">{mem.text}</p>
                      )}
                      <div className="memory__foot">
                        <span className="memory__by">{memoryAuthorLabel(mem)}</span>
                        <span className="memory__actions">
                          {canManageMemory(mem) && editingMemoryId !== mem.id && (
                            <>
                              <button
                                className="memory__edit"
                                onClick={() => {
                                  setEditingMemoryId(mem.id);
                                  setEditingMemoryText(mem.text);
                                  setEditingMemoryAuthorId(mem.authorId || '');
                                }}
                                aria-label="Edit memory"
                              >
                                Edit
                              </button>
                              <button
                                className="memory__del"
                                onClick={() => setConfirmRemoveMemoryId(mem.id)}
                                aria-label="Remove memory"
                              >
                                Remove
                              </button>
                            </>
                          )}
                          <button
                            className={'memory__vote' + (mem.youVoted ? ' memory__vote--on' : '')}
                            onClick={() => onVoteMemory?.(mem.id)}
                            aria-pressed={mem.youVoted}
                            aria-label={`${mem.votes} ${mem.votes === 1 ? 'person finds' : 'people find'} this meaningful`}
                          >
                            <HeartIcon filled={mem.youVoted} />
                            {mem.votes > 0 ? mem.votes : ''}
                          </button>
                        </span>
                      </div>
                      {confirmRemoveMemoryId === mem.id && (
                        <div className="inline-confirm">
                          <span>Remove this memory? This can&apos;t be undone.</span>
                          <div className="inline-confirm-btns">
                            <button
                              className="inline-confirm-remove"
                              onClick={() => { onRemoveMemory?.(mem.id); setConfirmRemoveMemoryId(null); }}
                            >
                              Remove
                            </button>
                            <button className="inline-confirm-cancel" onClick={() => setConfirmRemoveMemoryId(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : canContribute ? (
                <button className="empty-add" onClick={() => onAddMemory?.(person.id)}>
                  <PlusIcon />
                  Be the first to add a memory
                </button>
              ) : (
                <p className="profile-section__empty">No memories yet</p>
              )}
            </section>

            {/* Photos */}
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">
                  Photos{personPhotos.length > 0 ? ` · ${personPhotos.length}` : ''}
                </h3>
                {canContribute && (
                  <button className="section-edit" onClick={() => galleryRef.current?.click()}>
                    Add
                  </button>
                )}
              </div>
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={onGalleryPick}
              />
              {personPhotos.length > 0 ? (
                <ul className="gallery">
                  {personPhotos.map((ph, idx) => (
                    <li key={ph.id}>
                      <button
                        className="gallery__cell"
                        onClick={() => onOpenLightbox?.(person.id, idx)}
                        aria-label={ph.caption || 'View photo'}
                      >
                        <SmartImg src={ph.src} alt={ph.caption || ''} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : canContribute ? (
                <button className="empty-add" onClick={() => galleryRef.current?.click()}>
                  <PlusIcon />
                  Add photos
                </button>
              ) : (
                <p className="profile-section__empty">No photos yet</p>
              )}
            </section>

            <MilitaryService
              person={person}
              personDocs={personDocs}
              onOpenDocument={openDoc}
              onUpdateMilitaryStory={onUpdateMilitaryStory}
              onUpdateMilitaryContext={onUpdateMilitaryContext}
              onDismissDocumentFact={onDismissDocumentFact}
              onRemoveMedal={onRemoveMedal}
              canEdit={canEdit}
            />

            {/* Documents */}
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">
                  Documents{personDocs.length > 0 ? ` · ${personDocs.length}` : ''}
                </h3>
                {canEdit && (
                  <button className="section-edit" onClick={() => docRef.current?.click()}>
                    Add
                  </button>
                )}
              </div>
              <input
                ref={docRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                hidden
                onChange={onDocPick}
              />
              {personDocs.length > 0 ? (
                <ul className="doc-list">
                  {visibleDocs.map((doc) => (
                    <li key={doc.id}>
                      <div className="doc-card">
                        <button
                          className="doc-card__preview"
                          onClick={() => openDoc(doc)}
                          aria-label={`Open ${doc.title}`}
                        >
                          {doc.mime?.startsWith('image/') ? (
                            <SmartImg src={doc.src} alt={doc.title} />
                          ) : doc.thumb ? (
                            <img src={doc.thumb} alt={doc.title} />
                          ) : (
                            <span className="doc-card__icon" aria-hidden="true">
                              <DocFileIcon />
                            </span>
                          )}
                        </button>
                        <div className="doc-card__body">
                          {editingDocId === doc.id ? (
                            <input
                              className="doc-row__title-input"
                              value={editingDocTitle}
                              autoFocus
                              onChange={(e) => setEditingDocTitle(e.target.value)}
                              onBlur={() => {
                                const t = editingDocTitle.trim();
                                if (t && t !== doc.title) onUpdateDocument?.(doc.id, { title: t });
                                setEditingDocId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                if (e.key === 'Escape') { setEditingDocId(null); }
                              }}
                            />
                          ) : (
                            <button
                              className="doc-card__title"
                              onClick={() => { setEditingDocId(doc.id); setEditingDocTitle(doc.title); }}
                              title="Tap to rename"
                            >
                              {doc.title}
                              <span className="doc-card__title-pencil" aria-hidden="true"><PencilIcon /></span>
                            </button>
                          )}
                          <span className="doc-card__meta">
                            {doc.mime === 'application/pdf' ? 'PDF' : 'Image'}{doc.created_at ? ` · ${fmtDocDate(doc.created_at)}` : ''}
                          </span>
                          {confirmDeleteDocId === doc.id ? (
                            <div className="doc-card__confirm">
                              <span>
                                {(() => {
                                  const n = documentContributionCount(person, doc.id);
                                  return n > 0
                                    ? `Remove this document — and the ${n} ${n === 1 ? 'fact it added' : 'facts it added'} to this profile?`
                                    : 'Remove this document?';
                                })()}
                              </span>
                              <div className="doc-card__confirm-btns">
                                <button
                                  className="doc-card__confirm-remove"
                                  onClick={() => { onRemoveDocument?.(doc.id); setConfirmDeleteDocId(null); }}
                                >
                                  Remove
                                </button>
                                <button
                                  className="doc-card__confirm-cancel"
                                  onClick={() => setConfirmDeleteDocId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="doc-card__actions">
                              <button className="doc-card__open" onClick={() => openDoc(doc)}>
                                Open
                              </button>
                              {(doc.mime?.startsWith('image/') || doc.thumb) && (
                                <button
                                  className="doc-card__suggest"
                                  onClick={() => suggestTitleForExistingDoc(doc)}
                                  disabled={suggestingDocId === doc.id}
                                  aria-label={`Suggest a title for ${doc.title}`}
                                  title="Reads the document and suggests a title from it"
                                >
                                  {suggestingDocId === doc.id ? (
                                    <span className="mw__spinner mw__spinner--sm" aria-hidden="true" />
                                  ) : (
                                    <SparkleIcon />
                                  )}
                                  {suggestingDocId === doc.id ? 'Suggesting…' : 'Suggest title'}
                                </button>
                              )}
                              <button
                                className="doc-card__del"
                                onClick={() => setConfirmDeleteDocId(doc.id)}
                                aria-label={`Remove ${doc.title}`}
                              >
                                <CloseIcon />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                  {militaryDocIds.size > 0 && (
                    <li>
                      <button className="doc-list__reveal" onClick={() => setShowMilitaryDocs((v) => !v)}>
                        <RibbonIcon />
                        {showMilitaryDocs
                          ? 'Hide documents shown in Military Service'
                          : `+ ${militaryDocIds.size} shown in Military Service`}
                      </button>
                    </li>
                  )}
                </ul>
              ) : canEdit ? (
                <button className="empty-add" onClick={() => docRef.current?.click()}>
                  <PlusIcon />
                  Add certificates, letters or records
                </button>
              ) : (
                <p className="profile-section__empty">No documents yet</p>
              )}
            </section>

            {/* Voice & Video */}
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">
                  Voice &amp; Video{personMedia.length > 0 ? ` · ${personMedia.length}` : ''}
                </h3>
                {canEdit && (
                  <button className="section-edit" onClick={() => mediaRef.current?.click()}>
                    Add
                  </button>
                )}
              </div>
              <input
                ref={mediaRef}
                type="file"
                accept="audio/*,video/*"
                multiple
                hidden
                onChange={onMediaPick}
              />
              {personMedia.length > 0 ? (
                <ul className="media-list">
                  {personMedia.map((item) => (
                    <li key={item.id} className="media-item">
                      <div className="media-item__header">
                        {editingMediaId === item.id ? (
                          <input
                            className="doc-row__title-input"
                            value={editingMediaTitle}
                            autoFocus
                            onChange={(e) => setEditingMediaTitle(e.target.value)}
                            onBlur={() => {
                              const t = editingMediaTitle.trim();
                              if (t && t !== item.title) onUpdateDocument?.(item.id, { title: t });
                              setEditingMediaId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape') setEditingMediaId(null);
                            }}
                          />
                        ) : (
                          <button
                            className="media-item__title"
                            onClick={() => { setEditingMediaId(item.id); setEditingMediaTitle(item.title); }}
                            title="Tap to rename"
                          >
                            {item.title}
                          </button>
                        )}
                        <span className="media-item__meta">
                          {item.mime?.startsWith('video/') ? 'Video' : 'Audio'}
                          {item.created_at ? ` · ${fmtDocDate(item.created_at)}` : ''}
                        </span>
                      </div>
                      {item.mime?.startsWith('video/') ? (
                        <video
                          className="media-item__player media-item__player--video"
                          src={item.src}
                          controls
                          preload="metadata"
                        />
                      ) : (
                        <audio
                          className="media-item__player media-item__player--audio"
                          src={item.src}
                          controls
                          preload="metadata"
                        />
                      )}
                      {confirmRemoveMediaId === item.id ? (
                        <div className="inline-confirm">
                          <span>Remove &ldquo;{item.title}&rdquo;? This can&apos;t be undone.</span>
                          <div className="inline-confirm-btns">
                            <button
                              className="inline-confirm-remove"
                              onClick={() => { onRemoveDocument?.(item.id); setConfirmRemoveMediaId(null); }}
                            >
                              Remove
                            </button>
                            <button className="inline-confirm-cancel" onClick={() => setConfirmRemoveMediaId(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="media-item__del"
                          onClick={() => setConfirmRemoveMediaId(item.id)}
                          aria-label={`Remove ${item.title}`}
                        >
                          <CloseIcon />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : canEdit ? (
                <button className="empty-add" onClick={() => mediaRef.current?.click()}>
                  <PlusIcon />
                  Add a voice message or video clip
                </button>
              ) : (
                <p className="profile-section__empty">No voice or video yet</p>
              )}
            </section>

            {/* Health history */}
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">
                  Health history{(person.conditions?.length || 0) > 0 ? ` · ${person.conditions.length}` : ''}
                </h3>
                {canEdit && (
                  <button
                    className="section-edit"
                    onClick={() => { setHealthPickerOpen((v) => !v); setStatusPickId(null); }}
                  >
                    {healthPickerOpen ? 'Done' : 'Add'}
                  </button>
                )}
              </div>
              {(person.conditions?.length || 0) > 0 && (
                <ul className="health-chips">
                  {person.conditions.map((c) => {
                    const catColor = colorFor(c.category);
                    const isPickingStatus = statusPickId === c.id;
                    const statusLabel = HEALTH_STATUSES.find((s) => s.key === c.status)?.label;
                    return (
                      <li key={c.id} className="health-chip">
                        <span className="health-chip__dot" style={{ background: catColor }} />
                        <button
                          className="health-chip__body"
                          onClick={() => canEdit && setStatusPickId(isPickingStatus ? null : c.id)}
                          title={canEdit ? 'Tap to change status' : undefined}
                        >
                          <span className="health-chip__name">{c.name}</span>
                          {c.status !== 'active' && (
                            <span className="health-chip__status">{statusLabel}</span>
                          )}
                        </button>
                        {isPickingStatus && (
                          <div className="health-chip__status-picker">
                            {HEALTH_STATUSES.map((s) => (
                              <button
                                key={s.key}
                                className={'health-status-opt' + (c.status === s.key ? ' health-status-opt--on' : '')}
                                onClick={() => {
                                  onUpdateCondition?.(person.id, c.id, { status: s.key });
                                  setStatusPickId(null);
                                }}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        )}
                        {canEdit && (
                          confirmRemoveConditionId === c.id ? (
                            <div className="inline-confirm">
                              <span>Remove {c.name}?</span>
                              <div className="inline-confirm-btns">
                                <button
                                  className="inline-confirm-remove"
                                  onClick={() => { onRemoveCondition?.(person.id, c.id); setConfirmRemoveConditionId(null); }}
                                >
                                  Remove
                                </button>
                                <button className="inline-confirm-cancel" onClick={() => setConfirmRemoveConditionId(null)}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="health-chip__remove"
                              onClick={() => { setStatusPickId(null); setConfirmRemoveConditionId(c.id); }}
                              aria-label={`Remove ${c.name}`}
                            >
                              <CloseIcon />
                            </button>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {healthPickerOpen && (
                <div className="condition-picker">
                  <div className="condition-picker__cats">
                    {HEALTH_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        className={'condition-cat' + (healthCat === cat.id ? ' condition-cat--on' : '')}
                        style={healthCat === cat.id ? { borderColor: cat.color, color: cat.color } : {}}
                        onClick={() => setHealthCat(cat.id)}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                  <div className="condition-picker__list">
                    {HEALTH_CONDITIONS.filter((c) => c.category === healthCat).map((cond) => {
                      const added = (person.conditions || []).some((c) => c.name === cond.name);
                      return (
                        <button
                          key={cond.name}
                          className={'condition-option' + (added ? ' condition-option--added' : '')}
                          disabled={added}
                          onClick={() => {
                            if (!added) onAddCondition?.(person.id, { name: cond.name, category: cond.category });
                          }}
                        >
                          {cond.name}
                          {added && <CheckedIcon />}
                        </button>
                      );
                    })}
                  </div>
                  {/* Free-text notes lives inside this same expanded editor
                      (not a second top-level "Add" pill) — one section, one
                      entry point, matching every other profile section. */}
                  {!person.health_notes && !healthNotesEditing && canEdit && (
                    <div className="condition-picker__notes">
                      <button
                        className="empty-add"
                        onClick={() => { setHealthNotesDraft(''); setHealthNotesEditing(true); }}
                      >
                        <PlusIcon />
                        Add free-text notes
                      </button>
                    </div>
                  )}
                </div>
              )}
              {canEdit && (person.conditions?.length || 0) === 0 && !healthPickerOpen && (
                <button className="empty-add" onClick={() => setHealthPickerOpen(true)}>
                  <PlusIcon />
                  Add health conditions
                </button>
              )}

              {/* Free-text notes — allergies, medications, family history,
                  anything that doesn't fit the structured condition chips above. */}
              {healthNotesEditing ? (
                <div className="health-notes health-notes--editing">
                  <textarea
                    className="field__input field__input--area"
                    rows={3}
                    autoFocus
                    value={healthNotesDraft}
                    onChange={(e) => setHealthNotesDraft(e.target.value)}
                    placeholder="Allergies, medications, family history — anything free-form…"
                  />
                  <div className="health-notes__foot">
                    <button
                      className="section-edit"
                      onClick={() => {
                        onUpdateHealthNotes?.(person.id, healthNotesDraft.trim());
                        setHealthNotesEditing(false);
                      }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : person.health_notes ? (
                <button
                  className="health-notes"
                  onClick={() => {
                    if (!canEdit) return;
                    setHealthNotesDraft(person.health_notes);
                    setHealthNotesEditing(true);
                  }}
                  title={canEdit ? 'Tap to edit' : undefined}
                >
                  {person.health_notes}
                </button>
              ) : null}

              <p className="health-privacy-note">
                <LockIcon />
                Health details are shared within your family only
              </p>
            </section>

            {/* Life Story — AI-generated from the person's timeline + memories. */}
            {(canEdit || person.story) && (
            <section className="profile-section">
              <div className="profile-section__head">
                <h3 className="profile-section__title">Life Story</h3>
                {!storyEditing && (
                  <div className="story-head-actions">
                    {canEdit && storyState.phase === 'idle' && person.story && !storyState.error && (
                      <>
                        <button
                          className="story-regen"
                          onClick={() => { setStoryEditDraft(person.story); setStoryEditing(true); }}
                        >
                          Edit
                        </button>
                        <button className="story-regen" onClick={() => setStoryState((s) => ({ ...s, phase: 'revising' }))}>
                          Regenerate
                        </button>
                      </>
                    )}
                    {canEdit && storyState.phase === 'idle' && storyState.error && (
                      <button className="story-regen" onClick={() => generateStory()}>
                        Try again
                      </button>
                    )}
                    {storyState.phase === 'generating' && (
                      <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>Writing…</span>
                    )}
                  </div>
                )}
              </div>

              {storyState.phase === 'idle' && storyState.error && (
                <p className="story-error">{storyState.error}</p>
              )}

              {canEdit && storyState.phase === 'idle' && !person.story && !storyState.error && (
                <button className="ai-generate" onClick={() => generateStory()}>
                  <SparkleIcon />
                  Generate life story with AI
                </button>
              )}

              {/* Direct manual editing — a plain textarea, no AI round-trip.
                  Saving writes straight through onUpdateStory, same as
                  "Keep it" below does for a freshly-generated draft. */}
              {storyEditing ? (
                <div className="story-edit">
                  <textarea
                    className="field__input field__input--area story-edit__textarea"
                    rows={12}
                    autoFocus
                    value={storyEditDraft}
                    onChange={(e) => setStoryEditDraft(e.target.value)}
                  />
                  <div className="story-actions">
                    <button
                      className="btn btn--primary"
                      onClick={() => {
                        onUpdateStory?.(person.id, storyEditDraft.trim());
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
                storyState.phase === 'idle' && person.story && (
                  <p className="story">{person.story}</p>
                )
              )}

              {(storyState.phase === 'generating' || storyState.phase === 'done' || storyState.phase === 'revising') && (
                <p className={`story${storyState.phase === 'generating' ? ' story--generating' : ''}`}>
                  {storyState.text || person.story}
                </p>
              )}

              {storyState.phase === 'done' && (
                <>
                  <div className="story-actions">
                    <button
                      className="btn btn--primary"
                      onClick={() => {
                        onUpdateStory?.(person.id, storyState.text);
                        setStoryState({ phase: 'idle', text: '', error: null });
                      }}
                    >
                      Keep it
                    </button>
                    <button
                      className="btn"
                      onClick={() => setStoryState((s) => ({ ...s, phase: 'revising' }))}
                    >
                      Fix it
                    </button>
                    <button
                      className="btn"
                      onClick={() => setStoryState({ phase: 'idle', text: '', error: null })}
                    >
                      Dismiss
                    </button>
                  </div>
                  <p className="story-note">Generated by AI · review before keeping</p>
                </>
              )}

              {/* Correct it and regenerate — the family's note is sent as
                  authoritative feedback (see functions/api/biography.js),
                  so a flagged mistake doesn't just re-roll the dice. */}
              {storyState.phase === 'revising' && (
                <div className="story-revise">
                  <textarea
                    className="field__input field__input--area"
                    rows={3}
                    autoFocus
                    value={storyNotes}
                    onChange={(e) => setStoryNotes(e.target.value)}
                    placeholder="What's not right? e.g. He was discharged in 1946, not 1947 — and there was no appendectomy."
                  />
                  <div className="story-actions">
                    <button className="btn btn--primary" onClick={() => generateStory(storyNotes)}>
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
            </section>
            )}

            {/* Relationships */}
            {(groups.length > 0 || extendedGroups.length > 0) && (
              <section className="profile-section">
                <h3 className="profile-section__title">Relationships</h3>
                {groups.map((g) => (
                  <div className="rel-group" key={g.title}>
                    <h4 className="rel-group__label">{g.title}</h4>
                    <ul className="rel-group__list">
                      {g.items.map((item) => {
                        const rel = graph.byId.get(item.id);
                        if (!rel) return null;
                        const unlinkArgs = g.relType === 'partner'
                          ? [person.id, item.id, 'partner']
                          : g.relType === 'parent_from_item'
                            ? [item.id, person.id, 'parent']
                            : g.relType === 'parent_from_self'
                              ? [person.id, item.id, 'parent']
                              : null;
                        const qualArgs = g.relType === 'parent_from_item'
                          ? [item.id, person.id]
                          : g.relType === 'parent_from_self'
                            ? [person.id, item.id]
                            : null;
                        // What this relationship can be changed *to* (from this
                        // person's perspective). kind is passed to onChangeRelationship.
                        // Partner branch depends on the CURRENT status — a former
                        // partner needs "Partner" offered to undo the mistake (real
                        // report: marked someone an ex-partner by accident and had
                        // no way back short of deleting and re-adding the whole
                        // relationship); a current partner needs "Ex-partner" as
                        // before. setRelationshipKind already writes both directions
                        // symmetrically — this was only ever a missing menu option.
                        const changeOptions = g.relType === 'partner'
                          ? item.status === 'former'
                            ? [{ kind: 'partner', label: 'Partner' }, { kind: 'child_of', label: 'Parent' }, { kind: 'parent_of', label: 'Child' }]
                            : [{ kind: 'ex_partner', label: 'Ex-partner' }, { kind: 'child_of', label: 'Parent' }, { kind: 'parent_of', label: 'Child' }]
                          : g.relType === 'parent_from_item'  // item is this person's parent
                            ? [{ kind: 'partner', label: 'Partner' }, { kind: 'parent_of', label: 'Child' }]
                            : g.relType === 'parent_from_self' // item is this person's child
                              ? [{ kind: 'partner', label: 'Partner' }, { kind: 'child_of', label: 'Parent' }]
                              : [];
                        const isMenuOpen = relMenuId === item.id;
                        const isConfirming = confirmUnlinkId === item.id;
                        const closeMenu = () => { setRelMenuId(null); setConfirmUnlinkId(null); };
                        // Same fields the "· Married {year}" / "· Separated {year}"
                        // sub-label above checks — when NEITHER is set, the only
                        // way in is the plain "⋮" icon, which gives no hint that
                        // marriage/separation info lives behind it at all (real
                        // feedback: "not all that clear yet to add marriage or
                        // separation"). hasMarriageInfo gates a louder, explicit
                        // entry point instead of only a passive sub-label.
                        const hasMarriageInfo = (item.is_married && item.marriage_date)
                          || (item.status === 'former' && item.separation_date);
                        return (
                          <li key={item.id} className={'rel-chip' + (isMenuOpen ? ' rel-chip--editing' : '')}>
                            <button className="rel-chip__nav" onClick={() => { closeMenu(); onOpenPerson(item.id); }}>
                              <Avatar person={rel} size={40} />
                              <span className="rel-chip__text">
                                <span className="rel-chip__name">{rel.display_name}</span>
                                <span className="rel-chip__kind">
                                  {relationLabel(graph, person.id, item.id, kinTerms)}
                                  {/* Visible at a glance rather than only inside the "⋮"
                                      manage menu — same is_married/marriage_date/
                                      separation_date the menu edits (real feedback:
                                      "there is a married component... but it's not
                                      obvious"). */}
                                  {g.relType === 'partner' && item.is_married && item.marriage_date && (
                                    <span className="rel-chip__marriage"> · Married {yearOf(item.marriage_date)}</span>
                                  )}
                                  {g.relType === 'partner' && item.status === 'former' && item.separation_date && (
                                    <span className="rel-chip__marriage"> · Separated {yearOf(item.separation_date)}</span>
                                  )}
                                </span>
                              </span>
                              <RelChevronIcon />
                            </button>
                            {canEdit && (unlinkArgs || qualArgs) && (
                              <button
                                className={'rel-chip__menu-btn' + (isMenuOpen ? ' rel-chip__menu-btn--on' : '')}
                                onClick={() => { setConfirmUnlinkId(null); setRelMenuId(isMenuOpen ? null : item.id); }}
                                aria-label={`Manage relationship with ${rel.display_name}`}
                                aria-expanded={isMenuOpen}
                              >
                                <DotsIcon />
                              </button>
                            )}
                            {canEdit && g.relType === 'partner' && !hasMarriageInfo && !isMenuOpen && (
                              <button
                                className="rel-chip__add-marriage"
                                onClick={() => { setConfirmUnlinkId(null); setRelMenuId(item.id); }}
                              >
                                + Add marriage details
                              </button>
                            )}
                            {canEdit && isMenuOpen && (
                              <div className="rel-menu">
                                {qualArgs && (
                                  <div className="rel-menu__group">
                                    <span className="rel-menu__label">Type</span>
                                    <div className="rel-menu__opts">
                                      {[
                                        { key: 'biological', label: 'Biological' },
                                        { key: 'step', label: 'Step' },
                                        { key: 'adoptive', label: 'Adopted' },
                                      ].map((q) => (
                                        <button
                                          key={q.key}
                                          className={'qual-opt' + ((item.qualifier || 'biological') === q.key ? ' qual-opt--on' : '')}
                                          onClick={() => { onUpdateRelationshipQualifier?.(...qualArgs, q.key); }}
                                        >
                                          {q.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {g.relType === 'partner' && (
                                  <MarriageDetailsEditor
                                    key={item.id}
                                    item={item}
                                    onSave={(meta) => onUpdatePartnerMeta?.(person.id, item.id, meta)}
                                  />
                                )}
                                {changeOptions.length > 0 && (
                                  <div className="rel-menu__group">
                                    <span className="rel-menu__label">Change to</span>
                                    <div className="rel-menu__opts">
                                      {changeOptions.map((o) => (
                                        <button
                                          key={o.kind}
                                          className="qual-opt"
                                          onClick={() => { onChangeRelationship?.(person.id, item.id, o.kind); closeMenu(); }}
                                        >
                                          {o.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {unlinkArgs && (
                                  isConfirming ? (
                                    <div className="rel-menu__confirm">
                                      <span>Remove this relationship?</span>
                                      <div className="rel-menu__confirm-btns">
                                        <button className="rel-menu__remove" onClick={() => { onRemoveRelationship?.(...unlinkArgs); closeMenu(); }}>Remove</button>
                                        <button className="rel-menu__cancel" onClick={() => setConfirmUnlinkId(null)}>Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button className="rel-menu__remove-trigger" onClick={() => setConfirmUnlinkId(item.id)}>
                                      <UnlinkIcon /> Remove relationship
                                    </button>
                                  )
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}

                {/* Extended family — derived, read-only, tap to navigate */}
                {extendedGroups.map((g) => (
                  <div className="rel-group rel-group--extended" key={g.title}>
                    <h4 className="rel-group__label">{g.title}</h4>
                    <ul className="rel-group__list">
                      {g.items.map((item) => {
                        const rel = graph.byId.get(item.id);
                        if (!rel) return null;
                        return (
                          <li key={item.id} className="rel-chip">
                            <button className="rel-chip__nav" onClick={() => onOpenPerson(item.id)}>
                              <Avatar person={rel} size={40} />
                              <span className="rel-chip__text">
                                <span className="rel-chip__name">{rel.display_name}</span>
                                <span className="rel-chip__kind">
                                  {relationLabel(graph, person.id, item.id, kinTerms)}
                                </span>
                              </span>
                              <RelChevronIcon />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

      </article>

      {enrichOpen && (
        <EnrichSheet
          person={person}
          graph={graph}
          memoryCount={personMemories.length}
          documents={documents}
          onClose={() => setEnrichOpen(false)}
          onEdit={() => { setEnrichOpen(false); onEdit?.(person.id); }}
          onAddRelative={() => { setEnrichOpen(false); onAddRelative?.(person.id); }}
          onReviewDuplicate={() => { setEnrichOpen(false); onReviewDuplicate?.(person.id); }}
          onGenerateStory={() => { setEnrichOpen(false); generateStory(); }}
          onApplyPlace={(key, value) => onApplyEnrichedPlace?.(person.id, key, value)}
          onApplyDocumentFact={onApplyDocumentFact}
          onDismissDocumentFact={onDismissDocumentFact}
          onApplyDocumentMedal={onApplyDocumentMedal}
          onDismissDocumentMedal={onDismissDocumentMedal}
          onApplyDocumentField={onApplyDocumentField}
          onDismissDocumentField={onDismissDocumentField}
          onApplyDocumentPerson={onApplyDocumentPerson}
          onDismissDocumentPerson={onDismissDocumentPerson}
          onApplyRelationshipFact={(fact) => onApplyRelationshipFact?.(person.id, fact)}
          onDismissRelationshipFact={(key) => onDismissRelationshipFact?.(person.id, key)}
        />
      )}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
        fill="currentColor"
      />
      <circle cx="12" cy="13" r="3.2" fill="#fff" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14 6l4 4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function RibbonIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 13l-2 8 5.5-3 5.5 3-2-8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function EnvelopeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M22 6l-10 7L2 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function HeartIcon({ filled }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} aria-hidden="true">
      <path
        d="M12 20s-7-4.6-7-9.7A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7 3.3c0 5.1-7 9.7-7 9.7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function CrosshairIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
// Same glyph as the topbar's tree/list view toggle — reused here so "Show
// in tree" reads as this app's tree metaphor, not a literal geo pin (which
// is already spoken for by the residence/birthplace PinIcon above).
function TreeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5" cy="19" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="19" cy="19" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 6.2v5.3M12 11.5l-5 4.8M12 11.5l5 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function FilmIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.7"/>
      <path d="M10 9l5 3-5 3V9z" fill="currentColor"/>
    </svg>
  );
}
function PinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RelChevronIcon() {
  return (
    <svg className="rel-chip__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

// Marriage date/place on the partner edge — the pedigree chart's marriage
// strip renders these. Draft state is local; Save writes both fields at
// once (see store.updatePartnerMeta). `item` is the graph's partner entry,
// which carries the current values.
function MarriageDetailsEditor({ item, onSave }) {
  const isFormer = item.status === 'former';
  const [married, setMarried] = useState(!!item.is_married || !!item.marriage_date || !!item.marriage_place);
  const [date, setDate] = useState(item.marriage_date || '');
  const [place, setPlace] = useState(item.marriage_place || '');
  // Independent of `married` — a relationship can have ended whether or not
  // it was ever a marriage — and only asked at all for an ex-partner.
  const [separation, setSeparation] = useState(item.separation_date || '');
  const [saved, setSaved] = useState(false);
  const dirty = married !== (!!item.is_married || !!item.marriage_date || !!item.marriage_place)
    || date !== (item.marriage_date || '') || place !== (item.marriage_place || '')
    || (isFormer && separation !== (item.separation_date || ''));
  return (
    <div className="rel-menu__group">
      <span className="rel-menu__label">Marriage</span>
      <div className="marriage-edit">
        <label className="marriage-edit__check">
          <input
            type="checkbox"
            checked={married}
            onChange={(e) => { setMarried(e.target.checked); setSaved(false); }}
          />
          {isFormer ? 'They were married' : 'They married'}
        </label>
        {married && (
          <>
            {/* Same convention as the profile's Date of Birth field: Day/Month/
                Year entry rather than a native picker, with a legacy year-only
                value (seed/GEDCOM data) preserved and surfaced as a hint until
                a full date replaces it. */}
            <div className="input-wrap">
              <DateField
                value={date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(value) => { setDate(value); setSaved(false); }}
              />
              {date && (
                <button type="button" className="input-clear" onClick={() => { setDate(''); setSaved(false); }} aria-label="Clear date" tabIndex={-1}>×</button>
              )}
            </div>
            {date && !date.includes('-') && (
              <span className="marriage-edit__hint">Year {date} — pick a full date to refine</span>
            )}
            <input
              className="marriage-edit__input"
              type="text"
              placeholder="Place (optional)"
              value={place}
              onChange={(e) => { setPlace(e.target.value); setSaved(false); }}
            />
          </>
        )}
        {isFormer && (
          <>
            <span className="marriage-edit__sublabel">Separated</span>
            <div className="input-wrap">
              <DateField
                value={separation}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(value) => { setSeparation(value); setSaved(false); }}
              />
              {separation && (
                <button type="button" className="input-clear" onClick={() => { setSeparation(''); setSaved(false); }} aria-label="Clear separation date" tabIndex={-1}>×</button>
              )}
            </div>
          </>
        )}
        <button
          className="marriage-edit__save"
          disabled={!dirty}
          onClick={() => {
            onSave({
              ...(married
                ? { is_married: true, marriage_date: date.trim() || null, marriage_place: place.trim() || null }
                : { is_married: false, marriage_date: null, marriage_place: null }),
              separation_date: isFormer ? (separation.trim() || null) : null,
            });
            setSaved(true);
          }}
        >
          {saved && !dirty ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}
function UnlinkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 7H7a4 4 0 0 0 0 8h2M15 7h2a4 4 0 0 1 0 8h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}
function DocFileIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function DocImageIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
      <path d="M3 16l5-5 4 4 3-3 6 5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function EmailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M22 6l-10 7L2 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.09 8.81 19.79 19.79 0 01.06 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 4L12 14.01l-3-3" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ marginLeft: 4 }}>
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
