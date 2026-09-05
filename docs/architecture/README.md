# Bloodline architecture centre

This directory is the concise, current map of how Bloodline hangs together.
It complements the deeper operational documents rather than replacing them.

## Maps

- [System context](system-context.md) — browser, Pages Functions, storage,
  workflow, and external services.
- [Family data lifecycle](family-data-lifecycle.md) — loading, saving,
  split-tree persistence, recovery, and the safety boundaries around them.
- [Tree rendering](tree-rendering.md) — the shared graph and the deliberately
  separate visualization modes.

## Decisions

Significant architectural choices live in [`decisions/`](decisions/README.md).
Each record describes the context, the choice, alternatives, and consequences.

## Operating references

- [Architecture](../ARCHITECTURE.md)
- [Safety](../SAFETY.md)
- [Operating system](../OPERATING-SYSTEM.md)
- [Tree storage](../TREE-STORAGE.md)
- [Full archive export](../FULL-ARCHIVE-EXPORT-COMPLETION-PHASE.md)

The admin Product Operations page presents a deliberately compact version of
these maps. These Markdown sources remain the reviewable source of truth.

