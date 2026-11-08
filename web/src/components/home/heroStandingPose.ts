// The G1 standing at the start pad, as the sim's first frame draws it (MuJoCo reset pose, Z-up world).
// Lets the hero show the robot while the physics worker is still loading; the live sim replaces it.
// Generated from the sim engine (Engine.reset + writeFrame); if the robot model changes, the hero
// notices the visuals differ and simply waits for the sim.
import type { RobotVisual } from "@/sim/types";

export const STANDING_VISUALS: RobotVisual[] = [
  {"geomId":0,"body":"pelvis","mesh":"pelvis_vis.stl","rgba":[0.2,0.2,0.2,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":1,"body":"pelvis","mesh":"pelvis_contour_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":2,"body":"pelvis","mesh":"torso_link_23dof_rev_1_0_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":3,"body":"pelvis","mesh":"logo_link_vis.stl","rgba":[0.2,0.2,0.2,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":4,"body":"pelvis","mesh":"head_link_vis.stl","rgba":[0.2,0.2,0.2,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":5,"body":"pelvis","mesh":"left_shoulder_pitch_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[-0.00001,0.10022,0.29178],"quat":[0.99026,0.1392,0.00001,-0.0001]},
  {"geomId":6,"body":"pelvis","mesh":"left_shoulder_roll_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0.14056,0.28896],"quat":[1,0.00003,0.00003,-0.0001]},
  {"geomId":7,"body":"pelvis","mesh":"left_shoulder_yaw_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0.14681,0.18576],"quat":[1,0.00003,0.00003,-0.0001]},
  {"geomId":8,"body":"pelvis","mesh":"left_elbow_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0.01577,0.14681,0.10524],"quat":[1,0.00003,0.00003,-0.0001]},
  {"geomId":9,"body":"pelvis","mesh":"left_wrist_roll_rubber_hand_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0.11577,0.14868,0.09524],"quat":[1,0.00003,0.00003,-0.0001]},
  {"geomId":10,"body":"pelvis","mesh":"right_shoulder_pitch_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[-0.00001,-0.10021,0.29178],"quat":[0.99026,-0.1392,0.00001,0.0001]},
  {"geomId":11,"body":"pelvis","mesh":"right_shoulder_roll_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,-0.14055,0.28896],"quat":[1,-0.00003,0.00003,0.0001]},
  {"geomId":12,"body":"pelvis","mesh":"right_shoulder_yaw_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,-0.1468,0.18576],"quat":[1,-0.00003,0.00003,0.0001]},
  {"geomId":13,"body":"pelvis","mesh":"right_elbow_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0.01577,-0.1468,0.10524],"quat":[1,-0.00003,0.00003,0.0001]},
  {"geomId":14,"body":"pelvis","mesh":"right_wrist_roll_rubber_hand_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0.11577,-0.14867,0.09524],"quat":[1,-0.00003,0.00003,0.0001]},
  {"geomId":15,"body":"left_hip_pitch_link","mesh":"left_hip_pitch_link_vis.stl","rgba":[0.2,0.2,0.2,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":16,"body":"left_hip_roll_link","mesh":"left_hip_roll_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":17,"body":"left_hip_yaw_link","mesh":"left_hip_yaw_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":18,"body":"left_knee_link","mesh":"left_knee_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":19,"body":"left_ankle_pitch_link","mesh":"left_ankle_pitch_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":20,"body":"left_ankle_roll_link","mesh":"left_ankle_roll_link_vis.stl","rgba":[0.2,0.2,0.2,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":21,"body":"right_hip_pitch_link","mesh":"right_hip_pitch_link_vis.stl","rgba":[0.2,0.2,0.2,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":22,"body":"right_hip_roll_link","mesh":"right_hip_roll_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":23,"body":"right_hip_yaw_link","mesh":"right_hip_yaw_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":24,"body":"right_knee_link","mesh":"right_knee_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":25,"body":"right_ankle_pitch_link","mesh":"right_ankle_pitch_link_vis.stl","rgba":[0.7,0.7,0.7,1],"pos":[0,0,0],"quat":[1,0,0,0]},
  {"geomId":26,"body":"right_ankle_roll_link","mesh":"right_ankle_roll_link_vis.stl","rgba":[0.2,0.2,0.2,1],"pos":[0,0,0],"quat":[1,0,0,0]},
];

/** x y z qw qx qy qz per visual, in STANDING_VISUALS order */
export const STANDING_POSES = new Float32Array([0,0,0.793,1,0,0,0,0,0,0.793,1,0,0,0,0,0,0.793,1,0,0,0,0,0,0.793,1,0,0,0,0,0,0.793,1,0,0,0,-0.00001,0.10022,1.08478,0.99026,0.1392,0.00001,-0.0001,0,0.14056,1.08196,1,0.00003,0.00003,-0.0001,0,0.14681,0.97876,1,0.00003,0.00003,-0.0001,0.01577,0.14681,0.89824,1,0.00003,0.00003,-0.0001,0.11577,0.14868,0.88824,1,0.00003,0.00003,-0.0001,-0.00001,-0.10021,1.08478,0.99026,-0.1392,0.00001,0.0001,0,-0.14055,1.08196,1,-0.00003,0.00003,0.0001,0,-0.1468,0.97876,1,-0.00003,0.00003,0.0001,0.01577,-0.1468,0.89824,1,-0.00003,0.00003,0.0001,0.11577,-0.14867,0.88824,1,-0.00003,0.00003,0.0001,0,0.06445,0.6903,0.99878,0,-0.04935,0,0.003,0.11645,0.65998,0.99065,-0.00065,-0.13639,-0.00009,0.06062,0.11629,0.54724,0.99065,-0.00109,-0.13639,0.00308,0.03317,0.1177,0.35534,0.99488,-0.00179,0.10098,0.00274,-0.02711,0.11637,0.06145,0.99999,-0.0015,-0.00152,0.00291,-0.02706,0.11632,0.04389,0.99999,0.00031,-0.00152,0.00291,0,-0.06445,0.6903,0.99905,0,-0.04347,0,0.00265,-0.11645,0.65995,0.99143,0.00469,-0.13055,0.00062,0.05893,-0.11528,0.54654,0.99143,0.00515,-0.13054,-0.00287,0.02922,-0.11519,0.35497,0.99497,0.00567,0.10004,-0.00161,-0.0305,-0.11162,0.06099,0.99998,0.00548,-0.00291,-0.00219,-0.0304,-0.11142,0.04343,0.99998,0.00569,-0.00291,-0.00219]);
