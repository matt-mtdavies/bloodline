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
