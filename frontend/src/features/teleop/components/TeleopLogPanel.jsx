import React, { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';

export default function TeleopLogPanel({ logs, onClear }) {
    const scrollRef = useRef(null);

    /* Auto-scroll to bottom when new log entries arrive */
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className="rounded-xl border border-[#1e2028] bg-[#111318]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#1a1d24] px-3.5 py-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#4a4e58]">
                    Runtime Logs
                </span>
                {onClear && (
                    <button
                        type="button"
                        onClick={onClear}
                        disabled={logs.length === 0}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] text-[#4a4e58] transition-colors hover:bg-white/[0.04] hover:text-[#7a7e88] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                        <Trash2 size={9} />
                        Clear
                    </button>
                )}
            </div>

            {/* Log content */}
            <div
                ref={scrollRef}
                className="h-[120px] overflow-y-auto px-3.5 py-2 font-mono text-[10px] leading-[1.7] text-[#5a5e69]"
                style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.04) transparent' }}
            >
                {logs.length === 0 ? (
                    <p className="pt-6 text-center text-[#3a3e48]">No logs yet.</p>
                ) : (
                    logs.slice(-100).map((line, index) => (
                        <p key={`${index}-${line.slice(0, 16)}`} className="whitespace-pre-wrap break-all">
                            {line}
                        </p>
                    ))
                )}
            </div>
        </div>
    );
}
