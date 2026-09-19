import { Texture } from 'pixi.js';

/*
 * A soft, blurred shadow rendered once to an offscreen canvas and reused by
 * every bubble as a Sprite. This gives a modern "floating" drop shadow without
 * the per-bubble blur-filter cost (and without the hard-edged dark disc that
 * read as old-school).
 */
let shadowTex = null;
export function softShadowTexture() {
  if (shadowTex) return shadowTex;
  const s = 160;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(24,22,20,0.42)');
  g.addColorStop(0.55, 'rgba(24,22,20,0.20)');
  g.addColorStop(1, 'rgba(24,22,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  shadowTex = Texture.from(c);
  return shadowTex;
}

/*
 * A warm radial glow — gold core melting into terracotta then transparent.
 * Used (with additive blending) by the time-view birth animation for the
 * descending mote, the central bloom flash, and the drifting life-motes.
 * Drawn once, tinted per-use via Sprite.tint, reused everywhere.
 */
let glowTex = null;
export function warmGlowTexture() {
  if (glowTex) return glowTex;
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0,    'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,243,214,0.95)');
  g.addColorStop(0.45, 'rgba(247,200,122,0.55)');
  g.addColorStop(0.75, 'rgba(194,96,58,0.18)');
  g.addColorStop(1,    'rgba(194,96,58,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  glowTex = Texture.from(c);
  return glowTex;
}

/*
 * Form-shading for a flat monogram disc — a rounded, matte object instead of
 * a flat cut-out colour swatch. Three gradients baked into one canvas so a
 * portrait needs only one extra sprite, not two:
 *   - a soft, DIFFUSE highlight offset toward the upper-left, as if lit by
 *     one broad, gentle light — never a tight specular point. The icon
 *     refresh review already ruled out a glossy/skeuomorphic direction for
 *     this app ("a different visual language — matte paper, not glossy
 *     skeuomorphism"); this has to read as a hand-finished bead or button,
 *     not a glass sphere or a plastic app-icon gloss.
 *   - a soft, DIFFUSE shade opposite the highlight (lower-right) — the actual
 *     "form" cue a lit sphere needs, so it reads as one side lit and the
 *     other in shadow rather than just a darker rim all the way around.
 *   - a quiet, concentric rim vignette, the same "sits on the ground, isn't
 *     a sticker" reasoning as the shadow sprite above, applied to the
 *     object's own surface rather than the paper beneath it.
 * Drawn once, reused by every monogram portrait as a single Sprite.
 *
 * First shipped version measured too subtle to register at real screenshot
 * scale/compression: a real production report saw no visible dimension at
 * all despite the effect being present and correctly wired everywhere it
 * should be. Verified directly against a clean local capture (1280×900,
 * cropped and enlarged) — the effect was genuinely there, just faint
 * (highlight max alpha 0.22, vignette max alpha 0.30), the kind of subtlety
 * that survives a close look but not a compressed phone screenshot of a
 * small monogram in a crowded tree. These values are roughly doubled, and
 * the added directional shade gives real light/dark sides rather than a
 * uniformly softened edge, while staying strictly additive, soft-edged and
 * low-alpha — matte, not glossy.
 */
let discShadingTex = null;
export function discShadingTexture() {
  if (discShadingTex) return discShadingTex;
  const s = 200;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const vignette = ctx.createRadialGradient(s / 2, s / 2, s * 0.30, s / 2, s / 2, s / 2);
  vignette.addColorStop(0, 'rgba(18,14,10,0)');
  vignette.addColorStop(0.74, 'rgba(18,14,10,0)');
  vignette.addColorStop(1, 'rgba(18,14,10,0.46)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, s, s);
  const shade = ctx.createRadialGradient(s * 0.68, s * 0.70, 0, s * 0.68, s * 0.70, s * 0.55);
  shade.addColorStop(0, 'rgba(15,11,8,0.24)');
  shade.addColorStop(0.6, 'rgba(15,11,8,0.08)');
  shade.addColorStop(1, 'rgba(15,11,8,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, s, s);
  const highlight = ctx.createRadialGradient(s * 0.35, s * 0.31, 0, s * 0.35, s * 0.31, s * 0.62);
  highlight.addColorStop(0, 'rgba(255,251,243,0.40)');
  highlight.addColorStop(0.5, 'rgba(255,251,243,0.14)');
  highlight.addColorStop(1, 'rgba(255,251,243,0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(0, 0, s, s);
  discShadingTex = Texture.from(c);
  return discShadingTex;
}
