
import React, { Suspense } from 'react';
import { Activity, Maximize, RefreshCw } from 'lucide-react';

const UrdfRobotViewer = React.lazy(() => import('../../teleop3d/UrdfRobotViewer'));

export default function ViewerPanel({ joints }) {
    return (
        <div className="w-full h-full relative group">
            {/* 3D Viewport Wrapper */}
            <div className="absolute inset-0 bg-[#050505] rounded-xl overflow-hidden border border-white/10 shadow-2xl">
                <Suspense fallback={
                    <div className="w-full h-full flex flex-col items-center justify-center text-white/20 gap-4 bg-[#0a0a0a]">
                        <div className="relative">
                            <div className="w-12 h-12 rounded-full border-2 border-white/10" />
                            <div className="absolute top-0 left-0 w-12 h-12 rounded-full border-2 border-t-lime-500 animate-spin" />
                        </div>
                        <span className="text-[10px] tracking-[0.2em] uppercase font-mono">Loading Environs</span>
                    </div>
                }>
                    <UrdfRobotViewer joints={joints} />
                </Suspense>
            </div>

            {/* Top Right Controls Overlay */}
            <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <button className="p-2 rounded-lg bg-black/60 backdrop-blur border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-all" title="Reset Camera">
                    <RefreshCw size={14} />
                </button>
                <button className="p-2 rounded-lg bg-black/60 backdrop-blur border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-all" title="Fit to Screen">
                    <Maximize size={14} />
                </button>
            </div>

            {/* Bottom Left Status Overlay */}
            <div className="absolute bottom-6 left-6 pointer-events-none">
                <div className="flex items-center gap-3">
                    <div className="bg-black/80 backdrop-blur border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-2">
                        <div className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-lime-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-lime-500"></span>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white/80">Live Render</span>
                    </div>

                    <div className="bg-black/60 backdrop-blur border border-white/5 px-3 py-1.5 rounded-full flex items-center gap-2">
                        <Activity size={10} className="text-white/40" />
                        <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">ROS Engine: Ready</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
