import React from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import ConnectionPill from './ConnectionPill';

function SelectField({ label, value, onChange, disabled, children, action = null }) {
    return (
        <label className="block">
            <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-white/68">{label}</span>
                {action}
            </div>
            <div className="relative">
                <select
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    disabled={disabled}
                    className="w-full appearance-none rounded-xl border border-white/14 bg-black/72 px-4 py-3 pr-10 text-sm font-medium text-white outline-none transition-all hover:border-white/24 focus:border-white/40 focus:ring-2 focus:ring-white/12 disabled:cursor-not-allowed disabled:opacity-55"
                >
                    {children}
                </select>
                <ChevronRight className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rotate-90 text-white/35" />
            </div>
        </label>
    );
}

function SummaryTile({ label, value, tone = 'text-white/82' }) {
    return (
        <div className="rounded-[1rem] border border-white/10 bg-white/[0.03] px-3.5 py-3">
            <div className="text-[11px] font-medium text-white/45">{label}</div>
            <div className={`mt-1.5 text-[12px] font-medium leading-5 ${tone}`}>{value}</div>
        </div>
    );
}

function SurfaceSection({ children, className = '' }) {
    return (
        <section className={`rounded-[1.3rem] border border-white/10 bg-black/24 p-4 backdrop-blur-xl ${className}`}>
            {children}
        </section>
    );
}

export default function ControlPanel({
    connectionState,
    connectionPillState,
    connectionPillLabel,
    dryRun,
    isConnected,
    teleopActive,
    robotTarget,
    onConnect,
    onDisconnect,
    connectButtonLabel,
    connectButtonDisabled,
    statusSummary,
    commandError,
    onDismissError,
    portScan,
    portScanLoading,
    onScanPorts,
}) {
    const showHint = !commandError && statusSummary?.hint;
    const hintToneClass = statusSummary?.hintTone === 'amber'
        ? 'border-amber-500/18 bg-amber-500/6 text-amber-100/82'
        : 'border-emerald-500/18 bg-emerald-500/6 text-emerald-100/80';
    const connectButtonClass = teleopActive
        ? 'bg-red-500/10 text-red-300 border-red-500/40 hover:bg-red-500/18'
        : connectionState === 'connecting'
            ? 'bg-amber-500/10 text-amber-300 border-amber-500/40 cursor-wait'
            : connectionState === 'online'
                ? connectButtonDisabled
                    ? 'bg-white/[0.03] text-white/35 border-white/10'
                    : 'bg-emerald-500/12 text-emerald-200 border-emerald-500/35 hover:bg-emerald-500/18'
                : 'bg-white/[0.03] text-white/35 border-white/10';
    const applyButtonClass = robotTarget.dirty && !robotTarget.saving && !teleopActive
        ? 'border-white/20 bg-white/[0.06] text-white hover:border-white/35 hover:bg-white/[0.1]'
        : 'border-white/10 bg-white/[0.03] text-white/35';
    const selectedPortLabel = robotTarget.selectedSerialPort || 'No port selected';
    const scanStatusLabel = Array.isArray(portScan?.ports) && portScan.ports.length > 0
        ? `${portScan.ports.length} ports visible`
        : 'No ports visible';
    const selectionTone = robotTarget.selectedPortDetected ? 'text-emerald-200' : 'text-amber-100';

    return (
        <div className="flex h-full flex-col gap-4 p-5 md:p-6">
            <SurfaceSection>
                <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">Robot target</div>
                    <ConnectionPill state={connectionPillState || connectionState} text={connectionPillLabel} />
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                    <SelectField
                        label="Robot model"
                        value={robotTarget.selectedRobotType}
                        onChange={robotTarget.onRobotTypeChange}
                        disabled={teleopActive || robotTarget.saving}
                    >
                        {robotTarget.robotOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </SelectField>

                    <SelectField
                        label="MotorBus port"
                        value={robotTarget.selectedSerialPort}
                        onChange={robotTarget.onSerialPortChange}
                        disabled={teleopActive || robotTarget.saving}
                        action={(
                            <button
                                onClick={onScanPorts}
                                disabled={portScanLoading}
                                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-white/60 transition-all hover:border-white/20 hover:text-white/85 disabled:cursor-wait disabled:opacity-55"
                            >
                                <RefreshCw className={`h-3 w-3 ${portScanLoading ? 'animate-spin' : ''}`} />
                                {portScanLoading ? 'Scanning' : 'Refresh'}
                            </button>
                        )}
                    >
                        <option value="">Select a serial port</option>
                        {robotTarget.portOptions.map((port) => (
                            <option key={port} value={port}>
                                {port}
                            </option>
                        ))}
                    </SelectField>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <SummaryTile label="Runtime target" value={robotTarget.appliedLabel} />
                    <SummaryTile label="Selected port" value={selectedPortLabel} tone={selectionTone} />
                    <SummaryTile label="Discovery" value={scanStatusLabel} />
                </div>

                {commandError ? (
                    <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                            <span className="text-xs font-mono leading-6 text-red-200">{commandError}</span>
                            <button
                                onClick={onDismissError}
                                className="shrink-0 text-[11px] font-medium text-red-200/70 hover:text-red-200"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                ) : null}
            </SurfaceSection>

            <SurfaceSection>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="text-sm font-semibold text-white">Connect robot</div>
                    </div>

                    <div className="grid min-w-[240px] gap-3 sm:grid-cols-2">
                        <button
                            onClick={robotTarget.onApply}
                            disabled={!robotTarget.dirty || robotTarget.saving || teleopActive}
                            className={`rounded-xl border px-4 py-3 text-sm font-medium transition-all ${applyButtonClass}`}
                        >
                            {robotTarget.saving ? 'Applying…' : robotTarget.dirty ? 'Apply target' : 'Target applied'}
                        </button>
                        <button
                            onClick={teleopActive ? onDisconnect : onConnect}
                            disabled={connectButtonDisabled}
                            className={`rounded-xl border px-4 py-3 text-sm font-medium transition-all ${connectButtonClass}`}
                        >
                            {connectButtonLabel}
                        </button>
                    </div>
                </div>

                {showHint ? (
                    <div className={`mt-4 rounded-xl border px-3 py-3 ${hintToneClass}`}>
                        <div className="text-sm leading-6">{statusSummary.hint}</div>
                    </div>
                ) : null}
            </SurfaceSection>

            <div className="grid gap-3 sm:grid-cols-2">
                <SummaryTile label="Service" value={statusSummary.service} />
                <SummaryTile label="Robot" value={statusSummary.robot} />
                <SummaryTile label="Workflow" value={statusSummary.workflow} />
                <SummaryTile label="Gamepad" value={statusSummary.gamepad} />
            </div>
        </div>
    );
}
