/*
 * Builds `reports/missing-files.txt` and `reports/integrity-report.html`
 * (docs/FULL-ARCHIVE-EXPORT.md §3.2's directory layout, §3.9's "The
 * manifest itself also receives a detached checksum... integrity-report.html
 * provides a human-readable version"). Both are pure string builders over
 * data already gathered by the time packaging starts (the manifest's own
 * `warnings`/`files`/`status`) — no new I/O, no new inventory pass.
 *
 * Neither file can ever contain the FINAL archive's own whole-file SHA-256:
 * that checksum is only computable once the archive is completely written
 * (see verifyArchiveStep), but this report is itself one of the archive's
 * own fixed entries, baked in before packaging even starts (the same
 * "manifest built too early" constraint manifest.json itself has — there
 * is no way to edit a ZIP entry's bytes after later entries have already
 * been streamed past it). Rather than a lie or a placeholder that looks
 * like a real value, the report says plainly that the archive checksum is
 * recorded in the FAMILY's own export history, not inside the archive.
 */

export function buildMissingFilesReport(warnings) {
  if (!warnings || !warnings.length) {
    return 'No missing, unreadable, or unsupported files were found while preparing this archive.\n';
  }
  const lines = [
    `${warnings.length} file(s) referenced by this family's records could not be included in this archive:`,
    '',
  ];
  for (const w of warnings) {
    lines.push(`${w.path}`, `  status: ${w.status}`, `  reason: ${w.warning}`, '');
  }
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function buildIntegrityReportHtml({ manifest, manifestChecksum, generatedAt }) {
  const warnings = manifest.warnings || [];
  const warningRows = warnings.length
    ? warnings.map((w) => `<tr><td>${escapeHtml(w.path)}</td><td>${escapeHtml(w.status)}</td><td>${escapeHtml(w.warning)}</td></tr>`).join('')
    : '<tr><td colspan="3">None</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Archive integrity report</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #222; }
table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
td, th { border: 1px solid #ccc; padding: .4rem .6rem; text-align: left; font-size: .9rem; }
h1 { font-size: 1.3rem; } h2 { font-size: 1.05rem; margin-top: 2rem; }
code { font-size: .85rem; background: #f4f4f4; padding: .1rem .3rem; border-radius: 3px; }
</style>
</head>
<body>
<h1>Archive integrity report</h1>
<p>Generated ${escapeHtml(generatedAt)}</p>
<p>Status: <strong>${escapeHtml(manifest.status)}</strong></p>
<p>Entries: ${manifest.files.length} &middot; Warnings: ${warnings.length}</p>
<p>Manifest checksum (SHA-256): <code>${escapeHtml(manifestChecksum)}</code></p>
<p>This archive's own whole-file checksum is recorded in the family's export
history in Bloodline (not inside the archive itself — it can only be
computed once the archive is completely written, after this report was
already packaged).</p>
<h2>Warnings</h2>
<table><thead><tr><th>Path</th><th>Status</th><th>Reason</th></tr></thead><tbody>${warningRows}</tbody></table>
</body>
</html>
`;
}
