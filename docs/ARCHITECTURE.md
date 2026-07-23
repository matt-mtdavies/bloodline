# Architecture

This document is an orientation map. Current code, migrations, and configuration remain
authoritative.

## Runtime

- The client is a React/Vite PWA. PixiJS renders the interactive family-tree visualization;
  accessible and profile experiences live in React components.
- Cloudflare Pages Functions in `functions/` provide authentication, tree, family, invite,
  photo, document, keepsake, insight, calendar, and administrative APIs.
- Cloudflare D1 stores users, families, memberships, invitations, audit/supporting records,
  and the authoritative tree core.
- Cloudflare R2 (`DOCS`) stores uploaded media/documents, generated artifacts, and rich tree
  extras for migrated families.
- Brevo sends transactional email. Anthropic powers server-side AI features. FamilySearch is
  an optional integration. Their secrets belong only in managed environment configuration.

## Tree storage contract

The browser continues to read and write one logical tree. Server helpers in
`functions/_lib/treeStore.js` split or reassemble storage as needed:

- Legacy families remain D1-only until a human deliberately migrates them.
- Migrated families keep the graph-critical core and authoritative extra-version pointer in D1.
- Rich/growing extra content lives in R2.
- Writes persist R2 extra before committing the D1 core/pointer.
- A missing or unreadable migrated extra is an error; the API must not return a plausible
  partial tree.

See `docs/TREE-STORAGE.md` for implementation and rollout detail. Verify that document against
current code before treating status prose as current.

## Trust boundaries

The browser is untrusted. Authentication, family membership, roles, visibility, mutation
limits, and administrative access must be enforced server-side. Client checks improve the
experience but never grant authority.
