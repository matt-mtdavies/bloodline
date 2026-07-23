import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * "Complete Bloodline archive" card (docs/FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md
 * §10) — the second Export-section card in FamilySettings.jsx, alongside
 * the existing GEDCOM export button. Everything here is a thin client over
 * functions/api/exports* — no authority/serialization logic duplicated
 * here, it all lives server-side in functions/_lib/exportService.js; this
 * component only renders whatever state that API reports.
 */

const STATUS_LABELS = {
  queued: 'Queued', snapshotting: 'Preparing a snapshot', inventory: 'Cataloguing files',
  packaging: 'Building the archive', verifying: 'Verifying', cancelling: 'Cancelling…',
  ready: 'Ready', ready_with_warnings: 'Ready (with warnings)', failed: 'Failed',
  cancelled: 'Cancelled', expired: 'Expired',
};
const RUNNING = new Set(['queued', 'snapshotting', 'inventory', 'packaging', 'verifying', 'cancelling']);
const TERMINAL = new Set(['ready', 'ready_with_warnings', 'failed', 'cancelled', 'expired']);

const FAST_POLL_MS = 2000;
const SLOW_POLL_MS = 5000;
const FAST_POLL_WINDOW_MS = 30000;

export default function ExportArchiveCard({ canPrepare }) {
  const [job, setJob] = useState(null); // most recent job, or null before the first load
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState(null); // 'not_configured' | 'generic' | null
  const [announcement, setAnnouncement] = useState('');

  const pollTimerRef = useRef(null);
  const pollStartRef = useRef(0);
  const mountedRef = useRef(true);
  const jobIdRef = useRef(null);

  // Resetting mountedRef.current = true INSIDE the effect (not just relying
  // on useRef(true)'s initial value) matters: React 18 StrictMode mounts
  // every component, runs this cleanup once, then remounts it — all before
  // any real unmount — to surface exactly this class of bug. Without the
  // reset here, that simulated cleanup would leave mountedRef permanently
  // false for the rest of the component's real lifetime, silently
  // discarding every fetch result (confirmed live: it caused every "created"
  // job to be dropped, always falling back to the generic "queued" state).
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearPoll(); };
  }, []);

  function clearPoll() {
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
  }

  const fetchJob = useCallback(async (jobId) => {
    try {
      const res = await fetch(`/api/exports/${jobId}`);
      if (res.status === 503) { if (mountedRef.current) setError('not_configured'); return null; }
      if (!res.ok) { if (mountedRef.current) setError('generic'); return null; }
      const body = await res.json();
      if (!mountedRef.current) return null;
      setJob((prev) => {
        if (!prev || prev.status !== body.status) {
          setAnnouncement(STATUS_LABELS[body.status] || body.status);
        }
        return body;
      });
      setError(null);
      return body;
    } catch {
      if (mountedRef.current) setError('generic');
      return null;
    }
  }, []);

  const schedulePoll = useCallback((jobId) => {
    clearPoll();
    if (document.hidden) return; // resumes on visibilitychange below
    const elapsed = Date.now() - pollStartRef.current;
    const delay = elapsed < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS;
    pollTimerRef.current = setTimeout(async () => {
      const updated = await fetchJob(jobId);
      if (updated && !TERMINAL.has(updated.status) && jobIdRef.current === jobId) schedulePoll(jobId);
    }, delay);
  }, [fetchJob]);

  const startPolling = useCallback((jobId) => {
    jobIdRef.current = jobId;
    pollStartRef.current = Date.now();
    schedulePoll(jobId);
  }, [schedulePoll]);

  // Resume immediately when the tab becomes visible again (§10 polling
  // contract: "pause hidden; refresh on visible").
  useEffect(() => {
    function onVisibility() {
      if (!document.hidden && jobIdRef.current && !TERMINAL.has(job?.status)) {
        fetchJob(jobIdRef.current).then(() => schedulePoll(jobIdRef.current));
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [fetchJob, schedulePoll, job?.status]);

  // Initial load — see if a job already exists for this family (e.g. the
  // page was reloaded mid-export).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/exports');
        if (res.status === 503) { setError('not_configured'); setLoaded(true); return; }
        if (!res.ok) { setError('generic'); setLoaded(true); return; }
        const body = await res.json();
        const latest = (body.exports || [])[0] || null;
        setJob(latest);
        setLoaded(true);
        if (latest && RUNNING.has(latest.status)) startPolling(latest.id);
      } catch {
        setError('generic');
        setLoaded(true);
      }
    })();
  }, [startPolling]);

  async function handlePrepare() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/exports', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error === 'export_already_active' ? 'already_active' : (body.error || 'generic'));
        return;
      }
      setConfirming(false);
      const created = await fetchJob(body.id);
      startPolling(body.id);
      if (!created) setJob({ id: body.id, status: 'queued', progress: {}, warningCount: 0 });
    } catch {
      setError('generic');
    } finally {
      setCreating(false);
    }
  }

  async function handleCancel() {
    if (!job) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/exports/${job.id}/cancel`, { method: 'POST' });
      if (res.ok) setJob(await res.json());
    } catch { /* the next poll will reconcile */ }
    finally {
      setCancelling(false);
    }
  }

  if (!canPrepare) {
    return (
      <div className="ea__card ea__card--disabled">
        <p className="ea__title">Complete Bloodline archive</p>
        <p className="ea__hint">Only the family owner or a co-admin can prepare a complete archive.</p>
      </div>
    );
  }

  const running = job && RUNNING.has(job.status);
  const ready = job && (job.status === 'ready' || job.status === 'ready_with_warnings');
  const failed = job && job.status === 'failed';

  return (
    <div className="ea__card">
      <p className="ea__title">Complete Bloodline archive</p>
      <p className="ea__desc">
        Every person and private field, relationship, memory, photo, document and Keepsake —
        including living people and children. A single ZIP file you keep, browsable offline.
      </p>

      <div aria-live="polite" className="visually-hidden">{announcement}</div>

      {error === 'not_configured' && (
        <p className="ea__hint">Complete archives aren&apos;t available on this deployment yet.</p>
      )}

      {loaded && !running && !ready && !failed && !confirming && error !== 'not_configured' && (
        <button type="button" className="ea__btn" onClick={() => setConfirming(true)}>
          Prepare complete archive
        </button>
      )}

      {confirming && (
        <div className="ea__confirm">
          <p className="ea__confirm-line">This archive is an ordinary, unencrypted ZIP file — anyone who gets a copy can open it.</p>
          <p className="ea__confirm-line">It&apos;s a snapshot of the tree at the moment it&apos;s prepared; edits made afterward won&apos;t be included.</p>
          <p className="ea__confirm-line">It stays available to download for 72 hours, then expires automatically.</p>
          <div className="ea__confirm-btns">
            <button type="button" className="ea__btn" disabled={creating} onClick={handlePrepare}>
              {creating ? 'Preparing…' : 'Prepare complete archive'}
            </button>
            <button type="button" className="ea__btn-secondary" disabled={creating} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {job && (running || ready || failed || job.status === 'cancelled' || job.status === 'expired') && (
        <div className="ea__status" role="status">
          <div className="ea__status-row">
            <span className={`ea__dot ea__dot--${statusTone(job.status)}`} aria-hidden="true" />
            <span className="ea__status-label">{STATUS_LABELS[job.status] || job.status}</span>
          </div>
          {running && job.progress?.expectedFiles ? (
            <p className="ea__progress">{job.progress.processedFiles} of {job.progress.expectedFiles} files</p>
          ) : null}
          {ready && job.warningCount > 0 && (
            <p className="ea__hint">{job.warningCount} file{job.warningCount === 1 ? '' : 's'} couldn&apos;t be included — everything else is there.</p>
          )}
          {failed && <p className="ea__hint">Something went wrong preparing this archive.</p>}

          <div className="ea__actions">
            {running && (
              <button type="button" className="ea__btn-secondary" disabled={cancelling || job.status === 'cancelling'} onClick={handleCancel}>
                {job.status === 'cancelling' ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
            {ready && (
              <a className="ea__btn" href={`/api/exports/${job.id}/download`}>Download</a>
            )}
            {(ready || failed || job.status === 'cancelled' || job.status === 'expired') && (
              <button type="button" className="ea__btn-secondary" onClick={() => setConfirming(true)}>Prepare new archive</button>
            )}
          </div>
        </div>
      )}

      {error === 'already_active' && <p className="ea__hint">An archive is already being prepared for this family.</p>}
      {error === 'generic' && <p className="ea__err">Something went wrong — please try again.</p>}
    </div>
  );
}

function statusTone(status) {
  if (status === 'ready') return 'ready';
  if (status === 'ready_with_warnings') return 'warn';
  if (status === 'failed') return 'fail';
  if (status === 'cancelled' || status === 'expired') return 'muted';
  return 'active';
}
