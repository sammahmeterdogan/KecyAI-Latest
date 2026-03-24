import React, { useMemo, useState } from 'react';
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowUpFromLine,
    ChevronDown,
    ChevronUp,
    Circle,
    Gauge,
    Keyboard,
    Play,
    RotateCcw,
    RotateCw,
    Square,
} from 'lucide-react';

const CONTROL_CARDS = [
    { keyId: 'ArrowUp', displayKey: 'UP', label: 'Move Forward', icon: ArrowUp },
    { keyId: 'ArrowDown', displayKey: 'DOWN', label: 'Move Back', icon: ArrowDown },
    { keyId: 'ArrowLeft', displayKey: 'LEFT', label: 'Yaw Left', icon: ArrowLeft },
    { keyId: 'ArrowRight', displayKey: 'RIGHT', label: 'Yaw Right', icon: ArrowRight },
    { keyId: 'f', displayKey: 'F', label: 'Z Up', icon: ChevronUp },
    { keyId: 'v', displayKey: 'V', label: 'Z Down', icon: ChevronDown },
    { keyId: 'd', displayKey: 'D', label: 'Wrist Up', icon: ArrowUpFromLine },
    { keyId: 'g', displayKey: 'G', label: 'Wrist Down', icon: ArrowDown },
    { keyId: 'b', displayKey: 'B', label: 'Roll CW', icon: RotateCw },
    { keyId: 'c', displayKey: 'C', label: 'Roll CCW', icon: RotateCcw },
    { keyId: ' ', displayKey: 'SPACE', label: 'Close Gripper', icon: Circle, wide: true },
];

function KeyCard({ control, active, disabled, onPress, onRelease }) {
    const Icon = control.icon;

    const handlePointerDown = (event) => {
        event.preventDefault();
        if (!disabled) onPress(control.keyId);
    };

    const handlePointerUp = () => {
        if (!disabled) onRelease(control.keyId);
    };

    return (
        <button
            type="button"
            disabled={disabled}
            onMouseDown={handlePointerDown}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchEnd={handlePointerUp}
            onTouchCancel={handlePointerUp}
            className={[
                'relative overflow-hidden rounded-2xl border p-3 text-left transition-all select-none',
                'bg-black/40 backdrop-blur-xl',
                control.wide ? 'col-span-2' : '',
                active
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.18)]'
                    : 'border-white/10 text-white/70 hover:border-white/20 hover:bg-white/[0.04]',
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            ].join(' ')}
        >
            <div className="absolute inset-0 bg-gradient-to-r from-white/[0.03] to-transparent pointer-events-none" />
            <div className="relative flex items-center justify-between gap-3">
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
                        {control.displayKey}
                    </div>
                    <div className="mt-1 text-xs font-bold uppercase tracking-[0.14em]">
                        {control.label}
                    </div>
                </div>
                <div className={[
                    'flex h-9 w-9 items-center justify-center rounded-xl border',
                    active ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10 bg-white/[0.03]',
                ].join(' ')}>
                    <Icon className="h-4 w-4" />
                </div>
            </div>
        </button>
    );
}

export default function KeyboardControlTab({
    isConnected,
    estopActive,
    isKeyboardActive,
    keyboardSpeed,
    activeKeys,
    onStart,
    onStop,
    onSpeedChange,
    onKeyPress,
    onKeyRelease,
}) {
    const [speedOpen, setSpeedOpen] = useState(false);
    const disabled = !isConnected || estopActive;
    const activeKeySet = useMemo(() => new Set(activeKeys), [activeKeys]);

    return (
        <div className="space-y-4">
            <div className="group relative">
                <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-white/5 to-white/10 opacity-0 blur-sm transition-opacity duration-500 group-hover:opacity-100" />
                <div className="relative rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur-xl">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/40">
                                <Keyboard className="h-3.5 w-3.5" />
                                Keyboard Control
                            </div>
                            <p className="mt-2 text-[11px] leading-5 text-white/45 font-mono">
                                Control the robot joints directly via keyboard. Start control, then use the keyboard or press the cards below.
                            </p>
                        </div>
                        <div className="relative shrink-0">
                            <button
                                type="button"
                                onClick={() => setSpeedOpen((open) => !open)}
                                disabled={disabled}
                                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/70 transition-all hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Gauge className="h-3.5 w-3.5" />
                                {keyboardSpeed.toFixed(1)}x
                            </button>
                            {speedOpen && (
                                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-56 rounded-2xl border border-white/10 bg-black/80 p-4 backdrop-blur-2xl shadow-[0_20px_40px_rgba(0,0,0,0.45)]">
                                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                                        <span>Speed</span>
                                        <span className="text-white/65">{keyboardSpeed.toFixed(1)}x</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0.2"
                                        max="2"
                                        step="0.1"
                                        value={keyboardSpeed}
                                        onChange={(event) => onSpeedChange(Number(event.target.value))}
                                        className="mt-4 h-1.5 w-full cursor-pointer accent-white"
                                    />
                                    <div className="mt-2 flex justify-between text-[10px] font-mono text-white/30">
                                        <span>0.2x</span>
                                        <span>2.0x</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={onStart}
                            disabled={disabled || isKeyboardActive}
                            className={[
                                'flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition-all',
                                isKeyboardActive
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                    : 'border-white/10 bg-white/[0.03] text-white/70 hover:border-white/20 hover:bg-white/[0.05]',
                                disabled ? 'cursor-not-allowed opacity-50' : '',
                            ].join(' ')}
                        >
                            <Play className="h-4 w-4" />
                            {isKeyboardActive ? 'CONTROL LIVE' : 'START'}
                        </button>

                        <button
                            type="button"
                            onClick={onStop}
                            disabled={!isKeyboardActive}
                            className="flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-400 transition-all hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Square className="h-4 w-4" />
                            STOP
                        </button>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
                        <div className={`h-2 w-2 rounded-full ${isKeyboardActive ? 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.4)]' : 'bg-white/15'}`} />
                        {isKeyboardActive ? 'Keyboard capture armed' : 'Keyboard capture idle'}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {CONTROL_CARDS.map((control) => (
                    <KeyCard
                        key={control.keyId}
                        control={control}
                        active={activeKeySet.has(control.keyId)}
                        disabled={disabled || !isKeyboardActive}
                        onPress={onKeyPress}
                        onRelease={onKeyRelease}
                    />
                ))}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[11px] leading-5 text-white/40 font-mono">
                `ARROWS` steer, `F / V` shift vertical reach, `D / G` pitch the wrist, `B / C` roll the wrist, and hold `SPACE` to close the gripper.
            </div>
        </div>
    );
}
