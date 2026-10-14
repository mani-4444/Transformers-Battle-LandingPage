import * as THREE from 'three';
import { clamp, easeInOutCubic, type Ease } from '../timeline';

export interface PoseSpec {
  p?: readonly [number, number, number];
  r?: readonly [number, number, number];
  s?: number | readonly [number, number, number];
}

export interface PartSpec {
  name: string;
  robot: PoseSpec;
  /** Pose in vehicle mode; defaults to the robot pose (part only rides along). */
  vehicle?: PoseSpec;
  /** Slice of the global transform progress during which this part moves. */
  window?: readonly [number, number];
  /** Positional detour at the middle of the move (panels lift/swing clear before seating). */
  via?: readonly [number, number, number];
  /** Rotational detour at the middle of the move (Euler, radians). */
  viaRot?: readonly [number, number, number];
  ease?: Ease;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _identity = new THREE.Quaternion();

function toPose(spec: PoseSpec, p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3) {
  if (spec.p) p.set(spec.p[0], spec.p[1], spec.p[2]);
  if (spec.r) q.setFromEuler(_e.set(spec.r[0], spec.r[1], spec.r[2]));
  if (spec.s !== undefined) {
    if (typeof spec.s === 'number') s.setScalar(spec.s);
    else s.set(spec.s[0], spec.s[1], spec.s[2]);
  }
}

/**
 * An articulated pivot. It owns two local poses (robot / vehicle) and blends between
 * them inside its own window of the transformation, so a whole character transforms
 * as a staged, interlocking mechanical sequence rather than a single morph.
 */
export class MechPart extends THREE.Group {
  readonly robotPos = new THREE.Vector3();
  readonly robotQuat = new THREE.Quaternion();
  readonly robotScale = new THREE.Vector3(1, 1, 1);
  readonly vehPos = new THREE.Vector3();
  readonly vehQuat = new THREE.Quaternion();
  readonly vehScale = new THREE.Vector3(1, 1, 1);
  readonly via: THREE.Vector3 | null;
  readonly viaQuat: THREE.Quaternion | null;
  start: number;
  end: number;
  ease: Ease;
  /** Current local progress of this part (0 robot … 1 vehicle). */
  k = 0;

  constructor(spec: PartSpec) {
    super();
    this.name = spec.name;
    this.userData.articulated = true;
    toPose(spec.robot, this.robotPos, this.robotQuat, this.robotScale);
    this.vehPos.copy(this.robotPos);
    this.vehQuat.copy(this.robotQuat);
    this.vehScale.copy(this.robotScale);
    if (spec.vehicle) toPose(spec.vehicle, this.vehPos, this.vehQuat, this.vehScale);
    this.via = spec.via ? new THREE.Vector3(...spec.via) : null;
    this.viaQuat = spec.viaRot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...spec.viaRot)) : null;
    this.start = spec.window?.[0] ?? 0;
    this.end = spec.window?.[1] ?? 1;
    this.ease = spec.ease ?? easeInOutCubic;
    this.applyT(0);
  }

  applyT(t: number) {
    const raw = clamp((t - this.start) / (this.end - this.start || 1));
    const k = this.ease(raw);
    this.k = raw;
    this.position.lerpVectors(this.robotPos, this.vehPos, k);
    this.quaternion.slerpQuaternions(this.robotQuat, this.vehQuat, k);
    this.scale.lerpVectors(this.robotScale, this.vehScale, k);
    if (this.via || this.viaQuat) {
      const arc = Math.sin(Math.PI * raw);
      if (this.via) this.position.addScaledVector(this.via, arc);
      if (this.viaQuat) {
        _q.slerpQuaternions(_identity, this.viaQuat, arc);
        this.quaternion.multiply(_q);
      }
    }
  }

  /** Additive local rotation layered on top of the transform pose (attacks, gait, idle). */
  addRotation(x: number, y: number, z: number, weight = 1) {
    if (weight === 0 || (x === 0 && y === 0 && z === 0)) return;
    _q.setFromEuler(_e.set(x * weight, y * weight, z * weight));
    this.quaternion.multiply(_q);
  }

  addOffset(x: number, y: number, z: number, weight = 1) {
    this.position.x += x * weight;
    this.position.y += y * weight;
    this.position.z += z * weight;
  }
}
