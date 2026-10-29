import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createSignalCartridgeParts,
  createSignalScreenGeometry,
  SIGNAL_LABEL,
} from "../src/homepage/signal-cartridge.ts";

// The former archive's measured envelope is a framing contract, independent of
// the replacement model's own constants. Changing it would shift the existing
// homepage array, selection camera and extraction animation.
const FRAMING_MIN = [-2.5, 0, -0.13];
const FRAMING_MAX = [2.51039, 3.7, 0.2464];
const EPSILON = 1e-5;

function cartridge(t) {
  const parts = createSignalCartridgeParts();
  t.after(() => {
    for (const part of parts) {
      part.geometry.dispose();
      part.material.dispose();
    }
  });
  return parts;
}

function combinedBounds(parts) {
  const box = new THREE.Box3();
  for (const { geometry } of parts) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
  }
  return box;
}

function display(t) {
  const geometry = createSignalScreenGeometry();
  const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  geometry.computeBoundingBox();
  t.after(() => { geometry.dispose(); material.dispose(); });
  return { geometry, mesh, box: geometry.boundingBox };
}

function triangleAreaXY(geometry) {
  const positions = geometry.getAttribute("position");
  const vertex = (i) => geometry.index ? geometry.index.getX(i) : i;
  const count = geometry.index?.count ?? positions.count;
  let area = 0;
  for (let i = 0; i < count; i += 3) {
    const a = vertex(i), b = vertex(i + 1), c = vertex(i + 2);
    area += Math.abs(
      (positions.getX(b) - positions.getX(a)) * (positions.getY(c) - positions.getY(a))
      - (positions.getY(b) - positions.getY(a)) * (positions.getX(c) - positions.getX(a)),
    ) / 2;
  }
  return area;
}

test("replacement fits the existing homepage and detail framing envelope", (t) => {
  const box = combinedBounds(cartridge(t));
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(box.min.getComponent(axis) - FRAMING_MIN[axis]) < EPSILON,
      `minimum on axis ${axis} moved outside the framing contract`);
    assert.ok(Math.abs(box.max.getComponent(axis) - FRAMING_MAX[axis]) < EPSILON,
      `maximum on axis ${axis} moved outside the framing contract`);
  }
});

test("all six original surfaces are available to both array and detail without loading assets", (t) => {
  const originalFileLoad = THREE.FileLoader.prototype.load;
  const originalImageLoad = THREE.ImageLoader.prototype.load;
  const originalFetch = globalThis.fetch;
  const forbidAssetLoad = () => { throw new Error("Signal geometry must not load an upstream mesh or texture"); };
  try {
    THREE.FileLoader.prototype.load = forbidAssetLoad;
    THREE.ImageLoader.prototype.load = forbidAssetLoad;
    globalThis.fetch = forbidAssetLoad;
    const parts = cartridge(t);
    assert.equal(parts.length, 6, "the shared six-surface model must not omit the array's trim or tab");
    assert.equal(new Set(parts.map((part) => part.name)).size, parts.length);
    assert.ok(parts.every((part) => part.array === true), "detail-only surfaces cause mismatched models");
    assert.ok(parts.some((part) => part.castShadow), "array shadows require an opaque casting surface");
    for (const part of parts) {
      assert.ok(part.geometry.isBufferGeometry);
      assert.ok(part.material.isMeshPhysicalMaterial);
      assert.ok(part.geometry.getAttribute("position").count > 0);
      assert.equal(part.material.transmission, 0, "a full-face glass cover must not return");
    }
  } finally {
    THREE.FileLoader.prototype.load = originalFileLoad;
    THREE.ImageLoader.prototype.load = originalImageLoad;
    globalThis.fetch = originalFetch;
  }
});

test("shared geometry contains finite renderable data and stays within an instancing budget", (t) => {
  let triangles = 0;
  for (const part of cartridge(t)) {
    const geometry = part.geometry;
    const positions = geometry.getAttribute("position");
    assert.ok(geometry.getAttribute("normal"), `${part.name} needs surface normals`);
    assert.ok(geometry.getAttribute("uv"), `${part.name} needs usable UV data`);
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      assert.equal(attribute.count, positions.count, `${part.name}/${name} has mismatched vertex counts`);
      assert.ok(attribute.array.every(Number.isFinite), `${part.name}/${name} contains NaN or Infinity`);
    }
    triangles += (geometry.index?.count ?? positions.count) / 3;
  }
  // Hundreds of cartridges may be instanced. Keep a generous regression ceiling,
  // rather than locking tests to the current bevel tessellation or vertex order.
  assert.ok(triangles < 10_000, `one cartridge grew to ${triangles} triangles`);
});

test("screen faces the viewer and its entire UV range can display the Fourier canvas", (t) => {
  const { geometry, mesh, box } = display(t);
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const uvMin = [Infinity, Infinity], uvMax = [-Infinity, -Infinity];
  for (let i = 0; i < position.count; i += 1) {
    assert.ok(normal.getZ(i) > 0.99, "display must face positive Z");
    assert.ok(Math.abs(position.getZ(i) - box.min.z) < EPSILON, "display overlay must be planar");
    for (let component = 0; component < 2; component += 1) {
      const value = component ? uv.getY(i) : uv.getX(i);
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
      uvMin[component] = Math.min(uvMin[component], value);
      uvMax[component] = Math.max(uvMax[component], value);
    }
  }
  assert.deepEqual(uvMin, [0, 0]);
  assert.deepEqual(uvMax, [1, 1]);
  const center = box.getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster(new THREE.Vector3(center.x, center.y, box.max.z + 1), new THREE.Vector3(0, 0, -1));
  assert.ok(ray.intersectObject(mesh).length > 0, "front-facing triangles must actually cover the screen centre");
});

test("large display has a continuous level top edge beneath the header", (t) => {
  const { mesh, box } = display(t);
  const ray = new THREE.Raycaster();
  const hit = (x, y) => {
    ray.set(new THREE.Vector3(x, y, box.max.z + 1), new THREE.Vector3(0, 0, -1));
    return ray.intersectObject(mesh).length > 0;
  };
  // Exclude rounded corner tips; these rays catch a stepped cutout or a restored
  // upper-right screen extension even if the exported size constants change too.
  for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const x = THREE.MathUtils.lerp(box.min.x, box.max.x, fraction);
    assert.ok(hit(x, box.max.y - 0.015), `top edge is interrupted at ${fraction * 100}% width`);
    assert.equal(hit(x, box.max.y + 0.015), false, "display crosses its horizontal header boundary");
  }
  assert.ok(SIGNAL_LABEL.center[1] - SIGNAL_LABEL.height / 2 > box.max.y,
    "the top information label must remain outside the electronic screen");
});

test("screen occupies at least half the frontal envelope and shares the base display footprint", (t) => {
  const parts = cartridge(t);
  const outer = combinedBounds(parts);
  const { geometry, box } = display(t);
  const faceArea = (outer.max.x - outer.min.x) * (outer.max.y - outer.min.y);
  assert.ok(triangleAreaXY(geometry) >= faceArea / 2, "the user's enlarged display shrank below half of the front");
  const base = parts.find((part) => part.name === "Signal_Screen");
  assert.ok(base, "the array requires the same display surface as the detail model");
  base.geometry.computeBoundingBox();
  const baseBox = base.geometry.boundingBox;
  for (const axis of ["x", "y"]) {
    assert.ok(Math.abs(baseBox.min[axis] - box.min[axis]) < EPSILON);
    assert.ok(Math.abs(baseBox.max[axis] - box.max[axis]) < EPSILON);
  }
  assert.ok(box.min.z > baseBox.max.z && box.min.z - baseBox.max.z < 0.01,
    "animated canvas needs a small positive depth offset to avoid z-fighting");
});
