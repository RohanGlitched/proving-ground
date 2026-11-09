// Report content. Every number is measured in this repo (probe/, tests, trial runs, job records); see /how.
// BEGIN GENERATED (scratchpad rep/gen-data.py, from the stored job records, Nov 9, 2026 7:13 IST)
const GENERATED = {
  gen: {"min": 79, "max": 147, "median": 89, "n": 66},
  rawTris: [["kitchen-chair", 17936], ["traffic-cone", 18210], ["park-bench", 19294], ["cardboard-box", 17188], ["car-tire", 14376], ["basketball", 18628], ["laundry-basket", 16592], ["potted-plant", 24540], ["office-chair", 23836], ["door", 20476], ["a-stack-of-three-old-car", 17450], ["garden-gate", 16360], ["old-rucksack", 20560], ["wheelie-bin", 20054], ["skateboard", 19770], ["toolbox", 20418], ["watermelon", 18068], ["stack-of-books", 18098], ["bar-stool", 18016], ["floor-lamp", 32108], ["side-table", 18130], ["bean-bag", 18010], ["rolled-rug", 19146], ["folding-chair", 13446], ["step-stool", 18786], ["coat-rack", 18684], ["standing-fan", 29504], ["ottoman", 17114], ["toy-truck", 24624], ["teddy-bear", 17280], ["block-pile", 15804], ["rocking-horse", 20770], ["toy-train", 25442], ["football", 16364], ["hurdle", 24450], ["kettlebell", 18166], ["yoga-ball", 18136], ["agility-ladder", 19528], ["rock", 18286], ["log", 17782], ["fire-hydrant", 19338], ["trash-can", 22344], ["mailbox", 30030], ["bollard", 34860], ["garden-gnome", 19472], ["wheelbarrow", 18116], ["shopping-cart", 30624], ["wooden-pallet", 15356], ["sawhorse", 17578], ["barrel", 18916], ["cinder-block", 15584], ["sandbag", 21044], ["bicycle", 24458], ["pumpkin", 17750], ["pineapple", 27666], ["pizza-boxes", 13404], ["suitcase", 19878], ["guitar-case", 18924], ["robot-vacuum", 15312], ["banana-peel", 18048], ["bucket", 16430], ["ladder", 23438], ["cat-bed", 18258], ["umbrella", 32366], ["dog-house", 10804]] as [string, number][],
  overBudget: [["floor-lamp", 32108, 24243], ["standing-fan", 29504, 24248], ["toy-train", 25442, 24242], ["mailbox", 30030, 24423], ["bollard", 34860, 24248], ["shopping-cart", 30624, 24513], ["pineapple", 27666, 24248], ["umbrella", 32366, 24246]] as [string, number, number][],
  triRange: [10804, 34860, 18628],
  rawMB: [7, 12],
  webKB: [256, 817],
  totals: {"objects": 65, "rawMB": 614, "webMB": 29.3},
  band: [["Skateboard", "2.20 m", "0.80 m", "\u00d7 0.36"], ["Agility ladder", "0.60 m", "1.50 m", "\u00d7 2.50"], ["Trash can", "0.38 m", "0.90 m", "\u00d7 2.37"], ["Block pile", "0.21 m", "0.40 m", "\u00d7 1.90"], ["Door", "3.86 m", "2.05 m", "\u00d7 0.53"], ["Rock", "0.30 m", "0.50 m", "\u00d7 1.66"], ["Rolled rug", "1.20 m", "1.80 m", "\u00d7 1.50"], ["Pumpkin", "0.28 m", "0.40 m", "\u00d7 1.43"], ["Wheelbarrow", "2.14 m", "1.50 m", "\u00d7 0.70"], ["Rocking horse", "0.65 m", "0.90 m", "\u00d7 1.38"], ["Football", "0.22 m", "0.30 m", "\u00d7 1.36"]] as string[][],
  checked: 60,
};
// END GENERATED
const n0 = (n: number) => n.toLocaleString("en-US");
// ten seeded runs on the starter course (box, chair, jogger crossing): arena screenshots, and the Node check script for the planner
const JOG = { blind: 2, planner: 10, script: 10 };

export const REPORT = {
  jog: JOG,
  site: "https://proving-ground-snowy.vercel.app",
  repo: "https://github.com/RohanGlitched/proving-ground",
  video: "https://youtu.be/6pRu4K838hk",
  who: [
    ["Robotics teams", "Varied, realistic test objects with real sizes and collision parts in a few minutes, downloadable as MuJoCo-ready packs."],
    ["Anyone curious about robots", "Make something from your own life and watch a real controller deal with it. Share the course that beat it."],
    ["Lux3D as an asset factory", "Shows Lux3D output going straight into a physics simulator: size, parts, people and motion, no hand modelling."],
  ] as [string, string][],
  numbers: [
    [`${GENERATED.gen.min}–${GENERATED.gen.max} s`, "Lux3D generation per object", `Median ${GENERATED.gen.median} s over ${GENERATED.gen.n} library generations.`],
    ["~2 · ~4 min", "A finished object, end to end", "Single part, and with part-split (a toolbox took 114 s, a folding chair 208 s)."],
    ["2.5 µm", "Gap to Unitree's own Python run", "Pelvis position after 2 s of walking."],
    ["12×", "Real time in the browser", "One chair; 3–4× with twenty objects in the scene."],
  ] as [string, string, string][],
  flow: [
    ["s1-make.jpg", "Make it", "Type a sentence, upload a photo, or scan the QR code and snap with your phone. Lux3D builds it in about 90 seconds."],
    ["s2-drop.jpg", "Drop it in", "It materializes at its real size in front of the robot: shape, texture, parts, then the hulls the physics feels. Drag it, turn it, change its density."],
    ["s3-test.jpg", "Test it", "Walk once, steer, or run ten seeded trials for a pass rate, the falls, and what it tripped on. Save the course and share the link."],
  ] as [string, string, string][],
  flowNote: `Screenshots from the arena. The test report shown is a blind walk on the starter course (box, chair, a Lux3D-made jogger crossing): ${JOG.blind} of 10 runs reached the flag.`,
  calls: [
    ["Upload a photo or GLB", "Asset upload (OUS)", "0", "1–3 s"],
    ["Photo to 3D", "img-to-3d · G1-Turbo", "1", "~90 s"],
    ["Sentence to 3D", "text-to-3d · G1-Turbo", "13", "~90 s"],
    ["Split into parts", "part-split", "30", "~95 s"],
    ["Rig a person", "animations/rig", "15", "~63 s"],
    ["Make them walk", "animations/retarget · Walk_Loop", "6", "~120 s"],
    ["Hinges for doors and gates", "articulation · URDF", "28", "~3 min"],
    ["STL / OBJ / FBX download", "multi-format-export", "0", "~30 s"],
    ["Price every job first", "pricing/openapi-quotes", "0", "<1 s"],
  ] as string[][],
  pipelineNotes: [
    "Inputs must go through Aholo's own upload: third-party image URLs fail silently, so every photo and every intermediate GLB is re-uploaded.",
    "Lux3D runs one task per account, so a single queue serves everyone; the library keeps the site playable while it is busy.",
    "Lux3D predicts real size for most objects: a sneaker comes back 28 cm long and a chair 85 cm tall with no one typing a dimension. When a size is more than 35% off the typical one for that kind of thing (a street trash can came back 38 cm tall), the pipeline rescales it.",
  ],
  // where the time goes, seconds from the stored job records of three finished jobs (Nov 8-9)
  timeline: [
    { label: "Single-part object", sub: "toolbox", total: 114, parts: [["generate", 88], ["ours", 26]] },
    { label: "Object with part-split", sub: "folding chair", total: 208, parts: [["generate", 82], ["split", 84], ["ours", 42]] },
    { label: "Walking person", sub: "jogger: rig and walk cycle", total: 331, parts: [["generate", 79], ["rig", 63], ["walk", 120], ["ours", 69]] },
  ] as { label: string; sub: string; total: number; parts: [string, number][] }[],
  timelineKey: {
    generate: "Lux3D generate",
    split: "Lux3D part-split",
    rig: "Lux3D rig",
    walk: "Lux3D walk cycle",
    ours: "Ours: queue pick-up, uploads, downloads, processing",
  } as Record<string, string>,
  // Lux3D Turbo against the higher-detail G1, same prompts, Nov 9 (job records and library log)
  g1: {
    cols: ["Cone · Turbo", "Cone · G1", "Bench · Turbo", "Bench · G1"],
    rows: [
      ["Generation", "84 s", "285 s", "85 s", "295 s"],
      ["Total, end to end", "88 s", "288 s", "179 s", "382 s"],
      ["Credits", "13", "20", "43 (13 + 30)", "50 (20 + 30)"],
      ["Triangles from Lux3D", "18,210", "7,586", "19,294", "21,210"],
      ["GLB from Lux3D", "7.9 MB", "4.0 MB", "10.6 MB", "8.2 MB"],
      ["File the browser loads", "313 KB", "150 KB", "685 KB", "455 KB"],
      ["Parts", "1", "1", "5", "4"],
    ] as string[][],
    verdict:
      "Same prompts, same sizes (0.7 m cone, 1.8 m bench). G1 took 3.4× as long and 1.5× the credits for the cone, and it draws the white band and orange base like a real cone where Turbo's band comes back grey. A 90 s wait is what lets someone make an object and test it in one sitting, so Turbo stays the default and G1 is one setting (LUX_VERSION=G1).",
  },
  // one hull against one per part, kitchen chair 1.5 m ahead, blind walks (Node build of the same engine as the browser)
  hulls: [
    ["Collision", "1 hull for the chair", "1 hull per part (8)"],
    ["Chair mass", "18.8 kg (hull volume)", "about 5 kg (mesh volume)"],
    ["Reached the flag, 20 walks", "14", "18"],
    ["Mean time to the flag", "16.7 s", "10.9 s"],
  ] as string[][],
  hullsNote:
    "20 blind walks per version (two seeds of ten), chair square-on 1.5 m ahead. Most of the gap is mass: the single hull at the corrected mass gets 9 of 10 in 11.4 s. The parts add shape: the eight part hulls together fill 49.8 L for 12.9 L of chair, so legs, seat and back each act as their own solid.",
  materialize: [
    ["mat-1.jpg", "Points condense", "Lux3D mesh vertices"],
    ["mat-2.jpg", "Texture sweeps in", "real size, in metres"],
    ["mat-3.jpg", "Part-split pulls it apart", "hull around each part"],
    ["mat-4.jpg", "Parts close up", "ready to drop in"],
  ] as [string, string, string][],
  // raw Lux3D triangles against the 25,000 budget; the sneaker is the first photo-to-3D probe (no face limit)
  budget: {
    limit: 25000,
    rows: [
      ["Request to Lux3D", "default (no face limit)", "faceCount 20,000"],
      ["Triangles from Lux3D", "305,236", `${n0(GENERATED.triRange[0])} – ${n0(GENERATED.triRange[1])} (median ${n0(GENERATED.triRange[2])})`],
      ["GLB from Lux3D", "18.9 MB, two 2048 px PNG textures", `${GENERATED.rawMB[0]} – ${GENERATED.rawMB[1]} MB`],
      ["After our processing", "24,250 triangles, 769 KB", `${(GENERATED.webKB[0] / 1000).toFixed(1)} – ${(GENERATED.webKB[1] / 1000).toFixed(1)} MB, same triangles`],
      ["Textures", "2 × 2048 px PNG", "1 × 1024 px WebP, meshopt-compressed"],
      ["Over the 25,000 budget", "simplified from 305,236", GENERATED.overBudget.length ? `${GENERATED.overBudget.length} objects, simplified to just under 25,000` : "none"],
    ] as string[][],
    totals: `All ${GENERATED.totals.objects} objects (people not counted): ${GENERATED.totals.rawMB} MB of GLB from Lux3D, ${GENERATED.totals.webMB} MB loaded by the browser.`,
  },
  rawTris: GENERATED.rawTris,
  overBudget: GENERATED.overBudget,
  // a bad generation: Lux3D returned a 3.86 m door and a 2.20 m skateboard
  badGen: {
    rows: GENERATED.band.slice(0, 5),
    outside: GENERATED.band.length,
    steps: [
      ["Compare", "every library object has a typical largest dimension (common retail sizes, in sizes.ts); the measured size of the Lux3D mesh is checked against it."],
      ["Rescale", "if the two differ by more than 35%, the mesh is scaled uniformly to the typical size before the hulls and volume are built. Joint pivots of the door scale with it."],
      ["Leave alone", `everything else (the other ${GENERATED.checked - GENERATED.band.length} of ${GENERATED.checked} generations checked) keeps Lux3D's own size. Objects people make themselves have no reference size and keep it too.`],
    ] as [string, string][],
    note: "At 400 kg/m³ the unchecked 2.20 m skateboard weighed 58 kg. Volume, and so mass, follows the cube of the scale factor (0.36³ = 0.05).",
  },
  robot: [
    ["Gap to Unitree's Python run after 2 s", "2.5 µm"],
    ["Walk 6 s at 0.5 m/s", "2.6983 m (same as Python)"],
    ["Speed in the browser", "12× real time (one chair), 3–4× (20 objects)"],
    ["10 trials of a chair course", "3.7 s wall time"],
    ["Compile a 20-object scene", "163 ms"],
    ["One 250 N shove at a random moment and angle", "falls 5 of 10 walks"],
  ] as string[][],
  loop: [
    ["Sense", "joint angles and speeds, gravity direction, walking command"],
    ["Unitree policy · 50 Hz", "LSTM read from the TorchScript file, plain JavaScript"],
    ["PD control · 500 Hz", "joint targets into torques"],
    ["MuJoCo · WebAssembly", "the robot meets Lux3D part hulls"],
  ] as [string, string][],
  robotNote:
    "Planner mode with collision hulls on. The route (blue) goes around the box and the chair, and the robot has stopped at the start because the jogger is about to cross; the log says “Waiting for someone to cross the path”.",
  resultTable: [
    ["Starter course, jogger crossing", `${JOG.blind} of 10`, `${JOG.planner} of 10`],
    ["Park bench across the path", "0 of 10", "10 of 10"],
    ["Kitchen floor: chair, sneaker, cone", "8 of 10", "–"],
    ["Same, one 170 N shove per run", "7 of 10", "–"],
    ["8-part Lux3D chair, trip test (1.4 m, chair turned and shifted each run)", "5 of 10", "–"],
    ["0.55 kg sneaker; 2.0 kg cone", "10 of 10 each", "–"],
    ["Fixed 6 cm or 12 cm step", "0 of 10", "–"],
  ] as string[][],
  results: [
    `With the jogger crossing, a blind walk mostly trips on the cardboard box and reaches the flag ${JOG.blind} times in 10. The planner routes around the objects and waits for the jogger to pass: ${JOG.planner} of 10 in the arena, ${JOG.script} of 10 in the check script (scripts/jogger-check.mjs). That gap is what perception is worth, measured.`,
    "A Lux3D park bench across the path is the clearest case: the blind walk pushes a 56 kg bench and stalls; the planner routes around it. In the 8-part chair trip test, where the chair is turned and shifted at random each run (harder than the square-on comparison on the hull slide), the blind walk gets 1 fall and 4 stuck pushing it.",
    "Fixed steps trip the robot every time, and every trial records what it tripped on.",
  ],
  extras: [
    ["x-phone.jpg", "Snap from your phone", "Scan the QR code, photograph something real, and it lands in the desktop arena. The phone page sends nothing until you press the button."],
    ["x-library.jpg", "A shared library", "Every object anyone makes, with parts and hulls, downloadable as a robot-ready pack: textured GLB, one STL hull per part, MJCF body with masses."],
    ["x-challenges.jpg", "Challenges and the gauntlet", "A goal, a limit and a score: fix a course in as few moves as possible, trip the robot with the least mass, or steer it home against the clock. Plus 23 courses ranked by how often the robot fails them."],
  ] as [string, string, string][],
  limits: [
    "The controller is blind and was trained on flat ground; it never sees the objects. Planner mode adds a map of footprints, not vision.",
    "Each part collides as its convex hull (a bowl is filled), and mass is an estimate from volume and a density you can change.",
    "Walking people are kinematic: they push the robot but cannot be pushed.",
    "One Lux3D generation at a time per account, so new objects can queue.",
    "Lux3D sometimes misjudges size. The size check covers library objects only; things people make keep Lux3D's own size.",
    "Trial results are run and reported by each visitor's browser; anyone can rerun a course to check it.",
  ],
  next: [
    "Grasping: the same objects for a manipulation policy (Lux3D part-split gives handles and lids for free).",
    "Lux3D world generation as the floor plan: test inside a generated room, not on an empty floor.",
    "Export courses as MuJoCo and Isaac scenes for CI on real robot code.",
  ],
  credits: [
    ["Aholo Lux3D", "Manycore Tech: 3D generation, part-split, rig, walk cycle, pricing"],
    ["Unitree G1", "model and the unitree_rl_gym walking policy, BSD-3-Clause"],
    ["MuJoCo", "Google DeepMind, Apache-2.0, compiled to WebAssembly"],
    ["three.js", "rendering, MIT"],
  ] as [string, string][],
};
