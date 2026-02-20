import React, { useState } from 'react';

export default function SidebarTooltip({ text, children, visible }) {
    const [hover, setHover] = useState(false);

    if (!visible) return children;

    return (
        <div
            style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
        >
            {children}
            {hover && (
                <div style={{
                    position: 'absolute',
                    left: '100%',
                    marginLeft: 12,
                    zIndex: 999,
                    background: 'rgba(10,10,12,0.95)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    padding: '6px 10px',
                    borderRadius: 6,
                    whiteSpace: 'nowrap',
                    fontSize: 12,
                    color: '#eee',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    pointerEvents: 'none',
                    animation: 'fadeIn 150ms ease-out forwards',
                }}>
                    {text}
                    {/* Tiny arrow */}
                    <div style={{
                        position: 'absolute',
                        left: -4, top: '50%', marginTop: -4,
                        width: 0, height: 0,
                        borderTop: '4px solid transparent',
                        borderBottom: '4px solid transparent',
                        borderRight: '4px solid rgba(255,255,255,0.1)',
                    }} />
                </div>
            )}
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateX(-4px); }
                    to { opacity: 1; transform: translateX(0); }
                }
            `}</style>
        </div>
    );
}
