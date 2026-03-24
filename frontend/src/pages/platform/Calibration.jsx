import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    Loader2,
    Play,
    RefreshCw,
    RotateCcw,
    Server,
    Usb,
} from 'lucide-react';
import { lerobotClient } from '../../lib/api/lerobotClient';
import calibrationPosition1 from '../../assets/calibration/CalibrationPosition1.jpg';
import calibrationPosition2 from '../../assets/calibration/CalibrationPosition2.jpg';
import styles from './TeleopControl.module.css';

const TAB_STORAGE_KEY = 'kecyai.calibration.active-tab';
const HISTORY_POINTS = 32;
const POSITION_LIMIT = 4095;
const TORQUE_LIMIT = 200;
const TERMINAL_LIMIT = 72;
const ESTOP_HOLD_MS = 1100;

const JOINTS = [
    { id: 1, label: 'JOINT 1' },
    { id: 2, label: 'JOINT 2' },
    { id: 3, label: 'JOINT 3' },
    { id: 4, label: 'JOINT 4' },
    { id: 5, label: 'JOINT 5' },
    { id: 6, label: 'GRIPPER' },
];

const STEP_CONTENT = {
    1: {
        id: 1,
        title: 'PREPARE ROBOT',
        description: 'Confirm the target robot, support the arm, and clear the workspace before torque is released.',
        physical: [
            'Keep one hand ready to support the arm.',
            'Verify power and USB are both connected.',
            'Confirm the correct robot and port before starting.',
        ],
        image: calibrationPosition1,
        imageLabel: 'REFERENCE OVERVIEW',
        imageCaption: 'Position 1 and Position 2 use the reference poses shown here. Match them closely before each backend step.',
    },
    2: {
        id: 2,
        title: 'POSITION 1',
        description: 'Move the arm forward and fully close the gripper. The moving claw should sit on the left side.',
        physical: [
            'Bring the arm forward into the shown pose.',
            'Close the gripper completely.',
            'Keep the base steady before advancing.',
        ],
        image: calibrationPosition1,
        imageLabel: 'REFERENCE POSITION 1',
        imageCaption: 'Arm forward. Gripper fully closed. Moving claw on the left side of the arm.',
    },
    3: {
        id: 3,
        title: 'POSITION 2',
        description: 'Twist the arm left and fully open the gripper so the backend can solve the second calibration pose.',
        physical: [
            'Rotate the arm left into the shown pose.',
            'Open the gripper completely.',
            'Hold the pose steady while the backend finishes.',
        ],
        image: calibrationPosition2,
        imageLabel: 'REFERENCE POSITION 2',
        imageCaption: 'Arm twisted left. Gripper fully open. Hold this pose until the backend responds.',
    },
};

const PILL_TONES = {
    neutral: 'border-white/10 bg-white/5 text-white/72',
    ok: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-200',
    warn: 'border-amber-500/30 bg-amber-500/12 text-amber-100',
    error: 'border-red-500/30 bg-red-500/12 text-red-100',
};

function joinClasses(...values) {
    return values.filter(Boolean).join(' ');
}

function getInitialTab() {
    if (typeof window === 'undefined') return 'calibration';
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    return stored === 'joints' ? 'joints' : 'calibration';
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function createPositionHistory(initialValues) {
    return initialValues.map((value) =>
        Array.from({ length: HISTORY_POINTS }, (_, index) => ({
            x: index,
            actual: value,
            goal: value,
        })),
    );
}

function createTorqueHistory(initialValues) {
    return initialValues.map((value) =>
        Array.from({ length: HISTORY_POINTS }, (_, index) => ({
            x: index,
            value,
        })),
    );
}

function buildPath(values, min, max, accessor) {
    const points = values.map((point, index) => {
        const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
        const raw = accessor(point);
        const normalized = max === min ? 0.5 : (raw - min) / (max - min);
        const y = 52 - clamp(normalized, 0, 1) * 52;
        return `${x},${y}`;
    });
    return `M ${points.join(' L ')}`;
}

function formatTimestamp(date = new Date()) {
    return date.toLocaleTimeString([], { hour12: false });
}

function resolveRobotDevice(robot, devices, index) {
    if (!robot) return devices[index] ?? devices[0] ?? null;

    return (
        devices.find((device) =>
            [device.serial_number, device.device, device.name].some(
                (value) => typeof value === 'string' && value === robot.device_name,
            ),
        ) ??
        devices.find((device) => device.name === robot.name) ??
        devices[index] ??
        devices[0] ??
        null
    );
}

function formatRobotName(name) {
    return (name || 'Unknown Robot').toUpperCase();
}

function formatRobotLabel(robot, device) {
    const name = formatRobotName(robot?.name);
    const port = device?.device || robot?.device_name || 'NO PORT';
    return `${name} · ${port}`;
}

function toneClass(tone) {
    return (
        {
            neutral: 'text-white/70',
            ok: 'text-emerald-200',
            warn: 'text-amber-100',
            error: 'text-red-100',
        }[tone] || 'text-white/70'
    );
}

function PanelFrame({ className = '', children }) {
    return (
        <section
            className={joinClasses(
                styles.glassCard,
                styles.fadeInItem,
                'rounded-[1.55rem] border border-white/10 bg-black/72 shadow-[0_18px_48px_rgba(0,0,0,0.32)] backdrop-blur-xl',
                className,
            )}
        >
            {children}
        </section>
    );
}

function StatusPill({ tone = 'neutral', children, className = '' }) {
    return (
        <span
            className={joinClasses(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em]',
                PILL_TONES[tone],
                className,
            )}
        >
            {children}
        </span>
    );
}

function InfoRow({ label, value, tone = 'text-white/78' }) {
    return (
        <div className="flex items-start justify-between gap-3 border-b border-white/8 py-2.5 last:border-b-0 last:pb-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">{label}</div>
            <div className={joinClasses('text-right font-mono text-xs leading-6', tone)}>{value}</div>
        </div>
    );
}

function MiniChart({ data, mode }) {
    const min = mode === 'position' ? 0 : -TORQUE_LIMIT;
    const max = mode === 'position' ? POSITION_LIMIT : TORQUE_LIMIT;
    const primaryPath = buildPath(
        data,
        min,
        max,
        mode === 'position' ? (point) => point.actual : (point) => point.value,
    );
    const goalPath =
        mode === 'position'
            ? buildPath(data, min, max, (point) => point.goal)
            : null;

    return (
        <div className="h-36 rounded-[1.2rem] border border-white/10 bg-black/55 p-3">
            <svg viewBox="0 0 100 52" className="h-full w-full overflow-visible">
                <path d="M 0,0 L 100,0" stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />
                <path d="M 0,26 L 100,26" stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />
                <path d="M 0,52 L 100,52" stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />
                {goalPath ? (
                    <path
                        d={goalPath}
                        fill="none"
                        stroke="rgba(245,158,11,0.72)"
                        strokeDasharray="2.5 2.5"
                        strokeWidth="0.9"
                    />
                ) : null}
                <path
                    d={primaryPath}
                    fill="none"
                    stroke="rgba(16,185,129,0.98)"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                />
            </svg>
        </div>
    );
}

function ReferencePanel({ step }) {
    return (
        <div className="overflow-hidden rounded-[1.35rem] border border-white/10 bg-black/60">
            <div className="relative">
                <img
                    src={step.image}
                    alt={step.title}
                    className="h-[320px] w-full object-cover object-center md:h-[420px]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/18 to-transparent" />
                <div className="absolute left-4 top-4 rounded-full border border-white/12 bg-black/60 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/78 backdrop-blur-xl">
                    {step.imageLabel}
                </div>
                {step.id === 1 ? (
                    <div className="absolute bottom-4 right-4 grid w-[140px] grid-cols-2 gap-2 rounded-[1rem] border border-white/10 bg-black/70 p-2 backdrop-blur-xl">
                        <img src={calibrationPosition1} alt="Position 1 thumbnail" className="h-16 w-full rounded-lg object-cover" />
                        <img src={calibrationPosition2} alt="Position 2 thumbnail" className="h-16 w-full rounded-lg object-cover" />
                    </div>
                ) : null}
            </div>
            <div className="border-t border-white/8 p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">Reference Notes</div>
                <p className="mt-3 max-w-2xl font-mono text-sm leading-7 text-white/64">{step.imageCaption}</p>
            </div>
        </div>
    );
}

function StepPill({ step, active }) {
    return (
        <div
            className={joinClasses(
                'rounded-full border px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] transition-all',
                active
                    ? 'border-emerald-400/36 bg-emerald-500/12 text-emerald-100'
                    : 'border-white/10 bg-transparent text-white/38',
            )}
        >
            {step.title}
        </div>
    );
}

function TerminalPanel({ lines, terminalRef }) {
    return (
        <PanelFrame className="p-4 md:p-5">
            <div className="flex flex-col gap-3 border-b border-white/8 pb-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/34">System Log</div>
                    <div className="mt-2 text-xl font-semibold tracking-[-0.04em] text-white">Live Backend Responses</div>
                </div>
                <StatusPill tone="neutral">Terminal Online</StatusPill>
            </div>

            <div className={joinClasses(styles.dataStream, 'mt-4 rounded-[1.2rem] border border-white/10 bg-black/82')}>
                <div ref={terminalRef} className={joinClasses(styles.logContainer, 'h-56 overflow-y-auto px-4 py-3')}>
                    {lines.length === 0 ? (
                        <div className="font-mono text-xs uppercase tracking-[0.18em] text-white/30">No backend responses yet.</div>
                    ) : (
                        <div className="space-y-2 font-mono text-[12px] leading-6">
                            {lines.map((line) => (
                                <div key={line.id} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
                                    <span className="text-white/26">{line.time}</span>
                                    <span className={toneClass(line.tone)}>{line.message}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </PanelFrame>
    );
}

export default function Calibration() {
    const [activeTab, setActiveTab] = useState(getInitialTab);
    const [serverStatus, setServerStatus] = useState(null);
    const [scanDevices, setScanDevices] = useState([]);
    const [statusError, setStatusError] = useState('');
    const [selectedRobotId, setSelectedRobotId] = useState(0);
    const [runtimeRefreshing, setRuntimeRefreshing] = useState(false);

    const [wizardStep, setWizardStep] = useState(1);
    const [calibrationState, setCalibrationState] = useState('idle');
    const [calibrationMessage, setCalibrationMessage] = useState('');
    const [calibrationError, setCalibrationError] = useState('');
    const [calibrationLoading, setCalibrationLoading] = useState(false);
    const [savedConfigPath, setSavedConfigPath] = useState('');
    const [tutorialOpen, setTutorialOpen] = useState(false);

    const [plotMode, setPlotMode] = useState('position');
    const [updateInterval, setUpdateInterval] = useState(0.15);
    const [jointError, setJointError] = useState('');
    const [torqueActionState, setTorqueActionState] = useState('idle');
    const [goalAngles, setGoalAngles] = useState(Array(JOINTS.length).fill(0));
    const [jointPositions, setJointPositions] = useState(Array(JOINTS.length).fill(0));
    const [jointTorques, setJointTorques] = useState(Array(JOINTS.length).fill(0));
    const [positionHistory, setPositionHistory] = useState(createPositionHistory(Array(JOINTS.length).fill(0)));
    const [torqueHistory, setTorqueHistory] = useState(createTorqueHistory(Array(JOINTS.length).fill(0)));
    const [systemLog, setSystemLog] = useState([
        {
            id: 'boot',
            time: formatTimestamp(),
            tone: 'neutral',
            message: 'Waiting for the calibration backend.',
        },
    ]);
    const [estopHoldProgress, setEstopHoldProgress] = useState(0);

    const initializedJointRobotRef = useRef(null);
    const runtimeSignatureRef = useRef('');
    const mountedRef = useRef(true);
    const terminalRef = useRef(null);
    const estopTimerRef = useRef(null);

    const appendSystemLog = useCallback((message, tone = 'neutral') => {
        setSystemLog((previous) => [
            ...previous.slice(-(TERMINAL_LIMIT - 1)),
            {
                id: `${Date.now()}-${Math.random()}`,
                time: formatTimestamp(),
                tone,
                message,
            },
        ]);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (estopTimerRef.current) {
                window.clearInterval(estopTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(TAB_STORAGE_KEY, activeTab);
        }
    }, [activeTab]);

    useEffect(() => {
        if (!terminalRef.current) return;
        terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }, [systemLog]);

    const fetchRuntime = useCallback(
        async (source = 'poll') => {
            try {
                const [status, devices] = await Promise.all([
                    lerobotClient.getServerStatus(),
                    lerobotClient.scanLocalDevices(),
                ]);

                if (!mountedRef.current) return;

                const nextDevices = Array.isArray(devices.devices) ? devices.devices : [];
                const nextRobotStatuses = Array.isArray(status.robot_status) ? status.robot_status : [];

                setServerStatus(status);
                setScanDevices(nextDevices);
                setStatusError('');
                setSelectedRobotId((current) => (nextRobotStatuses.length > 0 ? clamp(current, 0, nextRobotStatuses.length - 1) : 0));

                const signature = JSON.stringify({
                    status: status.status,
                    robots: nextRobotStatuses.map((robot) => `${robot.name}:${robot.device_name || 'none'}`),
                    devices: nextDevices.map((device) => device.device),
                });

                if (source !== 'poll' || runtimeSignatureRef.current !== signature) {
                    const robotCount = nextRobotStatuses.length;
                    const deviceCount = nextDevices.length;
                    appendSystemLog(
                        `${source === 'manual' ? 'Status refresh complete' : 'Runtime sync'}: ${robotCount} robot${robotCount === 1 ? '' : 's'} / ${deviceCount} device${deviceCount === 1 ? '' : 's'} detected.`,
                        status.status === 'ok' ? 'ok' : 'error',
                    );
                    runtimeSignatureRef.current = signature;
                }
            } catch (error) {
                if (!mountedRef.current) return;
                const message = error?.message || 'Unable to reach the calibration backend.';
                setStatusError(message);

                if (source !== 'poll' || runtimeSignatureRef.current !== 'offline') {
                    appendSystemLog(message, 'error');
                    runtimeSignatureRef.current = 'offline';
                }
            }
        },
        [appendSystemLog],
    );

    useEffect(() => {
        fetchRuntime('initial');
        const interval = window.setInterval(() => {
            fetchRuntime('poll');
        }, 5000);

        return () => {
            window.clearInterval(interval);
        };
    }, [fetchRuntime]);

    const robotStatuses = Array.isArray(serverStatus?.robot_status) ? serverStatus.robot_status : [];
    const robotDevices = useMemo(
        () => robotStatuses.map((robot, index) => resolveRobotDevice(robot, scanDevices, index)),
        [robotStatuses, scanDevices],
    );

    const currentRobot = robotStatuses[selectedRobotId] ?? null;
    const currentDevice = robotDevices[selectedRobotId] ?? null;
    const backendOnline = Boolean(serverStatus) && !statusError;
    const mockFallback = currentRobot?.name?.startsWith?.('mock') || currentRobot?.device_name === 'simulation';
    const progressPct = `${(wizardStep / 3) * 100}%`;
    const currentStep = STEP_CONTENT[clamp(wizardStep, 1, 3)];
    const robotInfoLabel = currentRobot ? formatRobotLabel(currentRobot, currentDevice) : 'NO ROBOT · NO PORT';
    const versionLabel = serverStatus?.version_id ? String(serverStatus.version_id).toUpperCase() : 'LOCAL';

    const calibrationTone =
        calibrationState === 'success'
            ? 'ok'
            : calibrationState === 'error'
                ? 'error'
                : calibrationState === 'in_progress' || calibrationLoading
                    ? 'warn'
                    : 'neutral';

    const calibrationStateLabel =
        calibrationLoading
            ? 'RUNNING'
            : calibrationState === 'success'
                ? 'COMPLETED'
                : calibrationState === 'error'
                    ? 'BLOCKED'
                    : calibrationState === 'in_progress'
                        ? 'IN PROGRESS'
                        : 'READY';

    const calibrationActionLabel =
        calibrationLoading
            ? 'WORKING'
            : calibrationState === 'in_progress'
                ? wizardStep < 3
                    ? 'ADVANCE'
                    : 'COMPLETE'
                : 'START';

    const refreshRuntime = async () => {
        setRuntimeRefreshing(true);
        await fetchRuntime('manual');
        if (mountedRef.current) {
            setRuntimeRefreshing(false);
        }
    };

    useEffect(() => {
        if (activeTab !== 'joints' || !currentRobot) return undefined;

        let cancelled = false;

        const initializeJoints = async () => {
            try {
                const jointResponse = await lerobotClient.readJoints({
                    robotId: selectedRobotId,
                    unit: 'motor_units',
                    joints_ids: null,
                    source: 'robot',
                });

                if (cancelled) return;

                const values = JOINTS.map((_, index) => Number(jointResponse.angles[index] ?? 0));
                initializedJointRobotRef.current = selectedRobotId;
                setGoalAngles(values);
                setJointPositions(values);
                setPositionHistory(createPositionHistory(values));
                setTorqueHistory(createTorqueHistory(Array(JOINTS.length).fill(0)));
                setJointError('');
            } catch (error) {
                if (cancelled) return;
                setJointError(error?.message || 'Unable to initialize joint state.');
            }
        };

        if (initializedJointRobotRef.current !== selectedRobotId) {
            initializeJoints();
        }

        return () => {
            cancelled = true;
        };
    }, [activeTab, currentRobot, selectedRobotId]);

    useEffect(() => {
        if (activeTab !== 'joints' || !currentRobot) return undefined;

        let cancelled = false;

        const pollJointState = async () => {
            try {
                const [jointResponse, torqueResponse] = await Promise.all([
                    lerobotClient.readJoints({
                        robotId: selectedRobotId,
                        unit: 'motor_units',
                        joints_ids: null,
                        source: 'robot',
                    }),
                    lerobotClient.readTorque(selectedRobotId),
                ]);

                if (cancelled) return;

                const nextPositions = JOINTS.map((_, index) => Number(jointResponse.angles[index] ?? 0));
                const nextTorques = JOINTS.map((_, index) => Number(torqueResponse.current_torque[index] ?? 0));

                setJointPositions(nextPositions);
                setJointTorques(nextTorques);
                setPositionHistory((previous) =>
                    previous.map((series, index) => {
                        const next = series.slice(1);
                        next.push({
                            x: series[series.length - 1].x + 1,
                            actual: nextPositions[index],
                            goal: goalAngles[index],
                        });
                        return next;
                    }),
                );
                setTorqueHistory((previous) =>
                    previous.map((series, index) => {
                        const next = series.slice(1);
                        next.push({
                            x: series[series.length - 1].x + 1,
                            value: nextTorques[index],
                        });
                        return next;
                    }),
                );
                setJointError('');
            } catch (error) {
                if (cancelled) return;
                setJointError(error?.message || 'Unable to poll live joint telemetry.');
            }
        };

        pollJointState();
        const interval = window.setInterval(pollJointState, Math.max(updateInterval, 0.05) * 1000);

        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [activeTab, currentRobot, goalAngles, selectedRobotId, updateInterval]);

    const runCalibrationStep = async () => {
        setCalibrationLoading(true);
        setCalibrationError('');
        appendSystemLog(`Calling /calibrate for ${robotInfoLabel}.`, 'warn');

        try {
            const response = await lerobotClient.calibrate(selectedRobotId);
            setCalibrationState(response.calibration_status);
            setCalibrationMessage(response.message);

            const match = response.message.match(/[A-Z]:\\\\[^\n]+\.json|[A-Z]:\\[^\n]+\.json/);
            if (match) {
                setSavedConfigPath(match[0]);
            }

            if (response.calibration_status === 'success') {
                setWizardStep(3);
            } else {
                setWizardStep(clamp(response.current_step + 1, 1, 3));
            }

            if (response.calibration_status === 'error') {
                setCalibrationError(response.message);
            }

            appendSystemLog(
                response.message || `Calibration state: ${response.calibration_status}.`,
                response.calibration_status === 'success'
                    ? 'ok'
                    : response.calibration_status === 'error'
                        ? 'error'
                        : 'warn',
            );
        } catch (error) {
            const message = error?.body?.detail || error?.message || 'Calibration request failed.';
            setCalibrationState('error');
            setCalibrationError(message);
            appendSystemLog(message, 'error');
        } finally {
            setCalibrationLoading(false);
        }
    };

    const resetCalibration = () => {
        setWizardStep(1);
        setCalibrationState('idle');
        setCalibrationMessage('');
        setCalibrationError('');
        setSavedConfigPath('');
        appendSystemLog('Calibration wizard reset locally.', 'neutral');
    };

    const handleTorqueToggle = async (torqueStatus) => {
        setTorqueActionState(torqueStatus ? 'enabling' : 'disabling');
        try {
            await lerobotClient.toggleTorque({ robotId: selectedRobotId, torque_status: torqueStatus });
            setJointError('');
            appendSystemLog(`Torque ${torqueStatus ? 'enabled' : 'disabled'} for ${robotInfoLabel}.`, torqueStatus ? 'ok' : 'warn');
        } catch (error) {
            const message = error?.body?.detail || error?.message || 'Torque update failed.';
            setJointError(message);
            appendSystemLog(message, 'error');
        } finally {
            setTorqueActionState('idle');
        }
    };

    const handleJointWrite = async (jointIndex, value) => {
        const nextGoals = goalAngles.map((angle, index) => (index === jointIndex ? value : angle));
        setGoalAngles(nextGoals);
        setPositionHistory((previous) =>
            previous.map((series, index) =>
                index === jointIndex ? series.map((point) => ({ ...point, goal: value })) : series,
            ),
        );

        try {
            await lerobotClient.writeJoints({
                robotId: selectedRobotId,
                angles: nextGoals,
                unit: 'motor_units',
                joints_ids: null,
            });
            setJointError('');
        } catch (error) {
            const message = error?.body?.detail || error?.message || 'Joint write failed.';
            setJointError(message);
            appendSystemLog(message, 'error');
        }
    };

    const handleRobotSelect = (event) => {
        const nextId = Number(event.target.value);
        setSelectedRobotId(nextId);
        const nextRobot = robotStatuses[nextId] ?? null;
        const nextDevice = robotDevices[nextId] ?? null;
        if (nextRobot) {
            appendSystemLog(`Target robot set to ${formatRobotLabel(nextRobot, nextDevice)}.`, 'neutral');
        }
    };

    const stopEstopHold = useCallback(() => {
        if (estopTimerRef.current) {
            window.clearInterval(estopTimerRef.current);
            estopTimerRef.current = null;
        }
        setEstopHoldProgress(0);
    }, []);

    const startEstopHold = useCallback(() => {
        if (estopTimerRef.current) return;

        const startedAt = performance.now();
        estopTimerRef.current = window.setInterval(() => {
            const nextProgress = clamp(((performance.now() - startedAt) / ESTOP_HOLD_MS) * 100, 0, 100);
            setEstopHoldProgress(nextProgress);

            if (nextProgress >= 100) {
                window.clearInterval(estopTimerRef.current);
                estopTimerRef.current = null;
                appendSystemLog('E-STOP requested, but the current backend does not expose a hardware stop endpoint.', 'error');
                window.setTimeout(() => {
                    if (mountedRef.current) {
                        setEstopHoldProgress(0);
                    }
                }, 350);
            }
        }, 16);
    }, [appendSystemLog]);

    const renderCalibrationTab = () => (
        <div className="grid gap-4">
            <PanelFrame className="p-5 md:p-6">
                <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                        <div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/36">Calibration Wizard</div>
                            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.06em] text-white md:text-5xl">{currentStep.title}</h2>
                            <p
                                className="mt-3 max-w-3xl font-mono text-sm leading-7 text-white/62 md:text-[15px]"
                                style={{
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                }}
                            >
                                {currentStep.description}
                            </p>
                        </div>

                        <div className="text-left md:text-right">
                            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/36">
                                STEP {wizardStep} / 3
                            </div>
                            <div className="mt-3">
                                <StatusPill tone={calibrationTone}>{calibrationStateLabel}</StatusPill>
                            </div>
                        </div>
                    </div>

                    <div className="h-[3px] overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full bg-emerald-400 transition-all duration-300" style={{ width: progressPct }} />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                        <ReferencePanel step={currentStep} />

                        <div className="grid gap-4">
                            <PanelFrame className="p-4 md:p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/36">Current State</div>
                                        <div className="mt-3">
                                            <StatusPill tone={calibrationTone}>{calibrationStateLabel}</StatusPill>
                                        </div>
                                    </div>
                                    {calibrationLoading ? <Loader2 className="h-5 w-5 animate-spin text-amber-200" /> : null}
                                </div>

                                <div className="mt-4 grid gap-3">
                                    <button
                                        onClick={runCalibrationStep}
                                        disabled={calibrationLoading || !backendOnline || !currentRobot}
                                        className={joinClasses(
                                            styles.actionBtn,
                                            'inline-flex items-center justify-center gap-2 rounded-[1.05rem] border border-emerald-400/30 bg-emerald-500/12 px-4 py-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-50 transition-all hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-40',
                                        )}
                                    >
                                        <ArrowRight className="h-4 w-4" />
                                        {calibrationActionLabel}
                                    </button>

                                    <button
                                        onClick={resetCalibration}
                                        className={joinClasses(
                                            styles.actionBtn,
                                            'inline-flex items-center justify-center gap-2 rounded-[1.05rem] border border-white/10 bg-white/5 px-4 py-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-white/72 transition-all hover:border-white/20 hover:text-white',
                                        )}
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                        RESET
                                    </button>

                                    <button
                                        onClick={() => setTutorialOpen((open) => !open)}
                                        className={joinClasses(
                                            styles.actionBtn,
                                            'inline-flex items-center justify-center gap-2 rounded-[1.05rem] border border-white/10 bg-black/45 px-4 py-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-white/72 transition-all hover:border-white/20 hover:text-white',
                                        )}
                                    >
                                        <Play className="h-4 w-4" />
                                        TUTORIAL
                                    </button>
                                </div>
                            </PanelFrame>

                            {tutorialOpen ? (
                                <PanelFrame className="p-4 md:p-5">
                                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/36">Step Tutorial</div>
                                    <div className="mt-4 space-y-3">
                                        {currentStep.physical.map((item) => (
                                            <div key={item} className="flex items-start gap-3">
                                                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-300/90" />
                                                <span className="font-mono text-sm leading-7 text-white/72">{item}</span>
                                            </div>
                                        ))}
                                    </div>
                                </PanelFrame>
                            ) : null}

                            {savedConfigPath ? (
                                <PanelFrame className="p-4 md:p-5">
                                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-200">Saved Config</div>
                                    <div className="mt-3 break-all font-mono text-xs leading-6 text-emerald-100/82">
                                        {savedConfigPath}
                                    </div>
                                </PanelFrame>
                            ) : null}

                            {calibrationMessage ? (
                                <PanelFrame className="p-4 md:p-5">
                                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/36">Latest Response</div>
                                    <div className={joinClasses('mt-3 font-mono text-sm leading-7', toneClass(calibrationTone))}>
                                        {calibrationMessage}
                                    </div>
                                    {calibrationError ? (
                                        <div className="mt-3 rounded-[1rem] border border-red-500/25 bg-red-500/10 px-3 py-2 font-mono text-xs leading-6 text-red-100/82">
                                            {calibrationError}
                                        </div>
                                    ) : null}
                                </PanelFrame>
                            ) : null}
                        </div>
                    </div>
                </div>
            </PanelFrame>

            <PanelFrame className="p-4">
                <div className="flex flex-wrap gap-3">
                    {[STEP_CONTENT[1], STEP_CONTENT[2], STEP_CONTENT[3]].map((step) => (
                        <StepPill key={step.id} step={step} active={step.id === wizardStep} />
                    ))}
                </div>
            </PanelFrame>

            <TerminalPanel lines={systemLog} terminalRef={terminalRef} />
        </div>
    );

    const renderJointsTab = () => (
        <div className="grid gap-4">
            <PanelFrame className="p-5 md:p-6">
                <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/36">Joints Control</div>
                            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.06em] text-white md:text-4xl">
                                Direct Motor Targets and Live Telemetry
                            </h2>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <StatusPill tone={backendOnline ? 'ok' : 'error'}>
                                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                {backendOnline ? 'Backend Online' : 'Backend Offline'}
                            </StatusPill>
                            <StatusPill tone="neutral">{plotMode === 'position' ? 'Position Plot' : 'Torque Plot'}</StatusPill>
                        </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-4">
                        <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">Device</div>
                            <div className="mt-3 flex items-center gap-3 text-white">
                                <Usb className="h-4 w-4 text-emerald-300" />
                                <div>
                                    <div className="font-mono text-sm font-bold uppercase tracking-[0.14em]">
                                        {currentDevice?.device ?? 'UNAVAILABLE'}
                                    </div>
                                    <div className="mt-1 font-mono text-xs text-white/42">
                                        {currentDevice?.serial_number ?? currentRobot?.device_name ?? 'NO SERIAL'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">Torque</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    onClick={() => handleTorqueToggle(true)}
                                    disabled={!currentRobot || torqueActionState !== 'idle'}
                                    className={joinClasses(
                                        styles.actionBtn,
                                        'rounded-xl border border-emerald-400/26 bg-emerald-500/12 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-100 transition-all hover:bg-emerald-500/18 disabled:opacity-40',
                                    )}
                                >
                                    ENABLE
                                </button>
                                <button
                                    onClick={() => handleTorqueToggle(false)}
                                    disabled={!currentRobot || torqueActionState !== 'idle'}
                                    className={joinClasses(
                                        styles.actionBtn,
                                        'rounded-xl border border-amber-400/26 bg-amber-500/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-100 transition-all hover:bg-amber-500/16 disabled:opacity-40',
                                    )}
                                >
                                    DISABLE
                                </button>
                            </div>
                        </div>

                        <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">Plot Mode</div>
                            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-black/45 p-1">
                                {['position', 'torque'].map((mode) => (
                                    <button
                                        key={mode}
                                        onClick={() => setPlotMode(mode)}
                                        className={joinClasses(
                                            styles.actionBtn,
                                            'rounded-lg px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] transition-all',
                                            plotMode === mode
                                                ? 'border border-white/14 bg-white/10 text-white'
                                                : 'border border-transparent text-white/42 hover:bg-white/5 hover:text-white/72',
                                        )}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">Poll Interval</div>
                            <input
                                type="number"
                                min={0.05}
                                max={1}
                                step={0.05}
                                value={updateInterval}
                                onChange={(event) => setUpdateInterval(Number(event.target.value))}
                                className="mt-3 w-full rounded-xl border border-white/10 bg-black/55 px-3 py-3 font-mono text-sm text-white outline-none transition-all focus:border-white/22"
                            />
                        </div>
                    </div>

                    {jointError ? (
                        <div className="rounded-[1.15rem] border border-red-500/24 bg-red-500/10 px-4 py-3 font-mono text-sm leading-7 text-red-100/84">
                            {jointError}
                        </div>
                    ) : null}
                </div>
            </PanelFrame>

            <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                <PanelFrame className="p-5 md:p-6">
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/34">Motor Targets</div>
                    <div className="mt-5 space-y-4">
                        {JOINTS.map((joint, index) => (
                            <div key={joint.id} className="rounded-[1.2rem] border border-white/10 bg-white/5 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/66">
                                        {joint.label}
                                    </div>
                                    <div className="font-mono text-sm text-emerald-200">
                                        {Math.round(goalAngles[index])}
                                    </div>
                                </div>
                                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
                                    Actual {Math.round(jointPositions[index])}
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={POSITION_LIMIT}
                                    step={1}
                                    value={goalAngles[index]}
                                    onChange={(event) => handleJointWrite(index, Number(event.target.value))}
                                    className="mt-4 w-full accent-emerald-400"
                                    disabled={!currentRobot}
                                />
                                <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-white/32">
                                    <span>0</span>
                                    <span>2048</span>
                                    <span>4095</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </PanelFrame>

                <PanelFrame className="p-5 md:p-6">
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/34">Live Telemetry</div>
                    <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {JOINTS.map((joint, index) => (
                            <div key={joint.id} className="rounded-[1.2rem] border border-white/10 bg-white/5 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/66">
                                            {joint.label}
                                        </div>
                                        <div className="mt-2 font-mono text-xs leading-6 text-white/42">
                                            {plotMode === 'position'
                                                ? `ACT ${Math.round(jointPositions[index])} / GOAL ${Math.round(goalAngles[index])}`
                                                : `TORQUE ${jointTorques[index].toFixed(1)}`}
                                        </div>
                                    </div>
                                    <Activity className="h-4 w-4 text-white/30" />
                                </div>
                                <div className="mt-4">
                                    <MiniChart
                                        data={plotMode === 'position' ? positionHistory[index] : torqueHistory[index]}
                                        mode={plotMode}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </PanelFrame>
            </div>

            <TerminalPanel lines={systemLog} terminalRef={terminalRef} />
        </div>
    );

    return (
        <div
            className="relative min-h-full overflow-hidden bg-black text-white"
            style={{ fontFamily: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace" }}
        >
            <div className={joinClasses(styles.gridPattern, 'pointer-events-none absolute inset-0 opacity-35')} />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.05),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_24%),linear-gradient(180deg,#050505_0%,#000000_100%)]" />
            <div className={joinClasses(styles.ambientOrb, 'pointer-events-none -left-16 top-10 h-56 w-56 bg-emerald-500/10')} />
            <div className={joinClasses(styles.ambientOrb, 'pointer-events-none right-0 top-0 h-72 w-72 bg-red-500/6')} style={{ animationDelay: '2s' }} />

            <div className="relative z-10 mx-auto flex max-w-[1600px] flex-col gap-4 px-3 py-3 md:px-4 md:py-4">
                <PanelFrame className="p-4 md:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/34">Kecy Platform</div>
                            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.06em] text-white md:text-4xl">Robot Calibration</h1>
                            <p className="mt-3 max-w-3xl font-mono text-sm leading-7 text-white/58">
                                Guided calibration on the left rail, hardware execution on the right, and direct joint access without leaving this page.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2 lg:justify-end">
                            <StatusPill tone={backendOnline ? 'ok' : 'error'}>
                                <Server className="h-3.5 w-3.5" />
                                {backendOnline ? 'Backend Online' : 'Backend Offline'}
                            </StatusPill>
                            <StatusPill tone="neutral">
                                <Usb className="h-3.5 w-3.5" />
                                {robotInfoLabel}
                            </StatusPill>
                        </div>
                    </div>
                </PanelFrame>

                <PanelFrame className="p-2">
                    <div className="grid gap-2 md:grid-cols-2">
                        {[
                            { id: 'calibration', label: 'Calibration' },
                            { id: 'joints', label: 'Joints Control' },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={joinClasses(
                                    styles.actionBtn,
                                    'rounded-[1.15rem] border px-4 py-4 text-left font-mono text-[11px] font-bold uppercase tracking-[0.22em] transition-all',
                                    activeTab === tab.id
                                        ? 'border-white/16 bg-white/10 text-white'
                                        : 'border-transparent bg-transparent text-white/44 hover:bg-white/5 hover:text-white/72',
                                )}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </PanelFrame>

                <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="grid gap-4 xl:content-start">
                        <PanelFrame className="p-4">
                            <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/34">Robot Target</div>
                            <div className="relative mt-4">
                                <select
                                    value={selectedRobotId}
                                    onChange={handleRobotSelect}
                                    disabled={robotStatuses.length === 0}
                                    className="w-full appearance-none rounded-[1.1rem] border border-white/12 bg-black/70 px-4 py-4 pr-10 font-mono text-xs font-bold uppercase tracking-[0.18em] text-white outline-none transition-all focus:border-white/24 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {robotStatuses.length === 0 ? (
                                        <option value={0}>NO ROBOT DETECTED</option>
                                    ) : (
                                        robotStatuses.map((robot, index) => (
                                            <option key={`${robot.name}-${robot.device_name ?? index}`} value={index}>
                                                {formatRobotLabel(robot, robotDevices[index])}
                                            </option>
                                        ))
                                    )}
                                </select>
                                <ArrowRight className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-white/28" />
                            </div>

                            <button
                                onClick={refreshRuntime}
                                disabled={runtimeRefreshing}
                                className={joinClasses(
                                    styles.actionBtn,
                                    'mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[1.05rem] border border-white/10 bg-white/5 px-4 py-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-white/72 transition-all hover:border-white/20 hover:text-white disabled:cursor-wait disabled:opacity-50',
                                )}
                            >
                                <RefreshCw className={joinClasses('h-4 w-4', runtimeRefreshing ? 'animate-spin' : '')} />
                                REFRESH STATUS
                            </button>
                        </PanelFrame>

                        <PanelFrame className="p-4">
                            <div className="rounded-[1.25rem] border border-amber-500/22 bg-amber-500/10 p-4">
                                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-200">Detected Robot</div>
                                <div className="mt-4 space-y-1">
                                    <InfoRow label="Name" value={formatRobotName(currentRobot?.name)} tone="text-amber-100/84" />
                                    <InfoRow label="Port" value={currentDevice?.device ?? currentRobot?.device_name ?? 'UNAVAILABLE'} tone="text-amber-100/84" />
                                    <InfoRow label="Serial" value={currentDevice?.serial_number ?? currentRobot?.device_name ?? 'UNAVAILABLE'} tone="text-amber-100/84" />
                                </div>
                                {mockFallback ? (
                                    <div className="mt-4 rounded-xl border border-amber-500/24 bg-black/35 px-3 py-2 font-mono text-[11px] leading-6 text-amber-100/78">
                                        Mock fallback detected. Connect a real robot before saving production calibration data.
                                    </div>
                                ) : null}
                            </div>
                        </PanelFrame>

                        <PanelFrame className="p-4">
                            <div className="rounded-[1.25rem] border border-red-500/22 bg-red-500/10 p-4">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 text-red-200" />
                                    <div>
                                        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-red-100">Safety Warning</div>
                                        <p className="mt-3 font-mono text-xs leading-6 text-red-100/78">
                                            Calibration releases torque. Support the arm, keep the work envelope clear, and avoid advancing any step while cables are under strain.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </PanelFrame>
                    </div>

                    <div className="min-w-0">{activeTab === 'calibration' ? renderCalibrationTab() : renderJointsTab()}</div>
                </div>

                <PanelFrame className="p-3 md:px-4 md:py-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <button
                            onMouseDown={startEstopHold}
                            onMouseUp={stopEstopHold}
                            onMouseLeave={stopEstopHold}
                            onTouchStart={startEstopHold}
                            onTouchEnd={stopEstopHold}
                            onTouchCancel={stopEstopHold}
                            className={joinClasses(
                                styles.estopBtn,
                                styles.actionBtn,
                                'relative overflow-hidden rounded-[1.05rem] px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.22em]',
                            )}
                        >
                            <span
                                className="absolute inset-y-0 left-0 bg-red-500/20 transition-[width] duration-75"
                                style={{ width: `${estopHoldProgress}%` }}
                            />
                            <span className="relative inline-flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4" />
                                E-STOP HOLD TO TRIGGER
                            </span>
                        </button>

                        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/34">
                            KECYAI BUILD {versionLabel}
                        </div>
                    </div>
                </PanelFrame>
            </div>
        </div>
    );
}
