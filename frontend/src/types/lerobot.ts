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
