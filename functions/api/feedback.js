import { json, uid, sendEmail, recordEmailStatus } from '../_lib/util.js';
import { adminEmailList } from '../_lib/adminAuth.js';

/*
 * POST /api/feedback  { type, message, page? }
 * Saves user feedback to D1 and emails the site owner.
 * Requires a valid session (auth wall keeps out spam).
 */
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB)    return json({ error: 'Database not configured' }, { status: 503 });

  let type, message, page;
  try {
    ({ type, message, page } = await request.json());
  } catch {
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!message?.trim()) {
    return json({ error: 'Message is required' }, { status: 400 });
  }

  const TYPES = ['idea', 'bug', 'praise', 'other'];
  const safeType = TYPES.includes(type) ? type : 'other';
  const safeMsg  = String(message).slice(0, 2000).trim();
  const safePage = page ? String(page).slice(0, 200) : null;
  const now = Math.floor(Date.now() / 1000);

  const feedbackId = uid('fb_');
  try {
    await env.DB.prepare(
      `INSERT INTO feedback (id, user_id, email, type, message, page, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(feedbackId, data.user.uid, data.user.email, safeType, safeMsg, safePage, now).run();
  } catch (e) {
    console.error('[feedback] DB error:', e.message);
    return json({ error: 'Could not save feedback' }, { status: 500 });
  }

  // Email the owner. Must be awaited, not fired-and-forgotten — an
  // un-awaited fetch here can be torn down by the runtime the moment this
  // handler returns its response, silently dropping the send before Brevo
  // ever receives it (this was the bug: feedback saved every time, the
  // notification email sent essentially never). Outcome is recorded either
  // way so a failure is visible in the feedback table, not just server logs.
  // Notify the primary (first-listed) admin — sendEmail only takes one
  // recipient today; every admin can still see all feedback on the dashboard.
  const adminEmail = adminEmailList(env)[0] || null;
  let emailStatus = null, emailError = null, emailSent = false;
  if (adminEmail) {
    const typeLabels = { idea: '💡 Idea', bug: '🐛 Bug report', praise: '🙌 Praise', other: '📬 Feedback' };
    const label = typeLabels[safeType] || 'Feedback';
    emailStatus = 'failed';
    try {
      const result = await sendEmail(env, {
        to: adminEmail,
        subject: `[Bloodline] ${label} from ${data.user.email}`,
        html: `
          <p style="font-family:sans-serif;color:#3a3330">
            <strong>${label}</strong> from <a href="mailto:${data.user.email}">${data.user.email}</a>
            ${safePage ? `<br><small style="color:#8a8480">Page: ${safePage}</small>` : ''}
          </p>
          <blockquote style="font-family:sans-serif;color:#3a3330;border-left:3px solid #c2603a;margin:12px 0;padding:8px 16px;background:#fdf8f2">
            ${safeMsg.replace(/\n/g, '<br>')}
          </blockquote>
          <p style="font-family:sans-serif;font-size:12px;color:#8a8480">
            View all feedback at <a href="${env.APP_URL || 'https://myfamilybloodline.com'}/admin.html">the admin dashboard</a>
          </p>
        `,
      });
      emailSent = true;
      emailStatus = result?.dev ? 'dev' : 'sent';
    } catch (e) {
      console.error('[feedback] email error:', e.message);
      emailError = String(e.message || 'Email delivery failed').slice(0, 200);
    }
  }
  await recordEmailStatus(env, 'feedback', feedbackId, emailStatus, emailError, emailSent ? now : null);

  return json({ ok: true });
}
