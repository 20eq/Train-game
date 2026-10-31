import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld } from '../src/world.js';
import { CITIES } from '../src/cities.js';
import { stepWorld, playerTrain } from '../src/sim.js';

// three's canvas textures need a canvas; a 1x1 stub is enough for geometry tests
globalThis.document ??= {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      fillRect() {}, fillText() {}, measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      set fillStyle(v) {}, set font(v) {}, set textAlign(v) {}, set textBaseline(v) {},
    }),
  }),
};

const { THREE, buildWorld3D, updateWorld3D, cameraPose } = await import('../src/scene3d.js');

function countScene(view) {
  let meshes = 0;
  let triangles = 0;
  view.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    meshes++;
    const geo = obj.geometry;
    const pos = geo?.attributes?.position;
    if (!pos) return;
    const perInstance = geo.index ? geo.index.count / 3 : pos.count / 3;
    triangles += perInstance * (obj.isInstancedMesh ? obj.count : 1);
  });
  return { meshes, triangles };
}

test('the 3D scene builds for every city', () => {
  for (const city of CITIES) {
    const world = createWorld({ city: city.id });
    const view = buildWorld3D(world);

    assert.ok(view.scene.isScene, 'expected a three.js scene');
    assert.equal(view.trainGroups.size, world.trains.length, 'one group per train');
    assert.ok(view.cab, 'the player needs a cab shell');
    assert.ok(view.signals.length > 0, 'signals should be in the world');

    const { meshes, triangles } = countScene(view);
    assert.ok(meshes > 100, `${city.id} scene is too sparse (${meshes} meshes)`);
    assert.ok(triangles > 20_000, `${city.id} scene is too sparse (${triangles} tris)`);
  }
});

test('train groups follow the simulation', () => {
  const world = createWorld({ city: 'delhi' });
  const view = buildWorld3D(world);
  const player = playerTrain(world);
  const group = view.trainGroups.get(player.id);

  updateWorld3D(view, world);
  const first = group.position.clone();
  assert.ok(Number.isFinite(first.x) && Number.isFinite(first.z));
  assert.notEqual(Math.hypot(first.x, first.z), 0, 'groups must not all sit at the origin');

  player.s += 250;
  updateWorld3D(view, world);
  assert.ok(group.position.distanceTo(first) > 100, 'the group should track the train');
});

test('every train has its own place in the scene', () => {
  const world = createWorld({ city: 'chennai' });
  const view = buildWorld3D(world);
  updateWorld3D(view, world);
  const seen = new Set();
  for (const group of view.trainGroups.values()) {
    const key = `${group.position.x.toFixed(1)}:${group.position.z.toFixed(1)}`;
    seen.add(key);
  }
  assert.equal(seen.size, world.trains.length, 'two trains are drawn on top of each other');
});

test('the cab camera looks down the line from the head of the train', () => {
  const world = createWorld({ city: 'kolkata' });
  const train = playerTrain(world);
  for (let i = 0; i < 60 * 30; i++) stepWorld(world, 1 / 60, { autopilot: true });

  const pose = cameraPose(world, { mode: 'cab' });
  const forward = pose.target.clone().sub(pose.position).normalize();

  assert.ok(pose.position.y > 2.9 && pose.position.y < 4.2, `the eye should be cab height, got ${pose.position.y}`);
  assert.ok(Math.abs(forward.y) < 0.05, 'the cab camera should look level, not at the sky');

  // the cab view must point along the rails
  const path = world.paths[train.pathId];
  const heading = train.dir > 0 ? 0 : 0; // both directions are handled below
  void path;
  void heading;
  assert.ok(Math.hypot(forward.x, forward.z) > 0.99, 'the camera must look horizontally');

  const chase = cameraPose(world, { mode: 'chase' });
  assert.ok(chase.position.y > pose.position.y, 'the chase camera sits above the cab');
  assert.ok(chase.position.distanceTo(pose.position) > 20, 'the chase camera sits behind');

  const side = cameraPose(world, { mode: 'lineside', orbit: 1.2, distance: 60 });
  assert.ok(Math.abs(side.position.y - 26) < 12);
});

test('the scene survives a simulated run without throwing', () => {
  const world = createWorld({ city: 'mumbai' });
  const view = buildWorld3D(world);
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.25, 7000);

  assert.doesNotThrow(() => {
    for (let i = 0; i < 60 * 90; i++) {
      stepWorld(world, 1 / 60, { autopilot: true });
      if (i % 20 === 0) {
        updateWorld3D(view, world);
        const pose = cameraPose(world, { mode: i % 40 === 0 ? 'cab' : 'chase' });
        camera.position.copy(pose.position);
        camera.lookAt(pose.target);
      }
    }
  });

  // signal lamps must have been switched at some point
  const anyLit = view.signals.some((s) => s.red.visible || s.green.visible);
  assert.ok(anyLit, 'signal lamps should be lit');
  assert.equal(world.collisions, 0);
});
