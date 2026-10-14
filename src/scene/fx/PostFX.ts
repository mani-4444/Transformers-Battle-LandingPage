import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from '../quality';

/**
 * Cinematic grade in linear HDR, before tone mapping: restrained radial motion blur
 * (driven by action speed), impact chromatic aberration and flash, vignette, grain.
 */
const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uBlur: { value: 0 },
    uAberration: { value: 0 },
    uFlash: { value: 0 },
    uVignette: { value: 1.15 },
    uGrain: { value: 0.035 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uBlur, uAberration, uFlash, uVignette, uGrain;
    varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 3.7) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      vec3 col;
      if (uBlur > 0.001) {
        col = vec3(0.0);
        float tot = 0.0;
        for (int i = 0; i < 8; i++) {
          float s = 1.0 - uBlur * float(i) / 8.0 * length(c) * 1.6;
          float w = 1.0 - float(i) / 9.0;
          col += texture2D(tDiffuse, 0.5 + c * s).rgb * w;
          tot += w;
        }
        col /= tot;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      if (uAberration > 0.0001) {
        vec2 off = c * uAberration;
        col.r = mix(col.r, texture2D(tDiffuse, vUv + off).r, 0.85);
        col.b = mix(col.b, texture2D(tDiffuse, vUv - off).b, 0.85);
      }
      col += vec3(1.0, 0.85, 0.7) * uFlash;
      float v = smoothstep(0.95, 0.25, length(c * vec2(1.0, 0.85)) * uVignette);
      col *= mix(0.35, 1.0, v);
      col += (rnd(vUv * 731.0) - 0.5) * uGrain * (0.4 + col);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;
  private readonly target: THREE.WebGLRenderTarget;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: Quality) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality.tier === 'high' ? 4 : 2,
    });
    this.composer = new EffectComposer(renderer, this.target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.5, 1.6);
    this.bloom.enabled = quality.bloom;
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(CinematicShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number, dpr: number) {
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
  }

  dispose() {
    this.composer.passes.forEach((p) => (p as unknown as { dispose?: () => void }).dispose?.());
    this.composer.dispose();
    this.target.dispose();
  }
}
