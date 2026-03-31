import React, { useMemo } from 'react';
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowUpFromLine,
    ArrowDownFromLine,
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

// Joint-space control cards — labels match actual SO-101 joints
const CONTROL_GROUPS = [
    {
        label: 'Shoulder',
        cards: [
            { keyId: 'ArrowLeft', displayKey: 'LEFT', label: 'Pan +', icon: ArrowLeft },
            { keyId: 'ArrowRight', displayKey: 'RIGHT', label: 'Pan −', icon: ArrowRight },
            { keyId: 'ArrowUp', displayKey: 'UP', label: 'Lift +', icon: ArrowUp },
            { keyId: 'ArrowDown', displayKey: 'DOWN', label: 'Lift −', icon: ArrowDown },
        ],
    },
    {
        label: 'Elbow',
        cards: [
            { keyId: 'f', displayKey: 'F', label: 'Flex +', icon: ChevronUp },
            { keyId: 'v', displayKey: 'V', label: 'Flex −', icon: ChevronDown },
        ],
    },
    {
        label: 'Wrist',
        cards: [
            { keyId: 'd', displayKey: 'D', label: 'Pitch +', icon: ArrowUpFromLine },
            { keyId: 'g', displayKey: 'G', label: 'Pitch −', icon: ArrowDownFromLine },
            { keyId: 'b', displayKey: 'B', label: 'Roll +', icon: RotateCw },
            { keyId: 'c', displayKey: 'C', label: 'Roll −', icon: RotateCcw },
        ],
    },
    {
        label: 'Gripper',
        cards: [
            { keyId: ' ', displayKey: 'SPACE', label: 'Hold to close', icon: Circle, wide: true },
        ],
    },
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
                'relative overflow-hidden rounded-xl border transition-all select-none',
                control.wide ? 'col-span-2' : '',
                active
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                    : 'border-white/10 bg-white/[0.02] text-white/60 hover:border-white/20 hover:bg-white/[0.04]',
                disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
            ].join(' ')}
            style={{ padding: '10px 12px' }}
        >
            <div className="flex items-center gap-3">
                <div className={[
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                    active ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10 bg-white/[0.03]',
                ].join(' ')}>
                    <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                    <div className="text-[10px] font-bold tracking-[0.2em] text-white/30 uppercase">
                        {control.displayKey}
                    </div>
                    <div className="text-[11px] font-semibold tracking-wide uppercase">
                        {control.label}
                    </div>
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
    const disabled = !isConnected || estopActive;
    const activeKeySet = useMemo(() => new Set(activeKeys), [activeKeys]);

    return (
        <div className="space-y-4">
            {/* Header + Controls */}
            <div className="rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur-xl">
                {/* Title row */}
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/40 mb-3">
                    <Keyboard className="h-3.5 w-3.5" />
                    Keyboard Control
                    <div className={`ml-auto h-2 w-2 rounded-full ${isKeyboardActive ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-white/15'}`} />
                </div>

                {/* Buttons + Speed — single row */}
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={isKeyboardActive ? onStop : onStart}
                        disabled={disabled}
                        className={[
                            'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all',
                            isKeyboardActive
                                ? 'border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/15'
                                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15',
                            disabled ? 'cursor-not-allowed opacity-50' : '',
                        ].join(' ')}
                    >
                        {isKeyboardActive ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {isKeyboardActive ? 'STOP' : 'START'}
                    </button>

                    {/* Speed slider inline */}
                    <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                        <Gauge className="h-3.5 w-3.5 shrink-0 text-white/30" />
                        <input
                            type="range"
                            min="0.2"
                            max="2"
                            step="0.1"
                            value={keyboardSpeed}
                            onChange={(e) => onSpeedChange(Number(e.target.value))}
                            disabled={disabled}
                            className="h-1 flex-1 cursor-pointer accent-white disabled:opacity-40"
                        />
                        <span className="text-[10px] font-bold text-white/50 tabular-nums w-7 text-right">
                            {keyboardSpeed.toFixed(1)}x
                        </span>
                    </div>
                </div>
            </div>

            {/* Key cards — grouped by joint area */}
            {CONTROL_GROUPS.map((group) => (
                <div key={group.label}>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/25 pl-1">
                        {group.label}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {group.cards.map((control) => (
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
                </div>
            ))}

            {/* Instructions */}
            <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2.5 text-[10px] leading-4 text-white/30 font-mono">
                Arrows = shoulder &middot; F/V = elbow &middot; D/G = wrist pitch &middot; B/C = wrist roll &middot; Space = gripper
            </div>
        </div>
    );
}
