
import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import PlatformSidebar from '../../components/platform/PlatformSidebar';
import PlatformBackground from '../../components/backgrounds/PlatformBackground';

/* Routes that render full-bleed (no glass card, no padding) */
const FULL_BLEED_PREFIXES = ['/kecy/platform/teleop'];

export default function PlatformLayout() {
    const [capabilities, setCapabilities] = useState([]);
    const [capLoading, setCapLoading] = useState(true);
    const [capError, setCapError] = useState(null);
    const [version, setVersion] = useState(null);

    const location = useLocation();
    const [displayLocation, setDisplayLocation] = useState(location);
    const [transitionStage, setTransitionStage] = useState('enter');

    const isFullBleed = FULL_BLEED_PREFIXES.some(
        (prefix) => location.pathname.startsWith(prefix)
    );

    useEffect(() => {
        if (location.pathname !== displayLocation.pathname) {
            setTransitionStage('exit');
            const timer = setTimeout(() => {
                setDisplayLocation(location);
                setTransitionStage('enter');
            }, 150);
            return () => clearTimeout(timer);
        }
    }, [location, displayLocation]);

    useEffect(() => {
        const init = async () => {
            setCapLoading(true);
            try {
                // Dynamic import to avoid circular dependency if any
                const { LeRobotClient } = await import('../../lib/api/lerobotClient');

                try {
                    const capData = await LeRobotClient.getCapabilities();
                    setCapabilities(capData.capabilities || []);
                } catch (e) {
                    console.warn("Capabilities check failed (offline/500):", e.message);
                    setCapabilities([]);
                }

                try {
                    const verData = await LeRobotClient.getVersion();
                    setVersion(verData);
                } catch (e) {
                    console.warn("Version check failed:", e.message);
                }
            } catch (err) {
                console.error("Critical runtime init failure:", err);
                setCapError("Offline");
            } finally {
                setCapLoading(false);
            }
        };
        init();
    }, []);

    const animationStyle = {
        animation: transitionStage === 'enter'
            ? 'pageSlideIn 0.35s cubic-bezier(0.16,1,0.3,1) forwards'
            : 'pageSlideOut 0.15s ease-in forwards',
    };

    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'row', position: 'relative', isolation: 'isolate' }}>

            {/* Background — always z-0, pointer-events-none */}
            <PlatformBackground />

            {/* Sidebar */}
            <PlatformSidebar
                capabilities={capabilities}
                runtimeOnline={!capError}
                runtimeSha={version?.git_sha}
                appVersion="v2.1.0"
            />

            {/* Main content area */}
            <main className="flex-1 min-w-0 h-screen overflow-hidden flex flex-col relative z-10">
                {isFullBleed ? (
                    /*
                     * FULL-BLEED: Teleop gibi ağır sayfalar için.
                     * Glass card yok, padding yok, animation yok.
                     * Direkt h-full geçiş.
                     */
                    <div className="h-full w-full overflow-hidden">
                        <Outlet />
                    </div>
                ) : (
                    /* STANDARD: Glass card wrapper */
                    <div style={{
                        flex: 1,
                        display: 'flex', justifyContent: 'center',
                        padding: '40px 40px',
                        overflowY: 'auto',
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none'
                    }}>
                        <div style={{
                            background: 'rgba(10,10,10,0.50)',
                            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                            border: '1px solid rgba(240,243,243,0.12)',
                            borderRadius: 20, padding: '40px 36px',
                            maxWidth: 1200, width: '100%', alignSelf: 'flex-start',
                            boxShadow: '0 8px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)',
                            minHeight: 'min-content'
                        }}>
                            <div
                                key={displayLocation.pathname}
                                style={animationStyle}
                            >
                                <Outlet />
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <style>{`
                @keyframes pageSlideIn {
                    0%   { opacity: 0; transform: translateY(16px) scale(0.99); }
                    100% { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes pageSlideOut {
                    0%   { opacity: 1; transform: translateY(0) scale(1); }
                    100% { opacity: 0; transform: translateY(-8px) scale(0.99); }
                }
            `}</style>
        </div>
    );
}
