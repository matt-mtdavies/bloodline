/*
 * Site-level admin allowlist — separate from the per-family `coadmin` role
 * (family_member.role), which only governs one family's tree. This is for
 * the small handful of people who run the whole platform and should see the
 * admin dashboard (all users, all trees, AI spend, deliverability).
 *
 * ADMIN_EMAILS is a comma-separated list ("matt@x.com, jase@x.com"). The
 * older singular ADMIN_EMAIL is still read as a fallback so an existing
 * deployment keeps working without an env var rename the moment this ships.
 */
export function adminEmailList(env) {
  const raw = env.ADMIN_EMAILS || env.ADMIN_EMAIL || '';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAdminEmail(env, email) {
  if (!email) return false;
  return adminEmailList(env).includes(email.toLowerCase());
}
