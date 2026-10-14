import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Hard-surface part builders shared by both characters. */

export type V3 = readonly [number, number, number];

export function rbox(w: number, h: number, d: number, r = 0.06) {
  const rad = Math.min(r, Math.min(w, h, d) / 2 - 0.001);
  return new RoundedBoxGeometry(w, h, d, 2, Math.max(rad, 0.002));
}

export function box(w: number, h: number, d: number) {
  return new THREE.BoxGeometry(w, h, d);
}

/** XY polygon extruded along Z (centred), with a small bevel for specular edges. */
export function prism(pts: ReadonlyArray<readonly [number, number]>, depth: number, bevel = 0.03) {
  const shape = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth - bevel * 2, 0.001),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 4,
  });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return g;
}

/** Same as prism but extruded along X (profile drawn in ZY plane: [z, y]). */
export function prismX(pts: ReadonlyArray<readonly [number, number]>, width: number, bevel = 0.03) {
  const g = prism(pts, width, bevel);
  g.rotateY(-Math.PI / 2);
  return g;
}

export function cyl(rt: number, rb: number, h: number, seg = 20) {
  return new THREE.CylinderGeometry(rt, rb, h, seg);
}

/** Cylinder whose axis is X. */
export function cylX(r: number, h: number, seg = 20) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Cylinder whose axis is Z. */
export function cylZ(r: number, h: number, seg = 20, rb = r) {
  const g = new THREE.CylinderGeometry(r, rb, h, seg);
  g.rotateX(Math.PI / 2);
  return g;
}

export function sphere(r: number, ws = 18, hs = 12) {
  return new THREE.SphereGeometry(r, ws, hs);
}

/** Tyre: lathe profile with rounded shoulders, axis X. */
export function tire(radius: number, width: number) {
  const inner = radius * 0.64;
  const w = width / 2;
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(inner, -w * 0.92));
  pts.push(new THREE.Vector2(radius * 0.86, -w));
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - 0.06 + Math.cos(a) * 0.06, -w + 0.06 + Math.sin(a) * 0.06 + 0.0));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - 0.06 + Math.cos(a) * 0.06, w - 0.06 + Math.sin(a) * 0.06));
  }
  pts.push(new THREE.Vector2(radius * 0.86, w));
  pts.push(new THREE.Vector2(inner, w * 0.92));
  const g = new THREE.LatheGeometry(pts, 32);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Disc with a hole, axis X (ring face). */
export function ringX(r0: number, r1: number, seg = 32) {
  const g = new THREE.RingGeometry(r0, r1, seg);
  g.rotateY(Math.PI / 2);
  return g;
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, p?: V3, r?: V3, s?: V3 | number) {
  const m = new THREE.Mesh(geo, mat);
  if (p) m.position.set(p[0], p[1], p[2]);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  if (s !== undefined) {
    if (typeof s === 'number') m.scale.setScalar(s);
    else m.scale.set(s[0], s[1], s[2]);
  }
  m.userData.bake = true;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function add(parent: THREE.Object3D, ...children: THREE.Object3D[]) {
  for (const c of children) parent.add(c);
  return parent;
}

/** Mirror helper: returns [x, y, z] with x negated when side = -1. */
export const mx = (side: number, v: V3): V3 => [v[0] * side, v[1], v[2]];

/** Wheel assembly (tyre + chrome rim + hub + lug bolts), axis X. Returns a spinner group. */
export function wheel(radius: number, width: number, tireMat: THREE.Material, rimMat: THREE.Material, hubMat: THREE.Material, outward = 1) {
  const spinner = new THREE.Group();
  spinner.userData.keep = true;
  spinner.add(mesh(tire(radius, width), tireMat));
  const rimR = radius * 0.64;
  spinner.add(mesh(cylX(rimR, width * 0.86, 24), rimMat));
  spinner.add(mesh(cylX(rimR * 0.45, width * 0.95, 16), hubMat, [outward * 0.04, 0, 0]));
  spinner.add(mesh(cylX(rimR * 0.2, width * 1.08, 10), rimMat, [outward * 0.06, 0, 0]));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    spinner.add(
      mesh(cylX(0.035, width * 1.02, 6), rimMat, [outward * 0.03, Math.cos(a) * rimR * 0.68, Math.sin(a) * rimR * 0.68]),
    );
  }
  return spinner;
}

/** Row of vent slats on a face (normal +Z). */
export function vents(parent: THREE.Object3D, mat: THREE.Material, center: V3, w: number, h: number, n: number, rot?: V3) {
  const g = new THREE.Group();
  g.position.set(center[0], center[1], center[2]);
  if (rot) g.rotation.set(rot[0], rot[1], rot[2]);
  for (let i = 0; i < n; i++) {
    const y = -h / 2 + (h * (i + 0.5)) / n;
    g.add(mesh(box(w, (h / n) * 0.45, 0.05), mat, [0, y, 0], [-0.5, 0, 0]));
  }
  parent.add(g);
  return g;
}

/** Hydraulic piston between two points (sleeve + rod), in parent space. */
export function piston(parent: THREE.Object3D, a: V3, b: V3, sleeveMat: THREE.Material, rodMat: THREE.Material, r = 0.06) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  const g = new THREE.Group();
  g.position.copy(mid);
  g.quaternion.copy(q);
  g.add(mesh(cyl(r, r, len * 0.55, 10), sleeveMat, [0, -len * 0.2, 0]));
  g.add(mesh(cyl(r * 0.55, r * 0.55, len * 0.6, 8), rodMat, [0, len * 0.18, 0]));
  parent.add(g);
  return g;
}

function normalise(g: THREE.BufferGeometry, matrix: THREE.Matrix4) {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (!out.attributes.uv) {
    const n = out.attributes.position.count;
    out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  out.morphAttributes = {};
  out.clearGroups();
  out.applyMatrix4(matrix);
  return out;
}

/**
 * Merges static decorative meshes into one mesh per material for every container
 * (each articulated part, wheel spinner, etc.). Articulated pivots themselves are
 * untouched, so the transformation still moves every part independently — this
 * only cuts draw calls.
 */
export function bakeStatic(root: THREE.Object3D) {
  const containers: THREE.Object3D[] = [];
  root.traverse((o) => containers.push(o));
  const tmp = new THREE.Matrix4();
  for (const c of containers) {
    const candidates = c.children.filter((ch) => (ch as THREE.Mesh).isMesh && ch.userData.bake) as THREE.Mesh[];
    // Also absorb plain groups of bakeable meshes (vent rows, pistons) into the container.
    const groups = c.children.filter(
      (ch) =>
        !(ch as THREE.Mesh).isMesh &&
        !ch.userData.articulated &&
        !ch.userData.keep &&
        ch.children.length > 0 &&
        ch.children.every((g) => (g as THREE.Mesh).isMesh && g.userData.bake),
    );
    const items: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] = [];
    for (const m of candidates) {
      m.updateMatrix();
      items.push({ mesh: m, matrix: m.matrix.clone() });
    }
    for (const g of groups) {
      g.updateMatrix();
      for (const ch of g.children as THREE.Mesh[]) {
        ch.updateMatrix();
        items.push({ mesh: ch, matrix: tmp.multiplyMatrices(g.matrix, ch.matrix).clone() });
      }
    }
    if (items.length < 2) continue;
    const byMat = new Map<THREE.Material, { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[]>();
    for (const it of items) {
      const mat = it.mesh.material as THREE.Material;
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(it);
    }
    for (const [mat, list] of byMat) {
      const geos = list.map((it) => normalise(it.mesh.geometry, it.matrix));
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mm = new THREE.Mesh(merged, mat);
      mm.castShadow = list.some((it) => it.mesh.castShadow);
      mm.receiveShadow = true;
      mm.userData.baked = true;
      c.add(mm);
    }
    for (const it of items) {
      it.mesh.geometry.dispose();
      it.mesh.removeFromParent();
    }
    for (const g of groups) g.removeFromParent();
  }
}

/** Merge a list of (geometry, matrix) pairs into one geometry. Inputs are disposed. */
export function mergeTransformed(items: { geo: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]) {
  const geos = items.map((it) => normalise(it.geo, it.matrix));
  items.forEach((it) => it.geo.dispose());
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}
