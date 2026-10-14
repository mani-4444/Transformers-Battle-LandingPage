import * as THREE from 'three';
import { createMaterials, type Materials } from './materials';
import { detectQuality, type Quality } from './quality';
import { buildOptimus } from './characters/Optimus';
import { buildMegatron, type TreadUnit } from './characters/Megatron';
import { applyPose } from './characters/poses';
import type { Transformer } from './rig/Transformer';
import { Battlefield, terrainHeight } from './environment/Battlefield';
import { Effects } from './fx/Particles';
import { PostFX } from './fx/PostFX';
import { buildEvents, DRIVE, evalMegatron, evalOptimus, impactEnvelope, makeState, type CharState, type FxEvent } from './choreography';
import { evalCamera, shakeOffset, type CamOut } from './camera';
import { clamp, dilate } from './timeline';

export type StepCallback = (label: string, fraction: number) => void;

export interface BattleSceneOptions {
  reducedMotion: boolean;
  /** Called every rendered frame with the displayed (smoothed) progress. */
  onFrame?: (p: number) => void;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Probe once whether WebGL can be created at all. */
export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function buildEnvironmentMap(renderer: THREE.WebGLRenderer) {
  // A dark studio with coloured light panels: gives the metal believable red/blue/warm
  // reflections that match the battlefield lighting.
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: '#07080b', side: THREE.BackSide }));
  env.add(room);
  const panel = (color: THREE.ColorRepresentation, k: number, w: number, h: number, pos: [number, number, number], rotY = 0, rotX = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.rotation.set(rotX, rotY, 0);
    env.add(m);
  };
  panel('#ffe2c4', 2.6, 8, 3, [0, 4.9, 2], 0, Math.PI / 2); // key from above
  panel('#3f7cff', 2.2, 3, 6, [-9.9, 1.5, -2], Math.PI / 2); // blue rim
  panel('#ff3a22', 2.2, 3, 6, [9.9, 1.5, -2], -Math.PI / 2); // red rim
  panel('#ff8a3a', 1.4, 20, 1.2, [0, -0.5, -9.9]); // burning horizon
  panel('#9fb4d6', 0.7, 10, 4, [0, 2, 9.9], Math.PI); // cool fill
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  env.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return rt;
}

export class BattleScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1200);
  private quality: Quality;
  private mats!: Materials;
  private envRT!: THREE.WebGLRenderTarget;
  private field!: Battlefield;
  private optimus!: Transformer;
  private megatron!: Transformer;
  private treads: TreadUnit[] = [];
  private fx!: Effects;
  private post!: PostFX;
  private events: FxEvent[] = [];
  private readonly o: CharState = makeState();
  private readonly m: CharState = makeState();
  private readonly tmpState: CharState = makeState();
  private readonly cam: CamOut = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
  private readonly prevCam = new THREE.Vector3();
  private readonly shake = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private readonly tankMuzzleLocal = new THREE.Vector3();
  private readonly liveMuzzle = new THREE.Vector3();
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly clock = new THREE.Clock();
  private width = 1;
  private height = 1;
  private target = 0;
  private progress = 0;
  private ready = false;
  private disposed = false;
  private reducedMotion: boolean;
  private readonly onFrame?: (p: number) => void;

  constructor(canvas: HTMLCanvasElement, opts: BattleSceneOptions) {
    this.reducedMotion = opts.reducedMotion;
    this.onFrame = opts.onFrame;
    this.quality = detectQuality(opts.reducedMotion);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.dprCap));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color('#07090d');
    this.scene.fog = new THREE.FogExp2('#0b0d12', 0.0115);
  }

  async init(onStep: StepCallback) {
    const step = async (label: string, f: number) => {
      onStep(label, f);
      await nextFrame();
      if (this.disposed) throw new Error('disposed');
    };
    await step('Forging armour plating', 0.05);
    this.mats = createMaterials();
    await step('Generating reflections', 0.2);
    this.envRT = buildEnvironmentMap(this.renderer);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.7;

    await step('Assembling Optimus Prime', 0.3);
    this.optimus = buildOptimus(this.mats);
    this.scene.add(this.optimus.root);

    await step('Assembling Megatron', 0.45);
    const meg = buildMegatron(this.mats);
    this.megatron = meg.rig;
    this.treads = meg.treads;
    this.scene.add(this.megatron.root);
    // Muzzle position in tank mode, relative to Megatron's root (for shell origins).
    this.megatron.setTransform(1);
    this.megatron.root.updateMatrixWorld(true);
    this.megatron.markers.get('muzzle')!.getWorldPosition(this.tankMuzzleLocal);
    this.megatron.setTransform(0);

    await step('Rebuilding Cybertron', 0.6);
    this.field = new Battlefield(this.mats, this.quality.shadowMapSize);
    this.scene.add(this.field.group);

    await step('Choreographing the battle', 0.72);
    this.events = buildEvents();
    this.fx = new Effects(this.events, this.field.smokeSources, this.mats.debris, this.quality);
    this.scene.add(this.fx.group);
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.quality);

    await step('Compiling shaders', 0.82);
    this.resize(this.width, this.height);
    this.updateFrame(0, 0);
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    }
    if (this.disposed) throw new Error('disposed');
    await step('Engaging', 0.96);
    this.progress = this.target;
    this.ready = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this.tick);
  }

  setTarget(p: number) {
    this.target = clamp(p);
  }

  /** Jump the displayed progress straight to the scroll target (skips smoothing). */
  snap() {
    this.progress = this.target;
  }

  setReducedMotion(rm: boolean) {
    this.reducedMotion = rm;
    this.quality.reducedMotion = rm;
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(this.width, this.height, dpr);
    if (this.post) this.post.bloom.resolution.set((this.width * dpr) / 2, (this.height * dpr) / 2);
    this.fx?.setViewportHeight(this.height * dpr, this.camera.fov);
  }

  private tick = () => {
    if (!this.ready || this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime;
    // Frame-rate independent smoothing of scroll → displayed progress.
    const k = 1 - Math.exp(-dt * (this.reducedMotion ? 14 : 6.5));
    this.progress += (this.target - this.progress) * k;
    if (Math.abs(this.target - this.progress) < 1e-5) this.progress = this.target;
    this.updateFrame(this.progress, time, dt);
    this.post.composer.render(dt);
    this.onFrame?.(this.progress);
  };

  private placeRoot(rig: Transformer, s: CharState) {
    rig.root.position.copy(s.pos);
    rig.root.rotation.set(s.pitch, s.yaw, s.roll, 'YXZ');
  }

  private tankMuzzleAt = (p: number, out: THREE.Vector3) => {
    evalMegatron(p, this.tmpState);
    this.tmpEuler.set(this.tmpState.pitch, this.tmpState.yaw, this.tmpState.roll, 'YXZ');
    this.tmpMatrix.compose(this.tmpState.pos, this.tmpQuat.setFromEuler(this.tmpEuler), this.one);
    return out.copy(this.tankMuzzleLocal).applyMatrix4(this.tmpMatrix);
  };

  private trailAt = (who: 'o' | 'm', p: number, out: THREE.Vector3) => {
    if (p < DRIVE[0] + 0.002 || p > DRIVE[1]) return false;
    (who === 'o' ? evalOptimus : evalMegatron)(p, this.tmpState);
    out.copy(this.tmpState.pos);
    return true;
  };

  private updateFrame(p: number, time: number, dt = 1 / 60) {
    const rm = this.reducedMotion;
    const ap = dilate(p, rm ? 0 : 0.8);
    const { o, m, mats } = this;

    evalOptimus(ap, o);
    evalMegatron(ap, m);

    // Characters: transformation pose → root placement → combat/gait layer.
    this.optimus.setTransform(o.t);
    this.placeRoot(this.optimus, o);
    this.optimus.spinWheels(o.dist);
    applyPose(this.optimus, o, time, false, rm ? 0.3 : 1);

    this.megatron.setTransform(m.t);
    this.placeRoot(this.megatron, m);
    applyPose(this.megatron, m, time, true, rm ? 0.3 : 1);
    for (const t of this.treads) t.update(m.dist * 1.0);

    // Emissives: eyes pulse, headlights on in truck mode, cannon charges before firing.
    mats.optGlow.emissiveIntensity = 3.2 + Math.sin(time * 2.2) * 0.6 + o.charge * 2;
    mats.headlight.emissiveIntensity = 0.4 + o.t * 4.5;
    mats.taillight.emissiveIntensity = 0.3 + o.t * 3;
    mats.megGlow.emissiveIntensity = 4 + Math.sin(time * 3.1) * 1.2;
    mats.cannonGlow.emissiveIntensity = 1.2 + m.charge * 14;

    this.scene.updateMatrixWorld();
    this.megatron.markers.get('muzzle')!.getWorldPosition(this.liveMuzzle);

    // Camera.
    evalCamera(ap, o, m, this.cam);
    const energy = rm ? 0 : impactEnvelope(this.events, ap);
    shakeOffset(energy, ap, 0, this.shake);
    this.camera.position.copy(this.cam.pos).add(this.shake);
    // Keep horizontal framing on narrow/portrait viewports.
    const refAspect = 16 / 9;
    let fov = this.cam.fov;
    if (this.camera.aspect < refAspect) {
      const hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * refAspect);
      const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf) / this.camera.aspect));
      const capped = Math.min(needed, 72);
      if (needed > capped) {
        const pull = Math.tan(THREE.MathUtils.degToRad(needed) / 2) / Math.tan(THREE.MathUtils.degToRad(capped) / 2);
        this.camera.position.sub(this.cam.target).multiplyScalar(Math.min(pull, 1.6)).add(this.cam.target);
      }
      fov = capped;
    }
    const ground = terrainHeight(this.camera.position.x, this.camera.position.z) + 0.8;
    if (this.camera.position.y < ground) this.camera.position.y = ground;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.fx?.setViewportHeight(this.height * this.renderer.getPixelRatio(), fov);
    }
    this.camera.lookAt(this.cam.target.x, this.cam.target.y + this.shake.y * 0.5, this.cam.target.z);

    // World + effects.
    this.focus.addVectors(o.pos, m.pos).multiplyScalar(0.5).setY(0);
    this.field.update(time, this.focus);
    this.fx?.update(ap, time, {
      o,
      m,
      tankMuzzleAt: this.tankMuzzleAt,
      liveMuzzle: this.liveMuzzle,
      trailAt: this.trailAt,
      focus: this.focus,
      camera: this.camera,
    });

    // Post: speed-driven radial blur, impact aberration and flash.
    if (this.post) {
      const camSpeed = this.camera.position.distanceTo(this.prevCam) / Math.max(dt, 1e-3);
      this.prevCam.copy(this.camera.position);
      const u = this.post.grade.uniforms;
      u.uTime.value = time;
      u.uBlur.value = this.quality.motionBlur && !rm ? clamp((camSpeed - 8) * 0.003, 0, 0.08) + energy * 0.012 : 0;
      u.uAberration.value = rm ? 0 : energy * 0.004;
      u.uFlash.value = this.fx ? this.fx.flash : 0;
      this.post.bloom.strength = 0.55 + (this.fx ? this.fx.flash : 0) * 1.2 + energy * 0.12;
    }
  }

  dispose() {
    this.disposed = true;
    this.ready = false;
    this.renderer.setAnimationLoop(null);
    const mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
    });
    mats.forEach((m) => {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    });
    this.mats?.textures.forEach((t) => t.dispose());
    this.envRT?.dispose();
    this.fx?.dispose();
    this.post?.dispose();
    this.renderer.dispose();
  }
}
