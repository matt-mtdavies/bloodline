/*
 * Builds `data/family.json` (docs/FULL-ARCHIVE-EXPORT.md §3.4 "Additional
 * family records") — a small, separate record from manifest.json/tree.json:
 * family identity, provenance, and archive-format metadata, deliberately
 * NOT duplicated as the single source of truth (manifest.json already
 * carries an overlapping subset for the viewer/verification path; this
 * file exists because §3.4 explicitly calls for a standalone family.json
 * under data/, independent of the manifest).
 */
export function buildFamilyRecord({
  familyId, familyName, familyCreatedAt, source, generatedAt, requestedAs,
}) {
  if (!familyId) throw new Error('buildFamilyRecord requires familyId');
  if (!generatedAt) throw new Error('buildFamilyRecord requires generatedAt');
  if (!requestedAs) throw new Error('buildFamilyRecord requires requestedAs');

  return {
    familyId,
    familyName: familyName ?? '',
    familyCreatedAt: familyCreatedAt ?? null,
    source: {
      treeUpdatedAt: source?.treeUpdatedAt ?? null,
      storageMode: source?.storageMode ?? 'legacy',
      extraVersion: source?.extraVersion ?? null,
    },
    generatedAt,
    requestedAs,
    archiveFormat: 'bloodline-full-archive',
    archiveVersion: 1,
  };
}
