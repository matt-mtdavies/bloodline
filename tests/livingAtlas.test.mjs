import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { buildGraph } from '../src/data/graph.js';
import { FIXTURES } from '../src/viz/v2/fixtures.js';
import {
  MAX_FOCUS_DESKTOP,
  MAX_FOCUS_MOBILE,
  collectFocusIds,
  createAtlasModel,
  createAtlasPositions,
  createFocusLayout,
} from '../src/viz/atlas/model.js';

const desktop = { width: 1200, height: 760 };
const mobile = { width: 390, height: 718 };

{
  const prototypeSource = readFileSync(new URL('../src/viz/atlas/LivingAtlasLab.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(prototypeSource, /\bfetch\s*\(/, 'prototype contains no network request');
  assert.doesNotMatch(prototypeSource, /\/api\//, 'prototype contains no production API path');
  assert.doesNotMatch(prototypeSource, /data\/store/, 'prototype never imports the production store');
  assert.doesNotMatch(prototypeSource, /realFamily/, 'prototype cannot load a session family');
  assert.doesNotMatch(prototypeSource, /className="atlas-context"/, 'each atlas person is rendered once, not duplicated as a second context circle');
}

function relationIds(entries) {
  return entries.map((entry) => entry.id);
}

for (const fixture of FIXTURES) {
  const graph = buildGraph(fixture.people, fixture.relationships);
  for (const viewport of [desktop, mobile]) {
    const model = createAtlasModel(graph, fixture.focus, viewport);
    const cap = viewport.width < 620 ? MAX_FOCUS_MOBILE : MAX_FOCUS_DESKTOP;
    assert.ok(model.focusIds.size <= cap, `${fixture.id}: focus respects viewport budget`);
    assert.ok(model.focusIds.has(fixture.focus), `${fixture.id}: active person is focused`);
    assert.equal(model.focusPositions.get(fixture.focus).x, viewport.width / 2, `${fixture.id}: active centred horizontally`);

    for (const id of model.focusIds) {
      const point = model.focusPositions.get(id);
      assert.ok(point, `${fixture.id}: every focused person has a stage position`);
      assert.ok(point.x >= 0 && point.x <= viewport.width, `${fixture.id}: ${id} stays within viewport width`);
      assert.ok(point.y >= 0 && point.y <= viewport.height, `${fixture.id}: ${id} stays within viewport height`);
    }

    const activePoint = model.focusPositions.get(fixture.focus);
    for (const id of relationIds(graph.parents(fixture.focus))) {
      if (model.focusPositions.has(id)) assert.ok(model.focusPositions.get(id).y < activePoint.y, `${fixture.id}: parent above active`);
    }
    for (const id of relationIds(graph.children(fixture.focus))) {
      if (model.focusPositions.has(id)) assert.ok(model.focusPositions.get(id).y > activePoint.y, `${fixture.id}: child below active`);
    }
    for (const id of relationIds(graph.partners(fixture.focus))) {
      if (model.focusPositions.has(id)) assert.equal(model.focusPositions.get(id).y, activePoint.y, `${fixture.id}: partner shares active row`);
    }
  }
}

{
  const fixture = FIXTURES.find((entry) => entry.id === 'seed-family');
  const graph = buildGraph(fixture.people, fixture.relationships);
  const model = createAtlasModel(graph, fixture.focus, mobile);
  const grandparents = graph.parents(fixture.focus).flatMap((parent) => graph.parents(parent.id).map((entry) => entry.id));
  assert.ok(grandparents.every((id) => !model.focusIds.has(id)), 'mobile stage leaves grandparents in the atlas');
  assert.ok(model.focusIds.size <= MAX_FOCUS_MOBILE, 'mobile seed portrait stays intentionally sparse');
}

{
  const people = [
    'focus', 'parent-a', 'parent-b', 'partner-current', 'partner-former-a', 'partner-former-b',
    'child-a', 'child-b', 'child-c', 'child-d', 'sibling-a', 'sibling-b',
  ].map((id) => ({ id, display_name: id.replaceAll('-', ' ') }));
  const relationships = [
    { type: 'parent', from_person: 'parent-a', to_person: 'focus' },
    { type: 'parent', from_person: 'parent-b', to_person: 'focus' },
    { type: 'parent', from_person: 'parent-a', to_person: 'sibling-a' },
    { type: 'parent', from_person: 'parent-a', to_person: 'sibling-b' },
    { type: 'partner', from_person: 'focus', to_person: 'partner-current', partner_status: 'current' },
    { type: 'partner', from_person: 'focus', to_person: 'partner-former-a', partner_status: 'former' },
    { type: 'partner', from_person: 'focus', to_person: 'partner-former-b', partner_status: 'former' },
    ...['child-a', 'child-b', 'child-c', 'child-d'].map((id) => ({ type: 'parent', from_person: 'focus', to_person: id })),
  ];
  const graph = buildGraph(people, relationships);
  const ids = collectFocusIds(graph, 'focus', MAX_FOCUS_MOBILE, { mobile: true });
  assert.equal(ids.size, 8, 'busy mobile family uses the eight-position spatial budget');
  assert.ok(ids.has('partner-current'), 'current partner wins a mobile partner position');
  assert.equal(graph.partners('focus').filter((entry) => ids.has(entry.id)).length, 2, 'mobile stages no more than two partners');
  assert.equal(graph.children('focus').filter((entry) => ids.has(entry.id)).length, 3, 'mobile stages no more than three children');
  assert.equal(graph.siblings('focus').filter((entry) => ids.has(entry.id)).length, 0, 'siblings yield when core family rows are full');
}

{
  const fixture = FIXTURES.find((entry) => entry.id === 'remarried');
  const graph = buildGraph(fixture.people, fixture.relationships);
  const atlasA = createAtlasPositions(graph, desktop);
  const idsA = collectFocusIds(graph, 'r_heather', MAX_FOCUS_DESKTOP);
  const idsB = collectFocusIds(graph, 'r_matthew', MAX_FOCUS_DESKTOP);
  createFocusLayout(graph, 'r_heather', idsA, desktop);
  createFocusLayout(graph, 'r_matthew', idsB, desktop);
  const atlasB = createAtlasPositions(graph, desktop);
  assert.deepEqual([...atlasA.positions], [...atlasB.positions], 'atlas coordinates never depend on selection');
}

{
  const people = Array.from({ length: 5000 }, (_, index) => ({
    id: `scale-${index}`,
    display_name: `Person ${index} Branch ${index % 80}`,
    family_name: `Branch ${index % 80}`,
    birth_date: `${1800 + (index % 220)}`,
  }));
  const relationships = [];
  for (let index = 1; index < people.length; index++) {
    if (index % 5 !== 0) relationships.push({ type: 'parent', from_person: `scale-${Math.max(0, index - 1)}`, to_person: `scale-${index}`, qualifier: 'biological' });
  }
  const graph = buildGraph(people, relationships);
  const start = performance.now();
  const model = createAtlasModel(graph, 'scale-2500', desktop);
  const elapsed = performance.now() - start;
  assert.equal(model.positions.size, 5000, '5,000-person atlas retains one stable coordinate per person');
  assert.ok(model.focusIds.size <= MAX_FOCUS_DESKTOP, '5,000-person stage remains bounded');
  assert.ok(elapsed < 1500, `5,000-person model plans in a prototype-safe budget (${elapsed.toFixed(1)}ms)`);
}

console.log(`livingAtlas: ${FIXTURES.length} fixtures × desktop/mobile + stable atlas + 5,000-person scale passed`);
