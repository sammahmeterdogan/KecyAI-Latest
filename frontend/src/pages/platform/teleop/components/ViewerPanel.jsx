import React from 'react';
import { Maximize2, Camera, Zap, Thermometer } from 'lucide-react';
import MetricTile from './MetricTile';

const ViewerFallback = () => (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#060608]">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
        <span className="text-[11px] font-mono tracking-wider text-white/30">LOADING 3D VIEWER...</span>
    </div>
);

const ViewerPanel = ({
    children,
    onFullscreen,
    onSnapshot,
    telemetry,
    isConnected,
    dryRun,
    viewerRef,
}) => {
    const showMetrics = telemetry.voltage != null || telemetry.temperature != null;

    return (
        <div className="flex h-full flex-col overflow-hidden rounded-[1.45rem] border border-white/10 bg-[#050608] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-center justify-between border-b border-white/8 bg-black/32 px-4 py-3 backdrop-blur-md md:px-5">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-white/68">
                        Live render
                    </span>
                    <span
                        className={`rounded-full border px-3 py-1.5 text-[11px] font-medium ${
                            isConnected
                                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
                                : 'border-white/10 bg-white/[0.03] text-white/52'
                        }`}
                    >
                        {isConnected ? 'Robot connected' : 'Awaiting session'}
                    </span>
                    {dryRun ? (
                        <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-[11px] font-medium text-amber-100">
                            Dry run
                        </span>
                    ) : null}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={onSnapshot}
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/60 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                    >
                        <Camera className="h-4 w-4" />
                    </button>
                    <button
                        onClick={onFullscreen}
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/60 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                    >
                        <Maximize2 className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div ref={viewerRef} className="relative flex-1 overflow-hidden">
                {children || <ViewerFallback />}

                <div
                    className="pointer-events-none absolute inset-0 opacity-20"
                    style={{
                        backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
                        backgroundSize: '40px 40px',
                    }}
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black via-black/35 to-transparent" />
            </div>

            {showMetrics ? (
                <div className="border-t border-white/8 bg-black/30 px-4 py-4 backdrop-blur-md md:px-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <MetricTile
                            icon={Zap}
                            label="Voltage"
                            value={telemetry.voltage != null ? telemetry.voltage.toFixed(1) : '—'}
                            unit="V"
                            glowColor="rgba(234,179,8,0.2)"
                        />
                        <MetricTile
                            icon={Thermometer}
                            label="Temp"
                            value={telemetry.temperature != null ? `${telemetry.temperature}°` : '—'}
                            unit="C"
                            glowColor="rgba(239,68,68,0.2)"
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );
};

export default ViewerPanel;
