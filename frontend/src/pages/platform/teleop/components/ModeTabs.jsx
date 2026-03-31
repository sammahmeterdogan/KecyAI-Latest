import React from 'react';

const TABS = [
    { id: 'joints', label: 'Joints' },
    { id: 'keyboard', label: 'Keyboard' },
    { id: 'gamepad', label: 'Gamepad' },
    { id: 'camera', label: 'Camera' },
    { id: 'leader-arm', label: 'Leader Arm' },
];

export default function ModeTabs({ activeTab, onChange }) {
    return (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-1.5 backdrop-blur-xl shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
            <div className="flex flex-wrap gap-1">
                {TABS.map((tab) => {
                    const active = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => onChange(tab.id)}
                            className={[
                                'min-h-[38px] flex-1 min-w-[72px] rounded-xl border px-3 py-2 text-[11px] font-medium transition-all',
                                active
                                    ? 'border-white/20 bg-white/10 text-white shadow-[0_0_18px_rgba(255,255,255,0.08)]'
                                    : 'border-transparent bg-white/[0.02] text-white/35 hover:border-white/10 hover:bg-white/[0.04] hover:text-white/65',
                            ].join(' ')}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
