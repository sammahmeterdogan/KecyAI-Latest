import React, { useMemo } from 'react';
import Grainient from './Grainient';

const PlatformBackground = () => {
    // Check for reduced motion preference
    const prefersReducedMotion = useMemo(() => {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }, []);

    // Configuration
    const config = {
        color1: "#211c21",
        color2: "#727274",
        color3: "#d6d3de",
        timeSpeed: prefersReducedMotion ? 0 : 0.25,
        colorBalance: 0,
        uWarpStrength: 1,
        uWarpFrequency: 5,
        uWarpSpeed: prefersReducedMotion ? 0 : 2,
        uWarpAmplitude: 50,
        blendAngle: 0,
        blendSoftness: 0.05,
        rotationAmount: 500,
        uNoiseScale: 2,
        uGrainAmount: 0.1,
        uGrainScale: 2,
        uGrainAnimated: !prefersReducedMotion,
        uContrast: 1.5,
        uGamma: 1,
        uSaturation: 1,
        centerX: 0,
        centerY: 0,
        zoom: 0.9,
    };

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 0,
            pointerEvents: 'none',
            background: '#09090b', // Fallback color
        }}>
            <Grainient {...config} />

            {/* Dark Overlay for readability */}
            <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(9,9,11,0.65)',
                mixBlendMode: 'multiply',
                zIndex: 1,
            }} />

            {/* Vignette */}
            <div style={{
                position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
                background: `
                  radial-gradient(ellipse at center, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.6) 100%),
                  linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 100%)
                `,
                zIndex: 2,
            }} />
        </div>
    );
};

export default PlatformBackground;
