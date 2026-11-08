// Default density (kg/m³) per library object. Mass = closed mesh volume × density, and Lux3D meshes are closed,
// so hollow things (a basketball, a bin) need a low effective density and solid ones a high one. Anything not
// listed uses 400 kg/m³ (furniture-ish). Visitors can change it per object in the arena.
export const DEFAULT_DENSITY = 400;
const BY_SLUG: Record<string, number> = {
  basketball: 75, football: 80, "yoga-ball": 15, "laundry-basket": 50, bucket: 60, "trash-can": 60, "wheelie-bin": 50,
  "bean-bag": 60, "pizza-boxes": 60, suitcase: 150, "guitar-case": 80, "teddy-bear": 40, "cat-bed": 30, "dog-house": 100,
  umbrella: 50, "toy-truck": 150, "toy-train": 200, "traffic-cone": 300, "car-tire": 350, "rolled-rug": 350,
  rock: 2400, "cinder-block": 1400, kettlebell: 2400, sandbag: 1600, log: 600, watermelon: 950, pumpkin: 700, pineapple: 900,
  "fire-hydrant": 2400, bollard: 2400,
};
export function defaultDensity(e?: { slug?: string | null } | null): number {
  return (e?.slug && BY_SLUG[e.slug]) || DEFAULT_DENSITY;
}
