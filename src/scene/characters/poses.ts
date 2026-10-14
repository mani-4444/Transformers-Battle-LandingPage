import type { Transformer } from '../rig/Transformer';
import type { CharState } from '../choreography';
import { clamp, lerp } from '../timeline';

/**
 * Additive combat/gait layer applied after the transformation pose. Weighted by
 * robot-ness (1 − t) so it fades out naturally while folding into vehicle form.
 */
export function applyPose(rig: Transformer, s: CharState, time: number, isMegatron: boolean, ambient: number) {
  const w = clamp(1 - s.t * 1.4);
  if (w <= 0) return;

  const pelvis = rig.get('pelvis');
  const torso = rig.get('torso');
  const head = rig.get('head');

  const guard = clamp(s.guard);
  const run = clamp(s.run);
  const crouch = clamp(s.crouch);
  const recoil = clamp(s.recoil);
  const punch = clamp(s.punch);
  const upper = clamp(s.uppercut);
  const block = clamp(s.block);
  const aim = clamp(s.aim);
  const swing = clamp(s.swing);

  const breathe = Math.sin(time * 1.7 + (isMegatron ? 1.3 : 0)) * ambient;
  const ph = s.runPhase;
  const sinP = Math.sin(ph);

  // Body: stance crouch, gait bob, recoil lean, attack twist.
  pelvis.addOffset(0, -0.1 * guard - 0.42 * crouch - Math.abs(Math.cos(ph)) * 0.18 * run, 0, w);
  pelvis.addRotation(0.12 * run, 0, 0, w);
  const twist = 0.4 * punch + 0.3 * upper - 0.45 * swing + 0.15 * aim;
  torso.addRotation(0.025 * breathe + 0.18 * run + 0.18 * crouch - 0.32 * recoil - 0.12 * upper + 0.1 * punch, twist, 0, w);
  head.addRotation(-0.08 * guard + 0.1 * crouch - 0.4 * recoil + 0.02 * breathe, -twist * 0.5, 0, w);

  for (const side of [1, -1] as const) {
    const t = side > 0 ? 'L' : 'R';
    const isRight = side < 0;
    const hip = rig.get(`hip${t}`);
    const shin = rig.get(`shin${t}`);
    const foot = rig.get(`foot${t}`);
    const ua = rig.get(`upperArm${t}`);
    const fa = rig.get(`forearm${t}`);

    // Legs: stance → crouch → run cycle.
    const stride = side * sinP;
    const legFwd = -0.22 * guard * (isRight ? 0.4 : 1.2) - 0.55 * crouch - 0.75 * stride * run;
    const knee = 0.38 * guard + 0.95 * crouch + run * (0.35 + 0.95 * Math.max(0, Math.sin(ph + side * 1.4 + Math.PI)));
    hip.addRotation(legFwd, 0, side * 0.05 * guard, w);
    shin.addRotation(knee, 0, 0, w);
    foot.addRotation(-(legFwd + knee) * 0.6, 0, 0, w);

    // Arms: guard base, then specific moves override.
    let uaX = lerp(-0.08 + 0.03 * breathe, -0.55, guard);
    let uaZ = -side * 0.12 * guard;
    let faX = lerp(0, -1.45, guard);
    uaX += 0.75 * stride * run;
    faX += -0.3 * run;

    const isPunchArm = isRight; // both fighters lead with the right
    if (isPunchArm && punch > 0) {
      uaX = lerp(uaX, -1.62, punch);
      uaZ = lerp(uaZ, -side * 0.05, punch);
      faX = lerp(faX, 0.18, punch);
    }
    if (isRight && upper > 0) {
      uaX = lerp(uaX, -2.5, upper);
      faX = lerp(faX, -0.9, upper);
    }
    if (!isRight && block > 0) {
      uaX = lerp(uaX, -1.15, block);
      uaZ = lerp(uaZ, -side * 0.55, block);
      faX = lerp(faX, -1.95, block);
    }
    if (isRight && block > 0) {
      uaX = lerp(uaX, -0.9, block * 0.7);
      faX = lerp(faX, -2.0, block * 0.7);
    }
    if (isRight && aim > 0) {
      uaX = lerp(uaX, -1.5, aim);
      uaZ = lerp(uaZ, 0.12, aim);
      faX = lerp(faX, 0.24, aim);
    }
    if (!isRight && swing > 0) {
      uaX = lerp(uaX, -1.35, swing);
      uaZ = lerp(uaZ, side * 0.9 * (1 - swing) - side * 0.4 * swing, swing);
      faX = lerp(faX, -0.35, swing);
    }
    if (recoil > 0) {
      uaZ = lerp(uaZ, side * 0.5, recoil * 0.6);
      faX = lerp(faX, -0.6, recoil * 0.5);
    }
    ua.addRotation(uaX, 0, uaZ, w);
    fa.addRotation(faX, 0, 0, w);
  }
}
