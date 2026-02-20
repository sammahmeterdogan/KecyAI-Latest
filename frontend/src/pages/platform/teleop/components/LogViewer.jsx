import React, { useRef, useState, useEffect } from 'react';
import { Terminal } from 'lucide-react';

const LogViewer = ({ logs, onClear }) => {
    const containerRef = useRef(null);
    const [autoScroll, setAutoScroll] = useState(true);

    useEffect(() => {
        if (autoScroll && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    const handleScroll = () => {
        if (!containerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
    };

    return (
        <div className="group relative flex flex-col h-full">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-white/5 to-white/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm" />
            <div className="relative flex-1 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden flex flex-col transition-all duration-300 hover:border-white/20">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/30">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-white/50" strokeWidth={2.5} />
                        <span className="text-xs font-bold text-white/60 uppercase tracking-wider">System Logs</span>
                        <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] font-mono text-white/40">
                            {logs.length}
                        </span>
                    </div>
                    <button
                        onClick={onClear}
                        className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-bold text-white/50 hover:text-white/80 transition-all border border-white/10 hover:border-white/20 cursor-pointer"
                    >
                        CLEAR
                    </button>
                </div>

                {/* Log lines */}
                <div
                    ref={containerRef}
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-[11px]"
                    style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.06) transparent' }}
                >
                    {logs.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-white/20 text-xs">
                            No logs available
                        </div>
                    ) : (
                        logs.map((log, i) => {
                            const text = typeof log === 'string' ? log : JSON.stringify(log);
                            const isError = text.toLowerCase().includes('error') || text.toLowerCase().includes('fail');
                            const isWarning = text.toLowerCase().includes('warn') || text.toLowerCase().includes('timeout');
                            return (
                                <div
                                    key={i}
                                    className={`px-2 py-1 rounded-md ${isError
                                            ? 'bg-red-500/5 text-red-400/80 border-l-2 border-red-500/30'
                                            : isWarning
                                                ? 'bg-amber-500/5 text-amber-400/80 border-l-2 border-amber-500/30'
                                                : 'text-white/40 hover:text-white/60 hover:bg-white/5'
                                        } transition-colors`}
                                >
                                    <span className="text-white/20 mr-2 select-none">{String(i + 1).padStart(3, '0')}</span>
                                    {text}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default LogViewer;
