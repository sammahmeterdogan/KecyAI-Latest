/*
  GlassIcons (Custom implementation inspired by React Bits aesthetics)
*/
import React from 'react';
import { Box, Server, Database } from 'lucide-react';

const GlassIcons = () => {
    const icons = [
        { icon: Box, label: 'Runtime' },
        { icon: Server, label: 'Service' },
        { icon: Database, label: 'Data' },
    ];

    return (
        <div style={{ display: 'flex', gap: 12 }}>
            {icons.map((item, index) => (
                <div key={index} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, height: 32,
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(4px)',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                    color: '#a0a0a0',
                    fontSize: 14 // Lucide size 
                }} title={item.label}>
                    <item.icon size={16} strokeWidth={1.5} />
                </div>
            ))}
        </div>
    );
};

export default GlassIcons;
