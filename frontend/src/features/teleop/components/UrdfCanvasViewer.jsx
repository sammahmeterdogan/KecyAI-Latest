import React, { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei';
import { LoadingManager } from 'three';
import URDFLoader from 'urdf-loader';

function mapUrdfAssetPath(url) {
    if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('/')) {
        return url;
    }
    if (url.startsWith('package://')) {
        const parts = url.replace('package://', '').split('/');
        parts.shift();
        return `/urdf/${parts.join('/')}`;
    }
    if (url.startsWith('./')) {
        return `/urdf/${url.slice(2)}`;
    }
    return `/urdf/${url}`;
}

function RobotModel({ joints, onLoaded, onError, urdfUrl }) {
    const manager = useMemo(() => {
        const instance = new LoadingManager();
        instance.setURLModifier((url) => mapUrdfAssetPath(url));
        return instance;
    }, []);

    const robot = useLoader(URDFLoader, urdfUrl, (loader) => {
        loader.manager = manager;
    });

    useEffect(() => {
        if (!robot) return;

        try {
            robot.traverse((child) => {
                if (!child.isMesh || !child.material) return;
                child.material = child.material.clone();
                child.material.color.set('#ced2d5');
                child.material.roughness = 0.55;
                child.material.metalness = 0.25;
                child.castShadow = true;
                child.receiveShadow = true;
            });
            onLoaded(true);
        } catch (error) {
            onError(error instanceof Error ? error.message : 'Model processing failed');
        }
    }, [onError, onLoaded, robot]);

    useFrame(() => {
        if (!robot?.joints) return;

        Object.entries(joints).forEach(([jointId, value]) => {
            const joint = robot.joints[jointId];
            if (!joint || Number.isNaN(value)) return;
            try {
                joint.setJointValue(value);
            } catch {
                // Silently skip invalid values to avoid animation loop crash.
            }
        });
    });

    return <primitive object={robot} rotation={[-Math.PI / 2, 0, 0]} />;
}

export default function UrdfCanvasViewer({ joints, onError, onLoaded, urdfUrl }) {
    return (
        <div className="h-full w-full overflow-hidden rounded-xl bg-black">
            <Canvas
                camera={{ position: [0.95, 0.8, 0.9], fov: 42 }}
                shadows
                onCreated={({ gl }) => {
                    gl.setClearColor('#020304');
                }}
                onError={(error) => onError(error instanceof Error ? error.message : 'Viewer error')}
            >
                <ambientLight intensity={0.7} />
                <directionalLight
                    castShadow
                    intensity={1.35}
                    position={[3.2, 4.2, 2]}
                    shadow-mapSize-height={2048}
                    shadow-mapSize-width={2048}
                />
                <pointLight intensity={0.35} position={[-1.5, 2, -1.4]} color="#8ec5ff" />
                <Grid
                    infiniteGrid
                    cellColor="#1f2630"
                    cellSize={0.06}
                    fadeDistance={5}
                    fadeStrength={1}
                    sectionColor="#2f3945"
                    sectionSize={0.6}
                    position={[0, -0.001, 0]}
                />
                <ContactShadows blur={2.2} far={2.2} opacity={0.5} resolution={512} scale={10} />
                <OrbitControls
                    enablePan
                    makeDefault
                    maxPolarAngle={Math.PI / 1.9}
                    minDistance={0.4}
                    minPolarAngle={0}
                    target={[0, 0.17, 0]}
                />
                <Suspense fallback={null}>
                    <RobotModel joints={joints} onError={onError} onLoaded={onLoaded} urdfUrl={urdfUrl} />
                </Suspense>
            </Canvas>
        </div>
    );
}
