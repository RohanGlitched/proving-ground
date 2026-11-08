# Proving Ground: design plan

## Subject and world
A robot test range, run like a crash-test facility. Its vernacular is the visual language of physical testing: calibration targets (the black-and-yellow quartered circle on crash dummies), high-speed test cameras with timecodes and frame counters, floor grids with measured lines, stamped test reports ("RUN 07 / 10: FELL at 2.31 s, contact: chair, leg 3"), and parts exploded on a bench. Every visual device carries a measurement. Nothing is decoration.

Audience: hackathon judges (70% experts) and 50 hands-on community testers. Primary job: make something with Lux3D in under a minute and watch a real robot controller deal with it.

## The one bold thing
**The materializer.** Every Lux3D object enters the world through a visible pipeline rendered live in WebGL. First the photo or prompt card. Then a point cloud condensing into the textured mesh (the "generate" stage). Then an exploded view as part-split pulls the parts apart. Then each part is wrapped in its convex hull as translucent shells (the physics view). Then the parts snap back together, and the object drops onto the floor with real physics. The hero runs this loop on library objects, with the robot walking into them. The arena uses it for every new object. Everything else is calm.

## Palette (light test hall; a dark "camera" mode inside viewports only)
- `--concrete` #E3E2DD: page background (cool-warm grey concrete, not cream)
- `--slab` #D2D1CB: panels, floor-grid lines on light
- `--ink` #141517: text and the camera viewport background
- `--target` #F5C400: calibration yellow, used only for calibration targets, the goal flag and the primary action
- `--fault` #E0362C: falls, contacts and failure stamps
- `--route` #2B59E8: planner paths and links
- `--pass` #1E9E5A: goal reached

## Type
- Display: **Archivo** (variable width; Expanded 125 for placard headlines, set modestly: 44–64 px on desktop, never giant)
- Text: **Archivo** normal width (one family, different widths: the placard / report contrast)
- Data: **JetBrains Mono** only inside camera overlays and telemetry readouts (real data: timecode, m/s, kg)
- Scale (1.250): 13 / 16 / 20 / 25 / 31 / 39 / 49 / 61. Body 16/26. Sentence case everywhere. No all-caps eyebrows. Stamps are the one exception: they are real stamps.

## Layout
- 12-column grid on the concrete page with visible measured gutters on large screens (a faint 1 m floor-grid echo).
- Camera viewports: inky rectangles with corner brackets, timecode top-left, frame counter top-right, scale bar bottom-left (1 m), fps bottom-right.
- Report sheets: white paper cards with a calibration-target corner mark and stamp results. Used for results, library cards and course cards.

```
HOME
[nav: Proving Ground (target mark) | Arena  Library  Gauntlet  How it works | Make something ■]
[ CAMERA 01 — live arena: robot walks into the materializing objects, full bleed width, 78vh ]
[ headline left: "Make anything. Watch a real robot deal with it." | right: live readout (robot, sim time, contacts) ]
[ the pipeline, scroll-driven: 5 steps pinned beside the materializer: photo → mesh → parts → hulls → drop ]
[ run 10 trials, live: 10 small cameras running seeded trials side by side, stamping results ]
[ library wall: real generated objects rotating on report cards, filter chips ]
[ gauntlet: hardest courses with pass-rate stamps ]
[ measured facts: parity 2.5e-6 m, 8× real time, Lux3D ~90 s, credits/object ]
[ for robotics teams: robot-ready asset pack (GLB + hull STLs + MJCF) ]
[ limits, honest ]
[ footer: sitemap, credits (Unitree BSD-3, MuJoCo Apache-2, Lux3D), changelog, X post ]

ARENA (full-height app)
[top bar: course name · mode (Walk / Planner / Steer) · Run 10 trials · Share]
[left rail 320: Make (text | photo | phone) + queue status; library drawer (search, drag onto floor)]
[center: CAMERA viewport (three.js), orbit, drag objects, goal flag draggable, robot start]
[right rail 300 (collapsible): selected object (mass, size, parts, hulls toggle, density), results report]
[bottom: timeline scrubber for trial replays + contact log]
Phone: viewport first, then Make, then library sheet.
```

## Motion
- One orchestrated sequence: the materializer (about 3 s per object). The hero loops it.
- Responsive motion: stamps thud in when a trial ends; contact flashes on the part that was hit.
- No scroll fade-ups on every section. `prefers-reduced-motion`: the materializer jumps straight to the final state and the hero is paused with a play button.

## Review against the brief (generic-default check)
- Cream page with a serif display? No: concrete grey with a grotesk in placard width.
- Near-black with one acid accent? The viewports are dark because they are camera feeds. Yellow appears only on calibration targets and the goal flag, which is the subject's real colour code.
- Monospace labels everywhere? Only on camera overlays, where they are real readouts.
- SaaS card kit? Cards are report sheets with stamps, in three sizes, with no uniform shadow.
- Numbered 01/02/03 markers? Only "CAMERA 01–10" and "RUN 01–10", which are real sequences.
