/*
 * GET /sign-in
 * Focused passwordless sign-in — not the marketing homepage. Collects an
 * email, requests a one-time code, then hands off to the SPA's own
 * LoginScreen (which already knows how to collect the OTP) via ?auth_email=.
 * An optional ?start= is carried straight through so App.jsx can route a
 * brand-new account into the right first action (see src/App.jsx
 * _initialStartIntent). See docs/PRODUCTIZATION-BRIEF.md §5, §7, §8.
 */
import { publicPage, breadcrumbStructuredData } from './_lib/publicShell.js';
import { Icons } from './_lib/publicIcons.js';

const START_COPY = {
  fresh: 'Starting a new family tree — sign in to begin.',
  import: 'Bringing in a GEDCOM file — sign in first, then import in a guided review flow.',
  invite: 'Already invited? Sign in with the same email your invitation was sent to.',
};

export async function onRequestGet({ request, env }) {
  const home = env.APP_URL || 'https://myfamilybloodline.com';
  const url = new URL(request.url);
  const start = url.searchParams.get('start');
  const contextLine = START_COPY[start] || 'Sign in with your email — no password to remember.';
  const structuredData = [
    breadcrumbStructuredData(home, [{ name: 'Home', href: '/' }, { name: 'Sign in' }]),
  ];

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
        <div id="signin-sent-wrap" style="display:none;">
          <div style="color:var(--sage); margin-bottom:14px;">${Icons.mail(34)}</div>
          <p style="font-family:var(--display); font-weight:700; font-size:19px; margin-bottom:8px;">Check your inbox</p>
          <p style="color:var(--ink-soft); font-size:14.5px; line-height:1.6;">We sent a sign-in code to <strong id="signin-sent-email"></strong>. Enter it on the next screen to continue.</p>
        </div>
        <p class="pub-form-note">Don't have a family tree yet? <a href="/start" style="color:var(--accent-deep); font-weight:700;">Start one instead</a>.</p>
      </div>
    </div>
  </section>

  <script>
  (function () {
    var START = ${JSON.stringify(start || '')};
    var emailEl = document.getElementById('email');
    var btn = document.getElementById('signin-submit');
    var hint = document.getElementById('signin-hint');
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
        document.getElementById('signin-form-wrap').style.display = 'none';
        document.getElementById('signin-sent-wrap').style.display = 'block';
        document.getElementById('signin-sent-email').textContent = email;
        var dest = '/?auth_email=' + encodeURIComponent(email);
        if (START) dest += '&start=' + encodeURIComponent(START);
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
