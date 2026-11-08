# Proving Ground sim engine (`src/sim`)

MuJoCo 3.16 (WASM) + Unitree's published G1 12-DoF walking policy + user objects as convex parts, with navigation, contact events and seeded trials. It runs in a Web Worker in the browser and in Node for tests.

| File | What it is |
|---|---|
| `engine.ts` | Core (no DOM): scene MJCF builder, policy loop, falls/goal, contacts, movers, navigation, trials, frame writer |
| `policy.ts` | LSTM policy and Unitree deploy constants (gains, default angles, scales). Do not edit |
| `robot.ts` | Loads `public/g1`, strips visual geoms for physics, parses the visual geom list |
| `nav.ts` | Blind heading controller, cost grid + A* + string pulling, pure pursuit |
| `hull.ts` | Convex hull (three's quickhull), clustering, 2D hulls |
| `assets.ts` | GLB → collision parts (`glbToParts`), auto split, `toMJCF` robot-ready export |
| `frame.ts` | Frame buffer header indices |
| `worker.ts`, `client.ts`, `protocol.ts` | Worker, typed Promise client, message types |
| `empty-module.ts` | Browser stub for Node's `module` (aliased in `next.config.ts`) |

## Frames and units

- World is MuJoCo's: meters, **Z up**, robot starts at the origin facing +X. three.js: put everything in a group with `rotation.x = -Math.PI/2` (three = (x, z, -y)).
- Objects: `glbToParts` converts Lux3D's Y-up to Z-up as (x, y, z) → (x, −z, y), a +90° rotation about X. **The visual GLB needs the same fixed rotation** (`glb.scene.rotation.x = Math.PI/2`) inside the object's group; then apply the body pose from the frame. No other offset: the object frame origin is the GLB origin. The engine rests the lowest hull point on the floor (2 mm gap) unless `SceneObject.z` is set.
- Mass = solid volume × density (default 400 kg/m³), clamped to 0.05–80 kg. Solid volume is the closed mesh's signed volume (falls back to 35% of hull volume for open meshes). Chair: 0.0122 m³ → 4.9 kg.

## Client API (`client.ts`)

```ts
const sim = createSim();                 // { base: '/g1/' }
const { robotVisuals, layout } = await sim.ready;
const asset = await sim.parseGlb(glbArrayBuffer);   // off-thread; { parts, bboxMeters, volume, mass, split }
await sim.setScene({ objects: [{ id: 'chair', parts: asset.parts, x: 1.5, y: 0, yaw: 0, mass: asset.mass }],
                     movers: [], start: { x: 0, y: 0, yaw: 0 }, goal: { x: 4, y: 0 } }, { keepRobot: false });
await sim.setMode('blind' | 'planner' | 'manual'); await sim.setCommand({ vx, vy, yaw }); // manual only
await sim.setGoal(x, y); await sim.setSpeed(0.5); await sim.setRate(1); await sim.play(); await sim.pause(); await sim.reset();
await sim.push(150, angleRad);           // 0.2 s pelvis shove
const f = sim.latest();                  // call from rAF: { header, poses, layout }
sim.onContact(e => ...); sim.onStatus((s, t) => ...); sim.onPerf(p => ...);
const plan = await sim.getPlan();        // flat xy (Z-up world) or null
const summary = await sim.runTrials({ scene, n: 10, seed: 1, mode: 'planner', jitter, pushes, maxSeconds: 20 }, (done, n, r) => ...);
```

`SceneObject`: `{ id, name?, parts, x, y, z?, yaw?, density?, mass?, fixed?, friction? }`. Fixed objects are mocap bodies (never move, still jitterable in trials). `MoverSpec`: `{ id, parts, path: [{x, y, yaw, t}], loop? }` → kinematic (mocap) body that follows the path and pushes the robot and objects. Objects whose parts are all < 1 cm keep a frame slot but are not simulated.

## Frame buffer

`Float32Array [HEADER=20 | robot visual geoms × 7 | objects × 7 | movers × 7]`; each pose is `x y z qw qx qy qz` (Z-up world). `latest()` decodes the header into `{ simTime, status, fallen, reachedGoal, robotPelvis, robotYaw, cmd, goal, lastContact {index,id,kind,t}, contactCount, fellAt, goalAt, seq }` and gives `poses` (the part after the header). Header indices are in `frame.ts`. With `crossOriginIsolated` the worker writes into a triple-buffered `SharedArrayBuffer` (no copies); otherwise it posts a transferable buffer at ~60 Hz. The site does not send COOP/COEP today, so the postMessage path is the one in use.

**Robot visuals.** `robotVisuals[i] = { geomId: i, body, mesh, rgba, pos, quat }`: draw `/g1/meshes/<mesh>` with pose `i` from the buffer (the body pose already composed with the MJCF geom offset, so the raw STL vertices line up; MuJoCo's own `geom_xpos` would not, because MuJoCo recentres meshes). 27 meshes on 13 bodies:

| body | geomId: mesh (`<name>_vis.stl`) |
|---|---|
| pelvis | 0 pelvis, 1 pelvis_contour_link, 2 torso_link_23dof_rev_1_0, 3 logo_link, 4 head_link, 5–9 left shoulder pitch/roll/yaw, elbow, wrist_roll_rubber_hand, 10–14 the same on the right |
| left leg | 15 hip_pitch, 16 hip_roll, 17 hip_yaw, 18 knee, 19 ankle_pitch, 20 ankle_roll (`left_*_link`) |
| right leg | 21–26 as the left (`right_*_link`) |

## Worker protocol (`protocol.ts`)

Requests carry an `id`; the worker answers `{type:'reply', id, ok, result|error}`. Requests: `init {base, role:'live'|'trials', shared}`, `setScene {scene, keepRobot}`, `reset {start?}`, `setMode`, `setCommand`, `setGoal`, `setSpeed`, `setRate`, `play`, `pause`, `push {force, angle, duration?}`, `getPlan`, `runTrials {options}`, `parseGlb {bytes, options}`. Events: `frame {buf}` (non-shared mode), `status {status, t}`, `contact {event}`, `trialProgress {id, done, n, result}`, `perf {realTimeFactor, stepsPerSecond}` every 2 s. The live worker paces 500 Hz physics to the wall clock (catch-up capped at 100 ms); trials and GLB parsing run in a second worker so the live view keeps going.

Next 16 notes: the worker is `new Worker(new URL('./worker.ts', import.meta.url), {type:'module'})`. Turbopack rewrites `import.meta.url` in the worker to `file:///ROOT/...` and the worker runs from a `blob:` URL, so the wasm URL (emitted via `new URL('../../node_modules/@mujoco/mujoco/mujoco.wasm', import.meta.url)`) is resolved against the page origin and passed with `locateFile`; the asset base is made absolute in the client. `next.config.ts` aliases `module` to `empty-module.ts` for browser bundles (mujoco.js imports it in its Node-only branch).

## Physics and control

- Policy parity is exact: obs layout, scales (ang vel 0.25, dof vel 0.05, commands ×[2, 2, 0.25]), Kp/Kd, default angles, 50 Hz policy / 500 Hz physics, 0.8 s phase, action scale 0.25. Visual geoms (no mass, no contacts) are stripped from the physics model; the 6 s walk still lands at 2.6983 m.
- Fall: pelvis z < 0.45 m or projected gravity z > −0.5; after a fall the policy stops and joints hold the default pose. Goal: pelvis xy within 0.4 m (nav modes only; the robot then stands).
- Objects: one mesh geom per part (hull ≤ 96 vertices, inline `vertex=`), condim 3, friction 0.8, `priority=1` so object contacts use 0.8 while robot–floor contacts keep the original friction 1.
- Contacts are scanned at 50 Hz, only when the robot is within an object's radius + 1.2 m. A touch is one event per entity (ends after 0.2 s without contact) with peak normal force and impulse. `fallCause` = entity touched within 1.5 s before a fall.
- Planner: per-part footprint (parts between 1 cm and 1.6 m height), 5 cm grid, blocked within 0.35 m, cost ramp to 0.65 m, A*, string pulling, pure pursuit (0.55 m lookahead; slows/turns in place for heading errors > 60°). Replans every 1 s (0.5 s with movers). Commands clamped vx 0–0.6 m/s, yaw ±0.8 rad/s.

## Measured (Nov 9, Windows laptop, Node 24 / Chrome)

| | |
|---|---|
| Policy parity | 2 s: x 0.79987, y −0.02247, z 0.76789 (= Python); 6 s at 0.5 m/s: 2.6983 m (= gate) |
| Load | Node 108 ms; browser worker (MuJoCo wasm + G1 files, warm cache) 650–790 ms |
| Compile | 1 chair 42–67 ms (browser); 20 objects × 6 parts 112–234 ms Node, 163 ms browser |
| Real-time factor | Node: empty 35×, 20 objects 7×; browser worker: chair 12×, 20 objects 3–4× (holds 500 steps/s) |
| Trials | chair scene, 10 trials (103 s sim): 3.2 s Node, 3.7 s browser (~30× real time) |
| GLB → parts | chair-parts 50 ms, chair (auto split, 13k verts) 250 ms, sneaker (214k verts) 0.6 s |

Command sweep (`scripts/sim-sweep.mjs`, 10 s each, no falls anywhere): forward 0.2→0.20, 0.5→0.475, 0.8→0.755, 1.0→0.91, 1.2→1.08 m/s; backward −0.5→−0.44; yaw 0.4/0.8/1.0/1.5 → 0.37/0.75/0.92/1.28 rad/s (in place or at 0.5 m/s); lateral ±0.4 → ±0.30–0.35. Stable range: vx −0.5…1.2, vy ±0.4, yaw ±1.5. The navigator uses vx ≤ 0.6, yaw ≤ 0.8.

Obstacle behaviour (blind, 1.5 m ahead, 10 trials): chair (4.9 kg) and light boxes are bulldozed (10/10 reach the goal, contact reported); fixed 6 cm and 12 cm steps trip the robot 10/10 (fallCause set); a 20 kg crate blocks it (10/10 timeouts). 250 N pelvis push: 5/10 falls.

## Tests

`npm --prefix web run test:sim` (node:test via tsx; use Node 24). All 12 pass: parity (a), chair blind contact + planner 10/10 goals with no chair contact (b), 20 × 6 compile 205–350 ms with the test files running in parallel (c), determinism (d), chair 0.48 × 0.45 × 0.85 m and 4.9 kg (e), movers, fixed objects, frame layout, keepRobot recompile, `toMJCF` compiles with the right mass.

## Limits

- The policy is blind and flat-ground: no stairs, no stepping over; anything that is fixed and above a few cm trips it.
- Contacts against the arms and torso report body `pelvis` (they are fixed geoms on the pelvis in the 12-DoF model).
- Auto split is axis-aligned cuts (≤ 8 parts); good for furniture, rough for organic shapes. Use Lux3D part split when it matters.
- Planner ignores object dynamics (a light chair is treated like a wall) and plans only in 2D.
- SharedArrayBuffer frames are implemented but untested (needs COOP/COEP headers). `next build` was not run (dev server was up).

## THIRD_PARTY_NOTICES

- **Unitree G1 model and walking policy** (`public/g1/*`, weights from `unitree_rl_gym/deploy/pre_train/g1/motion.pt`; constants in `policy.ts`): Copyright (c) HangZhou YuShu Technology Co., Ltd. ("Unitree Robotics"). BSD-3-Clause (full text: LICENSE in github.com/unitreerobotics/unitree_rl_gym; ship it with any redistribution). Redistribution and use in source and binary forms, with or without modification, are permitted provided that: (1) redistributions of source code retain the copyright notice, this list of conditions and the disclaimer; (2) redistributions in binary form reproduce them in the documentation; (3) neither the name of the copyright holder nor its contributors may be used to endorse or promote derived products without prior written permission. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. Collision hulls and decimated visual meshes are derived from Unitree's meshes.
- **MuJoCo** (`@mujoco/mujoco`): Copyright Google DeepMind, Apache-2.0.
- **three.js** (ConvexHull, loaders): MIT. **glTF-Transform**: MIT.
