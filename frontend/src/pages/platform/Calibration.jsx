import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    AlertCircle,
    AlertTriangle,
    ArrowRight,
    CheckCircle,
    Loader2,
    RotateCcw,
} from 'lucide-react';
import { lerobotClient } from '../../lib/api/lerobotClient';
import { cn } from '../../lib/utils';
import calibrationPosition1 from '../../assets/calibration/CalibrationPosition1.jpg';
import calibrationPosition2 from '../../assets/calibration/CalibrationPosition2.jpg';

const JOINTS = [
    { id: 'shoulder_pan',  label: 'Shoulder Pan' },
    { id: 'shoulder_lift', label: 'Shoulder Lift' },
    { id: 'elbow_flex',    label: 'Elbow Flex' },
    { id: 'wrist_flex',    label: 'Wrist Flex' },
    { id: 'wrist_roll',    label: 'Wrist Roll' },
    { id: 'gripper',       label: 'Gripper' },
];

const EMPTY_RANGES = JOINTS.map(j => ({ id: j.id, label: j.label, min: null, pos: null, max: null }));

function fmtVal(v) {
    return v !== null && v !== undefined ? Math.round(v) : '—';
}

function glassCard(extra = '') {
    return cn(
        'rounded-[1.45rem] border border-white/10 bg-black/70 shadow-[0_18px_48px_rgba(0,0,0,0.32)] backdrop-blur-xl',
        extra,
    );
}

function SectionLabel({ children }) {
    return (
        <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/34 mb-3">
            {children}
        </div>
    );
}

function Alert({ variant = 'default', icon: Icon, title, children }) {
    const base = 'rounded-[1rem] border px-4 py-3 text-sm leading-6';
    const variantCls = {
        default:      'border-white/12 bg-white/[0.04] text-white/78',
        destructive:  'border-red-500/30 bg-red-500/10 text-red-100',
        warning:      'border-amber-500/30 bg-amber-500/10 text-amber-100',
        success:      'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
        loading:      'border-amber-400/22 bg-amber-500/8 text-amber-50',
    }[variant] || 'border-white/12 bg-white/[0.04]';

    return (
        <div className={cn(base, variantCls)}>
            <div className="flex items-start gap-3">
                {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
                <div className="min-w-0">
                    {title && <div className="font-semibold mb-1">{title}</div>}
                    <div className="font-mono text-[12px] leading-6 opacity-90">{children}</div>
                </div>
            </div>
        </div>
    );
}

function CalibrationValuesTable({ ranges, isRecording, activeJoint }) {
    return (
        <div className={glassCard('p-5')}>
            <div className="flex items-center justify-between mb-4">
                <SectionLabel>Calibration Values</SectionLabel>
                {isRecording && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-amber-300">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        Live
                    </span>
                )}
            </div>

            {/* Header row */}
            <div className="grid grid-cols-[1fr_60px_60px_60px] gap-1 mb-2 px-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/30">Joint</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-red-300/50 text-right">Min</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-emerald-300/50 text-right">Pos</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/50 text-right">Max</span>
            </div>

            <div className="space-y-1">
                {ranges.map(r => {
                    const isActive = activeJoint === r.id;
                    const hasData  = r.min !== null || r.pos !== null || r.max !== null;
                    return (
                        <div
                            key={r.id}
                            className={cn(
                                'grid grid-cols-[1fr_60px_60px_60px] gap-1 items-center rounded-lg px-2 py-2 transition-colors',
                                isActive
                                    ? 'border border-amber-500/30 bg-amber-500/8'
                                    : hasData
                                        ? 'border border-white/6 bg-white/[0.02]'
                                        : 'border border-transparent',
                            )}
                        >
                            <span className={cn(
                                'font-mono text-[11px] font-semibold truncate',
                                isActive ? 'text-amber-200' : 'text-white/70',
                            )}>
                                {isActive && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />}
                                {r.label}
                            </span>
                            <span className={cn('font-mono text-xs text-right tabular-nums', r.min !== null ? 'text-red-300' : 'text-white/20')}>
                                {fmtVal(r.min)}
                            </span>
                            <span className={cn('font-mono text-xs text-right tabular-nums', r.pos !== null ? 'text-emerald-300' : 'text-white/20')}>
                                {fmtVal(r.pos)}
                            </span>
                            <span className={cn('font-mono text-xs text-right tabular-nums', r.max !== null ? 'text-sky-300' : 'text-white/20')}>
                                {fmtVal(r.max)}
                            </span>
                        </div>
                    );
                })}
            </div>

            {isRecording && (
                <p className="mt-3 font-mono text-[10px] text-amber-300/50 leading-5">
                    Move joint through full range — min/max update live.
                </p>
            )}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Calibration() {
    // ── UI state (mirrors phosphobot's wizard) ────────────────────────────────
    const [wizardStep, setWizardStep]   = useState(1);       // 1 | 2 | 3
    const [uiStatus,  setUiStatus]      = useState('idle');  // idle | loading | in_progress | completed | error
    const [errorMsg,  setErrorMsg]      = useState('');
    const [artifactPath, setArtifactPath] = useState('');

    // ── Backend status ────────────────────────────────────────────────────────
    const [calStatus,  setCalStatus]  = useState(null);
    const [calRanges,  setCalRanges]  = useState(EMPTY_RANGES);
    const [robotConfig, setRobotConfig] = useState(null);
    const [teleop,      setTeleop]      = useState({ state: 'idle' });

    const mountedRef    = useRef(true);
    // Refs so syncStatus stays stable (no re-creation on state changes)
    const uiStatusRef   = useRef('idle');
    const wizardStepRef = useRef(1);

    // ── Config fetch (once) ───────────────────────────────────────────────────
    useEffect(() => {
        mountedRef.current = true;

        lerobotClient.adminGetConfig().catch(() => null).then(cfg => {
            if (mountedRef.current && cfg) setRobotConfig(cfg);
        });
        lerobotClient.teleopStatus().catch(() => ({ state: 'idle' })).then(tel => {
            if (mountedRef.current && tel) setTeleop(tel);
        });

        return () => { mountedRef.current = false; };
    }, []);

    // Keep refs in sync with state (no extra renders)
    useEffect(() => { uiStatusRef.current = uiStatus; }, [uiStatus]);
    useEffect(() => { wizardStepRef.current = wizardStep; }, [wizardStep]);

    // ── Calibration status polling ────────────────────────────────────────────
    // Stable callback — reads from refs so it never needs to be recreated
    const syncStatus = useCallback(async () => {
        try {
            const [s, tel] = await Promise.all([
                lerobotClient.calibrationStatus(),
                lerobotClient.teleopStatus().catch(() => ({ state: 'idle' })),
            ]);
            if (!mountedRef.current) return;
            setTeleop(tel);
            setCalStatus(s);
            // Surface backend error to user immediately
            if (s.error && uiStatusRef.current === 'in_progress') {
                setUiStatus('error');
                setErrorMsg(s.error);
            }

            const positions    = s.live_joint_positions || {};
            const liveRange    = s.live_range || null;
            const completedMap = new Map(
                (s.steps || [])
                    .filter(step => step.status === 'completed' && step.result)
                    .map(step => [step.id, step.result]),
            );

            setCalRanges(prev => {
                const next = JOINTS.map(j => {
                    const done     = completedMap.get(`range_${j.id}`);
                    const isActive = liveRange?.joint === j.id;
                    return {
                        id:    j.id,
                        label: j.label,
                        min: isActive ? Number(liveRange.measured_min)
                            : done?.measured_min != null ? Number(done.measured_min) : null,
                        pos: positions[j.id] != null ? Number(positions[j.id]) : null,
                        max: isActive ? Number(liveRange.measured_max)
                            : done?.measured_max != null ? Number(done.measured_max) : null,
                    };
                });
                // Skip re-render when nothing changed
                const same = prev.every((p, i) => p.min === next[i].min && p.pos === next[i].pos && p.max === next[i].max);
                return same ? prev : next;
            });

            // Sync wizard step using refs (no dependency, no re-creation)
            if (s.state === 'completed' && uiStatusRef.current !== 'completed') {
                setWizardStep(3);
                setUiStatus('completed');
                setArtifactPath(s.artifact_path || '');
            } else if (s.state === 'running' && wizardStepRef.current === 1) {
                setWizardStep(2);
                setUiStatus('in_progress');
                setErrorMsg('');
            } else if (s.state === 'completed' && uiStatusRef.current === 'completed') {
                setErrorMsg('');
            } else if ((s.state === 'idle' || s.state === 'stopped') && wizardStepRef.current === 2) {
                setWizardStep(1);
                setUiStatus('idle');
                setErrorMsg('');
            }
        } catch {
            // ignore network errors silently
        }
    }, []); // stable — no state deps

    // Dynamic polling speed without restarting the interval on every state change
    const uiStatusForInterval = uiStatus === 'in_progress' ? 'fast' : 'slow';
    useEffect(() => {
        syncStatus();
        const ms = uiStatusForInterval === 'fast' ? 500 : 2000;
        const id = setInterval(syncStatus, ms);
        return () => clearInterval(id);
    }, [syncStatus, uiStatusForInterval]);

    // ── Actions ───────────────────────────────────────────────────────────────

    const handleStart = async () => {
        setUiStatus('loading');
        setErrorMsg('');
        try {
            const payload = { robot_type: robotConfig?.robot_type || 'so101_follower' };
            if (robotConfig?.serial_port) payload.serial_port = robotConfig.serial_port;
            await lerobotClient.calibrationStart(payload);
            setWizardStep(2);
            setUiStatus('in_progress');
        } catch (e) {
            const raw = e?.body?.message || e?.message || '';
            const msg = raw.toLowerCase().includes('fetch') || raw.toLowerCase().includes('network')
                ? 'Runtime service unreachable. Make sure the Python service is running on port 8040.'
                : raw || 'Calibration failed to start.';
            setUiStatus('error');
            setErrorMsg(msg);
        }
    };

    const handleNextStep = async () => {
        setUiStatus('loading');
        setErrorMsg('');
        const t0 = Date.now();
        try {
            const res = await lerobotClient.calibrationStep({});
            if (res.state === 'completed') {
                setWizardStep(3);
                setUiStatus('completed');
                setArtifactPath(res.artifact_path || '');
            } else {
                setUiStatus('in_progress');
            }
        } catch (e) {
            // Enforce a minimum loading duration so the button doesn't flash
            const elapsed = Date.now() - t0;
            if (elapsed < 600) await new Promise(r => setTimeout(r, 600 - elapsed));
            const raw = e?.body?.message || e?.message || '';
            const msg = raw.toLowerCase().includes('fetch') || raw.toLowerCase().includes('network')
                ? 'Runtime service unreachable. Is the Python service running?'
                : raw || 'Step failed. Move the joint through its full range and retry.';
            setUiStatus('in_progress');
            setErrorMsg(msg);
        }
    };

    const handleRestart = async () => {
        try { await lerobotClient.calibrationStop(); } catch { /* ignore */ }
        setWizardStep(1);
        setUiStatus('idle');
        setErrorMsg('');
        setArtifactPath('');
        setCalRanges(EMPTY_RANGES);
        setCalStatus(null);   // clear stale sidebar immediately — polling will repopulate
    };

    // ── Derived values ────────────────────────────────────────────────────────
    const robotType    = robotConfig?.robot_type  || 'so101_follower';
    const serialPort   = robotConfig?.serial_port || null;
    const teleopActive = ['running', 'starting'].includes(teleop?.state);
    const missingJoints = calStatus?.missing_joints || [];
    const partialHardware = Boolean(calStatus?.partial_hardware);
    const totalSteps  = calStatus?.total_steps ?? 8;
    const stepIndex   = calStatus?.current_step_index ?? 0;
    const currentStep = calStatus?.current_step ?? null;
    const isSweep     = currentStep?.action === 'sweep';
    const isSave      = currentStep?.action === 'save';
    const isLoading   = uiStatus === 'loading';
    const isRecording = uiStatus === 'in_progress' && isSweep;
    const progressPct = wizardStep === 3 ? 100 : wizardStep === 2 ? Math.round(((stepIndex + 1) / totalSteps) * 100) : 0;

    // Button label
    const btnLabel = isLoading
        ? 'Calibrating…'
        : wizardStep === 1
            ? 'Start Calibration'
            : isSave
                ? 'Complete Calibration'
                : 'Next Step';

    // Step image: position-1 for zero step, position-2 for range/save
    const stepImg    = wizardStep === 2 && (isSweep || isSave) ? calibrationPosition2 : calibrationPosition1;
    const imgCaption = wizardStep === 2 && isSweep
        ? `Move ${currentStep?.joint?.replace(/_/g, ' ')} through its full range. Min/Max values are recorded automatically.`
        : wizardStep === 2
            ? 'Follow the on-screen instructions and confirm each position.'
            : 'Position 1 and Position 2 are shown here for reference.';

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="relative min-h-full overflow-hidden bg-black text-white" style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
            {/* Background */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.04),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.06),transparent_28%),linear-gradient(180deg,#050505_0%,#000_100%)]" />

            <div className="relative z-10 mx-auto max-w-[1400px] px-3 py-3 md:px-5 md:py-5">

                {/* ── HEADER ─────────────────────────────────────────────────── */}
                <div className={glassCard('mb-4 p-4 md:p-5')}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h1 className="text-2xl font-semibold tracking-[-0.05em] text-white md:text-3xl">Calibration</h1>
                            <p className="mt-1 font-mono text-xs text-white/45">
                                SO-ARM101 · {robotType} · {serialPort || 'no port'}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {teleopActive && (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                    Teleop Active
                                </span>
                            )}
                            {uiStatus === 'completed' && (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
                                    <CheckCircle className="h-3 w-3" />
                                    Completed
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── TELEOP BLOCKER ─────────────────────────────────────────── */}
                {teleopActive && wizardStep === 1 && (
                    <div className="mb-4">
                        <Alert variant="warning" icon={AlertTriangle} title="Teleop is active">
                            Stop the teleop session before starting calibration.
                        </Alert>
                    </div>
                )}

                {/* ── DRY-RUN NOTICE ────────────────────────────────────────── */}
                {!serialPort && wizardStep === 1 && uiStatus !== 'error' && (
                    <div className="mb-4">
                        <Alert variant="warning" icon={AlertTriangle} title="No serial port configured">
                            Calibration will run in <strong>dry-run / simulation mode</strong>. No real hardware will be touched. Configure a port in Hardware Setup for real calibration.
                        </Alert>
                    </div>
                )}

                {/* ── PARTIAL HARDWARE WARNING ───────────────────────────────── */}
                {partialHardware && missingJoints.length > 0 && (
                    <div className="mb-4">
                        <Alert variant="warning" icon={AlertTriangle} title="Incomplete robot set — missing servo(s)">
                            Calibration will continue without: <strong>{missingJoints.map(j => j.replace(/_/g, ' ')).join(', ')}</strong>.
                            Those joints will keep nominal values. Check the cable on the missing servo and restart to do a full calibration.
                        </Alert>
                    </div>
                )}

                {/* ── MAIN LAYOUT ────────────────────────────────────────────── */}
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">

                    {/* LEFT: Wizard */}
                    <div className={glassCard('p-5 md:p-6')}>

                        {/* Step 1 */}
                        {wizardStep === 1 && (
                            <div className="space-y-5">
                                <div>
                                    <h2 className="text-xl font-semibold text-white">Prepare Your Robot</h2>
                                    <p className="mt-2 font-mono text-sm leading-7 text-white/55">
                                        Confirm the target robot, support the arm, and clear the workspace before torque is released.
                                    </p>
                                </div>

                                {/* Safety warning — identical to phosphobot */}
                                <Alert variant="destructive" icon={AlertTriangle} title="Safety Warning">
                                    Make sure you can safely catch your robot. Calibration disables torque.
                                </Alert>

                                {/* Robot info */}
                                {robotConfig && (
                                    <div className="rounded-[1rem] border border-white/10 bg-white/[0.03] p-4 space-y-2">
                                        <SectionLabel>Robot to calibrate</SectionLabel>
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono text-xs text-white/45">Type</span>
                                            <span className="font-mono text-xs text-white/80">{robotType}</span>
                                        </div>
                                        <div className="flex items-center justify-between border-t border-white/8 pt-2">
                                            <span className="font-mono text-xs text-white/45">Port</span>
                                            <span className={cn('font-mono text-xs', serialPort ? 'text-emerald-300' : 'text-red-300/80')}>
                                                {serialPort || 'not configured'}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Reference thumbnails */}
                                <div>
                                    <SectionLabel>Reference Overview</SectionLabel>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="overflow-hidden rounded-[1rem] border border-white/10">
                                            <img src={calibrationPosition1} alt="Position 1" className="h-32 w-full object-cover" />
                                            <div className="border-t border-white/8 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">Position 1</div>
                                        </div>
                                        <div className="overflow-hidden rounded-[1rem] border border-white/10">
                                            <img src={calibrationPosition2} alt="Position 2" className="h-32 w-full object-cover" />
                                            <div className="border-t border-white/8 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">Position 2</div>
                                        </div>
                                    </div>
                                    <p className="mt-2 font-mono text-[10px] leading-5 text-white/38">
                                        Position 1 and Position 2 are used in steps below. Match these reference poses closely before confirming each step.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Step 2 */}
                        {wizardStep === 2 && (
                            <div className="space-y-5">
                                {/* Dynamic step title from backend */}
                                <div>
                                    <h2 className="text-xl font-semibold text-white">
                                        {currentStep?.title || 'Calibrating…'}
                                    </h2>
                                    <p className="mt-2 font-mono text-sm leading-7 text-white/55">
                                        {currentStep?.description || 'Follow the instructions and confirm each position.'}
                                    </p>
                                </div>

                                {/* Reference image */}
                                <div className="overflow-hidden rounded-[1.2rem] border border-white/10">
                                    <img
                                        src={stepImg}
                                        alt={imgCaption}
                                        className="h-[240px] w-full object-cover object-center md:h-[300px]"
                                    />
                                    <div className="border-t border-white/8 px-4 py-3">
                                        <p className="font-mono text-[11px] leading-5 text-white/50">{imgCaption}</p>
                                    </div>
                                </div>

                                {/* Physical instructions */}
                                {isSweep && (
                                    <div className="space-y-2">
                                        {[
                                            `Move ${currentStep?.joint?.replace(/_/g, ' ')} through its complete range of motion.`,
                                            'Go to the minimum position, then to the maximum position.',
                                            'Hold for a moment at each extreme before clicking Next Step.',
                                        ].map(item => (
                                            <div key={item} className="flex items-start gap-3">
                                                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/80" />
                                                <span className="font-mono text-sm leading-7 text-white/65">{item}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {!isSweep && !isSave && (
                                    <div className="space-y-2">
                                        {[
                                            'Move all joints to their center (midpoint) position.',
                                            'The robot torque is disabled — support the arm.',
                                            'Confirm when ready to proceed.',
                                        ].map(item => (
                                            <div key={item} className="flex items-start gap-3">
                                                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/80" />
                                                <span className="font-mono text-sm leading-7 text-white/65">{item}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {isSave && (
                                    <div className="space-y-2">
                                        {[
                                            'All ranges have been recorded.',
                                            'Click Complete Calibration to write the data to disk.',
                                            'The calibration file will be saved to the robot config directory.',
                                        ].map(item => (
                                            <div key={item} className="flex items-start gap-3">
                                                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/80" />
                                                <span className="font-mono text-sm leading-7 text-white/65">{item}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Step 3 */}
                        {wizardStep === 3 && (
                            <div className="space-y-5 text-center">
                                <CheckCircle className="mx-auto h-14 w-14 text-emerald-400" />
                                <div>
                                    <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white">Calibration Complete</h2>
                                    <p className="mt-2 font-mono text-sm text-white/50">
                                        All joints have been calibrated and the data has been saved.
                                    </p>
                                </div>
                                {artifactPath && (
                                    <div className="rounded-[1rem] border border-white/10 bg-black/50 px-4 py-3 text-left">
                                        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/35 mb-1">Saved to</div>
                                        <div className="font-mono text-xs text-white/65 break-all">{artifactPath}</div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── STATUS ALERTS (phosphobot pattern) ──────────── */}
                        <div className="mt-5 space-y-3">

                            {isLoading && (
                                <Alert variant="loading" icon={Loader2} title="Calibrating your robot…">
                                    This may take a few moments. Please don't move the robot.
                                </Alert>
                            )}

                            {(uiStatus === 'in_progress' && !isLoading) && (
                                <Alert variant="default" icon={Loader2} title="Calibration in Progress">
                                    Step {stepIndex + 1} of {totalSteps} — {currentStep?.title || 'running'}
                                </Alert>
                            )}

                            {uiStatus === 'completed' && wizardStep === 3 && (
                                <Alert variant="success" icon={CheckCircle} title="Calibration Complete">
                                    The calibration data has been written to disk successfully.
                                </Alert>
                            )}

                            {uiStatus === 'error' && errorMsg && (
                                <Alert variant="destructive" icon={AlertCircle} title="Calibration Failed">
                                    <p>{errorMsg}</p>
                                    <ul className="mt-2 list-disc pl-4 space-y-1 text-[11px]">
                                        <li>Ensure the robot is connected via USB and powered on.</li>
                                        <li>If you see a torque read error, check that all servo wires are fully seated.</li>
                                        <li>Make sure no other program has the COM port open.</li>
                                        <li>For sweep steps: move the joint through its full range before clicking Next.</li>
                                    </ul>
                                </Alert>
                            )}

                            {uiStatus === 'in_progress' && errorMsg && (
                                <Alert variant="warning" icon={AlertTriangle} title="Step failed — you can retry">
                                    {errorMsg}
                                </Alert>
                            )}
                        </div>

                        {/* ── ACTION BUTTONS ───────────────────────────────── */}
                        <div className="mt-5 flex flex-col gap-3">

                            {/* Primary action — matches phosphobot button layout exactly */}
                            {wizardStep === 1 && (
                                <button
                                    onClick={handleStart}
                                    disabled={isLoading || teleopActive}
                                    className="w-full rounded-[1.05rem] border border-emerald-500/30 bg-emerald-500/12 px-5 py-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-50 transition-all hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40 flex items-center justify-center gap-2"
                                >
                                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                                    {btnLabel}
                                </button>
                            )}

                            {wizardStep === 2 && (
                                <button
                                    onClick={handleNextStep}
                                    disabled={isLoading}
                                    className="w-full rounded-[1.05rem] border border-emerald-500/30 bg-emerald-500/12 px-5 py-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-50 transition-all hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40 flex items-center justify-center gap-2"
                                >
                                    {isLoading
                                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Calibrating…</>
                                        : <><ArrowRight className="h-4 w-4" /> {btnLabel}</>}
                                </button>
                            )}

                            {/* Reset / Restart */}
                            {(uiStatus === 'error' && wizardStep !== 1 || wizardStep === 3) && (
                                <button
                                    onClick={handleRestart}
                                    disabled={isLoading}
                                    className="w-full rounded-[1.05rem] border border-white/10 bg-white/[0.04] px-5 py-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-white/70 transition-all hover:border-white/20 hover:text-white disabled:opacity-40 flex items-center justify-center gap-2"
                                >
                                    <RotateCcw className="h-4 w-4" />
                                    {wizardStep === 3 ? 'New Calibration' : 'Restart Calibration'}
                                </button>
                            )}

                            {/* Reset available during step 2 — but not when the error-state button above is already showing */}
                            {wizardStep === 2 && !isLoading && uiStatus !== 'error' && (
                                <button
                                    onClick={handleRestart}
                                    className="w-full rounded-[1.05rem] border border-white/8 bg-transparent px-5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/38 transition-all hover:text-white/60 flex items-center justify-center gap-2"
                                >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    Restart from Beginning
                                </button>
                            )}
                        </div>

                        {/* ── PROGRESS BAR (phosphobot pattern) ────────────── */}
                        <div className="mt-5">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-mono text-[10px] text-white/35">
                                    {wizardStep === 3
                                        ? 'All steps complete'
                                        : wizardStep === 2
                                            ? `Step ${stepIndex + 1} of ${totalSteps}`
                                            : 'Ready to start'}
                                </span>
                                <span className="font-mono text-[10px] text-white/35">{progressPct}%</span>
                            </div>
                            <div className="h-[3px] overflow-hidden rounded-full bg-white/8">
                                <div
                                    className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                                    style={{ width: `${progressPct}%` }}
                                />
                            </div>
                        </div>

                        {/* Video help link (phosphobot) */}
                        <div className="mt-5">
                            <a
                                href="https://huggingface.co/docs/lerobot/so101#calibrate"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[10px] text-white/30 underline hover:text-white/55 transition-colors"
                            >
                                Need help? Read the SO-101 calibration guide ↗
                            </a>
                        </div>
                    </div>

                    {/* RIGHT SIDEBAR: Calibration Values Table */}
                    <div className="space-y-4">
                        <CalibrationValuesTable
                            ranges={calRanges}
                            isRecording={isRecording}
                            activeJoint={isRecording ? currentStep?.joint : null}
                        />

                        {/* Steps summary */}
                        {calStatus?.steps && calStatus.steps.length > 0 && (
                            <div className={glassCard('p-4')}>
                                <SectionLabel>Steps</SectionLabel>
                                <div className="space-y-1.5">
                                    {calStatus.steps.map(step => {
                                        const done   = step.status === 'completed';
                                        const active = step.status === 'current';
                                        return (
                                            <div key={step.id} className="flex items-center justify-between gap-2">
                                                <span className={cn('font-mono text-[10px] truncate', done ? 'text-white/70' : active ? 'text-white/60' : 'text-white/28')}>
                                                    {step.title || step.id}
                                                </span>
                                                <span className={cn(
                                                    'font-mono text-[9px] font-bold uppercase tracking-[0.15em] shrink-0',
                                                    done    ? 'text-emerald-400' :
                                                    active  ? 'text-amber-300' :
                                                              'text-white/18',
                                                )}>
                                                    {done ? '✓' : active ? '→' : '·'}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
