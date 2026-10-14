import * as THREE from 'three';
import { MechPart, type PartSpec } from './MechPart';

/**
 * A transformable character: a root group plus an indexed set of articulated parts.
 * `setTransform(t)` is a pure function of t, so scrolling backwards reverses exactly.
 */
export class Transformer {
  readonly root = new THREE.Group();
  readonly parts: MechPart[] = [];
  private readonly byName = new Map<string, MechPart>();
  /** Wheel spinner groups (rotate about local X by distance travelled). */
  readonly spinners: { node: THREE.Object3D; radius: number; sign: number }[] = [];
  /** Named non-articulated markers (muzzles, eyes, exhaust points). */
  readonly markers = new Map<string, THREE.Object3D>();
  t = 0;

  part(parent: THREE.Object3D, spec: PartSpec) {
    const p = new MechPart(spec);
    parent.add(p);
    this.parts.push(p);
    this.byName.set(spec.name, p);
    return p;
  }

  get(name: string) {
    const p = this.byName.get(name);
    if (!p) throw new Error(`Unknown part ${name}`);
    return p;
  }

  marker(parent: THREE.Object3D, name: string, pos: readonly [number, number, number]) {
    const m = new THREE.Object3D();
    m.name = name;
    m.position.set(pos[0], pos[1], pos[2]);
    m.userData.keep = true;
    parent.add(m);
    this.markers.set(name, m);
    return m;
  }

  setTransform(t: number) {
    this.t = t;
    for (const p of this.parts) p.applyT(t);
  }

  spinWheels(distance: number) {
    for (const s of this.spinners) s.node.rotation.x = (s.sign * distance) / s.radius;
  }
}
