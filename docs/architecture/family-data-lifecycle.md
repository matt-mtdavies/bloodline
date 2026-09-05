# Family data lifecycle

```mermaid
flowchart TD
  login[Authenticated family member] --> load[GET /api/tree]
  load --> core[D1 tree core]
  core -->|legacy| full[Full tree]
  core -->|migrated pointer| extra[R2 tree extra]
  extra --> reassemble[Reassemble and verify]
  reassemble --> full
  full --> client[Client store and local cache]
  client --> edit[Authorized edit]
  edit --> snapshot[Preserve snapshot / concurrency state]
  snapshot --> writeextra[Write and verify R2 extra]
  writeextra --> writecore[Commit D1 core pointer]
  writecore --> sync[Other devices sync]
  reset[Whole-tree reset or restore] --> epoch[Stamp restoreEpoch]
  epoch --> sync
```

## Load-bearing rules

1. A migrated tree is never returned partially when required R2 extra cannot
   be read.
2. R2 extra is written and verified before D1 receives its authoritative
   pointer.
3. Whole-tree reset and recovery paths stamp `_restoreEpoch`; clients compare
   it before ordinary record-by-record merging.
4. Destructive production operations follow `docs/SAFETY.md` and require a
   separately approved R3 runbook.

