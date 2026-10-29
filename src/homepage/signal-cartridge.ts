import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Original control-signal cartridge. All coordinates are baked into shared geometries. */
export interface SignalCartridgePart {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshPhysicalMaterial;
  /** The homepage array and extracted cartridge share these very same surfaces. */
  array: boolean;
  castShadow?: boolean;
}

// The reference asset was measured only for framing; none of its mesh data is reused.
// Positive Z is the readable front, Y is vertical, and the bottom remains on Y = 0.
export const SIGNAL_CARTRIDGE_BOUNDS = {
  min: [-2.5, 0, -0.13] as const,
  max: [2.51039, 3.7, 0.2464] as const,
};

/** Canvas origin is bottom-left in UV space. Use flipY=true for a normal CanvasTexture. */
export const SIGNAL_SCREEN = {
  minX: -2.035,
  maxX: 2.225,
  minY: 0.445,
  maxY: 2.825,
  width: 4.26,
  height: 2.38,
  frontZ: 0.233,
  radius: 0.055,
} as const;

export const SIGNAL_LABEL = {
  center: [-0.695, 3.182, 0.224] as const,
  width: 2.49,
  height: 0.43,
} as const;

type Point = readonly [number, number];

/** Rounded, chamfered industrial outlines; concave corners are rounded as well. */
function roundedPolygon(points: readonly Point[], radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const corners = points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 1) % points.length];
    const before = Math.hypot(previous[0] - point[0], previous[1] - point[1]);
    const after = Math.hypot(next[0] - point[0], next[1] - point[1]);
    const cut = Math.min(radius, before * 0.24, after * 0.24);
    return {
      point,
      enter: [point[0] + (previous[0] - point[0]) * cut / before, point[1] + (previous[1] - point[1]) * cut / before],
      exit: [point[0] + (next[0] - point[0]) * cut / after, point[1] + (next[1] - point[1]) * cut / after],
    };
  });
  shape.moveTo(corners[0].enter[0], corners[0].enter[1]);
  for (const corner of corners) {
    shape.lineTo(corner.enter[0], corner.enter[1]);
    shape.quadraticCurveTo(corner.point[0], corner.point[1], corner.exit[0], corner.exit[1]);
  }
  shape.closePath();
  return shape;
}

/** The latest sketch specifies a level, full-width edge below the header. */
export function createSignalScreenShape(expand = 0): THREE.Shape {
  const screen = SIGNAL_SCREEN;
  return roundedPolygon([
    [screen.minX - expand, screen.minY - expand],
    [screen.maxX + expand, screen.minY - expand],
    [screen.maxX + expand, screen.maxY + expand],
    [screen.minX - expand, screen.maxY + expand],
  ], Math.max(0.015, screen.radius + expand));
}

/**
 * A flat display overlay, ready for the real Fourier animation's CanvasTexture.
 * UVs span the entire rectangle, including its upper-right area.
 * A supplied z permits overlays without changing the shared cartridge geometry.
 */
export function createSignalScreenGeometry(z = SIGNAL_SCREEN.frontZ + 0.001): THREE.BufferGeometry {
  const geometry = new THREE.ShapeGeometry(createSignalScreenShape(), 5);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < position.count; i += 1) {
    uv.setXY(i,
      THREE.MathUtils.clamp((position.getX(i) - SIGNAL_SCREEN.minX) / SIGNAL_SCREEN.width, 0, 1),
      THREE.MathUtils.clamp((position.getY(i) - SIGNAL_SCREEN.minY) / SIGNAL_SCREEN.height, 0, 1),
    );
  }
  geometry.translate(0, 0, z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function extrude(shape: THREE.Shape, z: number, depth: number, bevel = 0.015): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 4,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, z);
  return geometry;
}

function block(width: number, height: number, depth: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(width, height, depth).translate(x, y, z);
}

function rectangle(x0: number, y0: number, x1: number, y1: number, radius = 0.025): THREE.Shape {
  return roundedPolygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], radius);
}

function batch(name: string, source: THREE.BufferGeometry[], parameters: THREE.MeshPhysicalMaterialParameters, castShadow = false): SignalCartridgePart {
  // BoxGeometry is indexed, ExtrudeGeometry is not; normalize before merging.
  const nonIndexed = source.map((geometry) => geometry.index ? geometry.toNonIndexed() : geometry);
  const geometry = mergeGeometries(nonIndexed, false);
  if (!geometry) throw new Error(`Could not construct signal cartridge surface: ${name}`);
  for (const item of new Set([...source, ...nonIndexed])) item.dispose();
  geometry.clearGroups();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshPhysicalMaterial({ ...parameters, name });
  return { name, geometry, material, array: true, castShadow };
}

/**
 * Six low-complexity material batches. Call once and reuse the geometries for
 * InstancedMesh arrays and direct-child meshes of the selected cartridge.
 * The shell is opaque; only the electronic display has a restrained clearcoat.
 */
export function createSignalCartridgeParts(): SignalCartridgePart[] {
  const outer = roundedPolygon([
    [-2.43, 0.08], [2.365, 0.08], [2.49539, 0.21],
    [2.49539, 3.22], [2.37, 3.345], [1.27, 3.345],
    [1.035, 3.56], [-2.31, 3.56], [-2.43, 3.44],
  ], 0.055);

  // The small upper-right tab belongs to every cartridge, including array instances.
  const grip = rectangle(1.63, 3.305, 2.235, 3.675, 0.035);
  const shell = batch("Signal_Shell", [
    extrude(outer, -0.115, 0.30),
    extrude(grip, -0.075, 0.245, 0.025),
  ], { color: 0xc9d3de, metalness: 0.38, roughness: 0.49 }, true);

  // A single original L rail rather than a full frame or decorative corner rings.
  const lRail = roundedPolygon([
    [-2.48, 0.22], [-2.28, 0.02], [2.35, 0.02], [2.445, 0.115],
    [2.35, 0.225], [-2.105, 0.225], [-2.235, 0.355],
    [-2.235, 3.525], [-2.345, 3.525], [-2.48, 3.39],
  ], 0.035);
  const trim = batch("Signal_Trim", [
    extrude(lRail, -0.11, 0.32, 0.02),
  ], { color: 0xacbbc9, metalness: 0.82, roughness: 0.28 }, true);

  // A real recessed bezel. Its hole leaves the whole rectangular screen unobstructed.
  const bezel = createSignalScreenShape(0.065);
  bezel.holes.push(new THREE.Path(createSignalScreenShape(0.006).getPoints(5).reverse()));
  const recessPieces: THREE.BufferGeometry[] = [extrude(bezel, 0.205, 0.025, 0.009)];
  for (let rib = 0; rib < 7; rib += 1) {
    recessPieces.push(block(0.021, 0.22, 0.006, 1.695 + rib * 0.078, 3.50, 0.199));
  }
  const recess = batch("Signal_Recess", recessPieces, {
    color: 0x33495e, metalness: 0.44, roughness: 0.4,
  }, true);

  // The display has no transmission, blur, or glass surface covering the shell.
  const screen = batch("Signal_Screen", [createSignalScreenGeometry(SIGNAL_SCREEN.frontZ)], {
    color: 0x091421, metalness: 0.12, roughness: 0.3,
    clearcoat: 0.22, clearcoatRoughness: 0.26,
  });

  const accent = batch("Signal_Accent", [
    extrude(rectangle(-1.875, 0.302, -1.57, 0.335, 0.012), 0.225, 0.0114, 0.01),
    // Small index stripe in the top-left header, separate from the large screen.
    extrude(rectangle(-2.04, 3.057, -2.005, 3.385, 0.01), 0.208, 0.015, 0.007),
  ], { color: 0x7198c3, metalness: 0.42, roughness: 0.35 });

  const marks: THREE.BufferGeometry[] = [];
  for (let slot = 0; slot < 3; slot += 1) {
    marks.push(extrude(rectangle(1.79 + slot * 0.108, 0.282, 1.821 + slot * 0.108, 0.368, 0.009), 0.208, 0.006, 0.003));
  }
  // A thin nameplate baseline is enough; typography itself is supplied by the caller.
  marks.push(block(2.40, 0.008, 0.004, -0.70, 2.931, 0.207));
  const marking = batch("Signal_Marks", marks, { color: 0x6c7f92, metalness: 0.3, roughness: 0.52 });

  return [shell, trim, recess, screen, accent, marking];
}
