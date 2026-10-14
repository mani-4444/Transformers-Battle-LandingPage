/**
 * Master timeline. Scroll progress p ∈ [0, 1] is the single source of truth:
 * every pose, camera move and effect is a pure function of p.
 */

export interface Chapter {
  id: string;
  numeral: string;
  title: string;
  caption: string;
  start: number;
  end: number;
}

export const CHAPTERS: Chapter[] = [
  { id: 'standoff', numeral: 'I', title: 'The Standoff', caption: 'Two titans. One ruined world.', start: 0, end: 0.15 },
  { id: 'transform', numeral: 'II', title: 'Transformation', caption: 'Armor folds. Machines reshape for war.', start: 0.15, end: 0.35 },
  { id: 'pursuit', numeral: 'III', title: 'Vehicle Combat', caption: 'Steel against steel at full throttle.', start: 0.35, end: 0.5 },
  { id: 'attack', numeral: 'IV', title: 'Transform & Attack', caption: 'They rise mid-air — and strike.', start: 0.5, end: 0.75 },
  { id: 'clash', numeral: 'V', title: 'The Final Clash', caption: 'Everything collides.', start: 0.75, end: 0.9 },
  { id: 'aftermath', numeral: 'VI', title: 'The Final Frame', caption: 'Neither will yield.', start: 0.9, end: 1 },
];

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Normalised position of v inside [a, b], clamped to [0, 1]. */
export const remap = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = remap(v, a, b);
  return t * t * (3 - 2 * t);
};

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInOutQuint = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeInQuad = (t: number) => t * t;
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

export type Ease = (t: number) => number;

/** Bell-shaped pulse: 0 outside [a, d], ramps in over [a, b], holds, ramps out over [c, d]. */
export function pulse(p: number, a: number, b: number, c: number, d: number) {
  if (p <= a || p >= d) return 0;
  if (p < b) return easeInOutSine(remap(p, a, b));
  if (p <= c) return 1;
  return 1 - easeInOutSine(remap(p, c, d));
}

/** Scalar keyframe track: keys sorted by p. Values are eased between neighbours. */
export function track(keys: ReadonlyArray<readonly [number, number]>, p: number, ease: Ease = easeInOutCubic) {
  if (p <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (p >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i];
    const k1 = keys[i + 1];
    if (p <= k1[0]) {
      const t = ease((p - k0[0]) / (k1[0] - k0[0] || 1));
      return k0[1] + (k1[1] - k0[1]) * t;
    }
  }
  return last[1];
}

/** Deterministic hash → [0, 1). */
export function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x: number) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i) * 2 - 1) * (1 - u) + (hash(i + 1) * 2 - 1) * u;
}

/** Final clash happens here; motion slows around it. */
export const CLASH_P = 0.84;

/**
 * Time-dilation remap for the clash (impact pause). Inside [0.8, 0.88] action time
 * slows near the impact and catches up on either side; it is the identity elsewhere,
 * so scroll position and action never drift apart.
 */
export function dilate(p: number, strength: number) {
  const s = 0.8;
  const e = 0.88;
  if (strength <= 0 || p <= s || p >= e) return p;
  const uc = (CLASH_P - s) / (e - s);
  const u = (p - s) / (e - s);
  let g: number;
  if (u < uc) g = uc - uc * Math.pow((uc - u) / uc, 2.4);
  else g = uc + (1 - uc) * Math.pow((u - uc) / (1 - uc), 2.4);
  // g has ~zero slope at the clash; blend with identity to keep a slow crawl.
  const mix = u + (g - u) * strength;
  return s + mix * (e - s);
}
