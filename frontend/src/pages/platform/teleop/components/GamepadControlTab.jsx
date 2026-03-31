import React, { useMemo } from 'react';
import { Gamepad2, Play, RefreshCw, Square } from 'lucide-react';

function SurfaceSection({ children }) {
    return (
        <section className="rounded-[1.3rem] border border-white/10 bg-black/24 p-4 backdrop-blur-xl">
            {children}
        </section>
    );
}

function SectionLabel({ children }) {
    return (
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
            {children}
        </div>
    );
}

function AxisBar({ label, value }) {
    const v = value ?? 0;
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/50">{label}</span>
                <span className="font-mono text-[11px] text-white/40">{v.toFixed(2)}</span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
                <div
                    className="absolute inset-y-0 rounded-full bg-white/40 transition-all duration-75"
                    style={{
                        width: `${Math.abs(v * 50)}%`,
                        left: v >= 0 ? '50%' : undefined,
                        right: v < 0 ? '50%' : undefined,
                    }}
                />
            </div>
        </div>
    );
}

function TriggerBar({ label, value }) {
    const v = value ?? 0;
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/50">{label}</span>
                <span className="font-mono text-[11px] text-white/40">{v.toFixed(2)}</span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                    className="absolute inset-y-0 left-0 rounded-full bg-amber-400/60 transition-all duration-75"
                    style={{ width: `${v * 100}%` }}
                />
            </div>
        </div>
    );
}

export default function GamepadControlTab({
    isConnected,
    estopActive,
    isGamepadActive,
    gamepadConnected,
    availableGamepads,
    selectedGamepadIndex,
    gamepadSpeed,
    activeButtons,
    analogValues,
    diagnostics,
    onStart,
    onStop,
    onSpeedChange,
    onSelectGamepad,
    onRefresh,
}) {
    const disabled = !isConnected || estopActive;
    const hasController = selectedGamepadIndex !== null && selectedGamepadIndex !== undefined;
    const controllerCount = diagnostics?.controllerCount ?? availableGamepads.length;
    const visibleButtons = useMemo(() => activeButtons.slice(0, 8), [activeButtons]);

    const selectedController = availableGamepads.find((g) => g.index === selectedGamepadIndex);
    const controllerLabel = selectedController?.name ?? (hasController ? `Gamepad ${selectedGamepadIndex}` : null);

    return (
        <div className="space-y-3">
            {/* Controller + Start/Stop */}
            <SurfaceSection>
                <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                        <Gamepad2 className="h-3.5 w-3.5 text-white/40" />
                        <span className="text-sm font-semibold text-white">Gamepad</span>
                    </div>
                    <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                        isGamepadActive
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : gamepadConnected
                                ? 'border-white/10 bg-white/[0.03] text-white/50'
                                : 'border-amber-500/20 bg-amber-500/6 text-amber-300/70'
                    }`}>
                        <div className={`h-1.5 w-1.5 rounded-full ${isGamepadActive ? 'bg-emerald-400' : gamepadConnected ? 'bg-white/30' : 'bg-amber-400/60'}`} />
                        {isGamepadActive ? 'Active' : gamepadConnected ? `${controllerCount} detected` : 'No controller'}
                    </div>
                </div>

                <div className="flex gap-2">
                    <select
                        value={hasController ? selectedGamepadIndex : ''}
                        onChange={(e) => onSelectGamepad(e.target.value === '' ? null : Number(e.target.value))}
                        className="min-w-0 flex-1 rounded-xl border border-white/14 bg-black/72 px-3 py-2.5 text-sm font-medium text-white outline-none transition-all hover:border-white/24 focus:border-white/40 disabled:opacity-50"
                        disabled={isGamepadActive}
                    >
                        <option value="">Select controller</option>
                        {availableGamepads.map((g) => (
                            <option key={g.index} value={g.index}>{g.name}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-white/55 transition-all hover:border-white/20 hover:text-white/80"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={isGamepadActive ? onStop : onStart}
                        disabled={disabled || !hasController}
                        className={[
                            'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40',
                            isGamepadActive
                                ? 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/18'
                                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/18',
                        ].join(' ')}
                    >
                        {isGamepadActive ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {isGamepadActive ? 'Stop' : 'Start'}
                    </button>
                </div>
            </SurfaceSection>

            {/* Speed */}
            <SurfaceSection>
                <SectionLabel>Speed</SectionLabel>
                <div className="flex items-center gap-3">
                    <input
                        type="range"
                        min="0.2"
                        max="2"
                        step="0.1"
                        value={gamepadSpeed}
                        onChange={(e) => onSpeedChange(Number(e.target.value))}
                        disabled={disabled}
                        className="h-1 flex-1 cursor-pointer accent-white disabled:opacity-40"
                    />
                    <span className="w-8 shrink-0 text-right font-mono text-xs text-white/55">{gamepadSpeed.toFixed(1)}x</span>
                </div>
            </SurfaceSection>

            {/* Analog inputs */}
            <SurfaceSection>
                <SectionLabel>Analog</SectionLabel>
                <div className="grid gap-2.5 sm:grid-cols-2">
                    <AxisBar label="Left X → Shoulder Pan" value={analogValues.leftStickX} />
                    <AxisBar label="Left Y → Shoulder Lift" value={analogValues.leftStickY} />
                    <AxisBar label="Right X → Wrist Flex" value={analogValues.rightStickX} />
                    <AxisBar label="Right Y → Elbow Flex" value={analogValues.rightStickY} />
                    <TriggerBar label="L2 → Gripper Open" value={analogValues.leftTrigger} />
                    <TriggerBar label="R2 → Gripper Close" value={analogValues.rightTrigger} />
                </div>
            </SurfaceSection>

            {/* Button state + Mapping side by side */}
            <div className="grid gap-3 sm:grid-cols-2">
                <SurfaceSection>
                    <SectionLabel>Active Buttons</SectionLabel>
                    {visibleButtons.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                            {visibleButtons.map((label) => (
                                <span
                                    key={label}
                                    className="rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-300"
                                >
                                    {label}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <span className="text-[11px] text-white/28">No buttons pressed</span>
                    )}
                </SurfaceSection>

                <SurfaceSection>
                    <SectionLabel>Mapping</SectionLabel>
                    <div className="space-y-1 text-[11px] text-white/45">
                        <div>L-Stick → Pan / Lift</div>
                        <div>R-Stick → Wrist / Elbow</div>
                        <div>L2 / R2 → Gripper</div>
                        <div>D-Pad → Wrist Roll / Fine</div>
                        <div>Start → Reset pose</div>
                        <div>L1 / R1 → Gripper full</div>
                    </div>
                </SurfaceSection>
            </div>

            {/* Diagnostics — only show when something is off */}
            {(!diagnostics?.pygameAvailable || diagnostics?.message) ? (
                <SurfaceSection>
                    <SectionLabel>Diagnostics</SectionLabel>
                    <div className="space-y-1.5 text-[11px] font-mono text-white/45">
                        <div>pygame: {diagnostics?.pygameAvailable ? 'ok' : 'missing'}</div>
                        <div>backend: {diagnostics?.backend ?? 'pygame'}</div>
                        {diagnostics?.message ? (
                            <div className="mt-1.5 rounded-lg border border-amber-500/15 bg-amber-500/6 px-2.5 py-2 text-amber-200/70">
                                {diagnostics.message}
                            </div>
                        ) : null}
                    </div>
                </SurfaceSection>
            ) : null}
        </div>
    );
}
