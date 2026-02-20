/**
 * URDF_JOINT_MAP
 * Maps TeleopPage joint IDs → URDF revolute joint names in so_arm101.urdf.
 *
 * TeleopPage uses IDs: shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper
 * URDF joints have the same names, so the map is identity — but we keep it explicit
 * so the viewer stays decoupled from any ID scheme change.
 */
export const URDF_JOINT_MAP: Record<string, string> = {
    shoulder_pan:  'shoulder_pan',
    shoulder_lift: 'shoulder_lift',
    elbow_flex:    'elbow_flex',
    wrist_flex:    'wrist_flex',
    wrist_roll:    'wrist_roll',
    gripper:       'gripper',
};

/** Convert degrees → radians */
export const degToRad = (deg: number): number => deg * (Math.PI / 180);

/** Convert radians → degrees */
export const radToDeg = (rad: number): number => rad * (180 / Math.PI);
