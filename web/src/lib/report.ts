// Report content. Every number is measured in this repo (probe/, tests, trial runs); see /how.
export const REPORT = {
  site: "https://proving-ground-snowy.vercel.app",
  repo: "https://github.com/RohanGlitched/proving-ground",
  video: "pending",
  who: [
    ["Robotics teams", "Varied, realistic test objects with real sizes and collision parts in 90 seconds, downloadable as MuJoCo-ready packs."],
    ["Anyone curious about robots", "Make something from your own life and watch a real controller deal with it. Share the course that beat it."],
    ["Lux3D as an asset factory", "Shows Lux3D output going straight into a physics simulator: size, parts, people and motion, no hand modelling."],
  ] as [string, string][],
  flow: [
    ["flow-make.png", "Make it", "Type a sentence, upload a photo, or scan a QR code and snap with your phone."],
    ["flow-arena.png", "Drop it in", "It materializes at its real size in front of the robot. Drag it, turn it, change its density."],
    ["flow-trials.png", "Test it", "Walk once, steer, or run ten seeded trials for a pass rate and what it tripped on. Share the course."],
  ] as [string, string, string][],
  calls: [
    ["Upload a photo or GLB", "Asset upload (OUS)", "0", "1–3 s"],
    ["Photo to 3D", "img-to-3d · G1-Turbo", "1", "~80 s"],
    ["Sentence to 3D", "text-to-3d · G1-Turbo", "13", "~80 s"],
    ["Split into parts", "part-split", "30", "~80 s"],
    ["Rig a person", "animations/rig", "15", "pending"],
    ["Make them walk", "animations/retarget · Walk_Loop", "6", "pending"],
    ["Price every job first", "pricing/openapi-quotes", "0", "<1 s"],
  ] as string[][],
  pipelineNotes: [
    "Inputs must go through Aholo's own upload: third-party image URLs fail silently, so every photo and every intermediate GLB is re-uploaded.",
    "Lux3D runs one task per account, so a single queue serves everyone; the library keeps the site playable while it is busy.",
    "Lux3D predicts real size: a sneaker comes back 28 cm long and a chair 85 cm tall with no one typing a dimension.",
  ],
  iterations: [
    ["Collision", "1 hull per object", "1 hull per Lux3D part"],
    ["Chair mass", "18.8 kg (hull volume)", "4.9 kg (closed mesh volume)"],
    ["Face count", "300k faces, 19 MB", "20k faces, ~7 MB from Lux3D"],
    ["Web file", "raw GLB", "simplified + compressed visual"],
    ["Inputs", "public image URL", "Aholo asset upload"],
  ] as string[][],
  robot: [
    ["Gap to Unitree's Python run after 2 s", "2.5 µm"],
    ["Walk 6 s at 0.5 m/s", "2.6983 m (same as Python)"],
    ["Speed in the browser", "12× real time (one chair), 3–4× (20 objects)"],
    ["10 trials of a chair course", "3.7 s wall time"],
    ["Compile a 20-object scene", "163 ms"],
    ["Shove of 250 N for 0.2 s", "falls 5 of 10"],
  ] as string[][],
  results: [
    "Blind walk into a 4.9 kg Lux3D chair: the robot hits it, the contact names the chair, and it shoves the chair aside and reaches the flag 10 of 10 times.",
    "Planner mode routes around the same chair 10 of 10 times without touching it.",
    "A 6 cm or 12 cm fixed step trips it every time, and the trial says what it tripped on. A 20 kg crate stops it dead.",
    "With one 170 N shove per run, the course in the plot is a coin flip: that is the kind of number a robotics team wants to see before a real robot does.",
  ],
  extras: [
    ["extra-phone.png", "Snap from your phone", "Scan the QR code, photograph something real, and it lands in the desktop arena."],
    ["extra-library.png", "A shared library", "Every object anyone makes, with parts and hulls, downloadable as a robot-ready pack."],
    ["extra-gauntlet.png", "The gauntlet", "Courses ranked by how often the robot fails them. Remix one, or beat it with the planner."],
  ] as [string, string, string][],
  limits: [
    "The controller is blind and was trained on flat ground; it never sees the objects.",
    "Each part collides as its convex hull; hollow parts (a bowl) are filled.",
    "Mass is an estimate from volume and a density you can change.",
    "Walking people are kinematic: they push the robot but cannot be pushed.",
    "One Lux3D generation at a time per account.",
  ],
  next: [
    "Grasping: the same objects for a manipulation policy (Lux3D part-split gives handles and lids for free).",
    "Lux3D world generation as the floor plan: test inside a generated room, not on an empty floor.",
    "Export courses as MuJoCo and Isaac scenes for CI on real robot code.",
  ],
};
