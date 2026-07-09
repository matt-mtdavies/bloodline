/*
 * Shared card metrics for the pedigree chart — the layout engine
 * (pedigreeLayout.js) computes card heights from these, and ChartTree's CSS
 * must render rows/strips at exactly these pixel sizes or connectors drift
 * off card edges. One source of truth, imported by both.
 */
export const CARD_W = 236;
export const ROW_H = 48;       // one person row (avatar + name + dates)
export const MARRIAGE_H = 22;  // the marriage strip between a couple's rows
export const FOOTER_H = 27;    // the "N children" footer
export const CHILD_W = 200;    // drawn child cards are slimmer than unions

/* ── Direction B — horizontal-couple portrait layout ──────────────────────
 * In portrait, a couple is two flat plates side by side (not stacked rows),
 * joined by a partner-link across a small gap. Ancestry rises from each
 * plate's top; children descend from the union's centre. These drive the
 * layout engine's card dimensions and MUST match the rendered plate size in
 * ChartTree's CSS or connectors drift off the ports. */
export const PLATE_W = 182;    // one person plate (avatar + name + dates)
export const PLATE_H = 60;     // a plate is one row tall
export const LINK_GAP = 18;    // gap between a couple's two plates (the link)
export const UNION_W = PLATE_W * 2 + LINK_GAP; // a full couple card
export const CHILD_PW = 182;   // portrait child plate width
