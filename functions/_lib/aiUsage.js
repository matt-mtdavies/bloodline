/*
 * Best-effort logging of every Anthropic API call, for the admin dashboard's
 * "estimated AI spend" section. Never lets a metrics write break the actual
 * feature — a failed insert here is swallowed, not thrown.
 */

// USD per 1M tokens, standard list pricing (not any time-limited intro rate,
// so this estimate doesn't silently jump the day an intro discount ends).
// Update alongside functions/api/**/*.js if a model changes.
const PRICING = {
  'claude-sonnet-5':   { input: 3.00, output: 15.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5':  { input: 1.00, output: 5.00 },
  'claude-opus-4-8':   { input: 5.00, output: 25.00 },
};

export function estimateCostUsd(model, inputTokens, outputTokens) {
  const p = PRICING[model];
  if (!p) return null;
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

// Call after every upstream Anthropic response, success or failure — a
// failure still burns tokens once the request is billed, and a spike in
// failures is itself something worth seeing on the dashboard. `usage` is
// Anthropic's own response.usage object ({ input_tokens, output_tokens }),
// so this never estimates token counts itself.
export async function logAiUsage(env, { endpoint, model, usage, user, ok = true }) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO ai_usage_log (id, endpoint, model, input_tokens, output_tokens, user_id, user_email, ok, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    ).bind(
      crypto.randomUUID(),
      endpoint,
      model,
      usage?.input_tokens || 0,
      usage?.output_tokens || 0,
      user?.uid || null,
      user?.email || null,
      ok ? 1 : 0,
    ).run();
  } catch (e) {
    console.error('[ai-usage] log failed:', e.message);
  }
}
