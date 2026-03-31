import React from 'react';
import { AlertCircle, Wifi, WifiOff } from 'lucide-react';

const ConnectionPill = ({ state, text }) => {
    const config = {
        offline: { color: 'bg-neutral-900/70 border-neutral-800/80', icon: WifiOff, text: 'OFFLINE', iconColor: 'text-neutral-500', glow: '' },
        connecting: { color: 'bg-amber-950/40 border-amber-900/50', icon: Wifi, text: 'CONNECTING', iconColor: 'text-amber-400', glow: '' },
        online: { color: 'bg-emerald-950/35 border-emerald-900/40', icon: Wifi, text: 'ONLINE', iconColor: 'text-emerald-300', glow: '' },
        working: { color: 'bg-cyan-950/35 border-cyan-900/40', icon: Wifi, text: 'WORKING', iconColor: 'text-cyan-300', glow: '' },
        error: { color: 'bg-red-950/35 border-red-900/40', icon: AlertCircle, text: 'ERROR', iconColor: 'text-red-300', glow: '' },
        reconnecting: { color: 'bg-amber-950/40 border-amber-900/50', icon: Wifi, text: 'RECONNECTING', iconColor: 'text-amber-400', glow: '' },
    };

    const { color, icon: Icon, text: fallbackText, iconColor, glow } = config[state] || config.offline;
    const label = text || fallbackText;

    return (
        <div className={`relative flex items-center gap-2 rounded-xl border px-3 py-2 backdrop-blur-xl ${color} ${glow}`}>
            <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent rounded-xl" />
            <Icon className={`w-4 h-4 ${iconColor} relative z-10`} strokeWidth={2.5} />
            <span className="relative z-10 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/84">{label}</span>
            {['online', 'working'].includes(state) && (
                <div className="absolute right-2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            )}
        </div>
    );
};

export default ConnectionPill;
