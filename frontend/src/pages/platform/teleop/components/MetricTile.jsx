import React from 'react';

const MetricTile = ({ icon: Icon, label, value, unit, glowColor }) => (
    <div className="group relative">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-white/5 to-white/10 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm" />
        <div className="relative bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-4 transition-all duration-300 hover:border-white/20 hover:shadow-[0_0_20px_rgba(255,255,255,0.08)]">
            <div className="relative flex items-center gap-3">
                <div
                    className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"
                    style={glowColor ? { boxShadow: `0 0 12px ${glowColor}` } : {}}
                >
                    <Icon className="w-5 h-5 text-white/60" strokeWidth={2} />
                </div>
                <div>
                    <div className="text-[10px] text-white/40 uppercase tracking-wider font-bold">{label}</div>
                    <div className="text-lg font-black text-white font-mono">
                        {value}
                        {unit && <span className="text-xs text-white/40 ml-1">{unit}</span>}
                    </div>
                </div>
            </div>
        </div>
    </div>
);

export default MetricTile;
