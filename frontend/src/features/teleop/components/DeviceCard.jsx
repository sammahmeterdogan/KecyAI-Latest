
import React from 'react';
import { Cpu, Activity, Usb } from 'lucide-react';

export default function DeviceCard({ status, onStart, onStop, loading }) {
    const isRunning = status.state === 'running';

    return (
        <div className="glass-panel p-5 shrink-0 relative overflow-hidden group">
            {/* Background Accent */}
            <div className={`absolute top-0 right-0 w-32 h-32 bg-lime-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 transition-opacity duration-1000 ${isRunning ? 'opacity-100' : 'opacity-0'}`} />

            <div className="relative z-10 flex items-start justify-between">
                <div>
                    <h2 className="text-lg font-medium tracking-tight flex items-center gap-2 text-white/90">
                        <Cpu size={18} className={isRunning ? "text-lime-400" : "text-white/40"} />
                        SO-ARM101
                    </h2>
                    <div className="flex items-center gap-3 mt-2 text-[11px] font-mono text-white/40">
                        <span className="flex items-center gap-1">
                            <Usb size={10} /> /dev/ttyUSB0
                        </span>
                        <span>•</span>
                        <span>ID: le_follower_01</span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1.5 transition-all duration-300 ${isRunning
                        ? 'bg-lime-500/10 text-lime-400 border-lime-500/20 shadow-[0_0_10px_rgba(132,204,22,0.1)]'
                        : 'bg-white/5 text-white/30 border-white/10'
                        }`}>
                        {isRunning && <Activity size={10} className="animate-pulse" />}
                        {isRunning ? 'Running' : 'Standby'}
                    </div>
                </div>
            </div>

            {/* Action Bar */}
            <div className="mt-4 pt-4 border-t border-white/5 flex gap-2">
                {!isRunning ? (
                    <button
                        onClick={onStart}
                        className="flex-1 btn-primary py-2 text-xs flex items-center justify-center gap-2"
                        disabled={loading}
                    >
                        {loading ? 'Starting...' : 'Start Session'}
                    </button>
                ) : (
                    <button
                        onClick={onStop}
                        className="flex-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 py-2 rounded text-xs font-medium transition-all"
                        disabled={loading}
                    >
                        {loading ? 'Stopping...' : 'Stop Session'}
                    </button>
                )}
            </div>
        </div>
    );
}
