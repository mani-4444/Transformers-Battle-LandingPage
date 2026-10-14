import * as THREE from 'three';
import type { Materials } from '../materials';
import { Transformer } from '../rig/Transformer';
import { add, bakeStatic, box, cyl, cylX, cylZ, mesh, mx, piston, prism, rbox, sphere, vents, wheel } from '../geometry/kit';
import { easeInOutQuint, easeOutBack } from '../timeline';

/**
 * Optimus Prime — articulated robot ↔ cab-over semi truck.
 *
 * Robot faces +Z. In truck mode the torso stays upright and becomes the cab
 * (windows → windshield, abdominal grille → radiator grille), the legs swing 90° back
 * at the hips to form the chassis, calf wheels rotate out to the sides, hidden front
 * wheels flip down from the waist, the head sinks into the cab and a roof hatch
 * closes over it, arms fold into the sleeper sides, fists retract and fuel tanks swing
 * horizontal, the chassis beam telescopes out between the legs and the smokestacks
 * rotate upright.
 *
 * Side convention: s = +1 is the robot's left (+X), s = -1 its right (−X).
 */
export function buildOptimus(M: Materials) {
  const rig = new Transformer();
  rig.root.name = 'Optimus';
  const sides = [1, -1] as const;
  const tag = (s: number) => (s > 0 ? 'L' : 'R');

  // ───────────────────────── Pelvis ─────────────────────────
  const pelvis = rig.part(rig.root, {
    name: 'pelvis',
    robot: { p: [0, 3.55, 0] },
    vehicle: { p: [0, 0.95, 1.25] },
    window: [0.28, 0.78],
    ease: easeInOutQuint,
  });
  add(
    pelvis,
    mesh(rbox(1.3, 0.55, 0.9), M.gunmetal, [0, 0.1, 0]),
    mesh(rbox(1.75, 0.22, 1.05, 0.05), M.optSilver, [0, 0.33, 0]),
    mesh(prism([[-0.34, 0.24], [0.34, 0.24], [0.18, -0.3], [-0.18, -0.3]], 0.14), M.optSilver, [0, -0.12, 0.42]),
    mesh(rbox(0.36, 0.12, 0.04), M.optGlow, [0, -0.02, 0.5]),
    mesh(rbox(1.0, 0.4, 0.3), M.darkMetal, [0, -0.05, -0.38]),
  );
  for (const s of sides) {
    add(
      pelvis,
      mesh(rbox(0.18, 0.62, 0.92), M.optBlue, mx(s, [0.8, 0.02, 0])),
      mesh(sphere(0.27), M.darkMetal, mx(s, [0.6, -0.12, 0])),
    );
  }

  // Chassis beam: compressed inside the pelvis in robot mode, telescopes out
  // between the legs to form the truck frame and fifth-wheel plate.
  const chassis = rig.part(pelvis, {
    name: 'chassis',
    robot: { p: [0, -0.05, -0.05], s: [0.95, 0.95, 0.24] },
    vehicle: { p: [0, -0.02, -1.8], s: [1, 1, 1] },
    window: [0.6, 0.92],
  });
  add(
    chassis,
    mesh(rbox(0.62, 0.42, 3.1), M.gunmetal),
    mesh(cyl(0.48, 0.48, 0.08, 24), M.darkMetal, [0, 0.25, -0.9]),
    mesh(box(0.7, 0.08, 0.5), M.optSilver, [0, 0.25, -1.3]),
    mesh(cylZ(0.07, 2.6, 8), M.chrome, [0.22, -0.12, 0]),
    mesh(cylZ(0.07, 2.6, 8), M.chrome, [-0.22, -0.12, 0]),
  );

  // ───────────────────────── Legs ─────────────────────────
  for (const s of sides) {
    const hip = rig.part(pelvis, {
      name: `hip${tag(s)}`,
      robot: { p: mx(s, [0.62, -0.12, 0]), r: [0, 0, s * 0.04] },
      vehicle: { p: mx(s, [0.55, 0, 0]), r: [Math.PI / 2, 0, 0] },
      viaRot: [0, 0, s * 0.32],
      window: [0.3, 0.76],
      ease: easeInOutQuint,
    });
    add(
      hip,
      mesh(rbox(0.62, 1.32, 0.72, 0.07), M.optSilver, [0, -0.74, 0]),
      mesh(prism([[-0.28, 0.5], [0.28, 0.5], [0.24, -0.5], [-0.24, -0.5]], 0.1), M.optSilver, [0, -0.72, 0.38]),
      mesh(rbox(0.08, 1.0, 0.56), M.gunmetal, mx(s, [0.33, -0.72, 0])),
      mesh(cylX(0.24, 0.7, 16), M.darkMetal, [0, -0.06, 0]),
    );
    piston(hip, [0, -0.25, -0.4], [0, -1.25, -0.4], M.darkMetal, M.chrome, 0.07);

    const shin = rig.part(hip, { name: `shin${tag(s)}`, robot: { p: [0, -1.45, 0] } });
    add(
      shin,
      mesh(cylX(0.27, 0.8, 18), M.darkMetal),
      mesh(rbox(0.9, 1.72, 0.96, 0.09), M.optBlue, [0, -0.96, 0]),
      mesh(rbox(0.66, 0.46, 0.24, 0.07), M.optBlue, [0, -0.08, 0.42], [-0.22, 0, 0]),
      mesh(rbox(0.7, 0.95, 0.12, 0.04), M.optBlue, [0, -0.92, 0.51]),
      mesh(rbox(0.72, 1.35, 0.14, 0.04), M.gunmetal, [0, -0.95, -0.5]),
      mesh(rbox(0.08, 1.15, 0.7, 0.03), M.optSilver, mx(s, [0.46, -0.95, 0])),
      mesh(rbox(0.3, 0.08, 0.04), M.optGlow, [0, -0.45, 0.58]),
    );
    vents(shin, M.optSilver, [0, -1.48, 0.55], 0.5, 0.34, 4);

    // Calf wheels: flat against the calf in robot mode, rotate out to the sides.
    for (const [i, y] of [
      [1, -0.55],
      [2, -1.35],
    ] as const) {
      const w = rig.part(shin, {
        name: `wheel${tag(s)}${i}`,
        robot: { p: mx(s, [0.22, y, -0.66]), r: [0, Math.PI / 2, 0] },
        vehicle: { p: mx(s, [0.66, y, 0.35]) },
        via: mx(s, [0.5, 0, -0.35]),
        window: [0.48 + i * 0.04, 0.84 + i * 0.03],
        ease: easeOutBack,
      });
      const spin = wheel(0.58, 0.38, M.tire, M.chrome, M.darkMetal, s);
      w.add(spin);
      rig.spinners.push({ node: spin, radius: 0.58, sign: 1 });
    }

    const foot = rig.part(shin, {
      name: `foot${tag(s)}`,
      robot: { p: [0, -1.82, 0.08] },
      vehicle: { p: [0, -1.78, -0.12], r: [Math.PI / 2, 0, 0] },
      via: [0, -0.1, 0.35],
      window: [0.4, 0.72],
    });
    add(
      foot,
      mesh(rbox(0.82, 0.38, 0.78, 0.07), M.optSilver, [0, -0.19, -0.04]),
      mesh(prism([[-0.4, 0.0], [0.4, 0.0], [0.34, -0.3], [-0.34, -0.3]], 0.62), M.optSilver, [0, -0.06, 0.52], [Math.PI / 2, 0, 0]),
      mesh(rbox(0.86, 0.06, 1.25), M.darkMetal, [0, -0.36, 0.15]),
      // Tail lights on the toe face: dark while standing, face rearward once the foot folds.
      mesh(rbox(0.24, 0.1, 0.04), M.taillight, [s * 0.18, -0.2, 0.84]),
      mesh(rbox(0.12, 0.1, 0.04), M.amber, [s * -0.14, -0.2, 0.84]),
    );
  }

  // ───────────────────────── Torso / cab ─────────────────────────
  const torso = rig.part(pelvis, {
    name: 'torso',
    robot: { p: [0, 0.42, 0] },
    vehicle: { p: [0, 0.12, 0.55] },
    via: [0, 0.25, 0.15],
    window: [0.34, 0.8],
  });
  add(
    torso,
    mesh(rbox(1.55, 0.95, 1.05), M.gunmetal, [0, 0.47, -0.05]),
    mesh(rbox(1.48, 0.86, 0.1, 0.03), M.chrome, [0, 0.52, 0.5]),
    mesh(rbox(0.26, 0.92, 1.12), M.optRed, [0.9, 0.48, 0]),
    mesh(rbox(0.26, 0.92, 1.12), M.optRed, [-0.9, 0.48, 0]),
    mesh(rbox(2.5, 1.25, 1.35, 0.09), M.optRed, [0, 1.6, 0]),
    mesh(rbox(1.0, 0.68, 0.05, 0.02), M.glass, [0.57, 1.64, 0.68], [-0.05, 0, 0]),
    mesh(rbox(1.0, 0.68, 0.05, 0.02), M.glass, [-0.57, 1.64, 0.68], [-0.05, 0, 0]),
    mesh(rbox(2.36, 0.06, 0.07), M.chrome, [0, 2.01, 0.69]),
    mesh(rbox(2.36, 0.06, 0.07), M.chrome, [0, 1.28, 0.69]),
    mesh(rbox(0.12, 0.76, 0.1), M.optRed, [0, 1.64, 0.7]),
    mesh(rbox(0.05, 0.52, 0.62), M.glass, [1.26, 1.74, 0.16]),
    mesh(rbox(0.05, 0.52, 0.62), M.glass, [-1.26, 1.74, 0.16]),
    mesh(rbox(0.04, 1.05, 0.04), M.darkMetal, [1.27, 1.55, -0.2]),
    mesh(rbox(0.04, 1.05, 0.04), M.darkMetal, [-1.27, 1.55, -0.2]),
    // Roof: front + side sections leave a hatch-sized opening for the head.
    mesh(rbox(2.56, 0.18, 0.56, 0.05), M.optRed, [0, 2.3, 0.42]),
    mesh(rbox(0.86, 0.18, 0.86, 0.05), M.optRed, [0.85, 2.3, -0.28]),
    mesh(rbox(0.86, 0.18, 0.86, 0.05), M.optRed, [-0.85, 2.3, -0.28]),
    mesh(rbox(0.5, 0.06, 0.16), M.amber, [0, 2.42, 0.58]),
    mesh(rbox(2.3, 1.1, 0.12), M.optRed, [0, 1.6, -0.72]),
    mesh(rbox(1.2, 0.16, 0.1), M.optGlow, [0, 0.98, 0.62]),
  );
  for (let i = 0; i < 10; i++) {
    torso.add(mesh(cyl(0.032, 0.032, 0.76, 8), M.chrome, [-0.6 + (i * 1.2) / 9, 0.52, 0.57]));
  }
  vents(torso, M.darkMetal, [0.6, 1.5, -0.8], 0.6, 0.6, 5, [0, Math.PI, 0]);
  vents(torso, M.darkMetal, [-0.6, 1.5, -0.8], 0.6, 0.6, 5, [0, Math.PI, 0]);
  rig.marker(torso, 'cabFront', [0, 1.0, 0.8]);

  const hatch = rig.part(torso, {
    name: 'hatch',
    robot: { p: [0, 2.72, -0.66], r: [-Math.PI / 2, 0, 0] },
    vehicle: { p: [0, 2.3, -0.28] },
    via: [0, 0.3, 0],
    window: [0.24, 0.46],
  });
  add(hatch, mesh(rbox(0.86, 0.16, 0.86, 0.05), M.optRed), mesh(rbox(0.6, 0.04, 0.5), M.darkMetal, [0, 0.09, 0]));

  const bumper = rig.part(torso, {
    name: 'bumper',
    robot: { p: [0, 0.06, 0.5] },
    vehicle: { p: [0, -0.26, 0.74] },
    via: [0, -0.05, 0.25],
    window: [0.52, 0.82],
  });
  add(
    bumper,
    mesh(rbox(2.36, 0.3, 0.26, 0.06), M.chrome),
    mesh(rbox(0.36, 0.14, 0.05), M.headlight, [0.82, 0.03, 0.13]),
    mesh(rbox(0.36, 0.14, 0.05), M.headlight, [-0.82, 0.03, 0.13]),
    mesh(rbox(0.14, 0.1, 0.05), M.amber, [1.08, 0.03, 0.13]),
    mesh(rbox(0.14, 0.1, 0.05), M.amber, [-1.08, 0.03, 0.13]),
  );
  rig.marker(bumper, 'headlights', [0, 0.03, 0.4]);

  for (const s of sides) {
    // Front wheels: carried at the waist, flip down under the cab.
    const fw = rig.part(torso, {
      name: `frontWheel${tag(s)}`,
      robot: { p: mx(s, [1.04, 0.42, -0.22]), r: [0, Math.PI / 2, 0] },
      vehicle: { p: mx(s, [1.06, -0.5, 0.12]) },
      via: mx(s, [0.45, -0.2, 0.2]),
      window: [0.56, 0.9],
      ease: easeOutBack,
    });
    const spin = wheel(0.56, 0.36, M.tire, M.chrome, M.darkMetal, s);
    fw.add(spin);
    rig.spinners.push({ node: spin, radius: 0.56, sign: 1 });

    // Smokestacks: raked back behind the shoulders in robot mode; they swing out,
    // drop down the back corners and lock upright behind the cab as a truck.
    const stack = rig.part(torso, {
      name: `stack${tag(s)}`,
      robot: { p: mx(s, [0.78, 1.35, -0.84]), r: [-0.32, 0, s * -0.08] },
      vehicle: { p: mx(s, [1.05, 1.9, -0.74]) },
      via: mx(s, [0.45, 0.3, -0.35]),
      viaRot: [-0.9, 0, s * 0.5],
      window: [0.62, 0.96],
    });
    add(
      stack,
      mesh(cyl(0.18, 0.18, 0.22, 16), M.darkMetal, [0, 0.1, 0]),
      mesh(cyl(0.11, 0.13, 1.5, 16), M.chrome, [0, 0.85, 0]),
      mesh(cyl(0.14, 0.12, 0.12, 16), M.chrome, [0, 1.62, 0]),
    );
    rig.marker(stack, `exhaust${tag(s)}`, [0, 1.7, 0]);
  }

  // ───────────────────────── Head ─────────────────────────
  const head = rig.part(torso, {
    name: 'head',
    robot: { p: [0, 2.36, 0.05] },
    vehicle: { p: [0, 1.42, -0.22], r: [0, Math.PI, 0] },
    via: [0, 0.2, -0.1],
    window: [0.02, 0.27],
  });
  add(
    head,
    mesh(cyl(0.17, 0.2, 0.3, 14), M.gunmetal, [0, 0.12, 0]),
    mesh(rbox(0.66, 0.58, 0.62, 0.1), M.optBlue, [0, 0.54, -0.03]),
    mesh(rbox(0.44, 0.24, 0.1, 0.03), M.optSilver, [0, 0.6, 0.27]),
    mesh(prism([[-0.22, 0.12], [0.22, 0.12], [0.15, -0.13], [-0.15, -0.13]], 0.1), M.optSilver, [0, 0.38, 0.28]),
    mesh(rbox(0.34, 0.06, 0.04, 0.01), M.optGlow, [0, 0.64, 0.33]),
    mesh(rbox(0.14, 0.22, 0.56, 0.04), M.optSilver, [0, 0.87, 0.02]),
    mesh(rbox(0.06, 0.44, 0.1, 0.02), M.optBlue, [0.36, 0.88, -0.02]),
    mesh(rbox(0.06, 0.44, 0.1, 0.02), M.optBlue, [-0.36, 0.88, -0.02]),
    mesh(cylX(0.13, 0.1, 14), M.optSilver, [0.36, 0.55, 0]),
    mesh(cylX(0.13, 0.1, 14), M.optSilver, [-0.36, 0.55, 0]),
  );
  rig.marker(head, 'eyes', [0, 0.64, 0.36]);

  // ───────────────────────── Arms ─────────────────────────
  for (const s of sides) {
    const t = tag(s);
    const shoulder = rig.part(torso, {
      name: `shoulder${t}`,
      robot: { p: mx(s, [1.55, 2.0, 0]) },
      vehicle: { p: mx(s, [1.28, 1.95, -0.32]) },
      via: mx(s, [0.4, 0.25, 0]),
      window: [0.2, 0.56],
    });
    add(shoulder, mesh(sphere(0.25), M.darkMetal, [0, -0.1, 0]));
    const pauldron = rig.part(shoulder, {
      name: `pauldron${t}`,
      robot: { p: mx(s, [0.12, 0.08, 0]) },
      vehicle: { p: mx(s, [-0.1, 0.1, 0]), r: [0, 0, s * -0.12] },
      window: [0.4, 0.62],
    });
    add(
      pauldron,
      mesh(rbox(0.74, 0.6, 0.86, 0.12), M.optRed),
      mesh(rbox(0.6, 0.06, 0.7), M.optSilver, [0, 0.31, 0]),
      mesh(rbox(0.06, 0.4, 0.5), M.darkMetal, mx(s, [0.38, -0.02, 0])),
    );

    const upper = rig.part(shoulder, {
      name: `upperArm${t}`,
      robot: { p: [0, -0.16, 0], r: [0, 0, s * 0.1] },
      vehicle: { p: [0, -0.16, 0] },
      viaRot: [0.2, 0, s * 0.95],
      window: [0.18, 0.6],
    });
    add(
      upper,
      mesh(rbox(0.5, 1.02, 0.55, 0.06), M.optSilver, [0, -0.56, 0]),
      mesh(rbox(0.54, 0.3, 0.58, 0.06), M.gunmetal, [0, -0.18, 0]),
      mesh(cylX(0.21, 0.52, 16), M.darkMetal, [0, -1.1, 0]),
    );

    const fore = rig.part(upper, {
      name: `forearm${t}`,
      robot: { p: [0, -1.12, 0], r: [-0.22, 0, 0] },
      vehicle: { p: [0, -1.12, 0] },
      window: [0.2, 0.5],
    });
    add(
      fore,
      mesh(rbox(0.66, 1.14, 0.7, 0.08), M.optRed, [0, -0.6, 0]),
      mesh(rbox(0.08, 0.86, 0.5, 0.03), M.optRed, mx(s, [0.36, -0.6, 0])),
      mesh(cyl(0.25, 0.25, 0.14, 16), M.darkMetal, [0, -1.18, 0]),
    );
    vents(fore, M.optSilver, [0, -0.5, 0.36], 0.4, 0.46, 4);

    const tank = rig.part(fore, {
      name: `tank${t}`,
      robot: { p: mx(s, [0.42, -0.62, 0]) },
      vehicle: { p: mx(s, [0.16, -1.32, 0.06]), r: [Math.PI / 2, 0, 0] },
      via: mx(s, [0.3, 0, 0.1]),
      window: [0.44, 0.78],
    });
    add(
      tank,
      mesh(cyl(0.17, 0.17, 0.86, 18), M.chrome),
      mesh(cyl(0.18, 0.18, 0.06, 18), M.darkMetal, [0, 0.45, 0]),
      mesh(cyl(0.18, 0.18, 0.06, 18), M.darkMetal, [0, -0.45, 0]),
      mesh(cyl(0.175, 0.175, 0.04, 18), M.darkMetal, [0, 0.1, 0]),
    );

    const fist = rig.part(fore, {
      name: `fist${t}`,
      robot: { p: [0, -1.3, 0.02] },
      vehicle: { p: [0, -0.85, 0], s: 0.7 },
      window: [0.1, 0.36],
    });
    add(
      fist,
      mesh(rbox(0.48, 0.48, 0.52, 0.08), M.gunmetal, [0, -0.2, 0]),
      mesh(rbox(0.12, 0.2, 0.3, 0.04), M.optSilver, mx(s, [-0.26, -0.15, 0.12])),
    );
    for (let i = 0; i < 4; i++) {
      fist.add(mesh(rbox(0.1, 0.16, 0.13, 0.03), M.optSilver, [-0.17 + i * 0.113, -0.36, 0.2]));
    }
    rig.marker(fist, `fist${t}`, [0, -0.25, 0.15]);
  }

  bakeStatic(rig.root);
  rig.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  return rig;
}
