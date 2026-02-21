import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { lerobotClient } from '../../lib/api/lerobotClient';
import ControlPanel from './teleop/components/ControlPanel';
import ViewerPanel from './teleop/components/ViewerPanel';
import ParticleField from './teleop/components/ParticleField';
import '../platform/TeleopControl.module.css'; // Ensure CSS is loaded

// Lazy-load 3D viewer
const UrdfRobotViewer = lazy(() => import('../../features/teleop3d/UrdfRobotViewer'));

const INITIAL_JOINTS = [
  { id: 'shoulder_pan', name: 'Shoulder Pan', position: 0, minLimit: -3.14, maxLimit: 3.14, status: 'ok', torque: 42 },
  { id: 'shoulder_lift', name: 'Shoulder Lift', position: 0, minLimit: -1.57, maxLimit: 1.57, status: 'ok', torque: 58 },
  { id: 'elbow_flex', name: 'Elbow Flex', position: 0, minLimit: -2.2, maxLimit: 2.2, status: 'ok', torque: 31 },
  { id: 'wrist_flex', name: 'Wrist Pitch', position: 0, minLimit: -3.14, maxLimit: 3.14, status: 'ok', torque: 19 },
  { id: 'wrist_roll', name: 'Wrist Roll', position: 0, minLimit: -3.14, maxLimit: 3.14, status: 'ok', torque: 14 },
  { id: 'gripper', name: 'Gripper', position: 0, minLimit: 0, maxLimit: 1, status: 'ok', torque: 8 },
];

export default function TeleopPage() {
  /* ── State ── */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [connectionState, setConnectionState] = useState('offline');
  const [sensitivity, setSensitivity] = useState('medium');
  const [joints, setJoints] = useState(INITIAL_JOINTS);
  const [telemetry, setTelemetry] = useState({ fps: 0, latency: 0, voltage: 11.8, temperature: 42, uptime: 0 });
  const [logs, setLogs] = useState([]);
  const [teleopState, setTeleopState] = useState('idle');
  const [dryRun, setDryRun] = useState(false);
  const [commandError, setCommandError] = useState('');
  const [estopActive, setEstopActive] = useState(false);
  const [portScan, setPortScan] = useState(null);
  const [portScanLoading, setPortScanLoading] = useState(false);

  const jointTimersRef = useRef({});
  const startTimeRef = useRef(Date.now());
  const viewerPanelRef = useRef(null);
  const sseRef = useRef(null);
  const draggingRef = useRef(new Set());

  const isConnected = connectionState === 'online' && teleopState === 'running';

  /* ── Runtime polling ── */
  const updateRuntimeState = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const [health, status, logPayload] = await Promise.all([
        lerobotClient.getHealth(),
        lerobotClient.teleopStatus(),
        lerobotClient.teleopLogs(150),
      ]);

      const runtimeOnline = health?.status === 'ok';
      setConnectionState(runtimeOnline ? 'online' : 'offline');
      setTeleopState(status?.state ?? 'idle');
      setDryRun(!!status?.metadata?.dry_run || !!status?.dry_run);
      setLogs(Array.isArray(logPayload?.logs) ? logPayload.logs : []);
      setTelemetry((prev) => ({
        ...prev,
        latency: Math.max(0, Math.round(performance.now() - startedAt)),
        fps: Number(status?.metadata?.fps ?? prev.fps),
        voltage: Number(status?.metadata?.voltage ?? prev.voltage),
        uptime: Math.floor((Date.now() - startTimeRef.current) / 1000),
      }));
      setEstopActive(!!status?.metadata?.estop);
    } catch {
      setConnectionState('offline');
      setTeleopState('error');
    }
  }, []);

  const handleScanPorts = useCallback(async () => {
    setPortScanLoading(true);
    try {
      const result = await lerobotClient.adminScanMotorPorts();
      setPortScan(result);
    } catch (error) {
      const message = error?.body?.message || error?.message || 'Failed to scan ports';
      setPortScan({
        status: 'error',
        ports: [],
        source: 'backend',
        message,
        stdout: [],
        stderr: [],
        exit_code: null,
      });
    } finally {
      setPortScanLoading(false);
    }
  }, []);

  useEffect(() => {
    updateRuntimeState();
    handleScanPorts();
    const interval = setInterval(updateRuntimeState, 3000);
    return () => {
      clearInterval(interval);
      Object.keys(jointTimersRef.current).forEach((id) => clearTimeout(jointTimersRef.current[id]));
    };
  }, [updateRuntimeState, handleScanPorts]);

  /* ── SSE Telemetry ── */
  useEffect(() => {
    if (teleopState !== 'running' || connectionState !== 'online') {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      return;
    }

    const es = lerobotClient.connectTelemetryStream(
      (data) => {
        setTelemetry((prev) => ({
          ...prev,
          fps: data.fps ?? prev.fps,
          latency: data.latency_ms ?? prev.latency,
          uptime: Math.floor((Date.now() - startTimeRef.current) / 1000),
        }));
        setDryRun(!!data.dry_run);
        if (data.estop !== undefined) setEstopActive(!!data.estop);

        if (Array.isArray(data.joints)) {
          setJoints((prev) =>
            prev.map((j) => {
              if (draggingRef.current.has(j.id)) return j;
              const incoming = data.joints.find((rj) => rj.id === j.id);
              if (!incoming) return j;
              const pos = incoming.position;
              const range = j.maxLimit - j.minLimit;
              const pct = (pos - j.minLimit) / range;
              let status = 'ok';
              if (pct < 0.05 || pct > 0.95) status = 'limit';
              if (pct <= 0.01 || pct >= 0.99) status = 'overload';
              return { ...j, position: pos, status };
            })
          );
        }
      },
      () => { /* Auto-reconnect managed by browser/client */ }
    );
    sseRef.current = es;

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [teleopState, connectionState]);

  /* ── Handlers ── */
  const handleStart = async () => {
    if (connectionState === 'connecting') return;
    setConnectionState('connecting');
    setCommandError('');
    try {
      const result = await lerobotClient.teleopStart({ robot_type: 'so101_follower', teleop_type: 'web' });
      setDryRun(!!result?.dry_run);
      await updateRuntimeState();
    } catch (error) {
      const status = error?.status;
      if (status === 409) {
        const body = error?.body;
        setCommandError(`CONFLICT: ${body?.message || 'Already running with different config'}`);
        setConnectionState('online');
        setTeleopState('running');
      } else {
        setCommandError(error instanceof Error ? error.message : 'Teleop start failed');
        setConnectionState('offline');
      }
    }
  };

  const handleStop = async () => {
    pendingCommandsRef.current = {};
    try {
      await lerobotClient.teleopStop();
      setJoints(INITIAL_JOINTS);
      setTelemetry(prev => ({ ...prev, fps: 0, latency: 0 }));
      setCommandError('');
      await updateRuntimeState();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Teleop stop failed');
    }
  };

  /* ── Command Throttling ── */
  const pendingCommandsRef = useRef({});

  // Flush pending commands at 30Hz (approx 33ms)
  useEffect(() => {
    if (!isConnected) return;

    const flushInterval = setInterval(async () => {
      const pendingIds = Object.keys(pendingCommandsRef.current);
      if (pendingIds.length === 0) return;

      // Snapshot current pending commands
      const batch = pendingIds.map(id => ({
        id,
        position: pendingCommandsRef.current[id]
      }));

      // Clear pending immediately to catch new updates during await
      pendingCommandsRef.current = {};

      try {
        await lerobotClient.sendCommand({ joints: batch });
        setCommandError('');
      } catch (error) {
        // E-STOP 409: immediately sync estop state so UI updates before SSE catches up
        if (error?.status === 409) {
          const body = error?.body;
          if (body?.code === 'PRECONDITION_FAILED' && /E-STOP/i.test(body?.message ?? '')) {
            setEstopActive(true);
            setCommandError(body.message);
          }
        }
        // Other errors are silently dropped during rapid movement (transient)
        console.warn("Command flush failed", error);
      }
    }, 33);

    return () => clearInterval(flushInterval);
  }, [isConnected]);

  const handleJointUpdate = (jointId, value) => {
    // 1. Lock SSE updates for this joint
    draggingRef.current.add(jointId);

    // 2. Optimistic UI update
    setJoints((prev) =>
      prev.map((j) => {
        if (j.id !== jointId) return j;
        // Recalculate status locally if needed
        const range = j.maxLimit - j.minLimit;
        const pct = (value - j.minLimit) / range;
        let status = 'ok';
        if (pct < 0.05 || pct > 0.95) status = 'limit';
        if (pct <= 0.01 || pct >= 0.99) status = 'overload';
        return { ...j, position: value, status };
      })
    );

    // 3. Queue for batch sending
    pendingCommandsRef.current[jointId] = value;

    // 4. Extend drag lock
    if (jointTimersRef.current[jointId]) clearTimeout(jointTimersRef.current[jointId]);
    jointTimersRef.current[jointId] = setTimeout(() => {
      draggingRef.current.delete(jointId);
    }, 500); // 500ms release delay after stop dragging
  };

  const handleEStop = async () => {
    try {
      if (estopActive) {
        await lerobotClient.estopOff();
        setEstopActive(false);
      } else {
        await lerobotClient.estopOn();
        setEstopActive(true);
      }
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'E-STOP failed');
    }
  };

  const handleReset = async () => {
    try {
      await lerobotClient.poseHome();
      setJoints(INITIAL_JOINTS);
      await updateRuntimeState();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Reset failed');
    }
  };

  const handleSnapshot = () => {
    const canvas = viewerPanelRef.current?.querySelector('canvas');
    if (canvas) {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `teleop-snapshot-${Date.now()}.png`;
      a.click();
    }
  };

  const handleFullscreen = async () => {
    if (!viewerPanelRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await viewerPanelRef.current.requestFullscreen();
    }
  };

  /* ── RENDER ── */
  return (
    <div
      className="h-full bg-black text-white overflow-hidden relative"
      style={{
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace",
        display: 'grid',
        gridTemplateColumns: '400px 1fr',
      }}
    >
      <ParticleField />

      {/* Background Ambience */}
      <div className="absolute inset-0 cyber-grid opacity-30 pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,black_100%)] pointer-events-none opacity-60" />

      {/* ── Left Column: Controls ── */}
      <div className="relative z-20 h-full overflow-hidden">
        <ControlPanel
          connectionState={connectionState}
          telemetry={telemetry}
          dryRun={dryRun}
          isConnected={isConnected}
          joints={joints}
          sensitivity={sensitivity}
          setSensitivity={setSensitivity}
          onJointUpdate={handleJointUpdate}
          onEStop={handleEStop}
          onReset={handleReset}
          logs={logs}
          onClearLogs={() => setLogs([])}
          onConnect={handleStart}
          onDisconnect={handleStop}
          teleopState={teleopState}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          commandError={commandError}
          onDismissError={() => setCommandError('')}
          estopActive={estopActive}
          portScan={portScan}
          portScanLoading={portScanLoading}
          onScanPorts={handleScanPorts}
        />
      </div>

      {/* ── Right Column: 3D Viewport ── */}
      <div className="relative z-10 h-full min-h-0">
        <ViewerPanel
          telemetry={telemetry}
          isConnected={isConnected}
          dryRun={dryRun}
          onFullscreen={handleFullscreen}
          onSnapshot={handleSnapshot}
          viewerRef={viewerPanelRef}
        >
          <Suspense fallback={null}>
            <UrdfRobotViewer joints={joints} />
          </Suspense>
        </ViewerPanel>
      </div>

      {/* Mobile Stack Override */}
      <style>{`
        @media (max-width: 1100px) {
            div[style*="gridTemplateColumns"] {
                grid-template-columns: 1fr !important;
                grid-template-rows: 60vh 1fr; 
            }
        }
      `}</style>
    </div>
  );
}
