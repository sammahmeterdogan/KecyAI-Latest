
import React from 'react';
import { Layers, Save, Play, Trash2 } from 'lucide-react';

const SequenceStep = ({ idx, type, params }) => (
    <div className="flex items-center justify-between p-2 bg-white/5 rounded border border-white/5 hover:border-white/10 group transition-colors">
        <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-white/30 w-4">{String(idx + 1).padStart(2, '0')}</span>
            <span className="text-xs font-medium text-white/80">{type}</span>
        </div>
        <div className="text-[10px] font-mono text-white/40">{params}</div>
    </div>
);

export default function SequenceCard({ steps, addStep, clearSteps, torqueEnabled, toggleTorque }) {
    return (
        <div className="glass-panel p-5 shrink-0 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium flex items-center gap-2 text-white/80">
                    <Layers size={14} className="text-purple-400" />
                    Sequence Programmer
                </h2>
                <button
                    onClick={toggleTorque}
                    className={`text-[10px] font-mono font-medium px-2 py-1 rounded border transition-all duration-200 ${torqueEnabled
                            ? 'bg-lime-500/10 border-lime-500/30 text-lime-400 hover:bg-lime-500/20'
                            : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                        }`}
                >
                    TORQUE {torqueEnabled ? 'ON' : 'OFF'}
                </button>
            </div>

            {/* List */}
            <div className="h-[140px] overflow-y-auto space-y-1 pr-1 custom-scrollbar bg-black/20 rounded-lg p-1.5 border border-white/5">
                {steps.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-white/20 gap-2">
                        <div className="w-8 h-px bg-white/10" />
                        <span className="text-[10px] uppercase tracking-wider">Empty Sequence</span>
                    </div>
                ) : (
                    steps.map((s, i) => <SequenceStep key={i} idx={i} {...s} />)
                )}
            </div>

            {/* Actions */}
            <div className="grid grid-cols-3 gap-2">
                <button onClick={addStep} className="btn-glass-subtle py-2 text-[11px] flex items-center justify-center gap-1.5 hover:bg-white/10">
                    <Save size={12} className="opacity-70" /> Rec Step
                </button>
                <button className="py-2 rounded-md bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-300 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-all">
                    <Play size={12} /> Execute
                </button>
                <button onClick={clearSteps} className="py-2 rounded-md bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 text-red-400 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-all">
                    <Trash2 size={12} /> Clear
                </button>
            </div>
        </div>
    );
}
