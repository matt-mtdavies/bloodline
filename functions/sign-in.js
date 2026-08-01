/*
 * GET /sign-in
 * Focused passwordless sign-in — not the marketing homepage. Collects an
 * email, requests a one-time code, then hands off to the SPA's own
 * LoginScreen (which already knows how to collect the OTP). An optional
 * ?start= is carried straight through (via URL — it's a UI hint, not
 * sensitive) so App.jsx can route a brand-new account into the right first
 * action (see src/App.jsx _initialStartIntent). The email itself is handed
 * off via sessionStorage rather than a URL param — unlike the existing
 * invite-landing page's ?auth_email= handoff (functions/invite/[token].js,
 * unchanged here — that's an already-shipped, separately-reviewed flow),
 * this is new code with no reason to put PII in the URL/history/logs when a
 * same-origin sessionStorage relay works just as well and LoginScreen reads
 * it out and clears it in the same tick. See docs/PRODUCTIZATION-BRIEF.md
 * §5, §7, §8.
 */
import { publicPage, breadcrumbStructuredData } from './_lib/publicShell.js';

const START_COPY = {
  fresh: 'Starting a new family tree — sign in to begin.',
  import: 'Bringing in a GEDCOM file — sign in first, then import in a guided review flow.',
  invite: 'Already invited? Sign in with the same email your invitation was sent to.',
};

export async function onRequestGet({ request, env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const url = new URL(request.url);
  // ?start= is attacker-controlled and gets embedded into an inline <script>
  // below — allowlist it against the only three values this page ever acts
  // on, so anything else (including an HTML/script-injection attempt) is
  // simply dropped rather than reaching the response at all.
  const requestedStart = url.searchParams.get('start');
  const start = Object.prototype.hasOwnProperty.call(START_COPY, requestedStart)
    ? requestedStart
    : '';
  const contextLine = START_COPY[start] || 'Sign in with your email — no password to remember.';
  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'Sign in' }]),
  ];
  // Belt-and-suspenders alongside the allowlist above: JSON.stringify does
  // NOT escape '<', so a literal "</script>" inside an embedded string can
  // still terminate this script element early and inject markup. Escaping
  // '<' to its unicode escape defeats that regardless of what value ever
  // ends up here.
  const serializedStart = JSON.stringify(start).replace(/</g, '\\u003c');

  const content = `
  <section class="pub-section">
    <div class="pub-wrap pub-wrap--narrow" style="text-align:center;">
      <p class="pub-breadcrumb" style="text-align:left;"><a href="/">Bloodline</a> &rsaquo; Sign in</p>
      <p class="pub-eyebrow">Sign in</p>
      <h1 class="pub-hero__title" style="font-size:clamp(28px,4.6vw,38px); margin-bottom:10px;">Welcome back.</h1>
      <p class="pub-lede" style="margin:0 auto 30px;">${contextLine}</p>

      <div class="pub-form-card">
        <div id="signin-form-wrap">
          <label class="pub-label" for="email">Email address</label>
          <input id="email" class="pub-input" type="email" placeholder="you@example.com" autocomplete="email" inputmode="email">
          <button id="signin-submit" class="pub-btn pub-btn--primary pub-btn--block" type="button">Send me a code</button>
          <p id="signin-hint" class="pub-form-hint"></p>
        </div>
        <p class="pub-form-note">Don't have a family tree yet? <a href="/start" style="color:var(--accent-deep); font-weight:700;">Start one instead</a>.</p>
      </div>
    </div>
  </section>

  <script>
  (function () {
    var START = ${serializedStart};
    var emailEl = document.getElementById('email');
    var btn = document.getElementById('signin-submit');
    var hint = document.getElementById('signin-hint');
    // Activation-funnel telemetry (docs/PRODUCTIZATION-BRIEF.md §11.7):
    // reaching this page with a real, allowlisted ?start= is the "path
    // chosen" moment — the visitor picked fresh/import/invite on /start and
    // is now proceeding to sign in. A bare /sign-in visit (no ?start=, e.g.
    // a returning member using the footer link) isn't a path choice, so it
    // deliberately doesn't fire this.
    if (START) {
      try {
        if (navigator.sendBeacon) navigator.sendBeacon('/api/activation-event', new Blob([JSON.stringify({ event: 'path_chosen', path: START })], { type: 'application/json' }));
      } catch (e) {}
    }
    function send() {
      var email = emailEl.value.trim();
      if (!email) { hint.textContent = 'Enter your email to continue.'; return; }
      btn.disabled = true;
      btn.textContent = 'Sending…';
      hint.textContent = '';
      fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email }),
      }).then(function (res) {
        if (!res.ok) throw new Error();
        // Hand the email to LoginScreen via sessionStorage rather than a URL
        // query param, so it never lands in browser history, copied links,
        // screenshots, or access logs — LoginScreen reads this once on
        // mount and removes it immediately. ?start= alone (a non-sensitive
        // UI hint, not PII) still travels via the URL.
        //
        // If storage is blocked (Safari private browsing, a storage policy,
        // a full quota), the code has already been sent server-side but
        // there'd be no way left to hand the email to LoginScreen — silently
        // redirecting would strand the user on a blank email-entry screen
        // with no clue a code is already waiting. Caught separately from
        // the network-failure catch below so this gets its own honest
        // message instead of the generic "something went wrong" one.
        try {
          sessionStorage.setItem('bl_signin_email', email);
        } catch (e) {
          hint.textContent = 'Your browser blocked temporary storage needed to continue. Enable cookies/storage for this site, or use the code entry link in the email we just sent.';
          btn.disabled = false;
          btn.textContent = 'Send me a code';
          return;
        }
        var dest = '/';
        if (START) dest += '?start=' + encodeURIComponent(START);
        window.location.href = dest;
      }).catch(function () {
        hint.textContent = 'Something went wrong. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Send me a code';
      });
    }
    btn.addEventListener('click', send);
    emailEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  })();
  </script>`;

  const html = publicPage({
    home,
    path: '/sign-in',
    title: 'Sign in to Bloodline',
    description: 'Sign in to your family tree with a one-time email code — no password required.',
    activeKey: null,
    noindex: false,
    structuredData,
    content,
    ctaHref: '/start',
    ctaLabel: 'Start your family tree',
  });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
