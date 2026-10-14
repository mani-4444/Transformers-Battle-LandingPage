import * as THREE from 'three';
import { CLASH_P, clamp, easeInOutCubic, easeInOutSine, easeOutCubic, lerp, pulse, remap, track } from './timeline';

/**
 * Combat choreography. Everything here is a pure function of (action) progress, so
 * any scroll position — forwards, backwards or jumped to — yields the same frame.
 */

export interface CharState {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  /** Transformation: 0 robot … 1 vehicle. */
  t: number;
  /** Distance travelled (drives wheels / treads / gait). */
  dist: number;
  guard: number;
  punch: number;
  uppercut: number;
  block: number;
  aim: number;
  swing: number;
  recoil: number;
  crouch: number;
  run: number;
  runPhase: number;
  /** Weapon / engine charge for emissives. */
  charge: number;
}

export function makeState(): CharState {
  return {
    pos: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    t: 0,
    dist: 0,
    guard: 0,
    punch: 0,
    uppercut: 0,
    block: 0,
    aim: 0,
    swing: 0,
    recoil: 0,
    crouch: 0,
    run: 0,
    runPhase: 0,
    charge: 0,
  };
}

const V = (x: number, z: number) => new THREE.Vector3(x, 0, z);

// Vehicle-combat routes: a near-miss pass, a hard U-turn each, then a converging charge.
const OPT_ROUTE = new THREE.CatmullRomCurve3(
  [V(-11, 0), V(-5, 1.7), V(1, 2.5), V(7, 1.4), V(10.6, -2.4), V(8.2, -5.6), V(4.6, -4.4), V(2.9, -2.0)],
  false,
  'centripetal',
);
const MEG_ROUTE = new THREE.CatmullRomCurve3(
  OPT_ROUTE.points.map((p) => V(-p.x, -p.z)),
  false,
  'centripetal',
);
const OPT_LEN = OPT_ROUTE.getLength();
const MEG_LEN = MEG_ROUTE.getLength();

export const DRIVE = [0.35, 0.5] as const;
export const JUMP = [0.5, 0.585] as const;
const LAND_X = 2.9;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function routeAt(route: THREE.CatmullRomCurve3, u: number, out: THREE.Vector3) {
  return route.getPointAt(clamp(u), out);
}

function routeYaw(route: THREE.CatmullRomCurve3, u: number) {
  const u0 = clamp(u - 0.004);
  const u1 = clamp(u0 + 0.008);
  route.getPointAt(u0, _a);
  route.getPointAt(u1, _b);
  return Math.atan2(_b.x - _a.x, _b.z - _a.z);
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const driveU = (p: number) => Math.pow(remap(p, DRIVE[0], DRIVE[1]), 1.6);

/** X position (along the duel line) for each fighter once back in robot form. */
const OPT_X: ReadonlyArray<readonly [number, number]> = [
  [JUMP[1], LAND_X],
  [0.602, LAND_X],
  [0.617, 2.0],
  [0.64, 2.6],
  [0.664, 2.6],
  [0.68, 3.6],
  [0.7, 3.2],
  [0.712, 3.5],
  [0.727, 2.3],
  [0.745, 2.7],
  [0.778, 6.6],
  [0.792, 6.6],
  [0.838, 1.32],
  [0.842, 1.32],
  [0.885, 7.0],
];
const MEG_X: ReadonlyArray<readonly [number, number]> = [
  [JUMP[1], -LAND_X],
  [0.616, -LAND_X],
  [0.626, -3.6],
  [0.648, -3.1],
  [0.69, -3.1],
  [0.711, -2.2],
  [0.73, -2.5],
  [0.737, -3.5],
  [0.755, -3.3],
  [0.778, -6.6],
  [0.792, -6.6],
  [0.838, -1.32],
  [0.842, -1.32],
  [0.885, -7.0],
];

function duelX(keys: ReadonlyArray<readonly [number, number]>, p: number) {
  return track(keys, p, easeInOutCubic);
}

/** Integrated travel along the duel line, for gait phase (monotonic, deterministic). */
function gaitDistance(keys: ReadonlyArray<readonly [number, number]>, p: number) {
  let d = 0;
  let prev = keys[0][1];
  const steps = 48;
  const p0 = keys[0][0];
  if (p <= p0) return 0;
  for (let i = 1; i <= steps; i++) {
    const x = duelX(keys, p0 + ((p - p0) * i) / steps);
    d += Math.abs(x - prev);
    prev = x;
  }
  return d;
}

function vehicleSegment(route: THREE.CatmullRomCurve3, len: number, start: THREE.Vector3, startYaw: number, landX: number, p: number, s: CharState) {
  if (p < DRIVE[0]) {
    s.pos.copy(start);
    s.yaw = startYaw;
    s.dist = 0;
    return;
  }
  if (p < DRIVE[1]) {
    const u = driveU(p);
    routeAt(route, u, s.pos);
    s.yaw = routeYaw(route, u);
    s.dist = u * len;
    // Bumpy terrain rumble.
    s.pos.y += Math.abs(Math.sin(s.dist * 3.1)) * 0.04;
    return;
  }
  // Launch → mid-air transformation → landing.
  const j = remap(p, JUMP[0], JUMP[1]);
  routeAt(route, 1, _a);
  const endYaw = routeYaw(route, 0.999);
  s.pos.set(lerp(_a.x, landX, easeOutCubic(j)), 4.4 * 4 * j * (1 - j), lerp(_a.z, 0, easeOutCubic(j)));
  s.yaw = lerpAngle(endYaw, landX > 0 ? -Math.PI / 2 : Math.PI / 2, easeInOutSine(clamp(j * 1.3)));
  s.pitch = -0.45 * Math.sin(Math.PI * clamp(j * 1.6)) * (1 - j);
  s.dist = len + j * 8;
}

function fightCommon(keys: ReadonlyArray<readonly [number, number]>, sign: number, p: number, s: CharState) {
  const x = duelX(keys, p);
  s.pos.set(x, 0, 0);
  s.yaw = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
  // Backward hop out of the exchange.
  s.pos.y += 0.9 * Math.sin(Math.PI * remap(p, 0.748, 0.778));
  // Blown back by the clash: low skid.
  s.pos.y += 0.5 * Math.sin(Math.PI * remap(p, 0.842, 0.87));
  const g = gaitDistance(keys, p);
  s.dist = g;
  s.runPhase = (g / 2.6) * Math.PI * 2;
  s.run = pulse(p, 0.792, 0.8, 0.83, 0.838);
}

export function evalOptimus(p: number, s: CharState) {
  s.pitch = 0;
  s.roll = 0;
  s.guard = s.punch = s.uppercut = s.block = s.aim = s.swing = s.recoil = s.crouch = s.run = 0;
  s.t = p < 0.45 ? track([[0.16, 0], [0.31, 1]], p, (k) => k) : track([[0.505, 1], [0.585, 0]], p, (k) => k);
  s.charge = pulse(p, 0.33, 0.36, 0.49, 0.52);

  if (p < JUMP[1]) {
    vehicleSegment(OPT_ROUTE, OPT_LEN, _start(-11), Math.PI / 2, LAND_X, p, s);
    s.guard = pulse(p, 0.06, 0.13, 0.14, 0.17) * 0.6;
    s.crouch = pulse(p, 0.55, 0.578, 0.585, 0.585);
    return s;
  }
  fightCommon(OPT_X, 1, p, s);
  s.guard = 1;
  s.crouch = pulse(p, 0.585, 0.59, 0.594, 0.612) + pulse(p, 0.744, 0.75, 0.77, 0.785) * 0.6;
  s.punch = pulse(p, 0.602, 0.613, 0.622, 0.64) + pulse(p, 0.826, 0.836, 0.846, 0.866);
  s.block = pulse(p, 0.652, 0.662, 0.676, 0.69) + pulse(p, 0.698, 0.706, 0.716, 0.728);
  s.recoil = pulse(p, 0.666, 0.672, 0.68, 0.7) * 0.8 + pulse(p, 0.842, 0.848, 0.866, 0.888);
  s.uppercut = pulse(p, 0.718, 0.73, 0.738, 0.752);
  s.charge = pulse(p, 0.9, 0.96, 1, 1.01) * 0.6;
  return s;
}

export function evalMegatron(p: number, s: CharState) {
  s.pitch = 0;
  s.roll = 0;
  s.guard = s.punch = s.uppercut = s.block = s.aim = s.swing = s.recoil = s.crouch = s.run = 0;
  s.t = p < 0.45 ? track([[0.19, 0], [0.34, 1]], p, (k) => k) : track([[0.51, 1], [0.585, 0]], p, (k) => k);
  s.charge = 0;

  if (p < JUMP[1]) {
    vehicleSegment(MEG_ROUTE, MEG_LEN, _start(11), -Math.PI / 2, -LAND_X, p, s);
    s.guard = pulse(p, 0.07, 0.13, 0.14, 0.18) * 0.5;
    s.aim = pulse(p, 0.085, 0.12, 0.135, 0.165) * 0.6;
    s.charge = pulse(p, 0.09, 0.12, 0.13, 0.16) * 0.5 + chargeShots(p);
    s.crouch = pulse(p, 0.55, 0.578, 0.585, 0.585);
    return s;
  }
  fightCommon(MEG_X, -1, p, s);
  s.guard = 1;
  s.crouch = pulse(p, 0.585, 0.59, 0.594, 0.612) + pulse(p, 0.744, 0.75, 0.77, 0.785) * 0.6;
  s.recoil = pulse(p, 0.616, 0.622, 0.63, 0.648) + pulse(p, 0.733, 0.738, 0.748, 0.765) + pulse(p, 0.842, 0.848, 0.866, 0.888);
  s.aim = pulse(p, 0.638, 0.652, 0.668, 0.684) + pulse(p, 0.905, 0.95, 1, 1.01);
  s.charge = pulse(p, 0.642, 0.66, 0.661, 0.672) + pulse(p, 0.91, 0.99, 1, 1.01) * 0.9;
  s.swing = pulse(p, 0.694, 0.706, 0.714, 0.73);
  s.punch = pulse(p, 0.826, 0.836, 0.846, 0.866);
  return s;
}

const _startVec = new THREE.Vector3();
function _start(x: number) {
  return _startVec.set(x, 0, 0);
}

/** Tank-mode shots during the vehicle chase (fire progress). */
export const TANK_SHOTS = [0.392, 0.418, 0.443] as const;
export const SHOT_FLIGHT = 0.011;
function chargeShots(p: number) {
  let c = 0;
  for (const f of TANK_SHOTS) c = Math.max(c, pulse(p, f - 0.01, f - 0.001, f, f + 0.006));
  return c;
}

/** Robot-form cannon shot. */
export const CANNON_SHOT = 0.661;
export const CANNON_FLIGHT = 0.007;

export type FxKind = 'spark' | 'blast' | 'clash' | 'land' | 'scrape';
export interface FxEvent {
  p: number;
  kind: FxKind;
  pos: THREE.Vector3;
  intensity: number;
  seed: number;
  /** Optional travel direction bias for sparks (e.g. away from a hit). */
  dir: THREE.Vector3;
}

/**
 * Impact events, resolved once against the choreography so every effect lands
 * exactly where the fighters are at that instant.
 */
export function buildEvents(): FxEvent[] {
  const o = makeState();
  const m = makeState();
  const ev: FxEvent[] = [];
  let seed = 1;
  const push = (p: number, kind: FxKind, pos: THREE.Vector3, intensity: number, dir = new THREE.Vector3(0, 1, 0)) =>
    ev.push({ p, kind, pos: pos.clone(), intensity, seed: seed++ * 17.13, dir: dir.clone().normalize() });

  // Tank shells: explode around the swerving truck (near misses).
  TANK_SHOTS.forEach((f, i) => {
    const pa = f + SHOT_FLIGHT;
    evalOptimus(pa, o);
    const left = new THREE.Vector3(Math.cos(o.yaw), 0, -Math.sin(o.yaw));
    const fwd = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw));
    const off = left.multiplyScalar(3.0 + i * 0.4).addScaledVector(fwd, 1.5 + i).setY(0.3);
    push(pa, 'blast', o.pos.clone().add(off), 0.9);
  });

  // Side-swipe as they pass each other.
  {
    let best = 0.4;
    let bestD = Infinity;
    for (let p = 0.38; p < 0.46; p += 0.0005) {
      evalOptimus(p, o);
      evalMegatron(p, m);
      const d = o.pos.distanceTo(m.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    evalOptimus(best, o);
    evalMegatron(best, m);
    const mid = o.pos.clone().lerp(m.pos, 0.5).setY(1.1);
    push(best, 'scrape', mid, 0.8, new THREE.Vector3(0, 0.6, 0));
  }

  // Landings.
  evalOptimus(JUMP[1], o);
  evalMegatron(JUMP[1], m);
  push(JUMP[1], 'land', o.pos.clone().setY(0.1), 0.9);
  push(JUMP[1] + 0.0005, 'land', m.pos.clone().setY(0.1), 0.9);

  const hitOn = (p: number, victim: 'o' | 'm', y: number, fwd: number, kind: FxKind, k: number) => {
    evalOptimus(p, o);
    evalMegatron(p, m);
    const v = victim === 'o' ? o.pos : m.pos;
    const a = victim === 'o' ? m.pos : o.pos;
    const dir = a.clone().sub(v).setY(0).normalize();
    push(p, kind, v.clone().addScaledVector(dir, fwd).setY(y), k, dir.clone().multiplyScalar(-1).setY(0.4));
  };
  hitOn(0.618, 'm', 6.25, 0.75, 'spark', 1.0); // right hook to the jaw
  hitOn(CANNON_SHOT + CANNON_FLIGHT, 'o', 5.6, 1.15, 'blast', 1.0); // cannon blast on the block
  hitOn(0.711, 'o', 5.7, 1.0, 'spark', 0.9); // haymaker into the guard
  hitOn(0.735, 'm', 6.4, 0.7, 'spark', 1.0); // uppercut
  push(CLASH_P, 'clash', new THREE.Vector3(0, 5.2, 0), 1.6, new THREE.Vector3(0, 0.5, 0));
  push(0.862, 'land', new THREE.Vector3(5.2, 0.1, 0), 0.6);
  push(0.862, 'land', new THREE.Vector3(-5.2, 0.1, 0), 0.6);
  push(0.778, 'land', new THREE.Vector3(6.6, 0.1, 0), 0.5);
  push(0.778, 'land', new THREE.Vector3(-6.6, 0.1, 0), 0.5);
  return ev.sort((a, b) => a.p - b.p);
}

/** Camera shake envelope from impacts (deterministic, decays after each event). */
export function impactEnvelope(events: FxEvent[], p: number) {
  let e = 0;
  for (const ev of events) {
    const d = p - ev.p;
    if (d < -0.0005 || d > 0.03) continue;
    const k = d < 0 ? 1 + d / 0.0005 : Math.exp(-d / (ev.kind === 'clash' ? 0.012 : 0.006));
    e = Math.max(e, k * ev.intensity);
  }
  return e;
}
