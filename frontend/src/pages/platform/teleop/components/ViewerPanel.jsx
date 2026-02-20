import React from 'react';
import { Maximize2, Camera, Download, Activity, Zap, Thermometer } from 'lucide-react';
import MetricTile from './MetricTile';

// Placeholder for 3D Viewer loading state
const ViewerFallback = () => (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#060608]">
        <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        <span className="text-[11px] font-mono text-white/30 tracking-wider">LOADING 3D VIEWER...</span>
    </div>
);

const ViewerPanel = ({
    children,
    onFullscreen,
    onSnapshot,
    telemetry,
    isConnected,
    dryRun,
    viewerRef
}) => {
    return (
        <div className="flex flex-col h-full bg-[#060608] relative overflow-hidden rounded-tl-2xl border-l border-t border-white/10">

            {/* Top Overlay */}
            <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start z-10 pointer-events-none">
                {/* Live Indicator */}
                <div className="flex flex-col gap-2">
                    <div className="bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-2 pointer-events-auto">
                        <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-red-500 animate-pulse' : 'bg-neutral-600'}`} />
                        <span className="text-xs font-black tracking-widest text-white/80">LIVE RENDER</span>
                    </div>
                    {dryRun && (
                        <div className="bg-amber-950/40 backdrop-blur-md border border-amber-500/30 px-3 py-1.5 rounded-lg pointer-events-auto">
                            <span className="text-[10px] font-black text-amber-500 tracking-widest">SIMULATION MODE</span>
                        </div>
                    )}
                </div>

                {/* Actions Toolbar */}
                <div className="flex items-center gap-2 pointer-events-auto">
                    <button
                        onClick={onSnapshot}
                        className="w-10 h-10 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 hover:border-white/20 transition-all text-white/60 hover:text-white"
                    >
                        <Camera className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onFullscreen}
                        className="w-10 h-10 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 hover:border-white/20 transition-all text-white/60 hover:text-white"
                    >
                        <Maximize2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* 3D Canvas Container */}
            <div ref={viewerRef} className="flex-1 relative z-0">
                {children || <ViewerFallback />}

                {/* Bottom Gradient for Stats */}
                <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent pointer-events-none" />
            </div>

            {/* Bottom Stats & Branding */}
            <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between z-10 pointer-events-none">
                <div className="flex gap-4 pointer-events-auto">
                    <MetricTile icon={Zap} label="Voltage" value={telemetry.voltage.toFixed(1)} unit="V" glowColor="rgba(234,179,8,0.2)" />
                    <MetricTile icon={Thermometer} label="Temp" value={telemetry.temperature + "°"} unit="C" glowColor="rgba(239,68,68,0.2)" />
                </div>

                <div className="text-right opacity-50">
                    <div className="text-[10px] font-black tracking-[0.2em] text-white/40 mb-1">PROCESSED BY</div>
                    <div className="text-xl font-black italic tracking-tighter text-white">ROS ENGINE v2.4</div>
                </div>
            </div>

            {/* Grid Overlay */}
            <div className="absolute inset-0 pointer-events-none opacity-20"
                style={{
                    backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
                    backgroundSize: '40px 40px'
                }}
            />
        </div>
    );
};

export default ViewerPanel;
