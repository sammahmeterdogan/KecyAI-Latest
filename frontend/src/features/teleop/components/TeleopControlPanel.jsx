import React from 'react';
import { AlertTriangle, Play, Power, Trash2 } from 'lucide-react';
import TeleopLogPanel from './TeleopLogPanel';

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
const RAD_TO_DEG = 180 / Math.PI;

function fmtJoint(joint) {
    if (joint.jointId === 'gripper') {
        return `${Math.max(0, Math.min(100, Math.round(joint.value * 100)))}%`;
    }
    return `${(joint.value * RAD_TO_DEG).toFixed(1)}\u00B0`;
}

/* ═══════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════ */

/* Status pill (top-right of header) */
function StatusPill({ isConnected }) {
    return (
        <span
            className={[
                'inline-flex items-center gap-2 rounded-full px-3 py-1.5',
                'text-[10px] font-bold uppercase tracking-[0.22em]',
                isConnected
                    ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border border-[#2a2d35] bg-[#13151a] text-[#5a5e69]',
            ].join(' ')}
        >
            <span
                className={`h-[6px] w-[6px] rounded-full ${
                    isConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-[#3a3e48]'
                }`}
            />
            {isConnected ? 'ONLINE' : 'OFFLINE'}
        </span>
    );
}

/* Single metric tile */
function MetricCard({ label, value, unit }) {
    return (
        <div className="rounded-xl border border-[#1e2028] bg-[#111318] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#4a4e58]">{label}</div>
            <div className="mt-1 font-mono text-sm font-bold text-[#c8cbd2]">
                {value}
                {unit && <span className="ml-0.5 text-[11px] font-medium text-[#5a5e69]">{unit}</span>}
            </div>
        </div>
    );
}

/* Individual joint slider */
function JointSlider({ disabled, joint, onChange }) {
    const pct = ((joint.value - joint.min) / (joint.max - joint.min)) * 100;
    const clampedPct = Math.max(0, Math.min(100, pct));

    return (
        <div className="rounded-xl border border-[#1e2028] bg-[#111318] px-4 py-3">
            <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[#c0c4cc]">{joint.label}</span>
                <span className="font-mono text-[12px] tabular-nums text-[#6b7080]">{fmtJoint(joint)}</span>
            </div>
            {/* Custom track visual */}
            <div className="relative mt-2.5 h-[18px]">
                {/* bg track */}
                <div className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-[#1e2028]" />
                {/* filled track */}
                <div
                    className="absolute left-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-emerald-500/50"
                    style={{ width: `${clampedPct}%` }}
                />
                {/* thumb indicator */}
                <span
                    className="pointer-events-none absolute top-1/2 h-[14px] w-[14px] -translate-y-1/2 rounded-full border-2 border-emerald-400/60 bg-white shadow-[0_0_8px_rgba(52,211,153,0.3)]"
                    style={{ left: `calc(${clampedPct}% - 7px)` }}
                />
                {/* invisible native input on top */}
                <input
                    type="range"
                    min={joint.min}
                    max={joint.max}
                    step={joint.jointId === 'gripper' ? 0.01 : 0.01}
                    value={joint.value}
                    onChange={(e) => onChange(joint.jointId, Number(e.target.value))}
                    disabled={disabled}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                />
            </div>
        </div>
    );
}

/* Preset / action button */
function Btn({ children, disabled, onClick, variant = 'default' }) {
    const base =
        'h-[36px] rounded-lg text-[11px] font-semibold tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed';
    const styles = {
        default: 'border border-[#1e2028] bg-[#111318] text-[#a0a4ae] hover:bg-[#191c24] hover:text-white',
        primary:
            'border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200',
        danger: 'border border-red-500/25 bg-red-500/8 text-red-300 hover:bg-red-500/18',
    };
    return (
        <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]}`}>
            {children}
        </button>
    );
}

/* Section heading label */
function SectionLabel({ children }) {
    return (
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#4a4e58]">{children}</div>
    );
}

/* ═══════════════════════════════════════════════════════════
   MAIN EXPORT
   ═══════════════════════════════════════════════════════════ */
export default function TeleopControlPanel({
    activeTab,
    commandError,
    isConnected,
    joints,
    loading,
    logs,
    onClearLogs,
    onExecuteSequence,
    onGripperAction,
    onJointChange,
    onPoseAction,
    onRecordStep,
    onStart,
    onStop,
    onTabChange,
    sequence,
    setSequence,
    telemetry,
    viewerReady,
}) {
    return (
        <div className="flex h-full flex-col overflow-hidden rounded-[20px] border border-[#1a1d24] bg-[#0a0b0e]">
            {/* ═══ HEADER (sticky top) ═══════════════════════ */}
            <div className="shrink-0 border-b border-[#1a1d24] p-5 pb-4">
                {/* Title + Status */}
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h1 className="text-[15px] font-bold tracking-[0.12em] text-[#e0e2e8]">SO-ARM101</h1>
                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#4a4e58]">
                            Teleoperation Control
                        </p>
                    </div>
                    <StatusPill isConnected={isConnected} />
                </div>

                {/* Metrics row */}
                <div className="mt-4 grid grid-cols-3 gap-2">
                    <MetricCard label="Voltage" value={telemetry.voltage.toFixed(1)} unit="V" />
                    <MetricCard label="Latency" value={telemetry.latency} unit="ms" />
                    <MetricCard label="FPS" value={telemetry.fps} unit="" />
                </div>

                {/* Offline warning */}
                {!isConnected && (
                    <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-500/15 bg-amber-500/5 px-3.5 py-2.5">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/60" />
                        <div>
                            <div className="text-[11px] font-semibold text-amber-200/80">System Offline</div>
                            <div className="mt-0.5 text-[10px] leading-relaxed text-[#6b7080]">
                                Runtime offline. Controls disabled.
                            </div>
                        </div>
                    </div>
                )}

                {/* Command error */}
                {commandError && (
                    <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/8 px-3.5 py-2.5 text-[10px] leading-relaxed text-red-300">
                        <AlertTriangle size={12} className="mt-px shrink-0 text-red-400" />
                        <span>{commandError}</span>
                    </div>
                )}

                {/* Start / Stop */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                    <Btn variant="primary" onClick={onStart} disabled={isConnected || loading.start}>
                        {loading.start ? 'Starting\u2026' : 'Start'}
                    </Btn>
                    <Btn variant="default" onClick={onStop} disabled={!isConnected || loading.stop}>
                        {loading.stop ? 'Stopping\u2026' : 'Stop'}
                    </Btn>
                </div>
            </div>

            {/* ═══ SCROLLABLE BODY ═══════════════════════════ */}
            <div className="flex-1 min-h-0 overflow-y-auto p-5 pt-4" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.06) transparent' }}>
                {/* ── SEQUENCE / PROGRAMMER ──────────────────── */}
                <SectionLabel>Sequence / Programmer</SectionLabel>

                <div className="mt-2.5 grid grid-cols-3 gap-2">
                    <Btn onClick={onRecordStep}>Record Step</Btn>
                    <Btn variant="primary" onClick={onExecuteSequence} disabled={sequence.length === 0 || loading.execute}>
                        <span className="inline-flex items-center justify-center gap-1">
                            <Play size={10} /> Execute
                        </span>
                    </Btn>
                    <Btn onClick={() => setSequence([])} disabled={sequence.length === 0}>Clear</Btn>
                </div>

                <div className="mt-2.5 rounded-xl border border-[#1e2028] bg-[#111318] p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-[#7a7e88]">STEPS: {sequence.length}</span>
                        <span className="text-[10px] text-[#3a3e48]">Queue</span>
                    </div>
                    {sequence.length === 0 ? (
                        <p className="mt-2 text-[11px] text-[#3a3e48]">No steps recorded</p>
                    ) : (
                        <div className="mt-2 max-h-[60px] space-y-1 overflow-y-auto">
                            {sequence.map((step, i) => (
                                <div key={step.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2.5 py-1 text-[10px]">
                                    <span className="font-mono text-[#4a4e58]">{String(i + 1).padStart(2, '0')}</span>
                                    <span className="text-[#6b7080]">Joint Snapshot</span>
                                    <span className="font-mono text-[#3a3e48]">{new Date(step.createdAt).toLocaleTimeString()}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── TABS ──────────────────────────────────── */}
                <div className="mt-5 flex items-center gap-1 rounded-lg border border-[#1e2028] bg-[#0e1014] p-1">
                    {['joints', 'cartesian'].map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => onTabChange(tab)}
                            className={[
                                'flex-1 rounded-md py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] transition-all',
                                activeTab === tab
                                    ? 'bg-[#191c24] text-white shadow-sm'
                                    : 'text-[#4a4e58] hover:text-[#7a7e88]',
                            ].join(' ')}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* ── TAB CONTENT ───────────────────────────── */}
                {activeTab === 'joints' ? (
                    <div className="mt-4">
                        {/* Preset buttons 2x2 */}
                        <div className="grid grid-cols-2 gap-2">
                            <Btn onClick={() => onPoseAction('home')} disabled={!isConnected}>Home Pose</Btn>
                            <Btn onClick={() => onPoseAction('ready')} disabled={!isConnected}>Ready Pose</Btn>
                            <Btn onClick={() => onGripperAction('open')} disabled={!isConnected}>Open Grip</Btn>
                            <Btn onClick={() => onGripperAction('close')} disabled={!isConnected}>Close Grip</Btn>
                        </div>

                        {/* Joint sliders */}
                        <div className="mt-3 space-y-2">
                            {joints.map((joint) => (
                                <JointSlider
                                    key={joint.jointId}
                                    joint={joint}
                                    onChange={onJointChange}
                                    disabled={!isConnected}
                                />
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="mt-4 flex h-32 items-center justify-center rounded-xl border border-dashed border-[#1e2028] bg-[#0e1014] px-5 text-center text-[10px] leading-relaxed text-[#4a4e58]">
                        Cartesian control is not available.
                        <br />
                        Only upstream LeRobot whitelisted commands are supported.
                    </div>
                )}

                {/* ── RUNTIME LOGS ──────────────────────────── */}
                <div className="mt-5">
                    <TeleopLogPanel logs={logs} onClear={onClearLogs} />
                </div>
            </div>

            {/* ═══ FOOTER (sticky bottom) ════════════════════ */}
            <div className="shrink-0 border-t border-[#1a1d24] px-5 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#4a4e58]">
                            ROS2 BRIDGE
                        </span>
                        <span
                            className={`h-[7px] w-[7px] rounded-full ${
                                isConnected
                                    ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                                    : 'bg-red-500/70'
                            }`}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={onStop}
                        disabled={!isConnected || loading.stop}
                        className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/8 px-3.5 text-[11px] font-bold tracking-wide text-red-300 transition-all hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-25"
                    >
                        <Power className="h-3.5 w-3.5" />
                        E-STOP
                    </button>
                </div>
            </div>
        </div>
    );
}
