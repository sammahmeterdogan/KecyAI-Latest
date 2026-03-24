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

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------
// In dev, Vite proxies /api/* to the backend (default http://127.0.0.1:8080).
// In production, a reverse proxy (nginx / Cloudflare) does the same.
// Use empty string (relative URL) unless explicitly overridden.
const API_BASE = (import.meta.env.VITE_KECYAI_BACKEND_URL as string | undefined) || '';

type FetchOptions = RequestInit & { timeout?: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class LeRobotClient {

    // ── Core fetch ────────────────────────────────────────────────────

    private static async fetch<T>(endpoint: string, options?: FetchOptions): Promise<T> {
        const controller = new AbortController();
        const timeout = options?.timeout ?? 5000;
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const res = await fetch(`${API_BASE}${endpoint}`, {
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

    // ── Health & Metadata ─────────────────────────────────────────────

    static async getHealth(): Promise<LeRobotHealth> {
        return this.fetch<LeRobotHealth>('/api/lerobot/health', { timeout: 3000 });
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

    /**
     * PhosphoBot-compatible /status wrapper.
     * Returns a ServerStatus shape by fetching teleop status + health.
     * Callers that only need health should use getHealth() instead.
     */
    static async getServerStatus(): Promise<ServerStatus> {
        try {
            const health = await this.fetch<{ status: string }>('/api/health', { timeout: 3000 });
            return {
                status: health.status === 'ok' ? 'ok' : 'error',
                name: 'kecyai',
                robots: [],
                robot_status: [],
                cameras: {},
                is_recording: false,
                ai_running_status: 'stopped',
                leader_follower_status: false,
                server_ip: '',
                server_port: 0,
            };
        } catch {
            throw new Error('Backend unreachable');
        }
    }

    // ── Teleop ────────────────────────────────────────────────────────

    static async teleopStatus(): Promise<TeleopStatus> {
        return this.fetch<TeleopStatus>('/api/lerobot/teleop/status', { timeout: 3000 });
    }

    static async teleopStart(config?: { robot_type?: string; teleop_type?: string }): Promise<TeleopStatus> {
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
    }): Promise<{ joints: Array<{ id: string; name: string; position: number; min: number; max: number }>; angles: Array<number | null> }> {
        const data = await this.fetch<{ joints: Array<{ id: string; name: string; position: number; min: number; max: number }> }>(
            '/api/lerobot/teleop/joints', { timeout: 3000 }
        );
        return {
            joints: data.joints ?? [],
            angles: (data.joints ?? []).map(j => j.position),
        };
    }

    /**
     * Write joint positions.
     * Maps the PhosphoBot writeJoints({angles, unit, joints_ids}) call to
     * the KECY AI POST /api/lerobot/teleop/command endpoint.
     */
    static async writeJoints(args: {
        robotId?: number;
        angles: number[];
        unit?: string;
        joints_ids?: number[] | null;
    }): Promise<{ status: string; message?: string }> {
        const JOINT_IDS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
        const joints = args.angles.map((pos, i) => ({
            id: JOINT_IDS[i] ?? `joint_${i}`,
            position: pos,
        }));
        return this.fetch('/api/lerobot/teleop/command', {
            method: 'POST',
            body: JSON.stringify({ mode: 'manual', joints }),
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

    /** Move robot to home/init position. Maps PhosphoBot moveInit. */
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

    /** Move robot to sleep/stop position. Maps PhosphoBot moveSleep. */
    static async moveSleep(_robotId: number = 0): Promise<{ status: string; message?: string }> {
        return this.fetch('/api/lerobot/teleop/stop', {
            method: 'POST',
            timeout: 10000,
        });
    }

    /**
     * Cartesian absolute move (PhosphoBot compatibility).
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
     * Cartesian relative move (PhosphoBot compatibility).
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

    /** PhosphoBot-compatible single-step calibrate. */
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
        });
    }

    static async calibrationStep(payload?: Record<string, unknown>): Promise<CalibrationStepResponse> {
        return this.fetch<CalibrationStepResponse>('/api/lerobot/calibration/step', {
            method: 'POST',
            body: JSON.stringify(payload ?? {}),
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
        const base = API_BASE || window.location.origin;
        const es = new EventSource(`${base}/api/lerobot/train/logs/stream`);

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
