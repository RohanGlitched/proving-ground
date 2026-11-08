// Frame buffer header layout shared by the engine (writer) and the client (reader).
// A frame is [HEADER floats | robot visual geoms * 7 | objects * 7 | movers * 7];
// each pose is x y z qw qx qy qz in MuJoCo world coordinates (meters, Z up).
export const HEADER = 20;
export const H_TIME = 0, H_STATUS = 1, H_FALLEN = 2, H_GOAL_REACHED = 3, H_PELVIS_X = 4, H_PELVIS_Y = 5, H_PELVIS_Z = 6,
  H_ROBOT_YAW = 7, H_VX = 8, H_VY = 9, H_YAW = 10, H_GOAL_X = 11, H_GOAL_Y = 12, H_SEQ = 13, H_CONTACTS = 14,
  H_LAST_CONTACT = 15, H_FELL_AT = 16, H_GOAL_AT = 17, H_LAST_CONTACT_T = 18, H_RESERVED = 19;
/** H_STATUS values: 0 running, 1 fell, 2 goal. */
export const STATUS_CODE = { running: 0, fell: 1, goal: 2 } as const;
