import * as THREE from 'three';
import type { Materials } from '../materials';
import { mergeTransformed } from '../geometry/kit';
import { hash } from '../timeline';

/** Ruined Cybertronian industrial landscape: terrain, towers, wreckage, sky, lights. */

function noise2(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number) => hash(a * 157.31 + b * 311.7);
  const a = h(ix, iz);
  const b = h(ix + 1, iz);
  const c = h(ix, iz + 1);
  const d = h(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x: number, z: number) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    v += noise2(x * f, z * f) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}

/** Terrain height: flat arena in the middle (fighters stay grounded), ridges beyond. */
export function terrainHeight(x: number, z: number) {
  const r = Math.hypot(x * 0.8, z);
  const rise = THREE.MathUtils.smoothstep(r, 22, 48);
  const ridge = fbm(x * 0.035 + 10, z * 0.035) * 14 - 3;
  return Math.max(ridge * rise, -1) + fbm(x * 0.2, z * 0.2) * 0.4 * rise;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // keep at far plane
}`;

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform float uTime;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.02; a*=0.5;} return v; }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 top = vec3(0.012, 0.018, 0.035);
  vec3 mid = vec3(0.05, 0.05, 0.07);
  vec3 hor = vec3(0.20, 0.09, 0.06);
  vec3 col = mix(hor, mid, smoothstep(-0.02, 0.18, y));
  col = mix(col, top, smoothstep(0.15, 0.7, y));
  // Burning horizon glow behind the battlefield.
  float glow = exp(-abs(y - 0.02) * 14.0) * (0.6 + 0.4 * smoothstep(0.2, -0.9, d.z));
  col += vec3(0.55, 0.18, 0.06) * glow * 0.55;
  // Drifting storm clouds.
  vec2 uv = d.xz / (y + 0.25) * 1.6 + vec2(uTime * 0.01, 0.0);
  float c = fbm(uv);
  col = mix(col, col * 0.45 + vec3(0.06, 0.05, 0.06), smoothstep(0.45, 0.8, c) * smoothstep(0.0, 0.25, y));
  // A distant gas giant.
  vec3 pd = normalize(vec3(-0.55, 0.32, -0.77));
  float pa = dot(d, pd);
  float disk = smoothstep(0.9935, 0.9945, pa);
  float rim = smoothstep(0.985, 0.9945, pa) * (1.0 - disk);
  vec3 pc = mix(vec3(0.10, 0.08, 0.12), vec3(0.32, 0.17, 0.12), fbm(d.xy * 60.0)) * (0.35 + 0.65 * smoothstep(-0.4, 0.6, dot(d - pd, vec3(0.6, 0.4, 0.0)) * 40.0 + 0.5));
  col = mix(col, pc, disk);
  col += vec3(0.6, 0.3, 0.2) * rim * 0.25;
  // Stars.
  float st = step(0.9985, h(floor(d.xy * 420.0 + d.z * 37.0))) * smoothstep(0.25, 0.6, y);
  col += vec3(st) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Battlefield {
  readonly group = new THREE.Group();
  readonly key: THREE.DirectionalLight;
  private readonly fires: THREE.PointLight[] = [];
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly smokeSources: THREE.Vector3[] = [];

  constructor(M: Materials, shadowMapSize: number) {
    const g = this.group;

    // ── Sky ──
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: { uTime: { value: 0 } },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    g.add(this.sky);

    // ── Terrain ──
    const ground = new THREE.PlaneGeometry(320, 320, 220, 220);
    ground.rotateX(-Math.PI / 2);
    const pos = ground.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    ground.computeVertexNormals();
    const groundMesh = new THREE.Mesh(ground, M.terrain);
    groundMesh.receiveShadow = true;
    g.add(groundMesh);

    // ── Ruined towers (merged per material) ──
    const lists: Record<'ruin' | 'dark' | 'glow', { geo: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]> = {
      ruin: [],
      dark: [],
      glow: [],
    };
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const put = (list: keyof typeof lists, geo: THREE.BufferGeometry, p: THREE.Vector3, rot: THREE.Euler, s = sc.set(1, 1, 1)) => {
      lists[list].push({ geo, matrix: m4.compose(p, q.setFromEuler(rot), s).clone() });
    };

    let seed = 3;
    const r = () => hash(seed++ * 7.31);
    const towerCount = 26;
    for (let i = 0; i < towerCount; i++) {
      // Arc behind and beside the arena (the camera mostly looks toward −Z).
      const ang = -Math.PI - 0.5 + (i / (towerCount - 1)) * (Math.PI + 1.0) + (r() - 0.5) * 0.08;
      const rad = 58 + r() * 80;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const base = terrainHeight(x, z) - 1;
      const w = 3 + r() * 6;
      const d = 3 + r() * 6;
      const segs = 2 + Math.floor(r() * 4);
      let y = base;
      const tilt = (r() - 0.5) * 0.12;
      for (let s = 0; s < segs; s++) {
        const h = 5 + r() * 9;
        const ww = w * (1 - s * 0.14);
        const dd = d * (1 - s * 0.14);
        const rot = e.set(tilt * s, r() * 0.2, tilt * s * 0.6);
        put('ruin', new THREE.BoxGeometry(ww, h, dd), v.set(x, y + h / 2, z), rot);
        put('dark', new THREE.BoxGeometry(ww * 1.06, 0.6, dd * 1.06), v.set(x, y + h, z), rot);
        // Glowing windows.
        const rows = Math.floor(h / 2.2);
        for (let k = 0; k < rows; k++) {
          if (r() < 0.55) continue;
          put('glow', new THREE.BoxGeometry(ww * (0.2 + r() * 0.5), 0.18, 0.1), v.set(x + (r() - 0.5) * ww * 0.3, y + 1 + k * 2.2, z + dd / 2 + 0.05), rot);
        }
        // Exposed girders.
        if (r() < 0.6) {
          put('dark', new THREE.BoxGeometry(0.3, 0.3, 6 + r() * 6), v.set(x + ww * 0.3, y + h - 0.5, z), e.set(0.4 + r(), r() * 3, 0));
        }
        y += h;
      }
      // Broken crown: a sheared slab.
      put('ruin', new THREE.BoxGeometry(w * 0.9, 0.8, d * 0.9), v.set(x + 0.8, y + 0.6, z), e.set(0.5 * (r() - 0.5), 0, 0.6 * (r() - 0.5) + 0.3));
      if (i % 3 === 0) this.smokeSources.push(new THREE.Vector3(x, y, z));
    }

    // Distant spires — silhouettes behind the fog.
    for (let i = 0; i < 26; i++) {
      const ang = -Math.PI / 2 - 1.2 + (i / 25) * 2.4 + (r() - 0.5) * 0.1;
      const rad = 140 + r() * 60;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const h = 30 + r() * 70;
      put('dark', new THREE.CylinderGeometry(0.4, 3 + r() * 4, h, 6), v.set(x, h / 2 - 2, z), e.set(0, r() * 3, 0));
      put('glow', new THREE.SphereGeometry(0.6, 6, 4), v.set(x, h - 2, z), e.set(0, 0, 0));
    }

    // Near wreckage framing the arena (kept outside the combat lanes).
    const wrecks: [number, number][] = [
      [-19, -11],
      [17, -13],
      [-24, 6],
      [22, 9],
      [-8, -16],
      [9, -18],
      [-15, 14],
      [14, 15],
    ];
    for (const [x, z] of wrecks) {
      const yaw = r() * Math.PI;
      // Collapsed hull plate.
      put('ruin', new THREE.BoxGeometry(6 + r() * 4, 0.5, 3 + r() * 2), v.set(x, 0.8, z), e.set(0.35 + r() * 0.3, yaw, 0.2));
      // Girder frame.
      for (let k = 0; k < 3; k++) {
        put('dark', new THREE.BoxGeometry(0.35, 5 + r() * 5, 0.35), v.set(x + (r() - 0.5) * 4, 2.2, z + (r() - 0.5) * 3), e.set((r() - 0.5) * 0.9, yaw, (r() - 0.5) * 0.9));
      }
      // Half-buried machinery: a giant gear.
      if (r() < 0.6) {
        const gear = new THREE.CylinderGeometry(2.2, 2.2, 0.6, 12);
        put('dark', gear, v.set(x + 2, 1.2, z - 1), e.set(Math.PI / 2 - 0.4, yaw, 0.2));
        put('ruin', new THREE.CylinderGeometry(0.7, 0.7, 0.8, 10), v.set(x + 2, 1.2, z - 1), e.set(Math.PI / 2 - 0.4, yaw, 0.2));
      }
      // Pipes.
      put('ruin', new THREE.CylinderGeometry(0.35, 0.35, 7, 10), v.set(x - 1.5, 0.4, z + 1.5), e.set(Math.PI / 2, yaw + 0.6, 0.05));
      this.smokeSources.push(new THREE.Vector3(x, 1.2, z));
    }

    const mk = (list: keyof typeof lists, mat: THREE.Material, cast: boolean) => {
      const merged = mergeTransformed(lists[list]);
      if (!merged) return;
      const meshObj = new THREE.Mesh(merged, mat);
      meshObj.castShadow = cast;
      meshObj.receiveShadow = true;
      g.add(meshObj);
    };
    mk('ruin', M.ruin, true);
    mk('dark', M.ruinDark, true);
    mk('glow', M.ruinGlow, false);

    // Rubble field (instanced).
    const rubbleGeo = new THREE.DodecahedronGeometry(0.5, 0);
    const rubbleN = 420;
    const rubble = new THREE.InstancedMesh(rubbleGeo, M.ruin, rubbleN);
    let placed = 0;
    for (let i = 0; placed < rubbleN && i < rubbleN * 4; i++) {
      const x = (r() - 0.5) * 90;
      const z = (r() - 0.5) * 70 - 6;
      if (Math.abs(z) < 8 && Math.abs(x) < 14) continue; // keep combat lanes clear
      const s = 0.2 + Math.pow(r(), 3) * 1.6;
      m4.compose(v.set(x, terrainHeight(x, z) + s * 0.2, z), q.setFromEuler(e.set(r() * 3, r() * 3, r() * 3)), sc.set(s, s * (0.5 + r() * 0.6), s));
      rubble.setMatrixAt(placed++, m4);
    }
    rubble.count = placed;
    rubble.castShadow = true;
    rubble.receiveShadow = true;
    g.add(rubble);

    // ── Lights ──
    g.add(new THREE.HemisphereLight('#4c5c7a', '#1c1410', 0.55));
    g.add(new THREE.AmbientLight('#20242c', 0.4));

    const key = new THREE.DirectionalLight('#ffdcb8', 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const sc2 = key.shadow.camera;
    sc2.left = -17;
    sc2.right = 17;
    sc2.top = 17;
    sc2.bottom = -17;
    sc2.near = 1;
    sc2.far = 90;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.035;
    this.key = key;
    g.add(key, key.target);

    const rimBlue = new THREE.DirectionalLight('#3c78ff', 1.3);
    rimBlue.position.set(-24, 10, -20);
    const rimRed = new THREE.DirectionalLight('#ff3a26', 1.3);
    rimRed.position.set(24, 10, -20);
    const front = new THREE.DirectionalLight('#9fb4d6', 0.5);
    front.position.set(0, 6, 30);
    g.add(rimBlue, rimRed, front);

    for (const [x, z] of [
      [-19, -11],
      [22, 9],
      [9, -18],
    ]) {
      const l = new THREE.PointLight('#ff6a24', 18, 26, 1.8);
      l.position.set(x, 2.5, z);
      this.fires.push(l);
      g.add(l);
    }
  }

  update(time: number, focus: THREE.Vector3) {
    this.sky.material.uniforms.uTime.value = time;
    this.key.position.set(focus.x - 14, 26, focus.z + 14);
    this.key.target.position.copy(focus);
    this.fires.forEach((l, i) => {
      l.intensity = 14 + Math.sin(time * 9 + i * 2) * 3 + Math.sin(time * 23 + i) * 2;
    });
  }
}
