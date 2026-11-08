// Content for /how. Numbers come from probe runs and tests in this repo; rows marked "pending"
// are filled from the trial runner and pipeline logs as they are measured.
export const HOW = {
  lux3dSteps: [
    ["Upload the photo or GLB", "Asset upload (OUS)", "0", "1–3 s"],
    ["Photo to 3D (fast)", "img-to-3d, G1-Turbo", "1", "~80 s"],
    ["Sentence to 3D (fast)", "text-to-3d, G1-Turbo", "13", "~80 s"],
    ["Split into parts", "part-split", "30", "~80 s"],
    ["Rig a person", "animations/rig", "15", "pending"],
    ["Make them walk", "animations/retarget, Walk_Loop", "6", "pending"],
    ["Make a door open", "articulation-animation", "28", "pending"],
  ] as (string | number)[][],
  robotChecks: [
    ["Pelvis position after 2 s vs Unitree's Python run", "within 2.5 µm"],
    ["Speed, one laptop core", "about 8× real time"],
    ["Walk 6 s at 0.5 m/s command", "2.70 m forward"],
    ["Stays up after a 0.2 s shove of 150 N", "10 of 10 directions"],
    ["Stays up after a 0.2 s shove of 250 N", "2 of 10 directions"],
  ] as (string | number)[][],
  objectExamples: [
    ["Kitchen chair (text)", "8", "48 × 45 × 85", "pending"],
    ["Canvas sneaker (photo)", "1", "28 × 11 × 28", "pending"],
  ] as (string | number)[][],
  trialExamples: [["pending", "—", "—"]] as (string | number)[][],
  limits: [
    "The controller is blind. It reacts to what it feels in its joints; it never sees the objects. Planner mode adds a map, not vision.",
    "Collision uses each part's convex hull. Hollow or concave parts (a bowl, a basket) collide as filled shapes.",
    "Mass comes from hull volume and a density guess. Lux3D predicts size, not weight.",
    "The 12-joint model has fixed arms. The real G1 swings its arms; this one cannot catch itself with them.",
    "Lux3D allows one generation at a time per account, so new objects can queue for a few minutes when the site is busy.",
    "Movers (walking people, swinging doors) are kinematic: they push the robot but nothing pushes them back.",
  ],
  changelog: [
    ["Nov 9", "Probes: Lux3D upload, image and text to 3D, part-split, live price quotes. Design, materializer, home page."],
  ] as [string, string][],
};
