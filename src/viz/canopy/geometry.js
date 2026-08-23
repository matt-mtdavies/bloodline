/*
 * Canopy geometry shared by layout/camera and the Pixi renderer.
 *
 * Keep this module browser-agnostic: the motion planner is exercised in
 * headless Node CI and must not pull Pixi's browser adapter into that test.
 */

/** How far below a node its name block extends. */
export function labelDrop(band) {
  return band === 'hearth' ? 52 : band === 'kin' ? 34 : 30;
}
