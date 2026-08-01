# Bloodline Productization Brief

**Status:** Design and product specification  
**Audience:** Product, design, engineering, legal review  
**Owner:** Bloodline  
**Implementation partner:** Claude  
**Decision date:** 2026-08-01

## 1. The decision

Bloodline will become a public-facing family-history product, not merely an
application reached by existing members. A first-time visitor must be able to
understand the product, trust it with family information, choose a starting
path, and begin without being dropped straight into an authentication form.

The public experience and the signed-in application have different jobs:

| Surface | Job |
| --- | --- |
| Public site | Explain, inspire, earn trust, and let a visitor choose a path. |
| Invitation landing | Reassure a person who was invited and make joining feel safe and personal. |
| Signed-in product | Help a family preserve, understand, and collaborate around its actual history. |

Bloodline should **not** try to outspend record-database genealogy companies.
Its promise is a private, beautiful, family-controlled home for the history a
family already knows and the memories it wants to keep.

### Positioning

**Primary promise**

> Your family’s living story—beautifully preserved, privately shared, and
> always yours to keep.

**Supporting proof points**

- A living, visual family tree rather than a spreadsheet of names.
- Stories, photos, documents, events, and relationships in one shared family
  home.
- Living people and children protected by family-controlled access.
- Multiple ways to begin: build gently, import a GEDCOM, or join an invite.
- Clear ownership and export language. Never claim permanence that the product
  or operating model cannot actually guarantee.

### What Bloodline is not

- Not a public, crowd-edited global tree.
- Not an advertising surveillance product.
- Not a substitute for a professional genealogy research database.
- Not a generic social network for relatives.

This distinction must be visible in the writing, information architecture, and
monetisation decisions—not only in a brand document.

## 2. Product principles

1. **A family, not a dataset.** Lead with people and memories before features,
   metrics, or research terminology.
2. **Trust precedes conversion.** Explain privacy, ownership, invitations, and
   exports before asking for sensitive living-person information.
3. **One clear next action.** Every public page has one primary CTA and one
   quiet alternate route.
4. **Beautifully calm.** Editorial typography, generous white space, real
   family imagery with permission, and motion that supports orientation rather
   than competing with reading.
5. **No dark patterns.** No forced trial, misleading scarcity, pre-ticked
   marketing consent, surprise paywall, or advertising disguised as family
   content.
6. **Every family counts.** Language and visual examples must work for
   adoptive, step, blended, single-parent, LGBTQ+, chosen, and multi-cultural
   families.
7. **Own your history.** Export and deletion must remain intelligible,
   findable, and available regardless of a future plan choice.

## 3. Audiences and jobs to be done

### A. The family steward

Usually the person holding photos, documents, and accumulated research.

- Wants one safe, attractive place to organise and share a family archive.
- Is wary of importing data, duplicates, and losing years of work.
- Needs obvious roles, invitations, review-before-apply importing, and a
  credible export story.

### B. The newly invited relative

- Wants to know who invited them, what they can see, and whether they are
  expected to do work.
- Needs a one-minute join path and a welcoming first contribution such as a
  portrait, a correction, or a memory.

### C. The family storyteller

- Wants to preserve voices, photos, stories, and context for future
  generations.
- Needs emotionally rewarding, low-friction prompts—not genealogy expertise.

### D. The genealogist migrating an existing tree

- Needs GEDCOM import, transparent data handling, reviewable changes,
  duplicates safeguards, and export portability.
- Does not need to be sold “magic.” They need competence and control.

## 4. Competitive posture

Large competitors centre their public funnels on historical records, automated
hints, matches, and large research networks. MyHeritage also makes import,
private family sites, and printable charts prominent. FamilySearch centres a
free, shared world tree. Bloodline’s differentiated territory is the
**private, visual, emotionally resonant family home**.

| Competitor expectation | Bloodline answer |
| --- | --- |
| “Give us facts and we will find records.” | “Bring the people and stories your family already carries; make them present and shareable.” |
| “A huge public or semi-public network.” | “A family-controlled space with explicit membership and roles.” |
| “Research tools and dense charts.” | “An immersive tree, human profiles, timelines, and stories—while still respecting serious data.” |
| “Import your GEDCOM.” | “Import it safely, see exactly what would change, and keep the ability to take it back out.” |

Do not make unsupported comparative claims such as “more private than every
competitor” or “the most beautiful family-tree app.” Let product proof,
careful language, and real customer stories establish the difference.

## 5. Required public information architecture

### Primary navigation

Desktop:

`Bloodline` · `How it works` · `Features` · `Privacy & ownership` · `Sign in`
· **`Start your family tree`**

Mobile:

Brand, `Start your family tree`, and a concise menu containing the same
destinations. Never hide the primary CTA in the menu.

The signed-in app keeps its product navigation. The public header must not
reuse the dense in-app tree controls.

### Required pages for launch

| Route | Purpose | Primary CTA |
| --- | --- | --- |
| `/` | Product home for signed-out visitors. | Start your family tree |
| `/how-it-works` | Explain the journey from first name to shared legacy. | Begin with your family |
| `/features` | Show the product pillars with real UI and clear boundaries. | See your family differently |
| `/privacy` | Human-readable trust and ownership explanation; links to legal policy. | Read our privacy policy |
| `/import` | Dedicated migration page for GEDCOM users. | Bring your existing tree |
| `/help` | Getting started, invitations, privacy, import/export, and contact. | Get help |
| `/invite/:token` | Invite-specific landing before auth/acceptance. | Join this family |
| `/terms.html`, `/privacy.html` | Legal documents, linked globally. | — |
| `/sign-in` | Focused passwordless sign-in, not the marketing homepage. | Send me a code |

### Launch footer

Product: How it works · Features · Import a GEDCOM  
Support: Help · Contact · Service status (once a real status process exists)  
Trust: Privacy & ownership · Privacy Policy · Terms · Accessibility statement  
Account: Sign in · Start your family tree

Do not add a Blog, Careers, Press, or large resource library until there is
enough real content to make each destination useful.

## 6. Homepage brief

### 6.1 Hero

**Eyebrow:** A private home for family history  
**Headline:** Your family is more than names and dates.  
**Supporting line:** Bring the people, memories, photographs, and stories that
make your family yours—then share them with the people who belong in it.

**Primary CTA:** Start your family tree  
**Secondary CTA:** See how it works  
**Supporting reassurance:** Free to begin · No password · Private by default

Visual direction: a composed, non-interactive art-directed tree scene that
gradually resolves into portraits, relationship lines, and small story
fragments. It must be fast, responsive, and understandable as a still image.
It is not a live 1,100-person canvas embedded in the marketing page.

### 6.2 Immediate trust strip

Three compact proof points, each linked to further explanation:

- **Private by default** — access belongs to the family you invite.
- **No ads in your family story** — family data is never used to target ads.
- **Yours to keep** — export your data when the supported archive export is
  production-ready.

Do not use the final point until the product genuinely delivers the stated
export scope. Until then, say exactly what GEDCOM can export and what it
cannot.

### 6.3 The product story

Use a four-beat scroll narrative, with one real UI composition per beat:

1. **Start with someone you love.** Enter one name, not a form full of
   genealogy jargon.
2. **Let the family take shape.** Add relationships in the way your family
   actually understands them.
3. **Keep what only your family knows.** Attach a photo, document, memory, or
   life detail to the right person.
4. **Share a living legacy.** Invite relatives to view, contribute, and carry
   it forward.

Each beat has one short paragraph and one visual. Avoid feature-card grids as
the main storytelling device.

### 6.4 Feature proof

Four editorial feature cards, each leading to a section on `/features`:

- **See the connections** — immersive tree, traditional chart, accessible
  list, and personal Family Perimeter.
- **Remember the person** — profiles, memories, photographs, documents,
  timeline, and Keepsake.
- **Build it together** — invitations, roles, activity, and meaningful small
  contributions.
- **Bring your history with you** — GEDCOM import, review-before-apply,
  duplicate safeguards, and transparent export capability.

### 6.5 Starting paths

This section is mandatory. A visitor must never wonder whether Bloodline is
for them because they already have a tree.

| Path | Description | CTA |
| --- | --- | --- |
| Start a new family story | Begin gently with the people you know. | Start fresh |
| Bring an existing tree | Import a GEDCOM and review every change before it applies. | Import a GEDCOM |
| Join a family | Already invited? Sign in with the same email. | Join your family |

### 6.6 Privacy and ownership

Use plain language, not a wall of legal claims. Cover:

- Who can see living people.
- What family roles mean.
- What is not public or indexed.
- Whether family data trains AI or is used for advertising.
- How export, correction, deletion, and support requests work.

Link visibly to the full policies. This section must be technically and
legally verified before launch.

### 6.7 Closing CTA

**Headline:** Start with one name. Keep a whole history.  
**CTA:** Start your family tree  
**Secondary:** Bring a GEDCOM instead

## 7. Page-level briefs

### How it works

Goal: eliminate fear for newcomers without becoming a help manual.

1. Start with what you know.
2. Add people and memories at your own pace.
3. Invite the relatives who should be part of it.
4. Keep the archive understandable as it grows.

Include an honest “What Bloodline does and does not do” block: it preserves
and organises family history; it does not automatically prove historical
facts or expose a public tree.

### Features

Feature sections must use product evidence, not generic benefit cards:

- Family tree and views.
- People and life stories.
- Photos, documents, memories, and Keepsake.
- Timeline and insights.
- Collaboration, invitations, and roles.
- Family Perimeter for large shared trees.
- Import, deduplication, and export.

For each feature, state: what it is, why it matters, what the person controls,
and any meaningful limitation. Do not put an AI claim ahead of family control
or imply that AI-generated content is historical fact.

### Privacy & ownership

This is a designed trust page, not the legal policy duplicated with different
type. It needs four answer-first modules:

- Your family chooses who belongs.
- Living people are protected.
- Your family data is not advertising inventory.
- You can export, correct, or remove your data.

Include an explicit contact route and link to legal documents. Every claim
must match deployed behaviour and reviewed policy.

### Import a GEDCOM

Audience: someone who has years of genealogy work elsewhere.

Hero: **Bring your history with you.**  
Proof: supported standard fields, what media is or is not imported, merge vs.
replace, review-before-apply, duplicate safeguards, and rollback/recovery
expectations.  
CTA: **Import a GEDCOM**.

Never imply a lossless migration until all media and archive behaviour is
implemented and verified.

### Help

Launch with compact, excellent answers—not a placeholder knowledge base:

- I was invited to a family.
- Start a new family tree.
- Import a GEDCOM.
- Add or correct a person.
- Invite a relative and understand roles.
- Privacy for living people and children.
- Export, deletion, and data requests.
- Contact support.

Search can wait until there are enough articles to justify it.

### Invitation landing

The invite route must show, before sign-in:

- the inviting family name;
- inviter identity when available;
- the role being offered;
- a short statement of what joining allows;
- privacy reassurance; and
- one CTA: `Join the [Family Name] family`.

Never show private tree details to an unauthenticated invite recipient.

## 8. First-time activation

### Start-path chooser

After `Start your family tree`, show a focused route chooser before requiring
effortful onboarding:

1. **Start fresh** — guided starter flow.
2. **Import my GEDCOM** — authenticate, then import in a protected review
   flow.
3. **I have an invitation** — sign in with the invited email.

### Guided starter flow

Retain Bloodline’s emotionally distinctive memory prompt, but make the total
effort clear:

> About two minutes. Skip anything; you can add it later.

Recommended order:

1. Your name.
2. People who form your immediate family, with flexible relationship labels.
3. One optional memory or photograph.
4. Family name and the first view of the tree.

Use `Parent 1` / `Parent 2` defaults, with optional labels, rather than
gendered placeholder copy. Preserve the ability to represent biological,
adoptive, step, and chosen family relationships clearly.

The first completed screen should feel rewarding: the new tree opens around
the person, shows one calm next action, and explains how to invite someone.
Do not immediately ask for payment, marketing consent, or a long tutorial.

## 9. Visual and interaction direction

### Visual system

- Continue Bloodline’s warm paper, ink, terracotta, sage, and gold palette.
- Use the display face for editorial statements; use the body face for facts,
  instructions, and legal material.
- Give every public page one hero image/composition and a restrained rhythm of
  generous sections. Avoid SaaS-card overload.
- Use real, permissioned family material only. Where none is available, use
  deliberately anonymised illustrative data and label it as an example.
- Build screenshots as carefully art-directed compositions, not raw captures
  of dense development data.

### Motion

- Motion orients; it never performs for its own sake.
- Entrance movement: 180–350 ms for ordinary controls; one longer, quiet hero
  composition is acceptable.
- No continuously moving marketing background, auto-advancing carousel, or
  ticker.
- Respect reduced-motion preferences everywhere.

### Responsiveness and accessibility

- Design mobile first; public pages must feel native on a phone.
- Every interactive target is at least 44×44 px on coarse-pointer devices.
- Maintain visible focus, semantic headings, captioned media, image alt text,
  and sufficient text contrast.
- Do not rely on hover for essential meaning.
- Test hero imagery and CTA hierarchy at 320 px, 390 px, 768 px, and desktop.

## 10. Monetisation: plans and advertising

### The governing rule

Monetisation may fund Bloodline; it must never turn intimate family data into
ad inventory or hold a family archive hostage.

### Plans architecture

Build the public-site information architecture now, but do not invent prices
or limits until unit economics and support capacity are decided.

Recommended future plan structure:

| Plan | Intended customer | Product posture |
| --- | --- | --- |
| Free | A family beginning its story | A useful, dignified core experience; no timed trial trap. |
| Family | A household or small collaborating family | More storage, collaboration capacity, richer preservation features. |
| Family Plus | A serious family steward / large archive | Higher storage and large-archive capabilities, premium preservation outputs, priority support. |

Potential paid capability areas—subject to product and cost validation:

- additional photo/document storage;
- advanced Keepsake or print-quality outputs;
- premium archive/export tooling;
- larger collaborator limits or advanced administrative controls;
- priority support;
- future research integrations.

**Non-negotiable plan rules**

- Existing family data remains readable.
- A person can export their data without being forced to upgrade solely to
  retrieve it.
- Payment state never quietly changes privacy settings or family roles.
- Upgrade prompts appear at a genuine product boundary, not during emotional
  moments such as adding a memory.
- The plans page is hidden until pricing, billing, support, cancellation, and
  refund policies are genuinely ready.

When ready, add `/plans` to primary navigation and the footer. Its page should
lead with a fair comparison table, clear billing cadence, feature boundaries,
cancel-anytime language, and a short FAQ. Do not use a fake “most popular”
badge without real product reasoning.

### Advertising options

Advertising is an optional future revenue stream, not a default product
behaviour. Its boundaries must be designed before any ad SDK, tracking pixel,
or sales relationship is introduced.

**Permitted future models**

1. Clearly labelled, contextual sponsorship on public educational content
   (for example, a preservation guide sponsored by a reputable scanning or
   printing partner).
2. An explicitly labelled partner recommendation in a non-sensitive discovery
   surface, selected from page context only—not from family records, health
   information, relationships, or behavioural profiles.
3. A paid plan that removes public-site sponsorship placements, if this is a
   meaningful and transparent customer choice.

**Never permitted**

- Ads in the tree canvas, person profile, memories, document viewer, timeline,
  Keepsake, onboarding, invitation, or child/living-person screens.
- Behavioural advertising based on family data, family activity, or inferred
  ancestry, ethnicity, health, religion, relationships, or location.
- Third-party advertising trackers in the authenticated application.
- Native ads that can be mistaken for family content, hints, records, or AI
  recommendations.
- Advertising that changes what a family can export, see, or keep.

If advertising is enabled, the Privacy Policy, cookie disclosures, consent
mechanisms, in-product controls, and data-processing agreements must be
rewritten and professionally reviewed *before* it ships. Existing copy that
states Bloodline never shows ads must remain true until that work is complete.

## 11. Operational product-readiness requirements

These are launch gates, not optional marketing polish:

1. **Accurate legal and trust copy.** Independently review Terms, Privacy
   Policy, security statements, retention claims, AI disclosures, and any
   storage-location statement against deployed reality.
2. **Direct support route.** Publish a monitored contact address or support
   form, an owner, and an expected response standard.
3. **Account and data rights.** Make account deletion, personal-data access,
   correction, and export paths discoverable and test them end-to-end.
4. **Billing readiness before paid launch.** Tax, receipts, failed payments,
   cancellation, renewal messaging, refunds, support, and entitlement
   enforcement must exist before showing prices.
5. **Role and invitation clarity.** Visitors and members must understand what
   viewer, contributor, editor, co-admin, and owner permissions mean.
6. **Reliability transparency.** Add a service-status destination only once
   there is a real incident/update process behind it.
7. **Measurement without surveillance.** Measure funnel events with
   privacy-preserving, aggregate telemetry: public CTA click, path chosen,
   onboarding completion, first tree created/import completed, invitation
   accepted, and first meaningful contribution. Do not record family content.
8. **Content operations.** Assign ownership for public copy, help articles,
   screenshots, and legal-change review so the site cannot become stale.

## 12. Delivery plan

### Phase A — Product foundation

- Public route shell, public header/footer, design tokens, and responsive
  templates.
- Homepage, How it works, Features, Privacy & ownership, Help, and sign-in
  separation.
- Rework the first-time route chooser; retain the existing guided flow behind
  `Start fresh`.
- Invite landing audit and polish.
- Legal/trust-copy verification plan.

**Exit criteria:** a signed-out visitor can explain Bloodline, identify the
right starting path, understand basic privacy posture, and reach sign-in from
every public page.

### Phase B — Migration and activation

- Dedicated Import page and import-path handoff.
- First-session activation instrumentation.
- Newcomer and invited-relative usability testing.
- Help articles for the top launch questions.

**Exit criteria:** both a blank-slate user and a GEDCOM owner can begin without
guessing, and no product claim overstates import/export capability.

### Phase C — Commercial readiness

- Plans model, billing system, entitlement model, receipts, cancellation, and
  support procedures.
- `/plans` page and upgrade surfaces only after the commercial system is real.
- Advertising policy, consent architecture, and legal review before any
  sponsorship placement.

**Exit criteria:** no monetisation is deceptive, privacy-incompatible, or
dependent on family-data targeting.

### Phase D — Growth content

- Permissioned customer stories.
- High-quality preservation and family-history guides.
- Search-optimised public content only where it contributes genuine help.

## 13. Success measures

Baseline first; do not set fictional targets before measurement exists.

- Visitor → start-path selection rate.
- Start-path selection → completed first tree or completed import rate.
- Invite landing → accepted invitation rate.
- First-week meaningful action: a relationship, photo, memory, document, or
  invitation.
- Support contacts by confusion category.
- Trust comprehension in usability tests: privacy, roles, export, and
  advertising posture.
- Accessibility audit pass rate and mobile Core Web Vitals.

## 14. Implementation guardrails for Claude

- Do not modify production family data, migrations, role permissions, billing,
  advertising, analytics, or third-party tracking while implementing the
  public-site foundation unless a separate reviewed PR explicitly authorises
  it.
- Build public pages with realistic anonymised fixture data; never put real
  family data in source, screenshots, fixtures, or marketing assets.
- Use route-level code splitting and optimised responsive images. The public
  page must not load the full Pixi tree application or large tree data before a
  user enters the product.
- Preserve existing auth, invitation, onboarding, GEDCOM, and export flows
  unless a focused change is specified and tested.
- Add automated checks for public routes, legal/footer links, mobile layout,
  keyboard navigation, reduced motion, and no-auth access to authenticated
  screens.
- Treat all copy in this brief as a product-direction draft. Verify any legal,
  security, storage, retention, pricing, or feature claim against deployed
  behaviour before publishing it.

## 15. Explicitly out of scope for the first public-site PR

- Live billing or pricing.
- Advertising code, ad networks, pixels, sponsorship sales, or consent UI.
- New research-record integrations.
- A public social network, public searchable family profiles, or a global
  crowd-edited tree.
- A broad SEO blog with placeholder articles.
- Any claim that a full lossless archive export exists before it has passed its
  production verification and support checks.

## 16. SEO and discoverability

SEO is a product discipline, not a list of metadata chores. Bloodline earns
search traffic by publishing genuinely useful, original family-history help
and by making its public product pages fast, legible, and technically
indexable. It must never trade a family’s privacy for organic reach.

### 16.1 SEO objective

Build a durable, high-intent acquisition channel for people who are looking to:

- start a private family tree;
- organise or preserve family photographs, documents, and stories;
- understand how to invite relatives into a shared family tree;
- import an existing GEDCOM safely; and
- decide which family-history product is right for them.

The search result should accurately set expectations. A visitor who arrives
from Google should recognise the page they clicked, find a complete answer,
and have one appropriate next step.

### 16.2 Indexing boundary: public knowledge, never private family data

| May be indexed | Must never be indexed |
| --- | --- |
| Public marketing pages, help articles, original guides, feature pages, plans (when real), and public product announcements. | Authenticated tree canvas, person profiles, search results, family names, memories, documents, media URLs, activity, invite tokens, account settings, exports, and all user-generated family content. |

This is an absolute privacy boundary. Do not make a person or family profile
public merely to create search inventory. Any future public-sharing feature
requires its own consent model, threat model, legal review, and separate
product brief.

### 16.3 Information architecture for search

Use stable, descriptive, canonical public URLs:

```
/
/how-it-works
/features
/privacy
/import
/help
/guides/
/guides/how-to-start-a-family-tree
/guides/import-a-gedcom-file
/guides/invite-family-to-a-private-family-tree
/guides/preserve-family-photos-and-stories
```

Use `/guides/` only for useful, maintained editorial content. Do not create
dozens of near-identical city, surname, ethnicity, relationship, or
competitor-comparison pages merely to capture keywords.

### 16.4 Search themes and initial content roadmap

Start with a small editorial library that Bloodline can make materially better
than generic content. Each guide needs a named owner, a source/review date,
an original point of view, and a clear next step.

| Theme | Visitor need | Initial page |
| --- | --- | --- |
| Starting a tree | “I do not know where to begin.” | How to start a family tree when all you have are names and stories |
| Private sharing | “How can my family collaborate safely?” | How to create a private family tree for your family |
| Preservation | “What should I do with old photographs and documents?” | A practical guide to preserving family photos, documents, and stories |
| Importing | “Can I bring my genealogy work with me?” | How to import a GEDCOM file—and what to review first |
| Family participation | “How do I get relatives to contribute?” | Seven low-pressure ways to invite relatives into the family story |
| Family structures | “Will this represent my family accurately?” | Building a family tree that includes adoptive, step, blended, and chosen family |
| Ownership | “What happens to my data?” | What it means to own and export your family history |

Avoid publishing an article just because a keyword has volume. It must provide
more depth, clarity, or practical help than the search result already offers.
Family-history advice can be sensitive; factual claims about history,
genealogy, preservation, privacy, or law need appropriate sourcing and review.

### 16.5 On-page standards

Every indexable public page must have:

- a unique, descriptive `<title>` and a human-written meta description;
- one visible page purpose and a clear H1;
- useful text content in the initial rendered HTML, not only inside a canvas,
  image, video, or client-only application shell;
- a descriptive, stable URL;
- one canonical URL;
- relevant internal links to adjacent help and product pages;
- optimised, permissioned images with meaningful alt text;
- an author or accountable editorial owner and “last reviewed” date for
guides where currency matters; and
- one primary CTA that matches the query’s intent.

Examples:

| Page | Working title | CTA |
| --- | --- | --- |
| Home | Bloodline | Start your private family tree |
| How it works | How Bloodline helps families preserve their stories | See how it works |
| Import | Import a GEDCOM file into Bloodline | Bring your existing tree |
| Guide | How to start a family tree: a gentle first step | Start with your family |

Title and description copy must be deliberately authored per page, not
assembled from a generic template such as “Bloodline | Family Tree.”

### 16.6 Technical SEO requirements

The existing application is a client-side experience. The public marketing and
guide routes must be served or pre-rendered as complete, fast HTML documents;
do not make crawlers execute the full authenticated Pixi application just to
understand the homepage.

Required launch work:

1. Serve public routes with prerendering or server-side rendering, including
   title, description, canonical URL, Open Graph/Twitter metadata, and page
   body content in the first HTML response.
2. Add a curated `/sitemap.xml` containing only canonical indexable public
   routes, with correct `lastmod` values when content actually changes.
3. Add `/robots.txt` that permits public content and blocks private application
   paths. `robots.txt` is not the protection mechanism: sensitive responses
   must also use `X-Robots-Tag: noindex, nofollow` or an equivalent meta rule,
   and require authentication server-side.
4. Canonicalise `www`/non-`www`, trailing-slash conventions, parameters, and
   duplicate campaign URLs. Redirect non-canonical variants rather than
   creating duplicate indexable pages.
5. Ensure each public page has a share image, site name, favicon, accurate
   page title, and useful preview description.
6. Ship responsive images with explicit dimensions, modern formats, lazy
   loading below the fold, and no layout shift.
7. Keep public JavaScript small and route-split. Do not preload the tree
   renderer, private app code, large fixtures, or authenticated API requests
   on public pages.
8. Test mobile rendering, keyboard navigation, and Core Web Vitals before
   launch. A gorgeous but slow visual hero is not acceptable.
9. Register the domain in Google Search Console and Bing Webmaster Tools;
   submit the sitemap, inspect the homepage and key routes, and monitor
   crawl/indexing failures after each release.
10. Validate structured data and rendered HTML in the relevant search tools;
   treat structured data as a correctness and understanding aid, never a
   ranking shortcut.

Google’s own guidance emphasises people-first, original, helpful content;
accessible rendered content; descriptive URLs; and crawlable CSS/JavaScript.
It also recommends verifying how Google sees a JavaScript site and submitting
a sitemap for discovery. [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
and [developer guide](https://developers.google.com/search/docs/fundamentals/get-started-developers).

### 16.7 Structured data

Use JSON-LD only where it describes visible, truthful page content:

- `Organization` and `WebSite` on the public site root.
- `SoftwareApplication` on the product homepage/features page when the
  properties accurately reflect the available application.
- `BreadcrumbList` on guides and help content.
- `Article` with author, date published, and date modified for maintained
  guides.
- `VideoObject` only for real, accessible product videos with transcripts or
  equivalent text context.

Do not add fake ratings, invented reviews, unsupported pricing, or schema for
content hidden from users. FAQ and HowTo markup must not be treated as a
traffic tactic: Google has substantially reduced these rich-result treatments
for ordinary commercial sites. [Google’s Search appearance guidance](https://developers.google.com/search/docs/appearance)
and [structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
set the applicable standard.

### 16.8 Content design and editorial quality

Every guide should follow this shape:

1. Answer the question in the opening paragraph.
2. Explain the practical steps with real examples.
3. Address privacy, uncertainty, and common mistakes when relevant.
4. Link naturally to the next useful guide or product route.
5. State author/reviewer, update date, and source basis where useful.

Do not use AI to mass-produce unreviewed family-history articles. It will
damage trust, produce repetitive search pages, and create maintenance debt.
AI can assist research and drafting only with an accountable human editor,
fact-checking, source review, and a distinct editorial point of view.

### 16.9 Measurement and operating cadence

Use privacy-preserving analytics and Search Console as the core search
measurement stack. Do not inject third-party behavioural tracking into the
authenticated family product for SEO measurement.

Track at aggregate level:

- impressions, clicks, CTR, and query/page groups in Search Console;
- indexed versus excluded public URLs;
- Core Web Vitals and crawl errors;
- organic landing page → start-path selection;
- organic landing page → completed first tree/import; and
- guide freshness, inbound links, and support questions that reveal missing
content.

Monthly: review search queries, index coverage, broken links, titles, and
outdated guides. Quarterly: prune, merge, or substantially update low-value
content rather than allowing a stale library to grow indefinitely.

### 16.10 SEO launch gates

- No authenticated or user-generated family URL appears in the sitemap or is
  indexable.
- Public routes render useful, page-specific text without requiring client-side
  interaction.
- Each public route has unique title, description, canonical, social preview,
  and a validated responsive layout.
- Sitemap, robots, redirects, and noindex headers are tested in staging and
  production.
- Search Console ownership and monitoring are operational.
- All claims about privacy, export, pricing, AI, and advertising are accurate
  at the time of publication.
- At least the seven initial guides above pass editorial and factual review;
  none are thin keyword pages.
