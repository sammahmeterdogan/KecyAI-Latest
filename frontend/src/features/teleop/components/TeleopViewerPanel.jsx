import React, { useRef, useState } from 'react';
import { Camera, Maximize2 } from 'lucide-react';
import UrdfCanvasViewer from './UrdfCanvasViewer';

const DEFAULT_URDF = '/urdf/so_arm101.urdf';

export default function TeleopViewerPanel({ joints, onLoaded }) {
    const panelRef = useRef(null);
    const fileInputRef = useRef(null);
    const [urdfUrl, setUrdfUrl] = useState(DEFAULT_URDF);
    const [viewerError, setViewerError] = useState('');

    const handleFullscreen = async () => {
        if (!panelRef.current) return;
        if (document.fullscreenElement) {
            await document.exitFullscreen();
            return;
        }
        await panelRef.current.requestFullscreen();
    };

    const handleSnapshot = () => {
        if (!panelRef.current) return;
        const canvas = panelRef.current.querySelector('canvas');
        if (!canvas) return;

        const anchor = document.createElement('a');
        anchor.href = canvas.toDataURL('image/png');
        anchor.download = `teleop-snapshot-${Date.now()}.png`;
        anchor.click();
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileImport = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.urdf')) {
            setViewerError('Only .urdf files can be imported.');
            return;
        }
        setViewerError('');
        setUrdfUrl(URL.createObjectURL(file));
    };

    return (
        <section ref={panelRef} className="relative min-w-0 flex-1 bg-[#050608]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,68,92,0.12),transparent_55%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:30px_30px] opacity-[0.16]" />
            <div className="relative z-10 h-full p-4">
                <div className="h-full rounded-xl border border-white/10 bg-black/25">
                    <UrdfCanvasViewer
                        joints={joints}
                        onError={setViewerError}
                        onLoaded={onLoaded}
                        urdfUrl={urdfUrl}
                    />
                </div>
                <div className="absolute right-7 top-7 z-20 flex gap-2">
                    <button
                        type="button"
                        onClick={handleFullscreen}
                        className="rounded-md border border-white/20 bg-black/60 p-2 text-white/70 transition hover:text-white"
                    >
                        <Maximize2 size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={handleSnapshot}
                        className="rounded-md border border-white/20 bg-black/60 p-2 text-white/70 transition hover:text-white"
                    >
                        <Camera size={16} />
                    </button>
                </div>
                {viewerError && (
                    <div className="absolute inset-x-6 top-1/2 z-20 -translate-y-1/2 rounded-md border border-white/20 bg-black/75 p-5 text-center">
                        <p className="text-[15px] text-white/70">URDF not loaded</p>
                        <p className="mt-1 text-[12px] text-white/45">{viewerError}</p>
                        <button
                            type="button"
                            onClick={handleImportClick}
                            className="mt-3 rounded-md border border-white/20 bg-white/10 px-4 py-2 text-[12px] text-white/80 transition hover:bg-white/20"
                        >
                            Import URDF
                        </button>
                    </div>
                )}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".urdf"
                    className="hidden"
                    onChange={handleFileImport}
                />
            </div>
        </section>
    );
}
