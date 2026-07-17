import { useSyncExternalStore } from 'react';

/*
 * Per-viewer relationship-term preference — swap "Grandmother"/"Grandfather"
 * for "Nonna"/"Nonno", "Oma"/"Opa", or your own words, optionally different
 * per side of the family (a paternal-Italian, maternal-German family can run
 * both at once). This is a personal display preference, not tree data: it
 * lives in this browser's localStorage only, is never synced to the shared
 * family tree, and two people viewing the same grandparent can each see
 * their own term for them. Small pub/sub store, same convention as
 * data/store.js's useSyncExternalStore, so open UI (a profile already on
 * screen) updates live the moment the setting changes.
 *
 * Scoped deliberately to grandparents only — the relationship most families
 * actually have a strong feeling about — not threaded into "Great-",
 * "Step-", cousin degrees, aunts/uncles, etc. Those compound further with
 * gender-neutral English words ("Great-", "twice removed") that don't have
 * a clean cultural-pack equivalent, so they're left as the plain, warm-
 * enough English default. See relationLabel in data/graph.js for where this
 * plugs in.
 */

const KEY = 'bloodline:kinTerms';

export const GRANDPARENT_TERM_PACKS = [
  { id: 'english_formal', label: 'Grandmother / Grandfather', male: 'Grandfather', female: 'Grandmother', neutral: 'Grandparent' },
  { id: 'english_informal', label: 'Grandma / Grandpa', male: 'Grandpa', female: 'Grandma', neutral: 'Grandparent' },
  { id: 'italian', label: 'Nonno / Nonna', male: 'Nonno', female: 'Nonna', neutral: 'Nonno/Nonna' },
  { id: 'german', label: 'Opa / Oma', male: 'Opa', female: 'Oma', neutral: 'Opa/Oma' },
  { id: 'spanish', label: 'Abuelo / Abuela', male: 'Abuelo', female: 'Abuela', neutral: 'Abuelo/Abuela' },
  { id: 'french', label: 'Papi / Mamie', male: 'Papi', female: 'Mamie', neutral: 'Papi/Mamie' },
];
export const CUSTOM_PACK_ID = 'custom';

const DEFAULT_PREF = {
  paternalPackId: 'english_formal',
  maternalPackId: 'english_formal',
  customPaternal: { male: '', female: '' },
  customMaternal: { male: '', female: '' },
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PREF, ...JSON.parse(raw) };
  } catch {
    /* corrupt storage, or unavailable (SSR/private mode) — fall back below */
  }
  return { ...DEFAULT_PREF };
}

let pref = typeof localStorage !== 'undefined' ? load() : { ...DEFAULT_PREF };
const listeners = new Set();

export const kinTermsStore = {
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getState() {
    return pref;
  },
};

// Partial update — pass only the keys changing (e.g. just paternalPackId).
export function setKinTermsPref(patch) {
  pref = { ...DEFAULT_PREF, ...pref, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(pref));
  } catch {
    /* quota or private mode — the in-memory pref still applies this session */
  }
  listeners.forEach((l) => l());
}

export function useKinTerms() {
  return useSyncExternalStore(kinTermsStore.subscribe, kinTermsStore.getState);
}

const MASC_TERMS = ['male', 'm', 'man'];
const FEM_TERMS = ['female', 'f', 'woman'];

function termsForPack(packId, customTerms) {
  if (packId === CUSTOM_PACK_ID) {
    const male = (customTerms?.male || '').trim() || 'Grandfather';
    const female = (customTerms?.female || '').trim() || 'Grandmother';
    return { male, female, neutral: `${male}/${female}` };
  }
  return GRANDPARENT_TERM_PACKS.find((p) => p.id === packId) || GRANDPARENT_TERM_PACKS[0];
}

// side: 'Paternal' | 'Maternal' | null — exactly graph.js's parentSide()
// output for the direct-grandparent case (Step/Adoptive grandparents never
// reach this: relationLabel returns its fixed compound term for those
// before consulting a lexicon at all — there's no gender split to swap).
// null (the connecting parent's own gender was never recorded) falls back
// to the paternal-side pack — arbitrary, but harmless: it only ever affects
// the rare grandparent whose own child's gender is unset.
export function resolveGrandparentTerm(kinTerms, side, gender) {
  const useMaternal = side === 'Maternal';
  const packId = useMaternal ? kinTerms.maternalPackId : kinTerms.paternalPackId;
  const customTerms = useMaternal ? kinTerms.customMaternal : kinTerms.customPaternal;
  const terms = termsForPack(packId, customTerms);
  const gl = (gender || '').toLowerCase();
  if (MASC_TERMS.includes(gl)) return terms.male;
  if (FEM_TERMS.includes(gl)) return terms.female;
  return terms.neutral;
}
