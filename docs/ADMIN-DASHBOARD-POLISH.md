# Bloodline Admin Dashboard — Complete polish implementation brief

## Ownership and workflow

- **Design lead:** Codex defines the experience, acceptance criteria, and final visual review.
- **Implementer:** Claude implements this brief on a short-lived branch from current `main`, verifies it, and opens a pull request.
- **Product owner:** Matthew validates the Cloudflare preview and approves the merge.
- **Risk:** R1 — a substantial but contained UI reliability and presentation change. Do not change authentication, authorization, API response contracts, storage, migrations, or email delivery behavior. If a desired presentation cannot be produced from the existing responses, document that gap rather than expanding into backend work.

## Outcome

Turn the existing long analytics page into a polished operational dashboard that immediately communicates health, priorities, recent change, and available actions. Make it reliable during loading and failures, responsive on narrow screens, keyboard accessible, privacy-conscious during screen sharing, and consistent with Bloodline's visual identity. Preserve backend behavior and existing data access boundaries.

## In scope

### 1. Page loading and fatal error states

Replace the current ambiguous full-page loading state with a small, branded state that includes the Bloodline mark, “Loading admin dashboard”, and an animated progress indicator.

If `/api/admin/stats` returns an unexpected non-success response or the request fails:

- Remove the loading indicator.
- Display a visible full-page error state; it must not be placed inside the hidden `.app` container.
- Use the title “Dashboard unavailable”.
- Show a concise reason when it is safe and useful, without exposing server internals.
- Provide a **Try again** button and a **Back to Bloodline** link.
- Preserve the existing, distinct 401 “Sign in required” and 403 “Access denied” states.
- Announce the changed state to assistive technology.

### 2. Refresh behavior

When Refresh is activated:

- Disable the button until the primary stats request settles.
- Change its label to “Refreshing…” and show a subtle spinner.
- Preserve the existing dashboard while refreshing; do not replace populated sections with skeletons.
- Prevent repeated requests from multiple clicks.
- On success, restore “Refresh” and update the timestamp.
- On failure, keep the existing dashboard visible and show a dismissible inline error above the first section with a **Try again** action.
- Use `aria-busy` and an `aria-live` status message.

The timestamp should use concise relative language such as “Updated just now” initially and may retain an exact time in an accessible label or tooltip. Do not imply that separately loaded Cloudflare or feedback data refreshed if those requests failed.

### 3. Email and diagnostic action states

For **Send test email to myself** and **Run delivery check**:

- Disable the activated button while its request is pending.
- Use action-specific progress labels: “Sending…” and “Checking…”.
- Prevent duplicate submissions.
- Restore the normal label after completion.
- Present success and failure results in consistent status panels with an icon, heading, and concise supporting text.
- Move focus to, or programmatically announce, the result without disruptive scrolling.
- Continue to send the test email only to the authenticated administrator, exactly as today.

Do not add a confirmation dialog in this pass; the existing helper copy adequately explains that a real email is sent.

### 4. Responsive header

Desktop behavior remains a single sticky row.

At narrow widths:

- Keep the Bloodline mark and “Admin” identity visible.
- Shorten “Admin Dashboard” to “Admin” if necessary.
- Keep Refresh visible and at least 44px high.
- Move the updated timestamp to a second line or visually subordinate position.
- Avoid horizontal overflow from the safe-area inset through 320px viewport width.
- Ensure the sticky header does not obscure focused elements or section content.

### 5. Responsive cards, charts, and tables

- Retain the existing one-column chart/table layout below the current breakpoint.
- Metric cards should become two columns where space permits and one column only when needed; no card should be narrower than approximately 150px.
- Reduce chart padding and height modestly on phones while keeping labels readable.
- Wrap every data table in a dedicated horizontal-scroll region on narrow screens.
- Do not use `overflow: hidden` where it clips table columns.
- Provide a subtle edge treatment or helper text when horizontal scrolling is available.
- Keep table headings associated with their data and preserve full values in the DOM.
- Long emails, family names, errors, and feedback must wrap or truncate predictably without widening the page.
- The document must have no horizontal page-level overflow at 320, 375, 390, 768, and 1440 CSS pixels.

Do not redesign tables as mobile cards in Phase 1.

### 6. Keyboard and accessibility polish

- Add a consistent, high-contrast `:focus-visible` treatment for links, buttons, and horizontally scrollable table regions.
- All interactive controls must have a minimum 44×44px target on touch layouts.
- Buttons must expose disabled/busy state visually and semantically.
- Status and error messages must not rely on colour or emoji alone.
- Add `prefers-reduced-motion` handling that disables the rotating spinner and nonessential transitions while retaining a visible loading indicator.
- Preserve sensible document heading hierarchy and give each table an accessible name through a caption or `aria-labelledby`.
- Verify contrast for secondary text, badges, focus rings, and status panels.

### 7. Visual consistency

- Preserve the existing Bloodline palette, Fraunces/Hanken Grotesk typography, radii, and restrained shadows.
- Create reusable classes for action-result panels, busy buttons, table scroll containers, and inline errors.
- Remove touched inline presentation styles when a reusable class is clearer; do not refactor unrelated markup.
- Use a consistent icon treatment. Emoji may remain where already established, but every state also needs clear text.

### 8. Information architecture and section navigation

Reorganize the dashboard into four clearly named areas, using the existing metrics and tables:

1. **Overview** — operational attention summary, core user/family metrics, platform content, and a concise health snapshot.
2. **Growth & engagement** — signups, invites, activity, active families, and recent sign-ups.
3. **Operations** — AI usage/spend, Cloudflare traffic, storage-heavy trees, and configuration health.
4. **Communications** — email delivery, diagnostics, failures, and recent feedback.

Provide a sticky in-page navigation below the main header on desktop. On phones it may scroll horizontally or use a compact native/select-style control, but every area must remain keyboard accessible and deep-linkable through stable anchors. The active area should be apparent without using colour alone.

Do not hide essential information behind a JavaScript-only tab state. Anchor navigation and natural document flow should continue to work if active-section detection fails.

### 9. “Needs attention” operational summary

Add a summary immediately below the page title. It should derive alerts only from data already available to the page and should never invent certainty.

Potential alert conditions include:

- Recent invite email failures.
- Brevo not configured, sender information missing, or application URL missing.
- AI failures during the reported period.
- Cloudflare data unavailable or not configured.
- Trees already identified by the existing size thresholds.
- Expired invitations when the count is non-zero.

Requirements:

- Sort critical items before warnings and informational notices.
- Each item includes a text severity, concise explanation, and link to its relevant section.
- Never treat ordinary positive counts as intrinsically bad without a defined threshold.
- Do not introduce arbitrary spend or growth anomaly thresholds in this PR.
- When no conditions need attention, show a compact “All monitored systems look healthy” state and state that this reflects only the checks represented on the page.
- The summary must update when the dashboard refreshes or separately loaded sections settle.

### 10. Dashboard hierarchy and metric clarity

- Add a proper page heading and a one-line description beneath the sticky application header.
- Present a small set of core overview metrics with stronger hierarchy; secondary configuration values should use quieter rows rather than equal-weight KPI cards.
- Add short definitions or accessible help text for metrics whose meaning is not obvious.
- Rename **Retention (30d)** to **Active user share (30d)** unless the backend supplies a true cohort-retention calculation. Its helper text should explain that it is the share of all users active during the last 30 days.
- Use semantic status treatments consistently: green for confirmed healthy, amber for attention, red for failure, brand terracotta for emphasis/selection, and neutral for ordinary values.
- Every status colour must be paired with text or an icon carrying the same meaning.
- Reduce the repeated “white card with shadow” effect: retain stronger surfaces for primary summaries, use flatter bordered groups or dividers for secondary details, and preserve generous separation between major areas.

### 11. Table and chart usability

For tables:

- Add client-side sorting to columns where ordering is meaningful.
- Add a lightweight search/filter control to recent sign-ups and recent feedback when rows are present.
- Give rows hover and keyboard-focus treatments where they expose an action or detail; do not imply clickability on inert rows.
- Keep empty states specific and useful.
- Add copy controls for identifiers only where it clearly helps an administrator; controls must have accessible names and confirmation feedback.
- Do not add pagination or new API requests. Work with the rows currently supplied.

For charts:

- Add a concise textual summary near each chart so its meaning does not depend on canvas rendering.
- Improve empty states when there is no data or Chart.js fails to load.
- Keep legends, axes, and tooltips readable on mobile.
- Avoid redundant visualization: the invite funnel should use the numeric funnel summary as the primary communication; retain the chart only if it adds a genuinely clearer proportional view.
- Do not fabricate previous-period comparisons when the existing response does not provide them.

### 12. Privacy mode

Add a clearly labelled **Privacy mode** control in the header or page actions. It is a presentation control for screen sharing and screenshots, not a security boundary.

When enabled:

- Mask email addresses, family names, feedback messages, recipient values, and other person-identifying table content.
- Keep aggregate counts, charts, statuses, and configuration health visible.
- Make the masked state unmistakable and reversible.
- Persist the preference locally for the browser session or in local storage; do not send it to the server.
- Ensure masked values are not exposed through ordinary hover tooltips or copied by page-provided copy controls.
- Explain in accessible helper text that authorized data remains present in the page and Privacy mode is intended only to reduce accidental visual disclosure.

### 13. Maintainability within the standalone page

- Consolidate repeated inline styles into named classes.
- Centralize reusable rendering for status panels, buttons, table wrappers, empty states, and attention items.
- Keep the implementation in `public/admin.html` for this PR unless a very small adjacent stylesheet/module clearly reduces risk. Do not migrate the dashboard into React/Vite as part of this work.
- Preserve graceful operation when Chart.js or hosted fonts are unavailable.
- Keep copied theme tokens synchronized with the current visual system and add a focused automated assertion only if one can be maintained without brittle source-text comparison.

## Explicitly out of scope

- Moving the standalone page into React/Vite or restructuring it into multiple source files.
- Backend-powered drill-downs, exports, pagination, or new analytics queries.
- New previous-period comparisons, sparklines, spend budgets, or anomaly detection that require data not already returned.
- Changes to the underlying metric calculations, except correcting the displayed name/explanation of the current 30-day active-user share.
- API, database, authentication, authorization, Cloudflare, Brevo, or production configuration changes.

Any newly discovered backend requirement belongs in a documented follow-up rather than being silently added to this UI PR.

## Acceptance criteria

1. Successful initial load displays the same metrics, charts, tables, and actions as before.
2. A 401 and 403 show their respective authorization states with a working return link.
3. A 500 response and a network failure show “Dashboard unavailable” with a working retry action; no indefinite “Loading…” state remains.
4. Refresh cannot be submitted twice, leaves populated data visible, and recovers correctly after success or failure.
5. Both external-action buttons prevent duplicate submissions and announce their results.
6. At 320, 375, 390, 768, and 1440px, there is no page-level horizontal overflow, clipped header content, or inaccessible table data.
7. Every action is keyboard reachable and has a visible focus indicator.
8. Reduced-motion mode does not rotate or animate the spinner.
9. Existing admin API paths and response handling remain compatible.
10. No production data, email addresses, private URLs, credentials, or authenticated screenshots are committed.
11. The page is organized into the four specified areas with working keyboard-accessible anchor navigation.
12. “Needs attention” accurately reflects only available dashboard data, links to relevant sections, and has a healthy state.
13. “Retention (30d)” is relabelled and explained accurately as active user share unless a real cohort metric already exists.
14. Sort and filter controls work without extra API calls and do not make inert rows appear clickable.
15. Every chart has an adjacent text summary or meaningful empty/failure state.
16. Privacy mode masks identifying content without changing aggregate data or sending a server request.
17. The complete page remains usable when Chart.js is unavailable.

## Required verification

Claude should report the exact results of:

- `npm run verify:env`
- Relevant existing automated tests.
- `npm run build`
- The project’s browser smoke test where the environment permits it.
- Manual or automated visual checks at 390×844 and 1440×1000 using representative non-production fixture data.
- Explicit checks for success, 401, 403, 500, network failure, refresh failure, and repeated-click prevention.
- Keyboard-only traversal and reduced-motion behavior.
- Attention-summary healthy, warning, and failure combinations using fixture data.
- Anchor navigation, active-area treatment, sorting, filtering, chart fallback, and Privacy mode.
- A check that Privacy mode produces no network request and does not expose masked values through provided tooltips or copy actions.
- Complete diff review against current `main`.

Screenshots must contain representative fixture data only and should not be committed unless explicitly requested.

## PR handoff requirements

Implement and publish the complete scope as one pull request. Claude may organize the work into small, reviewable commits inside that branch, but should not open separate PRs for the individual sections.

The pull request should include:

- A concise summary organized by loading/errors, responsive layout, and accessibility.
- A second summary covering information architecture, attention logic, tables/charts, and Privacy mode.
- Confirmation that backend behavior and API contracts were not changed.
- Test/build/browser results, including any environment limitations.
- Desktop and mobile preview evidence using non-production data.
- A real Cloudflare preview URL if one was generated.
- Any deviations from this brief called out explicitly for Codex design review.

## Codex review checklist after implementation

Codex will review the complete PR diff and preview for:

- Fidelity to this complete brief without backend or production scope creep.
- Calm, brand-consistent visual execution.
- Correct hierarchy across loading, error, success, and busy states.
- Responsive behavior at the defined viewport widths.
- Keyboard focus, reduced motion, status announcements, and contrast.
- No regression to existing content or operational actions.
