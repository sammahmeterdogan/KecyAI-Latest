export interface LeRobotCapability {
    id: string;
    title: string;
    route: string;
    source: string;
    runnable?: boolean;
    source_links?: string[];
}

export interface LeRobotCapabilitiesResponse {
    capabilities: LeRobotCapability[];
}

export interface LeRobotHealth {
    status: string;
    service: string;
}

export interface RobotTemperature {
    current: number | null;
    max: number | null;
}

export interface RobotStatus {
    name: string;
    robot_type: 'manipulator' | 'mobile' | 'other';
    device_name?: string | null;
    temperature?: RobotTemperature[] | null;
}

export interface CameraStatus {
    camera_id: number;
    camera_type?: string;
    is_active?: boolean;
    width?: number | null;
    height?: number | null;
}

export interface ServerStatus {
    status: 'ok' | 'error';
    name: string;
    robots: string[];
    robot_status: RobotStatus[];
    cameras: {
        cameras?: CameraStatus[];
    };
    version_id?: string;
    is_recording: boolean;
    ai_running_status: 'stopped' | 'running' | 'paused' | 'waiting';
    leader_follower_status: boolean;
    server_ip: string;
    server_port: number;
}

export interface LeRobotVersion {
    lerobot_version: string;
    git_sha: string;
    backend: string;
    python: string;
}

export interface TeleopStatus {
    state: 'idle' | 'starting' | 'running' | 'stopping' | 'error';
    pid?: number;
    dry_run?: boolean;
    metadata?: {
        voltage?: number;
        latency_ms?: number;
        fps?: number;
        dry_run?: boolean;
        robot_type?: string;
        teleop_type?: string;
    };
    message?: string;
}

export interface TeleopLogResponse {
    logs: string[];
}

export interface TeleopStartRequest {
    robot_type: string;
    teleop_type: string;
    robot_port?: string;
    teleop_port?: string;
}

export interface TeleopJointSetRequest {
    jointId: string;
    value: number;
}

export interface JointState {
    id: string;
    name: string;
    position: number;
    min: number;
    max: number;
}

export interface TeleopJointsResponse {
    joints: JointState[];
}

/** Batch command payload: send multiple joint targets at once. */
export interface TeleopCommandRequest {
    joints: Array<{ id: string; position: number }>;
}

export interface TeleopCommandResponse {
    accepted: Array<{ id: string; value: number }>;
    rejected: Array<{ id: string; reason: string }>;
    simulated: boolean;
}

/** SSE telemetry event data. */
export interface TeleopTelemetryEvent {
    fps: number;
    latency_ms: number;
    dry_run: boolean;
    connected: boolean;
    joints: Array<{ id: string; position: number }>;
}

// ─── Calibration Types ───

export interface CalibrationStepDef {
    id: string;
    title: string;
    description?: string;
    joint?: string | null;
    action?: string;
    status?: 'pending' | 'current' | 'completed';
    result?: Record<string, any>;
}

export interface CalibrationStatus {
    state: 'idle' | 'running' | 'completed' | 'stopped' | 'offline';
    dry_run: boolean;
    robot_type: string;
    current_step_index: number;
    total_steps: number;
    steps: CalibrationStepDef[];
    current_step?: CalibrationStepDef;
    artifact_path?: string;
    error?: string;
    elapsed_seconds?: number;
    message?: string;
}

export interface CalibrationStartRequest {
    robot_type?: string;
    serial_port?: string;
    camera_id?: string;
}

export interface CalibrationStepResponse {
    state: string;
    step_completed: string;
    step_result: Record<string, any>;
    next_step?: CalibrationStepDef;
    current_step_index?: number;
    total_steps?: number;
    message?: string;
    artifact_path?: string;
    dry_run: boolean;
}

export interface AdminPortScanResponse {
    status: 'ok' | 'warning' | 'empty' | 'error';
    ports: string[];
    source: 'lerobot_find_port' | 'fallback_enumeration' | string;
    message: string;
    stdout: string[];
    stderr: string[];
    exit_code: number | null;
}

export interface LocalDevice {
    name: string;
    device: string;
    serial_number?: string | null;
    pid?: number | null;
    interface?: string | null;
}

export interface ScanDevicesResponse {
    devices: LocalDevice[];
}

export interface CalibrationResponse {
    calibration_status: 'error' | 'success' | 'in_progress';
    message: string;
    current_step: number;
    total_nb_steps: number;
}

export interface TorqueReadResponse {
    current_torque: number[];
}

export interface MotorSetupStep {
    key: string;
    id: number;
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | string;
    error?: string;
}

export interface MotorSetupStatus {
    state: 'idle' | 'running' | 'stopping' | 'stopped' | 'completed' | 'failed' | string;
    session_id: string;
    flow: 'follower' | 'leader' | string;
    port: string;
    started_at?: number | null;
    ended_at?: number | null;
    exit_code?: number | null;
    last_error?: string;
    running?: boolean;
    command?: string[];
    current_step_index: number;
    total_steps: number;
    current_step?: MotorSetupStep | null;
    steps: MotorSetupStep[];
    next_log_index?: number;
}

export interface MotorSetupLogEntry {
    idx: number;
    ts: string;
    stream: 'stdout' | 'stderr' | 'system' | string;
    line: string;
}

export interface MotorSetupLogsResponse {
    session_id: string;
    state: string;
    logs: MotorSetupLogEntry[];
    next_index: number;
    dropped_until: number;
}
