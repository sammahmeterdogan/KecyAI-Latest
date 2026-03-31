import { useState, useEffect, useMemo } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import PlatformSidebar from '../../components/platform/PlatformSidebar';
import PlatformBackground from '../../components/backgrounds/PlatformBackground';
import {
    isTauriRuntime,
    readCachedDesktopServiceSnapshot,
    subscribeDesktopServiceSnapshot,
    syncDesktopServiceSnapshot,
} from '../../lib/desktopService';

function resolveShellFrame(pathname) {
    if (pathname.startsWith('/kecy/platform/teleop')) {
        return {
            outerPadding: '30px 34px',
            innerPadding: '24px 24px',
            maxWidth: 1460,
            borderRadius: 24,
        };
    }

    return {
        outerPadding: '40px 40px',
        innerPadding: '40px 36px',
        maxWidth: 1200,
        borderRadius: 20,
    };
}

export default function PlatformLayout() {
    const [capabilities, setCapabilities] = useState([]);
    const [capLoading, setCapLoading] = useState(true);
    const [capError, setCapError] = useState(null);
    const [version, setVersion] = useState(null);
    const [desktopService, setDesktopService] = useState(readCachedDesktopServiceSnapshot);

    const location = useLocation();
    const [displayLocation, setDisplayLocation] = useState(location);
    const [transitionStage, setTransitionStage] = useState('enter');
    const shellFrame = useMemo(
        () => resolveShellFrame(displayLocation.pathname),
        [displayLocation.pathname],
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
        if (!isTauriRuntime()) return undefined;
        let cancelled = false;

        const refreshStatus = async () => {
            try {
                const next = await syncDesktopServiceSnapshot();
                if (!cancelled) {
                    setDesktopService(next);
                }
            } catch {
                if (!cancelled) {
                    setDesktopService((prev) => ({
                        ...prev,
                        state: 'ERROR',
                        healthy: false,
                        message: 'Failed to read desktop service state.',
                    }));
                }
            }
        };

        refreshStatus();
        const timer = setInterval(refreshStatus, 2500);
        const unsubscribe = subscribeDesktopServiceSnapshot((next) => {
            if (!cancelled) {
                setDesktopService(next);
            }
        });
        return () => {
            cancelled = true;
            clearInterval(timer);
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (isTauriRuntime() && !['READY', 'WORKING'].includes(desktopService.state)) {
            setCapabilities([]);
            setVersion(null);
            setCapError(null);
            setCapLoading(false);
            return;
        }

        const init = async () => {
            setCapLoading(true);
            setCapError(null);
            try {
                const { LeRobotClient } = await import('../../lib/api/lerobotClient');

                try {
                    const capData = await LeRobotClient.getCapabilities();
                    setCapabilities(capData.capabilities || []);
                } catch (e) {
                    console.warn('Capabilities check failed (offline/500):', e.message);
                    setCapabilities([]);
                }

                try {
                    const verData = await LeRobotClient.getVersion();
                    setVersion(verData);
                } catch (e) {
                    console.warn('Version check failed:', e.message);
                }
            } catch (err) {
                console.error('Critical runtime init failure:', err);
                setCapError('Offline');
            } finally {
                setCapLoading(false);
            }
        };
        init();
    }, [desktopService.serviceUrl, desktopService.state]);

    const animationStyle = {
        animation: transitionStage === 'enter'
            ? 'pageSlideIn 0.35s cubic-bezier(0.16,1,0.3,1) forwards'
            : 'pageSlideOut 0.15s ease-in forwards',
    };

    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'row', position: 'relative', isolation: 'isolate' }}>
            <PlatformBackground />

            <PlatformSidebar
                capabilities={capabilities}
                runtimeOnline={isTauriRuntime() ? ['READY', 'WORKING'].includes(desktopService.state) : !capError}
                runtimeSha={version?.git_sha}
                appVersion="v2.1.0"
            />

            <main className="relative z-10 flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
                <div
                    style={{
                        flex: 1,
                        display: 'flex',
                        justifyContent: 'center',
                        padding: shellFrame.outerPadding,
                        overflowY: 'auto',
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                    }}
                >
                    <div
                        style={{
                            background: 'rgba(10,10,10,0.50)',
                            backdropFilter: 'blur(20px)',
                            WebkitBackdropFilter: 'blur(20px)',
                            border: '1px solid rgba(240,243,243,0.12)',
                            borderRadius: shellFrame.borderRadius,
                            padding: shellFrame.innerPadding,
                            maxWidth: shellFrame.maxWidth,
                            width: '100%',
                            alignSelf: 'flex-start',
                            boxShadow: '0 8px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)',
                            minHeight: 'min-content',
                        }}
                    >
                        <div key={displayLocation.pathname} style={animationStyle}>
                            <Outlet />
                        </div>
                    </div>
                </div>
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
