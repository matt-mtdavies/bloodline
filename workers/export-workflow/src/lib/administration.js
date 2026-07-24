/*
 * Shapes raw D1 rows into `data/administration/members.json` and
 * `invitations.json` (docs/FULL-ARCHIVE-EXPORT.md §3.4) — included ONLY in
 * site-admin exports (never a family owner/co-admin export, gated by the
 * caller checking `requestedAs === 'site_admin'` before calling either of
 * these). Pure shaping functions over already-fetched rows — the actual
 * SQL lives in workflowSteps.js#buildAdministrationFiles, matching the
 * "no direct DB/R2 opinion in a lib/ module" split the rest of this
 * package already uses.
 *
 * `invitations.json` deliberately excludes `token` (the raw invite
 * token — a live credential) and anything delivery-provider-specific per
 * §3.4's "removes tokens, raw delivery-provider payloads and secret
 * links" — only address, intended role, status and timestamps survive.
 */

export function buildMembersRecord(memberRows) {
  return (memberRows || []).map((r) => ({
    userId: r.user_id,
    email: r.email ?? null,
    role: r.role,
    invitedBy: r.invited_by ?? null,
    joinedAt: r.joined_at,
  }));
}

export function buildInvitationsRecord(inviteRows) {
  return (inviteRows || []).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}
