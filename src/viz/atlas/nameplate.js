/*
 * The lens's own name label.
 *
 * Canopy's own node carries a plain, stacked, Georgia-serif label — right
 * for a diagram, but the family gathered into the lens is meant to read as
 * a group of PEOPLE, and a real user comparison (a screenshot of a tight
 * parent/step-parent row, three full names printing on top of each other)
 * pointed at the organic tree's own compact pill instead: a bold first name
 * and a lighter surname on one line, in a small rounded card. Ported here
 * deliberately rather than imported from bubble.js — this is an Atlas-only
 * visual choice, and importing would risk a future organic-tree edit
 * silently changing how the lens looks, or vice versa.
 *
 * Two independent pieces, in two different files on purpose:
 *   - buildNamePill(person), here — the actual Pixi visual (impure: makes
 *     a Container). Called once per lens member when the lens is built.
 *   - packRow / layoutLabels, in ./nameplateGeometry.js — pure geometry,
 *     numbers in, numbers out, so the packing itself can be asserted
 *     without a renderer. Kept in a pixi-free module deliberately: pixi.js
 *     touches the global `navigator` object the moment it's imported (its
 *     own browser-environment detection), which is fine in a real browser
 *     but throws in the plain Node this repo's tests run under — so the
 *     geometry that tests/atlasNameplate.test.mjs actually exercises must
 *     never sit in a module that also imports pixi.js, or importing it
 *     for its pure functions alone would crash before a test even runs.
 *     Re-exported below so every existing caller of this file keeps working
 *     unchanged.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { surnameOf, lifespanOf, packRow, layoutLabels } from './nameplateGeometry.js';

export { packRow, layoutLabels };

const TREE_FONT = 'Hanken Grotesk, system-ui, sans-serif';
const GAP = 5;
const PILL_H = 20;

/** The actual pill: a rounded white card, a bold dark first name, and — when
 *  it says something the first name doesn't — a lighter, smaller surname
 *  beside it. Returns the Pixi Container plus the half-width the collision
 *  pass needs, measured from the real, just-built Text objects rather than
 *  an estimate: this runs once per lens member, not once per frame, so
 *  exact metrics cost nothing here the way they would in a hot loop.
 *
 *  `withDates` adds the person's years as a caption beneath the card — the
 *  focus of a portrait gets one. It lives INSIDE this container on purpose:
 *  it was previously Canopy's own serif `sub`, left behind when the pill
 *  replaced the label above it, so the most important person in the frame
 *  carried two different typefaces stacked on each other, one of them
 *  carded and one floating. Built here, it shares the pill's typeface and
 *  its lighter ink, and it follows the pill wherever collision packing
 *  moves it. */
export function buildNamePill(person, { withDates = false } = {}) {
  const firstName = (person?.display_name || 'Unknown').trim().split(/\s+/)[0] || 'Unknown';
  const lastName = surnameOf(person);
  const showLast = !!lastName && lastName !== firstName;

  const firstText = new Text({
    text: firstName,
    style: { fontFamily: TREE_FONT, fontSize: 13, fontWeight: '700', fill: '#241f1c', letterSpacing: 0.3 },
  });
  firstText.resolution = 2.5;
  firstText.anchor.set(0, 0.5);

  let lastText = null;
  let contentW = firstText.width;
  if (showLast) {
    lastText = new Text({
      text: lastName,
      style: { fontFamily: TREE_FONT, fontSize: 11, fontWeight: '500', fill: '#a4988b', letterSpacing: 0.2 },
    });
    lastText.resolution = 2.5;
    lastText.anchor.set(0, 0.5);
    contentW += GAP + lastText.width;
  }

  const pillW = Math.max(40, contentW + 20);
  const r = PILL_H / 2;

  const bg = new Graphics();
  bg.roundRect(-pillW / 2 + 0.5, -PILL_H / 2 + 2, pillW, PILL_H, r).fill({ color: 0x000000, alpha: 0.07 });
  bg.roundRect(-pillW / 2, -PILL_H / 2, pillW, PILL_H, r).fill({ color: 0xffffff, alpha: 0.97 });
  bg.roundRect(-pillW / 2, -PILL_H / 2, pillW, PILL_H, r).stroke({ width: 0.8, color: 0xddd8d2, alpha: 0.8 });

  const startX = -contentW / 2;
  firstText.position.set(startX, 0);

  const container = new Container();
  container.eventMode = 'none'; // a label is decoration, not a second hit target for the person beneath it
  container.addChild(bg, firstText);
  if (lastText) { lastText.position.set(startX + firstText.width + GAP, 0); container.addChild(lastText); }

  const dates = withDates ? lifespanOf(person) : '';
  if (dates) {
    const sub = new Text({
      text: dates,
      style: { fontFamily: TREE_FONT, fontSize: 11, fontWeight: '500', fill: '#a4988b', letterSpacing: 0.4 },
    });
    sub.resolution = 2.5;
    sub.anchor.set(0.5, 0);
    sub.position.set(0, PILL_H / 2 + 5);
    container.addChild(sub);
  }

  return { container, halfWidth: pillW / 2 };
}
