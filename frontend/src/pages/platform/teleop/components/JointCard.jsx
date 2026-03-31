import React from 'react';

// Joint values are already in degrees — display directly
const fmtDeg = (deg) => Number(deg).toFixed(1);
const fmtTemp = (temp) => (typeof temp === 'number' && !Number.isNaN(temp) ? `${Math.round(temp)}C` : '--');

const SENSITIVITY_STEPS = {
    low: 5,
    medium: 1,
    high: 0.1,
};

const JointCard = ({ joint, sensitivity, onUpdate, disabled }) => {
    const actualPosition = typeof joint.actualPosition === 'number' ? joint.actualPosition : joint.position;
    const percentage = ((actualPosition - joint.minLimit) / (joint.maxLimit - joint.minLimit)) * 100;
    const clampedPct = Math.max(0, Math.min(100, percentage));

    const handleChange = (e) => onUpdate(joint.id, parseFloat(e.target.value));

    const handleCenter = () => {
        const center = (joint.minLimit + joint.maxLimit) / 2;
        onUpdate(joint.id, center);
    };

    const statusConfig = {
        ok: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-[0_0_10px_rgba(16,185,129,0.2)]' },
        limit: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', glow: 'shadow-[0_0_10px_rgba(245,158,11,0.2)]' },
        overload: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', glow: 'shadow-[0_0_10px_rgba(220,38,38,0.2)]' },
    };
    const status = statusConfig[joint.status] || statusConfig.ok;

    return (
        <div className="group relative">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-white/10 via-white/5 to-white/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm" />
            <div className="relative bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-5 transition-all duration-300 hover:border-white/20 hover:shadow-[0_0_30px_rgba(255,255,255,0.1)]">
                {/* Scan line */}
                <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent animate-scan-line" />
                </div>

                {/* Header */}
                <div className="relative flex items-start justify-between mb-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-1 h-4 bg-gradient-to-b from-white to-white/50" />
                            <h3 className="text-sm font-bold text-white tracking-wide uppercase">{joint.name}</h3>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono flex-wrap">
                            <span className="text-white/40">S{joint.servoId}</span>
                            <span className="text-white/70">TGT {fmtDeg(joint.position)}</span>
                            <span className="text-white/30">ACT {fmtDeg(actualPosition)}</span>
                            <span className="text-white/20">|</span>
                            <span className="text-white/40">TEMP {fmtTemp(joint.temperature)}</span>
                            <span className="text-white/20">|</span>
                            <span className={`px-2 py-0.5 rounded-md border ${status.bg} ${status.text} ${status.border} ${status.glow}`}>
                                {joint.status.toUpperCase()}
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={handleCenter}
                        disabled={disabled}
                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed rounded-lg text-xs font-bold transition-all border border-white/10 hover:border-white/20 hover:shadow-[0_0_15px_rgba(255,255,255,0.2)] cursor-pointer"
                    >
                        CENTER
                    </button>
                </div>

                {/* Limit bar */}
                <div className="relative h-2 bg-neutral-900/50 rounded-full mb-3 overflow-hidden border border-white/10">
                    <div
                        className="absolute h-full bg-gradient-to-r from-white/20 to-white/40 transition-all duration-150"
                        style={{ width: `${clampedPct}%` }}
                    />
                    <div
                        className="absolute h-full w-1 bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"
                        style={{ left: `${clampedPct}%`, transform: 'translateX(-50%)' }}
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:10%_100%]" />
                </div>

                {/* Slider */}
                <input
                    type="range"
                    min={joint.minLimit}
                    max={joint.maxLimit}
                    step={SENSITIVITY_STEPS[sensitivity]}
                    value={joint.position}
                    onChange={handleChange}
                    disabled={disabled}
                    className="cyber-slider w-full h-2 bg-neutral-900/50 rounded-full appearance-none cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed border border-white/10"
                />

                {/* Range labels */}
                <div className="flex justify-between mt-2 text-[10px] text-white/40 font-mono">
                    <span>{fmtDeg(joint.minLimit)}</span>
                    <span>{fmtDeg(joint.maxLimit)}</span>
                </div>
            </div>
        </div>
    );
};

export default JointCard;
