/**
 * Teleop constants — shared between TeleopPage and UrdfRobotViewer.
 *
 * Joint IDs match the URDF revolute joint names in so_arm101.urdf:
 *   shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper
 */

export const URDF_JOINT_MAP: Record<string, string> = {
    shoulder_pan:  'shoulder_pan',
    shoulder_lift: 'shoulder_lift',
    elbow_flex:    'elbow_flex',
    wrist_flex:    'wrist_flex',
    wrist_roll:    'wrist_roll',
    gripper:       'gripper',
};

export interface JointState {
    id: string;
    name: string;
    position: number;   // radians
    minLimit: number;
    maxLimit: number;
    status: 'ok' | 'limit' | 'overload';
    torque: number;
}

export const INITIAL_JOINTS: JointState[] = [
    { id: 'shoulder_pan',  name: 'Shoulder Pan',  position: 0, minLimit: -3.14, maxLimit: 3.14, status: 'ok', torque: 42 },
    { id: 'shoulder_lift', name: 'Shoulder Lift', position: 0, minLimit: -1.57, maxLimit: 1.57, status: 'ok', torque: 58 },
    { id: 'elbow_flex',    name: 'Elbow Flex',    position: 0, minLimit: -2.2,  maxLimit: 2.2,  status: 'ok', torque: 31 },
    { id: 'wrist_flex',    name: 'Wrist Pitch',   position: 0, minLimit: -3.14, maxLimit: 3.14, status: 'ok', torque: 19 },
    { id: 'wrist_roll',    name: 'Wrist Roll',    position: 0, minLimit: -3.14, maxLimit: 3.14, status: 'ok', torque: 14 },
    { id: 'gripper',       name: 'Gripper',       position: 0, minLimit: 0,     maxLimit: 1,    status: 'ok', torque: 8 },
];

export const JOINT_LIMITS: Record<string, { min: number; max: number }> = {
    shoulder_pan:  { min: -3.14, max: 3.14 },
    shoulder_lift: { min: -1.57, max: 1.57 },
    elbow_flex:    { min: -2.2,  max: 2.2 },
    wrist_flex:    { min: -3.14, max: 3.14 },
    wrist_roll:    { min: -3.14, max: 3.14 },
    gripper:       { min: 0,     max: 1 },
};
