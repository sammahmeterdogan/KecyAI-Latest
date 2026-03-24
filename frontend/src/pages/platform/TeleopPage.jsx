import React, { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { lerobotClient } from '../../lib/api/lerobotClient';
import ControlPanel from './teleop/components/ControlPanel';
import ViewerPanel from './teleop/components/ViewerPanel';
import ParticleField from './teleop/components/ParticleField';
import '../platform/TeleopControl.module.css';

const UrdfRobotViewer = lazy(() => import('../../features/teleop3d/UrdfRobotViewer'));

const ACTIVE_TAB_STORAGE_KEY = 'kecyai.teleop.active-tab';
const TELEOP_TABS = ['joints', 'keyboard', 'gamepad', 'camera', 'leader-arm'];
const JOINT_ORDER = [
  { id: 'shoulder_pan', name: 'Shoulder Pan', servoId: 1, minLimit: -3.14, maxLimit: 3.14, torque: 42 },
  { id: 'shoulder_lift', name: 'Shoulder Lift', servoId: 2, minLimit: -1.57, maxLimit: 1.57, torque: 58 },
  { id: 'elbow_flex', name: 'Elbow Flex', servoId: 3, minLimit: -2.2, maxLimit: 2.2, torque: 31 },
  { id: 'wrist_flex', name: 'Wrist Pitch', servoId: 4, minLimit: -3.14, maxLimit: 3.14, torque: 19 },
  { id: 'wrist_roll', name: 'Wrist Roll', servoId: 5, minLimit: -3.14, maxLimit: 3.14, torque: 14 },
  { id: 'gripper', name: 'Gripper', servoId: 6, minLimit: 0, maxLimit: 1, torque: 8 },
];
const INITIAL_JOINTS = JOINT_ORDER.map((joint) => ({
  ...joint,
  position: 0,
  status: 'ok',
}));

const KEYBOARD_MOVEMENT_MAP = {
  f: { x: 0, y: 0, z: 1, rz: 0, rx: 0, ry: 0 },
  v: { x: 0, y: 0, z: -1, rz: 0, rx: 0, ry: 0 },
  ArrowUp: { x: 1, y: 0, z: 0, rz: 0, rx: 0, ry: 0 },
  ArrowDown: { x: -1, y: 0, z: 0, rz: 0, rx: 0, ry: 0 },
  ArrowRight: { x: 0, y: 0, z: 0, rz: -3.14, rx: 0, ry: 0 },
  ArrowLeft: { x: 0, y: 0, z: 0, rz: 3.14, rx: 0, ry: 0 },
  d: { x: 0, y: 0, z: 0, rz: 0, rx: 3.14, ry: 0 },
  g: { x: 0, y: 0, z: 0, rz: 0, rx: -3.14, ry: 0 },
  b: { x: 0, y: 0, z: 0, rz: 0, rx: 0, ry: 3.14 },
  c: { x: 0, y: 0, z: 0, rz: 0, rx: 0, ry: -3.14 },
  ' ': { x: 0, y: 0, z: 0, rz: 0, rx: 0, ry: 0 },
};
const KEYBOARD_KEYS = new Set(Object.keys(KEYBOARD_MOVEMENT_MAP));
const FULL_TRANSITION_MS = 500;
const LOOP_INTERVAL = 10;
const INSTRUCTIONS_PER_SECOND = 30;
const DEBOUNCE_INTERVAL = 1000 / INSTRUCTIONS_PER_SECOND;

function normalizeKeyboardKey(key) {
  if (key === ' ') return ' ';
  if (key?.startsWith?.('Arrow')) return key;
  return typeof key === 'string' ? key.toLowerCase() : '';
}

function calculateJointStatus(joint, value) {
  const range = joint.maxLimit - joint.minLimit;
  const pct = range === 0 ? 0 : (value - joint.minLimit) / range;
  if (pct <= 0.01 || pct >= 0.99) return 'overload';
  if (pct < 0.05 || pct > 0.95) return 'limit';
  return 'ok';
}

function getInitialModeTab() {
  if (typeof window === 'undefined') return 'joints';
  const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
  return TELEOP_TABS.includes(stored) ? stored : 'joints';
}

function formatLog(message) {
  const now = new Date();
  return `[${now.toLocaleTimeString()}] ${message}`;
}

export default function TeleopPage() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [connectionState, setConnectionState] = useState('offline');
  const [sensitivity, setSensitivity] = useState('medium');
  const [joints, setJoints] = useState(INITIAL_JOINTS);
  const [telemetry, setTelemetry] = useState({ fps: 0, latency: 0, voltage: 11.8, temperature: 42, uptime: 0 });
  const [logs, setLogs] = useState([]);
  const [commandError, setCommandError] = useState('');
  const [estopActive, setEstopActive] = useState(false);
  const [portScan, setPortScan] = useState(null);
  const [portScanLoading, setPortScanLoading] = useState(false);
  const [activeModeTab, setActiveModeTab] = useState(getInitialModeTab);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [keyboardSpeed, setKeyboardSpeed] = useState(0.8);
  const [activeKeyboardKeys, setActiveKeyboardKeys] = useState([]);
  const [robots, setRobots] = useState([]);
  const [selectedRobotId, setSelectedRobotId] = useState(0);
  const [sessionActive, setSessionActive] = useState(false);

  const jointTimersRef = useRef({});
  const startTimeRef = useRef(Date.now());
  const viewerPanelRef = useRef(null);
  const draggingRef = useRef(new Set());
  const jointsRef = useRef(INITIAL_JOINTS);
  const pendingJointWritesRef = useRef({});
  const keyboardKeysRef = useRef(new Set());
  const keyboardLoopRef = useRef(null);
  const lastKeyboardExecutionRef = useRef(0);
  const openStateRef = useRef(1);

  const isConnected = connectionState === 'online' && sessionActive;

  useEffect(() => {
    jointsRef.current = joints;
  }, [joints]);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeModeTab);
  }, [activeModeTab]);

  useEffect(() => {
    if (robots.length === 0) {
      setSelectedRobotId(0);
      return;
    }
    if (selectedRobotId > robots.length - 1) {
      setSelectedRobotId(0);
    }
  }, [robots, selectedRobotId]);

  const appendLog = useCallback((message) => {
    setLogs((prev) => [formatLog(message), ...prev].slice(0, 200));
  }, []);

  const syncSelectedRobotJoints = useCallback(async () => {
    if (!isConnected) return;

    const response = await lerobotClient.readJoints({
      robotId: selectedRobotId,
      unit: 'rad',
      joints_ids: JOINT_ORDER.map((joint) => joint.servoId),
      source: 'robot',
    });

    setJoints((prev) =>
      prev.map((joint, index) => {
        if (draggingRef.current.has(joint.id)) return joint;
        const nextPosition = response.angles[index];
        if (typeof nextPosition !== 'number') return joint;
        if (joint.id === 'gripper') {
          openStateRef.current = nextPosition;
        }
        return {
          ...joint,
          position: nextPosition,
          status: calculateJointStatus(joint, nextPosition),
        };
      }),
    );
  }, [isConnected, selectedRobotId]);

  const updateRuntimeState = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const status = await lerobotClient.getServerStatus();
      const robotStatuses = Array.isArray(status.robot_status) ? status.robot_status : [];
      const firstTemperature = robotStatuses
        .flatMap((robot) => robot.temperature ?? [])
        .find((temp) => typeof temp?.current === 'number');

      setConnectionState(status.status === 'ok' ? 'online' : 'offline');
      setRobots(robotStatuses);
      setTelemetry((prev) => ({
        ...prev,
        fps: 0,
        latency: Math.max(0, Math.round(performance.now() - startedAt)),
        temperature: typeof firstTemperature?.current === 'number' ? firstTemperature.current : prev.temperature,
        uptime: Math.floor((Date.now() - startTimeRef.current) / 1000),
      }));

      if (robotStatuses.length === 0) {
        setSessionActive(false);
        stopKeyboardControl();
      }
    } catch (error) {
      setConnectionState('offline');
      setSessionActive(false);
      stopKeyboardControl();
    }
  }, []);

  const handleScanPorts = useCallback(async () => {
    setPortScanLoading(true);
    try {
      const result = await lerobotClient.adminScanMotorPorts();
      setPortScan(result);
    } catch (error) {
      const message = error?.body?.detail || error?.message || 'Failed to scan ports';
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
      Object.values(jointTimersRef.current).forEach((timer) => clearTimeout(timer));
    };
  }, [updateRuntimeState, handleScanPorts]);

  useEffect(() => {
    if (!isConnected) return undefined;

    syncSelectedRobotJoints().catch(() => {});
    const interval = setInterval(() => {
      syncSelectedRobotJoints().catch(() => {});
    }, 250);

    return () => clearInterval(interval);
  }, [isConnected, selectedRobotId, syncSelectedRobotJoints]);

  const stopKeyboardControl = useCallback(() => {
    if (keyboardLoopRef.current) {
      clearInterval(keyboardLoopRef.current);
      keyboardLoopRef.current = null;
    }
    keyboardKeysRef.current.clear();
    setActiveKeyboardKeys([]);
    setKeyboardActive(false);
    lastKeyboardExecutionRef.current = 0;
  }, []);

  const queueJointBatch = useCallback((entries, options = {}) => {
    if (!Array.isArray(entries) || entries.length === 0) return;

    const nextValues = new Map();
    const currentJoints = jointsRef.current;

    entries.forEach(({ id, position }) => {
      const joint = currentJoints.find((item) => item.id === id);
      if (!joint || typeof position !== 'number' || Number.isNaN(position)) return;

      const clamped = Math.min(joint.maxLimit, Math.max(joint.minLimit, position));
      nextValues.set(id, clamped);
      pendingJointWritesRef.current[id] = clamped;

      if (options.lockDuration) {
        draggingRef.current.add(id);
        if (jointTimersRef.current[id]) clearTimeout(jointTimersRef.current[id]);
        jointTimersRef.current[id] = setTimeout(() => {
          draggingRef.current.delete(id);
        }, options.lockDuration);
      }
    });

    if (nextValues.size === 0) return;

    setJoints((prev) =>
      prev.map((joint) => {
        if (!nextValues.has(joint.id)) return joint;
        const position = nextValues.get(joint.id);
        if (joint.id === 'gripper') openStateRef.current = position;
        return {
          ...joint,
          position,
          status: calculateJointStatus(joint, position),
        };
      }),
    );
  }, []);

  const handleStart = useCallback(async () => {
    if (connectionState === 'connecting' || robots.length === 0) return;

    setConnectionState('connecting');
    setCommandError('');

    try {
      await lerobotClient.moveInit(selectedRobotId);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await lerobotClient.moveAbsolute(selectedRobotId, {
        x: 0,
        y: 0,
        z: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        open: 1,
      });
      openStateRef.current = 1;
      setSessionActive(true);
      appendLog(`Initialized robot ${robots[selectedRobotId]?.device_name ?? selectedRobotId} with /move/init.`);
      await updateRuntimeState();
      await syncSelectedRobotJoints();
    } catch (error) {
      setSessionActive(false);
      setCommandError(error instanceof Error ? error.message : 'Robot init failed');
      appendLog(`Init failed: ${error instanceof Error ? error.message : 'Robot init failed'}`);
      await updateRuntimeState();
    }
  }, [appendLog, connectionState, robots, selectedRobotId, syncSelectedRobotJoints, updateRuntimeState]);

  const handleStop = useCallback(async () => {
    pendingJointWritesRef.current = {};
    stopKeyboardControl();
    setSessionActive(false);

    try {
      await lerobotClient.moveSleep(selectedRobotId);
      appendLog(`Sent /move/sleep to robot ${robots[selectedRobotId]?.device_name ?? selectedRobotId}.`);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Robot sleep failed');
      appendLog(`Sleep failed: ${error instanceof Error ? error.message : 'Robot sleep failed'}`);
    } finally {
      await updateRuntimeState();
    }
  }, [appendLog, robots, selectedRobotId, stopKeyboardControl, updateRuntimeState]);

  useEffect(() => {
    if (!isConnected || activeModeTab !== 'joints') return undefined;

    const flushInterval = setInterval(async () => {
      const pendingIds = Object.keys(pendingJointWritesRef.current);
      if (pendingIds.length === 0) return;

      const batch = pendingIds
        .map((id) => {
          const joint = JOINT_ORDER.find((item) => item.id === id);
          if (!joint) return null;
          return {
            servoId: joint.servoId,
            position: pendingJointWritesRef.current[id],
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.servoId - b.servoId);

      pendingJointWritesRef.current = {};

      if (batch.length === 0) return;

      try {
        await lerobotClient.writeJoints({
          robotId: selectedRobotId,
          unit: 'rad',
          joints_ids: batch.map((joint) => joint.servoId),
          angles: batch.map((joint) => joint.position),
        });
        setCommandError('');
      } catch (error) {
        setCommandError(error instanceof Error ? error.message : 'Joint write failed');
      }
    }, 33);

    return () => clearInterval(flushInterval);
  }, [activeModeTab, isConnected, selectedRobotId]);

  const handleJointUpdate = useCallback((jointId, value) => {
    queueJointBatch([{ id: jointId, position: value }], { lockDuration: 500 });
  }, [queueJointBatch]);

  const handleEStop = useCallback(async () => {
    try {
      if (estopActive) {
        await lerobotClient.estopOff();
        setEstopActive(false);
        appendLog('E-STOP released.');
        setCommandError('');
      } else {
        await lerobotClient.estopOn();
        setEstopActive(true);
        appendLog('E-STOP activated!');
        setCommandError('E-STOP is active. All movement blocked.');
      }
    } catch (err) {
      const message = `E-STOP toggle failed: ${err instanceof Error ? err.message : String(err)}`;
      setCommandError(message);
      appendLog(message);
    }
  }, [estopActive, appendLog]);

  const handleReset = useCallback(async () => {
    try {
      await lerobotClient.moveInit(selectedRobotId);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await lerobotClient.moveAbsolute(selectedRobotId, {
        x: 0,
        y: 0,
        z: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        open: 1,
      });
      openStateRef.current = 1;
      appendLog(`Reset robot ${robots[selectedRobotId]?.device_name ?? selectedRobotId} to baseline pose.`);
      await syncSelectedRobotJoints();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Reset failed');
    }
  }, [appendLog, robots, selectedRobotId, syncSelectedRobotJoints]);

  const pressKeyboardKey = useCallback(async (rawKey) => {
    const key = normalizeKeyboardKey(rawKey);
    if (!keyboardActive || !KEYBOARD_KEYS.has(key)) return;

    if (key === ' ' && openStateRef.current < 0.99) {
      openStateRef.current = 1;
      try {
        await lerobotClient.moveRelative(selectedRobotId, {
          x: 0,
          y: 0,
          z: 0,
          rx: 0,
          ry: 0,
          rz: 0,
          open: 1,
        });
      } catch (error) {
        setCommandError(error instanceof Error ? error.message : 'Keyboard gripper command failed');
      }
      keyboardKeysRef.current.delete(' ');
      setActiveKeyboardKeys(Array.from(keyboardKeysRef.current));
      return;
    }

    keyboardKeysRef.current.add(key);
    setActiveKeyboardKeys(Array.from(keyboardKeysRef.current));
  }, [keyboardActive, selectedRobotId]);

  const releaseKeyboardKey = useCallback((rawKey) => {
    const key = normalizeKeyboardKey(rawKey);
    if (!KEYBOARD_KEYS.has(key)) return;
    keyboardKeysRef.current.delete(key);
    setActiveKeyboardKeys(Array.from(keyboardKeysRef.current));
  }, []);

  useEffect(() => {
    if (activeModeTab !== 'keyboard' || !keyboardActive) return undefined;

    const isTypingTarget = (target) => {
      const tagName = target?.tagName;
      return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || tagName === 'BUTTON';
    };

    const handleKeyDown = (event) => {
      const normalized = normalizeKeyboardKey(event.key);
      if (!KEYBOARD_KEYS.has(normalized)) return;
      if (event.repeat || isTypingTarget(event.target)) return;
      event.preventDefault();
      pressKeyboardKey(normalized).catch(() => {});
    };

    const handleKeyUp = (event) => {
      const normalized = normalizeKeyboardKey(event.key);
      if (!KEYBOARD_KEYS.has(normalized)) return;
      event.preventDefault();
      releaseKeyboardKey(normalized);
    };

    const handleBlur = () => {
      keyboardKeysRef.current.clear();
      setActiveKeyboardKeys([]);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [activeModeTab, keyboardActive, pressKeyboardKey, releaseKeyboardKey]);

  useEffect(() => {
    if (!keyboardActive || !isConnected || activeModeTab !== 'keyboard') return undefined;

    keyboardLoopRef.current = setInterval(() => {
      const currentTime = Date.now();
      const deltaT = currentTime - lastKeyboardExecutionRef.current;

      if (deltaT < DEBOUNCE_INTERVAL) return;

      const lastOpenState = openStateRef.current;
      const gripperChangePerMs = (1 / FULL_TRANSITION_MS) * keyboardSpeed;
      const gripperChangeAmount = gripperChangePerMs * deltaT;

      if (keyboardKeysRef.current.has(' ')) {
        openStateRef.current -= gripperChangeAmount;
      } else {
        openStateRef.current += gripperChangeAmount;
      }
      openStateRef.current = Math.max(0, Math.min(1, openStateRef.current));
      const openStateChanged = Math.abs(openStateRef.current - lastOpenState) > 0.001;

      let deltaX = 0;
      let deltaY = 0;
      let deltaZ = 0;
      let deltaRZ = 0;
      let deltaRX = 0;
      let deltaRY = 0;

      keyboardKeysRef.current.forEach((key) => {
        if (key === ' ') return;
        const move = KEYBOARD_MOVEMENT_MAP[key];
        if (!move) return;
        deltaX += move.x;
        deltaY += move.y;
        deltaZ += move.z;
        deltaRZ += move.rz;
        deltaRX += move.rx;
        deltaRY += move.ry;
      });

      const hasMovement = deltaX || deltaY || deltaZ || deltaRZ || deltaRX || deltaRY;

      if (hasMovement || openStateChanged) {
        lerobotClient.moveRelative(selectedRobotId, {
          x: deltaX * keyboardSpeed,
          y: deltaY * keyboardSpeed,
          z: deltaZ * keyboardSpeed,
          rx: deltaRX * keyboardSpeed,
          ry: deltaRY * keyboardSpeed,
          rz: deltaRZ * keyboardSpeed,
          open: openStateRef.current,
        }).catch((error) => {
          setCommandError(error instanceof Error ? error.message : 'Keyboard command failed');
        });
      }

      lastKeyboardExecutionRef.current = currentTime;
    }, LOOP_INTERVAL);

    return () => {
      if (keyboardLoopRef.current) {
        clearInterval(keyboardLoopRef.current);
        keyboardLoopRef.current = null;
      }
    };
  }, [activeModeTab, isConnected, keyboardActive, keyboardSpeed, selectedRobotId]);

  useEffect(() => {
    if (!keyboardActive) return;
    if (activeModeTab !== 'keyboard' || !isConnected) {
      stopKeyboardControl();
    }
  }, [activeModeTab, isConnected, keyboardActive, stopKeyboardControl]);

  const handleSnapshot = useCallback(() => {
    const canvas = viewerPanelRef.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `teleop-snapshot-${Date.now()}.png`;
    a.click();
  }, []);

  const handleFullscreen = useCallback(async () => {
    if (!viewerPanelRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await viewerPanelRef.current.requestFullscreen();
    }
  }, []);

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

      <div className="absolute inset-0 cyber-grid opacity-30 pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,black_100%)] pointer-events-none opacity-60" />

      <div className="relative z-20 h-full overflow-hidden">
        <ControlPanel
          connectionState={connectionState}
          telemetry={telemetry}
          dryRun={false}
          isConnected={isConnected}
          robots={robots}
          selectedRobotId={selectedRobotId}
          onSelectRobot={setSelectedRobotId}
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
          teleopState={isConnected ? 'running' : 'idle'}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          commandError={commandError}
          onDismissError={() => setCommandError('')}
          estopActive={estopActive}
          portScan={portScan}
          portScanLoading={portScanLoading}
          onScanPorts={handleScanPorts}
          activeModeTab={activeModeTab}
          onModeTabChange={setActiveModeTab}
          keyboardControl={{
            isActive: keyboardActive,
            speed: keyboardSpeed,
            activeKeys: activeKeyboardKeys,
            onStart: () => {
              setKeyboardActive(true);
              appendLog(`Keyboard control armed for robot ${robots[selectedRobotId]?.device_name ?? selectedRobotId}.`);
            },
            onStop: stopKeyboardControl,
            onSpeedChange: setKeyboardSpeed,
            onKeyPress: (key) => {
              pressKeyboardKey(key).catch(() => {});
            },
            onKeyRelease: releaseKeyboardKey,
          }}
        />
      </div>

      <div className="relative z-10 h-full min-h-0">
        <ViewerPanel
          telemetry={telemetry}
          isConnected={isConnected}
          dryRun={false}
          onFullscreen={handleFullscreen}
          onSnapshot={handleSnapshot}
          viewerRef={viewerPanelRef}
        >
          <Suspense fallback={null}>
            <UrdfRobotViewer joints={joints} />
          </Suspense>
        </ViewerPanel>
      </div>

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
