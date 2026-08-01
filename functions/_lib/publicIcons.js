/*
 * Small shared line-icon set for the public pages — same 18-22px outline
 * style already used across the app's own SVG icons (currentColor,
 * ~1.7 stroke width). Kept separate from publicShell.js so page files can
 * import only what they need.
 */
const svg = (size, body) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;

export const Icons = {
  tree: (s = 22) => svg(s, '<circle cx="12" cy="4" r="2.2" stroke="currentColor" stroke-width="1.7"/><circle cx="5" cy="19" r="2.2" stroke="currentColor" stroke-width="1.7"/><circle cx="19" cy="19" r="2.2" stroke="currentColor" stroke-width="1.7"/><path d="M12 6.2v5M12 11.2l-5.5 5.3M12 11.2l5.5 5.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  heart: (s = 22) => svg(s, '<path d="M12 20s-7.5-4.6-10-9.4C.4 6.6 3 3 6.6 3c2 0 3.6 1 5.4 3 1.8-2 3.4-3 5.4-3 3.6 0 6.2 3.6 4.6 7.6C19.5 15.4 12 20 12 20z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'),
  photo: (s = 22) => svg(s, '<rect x="2" y="4.5" width="20" height="15" rx="2.4" stroke="currentColor" stroke-width="1.7"/><circle cx="8.3" cy="10" r="1.9" stroke="currentColor" stroke-width="1.7"/><path d="M22 16.5l-5.5-5-4.5 4-2.5-2.3L3 18" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'),
  people: (s = 22) => svg(s, '<circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.7"/><path d="M2.8 20c0-3.6 2.8-6.2 6.2-6.2s6.2 2.6 6.2 6.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="17" cy="7.5" r="2.4" stroke="currentColor" stroke-width="1.4"/><path d="M15.5 13.6c2.7.3 4.7 2.5 4.7 5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
  lock: (s = 22) => svg(s, '<rect x="4.5" y="10.5" width="15" height="10" rx="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M7.5 10.5V7.8a4.5 4.5 0 019 0v2.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  noAd: (s = 22) => svg(s, '<rect x="2.5" y="5" width="19" height="14" rx="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M6.5 15.5l4-7 4 7M7.3 13.5h6.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20l16-16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  download: (s = 22) => svg(s, '<path d="M12 3.5v11.5M7.2 10.4L12 15.2l4.8-4.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17.5v1.7a2.3 2.3 0 002.3 2.3h11.4a2.3 2.3 0 002.3-2.3v-1.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  doc: (s = 22) => svg(s, '<path d="M6 2.8h8l4 4v13.4a1 1 0 01-1 1H6a1 1 0 01-1-1V3.8a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 2.8v4h4" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 12.5h8M8 16h8M8 9h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
  timeline: (s = 22) => svg(s, '<path d="M4 5v14M4 8h5M4 13h7M4 18h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="10.5" cy="8" r="1.5" fill="currentColor"/><circle cx="12.5" cy="13" r="1.5" fill="currentColor"/><circle cx="9.5" cy="18" r="1.5" fill="currentColor"/>'),
  book: (s = 22) => svg(s, '<path d="M4 4.5c2.4-1.2 5.4-1.2 8 0v15c-2.6-1.2-5.6-1.2-8 0v-15z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M20 4.5c-2.4-1.2-5.4-1.2-8 0v15c2.6-1.2 5.6-1.2 8 0v-15z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
  map: (s = 22) => svg(s, '<path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 4v14M15 6v14" stroke="currentColor" stroke-width="1.4"/>'),
  list: (s = 22) => svg(s, '<path d="M8 6h13M8 12h13M8 18h13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="3.5" cy="6" r="1.4" fill="currentColor"/><circle cx="3.5" cy="12" r="1.4" fill="currentColor"/><circle cx="3.5" cy="18" r="1.4" fill="currentColor"/>'),
  check: (s = 20) => svg(s, '<circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.6"/><path d="M8 12.3l2.6 2.6L16 9.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
  cross: (s = 20) => svg(s, '<circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.6"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  mail: (s = 22) => svg(s, '<rect x="2.5" y="5" width="19" height="14" rx="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
  shield: (s = 22) => svg(s, '<path d="M12 3l7 3v5.4c0 4.6-3 8.3-7 9.6-4-1.3-7-5-7-9.6V6l7-3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 12l2.2 2.2L15.4 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  perimeter: (s = 22) => svg(s, '<circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>'),
  spark: (s = 22) => svg(s, '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
};
