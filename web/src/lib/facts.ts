// Numbers shown on the site. Each one comes from a measurement in this repo; see /how for the method.
export const FACTS = [
  {
    value: "2.5 µm",
    label: "Gap to Unitree's own code",
    detail: "After 2 s of walking, the browser controller's pelvis is within 2.5 micrometres of Unitree's Python reference run.",
  },
  {
    value: "12×",
    label: "Faster than real time",
    detail: "MuJoCo compiled to WebAssembly runs the 500 Hz physics 12 times faster than the clock with one chair, 3–4 times with twenty objects.",
  },
  {
    value: "~80 s",
    label: "Photo to 3D object",
    detail: "Lux3D Turbo image-to-3D, measured end to end including upload and download. Part-split adds about another 80 s.",
  },
  {
    value: "8 parts",
    label: "One kitchen chair",
    detail: "Lux3D part-split separated a generated chair into legs, seat and back: eight solids instead of one block.",
  },
] as const;
