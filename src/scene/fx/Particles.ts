import * as THREE from 'three';
import type { Quality } from '../quality';
import { spriteTexture } from '../materials';
import { CANNON_FLIGHT, CANNON_SHOT, SHOT_FLIGHT, TANK_SHOTS, type CharState, type FxEvent } from '../choreography';
import { clamp, hash, pulse } from '../timeline';

/**
 * Effects. Impact effects (sparks, debris, smoke puffs, projectiles, flashes) are pure
 * functions of action progress — each particle's age is (p − eventP), so scrubbing
 * backwards rewinds them. Ambient effects (embers, smoke columns, falling debris)
 * run on wall-clock time.
 */

const POINT_VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
attribute float aRot;
varying vec4 vColor;
varying float vRot;
uniform float uScale;
void main() {
  vColor = aColor;
  vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;

const POINT_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
varying float vRot;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  uv = mat2(c, -s, s, c) * uv + 0.5;
  vec4 t = texture2D(uMap, uv);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.003) discard;
}`;

class PointPool {
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  readonly col: Float32Array;
  readonly size: Float32Array;
  readonly rot: Float32Array;
  readonly material: THREE.ShaderMaterial;

  constructor(readonly count: number, map: THREE.Texture, additive: boolean) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 4);
    this.size = new Float32Array(count);
    this.rot = new Float32Array(count);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: { uMap: { value: map }, uScale: { value: 300 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
  }

  set(i: number, x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number, rot = 0) {
    const i3 = i * 3;
    const i4 = i * 4;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.col[i4] = r;
    this.col[i4 + 1] = g;
    this.col[i4 + 2] = b;
    this.col[i4 + 3] = a;
    this.size[i] = size;
    this.rot[i] = rot;
  }

  hide(i: number) {
    this.size[i] = 0;
    this.col[i * 4 + 3] = 0;
  }

  commit() {
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true;
    a.aColor.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aRot.needsUpdate = true;
  }
}

interface Slot {
  ev: number;
  dx: number;
  dy: number;
  dz: number;
  speed: number;
  delay: number;
  life: number;
  seed: number;
}

const LIFE: Record<FxEvent['kind'], number> = { spark: 0.02, blast: 0.026, clash: 0.045, land: 0.03, scrape: 0.03 };

function allocate(events: FxEvent[], total: number, weight: (e: FxEvent) => number, make: (e: FxEvent, ei: number, k: number, n: number) => Slot) {
  const ws = events.map(weight);
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  const slots: Slot[] = [];
  events.forEach((e, ei) => {
    const n = Math.floor((ws[ei] / sum) * total);
    for (let k = 0; k < n; k++) slots.push(make(e, ei, k, n));
  });
  return slots;
}

function sphereDir(seed: number, bias: THREE.Vector3, spread: number) {
  const u = hash(seed) * 2 - 1;
  const th = hash(seed + 1.7) * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  const v = new THREE.Vector3(s * Math.cos(th), Math.abs(u) * 0.8 + 0.1, s * Math.sin(th));
  v.multiplyScalar(spread).add(bias).normalize();
  return v;
}

export interface FxContext {
  o: CharState;
  m: CharState;
  /** Megatron's tank muzzle in world space at an arbitrary progress (for shells). */
  tankMuzzleAt: (p: number, out: THREE.Vector3) => THREE.Vector3;
  /** Megatron's live muzzle position (robot cannon shot). */
  liveMuzzle: THREE.Vector3;
  /** Dust trail sampler: vehicle positions at a past progress. */
  trailAt: (who: 'o' | 'm', p: number, out: THREE.Vector3) => boolean;
  focus: THREE.Vector3;
  camera: THREE.Camera;
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly sparks: PointPool;
  private readonly sparkSlots: Slot[];
  private readonly streaks: THREE.LineSegments;
  private readonly streakPos: Float32Array;
  private readonly streakCol: Float32Array;
  private readonly smoke: PointPool;
  private readonly smokeSlots: Slot[];
  private readonly embers: PointPool;
  private readonly debris: THREE.InstancedMesh;
  private readonly debrisSlots: Slot[];
  private readonly fallCount: number;
  private readonly projectiles: { core: THREE.Mesh; glow: THREE.Sprite }[] = [];
  private readonly muzzle: THREE.Sprite;
  private readonly flashLight: THREE.PointLight;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly burst: THREE.Sprite;
  private readonly textures: THREE.Texture[] = [];
  private readonly ambientSmoke: number;
  private readonly trailCount = 30;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  /** 0..1 screen flash amount for post-processing. */
  flash = 0;

  constructor(
    private readonly events: FxEvent[],
    private readonly smokeSources: THREE.Vector3[],
    debrisMat: THREE.Material,
    private readonly quality: Quality,
  ) {
    const sparkTex = spriteTexture('spark');
    const softTex = spriteTexture('soft');
    const smokeTex = spriteTexture('smoke');
    this.textures.push(sparkTex, softTex, smokeTex);

    // ── Sparks (glowing heads + motion streaks) ──
    this.sparkSlots = allocate(
      events,
      quality.sparks,
      (e) => (e.kind === 'land' ? 0 : e.kind === 'clash' ? 3.2 : e.kind === 'scrape' ? 1.4 : e.kind === 'blast' ? 1.1 : 1) * e.intensity,
      (e, ei, k, n) => {
        const seed = e.seed + k * 3.71;
        const d = sphereDir(seed, e.dir, e.kind === 'clash' ? 1.4 : 1.0);
        return {
          ev: ei,
          dx: d.x,
          dy: d.y,
          dz: d.z,
          speed: (e.kind === 'clash' ? 6 : 3.5) + hash(seed + 5) * (e.kind === 'clash' ? 12 : 7),
          delay: e.kind === 'scrape' ? (k / n) * 0.012 : hash(seed + 9) * 0.002,
          life: LIFE[e.kind] * (0.6 + hash(seed + 11) * 0.6),
          seed,
        };
      },
    );
    this.sparks = new PointPool(this.sparkSlots.length, sparkTex, true);
    this.group.add(this.sparks.points);

    const sg = new THREE.BufferGeometry();
    this.streakPos = new Float32Array(this.sparkSlots.length * 6);
    this.streakCol = new Float32Array(this.sparkSlots.length * 6);
    sg.setAttribute('position', new THREE.BufferAttribute(this.streakPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(this.streakCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.streaks = new THREE.LineSegments(
      sg,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.streaks.frustumCulled = false;
    this.group.add(this.streaks);

    // ── Smoke / dust ──
    this.ambientSmoke = Math.min(smokeSources.length * 14, Math.floor(quality.smoke * 0.4));
    const eventSmoke = allocate(
      events,
      Math.floor(quality.smoke * 0.42),
      (e) => (e.kind === 'clash' ? 1.4 : e.kind === 'blast' ? 1.6 : e.kind === 'land' ? 1.2 : 0.6) * e.intensity,
      (e, ei, k) => {
        const seed = e.seed * 1.3 + k * 2.17;
        const d = sphereDir(seed, new THREE.Vector3(0, e.kind === 'land' ? -0.6 : 0.3, 0), 1);
        return { ev: ei, dx: d.x, dy: Math.abs(d.y) * 0.4, dz: d.z, speed: 1 + hash(seed) * 2.5, delay: 0, life: LIFE[e.kind] * 2.6, seed };
      },
    );
    this.smokeSlots = eventSmoke;
    this.smoke = new PointPool(this.ambientSmoke + eventSmoke.length + this.trailCount * 2, smokeTex, false);
    this.group.add(this.smoke.points);

    // ── Embers ──
    this.embers = new PointPool(quality.embers, softTex, true);
    this.group.add(this.embers.points);

    // ── Debris ──
    this.fallCount = Math.floor(quality.debris * 0.25);
    this.debrisSlots = allocate(
      events,
      quality.debris - this.fallCount,
      (e) => (e.kind === 'clash' ? 3 : e.kind === 'blast' ? 1.8 : e.kind === 'land' ? 1 : 0.6) * e.intensity,
      (e, ei, k) => {
        const seed = e.seed * 2.1 + k * 5.3;
        const d = sphereDir(seed, e.dir, 1.2);
        return { ev: ei, dx: d.x, dy: d.y, dz: d.z, speed: 3 + hash(seed) * (e.kind === 'clash' ? 10 : 6), delay: 0, life: LIFE[e.kind] * 3, seed };
      },
    );
    const dgeo = new THREE.TetrahedronGeometry(0.22, 0);
    this.debris = new THREE.InstancedMesh(dgeo, debrisMat, this.debrisSlots.length + this.fallCount);
    this.debris.castShadow = true;
    this.debris.frustumCulled = false;
    this.group.add(this.debris);

    // ── Projectiles + muzzle flash ──
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2.2, 1.2), toneMapped: true });
    const glowMat = new THREE.SpriteMaterial({ map: softTex, color: new THREE.Color(4, 1.4, 0.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const coreGeo = new THREE.SphereGeometry(0.22, 12, 8);
    for (let i = 0; i < TANK_SHOTS.length + 1; i++) {
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.scale.set(1, 1, 3.4);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(2.4);
      core.visible = glow.visible = false;
      this.projectiles.push({ core, glow });
      this.group.add(core, glow);
    }
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: new THREE.Color(5, 2.4, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.muzzle.visible = false;
    this.group.add(this.muzzle);

    // ── Impact light, shockwave ring, clash burst ──
    this.flashLight = new THREE.PointLight('#ffb27a', 0, 28, 1.6);
    this.group.add(this.flashLight);
    const ringTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const x = c.getContext('2d')!;
      const g = x.createRadialGradient(128, 128, 60, 128, 128, 128);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.75, 'rgba(255,220,180,0.9)');
      g.addColorStop(0.85, 'rgba(255,180,120,0.4)');
      g.addColorStop(1, 'rgba(255,160,100,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 256, 256);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.textures.push(ringTex);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.01, 1, 64, 1),
      new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(2.2, 1.4, 1) }),
    );
    // RingGeometry UVs map the square texture across the disc.
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.group.add(this.ring);
    this.burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: new THREE.Color(1.8, 1.25, 0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.burst.visible = false;
    this.group.add(this.burst);
  }

  update(p: number, time: number, ctx: FxContext) {
    const ev = this.events;
    const flicker = this.quality.reducedMotion ? 0 : 1;

    // ── Sparks ──
    const sp = this.sparks;
    for (let i = 0; i < this.sparkSlots.length; i++) {
      const s = this.sparkSlots[i];
      const e = ev[s.ev];
      const a = (p - e.p - s.delay) / s.life;
      if (a < 0 || a >= 1) {
        sp.hide(i);
        this.streakCol.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      const tau = a * 1.1;
      const sx = s.dx * s.speed;
      const sy = s.dy * s.speed;
      const sz = s.dz * s.speed;
      const x = e.pos.x + sx * tau;
      const z = e.pos.z + sz * tau;
      const y = Math.max(0.03, e.pos.y + sy * tau - 4.9 * tau * tau);
      const tt = Math.max(0, tau - 0.06);
      const x0 = e.pos.x + sx * tt;
      const z0 = e.pos.z + sz * tt;
      const y0 = Math.max(0.03, e.pos.y + sy * tt - 4.9 * tt * tt);
      const fade = Math.pow(1 - a, 1.4) * (1 - 0.3 * flicker * (0.5 + 0.5 * Math.sin(time * 47 + s.seed)));
      const hot = 1 - a;
      const r = 2.0 * fade;
      const g = (0.7 + 1.0 * hot) * fade;
      const b = (0.2 + 0.8 * hot * hot) * fade;
      sp.set(i, x, y, z, (0.1 + 0.14 * hot) * (e.kind === 'clash' ? 1.4 : 1), r, g, b, 1);
      const j = i * 6;
      this.streakPos[j] = x;
      this.streakPos[j + 1] = y;
      this.streakPos[j + 2] = z;
      this.streakPos[j + 3] = x0;
      this.streakPos[j + 4] = y0;
      this.streakPos[j + 5] = z0;
      this.streakCol[j] = r * 0.6;
      this.streakCol[j + 1] = g * 0.6;
      this.streakCol[j + 2] = b * 0.6;
      this.streakCol[j + 3] = r * 0.1;
      this.streakCol[j + 4] = g * 0.1;
      this.streakCol[j + 5] = b * 0.1;
    }
    sp.commit();
    const sa = this.streaks.geometry.attributes;
    sa.position.needsUpdate = true;
    sa.color.needsUpdate = true;

    // ── Smoke: ambient columns, event puffs, vehicle dust trails ──
    const sm = this.smoke;
    let idx = 0;
    const perSrc = Math.max(1, Math.floor(this.ambientSmoke / Math.max(1, this.smokeSources.length)));
    for (let k = 0; k < this.smokeSources.length && idx < this.ambientSmoke; k++) {
      const src = this.smokeSources[k];
      for (let j = 0; j < perSrc && idx < this.ambientSmoke; j++, idx++) {
        const ph = (time * 0.05 + j / perSrc + hash(k * 9.1 + j)) % 1;
        const h = ph * 18;
        sm.set(
          idx,
          src.x + Math.sin(ph * 5 + k) * (1 + ph * 3) + ph * 6,
          src.y + h,
          src.z + Math.cos(ph * 4 + j) * (1 + ph * 2),
          2.2 + ph * 9,
          0.09,
          0.085,
          0.09,
          0.5 * Math.sin(Math.PI * ph),
          ph * 2 + j,
        );
      }
    }
    for (let i = 0; i < this.smokeSlots.length; i++, idx++) {
      const s = this.smokeSlots[i];
      const e = ev[s.ev];
      const a = (p - e.p) / s.life;
      if (a < 0 || a >= 1) {
        sm.hide(idx);
        continue;
      }
      const spread = Math.sqrt(a) * s.speed * (e.kind === 'land' ? 2.2 : 1.6);
      const warm = e.kind === 'blast' || e.kind === 'clash' ? Math.max(0, 1 - a * 3) : 0;
      sm.set(
        idx,
        e.pos.x + s.dx * spread,
        e.pos.y + s.dy * spread + a * (e.kind === 'land' ? 0.8 : 2.5),
        e.pos.z + s.dz * spread,
        (e.kind === 'land' ? 2.4 : 2.8) + a * 6,
        0.12 + warm * 0.45,
        0.1 + warm * 0.2,
        0.1 + warm * 0.08,
        (e.kind === 'clash' ? 0.22 : 0.45) * (1 - a) * Math.min(1, a * 12),
        s.seed + a,
      );
    }
    for (const who of ['o', 'm'] as const) {
      for (let k = 0; k < this.trailCount; k++, idx++) {
        const lag = (k + 1) * 0.0011;
        if (!ctx.trailAt(who, p - lag, this.v)) {
          sm.hide(idx);
          continue;
        }
        const a = k / this.trailCount;
        const jx = (hash(k * 3.1 + (who === 'o' ? 0 : 50)) - 0.5) * (0.6 + a * 2.5);
        const jz = (hash(k * 5.7 + (who === 'o' ? 0 : 50)) - 0.5) * (0.6 + a * 2.5);
        sm.set(idx, this.v.x + jx, 0.4 + a * 1.4, this.v.z + jz, 2 + a * 5, 0.2, 0.16, 0.12, 0.45 * (1 - a), k);
      }
    }
    sm.commit();

    // ── Embers drifting through the battlefield ──
    const em = this.embers;
    for (let i = 0; i < em.count; i++) {
      const h1 = hash(i * 1.37);
      const h2 = hash(i * 2.71);
      const h3 = hash(i * 4.13);
      const ph = (time * (0.03 + h3 * 0.05) + h1) % 1;
      const x = ctx.focus.x + (h2 - 0.5) * 60 + Math.sin(time * 0.6 + i) * 1.5;
      const z = ctx.focus.z + (h1 - 0.5) * 50 - 8 + Math.cos(time * 0.4 + i) * 1.5;
      const y = ph * 22;
      const tw = 0.6 + 0.4 * Math.sin(time * (3 + h3 * 5) + i);
      const a = Math.sin(Math.PI * ph) * tw;
      em.set(i, x, y, z, 0.12 + h3 * 0.16, 2.4 * a, 0.9 * a, 0.25 * a, 1);
    }
    em.commit();

    // ── Debris: event chunks + ambient falling wreckage in the finale ──
    const d = this.debris;
    let di = 0;
    for (; di < this.debrisSlots.length; di++) {
      const s = this.debrisSlots[di];
      const e = ev[s.ev];
      const a = (p - e.p) / s.life;
      if (a < 0 || a >= 1) {
        d.setMatrixAt(di, this.m4.makeScale(0, 0, 0));
        continue;
      }
      const tau = a * 1.6;
      let y = e.pos.y + s.dy * s.speed * tau - 4.9 * tau * tau;
      const size = 0.5 + hash(s.seed + 3) * 1.4;
      let hk = 1;
      if (y < 0.1 * size) {
        y = 0.1 * size;
        hk = 0.75;
      }
      this.v.set(e.pos.x + s.dx * s.speed * tau * hk, y, e.pos.z + s.dz * s.speed * tau * hk);
      this.e.set(tau * 6 * s.dx + s.seed, tau * 5 * s.dz, tau * 4);
      const shrink = a > 0.85 ? (1 - a) / 0.15 : 1;
      this.m4.compose(this.v, this.q.setFromEuler(this.e), this.sc.setScalar(size * shrink));
      d.setMatrixAt(di, this.m4);
    }
    const fallOn = pulse(p, 0.84, 0.9, 1, 1.01);
    for (let k = 0; k < this.fallCount; k++, di++) {
      const h1 = hash(k * 7.7 + 1);
      const h2 = hash(k * 3.3 + 2);
      const ph = (time * (0.09 + h2 * 0.08) + h1) % 1;
      if (fallOn <= 0) {
        d.setMatrixAt(di, this.m4.makeScale(0, 0, 0));
        continue;
      }
      this.v.set((h1 - 0.5) * 34, 26 - ph * 27, (h2 - 0.5) * 16 - 3);
      this.e.set(time * (1 + h1 * 2), time * h2, k);
      const sz = (0.4 + h2 * 1.2) * fallOn * (this.v.y < 0.2 ? 0 : 1);
      this.m4.compose(this.v, this.q.setFromEuler(this.e), this.sc.setScalar(sz));
      d.setMatrixAt(di, this.m4);
    }
    d.instanceMatrix.needsUpdate = true;

    // ── Projectiles ──
    let muzzleK = 0;
    TANK_SHOTS.forEach((f, i) => {
      const pr = this.projectiles[i];
      const a = (p - f) / SHOT_FLIGHT;
      const mk = a > -0.2 && a < 0.6 ? 1 - Math.abs(a - 0.1) / 0.5 : 0;
      if (mk > muzzleK) {
        muzzleK = mk;
        ctx.tankMuzzleAt(f, this.muzzle.position);
      }
      if (a < 0 || a >= 1) {
        pr.core.visible = pr.glow.visible = false;
        return;
      }
      const target = this.events.find((e) => e.kind === 'blast' && Math.abs(e.p - (f + SHOT_FLIGHT)) < 1e-6);
      ctx.tankMuzzleAt(f, this.v2);
      this.v.copy(this.v2).lerp(target ? target.pos : this.v2, a);
      this.v.y += Math.sin(Math.PI * a) * 0.6;
      this.place(pr, this.v, target ? target.pos : this.v2);
    });
    {
      const pr = this.projectiles[TANK_SHOTS.length];
      const a = (p - CANNON_SHOT) / CANNON_FLIGHT;
      const mk = a > -0.3 && a < 0.6 ? 1 - Math.abs(a - 0.1) / 0.5 : 0;
      if (mk > muzzleK) {
        muzzleK = mk;
        this.muzzle.position.copy(ctx.liveMuzzle);
      }
      if (a < 0 || a >= 1) {
        pr.core.visible = pr.glow.visible = false;
      } else {
        const target = this.events.find((e) => Math.abs(e.p - (CANNON_SHOT + CANNON_FLIGHT)) < 1e-6);
        const to = target ? target.pos : ctx.liveMuzzle;
        this.v.copy(ctx.liveMuzzle).lerp(to, a);
        this.place(pr, this.v, to);
      }
    }
    this.muzzle.visible = muzzleK > 0.01;
    this.muzzle.scale.setScalar(3.2 * clamp(muzzleK));
    (this.muzzle.material as THREE.SpriteMaterial).rotation = time * 3;

    // ── Impact light / clash ring / burst ──
    let best = 0;
    let bestEv: FxEvent | null = null;
    for (const e of ev) {
      const dd = p - e.p;
      if (dd < 0 || dd > 0.02) continue;
      const k = Math.exp(-dd / 0.005) * e.intensity * (e.kind === 'land' ? 0.2 : 1);
      if (k > best) {
        best = k;
        bestEv = e;
      }
    }
    this.flashLight.intensity = best * 60 * (this.quality.reducedMotion ? 0.4 : 1);
    if (bestEv) this.flashLight.position.copy(bestEv.pos);
    const clash = ev.find((e) => e.kind === 'clash');
    this.flash = 0;
    if (clash) {
      const a = (p - clash.p) / 0.035;
      const on = a >= 0 && a < 1;
      this.ring.visible = on;
      this.burst.visible = on;
      if (on) {
        const r = 1 + a * 22;
        this.ring.position.set(clash.pos.x, 0.08, clash.pos.z);
        this.ring.scale.setScalar(r);
        this.ring.material.opacity = Math.pow(1 - a, 1.5);
        this.burst.position.copy(clash.pos);
        this.burst.scale.setScalar(1.5 + a * 7);
        (this.burst.material as THREE.SpriteMaterial).opacity = Math.pow(1 - a, 2.5);
        this.flash = Math.pow(1 - a, 4) * (this.quality.reducedMotion ? 0.04 : 0.12);
      }
    }
  }

  private place(pr: { core: THREE.Mesh; glow: THREE.Sprite }, pos: THREE.Vector3, to: THREE.Vector3) {
    pr.core.visible = pr.glow.visible = true;
    pr.core.position.copy(pos);
    pr.core.lookAt(to);
    pr.glow.position.copy(pos);
  }

  /** Called on resize so point sizes stay proportional to the viewport. */
  setViewportHeight(h: number, fov: number) {
    const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    this.sparks.material.uniforms.uScale.value = s;
    this.smoke.material.uniforms.uScale.value = s;
    this.embers.material.uniforms.uScale.value = s;
  }

  dispose() {
    this.textures.forEach((t) => t.dispose());
  }
}
