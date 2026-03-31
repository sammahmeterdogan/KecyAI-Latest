import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { lerobotClient } from '../../lib/api/lerobotClient';
import ControlPanel from './teleop/components/ControlPanel';
import ViewerPanel from './teleop/components/ViewerPanel';
import LogViewer from './teleop/components/LogViewer';
import ModeTabs from './teleop/components/ModeTabs';
import JointCard from './teleop/components/JointCard';
import KeyboardControlTab from './teleop/components/KeyboardControlTab';
import GamepadControlTab from './teleop/components/GamepadControlTab';
import EStopButton from './teleop/components/EStopButton';
import styles from './TeleopControl.module.css';

const UrdfRobotViewer = lazy(() => import('../../features/teleop3d/UrdfRobotViewer'));

const ACTIVE_TAB_STORAGE_KEY = 'kecyai.teleop.active-tab';
const TELEOP_TABS = ['joints', 'keyboard', 'gamepad', 'camera', 'leader-arm'];
const JOINT_ORDER = [
  { id: 'shoulder_pan', name: 'Shoulder Pan', servoId: 1, minLimit: -180, maxLimit: 180, torque: 42 },
  { id: 'shoulder_lift', name: 'Shoulder Lift', servoId: 2, minLimit: -180, maxLimit: 180, torque: 58 },
  { id: 'elbow_flex', name: 'Elbow Flex', servoId: 3, minLimit: -180, maxLimit: 180, torque: 31 },
  { id: 'wrist_flex', name: 'Wrist Pitch', servoId: 4, minLimit: -180, maxLimit: 180, torque: 19 },
  { id: 'wrist_roll', name: 'Wrist Roll', servoId: 5, minLimit: -180, maxLimit: 180, torque: 14 },
  { id: 'gripper', name: 'Gripper', servoId: 6, minLimit: 0, maxLimit: 100, torque: 8 },
];
const INITIAL_JOINTS = JOINT_ORDER.map((joint) => ({
  ...joint,
  position: 0,
  actualPosition: 0,
  temperature: null,
  status: 'ok',
}));

// Joint-space increment map: each key directly moves a specific joint
const KEYBOARD_JOINT_MAP = {
  ArrowUp:    { joint: 'shoulder_lift', delta: +2.0 },
  ArrowDown:  { joint: 'shoulder_lift', delta: -2.0 },
  ArrowLeft:  { joint: 'shoulder_pan',  delta: +2.0 },
  ArrowRight: { joint: 'shoulder_pan',  delta: -2.0 },
  f:          { joint: 'elbow_flex',    delta: +2.0 },
  v:          { joint: 'elbow_flex',    delta: -2.0 },
  d:          { joint: 'wrist_flex',    delta: +2.0 },
  g:          { joint: 'wrist_flex',    delta: -2.0 },
  b:          { joint: 'wrist_roll',    delta: +2.0 },
  c:          { joint: 'wrist_roll',    delta: -2.0 },
};
const KEYBOARD_KEYS = new Set([...Object.keys(KEYBOARD_JOINT_MAP), ' ']);
const FULL_TRANSITION_MS = 500;
const LOOP_INTERVAL = 10;
const INSTRUCTIONS_PER_SECOND = 30;
const DEBOUNCE_INTERVAL = 1000 / INSTRUCTIONS_PER_SECOND;
const JOINT_TARGET_HOLD_MS = 4000;
const JOINT_SETTLE_TOLERANCE_DEG = 2;
const EMPTY_GAMEPAD_ANALOG_VALUES = {
  leftStickX: 0,
  leftStickY: 0,
  rightStickX: 0,
  rightStickY: 0,
  leftTrigger: 0,
  rightTrigger: 0,
};
const TELEOP_ROBOT_OPTIONS = [
  { value: 'so101_follower', label: 'SO-101 Follower' },
  { value: 'so100_follower', label: 'SO-100 Follower' },
  { value: 'so_follower', label: 'SO Follower' },
];
const SUPPORTED_TELEOP_ROBOT_TYPES = new Set(TELEOP_ROBOT_OPTIONS.map((option) => option.value));

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

function extractMaxTemperature(snapshotByJointId) {
  let maxTemperature = null;
  Object.values(snapshotByJointId ?? {}).forEach((snapshot) => {
    if (typeof snapshot?.temperature === 'number' && !Number.isNaN(snapshot.temperature)) {
      maxTemperature = maxTemperature == null
        ? snapshot.temperature
        : Math.max(maxTemperature, snapshot.temperature);
    }
  });
  return maxTemperature;
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

function ViewerLoadingFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#060608]">
      <div className="flex flex-col items-center gap-3 text-white/40">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-white/60" />
        <span className="text-[11px] font-mono uppercase tracking-[0.24em]">Loading 3D Viewer</span>
      </div>
    </div>
  );
}

function buildGamepadDiagnostics(status) {
  const controllers = Array.isArray(status?.available_gamepads) ? status.available_gamepads : [];
  return {
    backend: status?.backend ?? 'pygame',
    pygameAvailable: Boolean(status?.pygame_available),
    controllerCount: controllers.length,
    selectedIndex: status?.selected_index ?? null,
    message: status?.message ?? '',
    visibleControllers: controllers,
  };
}

function formatRobotTypeLabel(robotType) {
  if (!robotType) return 'No Robot Selected';
  const knownOption = TELEOP_ROBOT_OPTIONS.find((option) => option.value === robotType);
  if (knownOption) return knownOption.label;
  return robotType.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildRobotTypeOptions(currentRobotType) {
  const options = [...TELEOP_ROBOT_OPTIONS];
  if (
    currentRobotType
    && !SUPPORTED_TELEOP_ROBOT_TYPES.has(currentRobotType)
    && !options.some((option) => option.value === currentRobotType)
  ) {
    options.push({
      value: currentRobotType,
      label: `${formatRobotTypeLabel(currentRobotType)} (Unsupported for Web Teleop)`,
    });
  }
  return options;
}

function buildPortOptions(discoveredPorts, configuredPort, pendingPort) {
  const uniquePorts = new Set(
    [configuredPort, pendingPort, ...(Array.isArray(discoveredPorts) ? discoveredPorts : [])]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  );
  return Array.from(uniquePorts);
}

function formatRobotTarget(robotType, serialPort) {
  const label = formatRobotTypeLabel(robotType);
  const portLabel = serialPort ? serialPort.trim() : 'No Port Selected';
  return `${label} · ${portLabel}`;
}

function findPreflightCheck(preflight, id) {
  return Array.isArray(preflight?.checks)
    ? preflight.checks.find((check) => check?.id === id) ?? null
    : null;
}

function TeleopFrame({ className = '', children }) {
  return (
    <section
      className={`${styles.glassCard} ${styles.fadeInItem} rounded-[1.55rem] border border-white/10 bg-black/68 shadow-[0_18px_48px_rgba(0,0,0,0.32)] backdrop-blur-xl ${className}`}
    >
      {children}
    </section>
  );
}

export default function TeleopPage() {
  const [connectionState, setConnectionState] = useState('offline');
  const [runtimeReadiness, setRuntimeReadiness] = useState(null);
  const [runtimeConfig, setRuntimeConfig] = useState(null);
  const [hardwarePreflight, setHardwarePreflight] = useState(null);
  const [teleopStatusData, setTeleopStatusData] = useState({ state: 'idle' });
  const [calibrationStatusData, setCalibrationStatusData] = useState({ state: 'idle' });
  const [sensitivity, setSensitivity] = useState('medium');
  const [joints, setJoints] = useState(INITIAL_JOINTS);
  const [telemetry, setTelemetry] = useState({ fps: 0, latency: 0, voltage: null, temperature: null, uptime: 0 });
  const [logs, setLogs] = useState([]);
  const [commandError, setCommandError] = useState('');
  const [estopActive, setEstopActive] = useState(false);
  const [portScan, setPortScan] = useState(null);
  const [portScanLoading, setPortScanLoading] = useState(false);
  const [activeModeTab, setActiveModeTab] = useState(getInitialModeTab);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [keyboardSpeed, setKeyboardSpeed] = useState(0.8);
  const [activeKeyboardKeys, setActiveKeyboardKeys] = useState([]);
  const [gamepadActive, setGamepadActive] = useState(false);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [availableGamepads, setAvailableGamepads] = useState([]);
  const [selectedGamepadIndex, setSelectedGamepadIndex] = useState(null);
  const [gamepadSpeed, setGamepadSpeed] = useState(0.8);
  const [activeGamepadButtons, setActiveGamepadButtons] = useState([]);
  const [gamepadAnalogValues, setGamepadAnalogValues] = useState(EMPTY_GAMEPAD_ANALOG_VALUES);
  const [gamepadDiagnostics, setGamepadDiagnostics] = useState(() => buildGamepadDiagnostics());
  const selectedRobotId = 0;
  const [selectedRobotType, setSelectedRobotType] = useState('so101_follower');
  const [selectedSerialPort, setSelectedSerialPort] = useState('');
  const [selectionDirty, setSelectionDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  const jointTimersRef = useRef({});
  const startTimeRef = useRef(Date.now());
  const viewerPanelRef = useRef(null);
  const runtimeConfigRef = useRef(runtimeConfig);
  const draggingRef = useRef(new Set());
  const jointTargetLocksRef = useRef({});
  const jointsRef = useRef(INITIAL_JOINTS);
  const pendingJointWritesRef = useRef({});
  const keyboardKeysRef = useRef(new Set());
  const keyboardLoopRef = useRef(null);
  const lastKeyboardExecutionRef = useRef(0);
  const openStateRef = useRef(1);
  const keyboardSpeedRef = useRef(0.8);
  const gamepadSpeedRef = useRef(0.8);
  const lastUiUpdateRef = useRef(0);
  const runtimePollInFlightRef = useRef(false);
  const portScanInFlightRef = useRef(false);
  const gamepadPollInFlightRef = useRef(false);
  const gamepadConfigureTimerRef = useRef(null);

  const discoveredPorts = useMemo(() => (Array.isArray(portScan?.ports) ? portScan.ports : []), [portScan]);
  const configuredRobotType = (runtimeConfig?.robot_type || '').trim();
  const configuredPort = (runtimeConfig?.serial_port || '').trim();
  const robotTypeOptions = useMemo(() => buildRobotTypeOptions(configuredRobotType || selectedRobotType), [configuredRobotType, selectedRobotType]);
  const portOptions = useMemo(
    () => buildPortOptions(discoveredPorts, configuredPort, selectedSerialPort),
    [configuredPort, discoveredPorts, selectedSerialPort],
  );
  const runtimeTargetSupported = SUPPORTED_TELEOP_ROBOT_TYPES.has(configuredRobotType);
  const pendingTargetSupported = SUPPORTED_TELEOP_ROBOT_TYPES.has(selectedRobotType);
  const serialCheck = useMemo(() => findPreflightCheck(hardwarePreflight, 'serial_port'), [hardwarePreflight]);
  const serviceReady = connectionState === 'online' || connectionState === 'connecting';
  const teleopWorkflowState = teleopStatusData?.state || 'idle';
  const calibrationWorkflowState = calibrationStatusData?.state || 'idle';
  const teleopDryRun = Boolean(teleopStatusData?.dry_run || teleopStatusData?.metadata?.dry_run);
  const teleopActive = ['running', 'starting'].includes(teleopWorkflowState);
  const teleopRunning = teleopWorkflowState === 'running';
  const calibrationActive = calibrationWorkflowState === 'running';
  const portsFound = discoveredPorts.length > 0;
  const configuredPortDetected = Boolean(
    serialCheck?.status === 'ok' || (configuredPort && discoveredPorts.includes(configuredPort)),
  );
  const selectedPortDetected = Boolean(
    selectedSerialPort && (selectedSerialPort === configuredPort ? configuredPortDetected : discoveredPorts.includes(selectedSerialPort)),
  );
  const hardwareReady = Boolean(runtimeTargetSupported && hardwarePreflight?.ready && configuredPortDetected);
  const appliedRobotTargetLabel = formatRobotTarget(configuredRobotType || selectedRobotType, configuredPort);
  const selectedRobotTargetLabel = formatRobotTarget(selectedRobotType, selectedSerialPort);
  const canApplyRobotTarget = serviceReady && !teleopActive && !calibrationActive && pendingTargetSupported && !configSaving
    && (selectedRobotType !== configuredRobotType || selectedSerialPort !== configuredPort);
  const canStartTeleop = serviceReady && !selectionDirty && !configSaving && !calibrationActive && hardwareReady;
  const isConnected = teleopActive && !teleopDryRun;
  // Only poll hardware when teleop is actively running.  Passive monitoring
  // in idle state opens COM3 via PassiveRobotIO, which blocks the teleop
  // adapter from re-acquiring the port when the user clicks Connect.
  const canMonitorHardware = isConnected;

  useEffect(() => {
    jointsRef.current = joints;
  }, [joints]);

  useEffect(() => { keyboardSpeedRef.current = keyboardSpeed; }, [keyboardSpeed]);
  useEffect(() => { gamepadSpeedRef.current = gamepadSpeed; }, [gamepadSpeed]);
  useEffect(() => { runtimeConfigRef.current = runtimeConfig; }, [runtimeConfig]);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeModeTab);
  }, [activeModeTab]);

  useEffect(() => {
    if (!selectionDirty && configuredRobotType) {
      setSelectedRobotType(configuredRobotType);
      setSelectedSerialPort(configuredPort);
    }
  }, [configuredPort, configuredRobotType, selectionDirty]);

  const serviceStateLabel = !serviceReady
    ? 'STOPPED'
    : teleopWorkflowState === 'starting'
      ? 'STARTING'
      : teleopRunning || calibrationActive
        ? 'WORKING'
        : 'READY';
  const robotStateLabel = selectionDirty
    ? 'SELECTION PENDING'
    : !configuredRobotType
      ? 'NO ROBOT SELECTED'
      : !runtimeTargetSupported
        ? `UNSUPPORTED FOR TELEOP · ${formatRobotTypeLabel(configuredRobotType)}`
        : teleopWorkflowState === 'starting'
      ? 'ROBOT CONNECTING'
      : teleopDryRun && teleopRunning
        ? 'DRY-RUN SESSION'
      : isConnected
        ? 'ROBOT CONNECTED'
        : !configuredPort
          ? (portsFound ? 'PORTS FOUND / NOT CONFIGURED' : 'NO MOTORBUS PORT')
          : configuredPortDetected
            ? `ROBOT CONNECTABLE · ${configuredPort}`
            : `PORT NOT FOUND · ${configuredPort}`;
  const workflowStateLabel = calibrationActive
    ? 'CALIBRATION ACTIVE'
    : teleopWorkflowState === 'starting'
      ? 'TELEOP STARTING'
      : teleopWorkflowState === 'running'
        ? (teleopDryRun ? 'TELEOP ACTIVE (DRY-RUN)' : 'TELEOP ACTIVE')
        : 'TELEOP IDLE';
  const gamepadStateLabel = !serviceReady
    ? 'GAMEPAD UNAVAILABLE'
    : gamepadConnected
      ? `${gamepadDiagnostics.controllerCount || availableGamepads.length} GAMEPAD DETECTED`
      : 'GAMEPAD NOT DETECTED';
  const scanConsoleLines = useMemo(
    () => [
      ...(Array.isArray(portScan?.stdout) ? portScan.stdout : []),
      ...(Array.isArray(portScan?.stderr) ? portScan.stderr.map((line) => `[stderr] ${line}`) : []),
    ],
    [portScan],
  );
  const statusHint = commandError
    ? ''
    : !serviceReady
    ? 'Servis çevrimdışı.'
    : teleopWorkflowState === 'starting'
      ? 'Bağlanıyor...'
    : calibrationActive
      ? 'Kalibrasyon aktif. Durdurun.'
    : !pendingTargetSupported
        ? 'Desteklenen bir follower robot seçin.'
      : selectionDirty
        ? 'Hedefi uygulayın.'
      : !configuredRobotType
        ? 'Robot seçin.'
      : !runtimeTargetSupported
        ? `${formatRobotTypeLabel(configuredRobotType)} desteklenmiyor.`
        : !configuredPort
          ? (portsFound ? 'Port yapılandırılmamış.' : 'Motor portu bulunamadı.')
          : !configuredPortDetected
            ? `Port bulunamadı: ${configuredPort}`
            : teleopDryRun && teleopRunning
              ? 'Dry-run aktif.'
              : '';
  const statusHintTone = !serviceReady || calibrationActive || !configuredPortDetected
    ? 'amber'
    : teleopDryRun && teleopActive
      ? 'amber'
      : 'emerald';
  const connectionPillState = !serviceReady
    ? 'offline'
    : teleopWorkflowState === 'starting'
      ? 'connecting'
      : teleopActive || calibrationActive
        ? 'working'
        : 'online';
  const connectionPillLabel = calibrationActive
    ? 'CALIBRATING'
    : teleopWorkflowState === 'starting'
      ? 'STARTING'
      : teleopActive
        ? (teleopDryRun ? 'DRY-RUN' : 'CONNECTED')
        : serviceReady
          ? 'SERVICE READY'
          : 'OFFLINE';
  const connectButtonLabel = teleopWorkflowState === 'starting'
      ? 'CONNECTING...'
      : teleopRunning
        ? 'DISCONNECT'
      : !serviceReady
        ? 'SERVICE OFFLINE'
        : configSaving
          ? 'APPLYING TARGET'
        : calibrationActive
          ? 'CALIBRATION ACTIVE'
          : selectionDirty
            ? 'APPLY ROBOT TARGET'
            : !configuredRobotType
              ? 'SELECT ROBOT'
              : !runtimeTargetSupported
                ? 'UNSUPPORTED ROBOT'
                : !configuredPort
                  ? (portsFound ? 'CONFIGURE PORT' : 'NO MOTOR PORT')
                  : !configuredPortDetected
                    ? 'PORT NOT FOUND'
                    : 'CONNECT ROBOT';
  const connectButtonDisabled = teleopWorkflowState === 'starting'
    ? true
    : teleopRunning
      ? false
      : !canStartTeleop;
  const renderStateLabel = teleopRunning
    ? (teleopDryRun ? 'Dry-run active' : 'Live session')
    : serviceReady
      ? 'Ready'
      : 'Service offline';
  const diagnosticsToneClass = serviceReady
    ? 'text-white/64'
    : 'text-amber-200/70';
  const showJointsTab = activeModeTab === 'joints';

  const appendLog = useCallback((message) => {
    setLogs((prev) => [formatLog(message), ...prev].slice(0, 200));
  }, []);

  const releaseJointLock = useCallback((jointId) => {
    draggingRef.current.delete(jointId);
    delete jointTargetLocksRef.current[jointId];
    if (jointTimersRef.current[jointId]) {
      clearTimeout(jointTimersRef.current[jointId]);
      delete jointTimersRef.current[jointId];
    }
  }, []);

  const clearJointLocks = useCallback(() => {
    Object.keys(jointTimersRef.current).forEach((jointId) => {
      clearTimeout(jointTimersRef.current[jointId]);
    });
    jointTimersRef.current = {};
    draggingRef.current.clear();
    jointTargetLocksRef.current = {};
  }, []);

  const lockJointTarget = useCallback((jointId, target, timeoutMs = JOINT_TARGET_HOLD_MS) => {
    draggingRef.current.add(jointId);
    jointTargetLocksRef.current[jointId] = {
      target,
      expiresAt: Date.now() + timeoutMs,
    };
    if (jointTimersRef.current[jointId]) clearTimeout(jointTimersRef.current[jointId]);
    jointTimersRef.current[jointId] = setTimeout(() => {
      releaseJointLock(jointId);
    }, timeoutMs);
  }, [releaseJointLock]);

  const shouldHoldJointTarget = useCallback((jointId, actualPosition) => {
    const lock = jointTargetLocksRef.current[jointId];
    if (!lock) return false;
    if (typeof actualPosition !== 'number' || Number.isNaN(actualPosition)) return true;

    if (Math.abs(actualPosition - lock.target) <= JOINT_SETTLE_TOLERANCE_DEG) {
      releaseJointLock(jointId);
      return false;
    }

    if (Date.now() >= lock.expiresAt) {
      releaseJointLock(jointId);
      return false;
    }

    return true;
  }, [releaseJointLock]);

  useEffect(() => {
    if (isConnected) return;
    pendingJointWritesRef.current = {};
    clearJointLocks();
  }, [isConnected, clearJointLocks]);

  const applyRobotJointSnapshot = useCallback((snapshotByJointId, options = {}) => {
    const { syncTargets = false } = options;
    const maxTemperature = extractMaxTemperature(snapshotByJointId);

    if (typeof maxTemperature === 'number') {
      setTelemetry((prev) => ({
        ...prev,
        temperature: maxTemperature,
      }));
    }

    setJoints((prev) =>
      prev.map((joint) => {
        const snapshot = snapshotByJointId[joint.id];
        if (!snapshot) return joint;

        const nextActual = typeof snapshot.position === 'number' ? snapshot.position : joint.actualPosition;
        if (typeof nextActual !== 'number' || Number.isNaN(nextActual)) return joint;

        const jointDef = JOINT_ORDER.find((item) => item.id === joint.id) ?? joint;
        const nextPosition = syncTargets ? nextActual : joint.position;
        const nextTemperature = typeof snapshot.temperature === 'number' ? snapshot.temperature : joint.temperature;

        if (joint.id === 'gripper') {
          openStateRef.current = syncTargets ? nextPosition : nextActual;
        }

        return {
          ...joint,
          position: nextPosition,
          actualPosition: nextActual,
          temperature: nextTemperature ?? null,
          status: calculateJointStatus(jointDef, nextActual),
        };
      }),
    );
  }, []);

  const syncSelectedRobotJoints = useCallback(async (options = {}) => {
    if (!canMonitorHardware && !options.force) return;
    // Skip polling during keyboard control — keyboard loop owns joint state
    if (keyboardKeysRef.current.size > 0 && !options.syncTargets) return;

    const response = await lerobotClient.readJoints({
      robotId: selectedRobotId,
      unit: 'deg',
      joints_ids: JOINT_ORDER.map((joint) => joint.servoId),
      source: 'robot',
    });

    const snapshotByJointId = {};

    if (Array.isArray(response?.joints) && response.joints.length > 0) {
      response.joints.forEach((joint) => {
        if (joint?.id && typeof joint.position === 'number') {
          snapshotByJointId[joint.id] = {
            position: joint.position,
            temperature: typeof joint.temperature === 'number' ? joint.temperature : null,
          };
        }
      });
    }

    if (Object.keys(snapshotByJointId).length === 0 && Array.isArray(response?.angles)) {
      response.angles.forEach((angle, index) => {
        const jointId = JOINT_ORDER[index]?.id;
        if (jointId && typeof angle === 'number') {
          snapshotByJointId[jointId] = { position: angle, temperature: null };
        }
      });
    }

    applyRobotJointSnapshot(snapshotByJointId, options);
  }, [applyRobotJointSnapshot, canMonitorHardware, selectedRobotId]);

  const updateRuntimeState = useCallback(async () => {
    if (runtimePollInFlightRef.current) return;
    runtimePollInFlightRef.current = true;
    try {
      const [readiness, teleopStatus, calibrationStatus, config] = await Promise.all([
        lerobotClient.getReadiness(),
        lerobotClient.teleopStatus().catch(() => ({ state: 'idle' })),
        lerobotClient.calibrationStatus().catch(() => ({ state: 'idle' })),
        lerobotClient.adminGetConfig().catch(() => null),
      ]);
      const firstTemperature = Array.isArray(readiness?.joints)
        ? readiness.joints.find((joint) => typeof joint?.temperature === 'number')
        : null;

      setRuntimeReadiness(readiness);
      setRuntimeConfig(config);
      setTeleopStatusData(teleopStatus ?? { state: 'idle' });
      setCalibrationStatusData(calibrationStatus ?? { state: 'idle' });
      setSessionActive(['running', 'starting'].includes(teleopStatus?.state));
      setConnectionState(teleopStatus?.state === 'starting' ? 'connecting' : 'online');
      setTelemetry((prev) => ({
        ...prev,
        fps: typeof teleopStatus?.metadata?.fps === 'number'
          ? teleopStatus.metadata.fps
          : teleopStatus?.state === 'running'
            ? prev.fps
            : 0,
        latency: typeof teleopStatus?.metadata?.latency_ms === 'number'
          ? teleopStatus.metadata.latency_ms
          : teleopStatus?.state === 'running'
            ? prev.latency
            : 0,
        voltage: typeof teleopStatus?.metadata?.voltage === 'number'
          ? teleopStatus.metadata.voltage
          : teleopStatus?.state === 'running'
            ? prev.voltage
            : null,
        temperature: typeof firstTemperature?.temperature === 'number' ? firstTemperature.temperature : prev.temperature,
        uptime: Math.floor((Date.now() - startTimeRef.current) / 1000),
      }));
      setCommandError((prev) => (
        prev && /failed to fetch|runtime service unreachable|request timed out/i.test(prev) ? '' : prev
      ));

      // Keep E-Stop UI in sync with server state (covers page refresh / server restart)
      setEstopActive(Boolean(teleopStatus?.metadata?.estop));

      if (!['running', 'starting'].includes(teleopStatus?.state)) {
        setSessionActive(false);
        stopKeyboardControl();
        resetGamepadUiState();
      }
    } catch (error) {
      setRuntimeReadiness(null);
      setRuntimeConfig(null);
      setHardwarePreflight(null);
      setTeleopStatusData({ state: 'idle' });
      setCalibrationStatusData({ state: 'idle' });
      setConnectionState('offline');
      setSessionActive(false);
      setPortScan(null);
      stopKeyboardControl();
      resetGamepadUiState();
    } finally {
      runtimePollInFlightRef.current = false;
    }
  }, []);

  const handleScanPorts = useCallback(async (configOverride = null) => {
    if (portScanInFlightRef.current) return;
    portScanInFlightRef.current = true;
    setPortScanLoading(true);
    try {
      const [result, config] = await Promise.all([
        lerobotClient.adminScanMotorPorts(),
        Promise.resolve(configOverride).then((value) => value || lerobotClient.adminGetConfig().catch(() => runtimeConfigRef.current)),
      ]);
      const nextPreflight = await lerobotClient
        .adminPreflight(config?.robot_type || 'so101_follower')
        .catch(() => null);
      setPortScan(result);
      setHardwarePreflight(nextPreflight);
      if (config) {
        setRuntimeConfig(config);
      }
      if (Array.isArray(result?.ports) && result.ports.length > 0) {
        setCommandError((prev) => (
          prev && /failed to fetch|runtime service unreachable|request timed out/i.test(prev) ? '' : prev
        ));
      }
    } catch (error) {
      const message = error?.body?.detail || error?.message || 'Failed to scan ports';
      setPortScan({
        status: 'error',
        ports: [],
        source: 'runtime',
        message,
        stdout: [],
        stderr: [],
        exit_code: null,
      });
      setHardwarePreflight(null);
    } finally {
      portScanInFlightRef.current = false;
      setPortScanLoading(false);
    }
  // runtimeConfig intentionally omitted — consumed via runtimeConfigRef so this
  // callback stays stable and doesn't trigger the main effect on every poll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRobotTypeChange = useCallback((nextRobotType) => {
    setSelectedRobotType(nextRobotType);
    setSelectionDirty(true);
    setCommandError('');
  }, []);

  const handleSerialPortChange = useCallback((nextSerialPort) => {
    setSelectedSerialPort(nextSerialPort);
    setSelectionDirty(true);
    setCommandError('');
  }, []);

  const handleApplyRobotTarget = useCallback(async () => {
    if (!serviceReady) {
      setCommandError('KECYAI service is not ready yet.');
      return;
    }
    if (!pendingTargetSupported) {
      setCommandError('Choose a supported follower robot before applying the target.');
      return;
    }
    if (teleopActive || calibrationActive) {
      setCommandError('Stop the active workflow before changing the robot target.');
      return;
    }

    setConfigSaving(true);
    setCommandError('');
    try {
      const nextConfig = await lerobotClient.adminSetConfig({
        robot_type: selectedRobotType,
        serial_port: selectedSerialPort,
      });
      setRuntimeConfig(nextConfig);
      setSelectionDirty(false);
      appendLog(`Runtime target set to ${formatRobotTarget(nextConfig.robot_type, nextConfig.serial_port)}.`);
      await handleScanPorts(nextConfig);
      await updateRuntimeState();
    } catch (error) {
      const message = error?.body?.detail || error?.message || 'Failed to update the robot target';
      setCommandError(message);
      appendLog(`Robot target update failed: ${message}`);
    } finally {
      setConfigSaving(false);
    }
  }, [
    appendLog,
    calibrationActive,
    handleScanPorts,
    pendingTargetSupported,
    selectedRobotType,
    selectedSerialPort,
    serviceReady,
    teleopActive,
    updateRuntimeState,
  ]);

  // Poll runtime teleop logs to feed into the log viewer
  const fetchTeleopLogs = useCallback(async () => {
    try {
      const data = await lerobotClient.teleopLogs(20);
      const lines = data.logs ?? data.lines ?? [];
      if (Array.isArray(lines) && lines.length > 0) {
        setLogs((prev) => {
          const existing = new Set(prev);
          const newLines = lines
            .map((l) => (typeof l === 'string' ? l : l?.message ?? ''))
            .filter((l) => l && !existing.has(l));
          return newLines.length > 0 ? [...newLines.reverse(), ...prev].slice(0, 200) : prev;
        });
      }
    } catch { /* runtime may not be running */ }
  }, []);

  const applyGamepadStatus = useCallback((status) => {
    const available = Array.isArray(status?.available_gamepads) ? status.available_gamepads : [];
    setAvailableGamepads(available);
    setGamepadConnected(available.length > 0);
    setGamepadActive(Boolean(status?.active));
    setGamepadSpeed(typeof status?.speed === 'number' ? status.speed : 0.8);
    setActiveGamepadButtons(Array.isArray(status?.active_buttons) ? status.active_buttons : []);
    setGamepadAnalogValues({
      ...EMPTY_GAMEPAD_ANALOG_VALUES,
      ...(status?.analog_values ?? {}),
    });
    setGamepadDiagnostics(buildGamepadDiagnostics(status));
    setSelectedGamepadIndex((current) => {
      const selected = status?.selected_index;
      if (typeof selected === 'number' && available.some((gamepad) => gamepad.index === selected)) {
        return selected;
      }
      if (current !== null && available.some((gamepad) => gamepad.index === current)) {
        return current;
      }
      return available.length > 0 ? available[0].index : null;
    });
  }, []);

  const refreshGamepads = useCallback(async () => {
    if (gamepadPollInFlightRef.current) return;
    gamepadPollInFlightRef.current = true;
    try {
      const status = await lerobotClient.gamepadStatus();
      applyGamepadStatus(status);
    } catch (error) {
      setGamepadConnected(false);
      setGamepadActive(false);
      setAvailableGamepads([]);
      setActiveGamepadButtons([]);
      setGamepadAnalogValues(EMPTY_GAMEPAD_ANALOG_VALUES);
      setGamepadDiagnostics((prev) => ({
        ...(prev ?? buildGamepadDiagnostics()),
        backend: 'pygame',
        pygameAvailable: false,
        controllerCount: 0,
        selectedIndex: null,
        visibleControllers: [],
        message: error instanceof Error ? error.message : 'Runtime gamepad status failed',
      }));
    } finally {
      gamepadPollInFlightRef.current = false;
    }
  }, [applyGamepadStatus]);

  useEffect(() => {
    updateRuntimeState();
    handleScanPorts();
    refreshGamepads().catch(() => {});
    const interval = setInterval(updateRuntimeState, 1500);
    const scanInterval = setInterval(() => {
      handleScanPorts();
    }, 5000);
    const logInterval = setInterval(fetchTeleopLogs, 2000);
    const gamepadInterval = setInterval(() => {
      refreshGamepads().catch(() => {});
    }, 350);

    return () => {
      clearInterval(interval);
      clearInterval(scanInterval);
      clearInterval(logInterval);
      clearInterval(gamepadInterval);
      Object.values(jointTimersRef.current).forEach((timer) => clearTimeout(timer));
      clearJointLocks();
      if (gamepadConfigureTimerRef.current) {
        clearTimeout(gamepadConfigureTimerRef.current);
        gamepadConfigureTimerRef.current = null;
      }
    };
  }, [updateRuntimeState, handleScanPorts, fetchTeleopLogs, clearJointLocks, refreshGamepads]);

  useEffect(() => {
    if (canMonitorHardware) return;
    setJoints(INITIAL_JOINTS);
    setTelemetry((prev) => ({
      ...prev,
      fps: 0,
      voltage: null,
      temperature: null,
    }));
  }, [canMonitorHardware]);

  useEffect(() => {
    if (!canMonitorHardware) return undefined;

    const intervalMs = isConnected ? 250 : 1000;
    syncSelectedRobotJoints({ syncTargets: !sessionActive }).catch(() => {});
    const interval = setInterval(() => {
      syncSelectedRobotJoints({ syncTargets: !sessionActive }).catch(() => {});
    }, intervalMs);

    return () => clearInterval(interval);
  }, [canMonitorHardware, isConnected, sessionActive, selectedRobotId, syncSelectedRobotJoints]);

  // SSE telemetry stream — connects when session is active (real hardware OR dry-run)
  useEffect(() => {
    if (!teleopActive) return undefined;

    const es = new EventSource(lerobotClient.teleopTelemetryStreamUrl());

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setTelemetry((prev) => ({
          ...prev,
          fps: typeof data.fps === 'number' ? data.fps : prev.fps,
          latency: typeof data.latency_ms === 'number' ? data.latency_ms : prev.latency,
          voltage: typeof data.voltage === 'number' ? data.voltage : prev.voltage,
          temperature: typeof data.temperature === 'number' ? data.temperature : prev.temperature,
          uptime: typeof data.uptime_s === 'number' ? data.uptime_s : prev.uptime,
        }));

        // Telemetry updates live robot positions and per-servo temperatures.
        if (Array.isArray(data.joints) && !keyboardLoopRef.current) {
          const snapshotByJointId = {};
          data.joints.forEach((joint) => {
            if (joint?.id && typeof joint.position === 'number') {
              snapshotByJointId[joint.id] = {
                position: joint.position,
                temperature: typeof joint.temperature === 'number' ? joint.temperature : null,
              };
            }
          });
          applyRobotJointSnapshot(snapshotByJointId);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // SSE will auto-reconnect
    };

    return () => es.close();
  }, [applyRobotJointSnapshot, teleopActive]);

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

  const resetGamepadUiState = useCallback(() => {
    setActiveGamepadButtons([]);
    setGamepadAnalogValues(EMPTY_GAMEPAD_ANALOG_VALUES);
    setGamepadActive(false);
  }, []);

  const stopGamepadControl = useCallback(async (options = {}) => {
    const { silent = false } = options;
    resetGamepadUiState();
    try {
      const status = await lerobotClient.gamepadStop();
      applyGamepadStatus(status);
      if (!silent) {
        appendLog('Runtime gamepad control stopped.');
      }
    } catch (error) {
      if (!silent) {
        setCommandError(error instanceof Error ? error.message : 'Gamepad stop failed');
      }
    }
  }, [appendLog, applyGamepadStatus, resetGamepadUiState]);

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

      if (options.holdTarget !== false) {
        lockJointTarget(id, clamped, options.lockDuration ?? JOINT_TARGET_HOLD_MS);
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
  }, [lockJointTarget]);

  const startingRef = useRef(false);
  const handleStart = useCallback(async () => {
    if (startingRef.current || connectionState === 'connecting') return;
    if (!canStartTeleop) {
      const message = !serviceReady
        ? 'KECYAI service is not ready yet.'
        : calibrationActive
          ? 'Calibration is active. Stop calibration before teleoperation.'
          : selectionDirty
            ? 'Apply the selected robot target before starting teleoperation.'
            : !configuredRobotType
              ? 'Choose a robot target before starting teleoperation.'
              : !runtimeTargetSupported
                ? `${formatRobotTypeLabel(configuredRobotType)} is not supported for web teleoperation.`
                : !configuredPort
                  ? (portsFound
                      ? 'MotorBus ports were found, but no serial port is configured for the active robot target.'
                      : 'No MotorBus port was found. Connect the robot first.')
                  : !configuredPortDetected
                    ? `Configured serial port ${configuredPort} is not currently detected.`
                    : 'Robot hardware is not ready for teleoperation.';
      setCommandError(message);
      appendLog(`Teleop blocked: ${message}`);
      return;
    }
    startingRef.current = true;

    setConnectionState('connecting');
    setCommandError('');

    try {
      // Start teleop session first — this connects the adapter and starts the control loop
      await lerobotClient.teleopStart({
        robot_type: configuredRobotType,
        teleop_type: 'web',
        robot_port: configuredPort || undefined,
      });
      appendLog(`Teleop session started for ${formatRobotTarget(configuredRobotType, configuredPort)}.`);

      // Move to home pose
      await lerobotClient.moveInit(selectedRobotId);
      openStateRef.current = 1;
      setSessionActive(true);
      appendLog(`Initialized ${formatRobotTarget(configuredRobotType, configuredPort)}.`);
      await updateRuntimeState();
      await refreshGamepads();
      await syncSelectedRobotJoints({ syncTargets: true, force: true });
    } catch (error) {
      setSessionActive(false);
      setCommandError(error instanceof Error ? error.message : 'Robot init failed');
      appendLog(`Init failed: ${error instanceof Error ? error.message : 'Robot init failed'}`);
      await updateRuntimeState();
      await refreshGamepads();
    } finally {
      startingRef.current = false;
    }
  }, [
    appendLog,
    calibrationActive,
    canStartTeleop,
    configuredPort,
    configuredRobotType,
    configuredPortDetected,
    connectionState,
    portsFound,
    refreshGamepads,
    runtimeTargetSupported,
    selectedRobotId,
    selectionDirty,
    serviceReady,
    syncSelectedRobotJoints,
    updateRuntimeState,
  ]);

  const handleStop = useCallback(async () => {
    pendingJointWritesRef.current = {};
    clearJointLocks();
    stopKeyboardControl();
    await stopGamepadControl({ silent: true });
    setSessionActive(false);

    try {
      // Send arm to home pose before stopping
      await lerobotClient.moveInit(selectedRobotId);
      appendLog('Robot returned to home pose.');
    } catch (error) {
      appendLog(`Home pose failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      // Stop the teleop session — disconnects adapter, stops control loop
      await lerobotClient.teleopStop();
      appendLog('Teleop session stopped.');
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Session stop failed');
      appendLog(`Stop failed: ${error instanceof Error ? error.message : 'Session stop failed'}`);
    } finally {
      await updateRuntimeState();
      await refreshGamepads();
      // Refresh preflight so the Connect button re-enables immediately
      handleScanPorts().catch(() => {});
    }
  }, [appendLog, clearJointLocks, handleScanPorts, refreshGamepads, selectedRobotId, stopGamepadControl, stopKeyboardControl, updateRuntimeState]);

  useEffect(() => {
    if (!isConnected || !['joints', 'gamepad'].includes(activeModeTab)) return undefined;

    const flushInterval = setInterval(async () => {
      const pendingIds = Object.keys(pendingJointWritesRef.current);
      if (pendingIds.length === 0) return;

      const batch = pendingIds
        .map((id) => {
          const joint = JOINT_ORDER.find((item) => item.id === id);
          if (!joint) return null;
          return {
            jointId: joint.id,
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
          unit: 'deg',
          joint_names: batch.map((joint) => joint.jointId),
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
    queueJointBatch([{ id: jointId, position: value }], { lockDuration: JOINT_TARGET_HOLD_MS });
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
        pendingJointWritesRef.current = {};
        clearJointLocks();
        stopKeyboardControl();
        await stopGamepadControl({ silent: true });
        appendLog('E-STOP activated!');
        setCommandError('E-STOP is active. All movement blocked.');
      }
    } catch (err) {
      const message = `E-STOP toggle failed: ${err instanceof Error ? err.message : String(err)}`;
      setCommandError(message);
      appendLog(message);
    }
  }, [estopActive, appendLog, clearJointLocks, stopGamepadControl, stopKeyboardControl]);

  const handleReset = useCallback(async () => {
    try {
      await lerobotClient.moveInit(selectedRobotId);
      appendLog(`Reset ${formatRobotTarget(configuredRobotType, configuredPort)} to home pose.`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await syncSelectedRobotJoints({ syncTargets: true, force: true });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Reset failed');
    }
  }, [appendLog, configuredPort, configuredRobotType, selectedRobotId, syncSelectedRobotJoints]);

  const pressKeyboardKey = useCallback(async (rawKey) => {
    const key = normalizeKeyboardKey(rawKey);
    if (!keyboardActive || !KEYBOARD_KEYS.has(key)) return;

    keyboardKeysRef.current.add(key);
    setActiveKeyboardKeys(Array.from(keyboardKeysRef.current));
  }, [keyboardActive]);

  const releaseKeyboardKey = useCallback((rawKey) => {
    const key = normalizeKeyboardKey(rawKey);
    if (!KEYBOARD_KEYS.has(key)) return;
    keyboardKeysRef.current.delete(key);
    setActiveKeyboardKeys(Array.from(keyboardKeysRef.current));

    // Space released -> fully open gripper as a one-shot action.
    if (key === ' ') {
      openStateRef.current = 100;
      lerobotClient.sendCommand([{ id: 'gripper', position: 100 }], 'manual').catch(() => {});
    }
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

      const speed = keyboardSpeedRef.current;
      const keys = keyboardKeysRef.current;

      // No keys pressed → nothing to do
      if (keys.size === 0) {
        lastKeyboardExecutionRef.current = currentTime;
        return;
      }

      // Gripper: only change when space IS pressed (close). Hold position otherwise.
      let openStateChanged = false;
      if (keys.has(' ')) {
        const lastOpenState = openStateRef.current;
        const gripperChangePerMs = (100 / FULL_TRANSITION_MS) * speed;
        // Cap deltaT to prevent huge jump on first tick
        const clampedDeltaT = Math.min(deltaT, 100);
        const gripperChangeAmount = gripperChangePerMs * clampedDeltaT;
        openStateRef.current = Math.max(0, openStateRef.current - gripperChangeAmount);
        openStateChanged = Math.abs(openStateRef.current - lastOpenState) > 0.01;
      }

      // Accumulate joint deltas from pressed keys
      const jointDeltas = {};
      keys.forEach((key) => {
        if (key === ' ') return;
        const mapping = KEYBOARD_JOINT_MAP[key];
        if (!mapping) return;
        jointDeltas[mapping.joint] = (jointDeltas[mapping.joint] || 0) + mapping.delta * speed;
      });

      const hasMovement = Object.keys(jointDeltas).length > 0;

      if (hasMovement || openStateChanged) {
        // Build angles from current positions + deltas
        const currentJoints = jointsRef.current;
        const updatedJoints = currentJoints.map((joint) => {
          const jDef = JOINT_ORDER.find((j) => j.id === joint.id);
          if (!jDef) return joint;
          let pos = joint.position;
          if (jointDeltas[joint.id]) {
            pos += jointDeltas[joint.id];
          }
          if (joint.id === 'gripper') {
            pos = openStateRef.current;
          }
          const clamped = Math.max(jDef.minLimit, Math.min(jDef.maxLimit, pos));
          return { ...joint, position: clamped, status: calculateJointStatus(jDef, clamped) };
        });

        // Update ref immediately so next tick accumulates on top.
        // Throttle React state (URDF re-render) to 10Hz to save CPU.
        jointsRef.current = updatedJoints;
        if (!lastUiUpdateRef.current || currentTime - lastUiUpdateRef.current > 100) {
          setJoints(updatedJoints);
          lastUiUpdateRef.current = currentTime;
        }

        // Only send joints that actually changed
        const changedJoints = [];
        updatedJoints.forEach((joint, i) => {
          if (Math.abs(joint.position - currentJoints[i].position) > 0.001) {
            changedJoints.push({ id: joint.id, position: joint.position });
          }
        });

        if (changedJoints.length > 0) {
          lerobotClient.sendCommand(changedJoints, 'manual').catch((error) => {
            setCommandError(error instanceof Error ? error.message : 'Keyboard command failed');
          });
        }
      }

      lastKeyboardExecutionRef.current = currentTime;
    }, LOOP_INTERVAL);

    return () => {
      if (keyboardLoopRef.current) {
        clearInterval(keyboardLoopRef.current);
        keyboardLoopRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModeTab, isConnected, keyboardActive]);

  useEffect(() => {
    if (!keyboardActive) return;
    if (activeModeTab !== 'keyboard' || !isConnected) {
      stopKeyboardControl();
    }
  }, [activeModeTab, isConnected, keyboardActive, stopKeyboardControl]);

  const startGamepadControl = useCallback(async () => {
    const available = availableGamepads;
    const nextSelectedIndex = available.length > 0 && (selectedGamepadIndex === null || !available.some((gamepad) => gamepad.index === selectedGamepadIndex))
      ? available[0].index
      : selectedGamepadIndex;

    if (nextSelectedIndex !== selectedGamepadIndex) {
      setSelectedGamepadIndex(nextSelectedIndex);
    }

    if (!isConnected || estopActive || nextSelectedIndex === null) return;

    stopKeyboardControl();
    try {
      const status = await lerobotClient.gamepadStart({
        controller_index: nextSelectedIndex,
        speed: gamepadSpeedRef.current,
      });
      applyGamepadStatus(status);
      appendLog(`Runtime gamepad armed on controller ${nextSelectedIndex + 1}.`);
      setCommandError('');
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Gamepad start failed');
    }
  }, [appendLog, applyGamepadStatus, availableGamepads, estopActive, isConnected, selectedGamepadIndex, stopKeyboardControl]);

  useEffect(() => {
    if (!gamepadActive) return;
    if (activeModeTab !== 'gamepad' || !isConnected || estopActive) {
      stopGamepadControl({ silent: true }).catch(() => {});
    }
  }, [activeModeTab, estopActive, gamepadActive, isConnected, stopGamepadControl]);

  useEffect(() => {
    if (!gamepadActive) return undefined;
    if (selectedGamepadIndex === null) return undefined;

    if (gamepadConfigureTimerRef.current) {
      clearTimeout(gamepadConfigureTimerRef.current);
    }

    gamepadConfigureTimerRef.current = setTimeout(() => {
      lerobotClient.gamepadConfigure({
        controller_index: selectedGamepadIndex,
        speed: gamepadSpeedRef.current,
      })
        .then((status) => {
          applyGamepadStatus(status);
          setCommandError('');
        })
        .catch((error) => {
          setCommandError(error instanceof Error ? error.message : 'Gamepad update failed');
        });
    }, 120);

    return () => {
      if (gamepadConfigureTimerRef.current) {
        clearTimeout(gamepadConfigureTimerRef.current);
        gamepadConfigureTimerRef.current = null;
      }
    };
  }, [applyGamepadStatus, gamepadActive, gamepadSpeed, selectedGamepadIndex]);

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
      className="relative overflow-hidden text-white"
      style={{ fontFamily: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace" }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[2rem]">
        <div className={`${styles.gridPattern} absolute inset-0 opacity-[0.14]`} />
        <div className={`${styles.ambientOrb} left-[-4rem] top-[-3rem] h-44 w-44 bg-emerald-500/14 opacity-65`} />
        <div className={`${styles.ambientOrb} bottom-[-4rem] right-[10%] h-52 w-52 bg-cyan-500/10 opacity-45`} style={{ animationDelay: '2.4s' }} />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.065),transparent_30%)]" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-[1380px] flex-col gap-5">
        <TeleopFrame className="overflow-hidden">
          <ControlPanel
              connectionState={connectionState}
              connectionPillState={connectionPillState}
              connectionPillLabel={connectionPillLabel}
              dryRun={teleopDryRun}
              isConnected={isConnected}
              teleopActive={teleopActive}
              robotTarget={{
                selectedRobotType,
                selectedSerialPort,
                selectedPortDetected,
                robotOptions: robotTypeOptions,
                portOptions,
                appliedLabel: appliedRobotTargetLabel,
                selectedLabel: selectedRobotTargetLabel,
                dirty: selectionDirty,
                saving: configSaving,
                onRobotTypeChange: handleRobotTypeChange,
                onSerialPortChange: handleSerialPortChange,
                onApply: handleApplyRobotTarget,
              }}
              onConnect={handleStart}
              onDisconnect={handleStop}
              connectButtonLabel={connectButtonLabel}
              connectButtonDisabled={connectButtonDisabled}
              statusSummary={{
                service: serviceStateLabel,
                robot: robotStateLabel,
                workflow: workflowStateLabel,
                gamepad: gamepadStateLabel,
                hint: statusHint,
                hintTone: statusHintTone,
              }}
              commandError={commandError}
              onDismissError={() => setCommandError('')}
              portScan={portScan}
              portScanLoading={portScanLoading}
              onScanPorts={handleScanPorts}
            />
        </TeleopFrame>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
          <TeleopFrame className="p-5 md:p-6">
            <div className="flex flex-col gap-4 border-b border-white/8 pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Control surface</div>
              </div>
              <div className="w-full lg:min-w-[430px] lg:w-auto">
                <ModeTabs activeTab={activeModeTab} onChange={setActiveModeTab} />
              </div>
            </div>

            <div className="mt-5">
              {showJointsTab ? (
                <div className="space-y-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">Joint control</div>
                    </div>
                    <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
                      {['low', 'medium', 'high'].map((step) => (
                        <button
                          key={step}
                          onClick={() => setSensitivity(step)}
                          className={`rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                            sensitivity === step ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/75'
                          }`}
                        >
                          {step}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    {joints.map((joint) => (
                      <JointCard
                        key={joint.id}
                        joint={joint}
                        sensitivity={sensitivity}
                        onUpdate={handleJointUpdate}
                        disabled={!isConnected || estopActive}
                      />
                    ))}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[220px_210px]">
                    <EStopButton onTrigger={handleEStop} disabled={!isConnected} active={estopActive} />
                    <button
                      onClick={handleReset}
                      disabled={!isConnected}
                      className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white/72 transition-all hover:border-white/20 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="h-2 w-2 rounded-full bg-white/20" />
                      Reset pose
                    </button>
                  </div>
                </div>
              ) : activeModeTab === 'keyboard' ? (
                <KeyboardControlTab
                  isConnected={isConnected}
                  estopActive={estopActive}
                  isKeyboardActive={keyboardActive}
                  keyboardSpeed={keyboardSpeed}
                  activeKeys={activeKeyboardKeys}
                  onStart={() => {
                    setKeyboardActive(true);
                    appendLog(`Keyboard control armed for ${appliedRobotTargetLabel}.`);
                  }}
                  onStop={stopKeyboardControl}
                  onSpeedChange={setKeyboardSpeed}
                  onKeyPress={(key) => {
                    pressKeyboardKey(key).catch(() => {});
                  }}
                  onKeyRelease={releaseKeyboardKey}
                />
              ) : activeModeTab === 'gamepad' ? (
                <GamepadControlTab
                  isConnected={isConnected}
                  estopActive={estopActive}
                  isGamepadActive={gamepadActive}
                  gamepadConnected={gamepadConnected}
                  availableGamepads={availableGamepads}
                  selectedGamepadIndex={selectedGamepadIndex}
                  gamepadSpeed={gamepadSpeed}
                  activeButtons={activeGamepadButtons}
                  analogValues={gamepadAnalogValues}
                  diagnostics={gamepadDiagnostics}
                  onStart={startGamepadControl}
                  onStop={stopGamepadControl}
                  onSpeedChange={setGamepadSpeed}
                  onSelectGamepad={setSelectedGamepadIndex}
                  onRefresh={refreshGamepads}
                />
              ) : (activeModeTab === 'camera' || activeModeTab === 'leader-arm') ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-6 py-4">
                    <div className="text-sm font-medium text-white/50">
                      {activeModeTab === 'camera' ? 'Camera Feed' : 'Leader Arm Control'}
                    </div>
                    <div className="mt-1.5 text-xs font-mono text-white/25 uppercase tracking-[0.18em]">
                      Coming soon
                    </div>
                  </div>
                </div>
              ) : null}

            </div>
          </TeleopFrame>

          <TeleopFrame className="p-4 md:p-5">
            <div className="flex flex-col gap-3 border-b border-white/8 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Live workspace</div>
                <p className="mt-1 text-sm leading-6 text-white/56">{renderStateLabel}</p>
              </div>
              <div className="rounded-[1rem] border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="text-[11px] font-medium text-white/45">Current session</div>
                <div className="mt-1.5 text-sm font-medium text-white/80">{selectedRobotTargetLabel}</div>
              </div>
            </div>

            <div className="mt-4 h-[500px]">
              <ViewerPanel
                telemetry={telemetry}
                isConnected={isConnected}
                dryRun={teleopDryRun}
                onFullscreen={handleFullscreen}
                onSnapshot={handleSnapshot}
                viewerRef={viewerPanelRef}
              >
                <Suspense fallback={<ViewerLoadingFallback />}>
                  <UrdfRobotViewer joints={joints.map((joint) => ({
                    ...joint,
                    position: joint.id === 'gripper' ? joint.position : joint.position * Math.PI / 180,
                  }))} />
                </Suspense>
              </ViewerPanel>
            </div>
          </TeleopFrame>
        </div>

        <TeleopFrame className="p-4 md:p-5" style={{ minHeight: '220px' }}>
          <LogViewer logs={logs} onClear={() => setLogs([])} />
        </TeleopFrame>
      </div>
    </div>
  );
}
