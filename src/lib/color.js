/*
 * Deterministic, warm monogram colours.
 * A person with no photo never gets a grey placeholder (see §1) — they get a
 * characterful initialled bubble whose colour is derived from their name, so it
 * is stable across sessions and devices.
 */

// A curated, warm, heirloom-album palette. No cold blues, no muddy greys.
const PALETTE = [
  ['#c2603a', '#e89a76'], // terracotta
  ['#3f5e4e', '#7fa088'], // sage
  ['#b08642', '#d8b878'], // ochre
  ['#8c5a6e', '#c194a6'], // dusky rose
  ['#5a6b8c', '#94a6c1'], // muted indigo
  ['#7a6a4f', '#b3a283'], // taupe
  ['#a4553a', '#d18b6f'], // burnt sienna
  ['#566b5e', '#92a896'], // eucalyptus
  ['#9c6b3f', '#cda077'], // caramel
  ['#6b5e7a', '#a294b3'], // heather
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function monogramColors(name) {
  const [base, light] = PALETTE[hash(name || '?') % PALETTE.length];
  return { base, light };
}

export function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Hex string → 0xRRGGBB number for PixiJS.
export function hex(str) {
  return parseInt(str.replace('#', ''), 16);
}
