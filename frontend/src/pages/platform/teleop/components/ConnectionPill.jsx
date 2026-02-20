import React from 'react';
import { Wifi, WifiOff } from 'lucide-react';

const ConnectionPill = ({ state }) => {
    const config = {
        offline: { color: 'bg-neutral-900 border-neutral-800', icon: WifiOff, text: 'OFFLINE', iconColor: 'text-neutral-600', glow: '' },
        connecting: { color: 'bg-amber-950/50 border-amber-900/50', icon: Wifi, text: 'CONNECTING', iconColor: 'text-amber-500', glow: 'shadow-[0_0_20px_rgba(245,158,11,0.3)]' },
        online: { color: 'bg-emerald-950/50 border-emerald-900/50', icon: Wifi, text: 'ONLINE', iconColor: 'text-emerald-400', glow: 'shadow-[0_0_20px_rgba(16,185,129,0.3)]' },
        reconnecting: { color: 'bg-amber-950/50 border-amber-900/50', icon: Wifi, text: 'RECONNECTING', iconColor: 'text-amber-500', glow: 'shadow-[0_0_20px_rgba(245,158,11,0.3)]' },
    };

    const { color, icon: Icon, text, iconColor, glow } = config[state] || config.offline;

    return (
        <div className={`relative flex items-center gap-2 px-4 py-2 rounded-xl border backdrop-blur-xl ${color} ${glow}`}>
            <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent rounded-xl" />
            <Icon className={`w-4 h-4 ${iconColor} relative z-10`} strokeWidth={2.5} />
            <span className="text-sm font-bold tracking-wider relative z-10">{text}</span>
            {state === 'online' && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
            )}
        </div>
    );
};

export default ConnectionPill;
