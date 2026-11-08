// Content for /how. Numbers come from probe runs and tests in this repo; rows marked "pending"
// are filled from the trial runner and pipeline logs as they are measured.
export const HOW = {
  lux3dSteps: [
    ["Upload the photo or GLB", "Asset upload (OUS)", "0", "1–3 s"],
    ["Photo to 3D (fast)", "img-to-3d, G1-Turbo", "1", "~80 s"],
    ["Sentence to 3D (fast)", "text-to-3d, G1-Turbo", "13", "~80 s"],
    ["Split into parts", "part-split", "30", "~80 s"],
    ["Rig a person", "animations/rig", "15", "~63 s"],
    ["Make them walk", "animations/retarget, Walk_Loop", "6", "~120 s"],
    ["Higher-detail model (G1)", "img/text-to-3d, G1", "20", "~290 s"],
  ] as (string | number)[][],
  robotChecks: [
    ["Pelvis position after 2 s vs Unitree's Python run", "within 2.5 µm"],
    ["Speed in the browser", "12× real time with one chair, 3–4× with twenty objects"],
    ["Walk 6 s at 0.5 m/s command", "2.6983 m forward, identical to Python"],
    ["Ten trials of a one-chair course", "3.7 s of wall time"],
    ["Compile a 20-object, 120-part scene", "163 ms"],
    ["Commands with no falls in a sweep", "forward −0.5 to 1.2 m/s, sideways ±0.4 m/s, turn ±1.5 rad/s"],
    ["Stays up after a 0.2 s shove of 150 N (10 fixed directions)", "10 of 10"],
    ["Stays up after a 0.2 s shove of 250 N (10 fixed directions)", "2 of 10"],
  ] as (string | number)[][],
  objectExamples: [
    ["Kitchen chair (text)", "8", "48 × 45 × 85", "5.2 kg (hull volume would say 18.8 kg)"],
    ["Canvas sneaker (photo)", "1", "28 × 28 × 11", "volume × density"],
  ] as (string | number)[][],
  trialExamples: [
    ["Kitchen chair 1.5 m ahead", "10/10 (shoves it aside)", "10/10 (no contact)"],
    ["Fixed 6 cm step across the path", "0/10 (trips)", "—"],
    ["Fixed 12 cm step across the path", "0/10 (trips)", "—"],
    ["20 kg crate in the path", "0/10 (blocked)", "routes around"],
    ["Empty floor, one 250 N shove at a random moment and angle", "5/10", "—"],
  ] as (string | number)[][],
  limits: [
    "The controller is blind. It reacts to what it feels in its joints; it never sees the objects. Planner mode adds a map, not vision.",
    "Collision uses each part's convex hull. Hollow or concave parts (a bowl, a basket) collide as filled shapes.",
    "Mass comes from the closed mesh volume and a density you can change. Lux3D predicts size, not weight.",
    "The 12-joint model has fixed arms. The real G1 swings its arms; this one cannot catch itself with them.",
    "Lux3D allows one generation at a time per account, so new objects can queue for a few minutes when the site is busy.",
    "Movers (walking people, swinging doors) are kinematic: they push the robot but nothing pushes them back.",
  ],
  changelog: [
    ["Nov 9", "Probes (Lux3D upload, image and text to 3D, part-split, price quotes), then the whole build: robot controller in a worker, arena, ten-run trials, planner, library with trip tests, gauntlet, phone pairing, walking people, robot-ready packs."],
  ] as [string, string][],
};
