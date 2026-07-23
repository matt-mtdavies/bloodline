/*
 * Archive path sanitizer (docs/FULL-ARCHIVE-EXPORT.md §8.3-8.5): every path
 * written into the ZIP is built from an internal record ID plus a sanitized
 * display name — never from a raw user-supplied path or key. Pure string
 * manipulation, no filesystem/Node APIs, so it runs identically in the
 * Workflow Worker and in these Node tests.
 *
 * Threat model: a person's name, a document title, or the family name can
 * contain anything a user can type — including literal `../`, NUL bytes,
 * Windows-reserved characters, and Unicode characters that *look* like a
 * path separator to a human but aren't one to a naive filter (fullwidth
 * solidus U+FF0F, division slash U+2215, etc.), or invisible characters
 * that can hide a traversal sequence from a casual visual review (zero-
 * width space, bidi override controls). None of that may ever reach a ZIP
 * entry path or a filesystem path once the archive is extracted.
 */

// Characters that are unsafe on at least one of macOS/Linux/Windows, plus
// C0/C1 control characters (NUL through NUL+31, and DEL, and 0x80-0x9F).
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\x00-\x1f\x7f-\x9f/\\:*?"<>|]/g;

// Unicode characters that visually resemble a path separator or a dot but
// are not treated as one by the filesystem — reduced ("confused") to `_` so
// a lookalike can't be used to smuggle a traversal-looking sequence past a
// human reviewing the archive, and can't collide with a real separator once
// normalized. Fullwidth solidus/reverse solidus, division slash, fullwidth
// full stop, and the fraction slash are the practical cases; this is not
// trying to be an exhaustive confusables table.
const CONFUSABLE_SEPARATORS = /[\uFF0F\uFF3C\u2215\uFF0E\u2044]/g;

// Invisible/formatting characters that carry no visible glyph at all — a
// zero-width space or a bidi override could hide extra characters (or make
// "..\/" render as something else entirely) from anyone eyeballing a file
// listing. Stripped outright rather than replaced, since they contribute no
// visible information to begin with.
// eslint-disable-next-line no-misleading-character-class
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

const MAX_SEGMENT_LENGTH = 80;
const FALLBACK_NAME = 'unnamed';

/*
 * Reduces an arbitrary display name (a person's name, a document title, the
 * family name) to a single safe filename segment. Never throws — always
 * returns a non-empty, safe string, falling back to FALLBACK_NAME if
 * sanitizing would otherwise leave nothing.
 */
export function sanitizeNameSegment(rawName, { maxLength = MAX_SEGMENT_LENGTH } = {}) {
  let name = String(rawName ?? '');

  // NFKC first: folds many compatibility/confusable forms (fullwidth
  // Latin letters, some ligatures) into their canonical form before the
  // targeted replacements below run, so those replacements see a more
  // predictable input rather than every possible equivalent encoding.
  try {
    name = name.normalize('NFKC');
  } catch {
    // Malformed/unpaired surrogates can make normalize() throw in some
    // engines — fall through with the un-normalized string; the surrogate
    // strip below still removes the dangerous part.
  }

  name = name
    .replace(INVISIBLE_CHARS, '')
    .replace(CONFUSABLE_SEPARATORS, '_')
    .replace(UNSAFE_CHARS, '_')
    // Lone/unpaired surrogates (malformed UTF-16, possible from bad input)
    // — strip rather than replace, they carry no safe visible form.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g, '')
    // A run of two or more dots is exactly the traversal shape (`..`,
    // `...`) regardless of what surrounds it — collapse to a single
    // underscore rather than a single dot, so "..." can't reassemble into
    // ".." after adjacent underscores are later collapsed.
    .replace(/\.{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  // Windows forbids a trailing dot or space on any path segment; strip
  // repeatedly since removing one can expose another underneath it.
  while (/[. ]$/.test(name)) name = name.slice(0, -1);
  // A segment that is now just underscores/empty after the above is not
  // informative — fall back rather than ship a bare "_" filename.
  if (!/[^_\s]/.test(name)) name = '';

  if (!name) name = FALLBACK_NAME;

  // Truncate by Unicode code point, not UTF-16 code unit, so a surrogate
  // pair is never split in half.
  const codePoints = Array.from(name);
  if (codePoints.length > maxLength) name = codePoints.slice(0, maxLength).join('');

  return name;
}

/*
 * Builds a stable, unique, safe archive-relative path for one binary or
 * record: `{kind}/{id}_{sanitizedName}.{ext}`. The ID leads so the path
 * stays unique and non-empty even in the degenerate case where sanitizing
 * the name collapses it to the fallback for many records at once (many
 * "unnamed" documents, say) — collisions are still impossible because no
 * two records share an ID.
 */
export function buildArchivePath(kind, id, displayName, ext) {
  const safeKind = sanitizeNameSegment(kind, { maxLength: 40 });
  const safeId = sanitizeNameSegment(id, { maxLength: 60 });
  const safeName = sanitizeNameSegment(displayName, { maxLength: MAX_SEGMENT_LENGTH });
  const safeExt = sanitizeNameSegment(ext || '', { maxLength: 12 }).toLowerCase();
  const base = `${safeId}_${safeName}`;
  return safeExt ? `${safeKind}/${base}.${safeExt}` : `${safeKind}/${base}`;
}

/*
 * Defense-in-depth assertion run immediately before ANY path is handed to
 * the ZIP writer (docs/FULL-ARCHIVE-EXPORT.md §8.3) — every archive path in
 * this codebase is built exclusively by buildArchivePath/the fixed manifest
 * filenames, so this should never fail in practice; it exists to make a
 * future bug (a raw name or key slipping through some other path) fail
 * loudly instead of silently writing an unsafe ZIP entry.
 */
export function assertSafeArchivePath(path) {
  if (typeof path !== 'string' || !path) {
    throw new Error(`unsafe archive path: empty or non-string (${JSON.stringify(path)})`);
  }
  if (path.startsWith('/') || path.startsWith('\\')) {
    throw new Error(`unsafe archive path: absolute path "${path}"`);
  }
  // Windows drive letter, e.g. "C:\..." or "C:/...".
  if (/^[a-zA-Z]:[/\\]/.test(path)) {
    throw new Error(`unsafe archive path: drive-letter path "${path}"`);
  }
  const segments = path.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new Error(`unsafe archive path: traversal segment in "${path}"`);
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f\\]/.test(seg)) {
      throw new Error(`unsafe archive path: control character or backslash in "${path}"`);
    }
  }
  return path;
}
