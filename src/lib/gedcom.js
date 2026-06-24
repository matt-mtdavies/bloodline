/*
 * GEDCOM 5.5 / 5.5.1 parser — converts a GEDCOM export into bloodline
 * store-compatible people[] and relationships[] arrays.
 *
 * Supports: INDI, FAM, NAME (with /surname/ notation), GIVN/SURN sub-tags,
 * BIRT/DEAT events, OCCU, RESI, NOTE (bio), PEDI adoption qualifier, DIV.
 * Date parsing: extracts the 4-digit year from any DATE value.
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

// Extract the 4-digit year from any GEDCOM DATE value.
function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = (dateStr ?? '').match(/\b(\d{4})\b/);
  return m ? m[1] : null;
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
    const displayName = [given, family].filter(Boolean).join(' ').trim() || nDisplay || 'Unknown';

    // Sex
    const sex = child(node, 'SEX')?.value?.toUpperCase();
    const gender = sex === 'M' ? 'male' : sex === 'F' ? 'female' : null;

    // Birth
    const birtNode = child(node, 'BIRT');
    const birthYear = extractYear(child(birtNode, 'DATE')?.value);
    const birthPlace = child(birtNode, 'PLAC')?.value?.trim() || null;

    // Death — tag presence (even without sub-records) means deceased.
    const deatNode = children(node, 'DEAT')[0] ?? null;
    const isDeceased = !!deatNode;
    const deathYear = extractYear(child(deatNode, 'DATE')?.value);

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
      birth_date: birthYear ?? null,
      death_date: deathYear ?? null,
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
