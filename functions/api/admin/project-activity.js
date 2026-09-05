import { json } from '../../_lib/util.js';
import { adminEmailList, isAdminEmail } from '../../_lib/adminAuth.js';

const DEFAULT_REPOSITORY = 'matt-mtdavies/bloodline';
const MAX_ENTRIES = 30;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedPayload = null;
let cachedAt = 0;
let cachedKey = '';

function displayLabel(value) {
  return String(value || '').trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function githubHeaders(token) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'bloodline-product-operations',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function classify(labels, title) {
  const names = (labels || []).map((label) => String(label.name || '').trim().toLowerCase());
  const labelled = (prefix) => names.find((name) => name.startsWith(prefix))?.slice(prefix.length).trim();
  const words = String(title || '').toLowerCase();

  const type = displayLabel(labelled('type:'))
    || (/(fix|bug|correct|repair|prevent|restore)/.test(words) ? 'Fix'
      : /(docs|brief|spec|guide|document)/.test(words) ? 'Documentation'
        : /(polish|refine|design|ux|ui)/.test(words) ? 'Polish'
          : 'Feature');

  const area = displayLabel(labelled('area:'))
    || (/(atlas|canopy|tree|layout|physics|perimeter)/.test(words) ? 'Tree experience'
      : /(admin|operations|dashboard)/.test(words) ? 'Operations'
        : /(export|archive|gedcom)/.test(words) ? 'Exports'
          : /(auth|invite|member|role)/.test(words) ? 'Collaboration'
            : /(profile|keepsake|memory|photo|document)/.test(words) ? 'Family archive'
              : 'Product');

  const risk = labelled('risk:') || null;
  return { type, area, risk };
}

/*
 * Cloudflare Pages reports build/deploy state to GitHub via a CHECK RUN
 * (the modern Checks API — the same "Cloudflare Pages" entry you see as a
 * check on any PR), never via the legacy combined-status API this once
 * queried. That's not a matter of preference: a live call against this
 * repo's own merged PRs returned `{ total_count: 0, statuses: [] }` from
 * `/commits/{sha}/status` for a commit whose Checks API entry showed
 * `name: "Cloudflare Pages", conclusion: "success"` — the two are simply
 * different GitHub object models, and Cloudflare only ever populates one
 * of them. Querying the wrong one means every single entry reads "Deploy
 * unverified" forever, with a correctly-scoped token and no visible error
 * anywhere — exactly what a real deployment of this endpoint hit.
 */
function deploymentFromCheckRuns(body) {
  const runs = Array.isArray(body?.check_runs) ? body.check_runs : [];
  const cloudflare = runs.find((run) => /cloudflare pages/i.test(run.name || ''));
  if (!cloudflare) return { state: 'unverified', label: 'Deploy unverified', url: null };
  const link = cloudflare.html_url || cloudflare.details_url || null;
  if (cloudflare.status !== 'completed') return { state: 'pending', label: 'Deploying', url: link };
  if (cloudflare.conclusion === 'success') return { state: 'deployed', label: 'Deployed', url: link };
  return { state: 'failed', label: 'Deploy failed', url: link };
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const error = new Error(`GitHub API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function loadActivity(env) {
  const repository = String(env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return {
      generated_at: new Date().toISOString(),
      source: { available: false, repository, error: 'GITHUB_REPOSITORY is invalid' },
      deployment_verification: { configured: false },
      entries: [],
    };
  }

  const token = env.GITHUB_READ_TOKEN || '';
  const headers = githubHeaders(token);
  const apiRoot = `https://api.github.com/repos/${repository}`;

  try {
    const pulls = await fetchJson(`${apiRoot}/pulls?state=closed&sort=updated&direction=desc&per_page=50`, headers);
    const merged = pulls
      .filter((pull) => pull.merged_at)
      .sort((a, b) => new Date(b.merged_at) - new Date(a.merged_at))
      .slice(0, MAX_ENTRIES);

    // Check-run calls are deliberately token-gated. An unauthenticated
    // GitHub client only receives 60 requests/hour; spending 30 of them on a
    // single dashboard load would make the feed brittle. The merged feed is
    // fully useful without the optional token and labels deployment truthfully
    // as unverified until a read-only token is configured.
    const deploymentBySha = new Map();
    if (token) {
      const results = await Promise.allSettled(merged.map(async (pull) => {
        const status = await fetchJson(`${apiRoot}/commits/${encodeURIComponent(pull.merge_commit_sha)}/check-runs`, headers);
        return [pull.merge_commit_sha, deploymentFromCheckRuns(status)];
      }));
      for (const result of results) {
        if (result.status === 'fulfilled') deploymentBySha.set(...result.value);
      }
    }

    const entries = merged.map((pull) => {
      const classification = classify(pull.labels, pull.title);
      return {
        number: pull.number,
        title: pull.title,
        url: pull.html_url,
        merged_at: pull.merged_at,
        merge_sha: pull.merge_commit_sha,
        author: {
          login: pull.user?.login || 'Unknown',
          url: pull.user?.html_url || null,
        },
        merged_by: pull.merged_by?.login || null,
        labels: (pull.labels || []).map((label) => ({
          name: String(label.name || '').slice(0, 80),
          color: /^[0-9a-f]{6}$/i.test(label.color || '') ? label.color.toLowerCase() : 'd9d9d9',
        })).slice(0, 12),
        ...classification,
        deployment: deploymentBySha.get(pull.merge_commit_sha)
          || { state: 'unverified', label: 'Deploy unverified', url: null },
      };
    });

    return {
      generated_at: new Date().toISOString(),
      source: {
        available: true,
        repository,
        url: `https://github.com/${repository}`,
      },
      deployment_verification: {
        configured: Boolean(token),
        note: token
          ? 'Cloudflare Pages check runs are verified for each merged PR.'
          : 'Add the optional GITHUB_READ_TOKEN secret to verify Cloudflare Pages deployment statuses.',
      },
      entries,
    };
  } catch (error) {
    console.error('[admin/project-activity] GitHub read failed:', error.message);
    return {
      generated_at: new Date().toISOString(),
      source: {
        available: false,
        repository,
        url: `https://github.com/${repository}`,
        error: error.status === 403
          ? 'GitHub rate limit or access restriction'
          : 'GitHub is temporarily unavailable',
      },
      deployment_verification: { configured: Boolean(token) },
      entries: [],
    };
  }
}

/*
 * GET /api/admin/project-activity
 *
 * Site-admin-only, read-only product delivery feed. GitHub is the source of
 * truth. This endpoint intentionally returns a small allowlisted projection:
 * no PR bodies, patches, comments, private family identifiers, or secrets.
 */
export async function onRequestGet({ env, data, request }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!adminEmailList(env).length) return json({ error: 'ADMIN_EMAILS not configured' }, { status: 503 });
  if (!isAdminEmail(env, data.user.email)) return json({ error: 'Forbidden' }, { status: 403 });

  const cacheKey = `${env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY}:${Boolean(env.GITHUB_READ_TOKEN)}`;
  const bypassCache = /no-cache/i.test(request?.headers?.get('cache-control') || '');
  if (!bypassCache && cachedPayload && cachedKey === cacheKey && Date.now() - cachedAt < CACHE_TTL_MS) return json(cachedPayload);
  const payload = await loadActivity(env);
  cachedPayload = payload;
  cachedAt = Date.now();
  cachedKey = cacheKey;
  return json(payload);
}

export const _test = { classify, deploymentFromCheckRuns, loadActivity };
