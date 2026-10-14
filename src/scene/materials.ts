import * as THREE from 'three';
import { hash } from './timeline';

/**
 * Procedural PBR materials. Every map (panel lines, rivets, scratches, tyre tread,
 * terrain plating) is generated on a canvas at start-up, so the scene ships no
 * texture files.
 */

type Draw = (ctx: CanvasRenderingContext2D, size: number, rnd: () => number) => void;

function rng(seed: number) {
  let s = seed;
  return () => {
    s += 1;
    return hash(s * 13.37 + seed);
  };
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function heightToNormal(src: HTMLCanvasElement, strength: number) {
  const size = src.width;
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  const h = sctx.getImageData(0, 0, size, size).data;
  const out = canvas(size);
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(size, size);
  const d = img.data;
  const at = (x: number, y: number) => h[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      d[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      d[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function tex(c: HTMLCanvasElement, repeat: number, color = false) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function paint(size: number, seed: number, fill: string, draw: Draw) {
  const c = canvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);
  draw(ctx, size, rng(seed));
  return c;
}

/** Recursive panel subdivision → list of rectangles. */
function panels(rnd: () => number, x: number, y: number, w: number, h: number, depth: number, out: number[][]) {
  if (depth <= 0 || (w < 90 && h < 90) || (depth < 3 && rnd() < 0.25)) {
    out.push([x, y, w, h]);
    return;
  }
  if (w > h) {
    const s = Math.round(w * (0.3 + rnd() * 0.4));
    panels(rnd, x, y, s, h, depth - 1, out);
    panels(rnd, x + s, y, w - s, h, depth - 1, out);
  } else {
    const s = Math.round(h * (0.3 + rnd() * 0.4));
    panels(rnd, x, y, w, s, depth - 1, out);
    panels(rnd, x, y + s, w, h - s, depth - 1, out);
  }
}

function armorMaps(seed: number) {
  const size = 512;
  const rects: number[][] = [];
  panels(rng(seed), 0, 0, size, size, 3, rects);

  const height = paint(size, seed, 'rgb(128,128,128)', (ctx, _s, rnd) => {
    for (const [x, y, w, h] of rects) {
      // Slight per-panel elevation.
      const v = 120 + Math.floor(rnd() * 20);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      ctx.strokeStyle = 'rgb(30,30,30)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      // Rivets on panel corners.
      if (w > 60 && h > 60) {
        ctx.fillStyle = 'rgb(200,200,200)';
        for (const [rx, ry] of [
          [x + 9, y + 9],
          [x + w - 9, y + 9],
          [x + 9, y + h - 9],
          [x + w - 9, y + h - 9],
        ]) {
          ctx.beginPath();
          ctx.arc(rx, ry, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Occasional vent slots.
      if (rnd() < 0.18 && w > 80 && h > 60) {
        ctx.fillStyle = 'rgb(40,40,40)';
        const n = 4 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) ctx.fillRect(x + 14, y + 14 + i * 9, w * 0.45, 4);
      }
    }
  });

  const rough = paint(size, seed + 7, 'rgb(150,150,150)', (ctx, s, rnd) => {
    // Grime blotches.
    for (let i = 0; i < 70; i++) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      const v = 150 + Math.floor((rnd() - 0.4) * 90);
      g.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.save();
      ctx.translate(rnd() * s, rnd() * s);
      ctx.scale(20 + rnd() * 70, 20 + rnd() * 70);
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
    // Scratches: polished (darker = smoother) streaks.
    ctx.lineCap = 'round';
    for (let i = 0; i < 160; i++) {
      const v = rnd() < 0.6 ? 70 : 215;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.35 + rnd() * 0.4})`;
      ctx.lineWidth = 0.6 + rnd() * 1.1;
      const x = rnd() * s;
      const y = rnd() * s;
      const a = rnd() * Math.PI;
      const l = 8 + rnd() * 50;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    // Seams collect grime.
    ctx.strokeStyle = 'rgba(230,230,230,0.6)';
    ctx.lineWidth = 4;
    for (const [x, y, w, h] of rects) ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  });

  return { normal: heightToNormal(height, 3), rough };
}

function treadMaps() {
  const size = 256;
  const height = paint(size, 3, 'rgb(150,150,150)', (ctx, s) => {
    ctx.fillStyle = 'rgb(40,40,40)';
    const n = 16;
    for (let i = 0; i < n; i++) {
      const y = (i / n) * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s * 0.5, y + s / n / 2);
      ctx.lineTo(s, y);
      ctx.lineTo(s, y + 6);
      ctx.lineTo(s * 0.5, y + s / n / 2 + 6);
      ctx.lineTo(0, y + 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(s * 0.48, 0, s * 0.04, s);
  });
  return heightToNormal(height, 8);
}

function terrainMaps() {
  const size = 1024;
  const rects: number[][] = [];
  panels(rng(91), 0, 0, size, size, 6, rects);
  const color = paint(size, 11, '#1b1e23', (ctx, s, rnd) => {
    for (const [x, y, w, h] of rects) {
      const v = 22 + Math.floor(rnd() * 16);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    }
    // Scorch and oil stains.
    for (let i = 0; i < 60; i++) {
      const r = 20 + rnd() * 120;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, `rgba(5,4,4,${0.4 + rnd() * 0.4})`);
      g.addColorStop(1, 'rgba(5,4,4,0)');
      ctx.save();
      ctx.translate(rnd() * s, rnd() * s);
      ctx.fillStyle = g;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 3;
    for (const [x, y, w, h] of rects) ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  });

  const cracks: number[][][] = [];
  const crk = rng(77);
  for (let i = 0; i < 26; i++) {
    const pts: number[][] = [];
    let x = crk() * size;
    let y = crk() * size;
    let a = crk() * Math.PI * 2;
    for (let j = 0; j < 14; j++) {
      pts.push([x, y]);
      a += (crk() - 0.5) * 1.1;
      const l = 12 + crk() * 30;
      x += Math.cos(a) * l;
      y += Math.sin(a) * l;
    }
    cracks.push(pts);
  }
  const drawCracks = (ctx: CanvasRenderingContext2D, style: string, width: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    for (const pts of cracks) {
      ctx.beginPath();
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  };
  const colorCtx = color.getContext('2d')!;
  drawCracks(colorCtx, '#050505', 5);

  const emissive = paint(size, 5, '#000', (ctx) => {
    ctx.shadowColor = '#ff6a1a';
    ctx.shadowBlur = 10;
    drawCracks(ctx, '#ff7a24', 1.6);
  });

  const height = paint(size, 12, 'rgb(140,140,140)', (ctx) => {
    ctx.strokeStyle = 'rgb(30,30,30)';
    ctx.lineWidth = 4;
    for (const [x, y, w, h] of rects) ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    drawCracks(ctx, 'rgb(0,0,0)', 5);
  });
  const rough = paint(size, 19, 'rgb(190,190,190)', (ctx, s, rnd) => {
    for (let i = 0; i < 90; i++) {
      const r = 20 + rnd() * 90;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(70,70,70,0.55)');
      g.addColorStop(1, 'rgba(70,70,70,0)');
      ctx.save();
      ctx.translate(rnd() * s, rnd() * s);
      ctx.fillStyle = g;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
  });
  return { color, emissive, normal: heightToNormal(height, 4), rough };
}

export function spriteTexture(kind: 'soft' | 'spark' | 'smoke') {
  const size = 128;
  const c = canvas(size);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (kind === 'spark') {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.15, 'rgba(255,240,200,0.9)');
    g.addColorStop(0.45, 'rgba(255,160,60,0.25)');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else if (kind === 'soft') {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else {
    const r = rng(4);
    for (let i = 0; i < 14; i++) {
      const x = size / 2 + (r() - 0.5) * size * 0.4;
      const y = size / 2 + (r() - 0.5) * size * 0.4;
      const rad = size * (0.18 + r() * 0.22);
      const gg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      gg.addColorStop(0, 'rgba(255,255,255,0.22)');
      gg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(0, 0, size, size);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Materials {
  optRed: THREE.MeshPhysicalMaterial;
  optBlue: THREE.MeshPhysicalMaterial;
  optSilver: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  gunmetal: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  optGlow: THREE.MeshStandardMaterial;
  headlight: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  taillight: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  megSilver: THREE.MeshStandardMaterial;
  megSteel: THREE.MeshStandardMaterial;
  megDark: THREE.MeshStandardMaterial;
  megTrim: THREE.MeshPhysicalMaterial;
  megGlow: THREE.MeshStandardMaterial;
  cannonGlow: THREE.MeshStandardMaterial;
  treadPad: THREE.MeshStandardMaterial;
  terrain: THREE.MeshStandardMaterial;
  ruin: THREE.MeshStandardMaterial;
  ruinDark: THREE.MeshStandardMaterial;
  ruinGlow: THREE.MeshStandardMaterial;
  debris: THREE.MeshStandardMaterial;
  textures: THREE.Texture[];
}

export function createMaterials(): Materials {
  const textures: THREE.Texture[] = [];
  const keep = <T extends THREE.Texture>(t: T) => (textures.push(t), t);

  const armorA = armorMaps(21);
  const armorB = armorMaps(57);
  const nA = keep(tex(armorA.normal, 1));
  const rA = keep(tex(armorA.rough, 1));
  const nB = keep(tex(armorB.normal, 1));
  const rB = keep(tex(armorB.rough, 1));
  const tread = keep(tex(treadMaps(), 1));
  tread.repeat.set(1, 6);
  const terr = terrainMaps();
  const tColor = keep(tex(terr.color, 14, true));
  const tEmissive = keep(tex(terr.emissive, 14, true));
  const tNormal = keep(tex(terr.normal, 14));
  const tRough = keep(tex(terr.rough, 14));
  const ruinN = keep(tex(armorB.normal, 3));
  const ruinR = keep(tex(armorB.rough, 3));

  const carPaint = (color: string, normalMap: THREE.Texture, roughnessMap: THREE.Texture) =>
    new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.55,
      roughness: 0.42,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.3, 0.3),
      clearcoat: 0.7,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.1,
    });
  const metal = (color: string, metalness: number, roughness: number, n?: THREE.Texture, r?: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      normalMap: n ?? null,
      roughnessMap: r ?? null,
      normalScale: new THREE.Vector2(0.3, 0.3),
      envMapIntensity: 1.0,
    });
  const glow = (color: string, intensity: number) =>
    new THREE.MeshStandardMaterial({ color: '#050505', emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });

  return {
    optRed: carPaint('#b0121a', nA, rA),
    optBlue: carPaint('#173c9c', nB, rB),
    optSilver: metal('#a9b0b8', 0.9, 0.4, nA, rA),
    chrome: metal('#c9d0d8', 1, 0.2),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#0b1a2c',
      metalness: 0.3,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.8,
    }),
    gunmetal: metal('#3a4048', 0.85, 0.42, nB, rB),
    darkMetal: metal('#1c1f24', 0.8, 0.55, nA, rA),
    optGlow: glow('#3db8ff', 4),
    headlight: glow('#fff3d6', 3.2),
    amber: glow('#ff9a1f', 2.2),
    taillight: glow('#ff1f1f', 2.4),
    tire: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.88, metalness: 0.05, normalMap: tread }),
    megSilver: metal('#9da5ae', 0.9, 0.4, nB, rB),
    megSteel: metal('#5f666f', 0.9, 0.38, nA, rA),
    megDark: metal('#24272d', 0.85, 0.5, nB, rB),
    megTrim: new THREE.MeshPhysicalMaterial({
      color: '#4a0d14',
      metalness: 0.6,
      roughness: 0.35,
      clearcoat: 0.6,
      normalMap: nA,
      normalScale: new THREE.Vector2(0.5, 0.5),
    }),
    megGlow: glow('#ff2a12', 5),
    cannonGlow: glow('#ff4a2a', 2),
    treadPad: metal('#2b2e33', 0.85, 0.55),
    terrain: new THREE.MeshStandardMaterial({
      map: tColor,
      normalMap: tNormal,
      roughnessMap: tRough,
      emissiveMap: tEmissive,
      emissive: '#ffffff',
      emissiveIntensity: 1.4,
      metalness: 0.2,
      roughness: 1,
      envMapIntensity: 0.3,
    }),
    ruin: metal('#3b4049', 0.7, 0.62, ruinN, ruinR),
    ruinDark: metal('#1a1d22', 0.6, 0.75, ruinN, ruinR),
    ruinGlow: glow('#ff7a2a', 2.2),
    debris: metal('#4c525a', 0.85, 0.45),
    textures,
  };
}
