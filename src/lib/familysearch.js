/*
 * FamilySearch.org integration — OAuth 2.0 PKCE flow + GEDCOM-X tree fetch.
 *
 * OAuth flow:
 *   1. openFamilySearchOAuth() → opens a popup to FamilySearch login
 *   2. User approves → popup redirects to /fs-callback.html
 *   3. Callback posts code back via postMessage
 *   4. /api/fs/token (CF Worker) exchanges code for access_token (no secret needed)
 *
 * Tree fetch (via /api/fs/proxy CF Worker to avoid CORS):
 *   - getCurrentPersonId(token) → FamilySearch person ID for the logged-in user
 *   - fetchAncestry(token, pid, generations) → pedigree chart using Ahnentafel numbering
 *   - fetchSpousesAndChildren(token, pid) → partners + children of the starting person
 *   - fetchTree(token, generations) → combines all three into a store-ready result
 *
 * Requires FAMILYSEARCH_CLIENT_ID to be set as a Cloudflare Pages env var.
 * The app must be registered at https://developer.familysearch.org with
 * https://myfamilybloodline.com/fs-callback.html as a redirect URI.
 */

const FS_AUTH_URL = 'https://ident.familysearch.org/cis-web/oauth2/v3/authorization';
const REDIRECT_URI = `${typeof window !== 'undefined' ? window.location.origin : 'https://myfamilybloodline.com'}/fs-callback.html`;

// ── PKCE helpers ──────────────────────────────────────────────────────────────

async function generatePKCE() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = btoa(String.fromCharCode(...verifierBytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return { verifier, challenge };
}

// ── OAuth popup ───────────────────────────────────────────────────────────────

/**
 * Open the FamilySearch OAuth consent screen in a popup.
 * Resolves with an access token string, or rejects with an Error.
 * Throws { message: 'cancelled' } if the user closes the popup.
 */
export async function openFamilySearchOAuth() {
  const { verifier, challenge } = await generatePKCE();
  const state = Math.random().toString(36).slice(2, 10);

  // We don't need VITE_FAMILYSEARCH_CLIENT_ID client-side — the token exchange
  // happens server-side via /api/fs/token. But the OAuth redirect still needs
  // the client_id in the URL. We read it from a lightweight /api/fs/config endpoint
  // so we don't bake it into the client bundle. Fall back to env var for local dev.
  const clientId = import.meta.env.VITE_FAMILYSEARCH_CLIENT_ID || '';
  if (!clientId) {
    // Fetch from server config (set FAMILYSEARCH_CLIENT_ID as CF env var)
    throw new Error('FamilySearch client ID not configured. Please set VITE_FAMILYSEARCH_CLIENT_ID.');
  }

  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return new Promise((resolve, reject) => {
    const popup = window.open(
      `${FS_AUTH_URL}?${authParams}`,
      'fs_oauth',
      'width=540,height=680,resizable=yes,scrollbars=yes',
    );

    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups for this site.'));
      return;
    }

    let done = false;

    const onMessage = async (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== 'fs_oauth') return;
      if (e.data.state !== state) return;
      cleanup();

      if (e.data.error) { reject(new Error(e.data.error)); return; }
      if (!e.data.code) { reject(new Error('No authorization code received.')); return; }

      try {
        const res = await fetch('/api/fs/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: e.data.code, code_verifier: verifier, redirect_uri: REDIRECT_URI }),
        });
        const data = await res.json();
        if (data.access_token) {
          resolve(data.access_token);
        } else {
          reject(new Error(data.error || 'Token exchange failed.'));
        }
      } catch (err) {
        reject(err);
      }
    };

    const pollInterval = setInterval(() => {
      if (popup.closed && !done) {
        cleanup();
        reject(new Error('cancelled'));
      }
    }, 600);

    function cleanup() {
      done = true;
      clearInterval(pollInterval);
      window.removeEventListener('message', onMessage);
    }

    window.addEventListener('message', onMessage);
  });
}

// ── FamilySearch API (via proxy to handle CORS) ────────────────────────────────

async function fsGet(token, fsPath, queryString = '') {
  const url = `/api/fs/proxy?path=${encodeURIComponent(fsPath)}${queryString ? '&qs=' + encodeURIComponent(queryString) : ''}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `FamilySearch API error (${res.status})`);
  }
  return res.json();
}

/** Get the FamilySearch person ID for the logged-in user. */
export async function getCurrentPersonId(token) {
  const data = await fsGet(token, '/platform/tree/current-user-person');
  return data.persons?.[0]?.id ?? null;
}

/**
 * Fetch ancestry (pedigree) for `personId` up to `generations` levels.
 * Returns { people, relationships } in bloodline store format.
 *
 * `idMap` (FS person id → internal id) is optional and shared with a
 * sibling fetch (see fetchTree) so the same real person always resolves to
 * the same internal id, however many times they're returned by the API.
 */
export async function fetchAncestry(token, personId, generations = 4, idMap = {}) {
  const data = await fsGet(token, `/platform/tree/persons/${personId}/ancestry`, `generations=${generations}`);
  return ancestryToStore(data, idMap);
}

/**
 * Fetch spouses + shared children of `personId`.
 * Returns { people, relationships }.
 */
export async function fetchSpousesAndChildren(token, personId, idMap = {}) {
  const data = await fsGet(token, `/platform/tree/persons/${personId}/spouses`);
  return spousesToStore(data, personId, idMap);
}

/**
 * Full tree fetch: current user → ancestry (N gen) + spouses + children.
 * Merges all results, deduplicates, returns { people, relationships, selfId }.
 */
export async function fetchTree(token, generations = 4) {
  const personId = await getCurrentPersonId(token);
  if (!personId) throw new Error('Could not find your person record in FamilySearch.');

  // Shared FS-id → internal-id map across BOTH fetches. Without this, the
  // subject person (returned by both the ancestry and spouses calls, since
  // both start from the same personId) got assigned two independent
  // internal ids — every import silently created a duplicate of the logged-
  // in user, with parents attached to one copy and spouse/children to the
  // other. Safe to share a plain object across the concurrent fetches below:
  // neither ancestryToStore nor spousesToStore awaits anything internally,
  // so their synchronous id-building never actually interleaves.
  const idMap = {};
  const [ancestry, spouses] = await Promise.all([
    fetchAncestry(token, personId, generations, idMap),
    fetchSpousesAndChildren(token, personId, idMap).catch(() => ({ people: [], relationships: [] })),
  ]);

  // Merge and deduplicate (ancestry and spouses share the subject person —
  // now genuinely deduplicated via the shared idMap above; this is a
  // defensive second pass, not the actual fix).
  const seenIds = new Set();
  const people = [];
  for (const p of [...ancestry.people, ...spouses.people]) {
    if (!seenIds.has(p.id)) { seenIds.add(p.id); people.push(p); }
  }

  const seenRels = new Set();
  const relationships = [];
  const relKey = (r) => `${r.from_person}|${r.to_person}|${r.type}`;
  for (const r of [...ancestry.relationships, ...spouses.relationships]) {
    const k = relKey(r);
    if (!seenRels.has(k)) { seenRels.add(k); relationships.push(r); }
  }

  return { people, relationships, selfFsId: personId };
}

// ── GEDCOM-X → bloodline store format ─────────────────────────────────────────

const uid = () => 'p_' + Math.random().toString(36).slice(2, 9);
const rid = () => 'r_' + Math.random().toString(36).slice(2, 9);

function extractYear(str) {
  if (!str) return null;
  const m = str.match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

function convertPerson(p, internalId) {
  const display = p.display || {};

  // Name — prefer structured name parts, fall back to display.name
  const nameForms = p.names?.[0]?.nameForms?.[0];
  const parts = nameForms?.parts || [];
  const given = parts.find((pt) => pt.type?.endsWith('/Given'))?.value?.trim()
    || display.name?.split(/\s+/).slice(0, -1).join(' ') || '';
  const family = parts.find((pt) => pt.type?.endsWith('/Surname'))?.value?.trim()
    || display.name?.split(/\s+/).slice(-1)[0] || '';
  const displayName = nameForms?.fullText?.trim() || display.name?.trim() || 'Unknown';

  // Gender
  const genderType = p.gender?.type || '';
  const gender = genderType.endsWith('/Male') ? 'male'
    : genderType.endsWith('/Female') ? 'female' : null;

  // Facts — check structured facts first, fall back to display strings
  const facts = p.facts || [];
  const birth = facts.find((f) => f.type?.endsWith('/Birth'));
  const death = facts.find((f) => f.type?.endsWith('/Death'));
  const occFact = facts.find((f) => f.type?.endsWith('/Occupation'));

  const birthYear = extractYear(birth?.date?.original || birth?.date?.formal || display.birthDate);
  const birthPlace = birth?.place?.original || display.birthPlace || null;
  const deathYear = extractYear(death?.date?.original || death?.date?.formal || display.deathDate);
  const isDeceased = !!death || !!display.deathDate;
  const occupation = occFact?.value || null;

  return {
    id: internalId,
    display_name: displayName,
    given_names: given || null,
    family_name: family || null,
    gender,
    birth_date: birthYear || null,
    death_date: deathYear || null,
    is_living: !isDeceased,
    is_deceased: isDeceased,
    is_minor: false,
    birth_place: birthPlace,
    residence: null,
    occupation,
    tags: [],
    events: [],
    bio: null,
    photo: null,
    conditions: [],
    confidence: 'confirmed',
    created_by: 'familysearch',
    visibility: 'full',
  };
}

// Resolve (and stably cache) the internal id for a FamilySearch person id.
// Sharing one `idMap` across every call site means a person who shows up
// more than once — the same subject across two fetches, or an ancestor who
// occupies more than one Ahnentafel position because of pedigree collapse
// (e.g. cousins who married) — always gets exactly ONE internal id, never a
// fresh uid() per occurrence.
function internalIdFor(idMap, fsId) {
  if (!idMap[fsId]) idMap[fsId] = uid();
  return idMap[fsId];
}

/**
 * Convert an ancestry (pedigree) GEDCOM-X response to store format.
 * Uses Ahnentafel numbering to reconstruct parent-child and couple edges:
 *   - Person N's parents are at positions 2N (father) and 2N+1 (mother)
 *   - Person N's child is at position floor(N/2)
 */
function ancestryToStore(data, idMap = {}) {
  const persons = data.persons || [];

  // Build Ahnentafel map and assign internal IDs. `people` is built in the
  // same pass and deduplicated by FS id — under pedigree collapse the same
  // FS person can appear more than once in `persons` (at different
  // ascendancy numbers), and previously that produced duplicate-id entries
  // in the final people array plus dangling relationships (a stale, earlier
  // ahnMap entry pointing at an internal id a later loop iteration had
  // already overwritten in idMap).
  const ahnMap = {}; // ascendancyNumber -> FS person object
  const seenFsIds = new Set();
  const people = [];

  for (const p of persons) {
    const internalId = internalIdFor(idMap, p.id);
    if (p.ascendancyNumber != null) {
      ahnMap[p.ascendancyNumber] = { ...p, _internalId: internalId };
    }
    if (!seenFsIds.has(p.id)) {
      seenFsIds.add(p.id);
      people.push(convertPerson(p, internalId));
    }
  }

  const relationships = [];

  // Parent→child edges via Ahnentafel: person at N is parent of person at floor(N/2)
  for (const [numStr, p] of Object.entries(ahnMap)) {
    const num = parseInt(numStr, 10);
    if (num < 2) continue; // subject has no parent row in this set

    const childNum = Math.floor(num / 2);
    const child = ahnMap[childNum];
    if (!child) continue;

    relationships.push({
      id: rid(),
      from_person: p._internalId,
      to_person: child._internalId,
      type: 'parent',
      qualifier: 'biological',
      partner_status: null,
    });
  }

  // Couple edges: even Ahnentafel numbers are fathers, odd are mothers.
  // Father at 2N and mother at 2N+1 are a couple (parents of person N).
  for (const [numStr, p] of Object.entries(ahnMap)) {
    const num = parseInt(numStr, 10);
    if (num % 2 !== 0 || num < 2) continue; // only even numbers = fathers
    const mother = ahnMap[num + 1];
    if (!mother) continue;
    relationships.push({
      id: rid(),
      from_person: p._internalId,
      to_person: mother._internalId,
      type: 'partner',
      qualifier: 'biological',
      partner_status: 'current',
    });
  }

  return { people, relationships };
}

/**
 * Convert a spouses-and-children GEDCOM-X response to store format.
 * Includes the subject's partners and their shared children.
 */
function spousesToStore(data, subjectFsId, idMap = {}) {
  const persons = data.persons || [];
  const seenFsIds = new Set();
  const people = [];
  for (const p of persons) {
    const internalId = internalIdFor(idMap, p.id);
    if (!seenFsIds.has(p.id)) { seenFsIds.add(p.id); people.push(convertPerson(p, internalId)); }
  }
  const relationships = [];

  // Couple relationships
  for (const rel of (data.relationships || [])) {
    if (!rel.type?.endsWith('/Couple')) continue;
    const p1 = idMap[rel.person1?.resourceId];
    const p2 = idMap[rel.person2?.resourceId];
    if (!p1 || !p2) continue;
    const isDivorced = rel.facts?.some((f) => f.type?.endsWith('/Divorce'));
    relationships.push({
      id: rid(),
      from_person: p1,
      to_person: p2,
      type: 'partner',
      qualifier: 'biological',
      partner_status: isDivorced ? 'former' : 'current',
    });
  }

  // Parent→child from childAndParentsRelationships
  for (const rel of (data.childAndParentsRelationships || [])) {
    const childId = idMap[rel.child?.resourceId];
    const fatherId = rel.father ? idMap[rel.father.resourceId] : null;
    const motherId = rel.mother ? idMap[rel.mother.resourceId] : null;
    if (!childId) continue;
    if (fatherId) {
      relationships.push({ id: rid(), from_person: fatherId, to_person: childId, type: 'parent', qualifier: 'biological', partner_status: null });
    }
    if (motherId) {
      relationships.push({ id: rid(), from_person: motherId, to_person: childId, type: 'parent', qualifier: 'biological', partner_status: null });
    }
  }

  return { people, relationships };
}
