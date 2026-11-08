// Typical largest dimension (metres) of each library object, used by the size check in processModel:
// Lux3D gets real size right most of the time, but not always (a 3.9 m door, a 2.2 m skateboard).
// Objects off by more than 35% are scaled to these numbers. Sources: common retail dimensions.
export const TYPICAL_MAX_DIM: Record<string, number> = {
  "traffic-cone": 0.7, "cardboard-box": 0.4, "car-tire": 0.68, basketball: 0.24, "park-bench": 1.8,
  "laundry-basket": 0.6, "potted-plant": 0.7, "office-chair": 1.1, door: 2.05, "garden-gate": 1.2, "wheelie-bin": 1.07,
  skateboard: 0.8, toolbox: 0.5, watermelon: 0.32, "stack-of-books": 0.3, "bar-stool": 0.75, "floor-lamp": 1.6,
  "side-table": 0.6, "bean-bag": 0.9, "rolled-rug": 1.8, "folding-chair": 0.85, "step-stool": 0.45, "coat-rack": 1.75,
  "standing-fan": 1.3, ottoman: 0.6, "toy-truck": 0.4, "teddy-bear": 0.45, "block-pile": 0.4, "rocking-horse": 0.9,
  "toy-train": 0.5, football: 0.3, hurdle: 1.2, kettlebell: 0.3, "yoga-ball": 0.65, "agility-ladder": 4,
  rock: 0.5, log: 1.2, "fire-hydrant": 0.75, "trash-can": 0.9, mailbox: 1.2, bollard: 0.9, "garden-gnome": 0.4,
  wheelbarrow: 1.5, "shopping-cart": 1.0, "wooden-pallet": 1.2, sawhorse: 1.0, barrel: 0.9, "cinder-block": 0.4,
  sandbag: 0.6, bicycle: 1.75, pumpkin: 0.4, pineapple: 0.3, "pizza-boxes": 0.4, suitcase: 0.7, "guitar-case": 1.1,
  "robot-vacuum": 0.35, "banana-peel": 0.2, bucket: 0.35, ladder: 1.8, "cat-bed": 0.5, umbrella: 1.0, "dog-house": 1.0,
};
