import React from 'react';
import { Sliders, Activity, TrendingUp, Settings, Layers, MonitorPlay, ChevronRight, ChevronLeft } from 'lucide-react';
import ConnectionPill from './ConnectionPill';
import JointCard from './JointCard';
import EStopButton from './EStopButton';
import MetricTile from './MetricTile';
import LogViewer from './LogViewer';

const ControlPanel = ({
    connectionState,
    telemetry,
    dryRun,
    isConnected,
    joints,
    sensitivity,
    setSensitivity,
    onJointUpdate,
    onEStop,
    onReset,
    logs,
    onClearLogs,
    sidebarCollapsed,
    setSidebarCollapsed,
    onConnect,
    onDisconnect,
    commandError,
    onDismissError,
    estopActive,
}) => {
    return (
        <div className="flex flex-col h-full bg-black/60 backdrop-blur-xl border-r border-white/10 relative">
            {/* ─── TOP BAR (Left Side) ─── */}
            <div className="h-16 border-b border-white/10 px-4 flex items-center justify-between shrink-0 shadow-[0_4px_20px_rgba(0,0,0,0.5)] z-30">
                <div className="flex items-center gap-3">
                    {/* Robot Selector */}
                    <div className="relative">
                        <select className="bg-black/80 backdrop-blur-xl border border-white/20 rounded-xl px-4 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-white/30 focus:border-white/40 transition-all hover:border-white/30 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] appearance-none pr-8 cursor-pointer text-white">
                            <option>SO_ARM101</option>
                            <option>SO_ARM102</option>
                        </select>
                        <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent rounded-xl pointer-events-none" />
                        <ChevronRight className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/40 rotate-90 pointer-events-none" />
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Connection Control */}
                        <button
                            onClick={isConnected ? onDisconnect : onConnect}
                            disabled={connectionState !== 'online' && connectionState !== 'connecting'}
                            className={`
                            h-8 px-4 rounded-lg text-xs font-bold tracking-wider transition-all border flex items-center gap-2
                            ${isConnected
                                    ? 'bg-red-500/10 text-red-500 border-red-500/50 hover:bg-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.2)]'
                                    : connectionState === 'connecting'
                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/50 cursor-wait'
                                        : connectionState === 'online'
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50 hover:bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)] animate-pulse'
                                            : 'bg-neutral-800 text-neutral-500 border-neutral-700 cursor-not-allowed'
                                }
                        `}
                        >
                            {connectionState === 'connecting' ? (
                                <>
                                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                                    CONNECTING...
                                </>
                            ) : connectionState !== 'online' ? (
                                <>
                                    <div className="w-2 h-2 rounded-full bg-neutral-600" />
                                    RUNTIME OFFLINE
                                </>
                            ) : isConnected ? (
                                <>
                                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                    DISCONNECT
                                </>
                            ) : (
                                <>
                                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                                    CONNECT ROBOT
                                </>
                            )}
                        </button>

                        <div className="w-px h-6 bg-white/10 mx-1" />

                        <ConnectionPill state={connectionState} />
                    </div>
                </div>
            </div>

            {/* Error Banner */}
            {commandError && (
                <div className="mx-4 mt-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between gap-2 shrink-0">
                    <span className="text-xs text-red-400 font-mono truncate">{commandError}</span>
                    <button onClick={onDismissError} className="text-red-400/60 hover:text-red-400 text-xs font-bold shrink-0">X</button>
                </div>
            )}

            {/* Offline Guidance */}
            {connectionState === 'offline' && !commandError && (
                <div className="mx-4 mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg shrink-0">
                    <span className="text-xs text-amber-400 font-mono">
                        Runtime offline. Start with: docker compose up runtime
                    </span>
                </div>
            )}

            {/* E-STOP Banner */}
            {estopActive && (
                <div className="mx-4 mt-2 px-3 py-2 bg-red-600/20 border border-red-600/50 rounded-lg shrink-0 animate-pulse">
                    <span className="text-xs text-red-400 font-mono font-bold">
                        E-STOP ENGAGED -- All commands blocked
                    </span>
                </div>
            )}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 cyber-scrollbar">
                {/* Telemetry Grid */}
                <div className="grid grid-cols-2 gap-3">
                    <MetricTile icon={Activity} label="FPS" value={telemetry.fps.toFixed(0)} unit="hz" />
                    <MetricTile icon={TrendingUp} label="Latency" value={telemetry.latency.toFixed(0)} unit="ms" />
                </div>

                {/* Joint Controls */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
                            <Sliders className="w-3 h-3" /> Joint Control
                        </h3>
                        <div className="flex bg-white/5 rounded-lg p-0.5">
                            {['low', 'medium', 'high'].map(s => (
                                <button
                                    key={s}
                                    onClick={() => setSensitivity(s)}
                                    className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded-md transition-all ${sensitivity === s ? 'bg-white/20 text-white' : 'text-white/30 hover:text-white/60'
                                        }`}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        {joints.map(joint => (
                            <JointCard
                                key={joint.id}
                                joint={joint}
                                sensitivity={sensitivity}
                                onUpdate={onJointUpdate}
                                disabled={!isConnected || estopActive}
                            />
                        ))}
                    </div>
                </div>

                {/* Global Actions */}
                <div className="grid grid-cols-2 gap-3">
                    <EStopButton onTrigger={onEStop} disabled={!isConnected} active={estopActive} />
                    <button
                        onClick={onReset}
                        disabled={!isConnected}
                        className="px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-sm font-bold text-white/60 hover:text-white transition-all hover:border-white/20 hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        <div className="w-2 h-2 rounded-full bg-white/20" />
                        RESET POSE
                    </button>
                </div>

                {/* Logs */}
                <div className="h-48">
                    <LogViewer logs={logs} onClear={onClearLogs} />
                </div>
            </div>
        </div >
    );
};

export default ControlPanel;
