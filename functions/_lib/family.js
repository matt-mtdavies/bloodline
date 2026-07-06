import { uid } from './util.js';

// Creates a brand-new family, makes `userId` its owner, and makes it that
// user's active tree. Shared by two callers: /api/tree's PUT auto-create
// (a user's very first save, who has no membership at all yet) and
// POST /api/families (an explicit "Create new tree" action from someone
// who already has at least one tree and wants to start another).
export async function createFamily(env, userId, name) {
  const now = Math.floor(Date.now() / 1000);
  const familyId = uid('f_');
  const familyName = (name || '').trim() || 'My Family';

  await env.DB.prepare(
    'INSERT INTO family (id, name, created_by, created_at) VALUES (?, ?, ?, ?)',
  ).bind(familyId, familyName, userId, now).run();
  await env.DB.prepare(
    `INSERT INTO family_member (family_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
  ).bind(familyId, userId, now).run();
  await env.DB.prepare('UPDATE user SET family_id = ? WHERE id = ?').bind(familyId, userId).run();

  return { family_id: familyId, name: familyName, role: 'owner' };
}
