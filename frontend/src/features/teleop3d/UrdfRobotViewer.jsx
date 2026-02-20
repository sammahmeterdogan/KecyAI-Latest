import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, ContactShadows } from '@react-three/drei';
import URDFLoader from 'urdf-loader';
import { LoadingManager, Color } from 'three';
import { URDF_JOINT_MAP } from './teleopControls';

const URDF_PATH = '/urdf/so_arm101.urdf';

/**
 * Rewrites mesh asset URLs from URDF's package:// or relative paths
 * to Vite public directory paths.
 */
function mapUrdfAssetPath(url) {
    if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('/')) {
        return url;
    }
    if (url.startsWith('package://')) {
        const parts = url.replace('package://', '').split('/');
        parts.shift(); // Remove package name
        return `/urdf/${parts.join('/')}`;
    }
    if (url.startsWith('./')) {
        return `/urdf/${url.slice(2)}`;
    }
    return `/urdf/${url}`;
}

/**
 * Inner robot model rendered inside Canvas.
 * Accepts joints as an array of { id, position } (radians).
 */
const RobotModel = ({ joints, onLoaded, onError }) => {
    const groupRef = useRef();
    const hasLoggedRef = useRef(false);

    const manager = useMemo(() => {
        const m = new LoadingManager();
        m.setURLModifier(mapUrdfAssetPath);
        return m;
    }, []);

    const robot = useLoader(URDFLoader, URDF_PATH, (loader) => {
        loader.manager = manager;
    });

    // Material setup + debug log
    useEffect(() => {
        if (!robot) return;

        try {
            // Debug: log discovered joints once
            if (!hasLoggedRef.current && robot.joints) {
                hasLoggedRef.current = true;
                console.log('[URDF] Discovered joints:', Object.keys(robot.joints));
            }

            // Clone so cached loader data isn't mutated
            const clone = robot.clone(true);
            clone.traverse((child) => {
                if (!child.isMesh || !child.material) return;
                child.material = child.material.clone();
                child.material.color = new Color('#b0b8c4');
                child.material.roughness = 0.45;
                child.material.metalness = 0.35;
                child.castShadow = true;
                child.receiveShadow = true;
            });

            if (groupRef.current) {
                groupRef.current.clear();
                groupRef.current.add(clone);
            }

            onLoaded?.();
        } catch (e) {
            console.error('[URDF] Error processing model:', e);
            onError?.(e);
        }
    }, [robot, onLoaded, onError]);

    // Per-frame joint update
    useFrame(() => {
        if (!groupRef.current) return;
        const model = groupRef.current.children[0];
        if (!model?.joints) return;

        // joints is an array of { id, position (radians) }
        if (!Array.isArray(joints)) return;

        for (const j of joints) {
            const urdfName = URDF_JOINT_MAP[j.id];
            if (!urdfName) continue;

            const urdfJoint = model.joints[urdfName];
            if (!urdfJoint) continue;

            const val = j.position;
            if (typeof val !== 'number' || Number.isNaN(val)) continue;

            try {
                urdfJoint.setJointValue(val);
            } catch {
                // Silently skip – avoids render-loop crashes
            }
        }
    });

    return <group ref={groupRef} rotation={[-Math.PI / 2, 0, 0]} />;
};

/**
 * Loading skeleton shown while URDF is loading.
 */
const LoadingSkeleton = () => (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 pointer-events-none">
        <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        <span className="text-[11px] font-mono text-white/30 tracking-wider">LOADING URDF...</span>
    </div>
);

/**
 * Error panel overlay.
 */
const ErrorPanel = ({ message, onRetry }) => (
    <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/80 backdrop-blur-sm">
        <div className="text-center max-w-xs">
            <h3 className="text-sm font-bold text-red-400 mb-2">3D View Error</h3>
            <p className="text-[11px] font-mono text-white/40 mb-4">{message || 'Unknown error'}</p>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg text-xs font-bold text-white/60 transition-all cursor-pointer"
                >
                    RETRY
                </button>
            )}
        </div>
    </div>
);

/**
 * ErrorBoundary for Canvas internals (class component required by React).
 */
class CanvasErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    componentDidCatch(error, info) {
        console.error('[URDF] Canvas error:', error, info);
        this.props.onError?.(error);
    }
    render() {
        if (this.state.hasError) return null;
        return this.props.children;
    }
}

/**
 * Public component.
 *
 * Props:
 *   joints  – Array<{ id: string, position: number }> (positions in radians)
 *   onReady – optional callback when model is loaded
 */
const UrdfRobotViewer = ({ joints, onReady }) => {
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const containerRef = useRef(null);
    const [hasSize, setHasSize] = useState(false);

    useEffect(() => {
        if (!containerRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
                    setHasSize(true);
                }
            }
        });

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const handleLoaded = () => {
        setLoading(false);
        onReady?.();
    };

    const handleError = (err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
    };

    const handleRetry = () => {
        setError(null);
        setLoading(true);
    };

    return (
        <div ref={containerRef} className="relative w-full h-full overflow-hidden" style={{ minHeight: 0 }}>
            {/* Loading overlay */}
            {loading && !error && <LoadingSkeleton />}

            {/* Error overlay */}
            {error && <ErrorPanel message={error.message} onRetry={handleRetry} />}

            {/* Three.js Canvas - Only render if container has size */}
            {hasSize && (
                <Canvas
                    shadows
                    camera={{ position: [0.8, 0.7, 0.8], fov: 42 }}
                    style={{ width: '100%', height: '100%' }}
                    onCreated={({ gl }) => {
                        gl.setClearColor('#060608');
                    }}
                >
                    <color attach="background" args={['#060608']} />

                    {/* Lighting */}
                    <ambientLight intensity={0.55} />
                    <directionalLight
                        castShadow
                        intensity={1.4}
                        position={[3, 5, 2]}
                        shadow-mapSize-width={2048}
                        shadow-mapSize-height={2048}
                    />
                    <pointLight position={[-2, 3, -1.5]} intensity={0.3} color="#6ea8ff" />

                    {/* Ground grid */}
                    <Grid
                        infiniteGrid
                        cellSize={0.06}
                        sectionSize={0.6}
                        fadeDistance={4}
                        fadeStrength={1.2}
                        cellColor="#181c24"
                        sectionColor="#282e3a"
                        position={[0, -0.001, 0]}
                    />
                    <ContactShadows opacity={0.45} scale={10} blur={2.2} far={2} resolution={512} />

                    {/* Orbit controls */}
                    <OrbitControls
                        makeDefault
                        enablePan
                        minDistance={0.35}
                        minPolarAngle={0}
                        maxPolarAngle={Math.PI / 1.85}
                        target={[0, 0.16, 0]}
                    />

                    {/* Robot model with suspense */}
                    <Suspense fallback={null}>
                        <CanvasErrorBoundary onError={handleError}>
                            <RobotModel
                                joints={joints}
                                onLoaded={handleLoaded}
                                onError={handleError}
                            />
                        </CanvasErrorBoundary>
                    </Suspense>
                </Canvas>
            )}
        </div>
    );
};

export default UrdfRobotViewer;
