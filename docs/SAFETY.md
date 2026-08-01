# Safety invariants

These constraints take priority over speed and convenience.

## Privacy and authorization

- Never disclose one family's data to another family or an unauthenticated caller.
- Server-side authentication, membership, role, visibility, and admin checks are authoritative.
- Treat living people and children as private by default when designing or changing behavior.
  The current default-visibility and server-return paths require a separate implementation
  audit; do not describe this policy as fully enforced until that work is verified.
- Treat production family data as sensitive. Do not copy it into commits, fixtures,
  screenshots, issue trackers, AI prompts, analytics, or other third-party systems.
- Engineering-only issue tracking may include technical descriptions and commit hashes, but
  never names, records, family identifiers, private URLs, screenshots, or other production
  family data.
- Keep secrets and private object identifiers out of client bundles and logs.

## Persistence

- Never silently return a partial tree when required migrated R2 extra cannot be read.
- On a split-tree write, write and verify R2 extra before updating the authoritative D1
  core/version pointer.
- Never automatically migrate a legacy family. Migration is an explicit, separately
  authorized production operation.
- Preserve concurrency checks, snapshots, tombstones, role restrictions, and compatibility
  behavior unless a reviewed design deliberately replaces them.
- Applied migrations are immutable. Schema evolution requires a new forward migration.

## Destructive whole-tree operations

Real incident (2026-08-01): a family's GEDCOM import dialog defaulted its "Replace vs.
Merge" choice to **Replace** for any owner/co-admin — pre-selected, one tap of the
already-highlighted main action button away from committing — with only a line of subtext
as a warning. An owner intending an incremental "delta" update did not notice Replace was
already selected, wiped 797 of 1,104 people, and the client's own tombstone-propagation
(see Persistence above) meant even a correct server-side restore kept getting silently
re-undone by the device's stale local cache until the actual mechanism was found. Full
recovery took three attempts and roughly 20 minutes of a family owner watching their real
tree disappear. This must never happen again — any change touching an operation in this
category is reviewed against every rule below before it ships, not after:

- **Never pre-select a destructive whole-tree action**, regardless of the acting user's
  permission level. The default state of any "replace/reset/erase the whole tree" control
  must always be the safe, additive choice. Permission controls who is ALLOWED to choose
  the destructive option — it must never decide which option is chosen for them.
- **A destructive whole-tree action requires typed confirmation**, not a single tap and not
  a `window.confirm()`. The bar is: the user types the family's own name back before the
  action can fire (see `FamilySettings.jsx`'s "Start over — erase tree", and
  `GedcomImport.jsx` / `FamilySearchImport.jsx`'s Replace-mode gate, both sharing the same
  `fs__reset-*` UI). A warning sentence next to an otherwise-live button is not sufficient
  friction — the pre-incident GEDCOM Replace flow had exactly that, and it wasn't enough.
- **A destructive whole-tree write must tombstone what it removes** (already true —
  `resetTree()` and `importFromGedcom`'s replace path both do this) so a later sync can't
  silently resurrect the wiped data underneath a fresh, intentional change. But tombstoning
  everything has a real, non-obvious side effect: it also poisons every OTHER device's
  local cache against the very data a later restore brings back. Any new destructive
  whole-tree operation must be designed with this side effect in mind, not just the write
  itself — see the next rule.
- **A restore-style recovery action must clear the client's own local cache before
  reloading, not just write the server.** `_mergeByRecency` and tombstone-union logic
  (`src/data/store.js`) are correct and must not be weakened — they exist so no device can
  silently lose real work. But that exact correctness means a device holding a stale,
  tombstone-poisoned local cache will re-assert itself over a legitimate server-side
  restore on its very next sync, undoing the fix with no error and no visible cause. The
  only reliable fix is a clean slate: `FamilySettings.jsx`'s `restoreSnapshot` calls
  `clearLocalData()` (the same call `handleLogout` already makes) before reloading, so nothing
  stale is left to fight the restore. Any future recovery/restore code path must do the same.
  **This alone is not sufficient — see `_restoreEpoch` below.** It only protects the ONE
  device performing the restore; a real second incident (same day) came from a completely
  different device — an old Safari tab that had simply been left open from before the fix —
  syncing later and silently reverting it a second time, with no `restoreSnapshot` call
  involved at all.
- **Every authoritative whole-tree reset must stamp `_restoreEpoch`, and every sync must
  check it before merging.** This is the actual fix for the "different, already-open
  device" case above, and it's the load-bearing rule in this section — everything else
  reduces how OFTEN a destructive reset happens; this is what makes a reset (intentional or
  corrective) stick regardless of what any other device was doing at the time.
  `_restoreEpoch` is a top-level, core (never-split-to-R2) field bumped to a fresh timestamp
  by every authoritative reset — `resetTree()`, `importFromGedcom`'s replace path
  (`src/data/store.js`), and the snapshot-restore endpoint
  (`functions/api/tree/snapshots/[id].js`) — and checked by every client sync path
  (`loadFromServer` and `_fetchAndMerge`/`_pollServer`, via the shared `isNewerRestore`
  helper) BEFORE the normal per-record `_mergeByRecency`/tombstone-union merge runs. Any
  device whose own last-seen `_restoreEpoch` is behind the server's takes the server
  wholesale — exactly like the existing `forceServerWins` path used when joining a family
  via invite — no per-record merge, no tombstone union, no vote for local's pre-reset data,
  regardless of how recent or legitimate-looking that local data's own `updated_at`
  timestamps are. Any new code path that performs (or could be argued to perform) an
  authoritative whole-tree reset must stamp this field; any new sync/merge path must check
  it first, before touching `_mergeByRecency`.
- **When performing an emergency data restore directly against production** (D1/R2, not
  through the app), always archive the current state as a fresh snapshot first — the same
  thing the app's own restore endpoint does — so the action is itself undoable, AND stamp
  `_restoreEpoch` to a fresh `Date.now()`-style millisecond timestamp on the restored core
  JSON. Prefer the app's own tested restore endpoint (`POST /api/tree/snapshots/:id`) over
  hand-written SQL whenever an authenticated session is available — it already does both of
  the above. Hand-written SQL is a last resort for exactly the scenario that produced this
  rule (no session, `d1_database_query` MCP access only), and must reproduce the endpoint's
  full behavior, not just copy the snapshot's people/relationships — a restore that forgets
  `_restoreEpoch` looks successful immediately and then silently reverts the next time any
  other device (open or not, active or not) happens to sync.

## Production operations

Production migrations, restores, bulk edits, destructive storage actions, and deployments
that can alter family data are R3 operations. They require a named human operator, written
approval, a current backup, a tested step-by-step runbook, staged rollout, observable success
criteria, and a rollback or recovery procedure.

Stop when actual state differs from the runbook. Preserve evidence and diagnose before retrying.
