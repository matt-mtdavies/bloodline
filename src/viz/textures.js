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
