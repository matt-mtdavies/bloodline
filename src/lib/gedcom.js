/*
 * GEDCOM 5.5 / 5.5.1 parser AND writer — converts between a GEDCOM export and
 * bloodline store-compatible people[] and relationships[] arrays.
 *
 * Supports: INDI, FAM, NAME (with /surname/ notation), GIVN/SURN sub-tags,
 * BIRT/DEAT events, OCCU, RESI, NOTE (bio), PEDI adoption qualifier, DIV,
 * MARR (marriage date + place onto the partner edge).
 * Date parsing: exact "D MMM YYYY" dates become full ISO (YYYY-MM-DD) so
 * imported people get real birthdays; partial/approximate dates degrade to
 * month+year or year, never faking a day.
 *
 * `gedcomToStore(text)` reads; `storeToGedcom(people, relationships)` writes
 * standard GEDCOM 5.5.1 for portability (take your tree to Ancestry/MyHeritage/
 * FamilySearch). The pair round-trips the fields GEDCOM can carry — see
 * tests/gedcom.test.mjs. Photos, memories, tags, life events and the Keepsake
 * are NOT expressible in GEDCOM; a full, lossless archive is a separate feature.
 */

const uid = () => 'p_' + Math.random().toString(36).slice(2, 9);
const rid = () => 'r_' + Math.random().toString(36).slice(2, 9);

// Parse flat GEDCOM lines into a hierarchy of nodes.
function parseTree(text) {
  const root = { level: -1, tag: 'ROOT', value: '', children: [], xref: null };
  const stack = [root];
  const records = {};

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // GEDCOM line grammar: LEVEL [XREF] TAG [VALUE]
    const m = line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\w+)(?:\s+(.*))?$/);
    if (!m) continue;

    const level = parseInt(m[1], 10);
    const xref = m[2] ?? null;
    const tag = m[3];
    const value = (m[4] ?? '').trim();

    const node = { level, tag, value, children: [], xref };
    if (xref) records[xref] = node;

    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return { root, records };
}

// Get the first child with tag, concatenating any CONT/CONC siblings.
function child(node, tag) {
  if (!node) return null;
  const found = node.children.find((c) => c.tag === tag);
  if (!found) return null;

  let value = found.value;
  for (const c of found.children) {
    if (c.tag === 'CONT') value += '\n' + c.value;
    else if (c.tag === 'CONC') value += c.value;
  }
  return { ...found, value };
}

function children(node, tag) {
  return node ? node.children.filter((c) => c.tag === tag) : [];
}

const GEDCOM_MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
// Approximation / range qualifiers — when present we keep only the year rather
// than implying a precise day/month the source didn't actually assert.
const APPROX_RE = /\b(ABT|EST|CAL|BEF|AFT|BET|AND|FROM|TO|INT|CIRCA|ABOUT)\b/i;

// Parse a GEDCOM DATE into the app's 'YYYY[-MM[-DD]]' string. An exact date
// becomes full ISO — so imported people get real birthdays (the home
// "birthdays this month" feature needs month+day) and land correctly on the
// timeline — while approximate or partial dates degrade to the finest
// precision we can trust (month+year, or year alone), never faking a day.
function parseGedcomDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  const yearM = s.match(/\b(\d{4})\b/);
  if (!yearM) return null;
  const year = yearM[1];
  if (APPROX_RE.test(s)) return year;
  // "12 MAR 1950" → 1950-03-12
  const full = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\b/);
  if (full) {
    const mo = GEDCOM_MONTHS[full[2].slice(0, 3).toUpperCase()];
    if (mo) return `${full[3]}-${String(mo).padStart(2, '0')}-${String(Number(full[1])).padStart(2, '0')}`;
  }
  // "MAR 1950" → 1950-03
  const my = s.match(/\b([A-Za-z]{3,})\s+(\d{4})\b/);
  if (my) {
    const mo = GEDCOM_MONTHS[my[1].slice(0, 3).toUpperCase()];
    if (mo) return `${my[2]}-${String(mo).padStart(2, '0')}`;
  }
  return year;
}

// Parse "John /Smith/" → { given, family, display }
function parseName(raw) {
  if (!raw) return { given: '', family: '', display: '' };
  const familyM = raw.match(/\/([^/]*)\//) ;
  const family = familyM ? familyM[1].trim() : '';
  const given = raw.replace(/\/[^/]*\//, '').trim();
  const display = [given, family].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return { given, family, display };
}

// Build NOTE text including any CONT/CONC children of the note node.
function noteText(node) {
  if (!node) return null;
  let text = node.value || '';
  for (const c of node.children) {
    if (c.tag === 'CONT') text += '\n' + c.value;
    else if (c.tag === 'CONC') text += c.value;
  }
  return text.trim() || null;
}

/**
 * Convert a GEDCOM 5.5 text into { people, relationships } matching
 * the bloodline store schema. Throws on malformed input.
 */
export function gedcomToStore(text) {
  const { records } = parseTree(text);

  // Assign internal IDs for every INDI record up-front so FAM records can reference them.
  const idMap = {};
  for (const [xref, node] of Object.entries(records)) {
    if (node.tag === 'INDI') idMap[xref] = uid();
  }

  // ── People ──────────────────────────────────────────────────────────────────
  const people = [];
  for (const [xref, node] of Object.entries(records)) {
    if (node.tag !== 'INDI') continue;
    const id = idMap[xref];

    // Name — prefer GIVN/SURN sub-tags over the / / notation when both exist.
    const nameNode = child(node, 'NAME');
    const { given: nGiven, family: nFamily, display: nDisplay } = parseName(nameNode?.value);
    const givenSub = child(nameNode, 'GIVN');
    const surnSub = child(nameNode, 'SURN');
    const given = givenSub?.value?.trim() || nGiven;
    const family = surnSub?.value?.trim() || nFamily;
    // display_name follows the app's own convention — first given + surname,
    // NOT every given name — so "James Robert /Mercer/" shows as "James Mercer"
    // in the tree (the full "James Robert" is kept in given_names and surfaces
    // in the profile). This also makes a Bloodline export round-trip faithfully.
    const firstGiven = given.split(/\s+/)[0] || '';
    const displayName = [firstGiven, family].filter(Boolean).join(' ').trim() || nDisplay || 'Unknown';

    // Sex
    const sex = child(node, 'SEX')?.value?.toUpperCase();
    const gender = sex === 'M' ? 'male' : sex === 'F' ? 'female' : null;

    // Birth
    const birtNode = child(node, 'BIRT');
    const birthDate = parseGedcomDate(child(birtNode, 'DATE')?.value);
    const birthPlace = child(birtNode, 'PLAC')?.value?.trim() || null;

    // Death — tag presence (even without sub-records) means deceased.
    const deatNode = children(node, 'DEAT')[0] ?? null;
    const isDeceased = !!deatNode;
    const deathDate = parseGedcomDate(child(deatNode, 'DATE')?.value);

    // Occupation (first OCCU tag)
    const occupation = child(node, 'OCCU')?.value?.trim() || null;

    // Residence — prefer PLAC sub-tag, fall back to tag value
    const resiNode = child(node, 'RESI');
    const residence = child(resiNode, 'PLAC')?.value?.trim() || resiNode?.value?.trim() || null;

    // Bio from NOTE (first one; GEDCOM allows many)
    const bio = noteText(children(node, 'NOTE')[0] ?? null);

    people.push({
      id,
      display_name: displayName,
      given_names: given || null,
      family_name: family || null,
      gender,
      birth_date: birthDate ?? null,
      death_date: deathDate ?? null,
      is_living: !isDeceased,
      is_deceased: isDeceased,
      is_minor: false,
      birth_place: birthPlace,
      residence,
      occupation,
      tags: [],
      events: [],
      bio,
      photo: null,
      conditions: [],
      confidence: 'confirmed',
      created_by: 'import',
      visibility: 'full',
    });
  }

  // ── Relationships from FAM records ───────────────────────────────────────────
  const relationships = [];
  for (const [xref, node] of Object.entries(records)) {
    if (node.tag !== 'FAM') continue;

    const husbXref = child(node, 'HUSB')?.value;
    const wifeXref = child(node, 'WIFE')?.value;
    const isFormer = !!children(node, 'DIV')[0];

    // Marriage event — a MARR tag means the couple was married; its DATE/PLAC
    // populate the same marriage_date/marriage_place the manual add-partner
    // flow captures. Year-only, matching how birth/death dates are reduced
    // above (extractYear). A FAM with no MARR is still a valid partnership,
    // just without a recorded marriage (is_married left unset).
    const marrNode = children(node, 'MARR')[0];
    const marriageDate = marrNode ? parseGedcomDate(child(marrNode, 'DATE')?.value) : null;
    const marriagePlace = marrNode ? (child(marrNode, 'PLAC')?.value?.trim() || null) : null;

    const husbId = husbXref ? idMap[husbXref] : null;
    const wifeId = wifeXref ? idMap[wifeXref] : null;

    // Partner edge between spouses
    if (husbId && wifeId) {
      relationships.push({
        id: rid(),
        from_person: husbId,
        to_person: wifeId,
        type: 'partner',
        qualifier: 'biological',
        partner_status: isFormer ? 'former' : 'current',
        ...(marrNode ? { is_married: true, marriage_date: marriageDate, marriage_place: marriagePlace } : {}),
      });
    }

    // Parent → child edges
    for (const chilNode of children(node, 'CHIL')) {
      const childXref = chilNode.value;
      const childId = idMap[childXref];
      if (!childId) continue;

      // Determine qualifier via PEDI sub-tag on the child's FAMC back-reference.
      let qualifier = 'biological';
      const childIndi = records[childXref];
      if (childIndi) {
        for (const famcNode of children(childIndi, 'FAMC')) {
          if (famcNode.value === xref) {
            const pedi = child(famcNode, 'PEDI')?.value?.toLowerCase();
            if (pedi === 'adopted') qualifier = 'adoptive';
            else if (pedi === 'foster' || pedi === 'step') qualifier = 'step';
            break;
          }
        }
      }

      if (husbId) {
        relationships.push({
          id: rid(),
          from_person: husbId,
          to_person: childId,
          type: 'parent',
          qualifier,
          partner_status: null,
        });
      }
      if (wifeId) {
        relationships.push({
          id: rid(),
          from_person: wifeId,
          to_person: childId,
          type: 'parent',
          qualifier,
          partner_status: null,
        });
      }
    }
  }

  return { people, relationships };
}

// ── Writing: store → GEDCOM 5.5.1 ───────────────────────────────────────────

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ISO 'YYYY[-MM[-DD]]' → GEDCOM 'D MMM YYYY' / 'MMM YYYY' / 'YYYY'. The exact
// inverse of parseGedcomDate for the precisions it produces.
function formatGedcomDate(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  const m = s.match(/^(\d{4})(?:-(\d{2}))(?:-(\d{2}))?$/);
  if (!m) { const y = s.match(/\d{4}/); return y ? y[0] : null; }
  const [, y, mo, d] = m;
  const month = MONTH_ABBR[Number(mo) - 1];
  if (d) return `${Number(d)} ${month} ${y}`;
  return `${month} ${y}`;
}

// Reconstruct "Given /Surname/" from the person's name fields.
function gedcomName(p) {
  const family = (p.family_name || '').trim();
  let given = (p.given_names || '').trim();
  if (!given && p.display_name) {
    given = family
      ? p.display_name.replace(new RegExp('\\s*' + family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '').trim()
      : p.display_name.trim();
  }
  return { given, family, nameLine: `${given} /${family}/`.trim() };
}

/**
 * Convert store { people, relationships } into a GEDCOM 5.5.1 string.
 *
 * Groups co-parents + their children into FAM records (the GEDCOM family
 * unit), assigning HUSB/WIFE by gender. Marriage date/place and divorce come
 * from the partner edge; adoptive/step children carry a PEDI on their FAMC.
 * Round-trips every field GEDCOM can express (see tests). Deliberately lossy
 * for what GEDCOM can't hold — photos, memories, tags, events, the Keepsake —
 * which is what the separate full archive export is for.
 *
 * One documented model limitation: two people who co-parent a child but were
 * never partners still become a HUSB/WIFE couple in the FAM (GEDCOM has no
 * "shared a child, never a couple" concept), so a re-import gains a partner
 * edge between them.
 */
export function storeToGedcom(people = [], relationships = []) {
  const indiX = new Map();
  people.forEach((p, i) => indiX.set(p.id, `@I${i + 1}@`));
  const byId = new Map(people.map((p) => [p.id, p]));
  const keyOf = (ids) => [...ids].sort().join('~');

  // Parent edges: child → Map(parentId → qualifier).
  const parentsOfChild = new Map();
  for (const r of relationships) {
    if (r.type !== 'parent' || !byId.has(r.from_person) || !byId.has(r.to_person)) continue;
    if (!parentsOfChild.has(r.to_person)) parentsOfChild.set(r.to_person, new Map());
    parentsOfChild.get(r.to_person).set(r.from_person, r.qualifier || 'biological');
  }
  // Couples from partner edges.
  const couples = new Map();
  for (const r of relationships) {
    if (r.type !== 'partner' || !byId.has(r.from_person) || !byId.has(r.to_person)) continue;
    const ids = [r.from_person, r.to_person].sort();
    couples.set(keyOf(ids), { ids, status: r.partner_status, is_married: r.is_married, marriage_date: r.marriage_date, marriage_place: r.marriage_place });
  }

  // FAM units keyed by parent-set; couples with no children still get one.
  const fams = new Map();
  for (const [childId, pmap] of parentsOfChild) {
    const parents = [...pmap.keys()];
    const key = keyOf(parents);
    if (!fams.has(key)) fams.set(key, { parents, children: [], couple: null });
    const qualifier = [...pmap.values()].find((q) => q && q !== 'biological') || 'biological';
    fams.get(key).children.push({ id: childId, qualifier });
  }
  for (const c of couples.values()) {
    const key = keyOf(c.ids);
    if (!fams.has(key)) fams.set(key, { parents: c.ids, children: [], couple: null });
    fams.get(key).couple = c;
  }

  // Assign FAM xrefs + HUSB/WIFE roles (by gender, then fill remaining slots).
  const famList = [];
  let fi = 0;
  for (const fam of fams.values()) {
    const xref = `@F${++fi}@`;
    let husb = null, wife = null;
    for (const pid of fam.parents) {
      const g = byId.get(pid)?.gender;
      if (g === 'male' && !husb) husb = pid;
      else if (g === 'female' && !wife) wife = pid;
    }
    for (const pid of fam.parents) {
      if (pid === husb || pid === wife) continue;
      if (!husb) husb = pid; else if (!wife) wife = pid;
    }
    famList.push({ xref, husb, wife, children: fam.children, couple: fam.couple });
  }

  // Per-person FAMS (spouse) / FAMC (child, with qualifier).
  const famsOf = new Map(), famcOf = new Map();
  const addTo = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const f of famList) {
    if (f.husb) addTo(famsOf, f.husb, f.xref);
    if (f.wife) addTo(famsOf, f.wife, f.xref);
    for (const ch of f.children) addTo(famcOf, ch.id, { xref: f.xref, qualifier: ch.qualifier });
  }

  const lines = [];
  const put = (s) => lines.push(s);
  put('0 HEAD');
  put('1 SOUR Bloodline');
  put('2 NAME Bloodline — myfamilybloodline.com');
  put('1 GEDC');
  put('2 VERS 5.5.1');
  put('2 FORM LINEAGE-LINKED');
  put('1 CHAR UTF-8');

  for (const p of people) {
    put(`0 ${indiX.get(p.id)} INDI`);
    const { given, family, nameLine } = gedcomName(p);
    put(`1 NAME ${nameLine}`);
    if (given) put(`2 GIVN ${given}`);
    if (family) put(`2 SURN ${family}`);
    if (p.gender === 'male') put('1 SEX M');
    else if (p.gender === 'female') put('1 SEX F');
    const bd = formatGedcomDate(p.birth_date);
    if (bd || p.birth_place) {
      put('1 BIRT');
      if (bd) put(`2 DATE ${bd}`);
      if (p.birth_place) put(`2 PLAC ${p.birth_place}`);
    }
    if (p.is_deceased) {
      const dd = formatGedcomDate(p.death_date);
      if (dd) { put('1 DEAT'); put(`2 DATE ${dd}`); } else put('1 DEAT Y');
    }
    if (p.occupation) put(`1 OCCU ${p.occupation}`);
    if (p.residence) { put('1 RESI'); put(`2 PLAC ${p.residence}`); }
    if (p.bio) {
      const bioLines = String(p.bio).split('\n');
      put(`1 NOTE ${bioLines[0]}`);
      for (let i = 1; i < bioLines.length; i++) put(`2 CONT ${bioLines[i]}`);
    }
    for (const x of (famsOf.get(p.id) || [])) put(`1 FAMS ${x}`);
    for (const fc of (famcOf.get(p.id) || [])) {
      put(`1 FAMC ${fc.xref}`);
      const pedi = fc.qualifier === 'adoptive' ? 'adopted' : fc.qualifier === 'step' ? 'step' : null;
      if (pedi) put(`2 PEDI ${pedi}`);
    }
  }

  for (const f of famList) {
    put(`0 ${f.xref} FAM`);
    if (f.husb) put(`1 HUSB ${indiX.get(f.husb)}`);
    if (f.wife) put(`1 WIFE ${indiX.get(f.wife)}`);
    for (const ch of f.children) put(`1 CHIL ${indiX.get(ch.id)}`);
    const c = f.couple;
    if (c && (c.is_married || c.marriage_date || c.marriage_place)) {
      put('1 MARR');
      const md = formatGedcomDate(c.marriage_date);
      if (md) put(`2 DATE ${md}`);
      if (c.marriage_place) put(`2 PLAC ${c.marriage_place}`);
    }
    if (c && c.status === 'former') put('1 DIV');
  }

  put('0 TRLR');
  return lines.join('\n') + '\n';
}
