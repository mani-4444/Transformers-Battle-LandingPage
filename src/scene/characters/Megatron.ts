import * as THREE from 'three';
import type { Materials } from '../materials';
import { Transformer } from '../rig/Transformer';
import type { MechPart } from '../rig/MechPart';
import { add, bakeStatic, cyl, cylX, cylZ, mesh, mx, piston, prism, prismX, rbox, sphere, vents } from '../geometry/kit';
import { easeInOutQuint, easeOutBack } from '../timeline';

/**
 * Tank tread loop stretched between two sliding sprocket housings. Pads travel
 * around a stadium path; their offset is driven by distance travelled, and the loop
 * length follows the housings, so the tread visibly telescopes while transforming.
 */
export class TreadUnit {
  readonly pads: THREE.InstancedMesh;
  private readonly count: number;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly e = new THREE.Euler();

  constructor(
    private readonly a: MechPart,
    private readonly b: MechPart,
    private readonly radius: number,
    width: number,
    mat: THREE.Material,
    count = 38,
  ) {
    this.count = count;
    this.pads = new THREE.InstancedMesh(rbox(width, 0.16, 0.09, 0.02), mat, count);
    this.pads.castShadow = true;
    this.pads.receiveShadow = true;
    this.pads.frustumCulled = false;
  }

  update(distance: number) {
    const yA = this.a.position.y;
    const yB = this.b.position.y;
    const R = this.radius;
    const straight = Math.max(yA - yB, 0.001);
    const perim = 2 * straight + 2 * Math.PI * R;
    const step = perim / this.count;
    const off = ((distance % perim) + perim) % perim;
    for (let i = 0; i < this.count; i++) {
      let d = (i * step + off) % perim;
      let y: number;
      let z: number;
      let ang: number;
      if (d < straight) {
        y = yA - d;
        z = R;
        ang = 0;
      } else if ((d -= straight) < Math.PI * R) {
        ang = d / R;
        y = yB - R * Math.sin(ang);
        z = R * Math.cos(ang);
      } else if ((d -= Math.PI * R) < straight) {
        y = yB + d;
        z = -R;
        ang = Math.PI;
      } else {
        d -= straight;
        ang = Math.PI + d / R;
        y = yA - R * Math.sin(ang);
        z = R * Math.cos(ang);
      }
      this.p.set(0, y, z);
      this.q.setFromEuler(this.e.set(ang, 0, 0));
      this.m.compose(this.p, this.q, this.s);
      this.pads.setMatrixAt(i, this.m);
    }
    this.pads.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Megatron — articulated robot ↔ Cybertronian assault tank.
 *
 * Robot faces +Z. In tank mode the torso pitches forward 90° so the back armour
 * becomes the hull deck, the head drops into the collar, the legs swing forward and
 * splay outward alongside the hull, the calf tread units slide out and telescope
 * into full-length tracks, the feet fold into front ploughs, both arms flip onto
 * the deck pointing forward with the fusion cannon on top as the main gun (its
 * inner barrel extends), fists retract and the pauldrons fold down as turret armour.
 */
export function buildMegatron(M: Materials) {
  const rig = new Transformer();
  rig.root.name = 'Megatron';
  const treads: TreadUnit[] = [];
  const sides = [1, -1] as const;
  const tag = (s: number) => (s > 0 ? 'L' : 'R');

  // ───────────────────────── Pelvis ─────────────────────────
  const pelvis = rig.part(rig.root, {
    name: 'pelvis',
    robot: { p: [0, 3.5, 0] },
    vehicle: { p: [0, 1.17, -1.55] },
    window: [0.28, 0.78],
    ease: easeInOutQuint,
  });
  add(
    pelvis,
    mesh(rbox(1.4, 0.6, 0.95), M.megDark, [0, 0.08, 0]),
    mesh(rbox(1.85, 0.26, 1.1, 0.05), M.megSilver, [0, 0.33, 0]),
    mesh(rbox(0.56, 0.16, 0.06), M.megTrim, [0, 0.33, 0.56]),
    mesh(prism([[-0.36, 0.26], [0.36, 0.26], [0.12, -0.36], [-0.12, -0.36]], 0.16), M.megSteel, [0, -0.12, 0.44]),
    mesh(rbox(0.28, 0.06, 0.04), M.megGlow, [0, 0.0, 0.53]),
  );
  for (const s of sides) {
    add(
      pelvis,
      mesh(prism([[-0.12, 0.35], [0.12, 0.35], [0.16, -0.38], [-0.08, -0.3]], 0.95), M.megSilver, mx(s, [0.86, 0.0, 0]), [0, 0, s * 0.12]),
      mesh(sphere(0.28), M.megDark, mx(s, [0.66, -0.12, 0])),
    );
  }

  // ───────────────────────── Legs ─────────────────────────
  for (const s of sides) {
    const t = tag(s);
    const hip = rig.part(pelvis, {
      name: `hip${t}`,
      robot: { p: mx(s, [0.68, -0.12, 0]), r: [0, 0, s * 0.06] },
      vehicle: { p: mx(s, [1.78, 0, 0]), r: [-Math.PI / 2, 0, 0] },
      via: mx(s, [0.35, 0.35, 0]),
      viaRot: [0, 0, s * 0.45],
      window: [0.3, 0.76],
      ease: easeInOutQuint,
    });
    add(
      hip,
      mesh(cylX(0.26, 0.74, 16), M.megDark),
      mesh(rbox(0.72, 1.3, 0.8, 0.06), M.megSteel, [0, -0.74, 0]),
      mesh(prism([[-0.3, 0.55], [0.3, 0.55], [0.36, -0.2], [0, -0.6], [-0.36, -0.2]], 0.12), M.megSilver, [0, -0.7, 0.44]),
      mesh(rbox(0.08, 1.05, 0.6), M.megDark, mx(s, [0.38, -0.72, 0])),
      mesh(rbox(0.06, 0.6, 0.04), M.megTrim, mx(s, [0.43, -0.72, 0.2])),
    );
    piston(hip, [0, -0.25, -0.44], [0, -1.2, -0.44], M.megDark, M.chrome, 0.07);

    const shin = rig.part(hip, { name: `shin${t}`, robot: { p: [0, -1.45, 0] } });
    add(
      shin,
      mesh(cylX(0.28, 0.86, 16), M.megDark),
      mesh(rbox(0.96, 1.78, 1.0, 0.08), M.megSilver, [0, -0.98, 0]),
      mesh(prism([[-0.32, 0.25], [0.32, 0.25], [0.0, -0.45]], 0.3), M.megSilver, [0, -0.15, 0.56]),
      mesh(prism([[-0.34, 0.6], [0.34, 0.6], [0.28, -0.6], [-0.28, -0.6]], 0.1), M.megSteel, [0, -1.0, 0.53]),
      mesh(rbox(0.1, 1.2, 0.04), M.megTrim, [0, -1.0, 0.6]),
      mesh(rbox(0.06, 0.4, 0.04), M.megGlow, [0, -1.48, 0.6]),
      mesh(rbox(0.08, 1.3, 0.78), M.megDark, mx(s, [0.5, -0.98, 0])),
    );

    // Tread unit: tucked against the calf, slides out and telescopes into a full track.
    const pod = rig.part(shin, {
      name: `tread${t}`,
      robot: { p: [0, -0.95, -0.66] },
      vehicle: { p: [0, -0.58, -0.82] },
      via: [0, 0, -0.35],
      window: [0.48, 0.84],
    });
    const housing = (name: string, robotY: number, vehY: number) => {
      const h = rig.part(pod, {
        name,
        robot: { p: [0, robotY, 0] },
        vehicle: { p: [0, vehY, 0] },
        window: [0.55, 0.9],
        ease: easeOutBack,
      });
      add(
        h,
        mesh(cylX(0.27, 0.66, 18), M.megDark),
        mesh(cylX(0.12, 0.74, 10), M.megSilver),
        mesh(rbox(0.06, 0.62, 0.62, 0.03), M.megSteel, [0.36, 0, 0]),
        mesh(rbox(0.06, 0.62, 0.62, 0.03), M.megSteel, [-0.36, 0, 0]),
      );
      return h;
    };
    const ha = housing(`treadA${t}`, 0.48, 1.95);
    const hb = housing(`treadB${t}`, -0.48, -1.0);
    // Road wheels on a frame that stretches with the housings.
    const frame = rig.part(pod, {
      name: `treadFrame${t}`,
      robot: { p: [0, 0, 0], s: [1, 0.55, 1] },
      vehicle: { p: [0, 0.48, 0], s: [1, 1.55, 1] },
      window: [0.55, 0.9],
    });
    add(frame, mesh(rbox(0.5, 1.7, 0.36, 0.05), M.megDark), mesh(rbox(0.7, 1.7, 0.08), M.megSteel, [0, 0, 0.12]));
    for (let i = 0; i < 4; i++) frame.add(mesh(cylX(0.16, 0.6, 12), M.megSteel, [0, -0.6 + i * 0.4, -0.1]));
    const tread = new TreadUnit(ha, hb, 0.33, 0.66, M.treadPad);
    pod.add(tread.pads);
    treads.push(tread);

    // Track guards: armour plates that separate and re-lock over the tread.
    const guard = rig.part(shin, {
      name: `guard${t}`,
      robot: { p: mx(s, [0.52, -0.98, 0]) },
      vehicle: { p: mx(s, [0.5, -0.6, -0.55]), s: [1, 1.6, 1] },
      via: mx(s, [0.5, 0, 0]),
      window: [0.58, 0.92],
    });
    add(guard, mesh(rbox(0.07, 1.4, 0.7, 0.03), M.megSilver), mesh(rbox(0.04, 0.9, 0.06), M.megGlow, mx(s, [0.04, 0, 0.2])));

    const foot = rig.part(shin, {
      name: `foot${t}`,
      robot: { p: [0, -1.86, 0.1] },
      vehicle: { p: [0, -1.94, -0.12], r: [Math.PI / 2, 0, 0] },
      via: [0, -0.15, 0.25],
      window: [0.44, 0.76],
    });
    add(
      foot,
      mesh(rbox(0.96, 0.4, 0.82, 0.07), M.megSteel, [0, -0.2, 0]),
      mesh(prism([[-0.12, 0], [0.12, 0], [0, 0.42]], 0.3), M.megSilver, [-0.3, -0.25, 0.5], [Math.PI / 2, 0, 0]),
      mesh(prism([[-0.12, 0], [0.12, 0], [0, 0.48]], 0.3), M.megSilver, [0, -0.25, 0.5], [Math.PI / 2, 0, 0]),
      mesh(prism([[-0.12, 0], [0.12, 0], [0, 0.42]], 0.3), M.megSilver, [0.3, -0.25, 0.5], [Math.PI / 2, 0, 0]),
      mesh(prism([[-0.15, 0], [0.15, 0], [0, 0.3]], 0.25), M.megSilver, [0, -0.25, -0.48], [-Math.PI / 2, 0, 0]),
    );
  }

  // ───────────────────────── Torso / hull ─────────────────────────
  const torso = rig.part(pelvis, {
    name: 'torso',
    robot: { p: [0, 0.42, 0] },
    vehicle: { p: [0, 0.08, 0.25], r: [Math.PI / 2, 0, 0] },
    via: [0, 0.7, 0.3],
    window: [0.32, 0.82],
    ease: easeInOutQuint,
  });
  for (let i = 0; i < 4; i++) {
    torso.add(mesh(rbox(1.42 - i * 0.04, 0.2, 1.02, 0.04), i % 2 ? M.megSteel : M.megDark, [0, 0.13 + i * 0.22, 0]));
  }
  add(
    torso,
    mesh(rbox(2.4, 1.38, 1.5, 0.1), M.megSilver, [0, 1.72, 0]),
    mesh(prism([[-0.55, 0.42], [0.55, 0.5], [0.5, -0.4], [-0.4, -0.5]], 0.14), M.megSilver, [0.58, 1.78, 0.77], [0, 0.16, 0]),
    mesh(prism([[-0.55, 0.5], [0.55, 0.42], [0.4, -0.5], [-0.5, -0.4]], 0.14), M.megSilver, [-0.58, 1.78, 0.77], [0, -0.16, 0]),
    mesh(rbox(0.26, 1.0, 0.18), M.megDark, [0, 1.75, 0.78]),
    // V-shaped upper chest armour.
    mesh(prism([[-0.05, 0.2], [1.05, 0.2], [1.1, 0.05], [0.0, -0.32]], 0.16), M.megSteel, [0.12, 2.25, 0.74]),
    mesh(prism([[0.05, 0.2], [-1.05, 0.2], [-1.1, 0.05], [0.0, -0.32]], 0.16), M.megSteel, [-0.12, 2.25, 0.74]),
    mesh(rbox(0.07, 0.75, 0.05), M.megGlow, [0, 1.75, 0.88]),
    mesh(rbox(0.12, 1.05, 1.15), M.megDark, [1.22, 1.72, 0]),
    mesh(rbox(0.12, 1.05, 1.15), M.megDark, [-1.22, 1.72, 0]),
    // Collar ring (head opening).
    mesh(rbox(1.5, 0.3, 0.32), M.megSteel, [0, 2.5, 0.45]),
    mesh(rbox(1.5, 0.3, 0.32), M.megSteel, [0, 2.5, -0.5]),
    mesh(rbox(0.3, 0.3, 0.7), M.megSteel, [0.6, 2.5, 0]),
    mesh(rbox(0.3, 0.3, 0.7), M.megSteel, [-0.6, 2.5, 0]),
    // Back / hull deck.
    mesh(rbox(2.2, 1.2, 0.18, 0.05), M.megSteel, [0, 1.62, -0.82]),
    mesh(cylZ(0.5, 0.3, 24, 0.68), M.megSilver, [0, 1.15, -0.98]),
    mesh(cylZ(0.2, 0.32, 14), M.megDark, [0, 1.15, -1.08]),
    mesh(rbox(1.6, 0.4, 0.18), M.megDark, [0, 0.55, -0.62]),
  );
  vents(torso, M.megDark, [0.7, 2.0, -0.92], 0.5, 0.45, 4, [0, Math.PI, 0]);
  vents(torso, M.megDark, [-0.7, 2.0, -0.92], 0.5, 0.45, 4, [0, Math.PI, 0]);
  for (const s of sides) torso.add(mesh(cyl(0.1, 0.12, 0.7, 12), M.megDark, mx(s, [0.95, 0.7, -0.75])));
  rig.marker(torso, 'chest', [0, 1.7, 0.85]);

  const head = rig.part(torso, {
    name: 'head',
    robot: { p: [0, 2.6, 0.02], s: 1.15 },
    vehicle: { p: [0, 1.55, -0.05], s: 1.15 },
    via: [0, 0.15, 0],
    window: [0.02, 0.26],
  });
  add(
    head,
    mesh(cyl(0.18, 0.22, 0.32, 14), M.megDark, [0, 0.12, 0]),
    // Bucket helmet: flared at the jaw, with a raised central crest.
    mesh(prism([[-0.3, 0.3], [0.3, 0.3], [0.4, -0.3], [-0.4, -0.3]], 0.72, 0.04), M.megSilver, [0, 0.55, -0.04]),
    mesh(prismX([[-0.4, 0], [0.38, 0], [0.32, 0.2], [-0.2, 0.3]], 0.16, 0.02), M.megSilver, [0, 0.83, -0.02]),
    mesh(rbox(0.06, 0.34, 0.5, 0.02), M.megSteel, [0.42, 0.42, -0.04]),
    mesh(rbox(0.06, 0.34, 0.5, 0.02), M.megSteel, [-0.42, 0.42, -0.04]),
    mesh(rbox(0.44, 0.34, 0.1, 0.03), M.megDark, [0, 0.46, 0.3]),
    mesh(rbox(0.13, 0.05, 0.04, 0.01), M.megGlow, [0.1, 0.52, 0.36], [0, 0, -0.28]),
    mesh(rbox(0.13, 0.05, 0.04, 0.01), M.megGlow, [-0.1, 0.52, 0.36], [0, 0, 0.28]),
    mesh(prism([[-0.16, 0.08], [0.16, 0.08], [0.08, -0.12], [-0.08, -0.12]], 0.08), M.megSteel, [0, 0.33, 0.33]),
    mesh(prism([[0, 0.3], [0.1, -0.2], [-0.1, -0.2]], 0.08), M.megSilver, [0.38, 0.62, 0], [0, 0, -0.3]),
    mesh(prism([[0, 0.3], [0.1, -0.2], [-0.1, -0.2]], 0.08), M.megSilver, [-0.38, 0.62, 0], [0, 0, 0.3]),
  );
  rig.marker(head, 'eyes', [0, 0.52, 0.38]);

  // ───────────────────────── Arms ─────────────────────────
  for (const s of sides) {
    const t = tag(s);
    const pauldron = rig.part(torso, {
      name: `pauldron${t}`,
      robot: { p: mx(s, [1.62, 2.3, 0]), r: [0, 0, s * -0.12] },
      vehicle: { p: mx(s, [1.12, 0.95, -1.0]), r: [-Math.PI / 2, 0, s * 0.2] },
      via: mx(s, [0.7, 0.4, -0.3]),
      window: [0.38, 0.86],
    });
    add(
      pauldron,
      mesh(prism([[-0.5, -0.28], [0.52, -0.22], [0.6, 0.22], [0.1, 0.48], [-0.5, 0.36]], 1.0, 0.05), M.megSilver, mx(s, [0.05, 0, 0]), [0, s < 0 ? Math.PI : 0, 0]),
      mesh(rbox(0.9, 0.08, 0.9), M.megTrim, [0, -0.28, 0]),
      mesh(prism([[0, 0.45], [0.12, 0], [-0.12, 0]], 0.18), M.megSteel, mx(s, [0.25, 0.42, 0])),
    );

    const shoulder = rig.part(torso, {
      name: `shoulder${t}`,
      robot: { p: mx(s, [1.62, 2.05, 0]) },
      vehicle: { p: mx(s, [0.56, 0.5, -1.15]), r: [Math.PI, 0, 0] },
      via: mx(s, [0.6, 0.3, -0.6]),
      window: [0.22, 0.7],
    });
    add(shoulder, mesh(sphere(0.27), M.megDark));

    const upper = rig.part(shoulder, {
      name: `upperArm${t}`,
      robot: { p: [0, -0.14, 0], r: [0, 0, s * 0.13] },
      vehicle: { p: [0, -0.14, 0] },
      viaRot: [0, 0, s * 1.0],
      window: [0.22, 0.64],
    });
    add(
      upper,
      mesh(rbox(0.56, 1.02, 0.6, 0.06), M.megSteel, [0, -0.56, 0]),
      mesh(rbox(0.62, 0.36, 0.64, 0.06), M.megSilver, [0, -0.2, 0]),
      mesh(cylX(0.22, 0.56, 16), M.megDark, [0, -1.1, 0]),
    );

    const fore = rig.part(upper, {
      name: `forearm${t}`,
      robot: { p: [0, -1.12, 0], r: [-0.26, 0, 0] },
      vehicle: { p: [0, -1.12, 0] },
      window: [0.24, 0.56],
    });
    add(
      fore,
      mesh(rbox(0.72, 1.18, 0.76, 0.08), M.megSilver, [0, -0.62, 0]),
      mesh(prism([[0, 0.25], [0.3, -0.2], [-0.3, -0.2]], 0.5), M.megSteel, [0, -0.05, -0.38], [Math.PI / 2, 0, 0]),
      mesh(rbox(0.06, 0.8, 0.05), M.megTrim, mx(s, [0.37, -0.62, 0.2])),
      mesh(cyl(0.27, 0.27, 0.14, 16), M.megDark, [0, -1.2, 0]),
    );

    if (s < 0) {
      // Fusion cannon on the right forearm (barrel runs down the arm, extends in tank mode).
      const cannon = rig.part(fore, {
        name: 'cannon',
        robot: { p: [-0.12, -0.25, 0.56] },
        vehicle: { p: [0, -0.15, 0.55] },
        window: [0.5, 0.8],
      });
      add(
        cannon,
        mesh(rbox(0.5, 0.5, 0.36, 0.06), M.megDark, [0, 0, 0]),
        mesh(cyl(0.3, 0.32, 1.05, 22), M.megDark, [0, -0.6, 0.06]),
        mesh(cyl(0.34, 0.34, 0.12, 22), M.megSilver, [0, -0.3, 0.06]),
        mesh(cyl(0.34, 0.34, 0.12, 22), M.megSilver, [0, -0.85, 0.06]),
      );
      piston(cannon, [0.24, 0.05, 0.0], [0.24, -0.8, 0.0], M.megSteel, M.chrome, 0.05);
      const barrel = rig.part(cannon, {
        name: 'barrel',
        robot: { p: [0, -0.95, 0.06] },
        vehicle: { p: [0, -1.75, 0.06] },
        window: [0.62, 0.92],
        ease: easeOutBack,
      });
      add(
        barrel,
        mesh(cyl(0.22, 0.22, 0.9, 20), M.megSteel, [0, 0, 0]),
        mesh(cyl(0.27, 0.24, 0.16, 20), M.megSilver, [0, -0.45, 0]),
        mesh(cyl(0.19, 0.19, 0.04, 20), M.cannonGlow, [0, -0.54, 0]),
      );
      rig.marker(barrel, 'muzzle', [0, -0.62, 0]);
    } else {
      add(fore, mesh(prism([[0, 0.5], [0.12, -0.3], [-0.12, -0.3]], 0.1), M.megSilver, [0.4, -0.7, 0], [0, 0, -0.15]));
    }

    const fist = rig.part(fore, {
      name: `fist${t}`,
      robot: { p: [0, -1.33, 0.02] },
      vehicle: { p: [0, -0.8, 0], s: 0.6 },
      window: [0.1, 0.38],
    });
    add(
      fist,
      mesh(rbox(0.52, 0.5, 0.56, 0.08), M.megDark, [0, -0.2, 0]),
      mesh(rbox(0.14, 0.2, 0.3, 0.04), M.megSteel, mx(s, [-0.28, -0.15, 0.1])),
    );
    for (let i = 0; i < 4; i++) {
      fist.add(mesh(prism([[-0.05, 0], [0.05, 0], [0, -0.2]], 0.12), M.megSilver, [-0.18 + i * 0.12, -0.42, 0.2]));
    }
    rig.marker(fist, `fist${t}`, [0, -0.25, 0.15]);
  }

  bakeStatic(rig.root);
  rig.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  return { rig, treads };
}
