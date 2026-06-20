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
