import * as THREE from 'three';
import type { CharState } from './choreography';
import { easeInOutSine, noise1 } from './timeline';

/**
 * Camera direction as keyframed shots. Each key's position/target can be anchored to
 * the world, a fighter (world-aligned), a fighter's heading frame, or the midpoint —
 * so tracking shots follow the action while staying a pure function of progress.
 */
type Anchor = 'w' | 'o' | 'm' | 'c' | 'O' | 'M';
interface Shot {
  p: number;
  a: Anchor;
  pos: readonly [number, number, number];
  tgt: readonly [number, number, number];
  fov: number;
}

const SHOTS: Shot[] = [
  // I — Standoff: high wide establishing → low-angle two-shot.
  { p: 0.0, a: 'w', pos: [0, 11, 38], tgt: [0, 3.2, 0], fov: 36 },
  { p: 0.07, a: 'w', pos: [0, 4.5, 27], tgt: [0, 3.8, 0], fov: 38 },
  { p: 0.135, a: 'w', pos: [-2, 1.6, 19], tgt: [0, 4.4, 0], fov: 40 },
  // II — Transformations: orbit Optimus, two-shot of both mid-sequence, orbit Megatron.
  { p: 0.165, a: 'o', pos: [7, 3.6, 12.5], tgt: [0, 3.5, 0], fov: 40 },
  { p: 0.205, a: 'o', pos: [2.5, 2.6, 12.5], tgt: [0, 2.9, 0], fov: 40 },
  { p: 0.235, a: 'w', pos: [0, 5.0, 27], tgt: [0, 2.6, 0], fov: 42 },
  { p: 0.27, a: 'm', pos: [5, 3.4, 12.5], tgt: [0, 3.0, 0], fov: 40 },
  { p: 0.31, a: 'm', pos: [-2.5, 2.4, 12], tgt: [0, 2.0, 0], fov: 40 },
  { p: 0.345, a: 'c', pos: [0, 7.5, 27], tgt: [0, 1.4, 0], fov: 42 },
  // III — Vehicle combat: low chase, side pass, high reveal of the U-turns.
  { p: 0.375, a: 'O', pos: [-3.8, 2.2, -10], tgt: [0, 1.4, 6], fov: 46 },
  { p: 0.405, a: 'O', pos: [-7, 1.6, -5.5], tgt: [1, 1.3, 6], fov: 46 },
  { p: 0.43, a: 'c', pos: [0, 2.0, 11], tgt: [0, 1.2, 0], fov: 46 },
  { p: 0.462, a: 'c', pos: [0, 12, 15], tgt: [0, 0.5, -1], fov: 44 },
  { p: 0.495, a: 'c', pos: [0, 2.6, 16], tgt: [0, 1.5, 0], fov: 44 },
  // IV — Launch, mid-air transformation, landing and the exchange.
  { p: 0.54, a: 'c', pos: [-3, 2.0, 21], tgt: [0, 6.2, 0], fov: 44 },
  { p: 0.585, a: 'c', pos: [2, 1.8, 16], tgt: [0, 4.0, 0], fov: 42 },
  { p: 0.62, a: 'c', pos: [-4.5, 3.8, 11], tgt: [0, 4.6, 0], fov: 40 },
  { p: 0.665, a: 'c', pos: [5, 3.0, 11.5], tgt: [0, 4.3, 0], fov: 40 },
  { p: 0.71, a: 'c', pos: [-3, 5.0, 11], tgt: [0, 4.6, 0], fov: 40 },
  { p: 0.74, a: 'c', pos: [3.5, 1.4, 11], tgt: [0, 5.0, 0], fov: 40 },
  // V — Final clash: wide → low dolly in → orbit around the impact.
  { p: 0.785, a: 'w', pos: [0, 4.2, 22], tgt: [0, 4.0, 0], fov: 42 },
  { p: 0.822, a: 'w', pos: [-3.5, 2.2, 15], tgt: [0, 4.6, 0], fov: 42 },
  { p: 0.84, a: 'w', pos: [0.4, 3.4, 12.5], tgt: [0, 5.0, 0], fov: 42 },
  { p: 0.868, a: 'w', pos: [4.5, 4.6, 13.5], tgt: [0, 4.6, 0], fov: 42 },
  // VI — Final frame.
  { p: 0.92, a: 'w', pos: [0, 3.6, 21], tgt: [0, 4.2, 0], fov: 40 },
  { p: 1.0, a: 'w', pos: [0, 2.6, 24], tgt: [0, 4.4, 0], fov: 38 },
];

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _t0 = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _mid = new THREE.Vector3();

function resolve(shot: Shot, o: CharState, m: CharState, pos: THREE.Vector3, tgt: THREE.Vector3) {
  pos.set(shot.pos[0], shot.pos[1], shot.pos[2]);
  tgt.set(shot.tgt[0], shot.tgt[1], shot.tgt[2]);
  switch (shot.a) {
    case 'w':
      return;
    case 'o':
      pos.x += o.pos.x;
      pos.z += o.pos.z;
      tgt.x += o.pos.x;
      tgt.z += o.pos.z;
      return;
    case 'm':
      pos.x += m.pos.x;
      pos.z += m.pos.z;
      tgt.x += m.pos.x;
      tgt.z += m.pos.z;
      return;
    case 'c':
      _mid.addVectors(o.pos, m.pos).multiplyScalar(0.5);
      pos.x += _mid.x;
      pos.z += _mid.z;
      tgt.x += _mid.x;
      tgt.z += _mid.z;
      return;
    case 'O':
    case 'M': {
      const s = shot.a === 'O' ? o : m;
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      // Local (x right, z forward) → world, rotated by heading.
      const rot = (v: THREE.Vector3) => {
        const x = v.x * c + v.z * sn;
        const z = -v.x * sn + v.z * c;
        v.set(x + s.pos.x, v.y, z + s.pos.z);
      };
      rot(pos);
      rot(tgt);
    }
  }
}

export interface CamOut {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

export function evalCamera(p: number, o: CharState, m: CharState, out: CamOut) {
  let i = 0;
  while (i < SHOTS.length - 2 && p > SHOTS[i + 1].p) i++;
  const a = SHOTS[i];
  const b = SHOTS[i + 1];
  const k = easeInOutSine(Math.min(Math.max((p - a.p) / (b.p - a.p), 0), 1));
  resolve(a, o, m, _p0, _t0);
  resolve(b, o, m, _p1, _t1);
  out.pos.lerpVectors(_p0, _p1, k);
  out.target.lerpVectors(_t0, _t1, k);
  out.fov = a.fov + (b.fov - a.fov) * k;
  // Never dip under the ground.
  if (out.pos.y < 0.6) out.pos.y = 0.6;
  return out;
}

/** Deterministic shake offset from impact energy (progress-noise, plus subtle live jitter). */
export function shakeOffset(energy: number, p: number, time: number, out: THREE.Vector3) {
  const f = p * 4000;
  out.set(noise1(f) + noise1(time * 30) * 0.3, noise1(f + 31.7) + noise1(time * 30 + 9) * 0.3, noise1(f + 77.1) * 0.5);
  return out.multiplyScalar(energy * 0.22);
}
