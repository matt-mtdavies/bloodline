# System context

```mermaid
flowchart LR
  member[Family member] --> pwa[Bloodline PWA<br/>React + PixiJS]
  admin[Site administrator] --> adminui[Admin surfaces]
  pwa --> pages[Cloudflare Pages Functions]
  adminui --> pages
  pages --> d1[(D1<br/>identity, membership, tree core)]
  pages --> r2[(R2<br/>tree extra, media, archives)]
  pages --> workflow[Export Workflow Worker]
  workflow --> d1
  workflow --> r2
  pages --> brevo[Brevo<br/>transactional email]
  pages --> anthropic[Anthropic<br/>server-side AI]
  pages --> familysearch[FamilySearch]
  pages --> github[GitHub<br/>read-only engineering activity]
```

## Boundaries

- The browser never receives provider secrets.
- Pages Functions are the authoritative authentication and authorization
  boundary.
- D1 holds identity, membership, relational metadata, and the authoritative
  tree-core pointer.
- R2 holds rich tree extra, media, documents, and generated archives.
- The product activity feed reads a small projection of public repository
  metadata. It never reads pull-request bodies, patches, or family data.

