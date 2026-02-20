import React, { useState, useRef, useCallback } from 'react';
import { Power } from 'lucide-react';

const EStopButton = ({ onTrigger, disabled, active }) => {
    const [holding, setHolding] = useState(false);
    const [progress, setProgress] = useState(0);
    const timerRef = useRef(null);
    const progressRef = useRef(null);

    const startHold = useCallback(() => {
        if (disabled) return;

        // If already active, release immediately on click (no hold needed)
        if (active) {
            onTrigger();
            return;
        }

        // Engage: hold-to-trigger (700ms)
        setHolding(true);
        setProgress(0);
        const startTime = Date.now();
        progressRef.current = setInterval(() => {
            setProgress(Math.min((Date.now() - startTime) / 700, 1));
        }, 16);
        timerRef.current = setTimeout(() => {
            onTrigger();
            setHolding(false);
            setProgress(0);
            if (progressRef.current) clearInterval(progressRef.current);
        }, 700);
    }, [disabled, active, onTrigger]);

    const cancelHold = useCallback(() => {
        if (active) return; // Release click already handled in startHold
        setHolding(false);
        setProgress(0);
        if (timerRef.current) clearTimeout(timerRef.current);
        if (progressRef.current) clearInterval(progressRef.current);
    }, [active]);

    return (
        <button
            onMouseDown={startHold}
            onMouseUp={cancelHold}
            onMouseLeave={cancelHold}
            disabled={disabled}
            className={`
        relative overflow-hidden px-6 py-3 rounded-2xl font-bold text-sm
        transition-all duration-200 group cursor-pointer
        ${disabled
                    ? 'bg-neutral-900 text-neutral-700 cursor-not-allowed'
                    : active
                        ? 'bg-red-600 text-white shadow-[0_0_30px_rgba(220,38,38,0.6)] animate-pulse'
                        : holding
                            ? 'bg-red-600 text-white scale-95 shadow-[0_0_30px_rgba(220,38,38,0.6)]'
                            : 'bg-red-600/10 text-red-400 hover:bg-red-600/20 border-2 border-red-600/50 shadow-[0_0_15px_rgba(220,38,38,0.3)]'
                }
      `}
        >
            {!active && (
                <div
                    className="absolute inset-0 bg-gradient-to-r from-red-600 to-red-500 transition-transform origin-left"
                    style={{ transform: `scaleX(${progress})` }}
                />
            )}
            <span className="relative z-10 flex items-center gap-2">
                <Power className="w-4 h-4" strokeWidth={2.5} />
                {active ? 'RELEASE' : 'E-STOP'}
            </span>
            {!disabled && !holding && !active && (
                <div className="absolute inset-0 animate-pulse pointer-events-none">
                    <div className="absolute inset-0 bg-red-600/20 blur-xl" />
                </div>
            )}
        </button>
    );
};

export default EStopButton;
