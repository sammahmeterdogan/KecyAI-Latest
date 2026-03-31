import {
    AdminPortScanResponse,
    CalibrationResponse,
    CalibrationStartRequest,
    CalibrationStatus,
    CalibrationStepResponse,
    LeRobotCapabilitiesResponse,
    LeRobotHealth,
    LeRobotVersion,
    MotorSetupLogsResponse,
    MotorSetupStatus,
    ServerStatus,
    TeleopLogResponse,
    TeleopStatus,
    TorqueReadResponse,
} from '../../types/lerobot';
import { DEFAULT_LOCAL_SERVICE_URL, getCachedDesktopServiceUrl, isTauriRuntime } from '../desktopService';

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------
// Browser-first mode talks to a single local KECYAI service. Tauri launcher
// still needs a concrete localhost target because its own origin is not HTTP.
const SAVED_PORT_KEY = 'kecyai_robot_port';

type FetchOptions = RequestInit & { timeout?: number };
type RuntimeGamepadStatus = {
    backend: string;
    pygame_available: boolean;
    connected: boolean;
    active: boolean;
    selected_index: number | null;
    speed: number;
    available_gamepads: Array<{ index: number; id: string; name: string; guid?: string; axes?: number; buttons?: number; hats?: number; backend?: string }>;
    analog_values: { leftStickX: number; leftStickY: number; rightStickX: number; rightStickY: number; leftTrigger: number; rightTrigger: number };
    active_buttons: string[];
    message?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

function isLocalFrontendHost(): boolean {
    if (typeof window === 'undefined') return true;
    const { hostname } = window.location;
    return hostname === 'localhost' || hostname === '127.0.0.1';
}

function resolveBackendBaseUrl(): string {
    const explicit = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (isTauriRuntime()) {
        return stripTrailingSlash(getCachedDesktopServiceUrl() || explicit?.trim() || DEFAULT_LOCAL_SERVICE_URL);
    }
    if (typeof window !== 'undefined' && isLocalFrontendHost()) return stripTrailingSlash(window.location.origin);
    if (explicit?.trim()) return stripTrailingSlash(explicit);
    return '';
}

export function getBackendBaseUrl(): string {
    const resolved = resolveBackendBaseUrl();
    if (resolved) return resolved;
    if (typeof window !== 'undefined') return window.location.origin;
    return DEFAULT_LOCAL_SERVICE_URL;
}

export function getRuntimeBaseUrl(): string {
    return getBackendBaseUrl();
}

function withQuery(endpoint: string, params?: Record<string, string | number | boolean | null | undefined>): string {
    if (!params) return endpoint;
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        search.set(key, String(value));
    });
    const query = search.toString();
    return query ? `${endpoint}?${query}` : endpoint;
}

function getSavedRobotPort(): string {
    if (typeof window === 'undefined') return '';
    try {
        return window.localStorage.getItem(SAVED_PORT_KEY)?.trim() || '';
    } catch {
        return '';
    }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class LeRobotClient {

    // ── Core fetch ────────────────────────────────────────────────────

    private static async request<T>(url: string, options?: FetchOptions): Promise<T> {
        const controller = new AbortController();
        const timeout = options?.timeout ?? 5000;
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const res = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options?.headers,
                },
            });

            if (!res.ok) {
                let errorBody: string | Record<string, unknown>;
                try {
                    const text = await res.text();
                    try { errorBody = JSON.parse(text); } catch { errorBody = text; }
                } catch { errorBody = 'Unknown error'; }

                const error = new Error(
                    typeof errorBody === 'object' && errorBody !== null && 'message' in errorBody
                        ? `API Error: ${res.status} ${String((errorBody as { message?: unknown }).message)}`
                        : typeof errorBody === 'object' && errorBody !== null && 'detail' in errorBody
                            ? `API Error: ${res.status} ${String((errorBody as { detail?: unknown }).detail)}`
                            : `API Error: ${res.status} ${res.statusText}`
                ) as Error & { status?: number; body?: unknown };
                error.status = res.status;
                error.body = errorBody;
                throw error;
            }

            const text = await res.text();
            if (!text) return {} as T;
            return JSON.parse(text) as T;
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('Request timed out');
            }
            throw error;
        } finally {
            clearTimeout(id);
        }
    }

    private static async fetch<T>(endpoint: string, options?: FetchOptions): Promise<T> {
        return this.request<T>(`${getBackendBaseUrl()}${endpoint}`, options);
    }

    // ── Health & Metadata ─────────────────────────────────────────────

    static async getHealth(): Promise<LeRobotHealth> {
        return this.fetch<LeRobotHealth>('/api/lerobot/health', { timeout: 3000 });
    }

    static async getReadiness(): Promise<LeRobotHealth> {
        return this.fetch<LeRobotHealth>('/api/lerobot/ready', { timeout: 3000 });
    }

    static async getVersion(): Promise<LeRobotVersion> {
        return this.fetch<LeRobotVersion>('/api/lerobot/version', { timeout: 3000 });
    }

    static async getCapabilities(): Promise<LeRobotCapabilitiesResponse> {
        return this.fetch<LeRobotCapabilitiesResponse>('/api/lerobot/capabilities', { timeout: 3000 });
    }

    static async ping(): Promise<boolean> {
        try {
            await this.fetch('/api/health', { timeout: 2000 });
            return true;
        } catch {
            return false;
        }
    }

    static async getSupervisedHealth(): Promise<{ backendHealthy: boolean; runtimeHealthy: boolean }> {
        const [health, readiness] = await Promise.all([
            this.fetch<{
                status: string;
            }>('/api/health', { timeout: 3000 }).catch(() => null),
            this.fetch<{
                status: string;
            }>('/api/ready', { timeout: 3000 }).catch(() => null),
        ]);

        const backendHealthy = Boolean(health?.status === 'ok');
        const runtimeHealthy = Boolean(readiness?.status === 'ok');

        return { backendHealthy, runtimeHealthy };
    }

    static async getServerStatus(): Promise<ServerStatus> {
        const [{ backendHealthy, runtimeHealthy }, config, teleopStatus] = await Promise.all([
            this.getSupervisedHealth(),
            this.adminGetConfig().catch(() => null),
            this.teleopStatus().catch(() => null),
        ]);

        // If the runtime service is completely unreachable, propagate the error so callers
        // can set connectionState → 'offline'.  If only the runtime is down we
        // stay 'online' but expose no robots so the user gets an accurate state.
        if (!backendHealthy) {
            throw new Error('Runtime service unreachable');
        }

        const robotName = teleopStatus?.metadata?.robot_type || config?.robot_type || 'so101_follower';
        const configuredPort = config?.serial_port?.trim() || getSavedRobotPort();
        const isDryRun = Boolean(teleopStatus?.dry_run || teleopStatus?.metadata?.dry_run);
        const deviceName = configuredPort || (isDryRun ? 'dry-run' : '');
        const shouldExposeRobot = Boolean(configuredPort) || isDryRun || teleopStatus?.state === 'running';

        const robotStatus = shouldExposeRobot
            ? [{
                name: robotName,
                robot_type: 'manipulator' as const,
                device_name: deviceName || (runtimeHealthy ? 'runtime' : 'configured'),
            }]
            : [];

        let resolvedPort = 8040;
        try {
            resolvedPort = Number(new URL(getBackendBaseUrl()).port || '80');
        } catch {
            resolvedPort = 8040;
        }

        return {
            status: backendHealthy && runtimeHealthy ? 'ok' : 'error',
            name: 'kecyai',
            robots: robotStatus.map((robot) => robot.name),
            robot_status: robotStatus,
            cameras: {},
            is_recording: false,
            ai_running_status: teleopStatus?.state === 'running' ? 'running' : 'stopped',
            leader_follower_status: teleopStatus?.state === 'running',
            server_ip: '127.0.0.1',
            server_port: resolvedPort,
        };
    }

    // ── Teleop ────────────────────────────────────────────────────────

    static async teleopStatus(): Promise<TeleopStatus> {
        return this.fetch<TeleopStatus>('/api/lerobot/teleop/status', { timeout: 3000 });
    }

    static async teleopStart(config?: { robot_type?: string; teleop_type?: string; robot_port?: string; teleop_port?: string }): Promise<TeleopStatus> {
        return this.fetch<TeleopStatus>('/api/lerobot/teleop/start', {
            method: 'POST',
            body: JSON.stringify(config ?? { robot_type: 'so101_follower', teleop_type: 'web' }),
            timeout: 15000,
        });
    }

    static async teleopStop(): Promise<TeleopStatus> {
        return this.fetch<TeleopStatus>('/api/lerobot/teleop/stop', {
            method: 'POST',
            timeout: 10000,
        });
    }

    static async teleopLogs(tail: number = 150): Promise<TeleopLogResponse> {
        return this.fetch<TeleopLogResponse>(withQuery('/api/lerobot/teleop/logs', { tail }));
    }

    static teleopTelemetryStreamUrl(): string {
        return `${getBackendBaseUrl()}/api/lerobot/teleop/telemetry/stream`;
    }

    static async gamepadStatus(): Promise<RuntimeGamepadStatus> {
        return this.fetch<RuntimeGamepadStatus>('/api/lerobot/gamepad/status', { timeout: 3000 });
    }

    static async gamepadStart(payload?: { controller_index?: number | null; speed?: number }): Promise<RuntimeGamepadStatus> {
        return this.fetch<RuntimeGamepadStatus>('/api/lerobot/gamepad/start', {
            method: 'POST',
            body: JSON.stringify(payload ?? {}),
            timeout: 5000,
        });
    }

    static async gamepadStop(): Promise<RuntimeGamepadStatus> {
        return this.fetch<RuntimeGamepadStatus>('/api/lerobot/gamepad/stop', {
            method: 'POST',
            body: JSON.stringify({}),
            timeout: 5000,
        });
    }

    static async gamepadConfigure(payload?: { controller_index?: number | null; speed?: number }): Promise<RuntimeGamepadStatus> {
        return this.fetch<RuntimeGamepadStatus>('/api/lerobot/gamepad/config', {
            method: 'POST',
            body: JSON.stringify(payload ?? {}),
            timeout: 5000,
        });
    }

    /**
     * Read joint positions from the runtime.
     * Backend: GET /api/lerobot/teleop/joints → { joints: [{id, name, position, min, max}] }
     *
     * For backward compatibility, this also returns an `angles` array derived
     * from the joint positions so existing callers don't break.
     */
    static async readJoints(args?: {
        robotId?: number;
        unit?: string;
        joints_ids?: number[] | null;
        source?: string;
    }): Promise<{ joints: Array<{ id: string; servo_id?: number; name: string; position: number; temperature?: number | null; min: number; max: number }>; angles: Array<number | null> }> {
        const data = await this.fetch<{
            joints?: Array<{ id: string; servo_id?: number; name: string; position: number; temperature?: number | null; min: number; max: number }>;
            angles?: Array<number | null>;
        }>(
            withQuery('/api/lerobot/teleop/joints', {
                unit: args?.unit || 'degrees',
                joints_ids: Array.isArray(args?.joints_ids) ? args?.joints_ids.join(',') : undefined,
                source: args?.source || 'robot',
            }),
            { timeout: 3000 }
        );
        return {
            joints: data.joints ?? [],
            angles: data.angles ?? (data.joints ?? []).map(j => j.position),
        };
    }

    /**
     * Write joint positions.
     * Maps legacy writeJoints({angles, unit, joints_ids}) calls to
     * the KECYAI POST /api/lerobot/teleop/command endpoint.
     */
    static async writeJoints(args: {
        robotId?: number;
        angles: number[];
        unit?: string;
        joints_ids?: number[] | null;
        joint_names?: string[] | null;
    }): Promise<{ status: string; message?: string }> {
        // Servo-ID-to-name lookup (matches SO-101 hardware)
        const SERVO_ID_TO_NAME: Record<number, string> = {
            1: 'shoulder_pan',
            2: 'shoulder_lift',
            3: 'elbow_flex',
            4: 'wrist_flex',
            5: 'wrist_roll',
            6: 'gripper',
        };
        const ALL_JOINT_NAMES = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];

        const joints = args.angles.map((pos, i) => {
            // Priority: explicit joint_names > servo ID lookup > fallback by index
            let name: string;
            if (args.joint_names && args.joint_names[i]) {
                name = args.joint_names[i];
            } else if (args.joints_ids && args.joints_ids[i] != null) {
                name = SERVO_ID_TO_NAME[args.joints_ids[i]] ?? `joint_${args.joints_ids[i]}`;
            } else {
                name = ALL_JOINT_NAMES[i] ?? `joint_${i}`;
            }
            return { id: name, position: pos };
        });

        return this.fetch('/api/lerobot/teleop/command', {
            method: 'POST',
            body: JSON.stringify({ mode: 'manual', unit: args.unit || 'degrees', joints }),
            timeout: 3000,
        });
    }

    /**
     * Set a single joint position.
     * Backend: POST /api/lerobot/teleop/joints/set → { status: "ok" }
     */
    static async setJoint(jointId: string, value: number): Promise<{ status: string }> {
        return this.fetch('/api/lerobot/teleop/joints/set', {
            method: 'POST',
            body: JSON.stringify({ jointId, value }),
            timeout: 3000,
        });
    }

    /**
     * Send a batch of joint commands.
     * Backend: POST /api/lerobot/teleop/command
     */
    static async sendCommand(joints: Array<{ id: string; position: number }>, mode: string = 'manual'): Promise<unknown> {
        return this.fetch('/api/lerobot/teleop/command', {
            method: 'POST',
            body: JSON.stringify({ mode, joints }),
            timeout: 3000,
        });
    }

    // ── Poses ─────────────────────────────────────────────────────────

    /** Move robot to home/init position. */
    static async moveInit(_robotId: number = 0): Promise<{ status: string; message?: string }> {
        return this.fetch('/api/lerobot/teleop/pose/home', {
            method: 'POST',
            timeout: 15000,
        });
    }

    /** Alias for moveInit. */
    static async poseHome(robotId: number = 0): Promise<{ status: string; message?: string }> {
        return this.moveInit(robotId);
    }

    /** Move robot to safe home position before stopping. */
    static async moveSleep(_robotId: number = 0): Promise<{ status: string; message?: string }> {
        return this.fetch('/api/lerobot/teleop/pose/home', {
            method: 'POST',
            timeout: 10000,
        });
    }

    /**
     * Cartesian absolute move compatibility shim.
     * Maps to writeJoints with zero positions as a best-effort fallback
     * since KECY AI uses joint-based control rather than cartesian IK.
     */
    static async moveAbsolute(
        _robotId: number,
        _payload: { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; open?: number }
    ): Promise<{ status: string; message?: string }> {
        // Map to zero-position joint command (used primarily for homing)
        const JOINT_IDS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
        const joints = JOINT_IDS.map(id => ({ id, position: 0 }));
        return this.fetch('/api/lerobot/teleop/command', {
            method: 'POST',
            body: JSON.stringify({ mode: 'manual', joints }),
            timeout: 15000,
        });
    }

    /**
     * Cartesian relative move compatibility shim.
     * Sends the delta payload to the teleop command endpoint.
     * The runtime handles conversion to joint space if supported,
     * otherwise this acts as a no-op.
     */
    static async moveRelative(
        _robotId: number,
        payload: { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; open?: number }
    ): Promise<{ status: string; message?: string }> {
        return this.fetch('/api/lerobot/teleop/command', {
            method: 'POST',
            body: JSON.stringify({ mode: 'cartesian_delta', ...payload }),
            timeout: 3000,
        });
    }

    // ── E-STOP ────────────────────────────────────────────────────────

    static async estopOn(): Promise<{ estop: boolean }> {
        return this.fetch<{ estop: boolean }>('/api/lerobot/teleop/estop/on', { method: 'POST', timeout: 3000 });
    }

    static async estopOff(): Promise<{ estop: boolean }> {
        return this.fetch<{ estop: boolean }>('/api/lerobot/teleop/estop/off', { method: 'POST', timeout: 3000 });
    }

    // ── Gripper ───────────────────────────────────────────────────────

    static async gripperOpen(): Promise<unknown> {
        return this.fetch('/api/lerobot/teleop/gripper/open', { method: 'POST', timeout: 3000 });
    }

    static async gripperClose(): Promise<unknown> {
        return this.fetch('/api/lerobot/teleop/gripper/close', { method: 'POST', timeout: 3000 });
    }

    // ── Torque (passthrough to runtime if available) ──────────────────

    static async readTorque(robotId: number = 0): Promise<TorqueReadResponse> {
        return this.fetch<TorqueReadResponse>(
            withQuery('/api/lerobot/teleop/torque/read', { robot_id: robotId }),
            { method: 'POST', body: JSON.stringify({}), timeout: 3000 }
        );
    }

    static async toggleTorque(args: {
        robotId?: number | null;
        torque_status: boolean;
    }): Promise<{ status: string; message?: string }> {
        return this.fetch(
            withQuery('/api/lerobot/teleop/torque/toggle', { robot_id: args.robotId }),
            { method: 'POST', body: JSON.stringify({ torque_status: args.torque_status }), timeout: 3000 }
        );
    }

    // ── Calibration ───────────────────────────────────────────────────

    /** Compatibility helper for single-step calibration start. */
    static async calibrate(robotId: number = 0): Promise<CalibrationResponse> {
        return this.fetch<CalibrationResponse>(
            '/api/lerobot/calibration/start',
            { method: 'POST', body: JSON.stringify({ robot_id: robotId }), timeout: 15000 }
        );
    }

    static async calibrationStatus(): Promise<CalibrationStatus> {
        return this.fetch<CalibrationStatus>('/api/lerobot/calibration/status');
    }

    static async calibrationStart(payload?: CalibrationStartRequest): Promise<CalibrationStatus> {
        return this.fetch<CalibrationStatus>('/api/lerobot/calibration/start', {
            method: 'POST',
            body: JSON.stringify(payload ?? {}),
            timeout: 30000, // hardware connect (COM port open + servo init) can take 10-15s
        });
    }

    static async calibrationStep(payload?: Record<string, unknown>): Promise<CalibrationStepResponse> {
        return this.fetch<CalibrationStepResponse>('/api/lerobot/calibration/step', {
            method: 'POST',
            body: JSON.stringify(payload ?? {}),
            timeout: 15000, // confirm step writes homing offsets to 6 motors
        });
    }

    static async calibrationStop(): Promise<{ state: string; message: string }> {
        return this.fetch<{ state: string; message: string }>('/api/lerobot/calibration/stop', {
            method: 'POST',
        });
    }

    // ── Admin / Hardware ──────────────────────────────────────────────

    static async adminPreflight(robotType: string = 'so101_follower'): Promise<{
        ready: boolean;
        mode: string;
        checks: Array<{ id: string; status: string; details: string }>;
        hints: string[];
    }> {
        return this.fetch(withQuery('/api/lerobot/admin/preflight', { robot_type: robotType }));
    }

    static async adminGetConfig(): Promise<{
        serial_port: string;
        robot_type: string;
        driver: string;
        dry_run: boolean;
        mode: string;
    }> {
        return this.fetch('/api/lerobot/admin/config');
    }

    static async adminSetConfig(config: {
        serial_port?: string;
        robot_type?: string;
        driver?: string;
        dry_run?: boolean;
    }): Promise<{
        serial_port: string;
        robot_type: string;
        driver: string;
        dry_run: boolean;
        mode: string;
    }> {
        return this.fetch('/api/lerobot/admin/config', {
            method: 'POST',
            body: JSON.stringify(config),
        });
    }

    static async adminScanMotorPorts(): Promise<AdminPortScanResponse> {
        const data = await this.fetch<{
            status: string;
            ports: string[];
            source: string;
            stdout: string[];
            stderr: string[];
            exit_code: number | null;
        }>('/api/lerobot/admin/ports/scan', { timeout: 10000 });
        return {
            status: (data.ports?.length > 0 ? 'ok' : 'empty') as AdminPortScanResponse['status'],
            ports: data.ports ?? [],
            source: data.source ?? 'kecyai_scan',
            message: data.ports?.length > 0 ? 'Detected USB serial devices.' : 'No USB serial devices detected.',
            stdout: data.stdout ?? [],
            stderr: data.stderr ?? [],
            exit_code: data.exit_code ?? 0,
        };
    }

    /** @deprecated Use adminScanMotorPorts instead. */
    static async scanLocalDevices(): Promise<{ devices: Array<{ name: string; device: string; serial_number?: string | null }> }> {
        const scan = await this.adminScanMotorPorts();
        return {
            devices: scan.ports.map(port => ({ name: port, device: port })),
        };
    }

    static async adminMotorSetupStart(payload: {
        flow: 'follower' | 'leader';
        port: string;
    }): Promise<MotorSetupStatus> {
        return this.fetch<MotorSetupStatus>('/api/lerobot/admin/motors/setup/start', {
            method: 'POST',
            body: JSON.stringify(payload),
            timeout: 20000,
        });
    }

    static async adminMotorSetupStatus(): Promise<MotorSetupStatus> {
        return this.fetch<MotorSetupStatus>('/api/lerobot/admin/motors/setup/status');
    }

    static async adminMotorSetupEnter(times: number = 1): Promise<MotorSetupStatus> {
        return this.fetch<MotorSetupStatus>('/api/lerobot/admin/motors/setup/enter', {
            method: 'POST',
            body: JSON.stringify({ times }),
        });
    }

    static async adminMotorSetupStop(): Promise<MotorSetupStatus> {
        return this.fetch<MotorSetupStatus>('/api/lerobot/admin/motors/setup/stop', {
            method: 'POST',
        });
    }

    static async adminMotorSetupLogs(args?: {
        since?: number;
        tail?: number;
    }): Promise<MotorSetupLogsResponse> {
        return this.fetch<MotorSetupLogsResponse>(
            withQuery('/api/lerobot/admin/motors/setup/logs', args),
            { timeout: 10000 }
        );
    }

    static async adminCalibrationList(): Promise<{
        artifacts: Array<{
            id: string;
            path: string;
            robot_type: string;
            timestamp: string;
            dry_run: boolean;
            joint_count: number;
        }>;
    }> {
        return this.fetch('/api/lerobot/admin/calibration/list');
    }

    static async adminCalibrationLatest(robotType: string = 'so101_follower'): Promise<{
        id: string;
        path: string;
        robot_type: string;
        timestamp: string;
    }> {
        return this.fetch(withQuery('/api/lerobot/admin/calibration/latest', { robot_type: robotType }));
    }

    static async adminCalibrationSelect(artifactId: string): Promise<{
        selected_artifact: string;
        path: string;
        selected_at: number;
        robot_type: string;
    }> {
        return this.fetch('/api/lerobot/admin/calibration/select', {
            method: 'POST',
            body: JSON.stringify({ artifactId }),
        });
    }

    // ── Recording ─────────────────────────────────────────────────────

    static async recordingStart(config: {
        robot_type?: string;
        mode?: string;
        episode_duration_sec?: number;
        num_episodes?: number;
    } = {}): Promise<unknown> {
        return this.fetch('/api/lerobot/recording/start', {
            method: 'POST',
            body: JSON.stringify(config),
            timeout: 10000,
        });
    }

    static async recordingStop(save: boolean = true): Promise<unknown> {
        return this.fetch('/api/lerobot/recording/stop', {
            method: 'POST',
            body: JSON.stringify({ save }),
            timeout: 10000,
        });
    }

    static async recordingDiscard(): Promise<unknown> {
        return this.recordingStop(false);
    }

    static async recordingReplay(episodeIndex: number = -1): Promise<unknown> {
        return this.fetch('/api/lerobot/recording/replay', {
            method: 'POST',
            body: JSON.stringify({ episode_index: episodeIndex }),
            timeout: 10000,
        });
    }

    static async recordingStatus(): Promise<{
        state: string;
        session_id?: string;
        dataset_id?: string;
        robot_type?: string;
        mode?: string;
        episode_count?: number;
        frame_count?: number;
        started_at?: string;
    }> {
        return this.fetch('/api/lerobot/recording/status');
    }

    static async recordingDatasets(): Promise<{
        datasets: Array<{
            id: string;
            robot_type: string;
            episode_count: number;
            total_frames: number;
            mode: string;
            created_at: string;
            duration_sec: number;
        }>;
    }> {
        return this.fetch('/api/lerobot/recording/datasets');
    }

    // ── Training ──────────────────────────────────────────────────────

    static async trainingStart(config: {
        dataset_id: string;
        policy_type?: string;
        num_steps?: number;
        batch_size?: number;
    }): Promise<unknown> {
        return this.fetch('/api/lerobot/train/start', {
            method: 'POST',
            body: JSON.stringify(config),
            timeout: 10000,
        });
    }

    static async trainingStop(): Promise<unknown> {
        return this.fetch('/api/lerobot/train/stop', { method: 'POST', timeout: 10000 });
    }

    static async trainingStatus(): Promise<{
        state: string;
        job_id?: string;
        dataset_id?: string;
        policy_type?: string;
        current_step?: number;
        total_steps?: number;
        progress_pct?: number;
        metrics?: { loss?: number; lr?: number; step?: number };
        started_at?: string;
    }> {
        return this.fetch('/api/lerobot/train/status');
    }

    static async trainingArtifacts(): Promise<{
        artifacts: Array<{
            id: string;
            dataset_id: string;
            policy_type: string;
            num_steps: number;
            status: string;
            final_loss: number | null;
            created_at: string;
        }>;
    }> {
        return this.fetch('/api/lerobot/train/artifacts');
    }

    static connectTrainingLogStream(
        onData: (data: { logs: string[]; cursor: number; state: string; done?: boolean }) => void,
        onError?: (error: Event) => void,
    ): EventSource {
        const es = new EventSource(`${getBackendBaseUrl()}/api/lerobot/train/logs/stream`);

        es.onmessage = (event) => {
            try {
                onData(JSON.parse(event.data));
            } catch {
                // Ignore malformed events.
            }
        };

        es.onerror = (event) => {
            onError?.(event);
        };

        return es;
    }
}

export const lerobotClient = LeRobotClient;
