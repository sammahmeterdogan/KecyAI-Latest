import {
    LeRobotCapabilitiesResponse,
    LeRobotHealth,
    LeRobotVersion,
    TeleopJointSetRequest,
    TeleopStatus,
    TeleopLogResponse,
    TeleopStartRequest,
    TeleopJointsResponse,
    TeleopCommandRequest,
    TeleopCommandResponse,
    TeleopTelemetryEvent,
    CalibrationStatus,
    CalibrationStartRequest,
    CalibrationStepResponse,
    AdminPortScanResponse,
    MotorSetupStatus,
    MotorSetupLogsResponse,
} from '../../types/lerobot';

const API_BASE = '/api/lerobot';

export class LeRobotClient {
    private static async fetch<T>(endpoint: string, options?: RequestInit & { timeout?: number }): Promise<T> {
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
                }
            });

            if (!res.ok) {
                // Try to read error body as text safely
                let errorBody: string | any;
                try {
                    const text = await res.text();
                    try {
                        errorBody = JSON.parse(text);
                    } catch {
                        errorBody = text;
                    }
                } catch {
                    errorBody = 'Unknown error';
                }

                let errorMsg = `API Error: ${res.status} ${res.statusText}`;
                if (typeof errorBody === 'object' && (errorBody?.message || errorBody?.error)) {
                    errorMsg += ` - ${errorBody.message || errorBody.error}`;
                } else if (typeof errorBody === 'string' && errorBody) {
                    errorMsg += ` - ${errorBody.substring(0, 100)}`;
                }

                const err = new Error(errorMsg) as any;
                err.status = res.status;
                err.body = errorBody;
                throw err;
            }

            // Safe JSON parse for success responses
            const text = await res.text();
            if (!text) return {} as T; // Handle empty body gracefully

            try {
                return JSON.parse(text) as T;
            } catch (e) {
                console.error("JSON Parse Error on success body:", text);
                throw new Error("Invalid JSON response");
            }
        } catch (error: any) {
            if (error.name === 'AbortError') {
                throw new Error('Request timed out');
            }
            throw error;
        } finally {
            clearTimeout(id);
        }
    }

    static async getHealth(): Promise<LeRobotHealth> {
        return this.fetch<LeRobotHealth>('/health', { timeout: 2000 });
    }

    /** Fast ping to check connectivity */
    static async ping(): Promise<boolean> {
        try {
            await this.fetch('/health', { timeout: 1000 });
            return true;
        } catch {
            return false;
        }
    }

    static async getVersion(): Promise<LeRobotVersion> {
        return this.fetch<LeRobotVersion>('/version');
    }

    static async getCapabilities(): Promise<LeRobotCapabilitiesResponse> {
        return this.fetch<LeRobotCapabilitiesResponse>('/capabilities');
    }

    // --- Teleop Methods ---

    static async teleopStatus(): Promise<TeleopStatus> {
        return this.fetch<TeleopStatus>('/teleop/status');
    }

    static async teleopStart(payload: TeleopStartRequest): Promise<TeleopStatus> {
        return this.fetch<TeleopStatus>('/teleop/start', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    static async teleopStop(): Promise<TeleopStatus> {
        return this.fetch<TeleopStatus>('/teleop/stop', {
            method: 'POST'
        });
    }

    static async teleopLogs(tail: number = 200): Promise<TeleopLogResponse> {
        return this.fetch<TeleopLogResponse>(`/teleop/logs?tail=${tail}`);
    }

    static async setJoint(payload: TeleopJointSetRequest): Promise<{ status: string }> {
        return this.fetch<{ status: string }>('/teleop/joints/set', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    /** Get current joint positions from runtime. */
    static async getJoints(): Promise<TeleopJointsResponse> {
        return this.fetch<TeleopJointsResponse>('/teleop/joints');
    }

    /** Batch command: send multiple joint targets at once. */
    static async sendCommand(payload: TeleopCommandRequest): Promise<TeleopCommandResponse> {
        return this.fetch<TeleopCommandResponse>('/teleop/command', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    static async poseHome(): Promise<{ status: string }> {
        return this.fetch<{ status: string }>('/teleop/pose/home', {
            method: 'POST'
        });
    }

    static async poseReady(): Promise<{ status: string }> {
        return this.fetch<{ status: string }>('/teleop/pose/ready', {
            method: 'POST'
        });
    }

    static async gripperOpen(): Promise<{ status: string }> {
        return this.fetch<{ status: string }>('/teleop/gripper/open', {
            method: 'POST'
        });
    }

    static async gripperClose(): Promise<{ status: string }> {
        return this.fetch<{ status: string }>('/teleop/gripper/close', {
            method: 'POST'
        });
    }

    /** Engage emergency stop. */
    static async estopOn(): Promise<{ estop: boolean; message: string }> {
        return this.fetch<{ estop: boolean; message: string }>('/teleop/estop/on', {
            method: 'POST'
        });
    }

    /** Release emergency stop. */
    static async estopOff(): Promise<{ estop: boolean; message: string }> {
        return this.fetch<{ estop: boolean; message: string }>('/teleop/estop/off', {
            method: 'POST'
        });
    }

    // ─── Calibration Methods ───

    static async calibrationStatus(): Promise<CalibrationStatus> {
        return this.fetch<CalibrationStatus>('/calibration/status');
    }

    static async calibrationStart(payload?: CalibrationStartRequest): Promise<CalibrationStatus> {
        return this.fetch<CalibrationStatus>('/calibration/start', {
            method: 'POST',
            body: JSON.stringify(payload ?? {}),
        });
    }

    static async calibrationStep(payload?: Record<string, any>): Promise<CalibrationStepResponse> {
        return this.fetch<CalibrationStepResponse>('/calibration/step', {
            method: 'POST',
            body: JSON.stringify(payload ?? {}),
        });
    }

    static async calibrationStop(): Promise<{ state: string; message: string }> {
        return this.fetch<{ state: string; message: string }>('/calibration/stop', {
            method: 'POST',
        });
    }

    /**
     * Connect to the SSE telemetry stream.
     * Returns an EventSource that emits 'message' events with TeleopTelemetryEvent data.
     *
     * Usage:
     *   const es = LeRobotClient.connectTelemetryStream(data => { ... });
     *   // Later: es.close() to disconnect
     */
    static connectTelemetryStream(
        onData: (data: TeleopTelemetryEvent) => void,
        onError?: (error: Event) => void,
    ): EventSource {
        const es = new EventSource(`${API_BASE}/teleop/telemetry/stream`);

        es.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data) as TeleopTelemetryEvent;
                onData(parsed);
            } catch {
                // Ignore malformed events
            }
        };

        es.onerror = (event) => {
            onError?.(event);
        };

        return es;
    }

    // ─── Admin / Hardware Methods ───

    /** Get hardware preflight check results. */
    static async adminPreflight(robotType: string = 'so101_follower'): Promise<{
        ready: boolean;
        mode: string;
        checks: Array<{ id: string; status: string; details: string }>;
        hints: string[];
    }> {
        return this.fetch(`/admin/preflight?robot_type=${encodeURIComponent(robotType)}`);
    }

    /** Get current hardware configuration. */
    static async adminGetConfig(): Promise<{
        serial_port: string;
        robot_type: string;
        driver: string;
        dry_run: boolean;
        mode: string;
    }> {
        return this.fetch('/admin/config');
    }

    /** Update hardware configuration. */
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
        return this.fetch('/admin/config', {
            method: 'POST',
            body: JSON.stringify(config),
        });
    }

    /** Run motor port scan via runtime (lerobot-find-port + fallback enumeration). */
    static async adminScanMotorPorts(): Promise<AdminPortScanResponse> {
        return this.fetch<AdminPortScanResponse>('/admin/ports/scan', { timeout: 15000 });
    }

    /** Start interactive motor setup session in runtime. */
    static async adminMotorSetupStart(payload: {
        flow: 'follower' | 'leader';
        port: string;
    }): Promise<MotorSetupStatus> {
        return this.fetch<MotorSetupStatus>('/admin/motors/setup/start', {
            method: 'POST',
            body: JSON.stringify(payload),
            timeout: 20000,
        });
    }

    /** Get motor setup session status. */
    static async adminMotorSetupStatus(): Promise<MotorSetupStatus> {
        return this.fetch<MotorSetupStatus>('/admin/motors/setup/status');
    }

    /** Send Enter input to motor setup process. */
    static async adminMotorSetupEnter(times: number = 1): Promise<MotorSetupStatus> {
        return this.fetch<MotorSetupStatus>('/admin/motors/setup/enter', {
            method: 'POST',
            body: JSON.stringify({ times }),
        });
    }

    /** Stop active motor setup session. */
    static async adminMotorSetupStop(): Promise<MotorSetupStatus> {
        return this.fetch<MotorSetupStatus>('/admin/motors/setup/stop', {
            method: 'POST',
        });
    }

    /** Read motor setup logs incrementally or by tail. */
    static async adminMotorSetupLogs(args?: {
        since?: number;
        tail?: number;
    }): Promise<MotorSetupLogsResponse> {
        const params = new URLSearchParams();
        if (args?.since !== undefined) params.set('since', String(args.since));
        if (args?.tail !== undefined) params.set('tail', String(args.tail));
        const suffix = params.toString() ? `?${params.toString()}` : '';
        return this.fetch<MotorSetupLogsResponse>(`/admin/motors/setup/logs${suffix}`, { timeout: 10000 });
    }

    /** List all calibration artifacts. */
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
        return this.fetch('/admin/calibration/list');
    }

    /** Get latest calibration artifact for a robot type. */
    static async adminCalibrationLatest(robotType: string = 'so101_follower'): Promise<{
        id: string;
        path: string;
        robot_type: string;
        timestamp: string;
    }> {
        return this.fetch(`/admin/calibration/latest?robot_type=${encodeURIComponent(robotType)}`);
    }

    /** Select a calibration artifact for use during teleop. */
    static async adminCalibrationSelect(artifactId: string): Promise<{
        selected_artifact: string;
        path: string;
        selected_at: number;
        robot_type: string;
    }> {
        return this.fetch('/admin/calibration/select', {
            method: 'POST',
            body: JSON.stringify({ artifactId }),
        });
    }

    // ─── Recording Methods ───

    static async recordingStart(config: {
        robot_type?: string;
        mode?: string;
        episode_duration_sec?: number;
        num_episodes?: number;
    } = {}): Promise<any> {
        return this.fetch('/recording/start', {
            method: 'POST',
            body: JSON.stringify(config),
            timeout: 10000,
        });
    }

    static async recordingStop(): Promise<any> {
        return this.fetch('/recording/stop', { method: 'POST', timeout: 10000 });
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
        return this.fetch('/recording/status');
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
        return this.fetch('/recording/datasets');
    }

    // ─── Training Methods ───

    static async trainingStart(config: {
        dataset_id: string;
        policy_type?: string;
        num_steps?: number;
        batch_size?: number;
    }): Promise<any> {
        return this.fetch('/train/start', {
            method: 'POST',
            body: JSON.stringify(config),
            timeout: 10000,
        });
    }

    static async trainingStop(): Promise<any> {
        return this.fetch('/train/stop', { method: 'POST', timeout: 10000 });
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
        return this.fetch('/train/status');
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
        return this.fetch('/train/artifacts');
    }

    /**
     * Connect to the SSE training log stream.
     * Returns an EventSource. Close it when done.
     */
    static connectTrainingLogStream(
        onData: (data: { logs: string[]; cursor: number; state: string; done?: boolean }) => void,
        onError?: (error: Event) => void,
    ): EventSource {
        const es = new EventSource(`${API_BASE}/train/logs/stream`);

        es.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                onData(parsed);
                if (parsed.done) {
                    es.close();
                }
            } catch {
                // Ignore malformed events
            }
        };

        es.onerror = (event) => {
            onError?.(event);
        };

        return es;
    }
}

export const lerobotClient = LeRobotClient;
