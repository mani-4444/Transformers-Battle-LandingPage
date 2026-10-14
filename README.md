# Transformers-Battle-LandingPage

**Optimus Prime vs. Megatron**: a scroll-driven, cinematic 3D battle built with React, TypeScript and Three.js.
The whole page is one continuous sequence. Scroll position is the master timeline for the transformations, the vehicle chase, the combat, the camera and the effects. Scrolling backwards rewinds everything exactly.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
```

## The sequence

| Scroll | Chapter | What happens |
|---|---|---|
| 0–15% | I · The Standoff | A wide establishing shot of a ruined Cybertron landscape. The camera pushes in to a low two-shot and the title card appears. |
| 15–35% | II · Transformation | Optimus folds into his cab-over semi and Megatron folds into a Cybertronian tank. The camera orbits each of them and shows a two-shot mid-sequence. |
| 35–50% | III · Vehicle Combat | The truck and tank chase along curved routes, with dust trails and wheel and tread motion. The tank fires three shells, the two vehicles side-swipe, and both U-turn. |
| 50–75% | IV · Transform & Attack | Both launch, transform back in mid-air and land. Then: a right hook, a cannon blast on a block, a haymaker, and an uppercut. |
| 75–90% | V · The Final Clash | They charge in full robot form. Fists collide with a shockwave, sparks and debris. Action time slows around the hit. |
| 90–100% | VI · The Final Frame | They stand apart amid smoke and falling wreckage. Megatron charges his cannon, and the closing line reads “The battle is not over.” |

## How the transformations work

Both characters are **procedural articulated rigs**, built in code from about 100+ hard-surface parts each. The parts include bevelled armour plates, wheels and tyres, chrome grille bars, glass, pistons, vents, tread pads, and emissive eyes and seams. The project ships no model files.

Each articulated part (`src/scene/rig/MechPart.ts`) has:
- a **robot pose** and a **vehicle pose**, both relative to its parent joint;
- its own **window** within the transformation, so parts move in a staged sequence;
- optional **positional and rotational detours**, so panels lift, swing clear and then lock into place, instead of interpolating along a straight line.

`Transformer.setTransform(t)` is a pure function of `t`. Forward and reverse scrolling therefore produce identical intermediate frames. Nothing crossfades: every part is always visible and moves physically.

- **Optimus Prime → semi truck.** The head sinks into the cab and a roof hatch closes over it. The chest windows and abdominal grille become the windshield and radiator. The legs swing 90° back to form the chassis. The calf wheels rotate out to the sides and the front wheels flip down from the waist. The arms fold into the sleeper sides, the fists retract and the fuel tanks swing horizontal. The chassis beam telescopes out with a fifth-wheel plate, the feet fold into the rear bumper with tail lights, and the smokestacks lock upright.
- **Megatron → tank.** The torso pitches 90° forward, so the back armour becomes the hull deck. The head drops into the collar. The legs swing forward and splay out beside the hull. The calf tread units slide out and **telescope**: the track loop stretches between two sliding sprocket housings, and the pads circulate by distance driven. Track guards separate and re-lock. The feet fold into front ploughs. Both arms flip onto the deck, and the fusion cannon's inner barrel extends as the main gun. The pauldrons fold down as turret armour.

## Architecture

```
src/components/TransformersBattleLandingPage/
  TransformersBattleLandingPage.tsx  sticky WebGL stage, scroll track, loader, WebGL fallback
  Overlay.tsx                        title card, chapter captions, closing line, chapter rail nav
  useScrollProgress.ts               scroll ↔ progress mapping, reduced-motion hook
src/scene/
  BattleScene.ts       renderer, single render loop, resize, smoothing, disposal
  timeline.ts          chapters, easing, keyframe tracks, clash time-dilation
  choreography.ts      pure progress → character state (paths, attacks, gait, impact events)
  camera.ts            keyframed shots anchored to the world, a fighter, a heading or the midpoint
  characters/          Optimus.ts, Megatron.ts (rigs), poses.ts (combat/gait layer)
  rig/                 MechPart + Transformer
  geometry/kit.ts      part builders + per-part static mesh baking (fewer draw calls)
  materials.ts         procedural PBR maps (panel lines, rivets, scratches, tread, terrain)
  environment/         terrain, ruined towers, wreckage, sky shader, lights
  fx/                  sparks + streaks, smoke/dust, embers, debris, projectiles, post-processing
```

- **Determinism.** Impact effects take their age from `progress − eventProgress`, so sparks, debris and smoke puffs rewind when you scroll back. Camera shake is noise of progress, not accumulated state. Only ambient details (embers, smoke columns, idle breathing, eye pulse) follow wall-clock time.
- **Smoothing.** The rendered progress eases toward the scroll target with frame-rate-independent damping. Because it never accumulates state, it cannot drift.
- **Resizing.** The track is sized in viewport units, so a resize re-scrolls to keep the same story position. Portrait viewports widen the field of view and pull the camera back so both fighters stay framed.
- **Accessibility.** The chapters are real `<section>`s with screen-reader text, and the chapter rail uses keyboard-focusable buttons. `prefers-reduced-motion` turns off shake, flashes, motion blur and the impact slow-down, and speeds up smoothing.
- **Robustness.** The page has a loading screen with build steps, a static fallback when WebGL is unavailable or the context is lost, and full GPU resource disposal on unmount (safe under StrictMode remounts).

## Verification performed

These checks ran in headless Chromium using SwiftShader WebGL:
- every chapter at 1280×720 and 1440×900;
- forward vs. backward scrolling at matching progress points (the remaining differences matched the ambient-only baseline);
- a resize mid-sequence;
- 390×844 with real touch-drag scrolling;
- the reduced-motion production build, scrolled with the mouse wheel to the end;
- keyboard chapter navigation;
- the no-WebGL fallback;
- no horizontal overflow and no console errors (only SwiftShader's "parallel shader compile unsupported" notice).

## Limitations

- **The characters are stylised procedural models, not film assets.** No licensed, rigged and transformable Optimus Prime or Megatron models were available, so both are kit-bashed in code. They are recognisable by silhouette, colour scheme and signature features (cab windows and grille, smokestacks, Megatron's bucket helmet and fusion cannon), but they are hard-surface and blocky rather than film-grade.
- **There is no audio.**
- **Real-GPU frame rate was not measured.** Testing used a software renderer. A lower quality tier (lower DPR cap, smaller shadow maps, fewer particles, no motion blur) applies automatically on touch, small-screen and low-core devices.

## Assets & attribution

All geometry, textures and materials are generated at runtime. No third-party models or images are included.
Fonts: Orbitron and Rajdhani via `@fontsource` (SIL Open Font License).
Transformers, Optimus Prime and Megatron are trademarks of Hasbro. This is a non-commercial fan project.
